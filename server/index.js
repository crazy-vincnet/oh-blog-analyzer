const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const exifr = require('exifr');
const path = require('path');

const app = express();

// Database Initialization with dynamic path
let db;
async function initDb(customDbPath) {
    const dbPath = customDbPath || process.env.DB_PATH || path.join(__dirname, 'blogpulse.db');
    
    console.log(`Initializing database at: ${dbPath}`);
    
    db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });
    await db.exec(`
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            url TEXT,
            score INTEGER,
            char_count INTEGER,
            img_count INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS rankings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            keyword TEXT,
            blog_url TEXT,
            rank INTEGER,
            last_checked DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    console.log('Database connected and tables initialized.');
    return db;
}

app.use(cors());
app.use(express.json());

// ... (existing helper functions and routes remain the same)

// Helper function to extract blogId and logNo from Naver Blog URL
function parseNaverUrl(url) {
    try {
        const urlObj = new URL(url);
        const params = urlObj.searchParams;

        // Pattern 1: blog.naver.com/PostView.naver?blogId=userId&logNo=logNo
        // Pattern 2: blog.naver.com/PostDetail.naver?blogId=userId&logNo=logNo
        if (params.has('blogId') && params.has('logNo')) {
            return { blogId: params.get('blogId'), logNo: params.get('logNo') };
        }

        // Pattern 3: blog.naver.com/userId/logNo
        const pathParts = urlObj.pathname.split('/').filter(p => p);
        if (urlObj.hostname.includes('blog.naver.com') && pathParts.length >= 2) {
            // Some URLs have extra parts, we usually want the first two or the last two
            // If the first part is 'PostView.naver', it's handled above
            if (pathParts[0] !== 'PostView.naver' && pathParts[0] !== 'PostDetail.naver') {
                return { blogId: pathParts[0], logNo: pathParts[1] };
            }
        }

        // Pattern 4: m.blog.naver.com/userId/logNo
        if (urlObj.hostname === 'm.blog.naver.com' && pathParts.length >= 2) {
             return { blogId: pathParts[0], logNo: pathParts[1] };
        }

    } catch (e) {
        return null;
    }
    return null;
}

app.post('/api/analyze', async (req, res) => {
    const { url, keywords = [] } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    console.log(`Analyzing URL: ${url}`);
    const info = parseNaverUrl(url);
    if (!info) {
        console.log('Invalid Naver URL format');
        return res.status(400).json({ error: '유효한 네이버 블로그 주소가 아닙니다.' });
    }

    try {
        // Naver Blog content is best accessed via this direct endpoint
        const targetUrl = `https://blog.naver.com/PostView.naver?blogId=${info.blogId}&logNo=${info.logNo}&redirect=Dlog&widgetTypeCall=true&directAccess=false`;
        console.log(`Targeting direct URL: ${targetUrl}`);
        
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Referer': 'https://blog.naver.com/'
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);

        // Check if we got an error page or empty content
        if ($('.error_content').length > 0 || $('title').text().includes('페이지를 찾을 수 없습니다')) {
            console.log('Naver returned 404/Error page');
            return res.status(404).json({ error: '블로그 글을 찾을 수 없습니다. 주소를 다시 확인해주세요.' });
        }

        // Selectors for both modern (SmartEditor One) and legacy editors
        const title = $('.se-title-text').first().text().trim() || $('.htitle').first().text().trim() || '제목 없음';
        
        // Surgical extraction of the BODY content only - Adding more legacy and edge-case selectors
        let contentArea = $('.se-main-container').first();
        if (contentArea.length === 0) contentArea = $('#postViewArea').first();
        if (contentArea.length === 0) contentArea = $('.post_ct').first();
        if (contentArea.length === 0) contentArea = $('.post-view').first();
        if (contentArea.length === 0) contentArea = $('#post-view').first();
        if (contentArea.length === 0) contentArea = $('.se_component_wrap').parent(); // Generic fallback

        if (contentArea.length === 0) {
            console.log('Could not find content area in HTML');
            // Check for common error signals in body
            if (response.data.includes('비공개') || response.data.includes('No Post')) {
                 return res.status(403).json({ error: '비공개 글이거나 접근할 수 없는 글입니다.' });
            }
            return res.status(422).json({ error: '본문 내용을 추출할 수 없습니다. 네이버의 새로운 레이아웃일 수 있습니다.' });
        }
        
        // Clone the content area to avoid modifying the original if needed
        const contentClone = contentArea.clone();
        // Remove known noise elements that are NOT part of the personal blog text
        contentClone.find('script, style, .se-component-externalLinks, .se-material').remove();
        
        const rawBodyText = contentClone.text();
        const cleanBodyText = rawBodyText.replace(/\s+/g, ' ').trim();
        
        // Detailed Character Analysis
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
            if (src && !src.includes('static.regular') && !src.includes('post.phinf.naver.net/data/static')) {
                // Fetch the highest quality original version (type=w1)
                let finalSrc = src;
                if (src.includes('pstatic.net') || src.includes('naver.net')) {
                    finalSrc = src.split('?')[0] + '?type=w1'; // w1 triggers the original high-res size
                }
                images.push(finalSrc);
            }
        });

        // Improved Keyword Frequency Analysis - Stripping common Korean particles
        const pureText = cleanBodyText.replace(/[^\w\sㄱ-ㅎ가-힣]/g, ' ');
        const rawWords = pureText.split(/\s+/).filter(w => w.length > 1 && !/^\d+$/.test(w));
        
        // Common Korean particles (Josa) to strip for better grouping
        const josa = ['은', '는', '이', '가', '을', '를', '의', '에', '로', '으로', '과', '와', '도', '만', '에서', '부터', '까지', '이다', '합니다', '하고'];
        
        const freqMap = {};
        rawWords.forEach(w => {
            let word = w.toLowerCase();
            // Simple heuristic: if word is longer than 2, check if it ends with a josa
            for (const j of josa) {
                if (word.length > j.length && word.endsWith(j)) {
                    word = word.substring(0, word.length - j.length);
                    break;
                }
            }
            if (word.length >= 2) {
                freqMap[word] = (freqMap[word] || 0) + 1;
            }
        });

        const topKeywords = Object.entries(freqMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([word, count]) => ({ word, count }));

        // Custom Keywords Check - EXACT MATCH + JOSA (Allow particles, but no other nouns/letters)
        const customKeywordsResults = keywords.map(kw => {
            const escapedKw = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Regex explanation:
            // (?<![a-zA-Z0-9ㄱ-ㅎ가-힣]) : No prefix allowed
            // ${escapedKw} : The keyword itself
            // (?:은|는|이|가|을|를|의|에|로|으로|과|와|도|만|에서|부터|까지|이다|합니다|하고|이랑|이나|(?![a-zA-Z0-9ㄱ-ㅎ가-힣])) : Allowed Josa OR end of word
            const regex = new RegExp(`(?<![a-zA-Z0-9ㄱ-ㅎ가-힣])${escapedKw}(?:은|는|이|가|을|를|의|에|로|으로|과|와|도|만|에서|부터|까지|이다|합니다|하고|이랑|이나|(?![a-zA-Z0-9ㄱ-ㅎ가-힣]))`, 'gi');
            const count = (cleanBodyText.match(regex) || []).length;
            const inTitle = title.toLowerCase().includes(kw.toLowerCase());
            return { keyword: kw, count, inTitle };
        });

        // SEO Scoring Logic with Actionable Recommendations - REFINED
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
        const imageMetadata = [];
        for (let i = 0; i < Math.min(images.length, 3); i++) {
            try {
                const imgRes = await axios.get(images[i], { responseType: 'arraybuffer', timeout: 3000 });
                const meta = await exifr.parse(imgRes.data);
                if (meta) {
                    imageMetadata.push({ index: i, isOriginal: true, model: meta.Model || 'Unknown Device' });
                }
            } catch (e) {}
        }
        
        if (imageMetadata.length > 0) {
            score += 10;
            details.push({ criterion: '이미지 독창성', score: 10, status: 'good', message: '직접 촬영한 원본 사진 데이터가 감지되었습니다. 신뢰도가 높습니다!' });
        } else {
            details.push({ criterion: '이미지 독창성', score: 0, status: 'info', message: '원본 사진(EXIF 데이터 포함)을 사용하면 네이버 점수가 더 올라갑니다.' });
        }

        // Save to Database
        try {
            await db.run(
                'INSERT INTO history (title, url, score, char_count, img_count) VALUES (?, ?, ?, ?, ?)',
                [title, targetUrl, score, charCountExcludingSpaces, imageCount]
            );
        } catch (dbErr) {
            console.error('DB Insert Error:', dbErr);
        }

        res.json({
            title,
            charCount: charCountExcludingSpaces,
            charDetails,
            imageCount,
            images,
            imageMetadata,
            topKeywords,
            customKeywordsResults,
            seoScore: score,
            seoDetails: details,
            url: targetUrl
        });

    } catch (error) {
        console.error('Analysis error:', error);
        res.status(500).json({ error: 'Failed to analyze the blog post' });
    }
});

// Helper: Scrape Naver Search Results
async function scrapeNaverSearch(keyword) {
    // 1. Try Blog Section Search (High Success Rate for JSON data)
    const blogSectionUrl = `https://m.blog.naver.com/SectionPostSearch.naver?searchValue=${encodeURIComponent(keyword)}`;
    try {
        console.log(`Trying Blog Section Search: ${blogSectionUrl}`);
        const response = await axios.get(blogSectionUrl, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1'
            }
        });
        
        // Naver Blog search often stores data in window.__INITIAL_STATE__
        const stateMatch = response.data.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});/);
        if (stateMatch) {
            const state = JSON.parse(stateMatch[1]);
            const postList = state.postList?.data?.items || [];
            if (postList.length > 0) {
                console.log(`Extracted ${postList.length} results from INITIAL_STATE`);
                return postList.slice(0, 10).map((item, idx) => ({
                    rank: idx + 1,
                    title: item.title?.replace(/<[^>]+>/g, '') || 'Naver Blog Post',
                    url: item.logNo ? `https://blog.naver.com/${item.blogId}/${item.logNo}` : item.url,
                    blogName: item.blogName || 'Naver Blog'
                }));
            }
        }

        // Check for Apollo State (common in PC View/Integrated search)
        const apolloMatch = response.data.match(/window\.__APOLLO_STATE__\s*=\s*({.+?});/);
        if (apolloMatch) {
            console.log('Found Apollo State, parsing...');
            const state = JSON.parse(apolloMatch[1]);
            const results = [];
            Object.keys(state).forEach(key => {
                if (key.startsWith('Post:') && state[key].title && results.length < 10) {
                    results.push({
                        rank: results.length + 1,
                        title: state[key].title.replace(/<[^>]+>/g, ''),
                        url: state[key].url || `https://blog.naver.com/${state[key].blogId}/${state[key].logNo}`,
                        blogName: state[key].blogName || 'Naver Blog'
                    });
                }
            });
            if (results.length > 0) return results;
        }

    } catch (e) {
        console.error('Blog Section Scrape Error:', e.message);
    }

    // 2. Fallback to Multi-Selector Scraping
    const urls = [
        `https://search.naver.com/search.naver?where=blog&query=${encodeURIComponent(keyword)}`,
        `https://m.search.naver.com/search.naver?where=m_blog&query=${encodeURIComponent(keyword)}`
    ];

    for (const searchUrl of urls) {
        try {
            console.log(`Trying fallback search URL: ${searchUrl}`);
            const response = await axios.get(searchUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
                timeout: 5000
            });
            
            const $ = cheerio.load(response.data);
            const results = [];
            const itemSelectors = ['.bx', '.view_wrap', '.total_wrap', '.api_ani_send'];
            const titleSelectors = ['.api_txt_lines', '.total_tit', '.title_link', '.api_title_area .title_link'];

            for (const itemSel of itemSelectors) {
                $(itemSel).each((i, el) => {
                    if (results.length >= 10) return;
                    let foundTitle, foundUrl;
                    for (const titleSel of titleSelectors) {
                        const tEl = $(el).find(titleSel);
                        if (tEl.length > 0) {
                            foundTitle = tEl.text().trim();
                            foundUrl = tEl.attr('href');
                            if (foundTitle && foundUrl) break;
                        }
                    }
                    const blogName = $(el).find('.sub_txt, .name, .blog_name, .total_sub').first().text().trim();
                    if (foundTitle && foundUrl && (foundUrl.includes('blog.naver.com') || foundUrl.includes('post.naver.com'))) {
                        results.push({ rank: results.length + 1, title: foundTitle, url: foundUrl, blogName: blogName || 'Naver Blog' });
                    }
                });
                if (results.length > 0) break;
            }

            if (results.length > 0) {
                console.log(`Fallback success: ${results.length} results from ${searchUrl}`);
                return results;
            }
            
            // 3. Regex Last Resort
            const blogUrlRegex = /https:\/\/blog\.naver\.com\/[a-zA-Z0-9_-]+\/\d+/g;
            const matches = response.data.match(blogUrlRegex);
            if (matches && matches.length > 0) {
                console.log(`Regex fallback found ${matches.length} blog URLs`);
                const uniqueUrls = [...new Set(matches)];
                return uniqueUrls.slice(0, 10).map((u, idx) => ({
                    rank: idx + 1, title: 'Naver Blog Post', url: u, blogName: 'Naver Blog'
                }));
            }
        } catch (e) {
            console.error(`Fallback failed for ${searchUrl}:`, e.message);
        }
    }
    
    return [];
}

// Endpoint: Competitor Analysis
app.post('/api/competitors', async (req, res) => {
    const { keyword } = req.body;
    if (!keyword) return res.status(400).json({ error: 'Keyword required' });

    console.log(`Analyzing competitors for keyword: ${keyword}`);

    try {
        const topResults = await scrapeNaverSearch(keyword);
        const competitors = [];

        // Analyze top 3 specifically for more depth
        for (let i = 0; i < Math.min(topResults.length, 5); i++) { // Increased to 5
            try {
                const info = parseNaverUrl(topResults[i].url);
                if (info) {
                    const directUrl = `https://blog.naver.com/PostView.naver?blogId=${info.blogId}&logNo=${info.logNo}`;
                    const postRes = await axios.get(directUrl, { 
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }, 
                        timeout: 5000 
                    });
                    const $comp = cheerio.load(postRes.data);
                    
                    // Improved selectors for competitor content
                    let contentArea = $comp('.se-main-container').first();
                    if (contentArea.length === 0) contentArea = $comp('#postViewArea').first();
                    if (contentArea.length === 0) contentArea = $comp('.post_ct').first();
                    
                    const actualTitle = $comp('.se-title-text').first().text().trim() || $comp('.htitle').first().text().trim() || topResults[i].title;

                    const contentText = contentArea.text().replace(/\s+/g, ' ').trim();
                    const cleanCharCount = contentText.replace(/\s/g, '').length;
                    const imgCount = contentArea.find('img').length;
                    
                    competitors.push({
                        ...topResults[i],
                        title: actualTitle,
                        charCount: cleanCharCount || 0,
                        imgCount: imgCount || 0
                    });
                } else {
                    competitors.push({ ...topResults[i], charCount: 0, imgCount: 0 });
                }
            } catch (err) {
                console.error(`Competitor ${i+1} fail:`, err.message);
                competitors.push({ ...topResults[i], charCount: 0, imgCount: 0 });
            }
        }

        res.json({ competitors });
    } catch (error) {
        console.error('Competitor Analysis Error:', error);
        res.status(500).json({ error: 'Failed to analyze competitors' });
    }
});

// Endpoint: Track Rank
app.post('/api/rank/track', async (req, res) => {
    const { keyword, url } = req.body;
    if (!keyword || !url) return res.status(400).json({ error: 'Keyword and URL required' });

    try {
        const results = await scrapeNaverSearch(keyword);
        const found = results.find(r => r.url.includes(url) || url.includes(r.url));
        const rank = found ? found.rank : 99; // 99 means not in top 10

        await db.run(
            'INSERT INTO rankings (keyword, blog_url, rank) VALUES (?, ?, ?)',
            [keyword, url, rank]
        );
        res.json({ keyword, url, rank });
    } catch (error) {
        res.status(500).json({ error: 'Failed to track rank' });
    }
});

app.get('/api/rankings', async (req, res) => {
    try {
        const rows = await db.all('SELECT * FROM (SELECT * FROM rankings ORDER BY last_checked DESC) GROUP BY keyword, blog_url ORDER BY last_checked DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch rankings' });
    }
});

app.get('/api/history', async (req, res) => {
    try {
        const rows = await db.all('SELECT * FROM history ORDER BY created_at DESC LIMIT 50');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

app.delete('/api/history', async (req, res) => {
    try {
        await db.run('DELETE FROM history');
        res.json({ message: 'History cleared successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to clear history' });
    }
});

app.delete('/api/rankings', async (req, res) => {
    try {
        await db.run('DELETE FROM rankings');
        res.json({ message: 'Rankings cleared successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to clear rankings' });
    }
});

// Endpoint: Related Keywords
app.post('/api/related-keywords', async (req, res) => {
    const { keyword } = req.body;
    if (!keyword) return res.status(400).json({ error: 'Keyword required' });
    
    const url = `https://m.search.naver.com/search.naver?query=${encodeURIComponent(keyword)}`;
    try {
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1' },
            timeout: 5000
        });
        const $ = cheerio.load(response.data);
        const related = [];
        $('.lst_related_srch .tit, .related_srch .tit, ._related_keyword_tile .tit').each((i, el) => {
            const text = $(el).text().trim();
            if (text && !related.includes(text) && related.length < 10) {
                related.push(text);
            }
        });
        res.json({ related });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch related keywords' });
    }
});

async function startServer(port, dbPath) {
    const serverPort = port || process.env.PORT || 5001;
    await initDb(dbPath);
    return new Promise((resolve) => {
        const server = app.listen(serverPort, () => {
            console.log(`Server running on port ${serverPort}`);
            resolve(server);
        });
    });
}

// Export for module usage (Electron)
module.exports = { app, initDb, startServer };

// If run directly (node index.js)
if (require.main === module) {
    startServer();
}
