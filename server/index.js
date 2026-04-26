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
    console.log('Supabase client initialized.');
} else {
    console.warn('Supabase credentials missing. DB features will be disabled.');
}

app.use(cors());
app.use(express.json());

// Helper functions
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

// Endpoint: Analyze
app.post('/api/analyze', async (req, res) => {
    const { url, keywords = [] } = req.body;

    if (!url) return res.status(400).json({ error: 'URL is required' });

    const info = parseNaverUrl(url);
    if (!info) return res.status(400).json({ error: '유효한 네이버 블로그 주소가 아닙니다.' });

    try {
        const targetUrl = `https://blog.naver.com/PostView.naver?blogId=${info.blogId}&logNo=${info.logNo}&redirect=Dlog&widgetTypeCall=true&directAccess=false`;
        
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://blog.naver.com/'
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);

        if ($('.error_content').length > 0 || $('title').text().includes('페이지를 찾을 수 없습니다')) {
            return res.status(404).json({ error: '블로그 글을 찾을 수 없습니다. 주소를 다시 확인해주세요.' });
        }

        const title = $('.se-title-text').first().text().trim() || $('.htitle').first().text().trim() || '제목 없음';
        
        let contentArea = $('.se-main-container').first();
        if (contentArea.length === 0) contentArea = $('#postViewArea').first();
        
        if (contentArea.length === 0) {
            return res.status(422).json({ error: '본문 내용을 추출할 수 없습니다.' });
        }
        
        const contentClone = contentArea.clone();
        contentClone.find('script, style, .se-component-externalLinks, .se-material').remove();
        
        const rawBodyText = contentClone.text();
        const cleanBodyText = rawBodyText.replace(/\s+/g, ' ').trim();
        
        // Character Analysis
        const charCountExcludingSpaces = cleanBodyText.replace(/\s/g, '').length;
        const charCountIncludingSpaces = cleanBodyText.length;
        const koreanCount = (cleanBodyText.match(/[ㄱ-ㅎ가-힣]/g) || []).length;
        const englishCount = (cleanBodyText.match(/[a-zA-Z]/g) || []).length;
        const numberCount = (cleanBodyText.match(/[0-9]/g) || []).length;
        const specialCount = charCountExcludingSpaces - (koreanCount + englishCount + numberCount);
        
        const charDetails = {
            total: charCountExcludingSpaces,
            totalWithSpaces: charCountIncludingSpaces,
            korean: koreanCount,
            english: englishCount,
            number: numberCount,
            special: specialCount
        };
        
        const imageCount = contentArea.find('img').length;
        const images = [];
        contentArea.find('img').each((i, el) => {
            const src = $(el).attr('src') || $(el).attr('data-lazy-src') || $(el).attr('data-src');
            if (src && !src.includes('static.regular') && images.length < 20) {
                images.push(src);
            }
        });

        // Keyword Frequency
        const pureText = cleanBodyText.replace(/[^\w\sㄱ-ㅎ가-힣]/g, ' ');
        const rawWords = pureText.split(/\s+/).filter(w => w.length > 1 && !/^\d+$/.test(w));
        const freqMap = {};
        rawWords.forEach(w => {
            let word = w.toLowerCase();
            if (word.length >= 2) freqMap[word] = (freqMap[word] || 0) + 1;
        });

        const topKeywords = Object.entries(freqMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([word, count]) => ({ word, count }));

        const customKeywordsResults = keywords.map(kw => {
            const regex = new RegExp(kw, 'gi');
            const count = (cleanBodyText.match(regex) || []).length;
            const inTitle = title.toLowerCase().includes(kw.toLowerCase());
            return { keyword: kw, count, inTitle };
        });

        // SEO Scoring Logic with Actionable Recommendations - FULL RESTORATION
        let score = 0;
        const details = [];

        // 1. Title & Answer-First Structure (20 pts)
        const keywordsInTitle = customKeywordsResults.filter(r => r.inTitle).length;
        const firstParagraph = cleanBodyText.substring(0, 300).toLowerCase();
        const hasEarlyKeyword = keywords.some(kw => firstParagraph.includes(kw.toLowerCase()));

        if (keywordsInTitle > 0 && hasEarlyKeyword) {
            score += 20;
            details.push({ criterion: '제목 및 도입부', score: 20, status: 'good', message: '완벽해요! 제목과 도입부에 키워드가 아주 잘 배치되었습니다.' });
        } else {
            let msg = '';
            if (keywordsInTitle === 0) msg += '제목에 핵심 키워드를 꼭 넣어주세요. ';
            if (!hasEarlyKeyword) msg += '글의 첫 부분(도입부)에도 키워드를 자연스럽게 노출해 보세요.';
            details.push({ criterion: '제목 및 도입부', score: 0, status: 'bad', message: msg || '도입부 구성을 조금 더 보완해볼까요?' });
        }

        // 2. Contextual Keyword Density (20 pts)
        if (keywords.length > 0) {
            const totalCount = customKeywordsResults.reduce((sum, r) => sum + r.count, 0);
            const avgCount = totalCount / keywords.length;
            
            if (avgCount >= 3 && avgCount <= 5) {
                score += 20;
                details.push({ criterion: '키워드 밀도', score: 20, status: 'good', message: '아주 적절한 빈도입니다. 이대로 유지하시면 좋아요!' });
            } else if (avgCount < 3) {
                score += 10;
                details.push({ criterion: '키워드 밀도', score: 10, status: 'warn', message: `핵심 단어가 조금 부족해요. 1~2번 정도만 더 언급해 보는 건 어떨까요?` });
            } else {
                const overCount = Math.ceil(avgCount - 5);
                details.push({ criterion: '키워드 밀도', score: 0, status: 'bad', message: `키워드가 너무 자주 나와요! ${overCount}번 정도 줄여야 어뷰징 위험을 피할 수 있어요.` });
            }
        } else {
             details.push({ criterion: '키워드 밀도', score: 0, status: 'info', message: '타겟 키워드를 입력하시면 정밀 밀도 분석이 가능합니다.' });
        }

        // 3. Content Depth (20 pts)
        if (charCountExcludingSpaces > 1800) {
            score += 20;
            details.push({ criterion: '글의 분량', score: 20, status: 'good', message: '충분한 정성이 느껴지는 분량이에요. 전문성이 돋보입니다!' });
        } else if (charCountExcludingSpaces > 1000) {
            score += 10;
            details.push({ criterion: '글의 분량', score: 10, status: 'warn', message: `적절한 분량이지만, ${1800 - charCountExcludingSpaces}자 정도 더 보완하면 전문성 점수가 올라갑니다.` });
        } else {
            details.push({ criterion: '글의 분량', score: 5, status: 'bad', message: `내용이 다소 짧습니다. 약 ${1000 - charCountExcludingSpaces}자 이상 더 작성하시는 것을 권장합니다.` });
            score += 5;
        }

        // 4. Structural Formatting (15 pts)
        const hasStructure = rawBodyText.includes('•') || rawBodyText.includes('·') || rawBodyText.includes('- ') || response.data.includes('</strong>') || response.data.includes('</b>');
        if (hasStructure) {
            score += 15;
            details.push({ criterion: '가독성 구조', score: 15, status: 'good', message: '불렛포인트나 강조 텍스트를 사용하여 읽기 편한 구조를 갖췄습니다.' });
        } else {
            details.push({ criterion: '가독성 구조', score: 0, status: 'bad', message: '중요한 단어를 굵게 만들거나, 불렛포인트(•)를 쓰면 AI가 더 좋아해요!' });
        }

        // 5. Multimedia (15 pts)
        if (imageCount >= 12) {
            score += 15;
            details.push({ criterion: '사진 구성', score: 15, status: 'good', message: '풍부한 사진이 독자의 눈을 즐겁게 해줄 거예요!' });
        } else {
            const needMoreImg = 12 - imageCount;
            score += 5;
            details.push({ criterion: '사진 구성', score: 5, status: 'warn', message: `사진을 ${needMoreImg}장 정도만 더 추가해서 시각 정보를 풍부하게 채워보세요.` });
        }

        // 6. Image Originality (10 pts)
        score += 10; // Defaulting for simple web version, can be refined with EXIF later
        details.push({ criterion: '이미지 독창성', score: 10, status: 'good', message: '직접 촬영한 원본 사진 데이터를 최대한 활용해 주세요!' });

        // Save to Supabase
        if (supabase) {
            const { error: dbError } = await supabase.from('history').insert([
                { title, url: targetUrl, score, char_count: charCountExcludingSpaces, img_count: imageCount }
            ]);
            
            if (dbError) {
                console.error('Supabase Insert Error:', dbError.message);
            } else {
                console.log('Successfully saved to Supabase history.');
            }
        }

        res.json({
            title,
            charCount: charCountExcludingSpaces,
            charDetails,
            imageCount,
            images,
            topKeywords,
            customKeywordsResults,
            seoScore: score,
            seoDetails: details,
            url: targetUrl
        });

    } catch (error) {
        console.error('Analysis error:', error);
        res.status(500).json({ error: 'Failed to analyze' });
    }
});

// Endpoint: Proxy Image
app.get('/api/proxy-image', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL required' });
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://blog.naver.com/'
            }
        });
        res.set('Content-Type', response.headers['content-type']);
        res.send(response.data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to proxy image' });
    }
});

// Endpoint: Competitor Analysis
app.post('/api/competitors', async (req, res) => {
    const { keyword } = req.body;
    if (!keyword) return res.status(400).json({ error: 'Keyword required' });

    try {
        // Simplified competitor scraping logic (reusing existing functions if available)
        const searchUrl = `https://search.naver.com/search.naver?where=blog&query=${encodeURIComponent(keyword)}`;
        const response = await axios.get(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        });
        const $ = cheerio.load(response.data);
        const competitors = [];
        $('.title_link').each((i, el) => {
            if (i < 5) {
                competitors.push({
                    rank: i + 1,
                    title: $(el).text().trim(),
                    url: $(el).attr('href'),
                    blogName: 'Naver Blog',
                    charCount: 0,
                    imgCount: 0
                });
            }
        });
        res.json({ competitors });
    } catch (error) {
        res.status(500).json({ error: 'Failed to analyze competitors' });
    }
});

// Endpoint: History & Rankings using Supabase
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
        // Track logic...
        const searchUrl = `https://search.naver.com/search.naver?where=blog&query=${encodeURIComponent(keyword)}`;
        const response = await axios.get(searchUrl);
        const $ = cheerio.load(response.data);
        let rank = 99;
        $('.title_link').each((i, el) => {
            if ($(el).attr('href').includes(url)) rank = i + 1;
        });
        await supabase.from('rankings').insert([{ keyword, blog_url: url, rank }]);
    }
    res.json({ success: true });
});

app.delete('/api/rankings', async (req, res) => {
    if (supabase) await supabase.from('rankings').delete().neq('id', 0);
    res.json({ success: true });
});

async function startServer(port) {
    const serverPort = port || process.env.PORT || 5001;
    app.listen(serverPort, () => {
        console.log(`Server running on port ${serverPort}`);
    });
}

if (require.main === module) { startServer(); }
module.exports = { startServer };
