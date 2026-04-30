'use strict';

const {
  createDeck, shuffleDeck, dealStacks,
  trickWinner, trickPoints, validMoves,
  getPlayableCards, detectRoem, totalRoemPoints
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

// Build initial stacks for a player from dealStacks output
// stacks[i] = [bottomCard, topCard]
// We store as { bottom, top, bottomFaceUp, topFaceUp }
function buildStacks(rawStacks, phase) {
  return rawStacks.map((pair, i) => ({
    bottom: pair[0],
    top: pair[1],
    bottomFaceUp: false,
    // Phase 1: top row (0-3) top cards face up; phase 2: all top cards face up
    topFaceUp: phase === 2 ? true : i < 4
  }));
}

function startGame(room) {
  const deck = shuffleDeck(createDeck());
  const [raw0, raw1] = dealStacks(deck);

  room.game = {
    stacks: [buildStacks(raw0, 1), buildStacks(raw1, 1)],
    phase: 1,
    trump: null,
    biddingPlayerIndex: 0,
    currentPlayerIndex: 0,
    trick: [],
    pendingFlips: [],   // stack indices per player to flip after trick resolved
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

  // Phase 2: reveal top cards of bottom row (stacks 4-7) for both players
  for (let p = 0; p < 2; p++) {
    for (let i = 4; i < 8; i++) {
      g.stacks[p][i].topFaceUp = true;
    }
  }
  g.phase = 2;

  // Detect roem from all 8 visible top cards per player
  for (let p = 0; p < 2; p++) {
    const visibleCards = g.stacks[p]
      .filter(s => s.topFaceUp && s.top !== null)
      .map(s => s.top);
    g.declaredRoem[p] = detectRoem(visibleCards, suit);
  }

  g.currentPlayerIndex = g.biddingPlayerIndex;
  room.state = 'playing';
  return room;
}

function playCard(room, playerIndex, stackIndex) {
  const g = room.game;
  if (g.currentPlayerIndex !== playerIndex) return { error: 'Niet jouw beurt' };

  const stacks = g.stacks[playerIndex];
  const stack = stacks[stackIndex];

  // Determine which layer is being played
  let layer = null;
  if (stack.top !== null && stack.topFaceUp) layer = 'top';
  else if (stack.top === null && stack.bottom !== null && stack.bottomFaceUp) layer = 'bottom';

  if (!layer) return { error: 'Geen speelbare kaart op deze positie' };

  const valid = validMoves(stacks, g.trick, g.trump);
  const isValid = valid.some(v => v.stackIndex === stackIndex);
  if (!isValid) return { error: 'Ongeldige kaart' };

  const card = layer === 'top' ? stack.top : stack.bottom;

  // Remove card from stack
  if (layer === 'top') {
    stack.top = null;
    stack.topFaceUp = false;
    // Bottom card will flip AFTER the trick is resolved
  } else {
    stack.bottom = null;
    stack.bottomFaceUp = false;
  }

  g.trick.push({ card, playerIndex, stackIndex, layer });

  if (g.trick.length === 2) {
    const winnerIdx = trickWinner(g.trick, g.trump);
    const pts = trickPoints(g.trick, g.trump);
    const winnerTeam = room.players[winnerIdx].team;

    g.pointsPerTeam[winnerTeam] += pts;
    g.lastTrickWinner = winnerIdx;
    g.trickCount++;

    const isLastTrick = g.trickCount === 16;
    if (isLastTrick) g.pointsPerTeam[winnerTeam] += 10;

    // NOW flip bottom cards beneath played top cards
    for (const played of g.trick) {
      if (played.layer === 'top') {
        const s = g.stacks[played.playerIndex][played.stackIndex];
        if (s.bottom !== null) {
          s.bottomFaceUp = true;
        }
      }
    }

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
    roundScores[defendingTeam] = cardPts[0] + cardPts[1] + roemByTeam[0] + roemByTeam[1];
    roundScores[playingTeam] = 0;
  }

  g.scores[0] += roundScores[0];
  g.scores[1] += roundScores[1];

  const summary = {
    playingTeam, playingTeamWon,
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
  room.state = (g.scores[0] >= 1500 || g.scores[1] >= 1500) ? 'gameEnd' : 'roundEnd';
  return summary;
}

function newRound(room) {
  const deck = shuffleDeck(createDeck());
  const [raw0, raw1] = dealStacks(deck);
  const nextBidder = 1 - room.game.biddingPlayerIndex;

  room.game = {
    ...room.game,
    stacks: [buildStacks(raw0, 1), buildStacks(raw1, 1)],
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
  const myIndex  = room.players.findIndex(p => p.id === forSocketId);
  const oppIndex = 1 - myIndex;
  const g = room.game;

  if (!g) {
    return {
      code: room.code, state: room.state,
      players: room.players.map(p => ({ nickname: p.nickname, isMe: p.id === forSocketId })),
      myIndex
    };
  }

  // Build stack view: for my stacks show full info; for opp show only face-up top card
  function stackView(stacks) {
    return stacks.map(s => ({
      topFaceUp:    s.topFaceUp,
      top:          s.topFaceUp && s.top ? { ...s.top } : (s.top ? { hidden: true } : null),
      bottomFaceUp: s.bottomFaceUp,
      bottom:       s.bottomFaceUp && s.bottom ? { ...s.bottom } : (s.bottom ? { hidden: true } : null),
      empty:        s.top === null && s.bottom === null
    }));
  }

  let myValidStacks = [];
  if (g.currentPlayerIndex === myIndex && room.state === 'playing') {
    const valid = validMoves(g.stacks[myIndex], g.trick, g.trump);
    myValidStacks = valid.map(v => v.stackIndex);
  }

  return {
    code: room.code,
    state: room.state,
    players: room.players.map((p, i) => ({
      nickname: p.nickname, team: p.team,
      isMe: p.id === forSocketId,
      cardsLeft: g.stacks[i].reduce((n, s) => n + (s.top ? 1 : 0) + (s.bottom ? 1 : 0), 0)
    })),
    myIndex,
    myStacks:  stackView(g.stacks[myIndex]),
    oppStacks: stackView(g.stacks[oppIndex]),
    trump: g.trump,
    trick: g.trick,
    currentPlayerIndex: g.currentPlayerIndex,
    biddingPlayerIndex: g.biddingPlayerIndex,
    scores: g.scores,
    pointsPerTeam: g.pointsPerTeam,
    myRoem: g.declaredRoem[myIndex] || [],
    myValidStacks,
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
