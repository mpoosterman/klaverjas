'use strict';

const { v4: uuidv4 } = require('uuid');
const {
  createDeck, shuffleDeck, dealCards,
  trickWinner, trickPoints, validCards,
  detectRoem, totalRoemPoints
} = require('./gameLogic');

const rooms = new Map();

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function createRoom(hostSocketId, nickname, numPlayers) {
  const code = generateRoomCode();
  const room = {
    code,
    numPlayers,
    players: [{ id: hostSocketId, nickname, team: 0 }],
    state: 'waiting', // waiting | bidding | playing | roundEnd | gameEnd
    game: null
  };
  rooms.set(code, room);
  return room;
}

function joinRoom(code, socketId, nickname) {
  const room = rooms.get(code);
  if (!room) return { error: 'Room not found' };
  if (room.players.length >= room.numPlayers) return { error: 'Room is full' };
  if (room.state !== 'waiting') return { error: 'Game already started' };
  if (room.players.some(p => p.nickname === nickname)) return { error: 'Nickname already taken' };

  // Assign teams: 0,1,0,1 for 4p; 0,1,0 for 3p (team 0 has 2 members); 0,1 for 2p
  const team = room.players.length % 2;
  room.players.push({ id: socketId, nickname, team });
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
  const n = room.players.length;
  const deck = shuffleDeck(createDeck());
  const hands = dealCards(deck, n);

  // Detect roem for each player upfront
  // Trump is not chosen yet — roem is declared after trump is chosen
  room.game = {
    hands,
    trump: null,
    biddingPlayerIndex: 0,  // first player bids
    currentPlayerIndex: 0,
    trick: [],
    tricksWon: Array(n).fill(0),
    pointsPerTeam: [0, 0],
    roemPerTeam: [0, 0],
    declaredRoem: Array(n).fill(null), // roem per player once trump known
    trickCount: 0,
    lastTrickWinner: null,
    scores: [0, 0],  // cumulative game scores per team
    playingTeam: null,  // team that bid
    bidValue: null,
    roundHistory: []
  };
  room.state = 'bidding';
  return room;
}

function chooseTrump(room, playerIndex, suit) {
  const g = room.game;
  g.trump = suit;
  g.playingTeam = room.players[playerIndex].team;
  g.currentPlayerIndex = 0; // player 0 leads first trick

  // Now detect roem for all players
  for (let i = 0; i < room.players.length; i++) {
    g.declaredRoem[i] = detectRoem(g.hands[i], suit);
  }

  room.state = 'playing';
  return room;
}

function playCard(room, playerIndex, card) {
  const g = room.game;
  if (g.currentPlayerIndex !== playerIndex) return { error: 'Not your turn' };

  const hand = g.hands[playerIndex];
  const valid = validCards(hand, g.trick, g.trump);
  const isValid = valid.some(c => c.suit === card.suit && c.rank === card.rank);
  if (!isValid) return { error: 'Invalid card' };

  // Remove from hand
  const cardIdx = hand.findIndex(c => c.suit === card.suit && c.rank === card.rank);
  hand.splice(cardIdx, 1);

  g.trick.push({ card, playerIndex });

  // Trick complete?
  if (g.trick.length === room.players.length) {
    const winnerIdx = trickWinner(g.trick, g.trump);
    const pts = trickPoints(g.trick, g.trump);
    const winnerTeam = room.players[winnerIdx].team;

    g.tricksWon[winnerIdx]++;
    g.pointsPerTeam[winnerTeam] += pts;
    g.lastTrickWinner = winnerIdx;
    g.trickCount++;

    const isLastTrick = g.trickCount === Math.floor(32 / room.players.length);
    if (isLastTrick) {
      g.pointsPerTeam[winnerTeam] += 10; // last trick bonus
    }

    const completedTrick = [...g.trick];
    g.trick = [];
    g.currentPlayerIndex = winnerIdx;

    if (isLastTrick) {
      return { trickComplete: true, winnerIdx, completedTrick, roundOver: true };
    }

    return { trickComplete: true, winnerIdx, completedTrick, roundOver: false };
  }

  // Next player
  g.currentPlayerIndex = (playerIndex + 1) % room.players.length;
  return { trickComplete: false };
}

function finalizeRound(room) {
  const g = room.game;
  const n = room.players.length;

  // Calculate roem per team
  // If playing team wins, they keep their roem; defending gets theirs
  // If playing team loses, ALL roem goes to defending team
  const totalCardPoints = [0, 1].map(team => g.pointsPerTeam[team]);
  const playingTeam = g.playingTeam;
  const defendingTeam = 1 - playingTeam;

  // Sum roem per team
  let roemByTeam = [0, 0];
  for (let i = 0; i < n; i++) {
    const team = room.players[i].team;
    roemByTeam[team] += totalRoemPoints(g.declaredRoem[i] || []);
  }

  // Determine if playing team won (more card points)
  const playingTeamWon = totalCardPoints[playingTeam] > totalCardPoints[defendingTeam];

  let roundScores = [0, 0];
  if (playingTeamWon) {
    roundScores[playingTeam]  = totalCardPoints[playingTeam]  + roemByTeam[playingTeam];
    roundScores[defendingTeam] = totalCardPoints[defendingTeam] + roemByTeam[defendingTeam];
  } else {
    // Playing team lost — their roem transfers to defending team
    roundScores[defendingTeam] = totalCardPoints[playingTeam] + totalCardPoints[defendingTeam]
                                + roemByTeam[playingTeam] + roemByTeam[defendingTeam];
    roundScores[playingTeam] = 0;
  }

  g.scores[0] += roundScores[0];
  g.scores[1] += roundScores[1];

  const summary = {
    playingTeam,
    playingTeamWon,
    cardPoints: totalCardPoints,
    roemPoints: roemByTeam,
    roundScores,
    totalScores: [...g.scores],
    playerRoem: g.declaredRoem.map((roems, i) => ({
      nickname: room.players[i].nickname,
      roems: roems || []
    }))
  };

  g.roundHistory.push(summary);

  // Check game end (first to 1500, or after agreed rounds)
  const gameOver = g.scores[0] >= 1500 || g.scores[1] >= 1500;
  room.state = gameOver ? 'gameEnd' : 'roundEnd';

  return summary;
}

function newRound(room) {
  const n = room.players.length;
  const deck = shuffleDeck(createDeck());
  const hands = dealCards(deck, n);

  // Rotate bidding player
  const nextBidder = (room.game.biddingPlayerIndex + 1) % n;

  room.game = {
    ...room.game,
    hands,
    trump: null,
    biddingPlayerIndex: nextBidder,
    currentPlayerIndex: 0,
    trick: [],
    tricksWon: Array(n).fill(0),
    pointsPerTeam: [0, 0],
    roemPerTeam: [0, 0],
    declaredRoem: Array(n).fill(null),
    trickCount: 0,
    lastTrickWinner: null,
    playingTeam: null,
    bidValue: null
  };
  room.state = 'bidding';
  return room;
}

function getPublicState(room, forSocketId) {
  const myIndex = room.players.findIndex(p => p.id === forSocketId);
  const g = room.game;

  return {
    code: room.code,
    state: room.state,
    numPlayers: room.numPlayers,
    players: room.players.map((p, i) => ({
      nickname: p.nickname,
      team: p.team,
      isMe: p.id === forSocketId,
      tricksWon: g ? g.tricksWon[i] : 0,
      cardCount: g ? g.hands[i].length : 0
    })),
    myIndex,
    myHand: g && myIndex >= 0 ? g.hands[myIndex] : [],
    trump: g ? g.trump : null,
    trick: g ? g.trick : [],
    currentPlayerIndex: g ? g.currentPlayerIndex : null,
    biddingPlayerIndex: g ? g.biddingPlayerIndex : null,
    scores: g ? g.scores : [0, 0],
    pointsPerTeam: g ? g.pointsPerTeam : [0, 0],
    myRoem: g && myIndex >= 0 ? (g.declaredRoem[myIndex] || []) : [],
    lastTrickWinner: g ? g.lastTrickWinner : null
  };
}

module.exports = {
  rooms,
  createRoom, joinRoom, removePlayer, getRoomBySocket,
  startGame, chooseTrump, playCard, finalizeRound, newRound,
  getPublicState
};
