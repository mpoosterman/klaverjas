'use strict';

const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// Point values for non-trump cards
const NORMAL_VALUES = { '7': 0, '8': 0, '9': 0, '10': 10, 'J': 2, 'Q': 3, 'K': 4, 'A': 11 };
// Point values for trump cards
const TRUMP_VALUES  = { '7': 0, '8': 0, '9': 14, '10': 10, 'J': 20, 'Q': 3, 'K': 4, 'A': 11 };

// Trump rank order (highest to lowest)
const TRUMP_ORDER = ['J', '9', 'A', '10', 'K', 'Q', '8', '7'];
// Normal rank order (highest to lowest)
const NORMAL_ORDER = ['A', '10', 'K', 'Q', 'J', '9', '8', '7'];

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
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

function dealCards(deck, numPlayers) {
  const hands = Array.from({ length: numPlayers }, () => []);
  deck.forEach((card, i) => hands[i % numPlayers].push(card));
  return hands;
}

function cardValue(card, trump) {
  return card.suit === trump ? TRUMP_VALUES[card.rank] : NORMAL_VALUES[card.rank];
}

function cardRank(card, trump) {
  if (card.suit === trump) return TRUMP_ORDER.indexOf(card.rank);
  return NORMAL_ORDER.indexOf(card.rank);
}

// Determine which card wins a trick
function trickWinner(trick, trump) {
  // trick = [{ card, playerIndex }, ...]
  const leadSuit = trick[0].card.suit;
  let best = trick[0];
  for (let i = 1; i < trick.length; i++) {
    const challenger = trick[i];
    const bestIsTrump = best.card.suit === trump;
    const chalIsTrump = challenger.card.suit === trump;
    if (chalIsTrump && !bestIsTrump) {
      best = challenger;
    } else if (chalIsTrump && bestIsTrump) {
      if (cardRank(challenger.card, trump) < cardRank(best.card, trump)) best = challenger;
    } else if (!chalIsTrump && !bestIsTrump && challenger.card.suit === leadSuit) {
      if (cardRank(challenger.card, trump) < cardRank(best.card, trump)) best = challenger;
    }
  }
  return best.playerIndex;
}

function trickPoints(trick, trump) {
  return trick.reduce((sum, { card }) => sum + cardValue(card, trump), 0);
}

// Get valid cards a player can play
function validCards(hand, trick, trump) {
  if (trick.length === 0) return hand;
  const leadSuit = trick[0].card.suit;
  const hasSuit = hand.filter(c => c.suit === leadSuit);
  const hasTrump = hand.filter(c => c.suit === trump);

  if (leadSuit === trump) {
    return hasTrump.length > 0 ? hasTrump : hand;
  }

  // Must follow suit if possible
  if (hasSuit.length > 0) return hasSuit;

  // Can't follow suit — must play trump if possible
  if (hasTrump.length > 0) {
    // Check if partner is winning the trick
    const currentWinner = trickWinner(trick, trump);
    // If partner leads or is currently winning, can play any trump or discard
    // For simplicity: must overtrump if possible
    const trumpInTrick = trick.filter(t => t.card.suit === trump);
    if (trumpInTrick.length > 0) {
      const highestTrump = trumpInTrick.reduce((best, t) =>
        cardRank(t.card, trump) < cardRank(best.card, trump) ? t : best
      );
      const overtrumps = hasTrump.filter(c => cardRank(c, trump) < cardRank(highestTrump.card, trump));
      return overtrumps.length > 0 ? overtrumps : hasTrump;
    }
    return hasTrump;
  }

  return hand;
}

// --- Roem detection ---

function detectRoem(hand, trump) {
  const roems = [];

  // King + Queen of trump
  const hasKing  = hand.some(c => c.suit === trump && c.rank === 'K');
  const hasQueen = hand.some(c => c.suit === trump && c.rank === 'Q');
  if (hasKing && hasQueen) roems.push({ type: 'stuk', points: 20, description: 'King + Queen of trumps' });

  // Group by suit for sequences
  for (const suit of SUITS) {
    const suitCards = hand.filter(c => c.suit === suit).map(c => RANKS.indexOf(c.rank)).sort((a, b) => a - b);
    let seqStart = 0;
    while (seqStart < suitCards.length) {
      let seqEnd = seqStart;
      while (seqEnd + 1 < suitCards.length && suitCards[seqEnd + 1] === suitCards[seqEnd] + 1) seqEnd++;
      const len = seqEnd - seqStart + 1;
      if (len >= 3) {
        const pts = len >= 4 ? 50 : 20;
        roems.push({ type: 'sequence', points: pts, suit, length: len, description: `Sequence of ${len} in ${suit}` });
        // Check stuk stacking: if this sequence contains K+Q of trump
        if (suit === trump && hasKing && hasQueen) {
          const seqRanks = suitCards.slice(seqStart, seqEnd + 1).map(i => RANKS[i]);
          const hasKinSeq = seqRanks.includes('K');
          const hasQinSeq = seqRanks.includes('Q');
          if (hasKinSeq && hasQinSeq) {
            // Stuk is already added separately — stacking is handled in scoring
          }
        }
      }
      seqStart = seqEnd + 1;
    }
  }

  // Three or four of a kind (same rank, ignoring trump J/9 special status)
  for (const rank of RANKS) {
    const count = hand.filter(c => c.rank === rank).length;
    if (count === 3) roems.push({ type: 'three_of_a_kind', points: 20, rank, description: `Three ${rank}s` });
    if (count === 4) roems.push({ type: 'four_of_a_kind', points: 50, rank, description: `Four ${rank}s` });
  }

  return roems;
}

function totalRoemPoints(roems) {
  return roems.reduce((sum, r) => sum + r.points, 0);
}

module.exports = {
  SUITS, RANKS, NORMAL_VALUES, TRUMP_VALUES,
  createDeck, shuffleDeck, dealCards,
  cardValue, trickWinner, trickPoints,
  validCards, detectRoem, totalRoemPoints
};
