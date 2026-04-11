const express = require('express');
const Pusher = require('pusher');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config();

// Startup env check — logs true/false only, never the actual values
console.log('[relay] env vars present:', {
  PUSHER_APP_ID:  !!process.env.PUSHER_APP_ID,
  PUSHER_KEY:     !!process.env.PUSHER_KEY,
  PUSHER_SECRET:  !!process.env.PUSHER_SECRET,
  PUSHER_CLUSTER: !!process.env.PUSHER_CLUSTER,
  NEWS_API_KEY:   !!process.env.NEWS_API_KEY,
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true })); // required for Pusher auth requests

const pusher = new Pusher({
  appId:   process.env.PUSHER_APP_ID,
  key:     process.env.PUSHER_KEY,
  secret:  process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER || 'mt1',
  useTLS:  true
});

const CHANNEL = 'presence-chat-room';

// In-memory chat history — ephemeral on serverless, fine for a side project
const chatHistory = [];
const MAX_HISTORY = 50;

// In-memory news cache
const newsCache = new Map();
const CACHE_DURATION = 15 * 60 * 1000;

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'terminal')));

// Expose public Pusher config to the browser
app.get('/api/config', (_req, res) => {
  res.json({
    pusherKey:     process.env.PUSHER_KEY     || '',
    pusherCluster: process.env.PUSHER_CLUSTER || 'mt1'
  });
});

// Pusher auth endpoint — required for presence channels (user lists)
app.post('/api/pusher/auth', (req, res) => {
  const { socket_id, channel_name, user_id, user_name } = req.body;
  if (!socket_id || !channel_name) {
    return res.status(400).json({ error: 'Missing socket_id or channel_name' });
  }
  try {
    const auth = pusher.authorizeChannel(socket_id, channel_name, {
      user_id:   user_id   || 'anonymous',
      user_info: { name: user_name || 'Unknown' }
    });
    res.json(auth);
  } catch (e) {
    console.error('Pusher auth error:', e);
    res.status(500).json({ error: 'Auth failed' });
  }
});

// Chat message — broadcast via Pusher, store in history
app.post('/api/chat/message', async (req, res) => {
  const data = req.body;
  if (!data || !data.user) return res.status(400).json({ error: 'Invalid message' });

  chatHistory.push(data);
  if (chatHistory.length > MAX_HISTORY) chatHistory.shift();

  try {
    await pusher.trigger(CHANNEL, 'chat-message', data);
    res.json({ ok: true });
  } catch (e) {
    console.error('Pusher trigger error:', e);
    res.status(502).json({ error: 'Pusher error' });
  }
});

// Recent chat history for new joiners
app.get('/api/chat/history', (_req, res) => {
  res.json(chatHistory);
});

// Typing indicators
app.post('/api/chat/typing', async (req, res) => {
  try {
    await pusher.trigger(CHANNEL, 'typing', req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: 'Pusher error' });
  }
});

app.post('/api/chat/typing-stop', async (req, res) => {
  try {
    await pusher.trigger(CHANNEL, 'typing-stop', req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: 'Pusher error' });
  }
});

// News proxy — keeps API key server-side
app.get('/api/news', async (req, res) => {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'NEWS_API_KEY not set in environment.' });
  }

  const { q, category } = req.query;
  const cacheKey = `${q || 'top'}-${category || 'all'}`;

  if (newsCache.has(cacheKey) && (Date.now() - newsCache.get(cacheKey).timestamp < CACHE_DURATION)) {
    return res.json(newsCache.get(cacheKey).data);
  }

  let url = `https://newsapi.org/v2/top-headlines?country=us&language=en&pageSize=30&apiKey=${apiKey}`;
  if (q)        url += `&q=${encodeURIComponent(q)}`;
  if (category) url += `&category=${encodeURIComponent(category)}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    console.log('[news] NewsAPI response:', { status: data?.status, code: data?.code, message: data?.message, articleCount: data?.articles?.length });
    if (data && data.status === 'ok') {
      newsCache.set(cacheKey, { timestamp: Date.now(), data });
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
