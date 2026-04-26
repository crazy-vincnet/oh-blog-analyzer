import { useState, useRef, useEffect } from 'react'
import html2canvas from 'html2canvas'
import download from 'downloadjs'
import { History, Users, Search, Settings, ArrowLeft, Download, RefreshCw, BarChart2, Award, Info, AlertTriangle, Trash2, Zap, ExternalLink, Moon, Sun, Sparkles, MessageSquare, Tag } from 'lucide-react'
import './App.css'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

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
