import axios from 'axios';

const API_BASE_URL = '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const searchService = {
  search: (query, alpha = 0.7, beta = 0.3, mode = 'union', limit = 10) => 
    api.get('/search', { params: { q: query, alpha, beta, mode, limit } }),
  
  getStats: () => api.get('/index/stats'),
};

export const crawlerService = {
  startCrawl: (seedURL, maxDepth = 2, maxPages = 50) => 
    api.post('/crawl', { seedURL, maxDepth, maxPages }),
  
  getPages: (page = 1, limit = 20) => 
    api.get('/crawl/pages', { params: { page, limit } }),
  
  getStats: () => api.get('/crawl/stats'),
  
  clearData: () => api.delete('/crawl/pages'),
};

export default api;
