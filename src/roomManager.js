'use strict';

const {
  createDeck, shuffleDeck, dealTableLayout,
  initialFaceUp, flipBeneath,
  trickWinner, trickPoints, validMoves,
  detectRoem, totalRoemPoints
} = require('./gameLogic');

const rooms = new Map();

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function createRoom(hostSocketId, nickname) {
  const code = generateRoomCode();
  const room = {
    code,
    numPlayers: 2,
    players: [{ id: hostSocketId, nickname, team: 0 }],
    state: 'waiting',
    game: null
  };
  rooms.set(code, room);
  return room;
}

function joinRoom(code, socketId, nickname) {
  const room = rooms.get(code);
  if (!room) return { error: 'Kamer niet gevonden' };
  if (room.players.length >= 2) return { error: 'Kamer is vol' };
  if (room.state !== 'waiting') return { error: 'Spel is al begonnen' };
  if (room.players.some(p => p.nickname === nickname)) return { error: 'Naam al in gebruik' };

  room.players.push({ id: socketId, nickname, team: 1 });
  return { room };
}

function removePlayer(socketId) {
  for (const [code, room] of rooms.entries()) {
    const idx = room.players.findIndex(p => p.id === socketId);
    if (idx !== -1) {
      room.players.splice(idx, 1);
      if (room.players.length === 0) rooms.delete(code);
      return room;
    }
  }
  return null;
}

function getRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.players.some(p => p.id === socketId)) return room;
  }
  return null;
}

function startGame(room) {
  const deck = shuffleDeck(createDeck());
  const [layout0, layout1] = dealTableLayout(deck);

  // Phase 1: positions 12-15 of each player's top layer are face-up
  const faceUp0 = initialFaceUp();
  const faceUp1 = initialFaceUp();

  room.game = {
    layouts: [layout0, layout1],       // layout[p][0..15] = card or null if played
    faceUp: [faceUp0, faceUp1],        // faceUp[p][0..15] = bool
    phase: 1,                           // 1=first 4 revealed, 2=all top layer revealed, 3=playing
    trump: null,
    biddingPlayerIndex: 0,
    currentPlayerIndex: 0,
    trick: [],
    trickCount: 0,
    lastTrickWinner: null,
    pointsPerTeam: [0, 0],
    declaredRoem: [null, null],
    scores: [0, 0],
    playingTeam: null,
    roundHistory: []
  };

  room.state = 'bidding_phase1';
  return room;
}

function chooseTrump(room, playerIndex, suit) {
  const g = room.game;
  g.trump = suit;
  g.playingTeam = room.players[playerIndex].team;

  // Phase 2: reveal remaining top layer cards (positions 8-11)
  for (let p = 0; p < 2; p++) {
    for (let i = 8; i < 12; i++) {
      g.faceUp[p][i] = true;
    }
  }

  // Detect roem from all 8 visible top-layer cards per player
  for (let p = 0; p < 2; p++) {
    const visibleCards = g.layouts[p].filter((c, i) => g.faceUp[p][i] && c !== null);
    g.declaredRoem[p] = detectRoem(visibleCards, suit);
  }

  g.phase = 3;
  g.currentPlayerIndex = g.biddingPlayerIndex; // bidder leads first
  room.state = 'playing';
  return room;
}

function playCard(room, playerIndex, position) {
  const g = room.game;
  if (g.currentPlayerIndex !== playerIndex) return { error: 'Niet jouw beurt' };

  const layout = g.layouts[playerIndex];
  const faceUp = g.faceUp[playerIndex];

  if (!faceUp[position] || layout[position] === null) return { error: 'Kaart niet speelbaar' };

  const valid = validMoves(layout, faceUp, g.trick, g.trump);
  const isValid = valid.some(v => v.position === position);
  if (!isValid) return { error: 'Ongeldige kaart' };

  const card = layout[position];

  // Remove card from layout
  g.layouts[playerIndex][position] = null;

  // Flip card beneath
  g.faceUp[playerIndex] = flipBeneath(position, g.faceUp[playerIndex]);

  g.trick.push({ card, playerIndex, position });

  // Trick complete when both players have played
  if (g.trick.length === 2) {
    const winnerIdx = trickWinner(g.trick, g.trump);
    const pts = trickPoints(g.trick, g.trump);
    const winnerTeam = room.players[winnerIdx].team;

    g.pointsPerTeam[winnerTeam] += pts;
    g.lastTrickWinner = winnerIdx;
    g.trickCount++;

    const isLastTrick = g.trickCount === 16;
    if (isLastTrick) g.pointsPerTeam[winnerTeam] += 10;

    const completedTrick = [...g.trick];
    g.trick = [];
    g.currentPlayerIndex = winnerIdx;

    return { trickComplete: true, winnerIdx, completedTrick, roundOver: isLastTrick };
  }

  // Other player's turn
  g.currentPlayerIndex = 1 - playerIndex;
  return { trickComplete: false };
}

function finalizeRound(room) {
  const g = room.game;
  const playingTeam = g.playingTeam;
  const defendingTeam = 1 - playingTeam;

  const cardPts = [...g.pointsPerTeam];
  let roemByTeam = [0, 0];
  for (let i = 0; i < 2; i++) {
    roemByTeam[room.players[i].team] += totalRoemPoints(g.declaredRoem[i] || []);
  }

  const playingTeamWon = cardPts[playingTeam] > cardPts[defendingTeam];

  let roundScores = [0, 0];
  if (playingTeamWon) {
    roundScores[playingTeam]   = cardPts[playingTeam]   + roemByTeam[playingTeam];
    roundScores[defendingTeam] = cardPts[defendingTeam] + roemByTeam[defendingTeam];
  } else {
    // Playing team loses — all points go to defending team
    roundScores[defendingTeam] = cardPts[0] + cardPts[1] + roemByTeam[0] + roemByTeam[1];
    roundScores[playingTeam] = 0;
  }

  g.scores[0] += roundScores[0];
  g.scores[1] += roundScores[1];

  const summary = {
    playingTeam,
    playingTeamWon,
    cardPoints: cardPts,
    roemPoints: roemByTeam,
    roundScores,
    totalScores: [...g.scores],
    playerRoem: g.declaredRoem.map((roems, i) => ({
      nickname: room.players[i].nickname,
      roems: roems || []
    }))
  };

  g.roundHistory.push(summary);
  const gameOver = g.scores[0] >= 1500 || g.scores[1] >= 1500;
  room.state = gameOver ? 'gameEnd' : 'roundEnd';
  return summary;
}

function newRound(room) {
  const deck = shuffleDeck(createDeck());
  const [layout0, layout1] = dealTableLayout(deck);
  const faceUp0 = initialFaceUp();
  const faceUp1 = initialFaceUp();

  // Rotate bidding player
  const nextBidder = 1 - room.game.biddingPlayerIndex;

  room.game = {
    ...room.game,
    layouts: [layout0, layout1],
    faceUp: [faceUp0, faceUp1],
    phase: 1,
    trump: null,
    biddingPlayerIndex: nextBidder,
    currentPlayerIndex: nextBidder,
    trick: [],
    trickCount: 0,
    lastTrickWinner: null,
    pointsPerTeam: [0, 0],
    declaredRoem: [null, null],
    playingTeam: null
  };

  room.state = 'bidding_phase1';
  return room;
}

function getPublicState(room, forSocketId) {
  const myIndex = room.players.findIndex(p => p.id === forSocketId);
  const oppIndex = 1 - myIndex;
  const g = room.game;

  if (!g) {
    return {
      code: room.code,
      state: room.state,
      players: room.players.map(p => ({ nickname: p.nickname, isMe: p.id === forSocketId })),
      myIndex
    };
  }

  // Build layout view for each player
  // For my layout: show card if face-up, else show 'hidden', else null if played
  function layoutView(playerIdx, isMe) {
    return g.layouts[playerIdx].map((card, i) => {
      if (card === null) return null; // played/empty
      if (g.faceUp[playerIdx][i]) return { ...card, faceUp: true };
      return { faceUp: false }; // hidden
    });
  }

  // Valid moves for current player
  let myValidPositions = [];
  if (g.currentPlayerIndex === myIndex && room.state === 'playing') {
    const valid = validMoves(g.layouts[myIndex], g.faceUp[myIndex], g.trick, g.trump);
    myValidPositions = valid.map(v => v.position);
  }

  return {
    code: room.code,
    state: room.state,
    players: room.players.map((p, i) => ({
      nickname: p.nickname,
      team: p.team,
      isMe: p.id === forSocketId,
      cardsLeft: g.layouts[i].filter(c => c !== null).length
    })),
    myIndex,
    myLayout: layoutView(myIndex, true),
    oppLayout: layoutView(oppIndex, false),
    trump: g.trump,
    trick: g.trick,
    currentPlayerIndex: g.currentPlayerIndex,
    biddingPlayerIndex: g.biddingPlayerIndex,
    scores: g.scores,
    pointsPerTeam: g.pointsPerTeam,
    myRoem: g.declaredRoem[myIndex] || [],
    myValidPositions,
    lastTrickWinner: g.lastTrickWinner,
    trickCount: g.trickCount
  };
}

module.exports = {
  rooms,
  createRoom, joinRoom, removePlayer, getRoomBySocket,
  startGame, chooseTrump, playCard, finalizeRound, newRound,
  getPublicState
};
