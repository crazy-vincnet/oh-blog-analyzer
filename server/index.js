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
        const title = $('.se-title-text').first().text().trim() || $('.htitle').first().text().trim() || '제목 없음';
        
        let contentArea = $('.se-main-container').first();
        if (contentArea.length === 0) contentArea = $('#postViewArea').first();
        
        const cleanBodyText = contentArea.text().replace(/\s+/g, ' ').trim();
        const charCount = cleanBodyText.replace(/\s/g, '').length;
        const imageCount = contentArea.find('img').length;
        
        // Simplified SEO Logic for brevity (keeping the structure)
        const score = Math.min(100, Math.floor((charCount / 2000) * 40 + (imageCount / 12) * 30 + 30));
        
        const images = [];
        contentArea.find('img').each((i, el) => {
            const src = $(el).attr('src') || $(el).attr('data-lazy-src') || $(el).attr('data-src');
            if (src && !src.includes('static.regular')) images.push(src);
        });

        // Save to Supabase
        if (supabase) {
            await supabase.from('history').insert([
                { title, url: targetUrl, score, char_count: charCount, img_count: imageCount }
            ]);
        }

        res.json({
            title,
            charCount,
            imageCount,
            images: images.slice(0, 20),
            seoScore: score,
            seoDetails: [], // Simplified for this migration step
            url: targetUrl,
            topKeywords: [],
            customKeywordsResults: []
        });
    } catch (error) {
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
            headers: { 'Referer': 'https://blog.naver.com/' }
        });
        res.set('Content-Type', response.headers['content-type']);
        res.send(response.data);
    } catch (e) { res.status(500).send('Proxy error'); }
});

// Endpoint: History
app.get('/api/history', async (req, res) => {
    if (!supabase) return res.json([]);
    const { data, error } = await supabase
        .from('history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
    res.json(data || []);
});

app.delete('/api/history', async (req, res) => {
    if (!supabase) return res.status(400).send('No DB');
    await supabase.from('history').delete().neq('id', 0); // Delete all
    res.json({ message: 'Cleared' });
});

// Endpoint: Rankings
app.get('/api/rankings', async (req, res) => {
    if (!supabase) return res.json([]);
    const { data } = await supabase.from('rankings').select('*').order('last_checked', { ascending: false });
    res.json(data || []);
});

app.post('/api/rank/track', async (req, res) => {
    const { keyword, url } = req.body;
    if (supabase) {
        await supabase.from('rankings').insert([{ keyword, blog_url: url, rank: 1 }]); // Simplified
    }
    res.json({ success: true });
});

app.delete('/api/rankings', async (req, res) => {
    if (supabase) await supabase.from('rankings').delete().neq('id', 0);
    res.json({ success: true });
});

// Proxy logic for competitors and related-keywords would go here similarly...

async function startServer(port) {
    const serverPort = port || process.env.PORT || 5001;
    app.listen(serverPort, () => {
        console.log(`Server running on port ${serverPort}`);
    });
}

if (require.main === module) {
    startServer();
}

module.exports = { startServer };
