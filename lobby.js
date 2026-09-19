'use strict';
/**
 * lobby.js — Bet Room Lobby
 *
 * Flow:
 *  1. Player picks a bet amount → subscribes to that tier via socket
 *  2. Backend sends 5 room snapshots in real time
 *  3. Player taps Join → socket event → backend adds them, resets countdown
 *  4. On room:started → redirect to game.html with matched players
 */

import { io } from 'https://cdn.socket.io/4.7.4/socket.io.esm.min.js';

// ── Config ─────────────────────────────────────────────────────────────────
const LUDO_API_URL     = (window.__LUDO_BACKEND_URL__ || 'https://ludo-backend-g2ir.onrender.com').replace(/\/$/, '');
const SYSTEM_BACKEND_URL = (window.__SYSTEM_BACKEND_URL__ || 'https://system-backend-1u5m.onrender.com').replace(/\/$/, '');

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  player        : { name: '', balance: 0, wins: 0, losses: 0, coins: 0 },
  selectedBet   : 0,
  currentRoomId : null,      // room we've joined
  rooms         : {},        // roomId → room object (latest snapshot)
  socket        : null,
  subscribedBet : null,
};

// ── DOM helpers ────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

function showOverlay(id) { $(id).setAttribute('aria-hidden', 'false'); }
function hideOverlay(id) { $(id).setAttribute('aria-hidden', 'true'); }

function toast(msg, type = 'info') {
  const t = el('div', `toast ${type}`);
  t.textContent = msg;
  $('toastContainer').appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ── Auth init ──────────────────────────────────────────────────────────────
async function initAuth() {
  const params   = new URLSearchParams(window.location.search);
  const token    = params.get('token');
  const launch   = params.get('launch');
  const username = params.get('username');
  const balance  = params.get('balance');

  // Persist auth params
  if (token && launch)   sessionStorage.setItem('appAuth', JSON.stringify({ token, launch, username, balance }));
  else if (token)        sessionStorage.setItem('appAuth', JSON.stringify({ token, username, balance }));

  const auth = JSON.parse(sessionStorage.getItem('appAuth') || '{}');

  // Resolve real balance from system_backend if we have a launch token
  if (auth.launch) {
    try {
      const res  = await fetch(`${SYSTEM_BACKEND_URL}/api/verify-launch-token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ launch: auth.launch }), cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.valid !== false) {
        auth.username = data.username || data.user?.username || auth.username;
        auth.balance  = data.balance  ?? data.user?.balance  ?? auth.balance;
        auth.phonenumber = data.phone || data.user?.phone || auth.phonenumber;
        sessionStorage.setItem('appAuth', JSON.stringify(auth));
      }
    } catch (e) {
      console.warn('[lobby] Could not resolve system balance', e);
    }
  }

  state.player.name    = auth.username || 'Player';
  state.player.balance = Number(auth.balance ?? 0);
  state.player.wins    = Number(auth.wins ?? 0);
  state.player.losses  = Number(auth.losses ?? 0);

  $('lobbyBalance').textContent = state.player.balance.toLocaleString();
}

// ── Socket setup ──────────────────────────────────────────────────────────
function connectSocket() {
  const socket = io(LUDO_API_URL, {
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 6,
  });
  state.socket = socket;

  socket.on('connect', () => {
    console.log('[lobby] socket connected', socket.id);
    // Re-subscribe if we had a bet selected
    if (state.selectedBet) subscribeToBet(state.selectedBet);
  });

  socket.on('disconnect', () => {
    console.warn('[lobby] socket disconnected');
    state.currentRoomId = null;
  });

  // Full snapshot of all 5 rooms for the current tier
  socket.on('rooms:snapshot', ({ rooms }) => {
    rooms.forEach(r => { state.rooms[r.id] = r; });
    renderRooms();
  });

  // A single room changed (player joined/left, countdown tick)
  socket.on('room:update', room => {
    if (room.betAmount !== state.selectedBet) return;
    state.rooms[room.id] = room;
    renderOneRoom(room.id);
    updateReadyCount();
  });

  // Confirmation we joined a room
  socket.on('room:joined', ({ room }) => {
    state.currentRoomId = room.id;
    state.rooms[room.id] = room;
    hideOverlay('joiningOverlay');
    renderRooms();
    toast(`Joined Room ${room.id}!`, 'success');
  });

  socket.on('room:error', ({ error }) => {
    hideOverlay('joiningOverlay');
    toast(error || 'Could not join room', 'error');
  });

  // Game starts — redirect everyone in this room to game.html
  socket.on('room:started', ({ roomId, betAmount, players }) => {
    if (roomId !== state.currentRoomId) return;
    hideOverlay('joiningOverlay');
    showOverlay('gameStartingOverlay');

    const names = players.map(p => p.name).join(', ');
    $('startingPlayersList').textContent = names;

    const auth = JSON.parse(sessionStorage.getItem('appAuth') || '{}');
    const gameState = {
      name          : state.player.name,
      balance       : state.player.balance,
      wins          : state.player.wins,
      losses        : state.player.losses,
      totalWon      : state.player.totalWon  || 0,
      totalLost     : state.player.totalLost || 0,
      selectedAmount: betAmount,
      opponent      : players.find(p => p.name !== state.player.name) || { name: 'Opponent' },
      autoStart     : true,
      lobbyPlayers  : players,
    };
    sessionStorage.setItem('ludoGameState', JSON.stringify(gameState));

    const params = new URLSearchParams();
    if (auth.token)  params.set('token',  auth.token);
    if (auth.launch) params.set('launch', auth.launch);

    setTimeout(() => {
      window.location.href = `game.html${params.toString() ? '?' + params.toString() : ''}`;
    }, 1800);
  });
}

function subscribeToBet(betAmount) {
  if (!state.socket?.connected) return;
  if (state.subscribedBet === betAmount) return;

  // Leave current room if switching bets
  if (state.currentRoomId) {
    state.socket.emit('room:leave');
    state.currentRoomId = null;
  }

  state.subscribedBet = betAmount;
  state.socket.emit('subscribe:bet', { betAmount });
}

// ── Bet picker ────────────────────────────────────────────────────────────
document.querySelectorAll('.bet-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    const amt = Number(btn.dataset.amount);
    if (state.player.balance < amt) {
      toast(`Insufficient balance for ${amt} ETB bet`, 'error');
      return;
    }

    document.querySelectorAll('.bet-chip').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    state.selectedBet = amt;
    state.rooms = {};

    // Show rooms header
    $('roomsEmptyState').classList.add('hidden');
    $('roomsHeader').classList.remove('hidden');
    $('roomsGrid').innerHTML = renderSkeletons();
    $('roomsTitle').textContent = `READY PLAYERS — ${amt} ETB`;

    subscribeToBet(amt);
  });
});

function renderSkeletons() {
  return Array.from({ length: 5 }, (_, i) =>
    `<div class="room-card" style="opacity:.4;min-height:80px;animation:livePulse 1.2s ease-in-out ${i * 0.12}s infinite;"></div>`
  ).join('');
}

// ── Room rendering ─────────────────────────────────────────────────────────
function renderRooms() {
  const grid = $('roomsGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const sorted = Object.values(state.rooms)
    .filter(r => r.betAmount === state.selectedBet)
    .sort((a, b) => {
      // Rooms with players come first; started rooms last
      if (a.status === 'started') return 1;
      if (b.status === 'started') return -1;
      return b.players.length - a.players.length;
    });

  sorted.forEach(room => grid.appendChild(buildRoomCard(room)));
  updateReadyCount();
}

function renderOneRoom(roomId) {
  const card = document.querySelector(`[data-room-id="${roomId}"]`);
  const room = state.rooms[roomId];
  if (!room) return;

  if (card) {
    const newCard = buildRoomCard(room);
    card.replaceWith(newCard);
  } else {
    renderRooms(); // fallback full re-render
  }
}

function updateReadyCount() {
  const total = Object.values(state.rooms)
    .filter(r => r.betAmount === state.selectedBet)
    .reduce((s, r) => s + r.players.length, 0);
  const el = $('roomsReadyCount');
  if (el) el.textContent = `${total} Ready`;
}

function buildRoomCard(room) {
  const myName  = state.player.name;
  const iAmHere = room.players.some(p => p.name === myName);
  const count   = room.players.length;
  const isFull  = count >= 4;
  const started = room.status === 'started';

  const card = el('div', `room-card${iAmHere ? ' has-me' : ''}${started ? ' started' : ''}`);
  card.dataset.roomId = room.id;

  // ── Card top row ─────────────────────────────────────────────────────
  const topRow = el('div', 'room-card-top');

  const idSpan = el('span', 'room-card-id');
  idSpan.textContent = `ROOM #${room.id}`;

  const countSpan = el('span', 'room-card-count');
  countSpan.innerHTML = `<strong>${count}</strong> / 4 players`;

  // Countdown pill
  const pill = el('div', `room-countdown-pill${room.countdown <= 0 ? ' hidden-vis' : ''}${room.countdown <= 8 ? ' urgent' : ''}`);
  pill.innerHTML = `⏱ <span>${room.countdown}s</span>`;

  topRow.append(idSpan, countSpan, pill);
  card.appendChild(topRow);

  // ── Players list ─────────────────────────────────────────────────────
  const list = el('div', 'room-players-list');

  // Determine if we should show a VS divider (exactly 2 players)
  const showVs = count === 2;

  room.players.forEach((p, idx) => {
    list.appendChild(buildPlayerCard(p, myName, room.betAmount));
    if (showVs && idx === 0) list.appendChild(buildVsDivider());
  });

  // Empty slots
  for (let i = count; i < 4; i++) {
    list.appendChild(buildEmptySlot(i + 1));
  }

  card.appendChild(list);

  // ── Action button ────────────────────────────────────────────────────
  if (started) {
    // No button — room is in game
  } else if (iAmHere) {
    // Show Leave button
    const leaveBtn = el('button', 'room-join-btn leave');
    leaveBtn.textContent = '✗ Leave Room';
    leaveBtn.addEventListener('click', () => handleLeave());
    card.appendChild(leaveBtn);

    // If exactly 2+ players and I'm in, show the VS play button too
    if (count >= 2 && room.status === 'countdown') {
      const playBtn = el('button', 'room-play-btn');
      playBtn.disabled = true; // auto-starts — just visual
      playBtn.innerHTML = `▶ Starting in ${room.countdown}s…`;
      card.appendChild(playBtn);
    }
  } else {
    // Show Join button (disabled if in another room or full)
    const inOther = Boolean(state.currentRoomId && state.currentRoomId !== room.id);
    const joinBtn = el('button', 'room-join-btn join');
    joinBtn.textContent = '+ Join Room';
    joinBtn.disabled = isFull || inOther;
    if (isFull)  joinBtn.textContent = 'Full';
    if (inOther) joinBtn.textContent = 'Leave your room first';
    joinBtn.addEventListener('click', () => handleJoin(room.id));
    card.appendChild(joinBtn);
  }

  return card;
}

function buildPlayerCard(player, myName, betAmount) {
  const isMe  = player.name === myName;
  const card  = el('div', `player-mini-card${isMe ? ' is-me' : ''}`);

  // Colour based on player index / hash
  const colours = ['#7c6af7','#f0b133','#36e89c','#ff4465','#4e94ff','#ff9040','#30c0c0'];
  const color   = colours[Math.abs(hashCode(player.name)) % colours.length];
  const initial = (player.name || 'P').charAt(0).toUpperCase();

  card.innerHTML = `
    <div class="pm-avatar online" style="background:${color}">${initial}</div>
    <div class="pm-info">
      <div class="pm-name">
        ${escHtml(player.name)}
        ${isMe ? '<span class="pm-you-tag">YOU</span>' : '<span class="pm-online-tag">Online</span>'}
      </div>
      <div class="pm-stats">
        <span class="pm-stat wins">✓ ${player.wins ?? 0}</span>
        <span class="pm-stat losses">✗ ${player.losses ?? 0}</span>
        <span class="pm-stat coins">🪙 ${player.balance ?? 0}</span>
      </div>
    </div>
    <div class="pm-right">
      <span class="pm-bet-pill">${betAmount} ETB</span>
      ${player.balance != null ? `<span class="pm-balance">Balance: ${Number(player.balance).toLocaleString()} ETB</span>` : ''}
    </div>`;

  return card;
}

function buildVsDivider() {
  const row = el('div', 'room-vs-row');
  row.innerHTML = `
    <div class="room-vs-line"></div>
    <div class="room-vs-badge">VS</div>
    <div class="room-vs-line"></div>`;
  return row;
}

function buildEmptySlot(slotNum) {
  const row = el('div', 'empty-slot-row');
  row.innerHTML = `
    <div class="empty-slot-avatar">+</div>
    <div class="empty-slot-label">Waiting for player ${slotNum}…</div>`;
  return row;
}

// ── Actions ────────────────────────────────────────────────────────────────
function handleJoin(roomId) {
  if (!state.socket?.connected) {
    toast('Not connected — please wait…', 'error'); return;
  }
  if (state.currentRoomId) {
    toast('Leave your current room first', 'error'); return;
  }

  const room = state.rooms[roomId];
  if (!room) return;

  if (state.player.balance < state.selectedBet) {
    toast(`Need ${state.selectedBet} ETB to join`, 'error'); return;
  }

  $('joiningRoomLabel').textContent = `Room #${roomId}`;
  showOverlay('joiningOverlay');

  state.socket.emit('room:join', {
    roomId,
    player: {
      name   : state.player.name,
      wins   : state.player.wins,
      losses : state.player.losses,
      balance: state.player.balance,
    },
  });

  // Auto-dismiss joining overlay after 6s if no response
  setTimeout(() => {
    const overlay = $('joiningOverlay');
    if (overlay?.getAttribute('aria-hidden') === 'false') {
      hideOverlay('joiningOverlay');
      toast('No response from server — try again', 'error');
    }
  }, 6000);
}

function handleLeave() {
  if (!state.socket?.connected || !state.currentRoomId) return;
  state.socket.emit('room:leave');
  state.currentRoomId = null;
  toast('Left the room', 'info');
}

// ── Cancel joining overlay ────────────────────────────────────────────────
$('joiningCancelBtn').addEventListener('click', () => {
  hideOverlay('joiningOverlay');
  handleLeave();
});

// ── Back button ────────────────────────────────────────────────────────────
$('lobbyBackBtn').addEventListener('click', () => {
  handleLeave();
  const auth = JSON.parse(sessionStorage.getItem('appAuth') || '{}');
  const params = new URLSearchParams();
  if (auth.token)  params.set('token',  auth.token);
  if (auth.launch) params.set('launch', auth.launch);
  window.location.href = `index.html${params.toString() ? '?' + params.toString() : ''}`;
});

// ── Utils ─────────────────────────────────────────────────────────────────
function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Bootstrap ─────────────────────────────────────────────────────────────
(async function init() {
  await initAuth();
  connectSocket();

  // If navigated here from index.html with a pre-selected bet, auto-select it
  const params    = new URLSearchParams(window.location.search);
  const presetBet = Number(params.get('bet'));
  if (presetBet) {
    const chip = document.querySelector(`.bet-chip[data-amount="${presetBet}"]`);
    if (chip) chip.click();
  }
})();
