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
    const user = socket.user;
    const room = user.role === 'superadmin'
      ? 'company:superadmin'
      : `company:${user.company_id}`;

    socket.join(room);
    console.log(`🔌 Connecté : ${user.nom} (${user.email}) → ${room}`);

    socket.to(room).emit('user:connected', {
      nom:   user.nom,
      email: user.email,
      time:  new Date().toISOString(),
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Déconnecté : ${user.nom}`);
      socket.to(room).emit('user:disconnected', { nom: user.nom });
    });

    // Typing indicator — un utilisateur est en train de saisir
    socket.on('prospect:typing', (data) => {
      socket.to(room).emit('prospect:typing', { ...data, user: user.nom });
    });
  });
}

module.exports = { initSocket };
