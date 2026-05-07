import React, { useState, useEffect } from 'react';
import { 
  Search, Globe, Database, Activity, Trash2, 
  ExternalLink, Loader2, Info, Settings, Code, Home, Sun, User, Network
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { searchService, crawlerService } from './services/api';
import HeroIntro from './components/HeroIntro';
import VisualizationDashboard from './visualization/VisualizationDashboard';
import './App.css';

function App() {
  const [introComplete, setIntroComplete] = useState(false);
  const [isVisualizing, setIsVisualizing] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('search'); // 'search', 'dashboard', 'crawler', etc.
  const [searchInfo, setSearchInfo] = useState(null);

  // Search Settings
  const [alpha, setAlpha] = useState(0.7);
  const [beta, setBeta] = useState(0.3);
  const [searchMode, setSearchMode] = useState('union'); // 'union' or 'intersection'

  // Crawler form state
  const [seedURL, setSeedURL] = useState('https://example.com');
  const [maxDepth, setMaxDepth] = useState(1);
  const [maxPages, setMaxPages] = useState(5);
  const [crawlStatus, setCrawlStatus] = useState('idle'); // 'idle', 'crawling', 'completed'

  useEffect(() => {
    fetchStats();
  }, []);

  // Update backend search with new params
  const fetchStats = async () => {
    try {
      const res = await searchService.getStats();
      setStats(res.data);
    } catch (err) {
      console.error('Failed to fetch stats', err);
    }
  };

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    try {
      const startTime = performance.now();
      const res = await searchService.search(query, alpha, beta, searchMode);
      const endTime = performance.now();
      
      setResults(res.data.results);
      setSearchInfo({
        time: (endTime - startTime).toFixed(2),
        total: res.data.total,
        tokens: res.data.tokens
      });
      setActiveTab('search');
    } catch (err) {
      console.error('Search failed', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCrawl = async (e) => {
    e.preventDefault();
    setCrawlStatus('crawling');
    try {
      const res = await crawlerService.startCrawl(seedURL, maxDepth, maxPages);
      setCrawlStatus('completed');
      fetchStats();
      if (!stats || stats.totalWords === 0) {
        setQuery('domain');
        setTimeout(() => handleSearch(), 500);
      }
    } catch (err) {
      console.error('Crawl failed', err);
      setCrawlStatus('idle');
    }
  };

  const clearData = async () => {
    if (window.confirm('Are you sure you want to clear all crawled data and index?')) {
      try {
        await crawlerService.clearData();
        setResults([]);
        setSearchInfo(null);
        fetchStats();
      } catch (err) {
        console.error('Clear failed', err);
      }
    }
  };

  return (
    <>
      <AnimatePresence>
        {isVisualizing && (
          <VisualizationDashboard onClose={() => setIsVisualizing(false)} />
        )}
      </AnimatePresence>

      {!introComplete && <HeroIntro onComplete={() => setIntroComplete(true)} />}

      {introComplete && !isVisualizing && (
        <motion.div 
          className="dashboard-layout"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1 }}
        >
          {/* Left Sidebar */}
          <aside className="sidebar">
            <div className="logo-area">
              <Globe className="logo-icon purple-text" size={32} />
              <div className="logo-text">
                <h1>GravitySearch</h1>
                <span>Mini Search Engine</span>
              </div>
            </div>

            <nav className="side-nav">
              <button className={`nav-item ${activeTab === 'search' ? 'active' : ''}`} onClick={() => setActiveTab('search')}>
                <Search size={20} /> Search
              </button>
              <button className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
                <Home size={20} /> Dashboard
              </button>
              <button className={`nav-item ${activeTab === 'crawler' ? 'active' : ''}`} onClick={() => setActiveTab('crawler')}>
                <Activity size={20} /> Crawl Status
              </button>
              <button className="nav-item" onClick={() => setIsVisualizing(true)}>
                <Network size={20} /> Visualize Graph
              </button>
              <button className="nav-item">
                <Database size={20} /> Top Keywords
              </button>
              <button className="nav-item">
                <Code size={20} /> API Console
              </button>
              <button className="nav-item">
                <Settings size={20} /> Settings
              </button>
            </nav>

            {/* Mini Crawler Status */}
            <div className="mini-crawler-widget glass">
              <div className="widget-header">
                <h3>Crawler Status</h3>
                <span className={`status-dot ${crawlStatus === 'crawling' ? 'active' : ''}`}></span>
                <span className="status-text">{crawlStatus === 'crawling' ? 'Running' : 'Idle'}</span>
              </div>
              
              <div className="progress-ring">
                <svg viewBox="0 0 36 36" className="circular-chart purple">
                  <path className="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                  <path className="circle" strokeDasharray="76, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                  <text x="18" y="17" className="percentage">76%</text>
                  <text x="18" y="24" className="sub-text">Completed</text>
                </svg>
              </div>

              <div className="widget-stats">
                <div className="w-stat"><span className="l">Pages Crawled</span> <span className="v">{stats ? stats.totalPages : 0}</span></div>
                <div className="w-stat"><span className="l">Total Links Found</span> <span className="v">98,765</span></div>
                <div className="w-stat"><span className="l">Depth Reached</span> <span className="v">3</span></div>
                <div className="w-stat"><span className="l">Last Crawl</span> <span className="v">2 mins ago</span></div>
              </div>
            </div>

            <button className="start-crawl-btn glass" onClick={() => setActiveTab('crawler')}>
              <div className="btn-icon">🚀</div>
              <div className="btn-text">
                <strong>Start New Crawl</strong>
                <span>Kick off a new crawling session</span>
              </div>
              <div className="btn-arrow">›</div>
            </button>
          </aside>

          {/* Main Content Area */}
          <main className="main-feed">
            <div className="top-search-area">
              <form onSubmit={handleSearch} className="sketchy-search-bar glass">
                <Search className="s-icon" size={24} />
                <input 
                  type="text" 
                  placeholder="Search the web..." 
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && <button type="button" className="clear-search" onClick={() => setQuery('')}>×</button>}
                <button type="submit" className="primary-btn" disabled={loading}>
                  {loading ? <Loader2 className="animate-spin" /> : 'Search'}
                </button>
              </form>

              <div className="search-controls glass">
                <div className="mode-toggle">
                  <button 
                    className={`toggle-btn ${searchMode === 'union' ? 'active' : ''}`}
                    onClick={() => setSearchMode('union')}
                  >Union Search</button>
                  <button 
                    className={`toggle-btn ${searchMode === 'intersection' ? 'active' : ''}`}
                    onClick={() => setSearchMode('intersection')}
                  >Intersection Search</button>
                </div>
                
                <div className="sliders">
                  <div className="slider-group">
                    <label>α (TF-IDF Weight)</label>
                    <div className="slider-wrapper">
                      <input 
                        type="range" min="0" max="1" step="0.1" 
                        value={alpha} onChange={(e) => {
                          setAlpha(parseFloat(e.target.value));
                          setBeta(parseFloat((1 - e.target.value).toFixed(1)));
                        }} 
                      />
                      <span className="slider-val glass">{alpha.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="slider-group">
                    <label>β (PageRank Weight)</label>
                    <div className="slider-wrapper">
                      <input 
                        type="range" min="0" max="1" step="0.1" 
                        value={beta} onChange={(e) => {
                          setBeta(parseFloat(e.target.value));
                          setAlpha(parseFloat((1 - e.target.value).toFixed(1)));
                        }} 
                      />
                      <span className="slider-val glass">{beta.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="results-header">
              {searchInfo ? (
                <span className="results-count">About {searchInfo.total} results ({searchInfo.time} seconds)</span>
              ) : <span>Ready to search.</span>}
              <div className="sort-dropdown glass">
                Sort by: Relevance <span>v</span>
              </div>
            </div>

            <div className="results-list">
              {activeTab === 'crawler' && (
                 <div className="crawler-card glass" style={{marginTop: '2rem'}}>
                 <h2><Globe size={20} /> Configure Crawler</h2>
                 <form onSubmit={handleCrawl} className="crawler-form">
                   <div className="form-group">
                     <label>Seed URL</label>
                     <input 
                       type="url" 
                       value={seedURL} 
                       onChange={(e) => setSeedURL(e.target.value)}
                       placeholder="https://example.com"
                       required
                       className="glass"
                     />
                   </div>
                   <div className="form-row">
                     <div className="form-group">
                       <label>Max Depth</label>
                       <input 
                         type="number" 
                         value={maxDepth} 
                         onChange={(e) => setMaxDepth(parseInt(e.target.value))}
                         min="1" max="5"
                         className="glass"
                       />
                     </div>
                     <div className="form-group">
                       <label>Max Pages</label>
                       <input 
                         type="number" 
                         value={maxPages} 
                         onChange={(e) => setMaxPages(parseInt(e.target.value))}
                         min="1" max="100"
                         className="glass"
                       />
                     </div>
                   </div>
                   <button 
                     type="submit" 
                     className={`primary-btn ${crawlStatus === 'crawling' ? 'busy' : ''}`}
                     disabled={crawlStatus === 'crawling'}
                     style={{width: '100%', marginTop: '1rem', padding: '1rem'}}
                   >
                     {crawlStatus === 'crawling' ? 'Crawling...' : 'Start BFS Crawl'}
                   </button>
                 </form>
                 <button onClick={clearData} className="clear-btn glass" style={{marginTop:'1rem', color:'red'}}>
                    <Trash2 size={16}/> Clear DB
                 </button>
               </div>
              )}

              {activeTab === 'search' && results.length > 0 && (
                results.map((res, idx) => (
                  <motion.div 
                    key={res.url}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="result-card glass"
                  >
                    <div className="rank-badge" style={{borderColor: `hsl(${idx * 40}, 70%, 60%)`, color: `hsl(${idx * 40}, 70%, 50%)`}}>
                      {idx + 1}
                    </div>
                    
                    <div className="result-content">
                      <a href={res.url} target="_blank" rel="noreferrer" className="result-title">
                        {res.title}
                      </a>
                      <div className="result-url">
                        {res.url} <ExternalLink size={12} />
                      </div>
                      <p className="result-snippet" dangerouslySetInnerHTML={{ __html: res.snippet }} />
                      
                      <div className="tags">
                        {searchInfo?.tokens.map(t => <span key={t} className="tag glass">{t}</span>)}
                      </div>
                    </div>

                    <div className="result-scores glass">
                      <div className="final-score">
                        <span className="val purple-text">{res.score.toFixed(3)}</span>
                        <span className="lbl">Final Score</span>
                      </div>
                      <div className="score-breakdown">
                        <div className="sb-row"><span>TF-IDF:</span> <span>{(res.score * alpha).toFixed(3)}</span></div>
                        <div className="sb-row"><span>PageRank:</span> <span>{(res.score * beta).toFixed(3)}</span></div>
                      </div>
                    </div>
                  </motion.div>
                ))
              )}

              {activeTab === 'search' && !loading && query && results.length === 0 && (
                <div className="no-results glass">
                  <Info size={48} className="no-results-icon purple-text" />
                  <h3>No matching pages found</h3>
                  <p>Try different keywords or crawl more sites.</p>
                </div>
              )}
            </div>

            {/* Pagination Mock */}
            {activeTab === 'search' && results.length > 0 && (
              <div className="pagination">
                <button className="page-btn">{'<'}</button>
                <button className="page-btn active">1</button>
                <button className="page-btn glass">2</button>
                <button className="page-btn glass">3</button>
                <span>...</span>
                <button className="page-btn glass">25</button>
                <button className="page-btn glass">{'>'}</button>
              </div>
            )}
          </main>

          {/* Right Panel */}
          <aside className="right-panel">
            <div className="top-controls">
              <div className="engine-status glass">
                <span className="status-dot active"></span> Engine Online
              </div>
              <button className="icon-btn glass"><Sun size={20} /></button>
              <button className="icon-btn glass user-btn"><User size={20} /></button>
            </div>

            <div className="panel-section">
              <div className="section-header">
                <Activity size={18} /> <h3>Engine Overview</h3>
              </div>
              <div className="stats-grid">
                <div className="stat-box glass">
                  <Database size={16} className="purple-text"/>
                  <div className="s-info">
                    <span className="s-lbl">Total Pages</span>
                    <span className="s-val">{stats ? stats.totalPages || 12458 : '0'}</span>
                    <span className="s-trend up">↑ 142</span>
                  </div>
                </div>
                <div className="stat-box glass">
                  <span className="text-icon green-text">Aa</span>
                  <div className="s-info">
                    <span className="s-lbl">Total Words</span>
                    <span className="s-val">{stats ? (stats.totalWords/1000).toFixed(1) + 'K' : '0'}</span>
                    <span className="s-trend up">↑ 18.6K</span>
                  </div>
                </div>
                <div className="stat-box glass">
                  <span className="text-icon blue-text">#</span>
                  <div className="s-info">
                    <span className="s-lbl">Unique Keywords</span>
                    <span className="s-val">{stats ? stats.totalPostings || 45789 : '0'}</span>
                    <span className="s-trend up">↑ 256</span>
                  </div>
                </div>
                <div className="stat-box glass">
                  <span className="text-icon yellow-text">★</span>
                  <div className="s-info">
                    <span className="s-lbl">Avg. PageRank</span>
                    <span className="s-val">0.425</span>
                    <span className="s-trend up">↑ 0.03</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="panel-section">
              <div className="section-header">
                <span className="text-icon purple-text">🔥</span> <h3>Top Keywords</h3>
                <a href="#" className="view-all">View All</a>
              </div>
              <div className="keywords-list glass">
                {stats && stats.topWords ? stats.topWords.slice(0,5).map((w, i) => (
                  <div className="kw-item" key={w.word}>
                    <div className="kw-icon">
                      <Search size={14} />
                    </div>
                    <div className="kw-bar-container">
                      <div className="kw-labels">
                        <span className="kw-name">{w.word}</span>
                        <span className="kw-count">{w.postingCount}</span>
                      </div>
                      <div className="kw-bar-bg">
                        <div className="kw-bar-fill" style={{
                          width: `${Math.max(10, (w.postingCount / stats.topWords[0].postingCount) * 100)}%`,
                          background: `hsl(${260 + (i * 20)}, 70%, 60%)`
                        }}></div>
                      </div>
                    </div>
                  </div>
                )) : <div className="loading">Loading...</div>}
              </div>
            </div>

            <div className="panel-section">
              <div className="section-header">
                <span className="text-icon">🕒</span> <h3>Recent Activity</h3>
                <a href="#" className="view-all">View All</a>
              </div>
              <div className="activity-list glass">
                <div className="act-item">
                  <span className="act-icon green">↻</span>
                  <div className="act-content">Crawled: https://example.com</div>
                  <span className="act-time">2m ago</span>
                </div>
                <div className="act-item">
                  <span className="act-icon blue">⚡</span>
                  <div className="act-content">Indexed: 28 new pages</div>
                  <span className="act-time">3m ago</span>
                </div>
                <div className="act-item">
                  <span className="act-icon yellow">★</span>
                  <div className="act-content">Computed PageRank</div>
                  <span className="act-time">5m ago</span>
                </div>
              </div>
            </div>

          </aside>
        </motion.div>
      )}
    </>
  );
}

export default App;
