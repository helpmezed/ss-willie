const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Simple in-memory cache to respect NewsAPI rate limits
const cache = new Map();
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// News proxy endpoint — keeps API key server-side
app.get('/api/news', async (req, res) => {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'NEWS_API_KEY not set in environment.' });
  }

  const { q, category } = req.query;
  const cacheKey = `${q || 'top'}-${category || 'all'}`;

  if (cache.has(cacheKey) && (Date.now() - cache.get(cacheKey).timestamp < CACHE_DURATION)) {
    return res.json(cache.get(cacheKey).data);
  }

  let url = `https://newsapi.org/v2/top-headlines?language=en&pageSize=30&apiKey=${apiKey}`;
  if (q)        url += `&q=${encodeURIComponent(q)}`;
  if (category) url += `&category=${encodeURIComponent(category)}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data && data.status === 'ok') {
      cache.set(cacheKey, { timestamp: Date.now(), data });
    }
    res.json(data);
  } catch (err) {
    console.error('NewsAPI fetch error:', err);
    res.status(502).json({ error: 'Failed to fetch news from upstream.' });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Xeno-Comm array is broadcasting on port ${PORT}!`);
  });
}

module.exports = app;
