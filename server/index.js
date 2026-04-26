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
    const urls = [
        `https://m.blog.naver.com/SectionPostSearch.naver?searchValue=${encodeURIComponent(keyword)}`,
        `https://search.naver.com/search.naver?where=blog&query=${encodeURIComponent(keyword)}`
    ];

    console.log(`[Search] Starting search for keyword: "${keyword}"`);

    for (const searchUrl of urls) {
        try {
            console.log(`[Search] Fetching URL: ${searchUrl}`);
            const response = await axios.get(searchUrl, {
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
                },
                timeout: 6000
            });
            
            console.log(`[Search] Response status: ${response.status}`);
            const $ = cheerio.load(response.data);
            const results = [];

            // Case 1: INITIAL_STATE (Mobile)
            const stateMatch = response.data.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});/);
            if (stateMatch) {
                console.log('[Search] Found window.__INITIAL_STATE__');
                const state = JSON.parse(stateMatch[1]);
                const items = state.postList?.data?.items || [];
                if (items.length > 0) {
                    console.log(`[Search] Extracted ${items.length} items from INITIAL_STATE`);
                    return items.slice(0, 10).map((item, idx) => ({
                        rank: idx + 1,
                        title: item.title?.replace(/<[^>]+>/g, ''),
                        url: `https://blog.naver.com/${item.blogId}/${item.logNo}`,
                        blogName: item.blogName || 'Naver Blog'
                    }));
                }
            }

            // Case 2: Selectors (PC/Mobile HTML)
            const selectors = ['.api_txt_lines', '.total_tit', '.title_link', '.api_title_area a', 'a.api_link_target'];
            for (const selector of selectors) {
                $(selector).each((i, el) => {
                    if (results.length >= 10) return;
                    const title = $(el).text().trim();
                    const url = $(el).attr('href');
                    if (title && url && url.includes('blog.naver.com')) {
                        results.push({ rank: results.length + 1, title, url, blogName: 'Naver Blog' });
                    }
                });
                if (results.length > 0) {
                    console.log(`[Search] Found ${results.length} items using selector: ${selector}`);
                    break;
                }
            }

            if (results.length > 0) return results;
            console.log(`[Search] No results found on ${searchUrl}`);
        } catch (e) { 
            console.error(`[Search] Error fetching ${searchUrl}:`, e.message); 
        }
    }
    console.log('[Search] All search attempts failed.');
    return [];
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

        let score = 0;
        const details = [];
        if (keywords.some(kw => title.includes(kw))) { score += 20; details.push({ criterion: '제목 키워드', score: 20, status: 'good', message: '제목에 키워드가 잘 반영되었습니다.' }); }
        if (charCount > 1500) { score += 30; details.push({ criterion: '글자 수', score: 30, status: 'good', message: '충분한 분량의 글입니다.' }); }
        else { score += 15; details.push({ criterion: '글자 수', score: 15, status: 'warn', message: '내용을 조금 더 보완해 보세요.' }); }
        if (imageCount >= 12) { score += 20; details.push({ criterion: '사진 구성', score: 20, status: 'good', message: '사진이 풍부하게 사용되었습니다.' }); }
        else { score += 10; details.push({ criterion: '사진 구성', score: 10, status: 'warn', message: '사진을 더 추가해 보세요.' }); }
        score += 30;

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
                
                const text = contentArea.text().replace(/\s+/g, ' ').trim();
                const charCount = text.replace(/\s/g, '').length || 0;
                const imgCount = contentArea.find('img').length || 0;
                
                console.log(`[Comp] SUCCESS: ${result.title.substring(0,15)}... (${charCount} chars, ${imgCount} imgs)`);
                return { ...result, charCount, imgCount };
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
