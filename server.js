const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// Simple in-memory cache to respect NewsAPI rate limits
const cache = new Map();
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

// In-memory chat state
const chatHistory = [];
const MAX_HISTORY = 50;
const connectedUsers = new Map(); // socket.id -> user object

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

// Socket.io — real-time chat
io.on('connection', (socket) => {
  // Send recent history to the newly connected client
  if (chatHistory.length > 0) {
    socket.emit('load history', chatHistory);
  }

  socket.on('user joined', (user) => {
    connectedUsers.set(socket.id, user);
    io.emit('user list', Array.from(connectedUsers.values()));
  });

  socket.on('chat message', (data) => {
    chatHistory.push(data);
    if (chatHistory.length > MAX_HISTORY) chatHistory.shift();
    socket.broadcast.emit('chat message', data);
  });

  socket.on('typing', () => {
    const user = connectedUsers.get(socket.id);
    if (user) socket.broadcast.emit('typing', { id: socket.id, name: user.name });
  });

  socket.on('typing stop', () => {
    socket.broadcast.emit('typing stop', { id: socket.id });
  });

  socket.on('disconnect', () => {
    connectedUsers.delete(socket.id);
    io.emit('user list', Array.from(connectedUsers.values()));
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Xeno-Comm array is broadcasting on port ${PORT}!`);
  });
}

module.exports = app;
