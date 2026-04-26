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

        // SEO Scoring
        let score = 0;
        const details = [];

        // Simple scoring rules
        if (keywords.some(kw => title.includes(kw))) { score += 20; details.push({ criterion: '제목 키워드', score: 20, status: 'good', message: '제목에 키워드가 잘 반영되었습니다.' }); }
        if (charCountExcludingSpaces > 1500) { score += 30; details.push({ criterion: '글자 수', score: 30, status: 'good', message: '충분한 분량의 글입니다.' }); }
        else { score += 15; details.push({ criterion: '글자 수', score: 15, status: 'warn', message: '조금 더 내용을 보완하면 좋습니다.' }); }
        
        if (imageCount >= 10) { score += 20; details.push({ criterion: '사진 개수', score: 20, status: 'good', message: '사진이 풍부하게 사용되었습니다.' }); }
        else { score += 10; details.push({ criterion: '사진 개수', score: 10, status: 'warn', message: '사진을 더 추가해 보세요.' }); }

        score += 30; // Base score for structure

        // Save to Supabase
        if (supabase) {
            await supabase.from('history').insert([
                { title, url: targetUrl, score, char_count: charCountExcludingSpaces, img_count: imageCount }
            ]);
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
