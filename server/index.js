const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const exifr = require('exifr');
const path = require('path');
require('dotenv').config();

const app = express();

// Supabase Configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
let supabase;

if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('[DB] Supabase client initialized.');
}

app.use(cors());
app.use(express.json());

// Helper: Parse Naver URL
function parseNaverUrl(url) {
    try {
        const urlObj = new URL(url);
        const params = urlObj.searchParams;
        if (params.has('blogId') && params.has('logNo')) {
            return { blogId: params.get('blogId'), logNo: params.get('logNo') };
        }
        const pathParts = urlObj.pathname.split('/').filter(p => p);
        if (urlObj.hostname.includes('blog.naver.com') && pathParts.length >= 2) {
            if (pathParts[0] !== 'PostView.naver' && pathParts[0] !== 'PostDetail.naver') {
                return { blogId: pathParts[0], logNo: pathParts[1] };
            }
        }
        if (urlObj.hostname === 'm.blog.naver.com' && pathParts.length >= 2) {
             return { blogId: pathParts[0], logNo: pathParts[1] };
        }
    } catch (e) { return null; }
    return null;
}

// Helper: Scrape Naver Search Results
async function scrapeNaverSearch(keyword) {
    const searchUrl = `https://search.naver.com/search.naver?ssc=tab.blog.all&sm=tab_jum&query=${encodeURIComponent(keyword)}`;
    
    console.log(`[Search] Starting search: ${searchUrl}`);

    try {
        const response = await axios.get(searchUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                'Referer': 'https://www.naver.com/',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            },
            timeout: 8000
        });
        
        const $ = cheerio.load(response.data);
        const results = [];

        // Updated Selectors for ssc=tab.blog.all
        $('.title_area, .api_title_area').each((i, el) => {
            if (results.length >= 10) return;
            const aTag = $(el).find('a').first();
            const title = aTag.text().trim();
            const url = aTag.attr('href');
            if (title && url && url.includes('blog.naver.com')) {
                results.push({ rank: results.length + 1, title, url, blogName: 'Naver Blog' });
            }
        });

        // Fallback: If CSS selectors fail, try Regex on the whole body
        if (results.length === 0) {
            console.log('[Search] CSS selectors failed, trying Regex fallback...');
            const blogUrlRegex = /https:\/\/blog\.naver\.com\/[a-zA-Z0-9_-]+\/\d+/g;
            const matches = response.data.match(blogUrlRegex);
            if (matches && matches.length > 0) {
                const uniqueUrls = [...new Set(matches)];
                uniqueUrls.slice(0, 10).forEach((url, idx) => {
                    results.push({ rank: idx + 1, title: '네이버 블로그 포스팅', url, blogName: 'Naver Blog' });
                });
                console.log(`[Search] Regex found ${results.length} unique URLs`);
            }
        }

        console.log(`[Search] Final results found: ${results.length}`);
        return results;
    } catch (e) { 
        console.error(`[Search] Critical error:`, e.message);
        return [];
    }
}

// Endpoint: Analyze
app.post('/api/analyze', async (req, res) => {
    const { url, keywords = [] } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    console.log(`[Analyze] Processing URL: ${url}`);

    const info = parseNaverUrl(url);
    if (!info) return res.status(400).json({ error: '유효한 네이버 블로그 주소가 아닙니다.' });

    try {
        const targetUrl = `https://blog.naver.com/PostView.naver?blogId=${info.blogId}&logNo=${info.logNo}&redirect=Dlog&widgetTypeCall=true&directAccess=false`;
        const response = await axios.get(targetUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Referer': 'https://blog.naver.com/' }
        });

        const $ = cheerio.load(response.data);
        const title = $('.se-title-text').first().text().trim() || $('.htitle').first().text().trim() || '제목 없음';
        let contentArea = $('.se-main-container').first();
        if (contentArea.length === 0) contentArea = $('#postViewArea').first();
        
        const cleanBodyText = contentArea.text().replace(/\s+/g, ' ').trim();
        const charCount = cleanBodyText.replace(/\s/g, '').length;
        const imageCount = contentArea.find('img').length;
        
        const charDetails = {
            total: charCount,
            totalWithSpaces: cleanBodyText.length,
            korean: (cleanBodyText.match(/[ㄱ-ㅎ가-힣]/g) || []).length,
            english: (cleanBodyText.match(/[a-zA-Z]/g) || []).length,
            number: (cleanBodyText.match(/[0-9]/g) || []).length,
            special: charCount - ((cleanBodyText.match(/[ㄱ-ㅎ가-힣]/g) || []).length + (cleanBodyText.match(/[a-zA-Z]/g) || []).length + (cleanBodyText.match(/[0-9]/g) || []).length)
        };

        const customKeywordsResults = keywords.map(kw => ({
            keyword: kw,
            count: (cleanBodyText.match(new RegExp(kw, 'gi')) || []).length,
            inTitle: title.includes(kw)
        }));

        // SEO Scoring Logic with Actionable Recommendations - ENHANCED
        let score = 0;
        const details = [];

        // 1. Title Keyword Check (15 pts)
        const keywordsInTitle = customKeywordsResults.filter(r => r.inTitle).length;
        if (keywordsInTitle > 0) {
            score += 15;
            details.push({ criterion: '제목 키워드', score: 15, status: 'good', message: '제목에 핵심 키워드가 아주 잘 포함되었습니다.' });
        } else {
            details.push({ criterion: '제목 키워드', score: 0, status: 'bad', message: '제목에 핵심 키워드를 넣으면 검색 노출 확률이 크게 올라갑니다.' });
        }

        // 2. Early Introduction Keyword (10 pts)
        const first300 = cleanBodyText.substring(0, 300).toLowerCase();
        const hasEarlyKeyword = keywords.some(kw => first300.includes(kw.toLowerCase()));
        if (hasEarlyKeyword) {
            score += 10;
            details.push({ criterion: '도입부 키워드', score: 10, status: 'good', message: '글의 도입부(첫 300자)에 키워드가 자연스럽게 배치되었습니다.' });
        } else {
            details.push({ criterion: '도입부 키워드', score: 0, status: 'warn', message: '글의 초반부에 핵심 키워드를 언급하여 주제를 명확히 해주세요.' });
        }

        // 3. Keyword Density (15 pts)
        if (keywords.length > 0) {
            const totalCount = customKeywordsResults.reduce((sum, r) => sum + r.count, 0);
            const avgDensity = totalCount / keywords.length;
            if (avgDensity >= 3 && avgDensity <= 8) {
                score += 15;
                details.push({ criterion: '키워드 빈도', score: 15, status: 'good', message: `키워드가 평균 ${avgDensity.toFixed(1)}회로 아주 적절하게 반복되었습니다.` });
            } else if (avgDensity < 3) {
                score += 5;
                details.push({ criterion: '키워드 빈도', score: 5, status: 'warn', message: '키워드 언급 횟수가 다소 적습니다. 문맥에 맞게 1~2회 더 추가해 보세요.' });
            } else {
                details.push({ criterion: '키워드 빈도', score: 0, status: 'bad', message: '특정 단어가 너무 자주 반복되면 스팸으로 인식될 수 있으니 주의하세요.' });
            }
        }

        // 4. Content Depth (20 pts)
        if (charCount > 1800) {
            score += 20;
            details.push({ criterion: '콘텐츠 분량', score: 20, status: 'good', message: '상당히 전문적이고 풍부한 분량의 포스팅입니다.' });
        } else if (charCount > 1000) {
            score += 10;
            details.push({ criterion: '콘텐츠 분량', score: 10, status: 'warn', message: '내용은 준수하지만, 500자 정도 더 보완하면 상위 노출에 유리합니다.' });
        } else {
            score += 5;
            details.push({ criterion: '콘텐츠 분량', score: 5, status: 'bad', message: '분량이 너무 짧습니다. 독자에게 줄 수 있는 정보를 더 추가해 보세요.' });
        }

        // 5. Structural Formatting (15 pts)
        const hasLists = cleanBodyText.includes('•') || cleanBodyText.includes('·') || cleanBodyText.includes('- ');
        const hasBold = response.data.includes('</strong>') || response.data.includes('</b>') || response.data.includes('se-text-bold');
        if (hasLists && hasBold) {
            score += 15;
            details.push({ criterion: '가독성 구조', score: 15, status: 'good', message: '불렛포인트와 강조 텍스트를 사용하여 읽기 매우 편한 구조입니다.' });
        } else if (hasLists || hasBold) {
            score += 8;
            details.push({ criterion: '가독성 구조', score: 8, status: 'warn', message: '중요한 부분에 굵은 글씨나 리스트를 활용하면 체류 시간이 늘어납니다.' });
        } else {
            details.push({ criterion: '가독성 구조', score: 0, status: 'bad', message: '단순 텍스트 위주입니다. 문단을 나누고 강조 요소를 추가해 보세요.' });
        }

        // 6. Multimedia Composition (15 pts)
        if (imageCount >= 15) {
            score += 15;
            details.push({ criterion: '사진 구성', score: 15, status: 'good', message: '사진이 풍부하여 시각적인 만족도가 높은 포스팅입니다.' });
        } else if (imageCount >= 8) {
            score += 10;
            details.push({ criterion: '사진 구성', score: 10, status: 'good', message: '적절한 개수의 이미지가 포함되어 있습니다.' });
        } else {
            score += 5;
            details.push({ criterion: '사진 구성', score: 5, status: 'warn', message: '이미지 개수가 부족합니다. 3~5장 정도의 사진을 더 배치해 보세요.' });
        }

        // 7. Information Diversity (10 pts)
        const isDiverse = charDetails.english > 50 || charDetails.number > 30;
        if (isDiverse) {
            score += 10;
            details.push({ criterion: '정보 다양성', score: 10, status: 'good', message: '수치 데이터나 외국어 명칭 등이 포함되어 정보의 신뢰도가 높습니다.' });
        } else {
            details.push({ criterion: '정보 다양성', score: 0, status: 'info', message: '구체적인 수치(숫자)나 정확한 명칭을 포함하면 전문성이 올라갑니다.' });
        }

        const images = [];
        contentArea.find('img').each((i, el) => {
            const src = $(el).attr('src') || $(el).attr('data-lazy-src') || $(el).attr('data-src');
            if (src && !src.includes('static.regular') && images.length < 20) images.push(src);
        });

        const topKeywords = Object.entries(cleanBodyText.replace(/[^\w\sㄱ-ㅎ가-힣]/g, ' ').split(/\s+/).reduce((acc, w) => {
            if (w.length >= 2) acc[w] = (acc[w] || 0) + 1;
            return acc;
        }, {})).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([word, count]) => ({ word, count }));

        if (supabase) {
            await supabase.from('history').insert([{ title, url: targetUrl, score, char_count: charCount, img_count: imageCount }]);
        }

        res.json({ title, charCount, charDetails, imageCount, images, topKeywords, customKeywordsResults, seoScore: score, seoDetails: details, url: targetUrl });
    } catch (error) { 
        console.error(`[Analyze] Error analyzing ${url}:`, error.message);
        res.status(500).json({ error: 'Failed to analyze' }); 
    }
});

// Endpoint: Competitor Analysis
app.post('/api/competitors', async (req, res) => {
    const { keyword } = req.body;
    if (!keyword) return res.status(400).json({ error: 'Keyword required' });

    console.log(`[Comp] Starting competitor analysis for: "${keyword}"`);

    try {
        const topResults = await scrapeNaverSearch(keyword);
        if (!topResults || topResults.length === 0) {
            console.log('[Comp] No search results to analyze.');
            return res.json({ competitors: [] });
        }

        console.log(`[Comp] Analyzing top ${Math.min(topResults.length, 5)} competitors...`);

        const competitorPromises = topResults.slice(0, 5).map(async (result) => {
            try {
                const info = parseNaverUrl(result.url);
                if (!info) {
                    console.log(`[Comp] Could not parse URL: ${result.url}`);
                    return { ...result, charCount: 0, imgCount: 0 };
                }

                const directUrl = `https://blog.naver.com/PostView.naver?blogId=${info.blogId}&logNo=${info.logNo}`;
                console.log(`[Comp] Fetching blog content: ${directUrl}`);
                
                const postRes = await axios.get(directUrl, { 
                    headers: { 
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                        'Referer': 'https://blog.naver.com/',
                    }, 
                    timeout: 5000 
                });

                const $comp = cheerio.load(postRes.data);
                let contentArea = $comp('.se-main-container').first();
                if (contentArea.length === 0) contentArea = $comp('#postViewArea').first();
                if (contentArea.length === 0) contentArea = $comp('.post_ct').first();
                
                const actualTitle = $comp('.se-title-text').first().text().trim() || $comp('.htitle').first().text().trim() || result.title;
                const text = contentArea.text().replace(/\s+/g, ' ').trim();
                const charCount = text.replace(/\s/g, '').length || 0;
                const imgCount = contentArea.find('img').length || 0;
                
                console.log(`[Comp] SUCCESS: ${actualTitle.substring(0,15)}... (${charCount} chars, ${imgCount} imgs)`);
                return { 
                    ...result, 
                    title: actualTitle,
                    charCount, 
                    imgCount 
                };
            } catch (err) {
                console.error(`[Comp] FAILED for ${result.url}:`, err.message);
                return { ...result, charCount: 0, imgCount: 0 };
            }
        });

        const competitors = await Promise.all(competitorPromises);
        console.log(`[Comp] Completed. Returning ${competitors.length} results.`);
        res.json({ competitors });
    } catch (error) {
        console.error('[Comp] Critical Error:', error.message);
        res.status(500).json({ error: 'Failed to analyze competitors' });
    }
});

// Endpoint: Proxy Image
app.get('/api/proxy-image', async (req, res) => {
    const { url } = req.query;
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer', headers: { 'Referer': 'https://blog.naver.com/' } });
        res.set('Content-Type', response.headers['content-type']).send(response.data);
    } catch (e) { res.status(500).send('Proxy error'); }
});

app.get('/api/history', async (req, res) => {
    if (!supabase) return res.json([]);
    const { data } = await supabase.from('history').select('*').order('created_at', { ascending: false }).limit(50);
    res.json(data || []);
});

app.delete('/api/history', async (req, res) => {
    if (supabase) await supabase.from('history').delete().neq('id', 0);
    res.json({ success: true });
});

app.get('/api/rankings', async (req, res) => {
    if (!supabase) return res.json([]);
    const { data } = await supabase.from('rankings').select('*').order('last_checked', { ascending: false });
    res.json(data || []);
});

app.post('/api/rank/track', async (req, res) => {
    const { keyword, url } = req.body;
    if (supabase) {
        const results = await scrapeNaverSearch(keyword);
        const rank = results.find(r => r.url.includes(url))?.rank || 99;
        await supabase.from('rankings').insert([{ keyword, blog_url: url, rank }]);
    }
    res.json({ success: true });
});

app.delete('/api/rankings', async (req, res) => {
    if (supabase) await supabase.from('rankings').delete().neq('id', 0);
    res.json({ success: true });
});

app.post('/api/related-keywords', async (req, res) => {
    const { keyword } = req.body;
    try {
        const response = await axios.get(`https://m.search.naver.com/search.naver?query=${encodeURIComponent(keyword)}`);
        const $ = cheerio.load(response.data);
        const related = [];
        $('.lst_related_srch .tit, .related_srch .tit, ._related_keyword_tile .tit').each((i, el) => {
            if (related.length < 10) related.push($(el).text().trim());
        });
        res.json({ related });
    } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

async function startServer(port) {
    const serverPort = port || process.env.PORT || 5001;
    app.listen(serverPort, () => console.log(`[Server] Running on port ${serverPort}`));
}

if (require.main === module) startServer();
module.exports = { startServer };
