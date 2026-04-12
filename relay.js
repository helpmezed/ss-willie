const express = require('express');
const Pusher  = require('pusher');
const fetch   = require('node-fetch');
const path    = require('path');
const jwt     = require('jsonwebtoken');
require('dotenv').config();

// ── Startup env check (values never logged) ─────────────────────────────────
console.log('[relay] env vars present:', {
  PUSHER_APP_ID:  !!process.env.PUSHER_APP_ID,
  PUSHER_KEY:     !!process.env.PUSHER_KEY,
  PUSHER_SECRET:  !!process.env.PUSHER_SECRET,
  PUSHER_CLUSTER: !!process.env.PUSHER_CLUSTER,
  NEWS_API_KEY:   !!process.env.NEWS_API_KEY,
  JWT_SECRET:     !!process.env.JWT_SECRET,
});

const app  = express();
const PORT = process.env.PORT || 3000;

// ── JWT secret ───────────────────────────────────────────────────────────────
// Set JWT_SECRET in .env for production — falls back to an ephemeral dev key.
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  const key = 'nexus-dev-' + Math.random().toString(36).slice(2);
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[relay] JWT_SECRET not set — using ephemeral dev key (restarts will invalidate tokens)');
  }
  return key;
})();
const JWT_TTL = '24h';

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true })); // required for Pusher auth

// ── Pusher client ────────────────────────────────────────────────────────────
const pusher = new Pusher({
  appId:   process.env.PUSHER_APP_ID,
  key:     process.env.PUSHER_KEY,
  secret:  process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER || 'mt1',
  useTLS:  true,
});
const CHANNEL = 'presence-chat-room';

// ── In-memory chat history ───────────────────────────────────────────────────
const chatHistory = [];
const MAX_HISTORY = 50;

// ── LRU news cache (max 20 entries, 15-min TTL per entry) ───────────────────
const newsCache    = new Map();
const CACHE_TTL    = 15 * 60 * 1000; // 15 minutes
const CACHE_MAX    = 20;

function cacheGet(key) {
  const entry = newsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) { newsCache.delete(key); return null; }
  // Refresh to most-recently-used position (LRU promotion)
  newsCache.delete(key);
  newsCache.set(key, entry);
  return entry.data;
}

function cacheSet(key, data) {
  if (newsCache.size >= CACHE_MAX) newsCache.delete(newsCache.keys().next().value); // evict LRU
  newsCache.set(key, { timestamp: Date.now(), data });
}

// ── Per-IP rate limiter (100 requests / 60 s) ────────────────────────────────
const rateLimitMap  = new Map();
const RATE_LIMIT    = 100;
const RATE_WINDOW   = 60 * 1000;

function rateLimit(req, res, next) {
  const ip  = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const rec = rateLimitMap.get(ip);

  if (!rec || now > rec.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return next();
  }
  if (rec.count >= RATE_LIMIT) {
    return res.status(429).json({ error: 'Too many requests — slow down.' });
  }
  rec.count++;
  next();
}

// Prune stale rate-limit records every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of rateLimitMap) { if (now > rec.resetAt) rateLimitMap.delete(ip); }
}, 5 * 60 * 1000);

// ── JWT middleware ───────────────────────────────────────────────────────────
function verifyJWT(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authorization required.' });
  try {
    req.nexusUser = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// ── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'terminal')));

// ── Public Pusher config ──────────────────────────────────────────────────────
app.get('/api/config', (_req, res) => {
  res.json({
    pusherKey:     process.env.PUSHER_KEY     || '',
    pusherCluster: process.env.PUSHER_CLUSTER || 'mt1',
  });
});

// ── Issue JWT session token ───────────────────────────────────────────────────
// The client calls this after login to obtain a Bearer token used on chat APIs.
app.post('/api/auth/token', rateLimit, (req, res) => {
  const { user_id, user_name, user_color } = req.body;
  if (!user_id || !user_name) {
    return res.status(400).json({ error: 'user_id and user_name are required.' });
  }
  // Advanced payload for NexusState synchronization
  const token = jwt.sign(
    { 
      userId: user_id, 
      username: user_name, 
      color: user_color || '#00e5ff',
      roles: ['operator'] 
    },
    JWT_SECRET,
    { expiresIn: JWT_TTL }
  );
  res.json({ token });
});

// ── Pusher channel auth (presence channels require server-side signing) ───────
app.post('/api/pusher/auth', (req, res) => {
  const { socket_id, channel_name, user_id, user_name, user_color } = req.body;
  if (!socket_id || !channel_name) {
    return res.status(400).json({ error: 'Missing socket_id or channel_name.' });
  }
  try {
    const auth = pusher.authorizeChannel(socket_id, channel_name, {
      user_id:   user_id   || 'anonymous',
      user_info: { name: user_name || 'Unknown', color: user_color || '#00e5ff' },
    });
    res.json(auth);
  } catch (e) {
    console.error('[pusher] auth error:', e);
    res.status(500).json({ error: 'Auth failed.' });
  }
});

// ── Chat message — JWT-protected, rate-limited ───────────────────────────────
app.post('/api/chat/message', rateLimit, verifyJWT, async (req, res) => {
  const data = req.body;
  if (!data?.user) return res.status(400).json({ error: 'Invalid message payload.' });

  chatHistory.push(data);
  if (chatHistory.length > MAX_HISTORY) chatHistory.shift();

  try {
    await pusher.trigger(CHANNEL, 'chat-message', data);
    res.json({ ok: true });
  } catch (e) {
    console.error('[pusher] trigger error:', e);
    res.status(502).json({ error: 'Pusher relay error.' });
  }
});

// ── Chat history for new joiners ─────────────────────────────────────────────
app.get('/api/chat/history', (_req, res) => res.json(chatHistory));

// ── Typing indicators — JWT-protected, rate-limited ─────────────────────────
app.post('/api/chat/typing', rateLimit, verifyJWT, async (req, res) => {
  try { await pusher.trigger(CHANNEL, 'typing', req.body); res.json({ ok: true }); }
  catch { res.status(502).json({ error: 'Pusher relay error.' }); }
});

app.post('/api/chat/typing-stop', rateLimit, verifyJWT, async (req, res) => {
  try { await pusher.trigger(CHANNEL, 'typing-stop', req.body); res.json({ ok: true }); }
  catch { res.status(502).json({ error: 'Pusher relay error.' }); }
});

// ── News proxy — rate-limited, LRU-cached ────────────────────────────────────
app.get('/api/news', rateLimit, async (req, res) => {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'NEWS_API_KEY not set in environment.' });

  const { q, category } = req.query;
  const cacheKey = `${q || 'top'}-${category || 'all'}`;
  const cached   = cacheGet(cacheKey);
  if (cached) return res.set('X-Cache', 'HIT').json(cached);

  let url = `https://newsapi.org/v2/top-headlines?country=us&language=en&pageSize=30&apiKey=${apiKey}`;
  if (q)        url += `&q=${encodeURIComponent(q)}`;
  if (category) url += `&category=${encodeURIComponent(category)}`;

  try {
    const response = await fetch(url);
    const data     = await response.json();
    console.log('[news] upstream:', { status: data?.status, code: data?.code, count: data?.articles?.length });
    if (data?.status === 'ok') cacheSet(cacheKey, data);
    res.set('X-Cache', 'MISS').json(data);
  } catch (err) {
    console.error('[news] fetch error:', err);
    res.status(502).json({ error: 'Failed to fetch news from upstream.' });
  }
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`[relay] Xeno-Comm array broadcasting on port ${PORT}`));
}

module.exports = app;
