// src/server.js
require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');

const authRoutes      = require('./routes/auth');
const prospectsRoutes = require('./routes/prospects');
const reportsRoutes   = require('./routes/reports');
const { initSocket }  = require('./socket/socketHandler');
const { startReminderCron } = require('./services/reminderService');

const app    = express();
const server = http.createServer(app);

// ── Socket.io ───────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  }
});
app.set('io', io); // accessible dans les routes via req.app.get('io')
initSocket(io);

// ── Middlewares ─────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public')); // servir le frontend CRM

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use('/api/', limiter);

// ── Routes ──────────────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/prospects', prospectsRoutes);
app.use('/api',           reportsRoutes);

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// ── Démarrage ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 ProSpect CRM Backend démarré`);
  console.log(`   Port     : ${PORT}`);
  console.log(`   Env      : ${process.env.NODE_ENV}`);
  console.log(`   Frontend : ${process.env.FRONTEND_URL}`);
  console.log(`   API      : http://localhost:${PORT}/api\n`);
  startReminderCron();
});
