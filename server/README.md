# 🕷️ Search Engine Crawler — Stage 1: Crawl

> **Pipeline**: `Crawl → Index → Rank`

A scalable BFS web crawler built with Node.js, Express, and MongoDB.
This service is the **data collection stage** of a full search engine pipeline.

---

## 📂 Project Structure

```
server/
├── index.js                  # Express entry point
├── .env                      # Environment variables
├── config/
│   └── db.js                 # MongoDB connection
├── crawler/
│   └── crawler.js            # BFS crawl engine (Queue + Set + AdjacencyList)
├── models/
│   └── Page.js               # Mongoose schema
├── controllers/
│   └── crawlController.js    # Request handlers
└── routes/
    └── crawlRoutes.js        # Express routes
```

---

## 🧠 DSA Design

| Structure | Type | Purpose |
|-----------|------|---------|
| **Queue** | `Array` (FIFO) | BFS frontier — ensures level-by-level traversal |
| **Set** | `Set` | Visited URLs — O(1) dedup lookup |
| **Map** | `Map` | Adjacency list — `url → [outbound links]` |

### BFS Algorithm

```
INIT:  queue ← [{url: seedUrl, depth: 0}]
       visited ← {seedUrl}

WHILE  queue not empty AND pages < maxPages:
  {url, depth} ← queue.DEQUEUE()          // O(1)
  IF depth > maxDepth → CONTINUE

  page ← fetch(url)                        // HTTP GET + cheerio parse
  links ← extractLinks(page)              // cheerio $('a[href]')

  FOR each link IN links:
    IF link NOT IN visited:               // O(1) Set lookup
      visited.ADD(link)
      queue.ENQUEUE({url: link, depth+1}) // expand frontier

  SAVE page TO MongoDB                    // upsert on url
```

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
cd server
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your MongoDB URI

# 3. Start MongoDB (if running locally)
mongod

# 4. Start the server
npm run dev          # with hot reload
npm start            # production
```

---

## 📡 API Reference

### `POST /api/crawl` — Start a crawl

```json
// Request body
{
  "seedURL":  "https://example.com",
  "maxDepth": 3,
  "maxPages": 50
}
```

```json
// Response
{
  "success": true,
  "stats": {
    "sessionId":    "sess_a1b2c3d4",
    "seedUrl":      "https://example.com",
    "totalCrawled": 42,
    "totalErrors":  2,
    "totalLinks":   381,
    "durationMs":   14520,
    "depthDistribution": { "0": 1, "1": 8, "2": 33 }
  },
  "pages": [ /* first 20 results */ ],
  "meta": {
    "fetchAllPages": "/api/crawl/sess_a1b2c3d4"
  }
}
```

---

### `GET /api/crawl/:sessionId` — Get session pages

```
GET /api/crawl/sess_a1b2c3d4?page=1&limit=20
```

---

### `GET /api/pages` — Browse all crawled pages

```
GET /api/pages?search=javascript&page=1&limit=20
```

---

### `GET /api/stats` — Aggregate statistics

```
GET /api/stats
```

---

### `DELETE /api/crawl/:sessionId` — Delete a session

```
DELETE /api/crawl/sess_a1b2c3d4
```

---

## 🗄️ MongoDB Schema

```js
{
  url:            String,   // unique, indexed
  title:          String,
  content:        String,   // first 5000 chars of body text
  links:          [String], // adjacency list (outbound links)
  depth:          Number,
  crawlSessionId: String,   // groups pages by crawl run
  statusCode:     Number,
  crawledAt:      Date,
  error:          String    // null if successful
}
```

**Indexes:**
- `{ url: 1 }` — unique, fast dedup
- `{ crawlSessionId: 1, depth: 1 }` — session queries
- `{ title: "text", content: "text" }` — full-text search (indexing stage)

---

## ⚙️ Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | Express server port |
| `MONGO_URI` | `mongodb://localhost:27017/search_engine_crawler` | MongoDB URI |
| `DEFAULT_MAX_DEPTH` | `3` | BFS depth limit |
| `DEFAULT_MAX_PAGES` | `50` | Max pages per crawl |
| `CRAWL_TIMEOUT_MS` | `10000` | Per-page timeout (ms) |

---

## 🔒 Constraints & Safety

- **Hard caps**: maxDepth ≤ 10, maxPages ≤ 200 (enforced server-side)
- **Timeout**: Configurable per-page HTTP timeout
- **De-duplication**: Set (in-memory) + MongoDB upsert (across restarts)
- **Content cap**: Only first 5000 chars of body text stored
- **Response size cap**: 5MB max per page (prevents memory spikes)
- **Error resilience**: Failed pages are recorded (not skipped) so stats remain accurate

---

## 🗺️ Pipeline Roadmap

```
Stage 1 (this service)  →  Stage 2 (Indexer)  →  Stage 3 (Ranker)
      Crawl                  Inverted Index          PageRank / TF-IDF
   /api/crawl                /api/index              /api/search
```
