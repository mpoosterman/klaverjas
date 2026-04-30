'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const {
  createRoom, joinRoom, removePlayer, getRoomBySocket,
  startGame, chooseTrump, playCard, finalizeRound, newRound,
  getPublicState
} = require('./roomManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '../public')));

function broadcast(room) {
  room.players.forEach(p => {
    const socket = io.sockets.sockets.get(p.id);
    if (socket) socket.emit('gameState', getPublicState(room, p.id));
  });
}

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('createRoom', ({ nickname, numPlayers }, cb) => {
    const room = createRoom(socket.id, nickname, numPlayers);
    socket.join(room.code);
    cb({ code: room.code, state: getPublicState(room, socket.id) });
    broadcast(room);
  });

  socket.on('joinRoom', ({ code, nickname }, cb) => {
    const result = joinRoom(code.toUpperCase(), socket.id, nickname);
    if (result.error) return cb({ error: result.error });
    const room = result.room;
    socket.join(room.code);
    cb({ state: getPublicState(room, socket.id) });
    broadcast(room);

    // Auto-start when room is full
    if (room.players.length === room.numPlayers) {
      startGame(room);
      broadcast(room);
      io.to(room.code).emit('message', { text: 'All players joined — game starting!' });
    }
  });

  socket.on('chooseTrump', ({ suit }, cb) => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.state !== 'bidding') return cb && cb({ error: 'Cannot choose trump now' });
    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex !== room.game.biddingPlayerIndex) return cb && cb({ error: 'Not your turn to bid' });

    chooseTrump(room, playerIndex, suit);
    io.to(room.code).emit('message', { text: `${room.players[playerIndex].nickname} chose ${suit} as trump` });
    broadcast(room);
    cb && cb({});
  });

  socket.on('playCard', ({ card }, cb) => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.state !== 'playing') return cb && cb({ error: 'Cannot play now' });
    const playerIndex = room.players.findIndex(p => p.id === socket.id);

    const result = playCard(room, playerIndex, card);
    if (result.error) return cb && cb({ error: result.error });

    broadcast(room);

    if (result.trickComplete) {
      const winnerName = room.players[result.winnerIdx].nickname;
      io.to(room.code).emit('trickComplete', {
        winnerIdx: result.winnerIdx,
        winnerName,
        trick: result.completedTrick
      });

      if (result.roundOver) {
        const summary = finalizeRound(room);
        io.to(room.code).emit('roundOver', summary);
        broadcast(room);
      }
    }

    cb && cb({});
  });

  socket.on('newRound', (cb) => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.state !== 'roundEnd') return cb && cb({ error: 'Cannot start new round now' });
    newRound(room);
    broadcast(room);
    cb && cb({});
  });

  socket.on('disconnect', () => {
    const room = removePlayer(socket.id);
    if (room) {
      io.to(room.code).emit('message', { text: 'A player disconnected. Game paused.' });
      broadcast(room);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Klaverjas running on http://localhost:${PORT}`));
