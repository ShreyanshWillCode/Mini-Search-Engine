import React, { useState, useEffect } from 'react';
import { Search, Globe, Database, Activity, Trash2, ChevronRight, ExternalLink, Loader2, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { searchService, crawlerService } from './services/api';
import './App.css';

function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('search'); // 'search' or 'crawler'
  const [searchInfo, setSearchInfo] = useState(null);

  // Crawler form state
  const [seedURL, setSeedURL] = useState('https://example.com');
  const [maxDepth, setMaxDepth] = useState(1);
  const [maxPages, setMaxPages] = useState(5);
  const [crawlStatus, setCrawlStatus] = useState('idle'); // 'idle', 'crawling', 'completed'

  useEffect(() => {
    fetchStats();
  }, []);

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
      const res = await searchService.search(query);
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
      // Auto-switch to search to see results if it's the first crawl
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
    <div className="app">
      <header className="header">
        <div className="container header-content">
          <div className="logo">
            <Globe className="logo-icon" />
            <h1 className="text-gradient">GravitySearch</h1>
          </div>
          <nav className="nav">
            <button 
              className={`nav-btn ${activeTab === 'search' ? 'active' : ''}`}
              onClick={() => setActiveTab('search')}
            >
              Search
            </button>
            <button 
              className={`nav-btn ${activeTab === 'crawler' ? 'active' : ''}`}
              onClick={() => setActiveTab('crawler')}
            >
              Crawler
            </button>
            <button className="nav-btn clear-btn" onClick={clearData}>
              <Trash2 size={16} />
            </button>
          </nav>
        </div>
      </header>

      <main className="container main-content">
        <AnimatePresence mode="wait">
          {activeTab === 'search' ? (
            <motion.section 
              key="search-view"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="search-section"
            >
              <div className="search-container glass glow-shadow">
                <form onSubmit={handleSearch} className="search-form">
                  <Search className="search-icon" size={24} />
                  <input 
                    type="text" 
                    placeholder="Search the indexed web..." 
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="search-input"
                  />
                  <button type="submit" className="search-submit" disabled={loading}>
                    {loading ? <Loader2 className="animate-spin" /> : 'Search'}
                  </button>
                </form>
              </div>

              {searchInfo && (
                <div className="search-meta animate-fade-in">
                  <span>Found {searchInfo.total} results in {searchInfo.time}ms</span>
                  <div className="token-chips">
                    {searchInfo.tokens.map(t => <span key={t} className="token-chip">{t}</span>)}
                  </div>
                </div>
              )}

              <div className="results-list">
                {results.length > 0 ? (
                  results.map((res, idx) => (
                    <motion.div 
                      key={res.url}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="result-item glass"
                    >
                      <div className="result-header">
                        <a href={res.url} target="_blank" rel="noreferrer" className="result-title">
                          {res.title}
                        </a>
                        <span className="result-score">Score: {res.score}</span>
                      </div>
                      <div className="result-url">{res.url}</div>
                      <p className="result-snippet" dangerouslySetInnerHTML={{ __html: res.snippet }} />
                      <div className="result-footer">
                        <a href={res.url} target="_blank" rel="noreferrer" className="visit-link">
                          Visit Page <ExternalLink size={12} />
                        </a>
                      </div>
                    </motion.div>
                  ))
                ) : !loading && query && (
                  <div className="no-results glass">
                    <Info size={48} className="no-results-icon" />
                    <h3>No matching pages found</h3>
                    <p>Try different keywords or crawl more sites in the Crawler tab.</p>
                  </div>
                )}
              </div>
            </motion.section>
          ) : (
            <motion.section 
              key="crawler-view"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="crawler-section"
            >
              <div className="crawler-grid">
                <div className="crawler-card glass">
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
                        />
                      </div>
                      <div className="form-group">
                        <label>Max Pages</label>
                        <input 
                          type="number" 
                          value={maxPages} 
                          onChange={(e) => setMaxPages(parseInt(e.target.value))}
                          min="1" max="100"
                        />
                      </div>
                    </div>
                    <button 
                      type="submit" 
                      className={`crawl-submit ${crawlStatus === 'crawling' ? 'busy' : ''}`}
                      disabled={crawlStatus === 'crawling'}
                    >
                      {crawlStatus === 'crawling' ? (
                        <>
                          <Loader2 className="animate-spin" size={18} />
                          Crawling...
                        </>
                      ) : 'Start BFS Crawl'}
                    </button>
                    {crawlStatus === 'completed' && (
                      <p className="status-msg success">Crawl completed successfully!</p>
                    )}
                  </form>
                </div>

                <div className="stats-card glass">
                  <h2><Activity size={20} /> Engine Stats</h2>
                  {stats ? (
                    <div className="stats-list">
                      <div className="stat-item">
                        <span className="stat-label">Total Unique Words</span>
                        <span className="stat-value">{stats.totalWords}</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Total Postings</span>
                        <span className="stat-value">{stats.totalPostings}</span>
                      </div>
                      <div className="top-words">
                        <span className="stat-label">Most Frequent Keywords</span>
                        <div className="word-tags">
                          {stats.topWords.map(w => (
                            <div key={w.word} className="word-tag">
                              {w.word} <span>({w.postingCount})</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="loading-stats">
                      <Loader2 className="animate-spin" />
                      Loading stats...
                    </div>
                  )}
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      <footer className="footer">
        <div className="container">
          <p>© 2026 GravitySearch Engine · BFS Crawler · TF-IDF Indexer</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
