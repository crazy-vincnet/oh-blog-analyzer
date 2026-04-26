import { useState, useRef, useEffect } from 'react'
import html2canvas from 'html2canvas'
import download from 'downloadjs'
import { History, Users, Search, Settings, ArrowLeft, Download, RefreshCw, BarChart2, Award, Info, AlertTriangle, Trash2, Zap, ExternalLink, Moon, Sun, Sparkles, MessageSquare, Tag } from 'lucide-react'
import './App.css'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

interface KeywordResult {
  keyword: string;
  count: number;
  inTitle: boolean;
}

interface SeoDetail {
  criterion: string;
  score: number;
  message: string;
  status?: string;
}

interface HistoryItem {
    id: number;
    title: string;
    url: string;
    score: number;
    char_count: number;
    img_count: number;
    created_at: string;
}

interface RankingItem {
    id: number;
    keyword: string;
    blog_url: string;
    rank: number;
    last_checked: string;
}

interface Competitor {
    rank: number;
    title: string;
    url: string;
    blogName: string;
    charCount: number;
    imgCount: number;
}

interface AnalysisResult {
  title: string;
  charCount: number;
  charDetails: {
    total: number;
    totalWithSpaces: number;
    korean: number;
    english: number;
    number: number;
    special: number;
  };
  imageCount: number;
  images: string[];
  imageMetadata: any[];
  topKeywords: { word: string; count: number }[];
  customKeywordsResults: KeywordResult[];
  seoScore: number;
  seoDetails: SeoDetail[];
  url: string;
}

function App() {
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved === 'true';
  });
  const [currentView, setCurrentView] = useState<'analyze' | 'history' | 'rankings' | 'competitors'>('analyze');
  const [url, setUrl] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [rankings, setRankings] = useState<RankingItem[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [compKeyword, setCompKeyword] = useState('');
  const [relatedKeywords, setRelatedKeywords] = useState<string[]>([]);
  
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('darkMode', darkMode.toString());
  }, [darkMode]);

  useEffect(() => {
      if (currentView === 'history') fetchHistory();
      if (currentView === 'rankings') fetchRankings();
  }, [currentView]);

  const fetchHistory = async () => {
      try {
          const res = await fetch(`${API_BASE_URL}/api/history`);
          const data = await res.json();
          setHistory(data);
      } catch (err) { console.error('History fetch failed'); }
  };

  const fetchRankings = async () => {
      try {
          const res = await fetch(`${API_BASE_URL}/api/rankings`);
          const data = await res.json();
          setRankings(data);
      } catch (err) { console.error('Rankings fetch failed'); }
  };

  const fetchRelatedKeywords = async (keyword: string) => {
    try {
        const res = await fetch(`${API_BASE_URL}/api/related-keywords`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keyword })
        });
        const data = await res.json();
        if (data.related) setRelatedKeywords(data.related);
    } catch (err) { console.error('Related keywords fetch failed'); }
  };

  const addKeyword = (kw?: string) => {
    const target = kw || keywordInput.trim();
    if (target && !keywords.includes(target)) {
      setKeywords([...keywords, target]);
      if (!kw) setKeywordInput('');
    }
  };

  const handleAnalyze = async () => {
    if (!url) { setError('분석할 블로그 주소를 입력해주세요.'); return; }
    setLoading(true); setError('');
    setRelatedKeywords([]);
    try {
      const response = await fetch(`${API_BASE_URL}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, keywords }),
      });
      const data = await response.json();
      if (response.ok) {
        setResult(data);
        if (keywords.length > 0) fetchRelatedKeywords(keywords[0]);
        else if (data.topKeywords.length > 0) fetchRelatedKeywords(data.topKeywords[0].word);
        
        setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      } else { setError(data.error || '분석 중 오류가 발생했습니다.'); }
    } catch (err) { setError('서버 연결 실패. 나중에 다시 시도해 주세요.'); }
    finally { setLoading(false); }
  };

  const handleCompAnalysis = async () => {
      if (!compKeyword) return;
      setLoading(true);
      try {
          const res = await fetch(`${API_BASE_URL}/api/competitors`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ keyword: compKeyword })
          });
          const data = await res.json();
          setCompetitors(data.competitors);
          fetchRelatedKeywords(compKeyword);
      } catch (err) { alert('경쟁자 분석 실패'); }
      finally { setLoading(false); }
  };

  const handleTrackRank = async (kw: string, bUrl: string) => {
      setLoading(true);
      try {
          await fetch(`${API_BASE_URL}/api/rank/track`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ keyword: kw, url: bUrl })
          });
          fetchRankings();
      } catch (err) { alert('순위 추적 실패'); }
      finally { setLoading(false); }
  };

  const clearHistory = async () => {
    if (!confirm('모든 분석 히스토리를 삭제하시겠습니까?')) return;
    try {
        await fetch(`${API_BASE_URL}/api/history`, { method: 'DELETE' });
        setHistory([]);
        alert('히스토리가 삭제되었습니다.');
    } catch (err) { alert('삭제 실패'); }
  };

  const clearRankings = async () => {
    if (!confirm('모든 순위 추적 데이터를 삭제하시겠습니까?')) return;
    try {
        await fetch(`${API_BASE_URL}/api/rankings`, { method: 'DELETE' });
        setRankings([]);
        alert('순위 데이터가 삭제되었습니다.');
    } catch (err) { alert('삭제 실패'); }
  };

  const downloadReport = async () => {
    if (resultRef.current === null) return;
    setLoading(true);
    try {
      const canvas = await html2canvas(resultRef.current, {
        useCORS: true, allowTaint: false, backgroundColor: darkMode ? '#16171d' : '#fdfdfd', scale: 2, logging: false,
      });
      const dataUrl = canvas.toDataURL('image/png');
      download(dataUrl, `oh-blog-report-${new Date().getTime()}.png`);
      } catch (err) {
      alert('이미지 저장 중 오류가 발생했습니다.');
      } finally {
      setLoading(false);
      }
  };

  const generateAIFeedback = () => {
    if (!result) return "";
    const { charCount, imageCount, seoScore } = result;
    if (seoScore >= 90) return "완벽한 포스팅입니다! 현재 구조를 유지하며 꾸준히 발행하는 것이 가장 좋습니다.";
    if (charCount < 1000) return "분량이 조금 부족합니다. 500자 정도 더 보완해 보세요.";
    if (imageCount < 5) return "사진을 3~4장 더 추가하여 가독성을 높여보세요.";
    return "준수한 포스팅입니다. 키워드 빈도를 조금만 더 조절해 보세요.";
  };

  return (
    <div className={`dashboard-layout ${darkMode ? 'dark-mode' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-logo" onClick={() => { setCurrentView('analyze'); setResult(null); }}>
          <span className="logo-icon">🌿</span>
          <span className="logo-text">OH BLOG Pro</span>
        </div>
        <nav className="sidebar-nav">
          <button className={currentView === 'analyze' ? 'active' : ''} onClick={() => setCurrentView('analyze')}>
            <Search size={20} /> 정밀 분석
          </button>
          <button className={currentView === 'competitors' ? 'active' : ''} onClick={() => setCurrentView('competitors')}>
            <Users size={20} /> 경쟁자 비교
          </button>
          <button className={currentView === 'rankings' ? 'active' : ''} onClick={() => setCurrentView('rankings')}>
            <Trophy size={20} /> 순위 추적
          </button>
          <button className={currentView === 'history' ? 'active' : ''} onClick={() => setCurrentView('history')}>
            <History size={20} /> 분석 히스토리
          </button>
        </nav>
        <div className="sidebar-footer">
          <button className="theme-toggle" onClick={() => setDarkMode(!darkMode)}>
            {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            <span>{darkMode ? '라이트 모드' : '다크 모드'}</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        {currentView === 'analyze' && (
          <div className="analyze-view">
            <header className="view-header">
              <h1>블로그 정밀 분석</h1>
              <p>네이버 블로그 주소를 입력하여 SEO 점수를 확인하세요.</p>
            </header>
            
            <div className="search-card">
              <div className="input-group">
                <input 
                  type="text" 
                  placeholder="분석할 블로그 주소(URL)를 입력하세요" 
                  value={url} 
                  onChange={(e) => setUrl(e.target.value)} 
                />
              </div>
              <div className="keyword-input-area">
                <div className="tag-input">
                  <input 
                    type="text" 
                    placeholder="타겟 키워드 입력 (엔터)" 
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && addKeyword()}
                  />
                  <button onClick={() => addKeyword()}>추가</button>
                </div>
                <div className="keyword-tags">
                  {keywords.map(kw => (
                    <span key={kw} className="tag">
                      {kw} <button onClick={() => setKeywords(keywords.filter(k => k !== kw))}>×</button>
                    </span>
                  ))}
                </div>
              </div>
              <button className="analyze-btn" onClick={handleAnalyze} disabled={loading}>
                {loading ? <RefreshCw className="spin" /> : '분석 시작하기'}
              </button>
            </div>

            {error && <div className="error-msg">{error}</div>}

            {result && (
              <div className="result-container" ref={resultRef}>
                <div className="result-header">
                  <div className="score-circle">
                    <svg viewBox="0 0 36 36" className="circular-chart">
                      <path className="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                      <path className="circle" strokeDasharray={`${result.seoScore}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                    </svg>
                    <div className="percentage">{result.seoScore}</div>
                  </div>
                  <div className="title-area">
                    <h2>{result.title}</h2>
                    <div className="meta-info">
                       <span><FileText size={16}/> {result.charCount.toLocaleString()}자</span>
                       <span><ImageIcon size={16}/> {result.imageCount}장</span>
                    </div>
                  </div>
                  <button className="download-btn" onClick={downloadReport}><Download size={18}/> 리포트 저장</button>
                </div>

                <div className="feedback-card">
                   <h3><Sparkles size={18}/> AI 피드백</h3>
                   <p>{generateAIFeedback()}</p>
                </div>

                <div className="details-grid">
                  {result.seoDetails.map((detail, idx) => (
                    <div key={idx} className={`detail-item ${detail.status || ''}`}>
                      <div className="detail-header">
                        <span className="criterion">{detail.criterion}</span>
                        <span className="score">+{detail.score}</span>
                      </div>
                      <p className="message">{detail.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {currentView === 'competitors' && (
          <div className="competitors-view">
             <h1>경쟁자 비교 분석</h1>
             <div className="search-card">
                <input 
                  type="text" 
                  placeholder="비교할 키워드를 입력하세요" 
                  value={compKeyword} 
                  onChange={(e) => setCompKeyword(e.target.value)} 
                />
                <button onClick={handleCompAnalysis} disabled={loading}>분석</button>
             </div>
             <div className="comp-list">
                {competitors.map((c, i) => (
                  <div key={i} className="comp-item">
                    <span className="rank">{c.rank}위</span>
                    <div className="info">
                      <p className="title">{c.title}</p>
                      <p className="blog">{c.blogName}</p>
                    </div>
                    <div className="stats">
                      <span>{c.charCount}자</span>
                      <span>📷 {c.imgCount}</span>
                    </div>
                  </div>
                ))}
             </div>
          </div>
        )}

        {currentView === 'history' && (
          <div className="history-view">
            <div className="header-with-action">
                <h1>분석 히스토리</h1>
                <button className="clear-btn" onClick={clearHistory}><Trash2 size={16}/> 초기화</button>
            </div>
            <div className="history-list">
              {history.map(item => (
                <div key={item.id} className="history-item">
                  <div className="info">
                    <p className="title">{item.title}</p>
                    <p className="date">{new Date(item.created_at).toLocaleString()}</p>
                  </div>
                  <div className="stats">
                    <span className="score">{item.score}점</span>
                    <span>{item.char_count}자</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {currentView === 'rankings' && (
          <div className="rankings-view">
             <div className="header-with-action">
                <h1>순위 추적 기록</h1>
                <button className="clear-btn" onClick={clearRankings}><Trash2 size={16}/> 초기화</button>
             </div>
             <div className="rank-list">
                {rankings.map(r => (
                  <div key={r.id} className="rank-item">
                     <span className="rank-badge">{r.rank}위</span>
                     <div className="info">
                        <p className="kw">{r.keyword}</p>
                        <p className="url">{r.blog_url}</p>
                     </div>
                  </div>
                ))}
             </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
