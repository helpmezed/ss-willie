const express = require('express');
const Pusher = require('pusher');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

// Startup env check — logs true/false only, never the actual values
console.log('[relay] env vars present:', {
  PUSHER_APP_ID:  !!process.env.PUSHER_APP_ID,
  PUSHER_KEY:     !!process.env.PUSHER_KEY,
  PUSHER_SECRET:  !!process.env.PUSHER_SECRET,
  PUSHER_CLUSTER: !!process.env.PUSHER_CLUSTER,
  NEWS_API_KEY:   !!process.env.NEWS_API_KEY,
  MONGODB_URI:    !!process.env.MONGODB_URI,
  JWT_SECRET:     !!process.env.JWT_SECRET,
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true })); // required for Pusher auth requests
app.use(cookieParser());

// Database Setup
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('[relay] Connected to MongoDB'))
  .catch(err => console.error('[relay] MongoDB connection error:', err));

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  color: { type: String, default: '#00e5ff' }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

// Auth Middleware
const authenticate = async (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

const generateTokenAndSetCookie = (res, userId) => {
  const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000
  });
};

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

// Authentication Endpoints
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  try {
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) return res.status(400).json({ error: 'Username or email already in use' });

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = new User({ 
      username, 
      email, 
      password: hashedPassword,
      color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')
    });
    await user.save();

    generateTokenAndSetCookie(res, user._id);
    res.status(201).json({ id: user._id, username: user.username, color: user.color });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    generateTokenAndSetCookie(res, user._id);
    res.json({ id: user._id, username: user.username, color: user.color });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({ id: req.user._id, username: req.user.username, color: req.user.color });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// Pusher auth endpoint — required for presence channels (user lists)
app.post('/api/pusher/auth', authenticate, (req, res) => {
  const { socket_id, channel_name } = req.body;
  if (!socket_id || !channel_name) {
    return res.status(400).json({ error: 'Missing socket_id or channel_name' });
  }
  try {
    const auth = pusher.authorizeChannel(socket_id, channel_name, {
      user_id:   req.user._id.toString(),
      user_info: { name: req.user.username, color: req.user.color }
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
