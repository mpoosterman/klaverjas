'use strict';

const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const NORMAL_VALUES = { '7': 0, '8': 0, '9': 0, '10': 10, 'J': 2, 'Q': 3, 'K': 4, 'A': 11 };
const TRUMP_VALUES  = { '7': 0, '8': 0, '9': 14, '10': 10, 'J': 20, 'Q': 3, 'K': 4, 'A': 11 };
const TRUMP_ORDER   = ['J', '9', 'A', '10', 'K', 'Q', '8', '7'];
const NORMAL_ORDER  = ['A', '10', 'K', 'Q', 'J', '9', '8', '7'];

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
    if (c.suit === trump)    return { level: 2, order: TRUMP_ORDER.indexOf(c.rank) };
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

// Each player has 8 stacks of 2 cards.
// Stack index 0-3 = top row (left to right)
// Stack index 4-7 = bottom row (left to right)
// Each stack: [bottomCard, topCard]
// topCard is played first, then bottomCard flips up
function dealStacks(deck) {
  // 32 cards total, 16 per player, 8 stacks of 2
  const p0 = [];
  const p1 = [];
  for (let i = 0; i < 8; i++) {
    p0.push([deck[i * 2], deck[i * 2 + 1]]);       // [bottom, top]
    p1.push([deck[16 + i * 2], deck[16 + i * 2 + 1]]);
  }
  return [p0, p1];
}

// Initially only the top cards of the top row (stacks 0-3) are face-up
// Phase 1: top cards of stacks 0-3 visible (4 cards per player)
// Phase 2: top cards of stacks 4-7 also visible (8 cards total)
// After trump chosen: play begins

// Get all currently playable cards (face-up top cards)
function getPlayableCards(stacks) {
  const result = [];
  for (let i = 0; i < 8; i++) {
    const stack = stacks[i];
    if (!stack) continue;
    // Find top visible card
    if (stack.top !== null && stack.topFaceUp) {
      result.push({ card: stack.top, stackIndex: i, layer: 'top' });
    } else if (stack.top === null && stack.bottom !== null && stack.bottomFaceUp) {
      result.push({ card: stack.bottom, stackIndex: i, layer: 'bottom' });
    }
  }
  return result;
}

function validMoves(stacks, trick, trump) {
  const playable = getPlayableCards(stacks);
  if (trick.length === 0) return playable;

  const leadSuit = trick[0].card.suit;
  const hasSuit  = playable.filter(v => v.card.suit === leadSuit);
  const hasTrump = playable.filter(v => v.card.suit === trump);

  if (leadSuit === trump) return hasTrump.length > 0 ? hasTrump : playable;
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

  return playable;
}

function detectStukInTrick(trick, trump) {
  const cards = trick.map(t => t.card);
  const hasKing  = cards.some(c => c.suit === trump && c.rank === 'K');
  const hasQueen = cards.some(c => c.suit === trump && c.rank === 'Q');
  return hasKing && hasQueen;
}

module.exports = {
  SUITS, RANKS, TRUMP_ORDER, NORMAL_ORDER,
  createDeck, shuffleDeck, dealStacks,
  cardValue, trickWinner, trickPoints,
  getPlayableCards, validMoves, detectStukInTrick
};
