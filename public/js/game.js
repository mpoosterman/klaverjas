'use strict';

const socket = io();

// --- State ---
let myState = null;
let selectedNumPlayers = 2;

// --- Helpers ---
const $ = id => document.getElementById(id);
const suitSymbol = s => ({ clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' }[s] || s);
const isRed = s => s === 'hearts' || s === 'diamonds';
const suitName = s => s.charAt(0).toUpperCase() + s.slice(1);

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(`screen-${name}`).classList.add('active');
}

function showToast(text, duration = 3000) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), duration);
}

function showModal(id) {
  $(`modal-${id}`).classList.remove('hidden');
}
function hideModal(id) {
  $(`modal-${id}`).classList.add('hidden');
}

// --- Lobby ---
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    $(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

document.querySelectorAll('.num-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.num-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedNumPlayers = parseInt(btn.dataset.num);
  });
});

$('btn-create').addEventListener('click', () => {
  const nickname = $('nickname').value.trim();
  if (!nickname) return showError('Enter a nickname');
  socket.emit('createRoom', { nickname, numPlayers: selectedNumPlayers }, ({ code, state, error }) => {
    if (error) return showError(error);
    applyState(state);
    $('display-code').textContent = code;
    showScreen('waiting');
  });
});

$('btn-join').addEventListener('click', () => {
  const nickname = $('nickname').value.trim();
  const code = $('room-code').value.trim().toUpperCase();
  if (!nickname) return showError('Enter a nickname');
  if (!code) return showError('Enter a room code');
  socket.emit('joinRoom', { code, nickname }, ({ state, error }) => {
    if (error) return showError(error);
    applyState(state);
    $('display-code').textContent = code;
    showScreen('waiting');
  });
});

function showError(msg) {
  const el = $('lobby-error');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

// --- Trump selection ---
document.querySelectorAll('.suit-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    socket.emit('chooseTrump', { suit: btn.dataset.suit }, (res) => {
      if (res && res.error) showToast(res.error);
      else hideModal('bidding');
    });
  });
});

// --- New round ---
$('btn-new-round').addEventListener('click', () => {
  socket.emit('newRound', () => hideModal('round'));
});

$('btn-play-again').addEventListener('click', () => {
  hideModal('gameover');
  location.reload();
});

// --- Socket events ---
socket.on('gameState', (state) => {
  applyState(state);
  render(state);
});

socket.on('message', ({ text }) => showToast(text));

socket.on('trickComplete', ({ winnerName, trick }) => {
  showToast(`${winnerName} wins the trick!`, 2000);
});

socket.on('roundOver', (summary) => {
  renderRoundSummary(summary);
  if (myState && myState.state === 'gameEnd') {
    showModal('gameover');
  } else {
    showModal('round');
  }
});

// --- State ---
function applyState(state) {
  myState = state;
}

// --- RENDER ---
function render(state) {
  if (!state) return;

  // Waiting screen
  if (state.state === 'waiting') {
    showScreen('waiting');
    renderWaiting(state);
    return;
  }

  showScreen('game');
  renderTopBar(state);
  renderOpponents(state);
  renderTrick(state);
  renderMyHand(state);
  renderMyRoem(state);
  renderBidding(state);
}

function renderWaiting(state) {
  const list = $('player-list');
  list.innerHTML = state.players.map(p =>
    `<span class="player-chip">${p.nickname} ${p.isMe ? '(you)' : ''}</span>`
  ).join('');
  $('waiting-hint').textContent = `Waiting for ${state.numPlayers - state.players.length} more player(s)…`;
}

function renderTopBar(state) {
  const teams = getTeamNames(state);
  $('score-display').innerHTML = `
    <div class="score-item"><span class="score-label">${teams[0]}</span><span class="score-value">${state.scores[0]}</span></div>
    <div class="score-item"><span class="score-label">${teams[1]}</span><span class="score-value">${state.scores[1]}</span></div>
  `;

  $('trump-display').innerHTML = state.trump
    ? `Trump: <span style="color:${isRed(state.trump) ? '#ff8080' : '#fff'}">${suitSymbol(state.trump)} ${suitName(state.trump)}</span>`
    : 'Choosing trump…';

  if (state.state === 'playing' && state.currentPlayerIndex !== null) {
    const cur = state.players[state.currentPlayerIndex];
    $('turn-display').textContent = cur.isMe ? 'Your turn!' : `${cur.nickname}'s turn`;
  } else {
    $('turn-display').textContent = '';
  }
}

function renderOpponents(state) {
  const opponents = state.players.filter((_, i) => i !== state.myIndex);
  const area = $('opponents-area');
  area.innerHTML = opponents.map(p => {
    const isActive = state.players.indexOf(p) === state.currentPlayerIndex;
    const backs = Array(p.cardCount).fill(0).map((_, i) =>
      `<div class="card-back" style="margin-left:${i === 0 ? 0 : -20}px">🂠</div>`
    ).join('');
    return `
      <div class="opponent-slot">
        <div class="opponent-name ${isActive ? 'active-player' : ''}">${p.nickname} · Team ${p.team + 1}</div>
        <div class="card-back-row" style="display:flex;">${backs}</div>
      </div>
    `;
  }).join('');
}

function renderTrick(state) {
  const area = $('trick-cards');
  area.innerHTML = state.trick.map(({ card, playerIndex }) => {
    const p = state.players[playerIndex];
    return `
      <div class="played-card-wrap">
        ${renderCard(card, state.trump, false)}
        <span class="played-by">${p.nickname}</span>
      </div>
    `;
  }).join('');
}

function renderMyHand(state) {
  if (state.myIndex < 0) return;
  const hand = state.myHand || [];
  const isMyTurn = state.state === 'playing' && state.currentPlayerIndex === state.myIndex;
  const area = $('my-hand');
  area.innerHTML = hand.map(card => {
    const playable = isMyTurn;
    return `<div class="${'card' + (isRed(card.suit) ? ' red' : '') + (card.suit === state.trump ? ' trump-card' : '') + (playable ? ' playable' : '')}"
      data-suit="${card.suit}" data-rank="${card.rank}">
      <div class="corner-tl">${card.rank}<br>${suitSymbol(card.suit)}</div>
      <div class="card-rank">${card.rank}</div>
      <div class="card-suit">${suitSymbol(card.suit)}</div>
      <div class="corner-br">${card.rank}<br>${suitSymbol(card.suit)}</div>
    </div>`;
  }).join('');

  area.querySelectorAll('.card.playable').forEach(el => {
    el.addEventListener('click', () => {
      const card = { suit: el.dataset.suit, rank: el.dataset.rank };
      socket.emit('playCard', { card }, (res) => {
        if (res && res.error) showToast(res.error);
      });
    });
  });
}

function renderCard(card, trump, playable) {
  const red = isRed(card.suit) ? ' red' : '';
  const tr = card.suit === trump ? ' trump-card' : '';
  const pl = playable ? ' playable' : '';
  return `<div class="card${red}${tr}${pl}">
    <div class="corner-tl">${card.rank}<br>${suitSymbol(card.suit)}</div>
    <div class="card-rank">${card.rank}</div>
    <div class="card-suit">${suitSymbol(card.suit)}</div>
    <div class="corner-br">${card.rank}<br>${suitSymbol(card.suit)}</div>
  </div>`;
}

function renderMyRoem(state) {
  const roem = state.myRoem || [];
  if (roem.length === 0 || !state.trump) {
    $('my-roem-display').textContent = '';
    return;
  }
  const total = roem.reduce((s, r) => s + r.points, 0);
  $('my-roem-display').textContent = `Your roem: ${roem.map(r => r.description).join(', ')} = ${total} pts`;
}

function renderBidding(state) {
  if (state.state !== 'bidding') { hideModal('bidding'); return; }
  const bidder = state.players[state.biddingPlayerIndex];
  if (!bidder) return;
  if (bidder.isMe) {
    $('bidding-prompt').textContent = 'Choose the trump suit for this round:';
    showModal('bidding');
  } else {
    hideModal('bidding');
    $('turn-display').textContent = `${bidder.nickname} is choosing trump…`;
  }
}

function renderRoundSummary(summary) {
  const teams = myState ? getTeamNames(myState) : ['Team 1', 'Team 2'];
  const playingTeamName = teams[summary.playingTeam];
  const result = summary.playingTeamWon ? `${playingTeamName} wins the round!` : `${playingTeamName} failed — points transferred!`;

  let html = `<p style="color:var(--gold);margin-bottom:1rem;">${result}</p>`;
  html += `<div class="summary-row"><span>Card points</span><span>${summary.cardPoints[0]} – ${summary.cardPoints[1]}</span></div>`;
  html += `<div class="summary-row"><span>Roem points</span><span>${summary.roemPoints[0]} – ${summary.roemPoints[1]}</span></div>`;
  html += `<div class="summary-row total"><span>Round score</span><span>${summary.roundScores[0]} – ${summary.roundScores[1]}</span></div>`;
  html += `<div class="summary-row total"><span>Total score</span><span>${summary.totalScores[0]} – ${summary.totalScores[1]}</span></div>`;

  if (summary.playerRoem && summary.playerRoem.some(p => p.roems.length > 0)) {
    html += `<p style="margin-top:1rem;font-size:0.8rem;color:rgba(255,255,255,0.5);">Roem declared:</p>`;
    summary.playerRoem.forEach(p => {
      if (p.roems.length > 0) {
        html += `<div style="font-size:0.82rem;color:rgba(255,255,255,0.7);">${p.nickname}: ${p.roems.map(r => r.description).join(', ')}</div>`;
      }
    });
  }

  $('round-summary').innerHTML = html;

  if (myState && myState.state === 'gameEnd') {
    const winner = summary.totalScores[0] > summary.totalScores[1] ? teams[0] : teams[1];
    $('gameover-title').textContent = `${winner} wins the game!`;
    $('gameover-summary').innerHTML = `<p>Final score: ${summary.totalScores[0]} – ${summary.totalScores[1]}</p>`;
  }
}

function getTeamNames(state) {
  const t0 = state.players.filter(p => p.team === 0).map(p => p.nickname).join(' & ');
  const t1 = state.players.filter(p => p.team === 1).map(p => p.nickname).join(' & ');
  return [t0 || 'Team 1', t1 || 'Team 2'];
}
