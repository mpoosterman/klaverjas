'use strict';

const socket = io();
let myState = null;

const $ = id => document.getElementById(id);
const suitSym = s => ({ clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' }[s] || '');
const suitNL  = s => ({ clubs: 'Klaveren', diamonds: 'Ruiten', hearts: 'Harten', spades: 'Schoppen' }[s] || s);
const isRed   = s => s === 'hearts' || s === 'diamonds';

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(`screen-${name}`).classList.add('active');
}

function showToast(text, ms = 2500) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), ms);
}

function showModal(id)  { $(`modal-${id}`).classList.remove('hidden'); }
function hideModal(id)  { $(`modal-${id}`).classList.add('hidden'); }

// --- LOBBY TABS ---
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    $(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

$('btn-create').addEventListener('click', () => {
  const nickname = $('nickname').value.trim();
  if (!nickname) return showError('Vul je naam in');
  socket.emit('createRoom', { nickname }, ({ code, state, error }) => {
    if (error) return showError(error);
    applyState(state);
    $('display-code').textContent = code;
    showScreen('waiting');
    renderWaiting(state);
  });
});

$('btn-join').addEventListener('click', () => {
  const nickname = $('nickname').value.trim();
  const code = $('room-code').value.trim().toUpperCase();
  if (!nickname) return showError('Vul je naam in');
  if (!code) return showError('Vul een kamernummer in');
  socket.emit('joinRoom', { code, nickname }, ({ state, error }) => {
    if (error) return showError(error);
    applyState(state);
    $('display-code').textContent = code;
    showScreen('waiting');
    renderWaiting(state);
  });
});

function showError(msg) {
  const el = $('lobby-error');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

// --- TRUMP READY BUTTON ---
$('btn-trump-ready').addEventListener('click', () => {
  $('btn-trump-ready').classList.add('hidden');
  showModal('bidding');
});

// --- TRUMP SUIT BUTTONS ---
document.querySelectorAll('.suit-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    socket.emit('chooseTrump', { suit: btn.dataset.suit }, res => {
      if (res && res.error) showToast(res.error);
      else hideModal('bidding');
    });
  });
});

// --- NEW ROUND ---
$('btn-new-round').addEventListener('click', () => {
  socket.emit('newRound', () => hideModal('round'));
});
$('btn-play-again').addEventListener('click', () => location.reload());

// --- SOCKET EVENTS ---
socket.on('gameState', state => { applyState(state); render(state); });
socket.on('message', ({ text }) => showToast(text, 3000));
socket.on('trickComplete', ({ winnerName }) => showToast(`${winnerName} wint de slag!`));
socket.on('roundOver', summary => {
  renderRoundSummary(summary);
  if (myState && myState.state === 'gameEnd') showModal('gameover');
  else showModal('round');
});

function applyState(state) { myState = state; }

// --- MAIN RENDER ---
function render(state) {
  if (!state) return;
  if (state.state === 'waiting') { showScreen('waiting'); renderWaiting(state); return; }
  showScreen('game');
  renderTopBar(state);
  renderLayouts(state);
  renderTrick(state);
  renderRoem(state);
  renderMiddle(state);
}

function renderWaiting(state) {
  $('player-list').innerHTML = state.players.map(p =>
    `<span class="player-chip">${p.nickname}${p.isMe ? ' (jij)' : ''}</span>`
  ).join('');
}

function renderTopBar(state) {
  const names = playerNames(state);
  $('score-display').innerHTML = `
    <div class="score-item"><span class="score-label">${names[0]}</span><span class="score-value">${state.scores[0]}</span></div>
    <div class="score-item"><span class="score-label">${names[1]}</span><span class="score-value">${state.scores[1]}</span></div>
  `;
  $('trump-display').innerHTML = state.trump
    ? `Troef: <span style="color:${isRed(state.trump) ? '#ff8888' : '#fff'}">${suitSym(state.trump)} ${suitNL(state.trump)}</span>`
    : 'Troef kiezen…';

  if (state.state === 'playing' && state.currentPlayerIndex !== null) {
    const cur = state.players[state.currentPlayerIndex];
    $('turn-display').textContent = cur.isMe ? 'Jouw beurt!' : `${cur.nickname} is aan de beurt`;
  } else {
    $('turn-display').textContent = '';
  }
}

// Layout: 16 cards per player
// Positions 0-3: bottom layer row 0 (deepest)
// Positions 4-7: bottom layer row 1
// Positions 8-11: top layer row 0
// Positions 12-15: top layer row 1 (closest, revealed first)
//
// Display as 4 cols x 4 rows grid:
// Visual row 0 (top of grid) = position row 3 (12-15) — top layer row 1
// Visual row 1              = position row 2 (8-11)  — top layer row 0
// Visual row 2              = position row 1 (4-7)   — bottom layer row 1
// Visual row 3 (bottom)     = position row 0 (0-3)   — bottom layer row 0
// Visual divider between col 1 and col 2 to show "two stacks of 2"
function renderLayouts(state) {
  const isMyTurn = state.state === 'playing' && state.currentPlayerIndex === state.myIndex;
  const validPos = new Set(state.myValidPositions || []);

  $('my-layout').innerHTML  = buildLayoutHTML(state.myLayout,  validPos, isMyTurn, state.trump);
  $('opp-layout').innerHTML = buildLayoutHTML(state.oppLayout, new Set(), false, state.trump);

  const me  = state.players[state.myIndex];
  const opp = state.players[1 - state.myIndex];
  $('my-label').textContent  = me ? me.nickname : 'Jij';
  $('my-label').className    = 'player-label' + (state.currentPlayerIndex === state.myIndex ? ' active' : '');
  $('opp-label').textContent = opp ? opp.nickname : '';
  $('opp-label').className   = 'player-label' + (state.currentPlayerIndex === (1 - state.myIndex) ? ' active' : '');

  $('my-layout').querySelectorAll('.card-face.playable').forEach(el => {
    el.addEventListener('click', () => {
      socket.emit('playCard', { position: parseInt(el.dataset.position) }, res => {
        if (res && res.error) showToast(res.error);
      });
    });
  });
}

function buildLayoutHTML(layout, validPos, isMyTurn, trump) {
  if (!layout) return '';
  const rowOrder = [3, 2, 1, 0]; // display top-to-bottom: row 3 first (top layer)
  let html = '';
  for (const row of rowOrder) {
    for (let col = 0; col < 4; col++) {
      const pos = row * 4 + col;
      const card = layout[pos];
      // Add visual gap between col 1 and col 2 to show two stacks
      const marginLeft = col === 2 ? 'margin-left:10px;' : '';
      html += cardHTML(card, pos, validPos.has(pos) && isMyTurn, trump, marginLeft);
    }
  }
  return html;
}

function cardHTML(card, position, playable, trump, extraStyle = '') {
  if (card === null) {
    return `<div class="card card-empty" data-position="${position}" style="${extraStyle}"></div>`;
  }
  if (!card.faceUp) {
    return `<div class="card card-back" data-position="${position}" style="${extraStyle}"></div>`;
  }
  const red = isRed(card.suit) ? ' red' : '';
  const tr  = card.suit === trump ? ' trump' : '';
  const pl  = playable ? ' playable' : '';
  return `<div class="card card-face${red}${tr}${pl}" data-position="${position}" style="${extraStyle}">
    <div class="corner corner-tl">${card.rank}<br>${suitSym(card.suit)}</div>
    <div class="card-center">${suitSym(card.suit)}</div>
    <div class="corner corner-br">${card.rank}<br>${suitSym(card.suit)}</div>
  </div>`;
}

function renderTrick(state) {
  const area = $('trick-cards');
  if (!state.trick || state.trick.length === 0) { area.innerHTML = ''; return; }
  area.innerHTML = state.trick.map(({ card, playerIndex }) => {
    const p = state.players[playerIndex];
    const red = isRed(card.suit) ? ' red' : '';
    const tr  = state.trump && card.suit === state.trump ? ' trump' : '';
    return `<div class="played-wrap">
      <span class="played-by">${p ? p.nickname : ''}</span>
      <div class="card card-face${red}${tr}" style="cursor:default;">
        <div class="corner corner-tl">${card.rank}<br>${suitSym(card.suit)}</div>
        <div class="card-center">${suitSym(card.suit)}</div>
        <div class="corner corner-br">${card.rank}<br>${suitSym(card.suit)}</div>
      </div>
    </div>`;
  }).join('');
}

function renderRoem(state) {
  const roem = state.myRoem || [];
  if (!roem.length || !state.trump) { $('my-roem-display').textContent = ''; return; }
  const total = roem.reduce((s, r) => s + r.points, 0);
  $('my-roem-display').textContent = `Roem: ${roem.map(r => r.description).join(' · ')} = ${total} pt`;
}

// Show/hide the trump ready button and waiting message in the middle
function renderMiddle(state) {
  const btn = $('btn-trump-ready');
  const waitMsg = $('waiting-trump-msg');

  if (state.state.startsWith('bidding')) {
    const bidder = state.players[state.biddingPlayerIndex];
    if (bidder && bidder.isMe) {
      btn.classList.remove('hidden');
      waitMsg.classList.add('hidden');
    } else {
      btn.classList.add('hidden');
      waitMsg.classList.remove('hidden');
      waitMsg.textContent = bidder ? `${bidder.nickname} kiest troef…` : '';
    }
    // Pre-fill bidding modal preview
    const visible = (state.myLayout || [])
      .filter(c => c && c.faceUp);
    $('bidding-preview').innerHTML = visible.map(card => {
      const red = isRed(card.suit) ? ' red' : '';
      return `<div class="card card-face${red}" style="cursor:default;width:50px;height:70px;">
        <div class="corner corner-tl" style="font-size:0.6rem">${card.rank}<br>${suitSym(card.suit)}</div>
        <div class="card-center" style="font-size:1rem">${suitSym(card.suit)}</div>
        <div class="corner corner-br" style="font-size:0.6rem">${card.rank}<br>${suitSym(card.suit)}</div>
      </div>`;
    }).join('');
  } else {
    btn.classList.add('hidden');
    waitMsg.classList.add('hidden');
  }
}

function renderRoundSummary(summary) {
  const names = myState ? playerNames(myState) : ['Speler 1', 'Speler 2'];
  const playingName = names[summary.playingTeam];
  const result = summary.playingTeamWon
    ? `${playingName} wint de ronde! 🎉`
    : `${playingName} verliest — punten naar de tegenstander!`;

  let html = `<p style="color:var(--gold);margin-bottom:1rem;text-align:center;">${result}</p>`;
  html += `<div class="summary-row"><span>Slagpunten</span><span>${summary.cardPoints[0]} – ${summary.cardPoints[1]}</span></div>`;
  html += `<div class="summary-row"><span>Roempunten</span><span>${summary.roemPoints[0]} – ${summary.roemPoints[1]}</span></div>`;
  html += `<div class="summary-row total"><span>Ronde score</span><span>${summary.roundScores[0]} – ${summary.roundScores[1]}</span></div>`;
  html += `<div class="summary-row total"><span>Totaal</span><span>${summary.totalScores[0]} – ${summary.totalScores[1]}</span></div>`;

  if (summary.playerRoem && summary.playerRoem.some(p => p.roems.length > 0)) {
    html += `<p style="margin-top:1rem;font-size:0.78rem;color:rgba(255,255,255,0.5);">Roem gedeclareerd:</p>`;
    summary.playerRoem.forEach(p => {
      if (p.roems.length > 0) {
        const pts = p.roems.reduce((s, r) => s + r.points, 0);
        html += `<div style="font-size:0.82rem;color:rgba(255,255,255,0.7);">${p.nickname}: ${p.roems.map(r => r.description).join(', ')} (${pts} pt)</div>`;
      }
    });
  }

  $('round-summary').innerHTML = html;

  if (myState && myState.state === 'gameEnd') {
    const winner = summary.totalScores[0] > summary.totalScores[1] ? names[0] : names[1];
    $('gameover-title').textContent = `${winner} wint het spel! 🏆`;
    $('gameover-summary').innerHTML = `<p style="color:rgba(255,255,255,0.7);margin-top:0.5rem;">Eindstand: ${summary.totalScores[0]} – ${summary.totalScores[1]}</p>`;
  }
}

function playerNames(state) {
  return state.players.map(p => p.nickname);
}
