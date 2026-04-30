'use strict';

const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const NORMAL_VALUES = { '7': 0, '8': 0, '9': 0, '10': 10, 'J': 2, 'Q': 3, 'K': 4, 'A': 11 };
const TRUMP_VALUES  = { '7': 0, '8': 0, '9': 14, '10': 10, 'J': 20, 'Q': 3, 'K': 4, 'A': 11 };

const TRUMP_ORDER  = ['J', '9', 'A', '10', 'K', 'Q', '8', '7'];
const NORMAL_ORDER = ['A', '10', 'K', 'Q', 'J', '9', '8', '7'];

function createDeck() {
  const deck = [];
  for (const suit of SUITS)
    for (const rank of RANKS)
      deck.push({ suit, rank });
  return deck;
}

function shuffleDeck(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function cardValue(card, trump) {
  return card.suit === trump ? TRUMP_VALUES[card.rank] : NORMAL_VALUES[card.rank];
}

function trickWinner(trick, trump) {
  const lead = trick[0];
  const follow = trick[1];
  const leadSuit = lead.card.suit;

  function strength(c) {
    if (c.suit === trump) return { level: 2, order: TRUMP_ORDER.indexOf(c.rank) };
    if (c.suit === leadSuit) return { level: 1, order: NORMAL_ORDER.indexOf(c.rank) };
    return { level: 0, order: 99 };
  }

  const ls = strength(lead.card);
  const fs = strength(follow.card);

  if (fs.level > ls.level) return follow.playerIndex;
  if (fs.level === ls.level && fs.order < ls.order) return follow.playerIndex;
  return lead.playerIndex;
}

function trickPoints(trick, trump) {
  return trick.reduce((sum, { card }) => sum + cardValue(card, trump), 0);
}

// Each player has 16 cards laid out as:
// positions 0-3:   bottom layer, row 0 (furthest from player)
// positions 4-7:   bottom layer, row 1 (closer to player)
// positions 8-11:  top layer, row 0 (furthest from player)  <- revealed first (phase 1)
// positions 12-15: top layer, row 1 (closer to player)      <- revealed second (phase 2)
function dealTableLayout(deck) {
  return [deck.slice(0, 16), deck.slice(16, 32)];
}

// face-up status per position
// Phase 1: positions 12-15 revealed (top layer row 1 = closest row of top layer)
// Phase 2: positions 8-11 also revealed
// As cards are played from top layer, the bottom layer cards beneath them flip up
function initialFaceUp() {
  // positions 12-15 face up, rest face down
  return Array(16).fill(false).map((_, i) => i >= 12);
}

function validMoves(layout, faceUp, trick, trump) {
  // Collect all face-up cards with their positions
  const visible = [];
  for (let i = 0; i < 16; i++) {
    if (faceUp[i] && layout[i] !== null) {
      visible.push({ card: layout[i], position: i });
    }
  }

  if (trick.length === 0) return visible;

  const leadSuit = trick[0].card.suit;
  const hasSuit = visible.filter(v => v.card.suit === leadSuit);
  const hasTrump = visible.filter(v => v.card.suit === trump);

  if (leadSuit === trump) return hasTrump.length > 0 ? hasTrump : visible;
  if (hasSuit.length > 0) return hasSuit;

  if (hasTrump.length > 0) {
    const trumpInTrick = trick.filter(t => t.card.suit === trump);
    if (trumpInTrick.length > 0) {
      const highestTrump = trumpInTrick.reduce((best, t) =>
        TRUMP_ORDER.indexOf(t.card.rank) < TRUMP_ORDER.indexOf(best.card.rank) ? t : best
      );
      const overtrumps = hasTrump.filter(v =>
        TRUMP_ORDER.indexOf(v.card.rank) < TRUMP_ORDER.indexOf(highestTrump.card.rank)
      );
      return overtrumps.length > 0 ? overtrumps : hasTrump;
    }
    return hasTrump;
  }

  return visible;
}

// After a card at position p is played, flip the card beneath it if any
function flipBeneath(position, faceUp) {
  const newFaceUp = [...faceUp];
  // Top layer row 1 (12-15) sits on top of top layer row 0 (8-11)
  // Top layer row 0 (8-11) sits on top of bottom layer row 1 (4-7)
  // Bottom layer row 1 (4-7) sits on top of bottom layer row 0 (0-3)
  const beneath = position - 4; // each row is 4 cards, beneath is 4 positions lower
  if (beneath >= 0 && !newFaceUp[beneath]) {
    newFaceUp[beneath] = true;
  }
  return newFaceUp;
}

function detectRoem(cards, trump) {
  const roems = [];
  const nonNull = cards.filter(Boolean);

  const hasKing  = nonNull.some(c => c.suit === trump && c.rank === 'K');
  const hasQueen = nonNull.some(c => c.suit === trump && c.rank === 'Q');
  if (hasKing && hasQueen) roems.push({ type: 'stuk', points: 20, description: 'Heer + Vrouw van troef' });

  for (const suit of SUITS) {
    const suitCards = nonNull.filter(c => c.suit === suit).map(c => RANKS.indexOf(c.rank)).sort((a, b) => a - b);
    let seqStart = 0;
    while (seqStart < suitCards.length) {
      let seqEnd = seqStart;
      while (seqEnd + 1 < suitCards.length && suitCards[seqEnd + 1] === suitCards[seqEnd] + 1) seqEnd++;
      const len = seqEnd - seqStart + 1;
      if (len >= 3) {
        roems.push({ type: 'sequence', points: len >= 4 ? 50 : 20, suit, length: len, description: `Reeks van ${len} in ${suit}` });
      }
      seqStart = seqEnd + 1;
    }
  }

  for (const rank of RANKS) {
    const count = nonNull.filter(c => c.rank === rank).length;
    if (count === 3) roems.push({ type: 'three_of_a_kind', points: 20, rank, description: `Drie ${rank}s` });
    if (count === 4) roems.push({ type: 'four_of_a_kind', points: 50, rank, description: `Vier ${rank}s` });
  }

  return roems;
}

function totalRoemPoints(roems) {
  return roems.reduce((sum, r) => sum + r.points, 0);
}

module.exports = {
  SUITS, RANKS, TRUMP_ORDER, NORMAL_ORDER,
  createDeck, shuffleDeck, dealTableLayout,
  initialFaceUp, flipBeneath,
  cardValue, trickWinner, trickPoints,
  validMoves, detectRoem, totalRoemPoints
};
