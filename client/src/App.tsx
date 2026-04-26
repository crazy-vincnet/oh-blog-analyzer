import { useState, useRef, useEffect } from 'react'
import html2canvas from 'html2canvas'
import download from 'downloadjs'
import { History, Users, Search, Settings, ArrowLeft, Download, RefreshCw, BarChart2, Award, Info, AlertTriangle, Trash2, Zap, ExternalLink, Moon, Sun, Sparkles, MessageSquare, Tag } from 'lucide-react'
import './App.css'

// ... (interfaces remain the same)
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
  imageMetadata?: { index: number; isOriginal: boolean; model: string }[];
  topKeywords: { word: string; count: number }[];
  customKeywordsResults: KeywordResult[];
  seoScore: number;
  seoDetails: SeoDetail[];
  url: string;
}

type View = 'analyze' | 'history' | 'competitors' | 'rankings' | 'settings';

function App() {
  const [currentView, setCurrentView] = useState<View>('analyze');
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('theme') === 'dark');
  const [url, setUrl] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [relatedKeywords, setRelatedKeywords] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [rankings, setRankings] = useState<RankingItem[]>([]);
  const [compKeyword, setCompKeyword] = useState('');
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  
  const resultRef = useRef<HTMLDivElement>(null);

  // Dark Mode Effect
  useEffect(() => {
    if (darkMode) {
        document.documentElement.classList.add('dark-mode');
        localStorage.setItem('theme', 'dark');
    } else {
        document.documentElement.classList.remove('dark-mode');
        localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  useEffect(() => {
      if (currentView === 'history') fetchHistory();
      if (currentView === 'rankings') fetchRankings();
  }, [currentView]);

  const fetchHistory = async () => {
      try {
          const res = await fetch('http://localhost:5001/api/history');
          const data = await res.json();
          setHistory(data);
      } catch (err) { console.error('History fetch failed'); }
  };

  const fetchRankings = async () => {
      try {
          const res = await fetch('http://localhost:5001/api/rankings');
          const data = await res.json();
          setRankings(data);
      } catch (err) { console.error('Rankings fetch failed'); }
  };

  const fetchRelatedKeywords = async (keyword: string) => {
    try {
        const res = await fetch('http://localhost:5001/api/related-keywords', {
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
      const response = await fetch('http://localhost:5001/api/analyze', {
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
          const res = await fetch('http://localhost:5001/api/competitors', {
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
          await fetch('http://localhost:5001/api/rank/track', {
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
        await fetch('http://localhost:5001/api/history', { method: 'DELETE' });
        setHistory([]);
        alert('히스토리가 삭제되었습니다.');
    } catch (err) { alert('삭제 실패'); }
  };

  const clearRankings = async () => {
    if (!confirm('모든 순위 추적 데이터를 삭제하시겠습니까?')) return;
    try {
        await fetch('http://localhost:5001/api/rankings', { method: 'DELETE' });
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

  // Content Feedback AI Logic (Internal)
  const generateAIFeedback = () => {
    if (!result) return "";
    const { charCount, imageCount, seoScore } = result;
    if (seoScore >= 90) return "완벽한 포스팅입니다! 현재 구조를 유지하며 꾸준히 발행하는 것이 가장 좋습니다. 제목의 키워드 경쟁력만 정기적으로 체크하세요.";
    if (charCount < 1000) return "전체적인 글의 분량이 부족합니다. 정보성 내용을 500자 정도 더 보완하면 네이버 알고리즘이 '전문성' 있는 글로 판단할 확률이 높습니다.";
    if (imageCount < 5) return "시각 자료가 너무 적습니다. 글의 흐름에 맞는 사진이나 도표를 3~4장 더 추가하여 체류 시간을 늘려보세요.";
    if (seoScore < 50) return "키워드 배치가 불규칙합니다. 제목의 키워드가 본문 도입부와 결론부에도 자연스럽게 포함되었는지 다시 한번 확인해 보세요.";
    return "준수한 포스팅입니다. 다만 경쟁사들에 비해 특정 키워드의 반복 횟수가 적을 수 있으니 상위 노출 키워드를 문맥에 맞게 1~2회 더 추가해 보세요.";
  };

  return (
    <div className={`dashboard-layout ${darkMode ? 'dark-mode' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-logo" onClick={() => { setCurrentView('analyze'); setResult(null); window.scrollTo(0,0); }} style={{cursor: 'pointer'}}>
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
            <BarChart2 size={20} /> 순위 추적기
          </button>
          <button className={currentView === 'history' ? 'active' : ''} onClick={() => setCurrentView('history')}>
            <History size={20} /> 히스토리
          </button>
          <button className={currentView === 'settings' ? 'active' : ''} onClick={() => setCurrentView('settings')}>
            <Settings size={20} /> 설정
          </button>
        </nav>
        <div className="sidebar-footer">
          <button className="theme-toggle" onClick={() => setDarkMode(!darkMode)}>
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            {darkMode ? '라이트 모드' : '다크 모드'}
          </button>
          <p className="version-info">v1.1.0 AI Edition</p>
        </div>
      </aside>

      <main className="main-viewport">
        {currentView === 'settings' && (
          <div className="view-container animate-in">
            <header className="view-header">
                <h1>설정 및 관리</h1>
                <p>로컬 데이터 관리 및 애플리케이션 설정을 변경합니다.</p>
            </header>
            
            <div className="settings-grid">
                <div className="settings-card card-item shadow-soft">
                    <div className="settings-info">
                        <Trash2 className="icon-red" size={24} />
                        <div className="text">
                            <h4>분석 히스토리 삭제</h4>
                            <p>내 컴퓨터에 저장된 모든 포스팅 분석 기록을 영구히 삭제합니다.</p>
                        </div>
                    </div>
                    <button className="btn-danger" onClick={clearHistory}>전체 삭제</button>
                </div>

                <div className="settings-card card-item shadow-soft">
                    <div className="settings-info">
                        <Zap className="icon-orange" size={24} />
                        <div className="text">
                            <h4>순위 데이터 초기화</h4>
                            <p>추적 중인 키워드 및 블로그 순위 데이터를 모두 삭제합니다.</p>
                        </div>
                    </div>
                    <button className="btn-danger" onClick={clearRankings}>데이터 초기화</button>
                </div>

                <div className="settings-card card-item shadow-soft">
                    <div className="settings-info">
                        <Info className="icon-blue" size={24} />
                        <div className="text">
                            <h4>앱 정보</h4>
                            <p>OH BLOG Pro v1.1.0 (AI & Related Search)</p>
                        </div>
                    </div>
                    <div className="app-status">정상 가동 중</div>
                </div>
            </div>
          </div>
        )}

        {currentView === 'analyze' && (
          <div className="view-container">
            {!result ? (
              <section className="check-card shadow-soft animate-in">
                <div className="view-header">
                    <h1>AI 정밀 분석</h1>
                    <p>내 포스팅의 경쟁력을 데이터로 확인하세요.</p>
                </div>
                <div className="input-section">
                  <div className="input-group">
                    <label>블로그 포스팅 주소</label>
                    <input type="text" placeholder="https://blog.naver.com/..." value={url} onChange={(e) => setUrl(e.target.value)} />
                  </div>
                  <div className="input-group">
                    <label>타겟 키워드 (다중 입력)</label>
                    <div className="kw-entry-wrapper">
                      <input type="text" placeholder="키워드 입력 후 +" value={keywordInput} onChange={(e) => setKeywordInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addKeyword()} />
                      <button className="btn-add-mini" onClick={() => addKeyword()}>+</button>
                    </div>
                    <div className="tags-display">
                      {keywords.map((kw, i) => (
                        <span key={i} className="kw-tag">{kw}<button onClick={() => setKeywords(keywords.filter((_, idx) => idx !== i))}>&times;</button></span>
                      ))}
                    </div>
                  </div>
                  <button className={`btn-check ${loading ? 'is-analyzing' : ''}`} onClick={handleAnalyze} disabled={loading}>
                    {loading ? '분석 중...' : '데이터 분석 시작'}
                  </button>
                  {error && <p className="error-text">{error}</p>}
                </div>
              </section>
            ) : (
              <div ref={resultRef} className="analysis-result-area animate-in">
                <div className="result-top-bar">
                    <button className="btn-back" onClick={() => setResult(null)}><ArrowLeft size={18}/> 돌아가기</button>
                    <button className="btn-save-img" onClick={downloadReport}><Download size={18}/> PNG 저장</button>
                </div>

                <div className="result-intro-card shadow-soft">
                  <div className="score-main">
                    <div className="score-circle-big" style={{'--score': result.seoScore} as any}>
                        <div className="inner"><span className="val">{result.seoScore}</span><span className="unit">점</span></div>
                    </div>
                    <div className="score-summary">
                        <h2>SEO 분석 리포트</h2>
                        <p className="post-title-display">"{result.title}"</p>
                        <div className="trust-meter">
                            {result.seoScore >= 80 ? '👑 상위 노출 마스터' : result.seoScore >= 50 ? '⚖️ 경쟁력 확보 중' : '⚠️ 집중 개선 필요'}
                        </div>
                    </div>
                  </div>
                </div>

                <div className="stats-row">
                  <div className="stat-box detailed shadow-soft">
                    <div className="stat-main">
                      <span className="stat-icon">✍️</span>
                      <div className="stat-info">
                        <div className="stat-row-compact">
                          <label>전체 (공백포함)</label>
                          <span className="val-small">{result.charDetails.totalWithSpaces.toLocaleString()}자</span>
                        </div>
                        <div className="stat-row-compact main">
                          <label>순수 (공백제외)</label>
                          <span className="val-large">{result.charCount.toLocaleString()}자</span>
                        </div>
                      </div>
                    </div>

                    <div className="char-breakdown">
                      <div className="breakdown-item"><span>한글</span> <b>{result.charDetails.korean}</b></div>
                      <div className="breakdown-item"><span>영어</span> <b>{result.charDetails.english}</b></div>
                      <div className="breakdown-item"><span>숫자</span> <b>{result.charDetails.number}</b></div>
                      <div className="breakdown-item"><span>기타</span> <b>{result.charDetails.special}</b></div>
                    </div>
                  </div>
                  <div className="stat-box shadow-soft">
                    <span className="stat-icon">📸</span>
                    <div className="stat-info"><label>이미지 자산</label><div className="val">{result.imageCount}<span>장</span></div></div>
                  </div>
                </div>

                {/* Related Keywords Section */}
                <div className="card-item shadow-soft related-section">
                    <div className="card-header"><h3><Tag size={20} className="icon-orange" /> 네이버 연관 검색어 추천</h3></div>
                    <div className="related-tags-cloud">
                        {relatedKeywords.map((rk, i) => (
                            <button key={i} className="related-kw-btn" onClick={() => addKeyword(rk)}>
                                {rk} <span className="plus">+</span>
                            </button>
                        ))}
                        {relatedKeywords.length === 0 && <p className="empty-msg">연관된 키워드를 찾고 있습니다...</p>}
                    </div>
                    <p className="help-text-mini">* 키워드를 클릭하면 분석 대상에 즉시 추가됩니다.</p>
                </div>

                <div className="detail-cards">
                  <div className="card-item shadow-soft">
                    <h3>최빈 키워드 분석</h3>
                    <div className="simple-list">
                      {result.topKeywords.slice(0, 5).map((tk, i) => (
                        <div key={i} className="list-row">
                          <span className="rank">{i+1}</span>
                          <span className="word">{tk.word}</span>
                          <div className="bar-track-mini"><div className="fill" style={{width: `${(tk.count / result.topKeywords[0].count) * 100}%`}}></div></div>
                          <span className="count">{tk.count}번</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="card-item shadow-soft">
                    <h3>타겟 키워드 진단</h3>
                    <div className="keyword-check-list">
                      {result.customKeywordsResults.map((ck, i) => (
                        <div key={i} className="kw-check-item">
                          <div className="kw-check-info">
                            <span className="name">{ck.keyword}</span>
                            <span className={`badge ${ck.inTitle ? 'in' : 'out'}`}>{ck.inTitle ? '제목 포함' : '제목 누락'}</span>
                          </div>
                          <div className="kw-meter-row">
                              <div className="kw-meter-track"><div className="fill" style={{width: `${Math.min(ck.count * 20, 100)}%`}}></div></div>
                              <div className="count"><b>{ck.count}</b>번</div>
                          </div>
                        </div>
                      ))}
                      {result.customKeywordsResults.length === 0 && <p className="empty-msg">따로 확인한 키워드가 없어요.</p>}
                    </div>
                  </div>
                </div>

                {result.images.length > 0 && (
                  <div className="image-slider-section card-item shadow-soft">
                    <div className="card-header"><h3>수집된 이미지 분석</h3> {result.imageMetadata && result.imageMetadata.length > 0 && <span className="badge-original">원본 감지</span>}</div>
                    <div className="image-slider">
                      {result.images.map((img, i) => (
                        <div key={i} className="slide-item" onClick={() => setSelectedImage(img)}><img src={img} alt="captured" loading="lazy" /></div>
                      ))}
                    </div>
                  </div>
                )}

                {/* AI Guide & Feedback Section (Moved to bottom) */}
                <div className="ai-feedback-grid">
                    <div className="card-item roadmap-card shadow-soft ai-guide-box">
                        <div className="card-header">
                            <h3><Sparkles size={20} className="icon-blue" /> AI 본문 솔루션 가이드</h3>
                            <span className="badge-ai">LIVE AI</span>
                        </div>
                        <div className="ai-content-box">
                            <div className="ai-speech-bubble">
                                <MessageSquare className="icon-muted" size={16} />
                                <p>{generateAIFeedback()}</p>
                            </div>
                        </div>
                        <div className="tips-list">
                            {result.seoDetails.map((detail: any, i: number) => (
                            <div key={i} className={`tip-item ${detail.status}`}>
                                <div className="tip-head">
                                    <span className="tip-marker">
                                        {detail.status === 'good' ? <Award size={20} className="icon-green" /> : 
                                        detail.status === 'bad' ? <AlertTriangle size={20} className="icon-red" /> : 
                                        <Info size={20} className="icon-orange" />}
                                    </span>
                                    <h4>{detail.criterion}</h4>
                                    <div className="tip-score">{detail.score > 0 ? `+${detail.score}` : '0'}</div>
                                </div>
                                <p>{detail.message}</p>
                            </div>
                            ))}
                        </div>
                    </div>
                </div>
              </div>
            )}
          </div>
        )}

        {currentView === 'competitors' && (
            <div className="view-container animate-in">
                <header className="view-header">
                    <h1>경쟁자 비교 분석</h1>
                    <p>현재 1위 글의 글자수와 사진 개수를 내 글과 비교해 보세요.</p>
                </header>
                <div className="comp-input-box card-item shadow-soft">
                    <input type="text" placeholder="검색 키워드를 입력하세요" value={compKeyword} onChange={(e) => setCompKeyword(e.target.value)} />
                    <button onClick={handleCompAnalysis} disabled={loading}>{loading ? '수집 중...' : 'TOP 5 수집하기'}</button>
                </div>

                <div className="comp-grid">
                    {competitors.map((c, idx) => (
                        <div key={idx} className="comp-card shadow-soft">
                            <div className="c-rank">#{c.rank}</div>
                            <div className="c-info">
                                <h4>{c.title}</h4>
                                <p>{c.blogName}</p>
                                <div className="c-stats">
                                    <span>글자수: <b>{c.charCount}</b></span>
                                    <span>이미지: <b>{c.imgCount}</b></span>
                                </div>
                            </div>
                            <button className="btn-track-this" onClick={() => handleTrackRank(compKeyword, c.url)}>추적하기</button>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {currentView === 'rankings' && (
            <div className="view-container animate-in">
                <header className="view-header">
                    <h1>실시간 순위 추적</h1>
                    <p>등록한 키워드에서 내 블로그의 현재 순위를 모니터링합니다.</p>
                </header>
                <div className="rankings-list">
                    {rankings.map((r) => (
                        <div key={r.id} className="rank-item card-item shadow-soft">
                            <div className="r-kw">{r.keyword}</div>
                            <div className="r-actions-main">
                                <span className="r-url-text" title={r.blog_url}>{r.blog_url.substring(0, 30)}...</span>
                                <a href={r.blog_url} target="_blank" rel="noopener noreferrer" className="btn-visit-blog">
                                    <ExternalLink size={14} /> 방문
                                </a>
                            </div>
                            <div className={`r-val ${r.rank <= 3 ? 'top' : ''}`}>{r.rank === 99 ? '10위권 밖' : `${r.rank}위`}</div>
                            <button className="btn-refresh-rank" onClick={() => handleTrackRank(r.keyword, r.blog_url)} title="순위 새로고침">
                                <RefreshCw size={16}/>
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {currentView === 'history' && (
          <div className="view-container animate-in">
            <header className="view-header"><h1>분석 히스토리</h1><p>과거 분석 데이터를 관리합니다.</p></header>
            <div className="history-grid">
                {history.map((item) => (
                    <div key={item.id} className="history-card shadow-soft">
                        <div className="h-score">{item.score}<span>pts</span></div>
                        <div className="h-info">
                            <h4>{item.title}</h4>
                            <div className="h-meta"><span>{item.char_count}자</span><span>{item.img_count}장</span><span>{new Date(item.created_at).toLocaleDateString()}</span></div>
                        </div>
                        <button className="btn-h-re" onClick={() => {setUrl(item.url); setCurrentView('analyze');}}>재분석</button>
                    </div>
                ))}
            </div>
          </div>
        )}
      </main>

      {selectedImage && (
        <div className="modal-overlay" onClick={() => setSelectedImage(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <img src={selectedImage} alt="Large" />
            <button className="btn-close-modal" onClick={() => setSelectedImage(null)}>&times;</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
