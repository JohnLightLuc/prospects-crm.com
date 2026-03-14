// src/socket/socketHandler.js
const jwt = require('jsonwebtoken');

function initSocket(io) {
  // Authentification WebSocket via token JWT
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Token manquant'));
    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      next(new Error('Token invalide'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Connecté : ${socket.user.nom} (${socket.user.email})`);

    // Diffuser à tous les autres la connexion d'un utilisateur
    socket.broadcast.emit('user:connected', {
      nom:   socket.user.nom,
      email: socket.user.email,
      time:  new Date().toISOString(),
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Déconnecté : ${socket.user.nom}`);
      socket.broadcast.emit('user:disconnected', { nom: socket.user.nom });
    });

    // Typing indicator — un utilisateur est en train de saisir
    socket.on('prospect:typing', (data) => {
      socket.broadcast.emit('prospect:typing', { ...data, user: socket.user.nom });
    });
  });
}

module.exports = { initSocket };
