'use strict';
/**
 * lobby.js — Bet Room Lobby
 *
 * Flow:
 *  1. Player picks a bet amount → 5 rooms show immediately (all empty to start)
 *  2. Rooms subscribe via socket and update live
 *  3. Player taps Join on any room → added even if they're the FIRST player (1/4)
 *  4. Countdown starts once 2nd player joins; resets on each new join
 *  5. On room:started → redirect to game.html with matched players
 */

import { io } from 'https://cdn.socket.io/4.7.4/socket.io.esm.min.js';

// ── Config ─────────────────────────────────────────────────────────────────
const LUDO_API_URL       = (window.__LUDO_BACKEND_URL__   || 'https://ludo-backend-g2ir.onrender.com').replace(/\/$/, '');
const SYSTEM_BACKEND_URL = (window.__SYSTEM_BACKEND_URL__ || 'https://system-backend-1u5m.onrender.com').replace(/\/$/, '');

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  player        : { name: '', balance: 0, wins: 0, losses: 0 },
  selectedBet   : 0,
  currentRoomId : null,   // roomId we've joined
  rooms         : {},     // roomId → latest room snapshot
  socket        : null,
  subscribedBet : null,
};

// ── DOM helpers ────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const mk = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

function showOverlay(id) { $(id)?.setAttribute('aria-hidden', 'false'); }
function hideOverlay(id) { $(id)?.setAttribute('aria-hidden', 'true');  }

function toast(msg, type = 'info') {
  const t = mk('div', `toast ${type}`);
  t.textContent = msg;
  $('toastContainer').appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ── Auth init ──────────────────────────────────────────────────────────────
async function initAuth() {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('token');
  const launch = params.get('launch');

  if (token && launch) sessionStorage.setItem('appAuth', JSON.stringify({ token, launch }));
  else if (token)      sessionStorage.setItem('appAuth', JSON.stringify({ token }));

  const auth = JSON.parse(sessionStorage.getItem('appAuth') || '{}');

  if (auth.launch) {
    try {
      const res  = await fetch(`${SYSTEM_BACKEND_URL}/api/verify-launch-token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ launch: auth.launch }), cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.valid !== false) {
        auth.username    = data.username    || data.user?.username    || auth.username;
        auth.balance     = data.balance     ?? data.user?.balance     ?? auth.balance;
        auth.phonenumber = data.phone       || data.user?.phone       || auth.phonenumber;
        sessionStorage.setItem('appAuth', JSON.stringify(auth));
      }
    } catch (e) { console.warn('[lobby] balance resolve failed', e); }
  }

  state.player.name    = auth.username || 'Player';
  state.player.balance = Number(auth.balance ?? 0);
  state.player.wins    = Number(auth.wins    ?? 0);
  state.player.losses  = Number(auth.losses  ?? 0);

  const el = $('lobbyBalance');
  if (el) el.textContent = state.player.balance.toLocaleString();
}

// ── Socket ─────────────────────────────────────────────────────────────────
function connectSocket() {
  const socket = io(LUDO_API_URL, {
    transports       : ['websocket', 'polling'],
    reconnectionAttempts: 8,
  });
  state.socket = socket;

  socket.on('connect', () => {
    console.log('[lobby] connected', socket.id);
    if (state.selectedBet) _doSubscribe(state.selectedBet);
  });

  socket.on('disconnect', () => {
    console.warn('[lobby] disconnected');
    state.currentRoomId = null;
  });

  // Full snapshot of all 5 rooms for the subscribed tier
  socket.on('rooms:snapshot', ({ rooms }) => {
    rooms.forEach(r => { state.rooms[r.id] = r; });
    renderRooms();
  });

  // A single room updated (player join/leave, countdown tick)
  socket.on('room:update', room => {
    if (room.betAmount !== state.selectedBet) return;
    state.rooms[room.id] = room;
    renderOneRoom(room.id);
    updateReadyCount();
  });

  // Confirmed: we joined a room
  socket.on('room:joined', ({ room }) => {
    state.currentRoomId  = room.id;
    state.rooms[room.id] = room;
    hideOverlay('joiningOverlay');
    renderRooms();
    toast(`Joined Room #${room.id}!`, 'success');
  });

  socket.on('room:error', ({ error }) => {
    hideOverlay('joiningOverlay');
    toast(error || 'Could not join room', 'error');
  });

  // Game starting — redirect everyone in this room
  socket.on('room:started', ({ roomId, betAmount, players }) => {
    if (roomId !== state.currentRoomId) return;
    hideOverlay('joiningOverlay');
    showOverlay('gameStartingOverlay');

    $('startingPlayersList').textContent = players.map(p => p.name).join(' · ');

    const auth      = JSON.parse(sessionStorage.getItem('appAuth') || '{}');
    const gameState = {
      name          : state.player.name,
      balance       : state.player.balance,
      wins          : state.player.wins,
      losses        : state.player.losses,
      totalWon      : 0,
      totalLost     : 0,
      selectedAmount: betAmount,
      opponent      : players.find(p => p.name !== state.player.name) || { name: 'Opponent' },
      autoStart     : true,
      lobbyPlayers  : players,
    };
    sessionStorage.setItem('ludoGameState', JSON.stringify(gameState));

    const qs = new URLSearchParams();
    if (auth.token)  qs.set('token',  auth.token);
    if (auth.launch) qs.set('launch', auth.launch);

    setTimeout(() => {
      window.location.href = `game.html${qs.toString() ? '?' + qs.toString() : ''}`;
    }, 1800);
  });
}

function _doSubscribe(betAmount) {
  if (!state.socket?.connected) return;
  state.subscribedBet = betAmount;
  state.socket.emit('subscribe:bet', { betAmount });
}

function subscribeToBet(betAmount) {
  if (state.currentRoomId) {
    state.socket?.emit('room:leave');
    state.currentRoomId = null;
  }
  state.subscribedBet = null; // allow re-subscribe
  _doSubscribe(betAmount);
}

// ── Bet picker — show rooms immediately on amount select ──────────────────
document.querySelectorAll('.bet-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    const amt = Number(btn.dataset.amount);

    document.querySelectorAll('.bet-chip').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    // Clear stale rooms from previous tier
    state.rooms      = {};
    state.selectedBet = amt;

    // Always show rooms section — even before socket responds
    $('roomsEmptyState').classList.add('hidden');
    $('roomsHeader').classList.remove('hidden');
    $('roomsTitle').textContent = `AVAILABLE ROOMS — ${amt} ETB`;

    // Show skeleton cards immediately so the UI doesn't look empty
    showSkeletons();

    // Subscribe (will trigger rooms:snapshot from backend)
    subscribeToBet(amt);
  });
});

// ── Skeletons while waiting for socket data ────────────────────────────────
function showSkeletons() {
  const grid = $('roomsGrid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const card = mk('div', 'room-card room-skeleton');
    card.dataset.skeletonRoom = i;
    card.innerHTML = `
      <div class="room-card-top">
        <span class="room-card-id" style="opacity:.4">ROOM #—-${i}</span>
        <span class="room-card-count" style="opacity:.4"><strong>0</strong> / 4 players</span>
        <div class="room-countdown-pill hidden-vis">⏱ —s</div>
      </div>
      <div class="room-players-list">
        ${[1,2,3,4].map(n => `
          <div class="empty-slot-row">
            <div class="empty-slot-avatar">+</div>
            <div class="empty-slot-label">Waiting for player ${n}…</div>
          </div>`).join('')}
      </div>
      <button class="room-join-btn join" disabled>Loading…</button>`;
    grid.appendChild(card);
  }
}

// ── Room rendering ─────────────────────────────────────────────────────────
function renderRooms() {
  const grid = $('roomsGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const myName = state.player.name;

  // Sort: rooms I'm in first, then by player count desc, started last
  const sorted = Object.values(state.rooms)
    .filter(r => r.betAmount === state.selectedBet)
    .sort((a, b) => {
      const aMe = a.players.some(p => p.name === myName) ? 1 : 0;
      const bMe = b.players.some(p => p.name === myName) ? 1 : 0;
      if (aMe !== bMe) return bMe - aMe;
      if (a.status === 'started' && b.status !== 'started') return 1;
      if (b.status === 'started' && a.status !== 'started') return -1;
      return b.players.length - a.players.length;
    });

  if (sorted.length === 0) {
    // Socket hasn't responded yet — keep skeletons
    showSkeletons();
    return;
  }

  sorted.forEach(room => grid.appendChild(buildRoomCard(room)));
  updateReadyCount();
}

function renderOneRoom(roomId) {
  const existing = document.querySelector(`[data-room-id="${roomId}"]`);
  const room     = state.rooms[roomId];
  if (!room) return;
  if (existing) {
    existing.replaceWith(buildRoomCard(room));
  } else {
    renderRooms();
  }
}

function updateReadyCount() {
  const total = Object.values(state.rooms)
    .filter(r => r.betAmount === state.selectedBet)
    .reduce((s, r) => s + r.players.length, 0);
  const badge = $('roomsReadyCount');
  if (badge) badge.textContent = `${total} Ready`;
}

// ── Build one room card ────────────────────────────────────────────────────
function buildRoomCard(room) {
  const myName  = state.player.name;
  const iAmHere = room.players.some(p => p.name === myName);
  const count   = room.players.length;
  const isFull  = count >= 4;
  const started = room.status === 'started';
  const inOther = Boolean(state.currentRoomId && state.currentRoomId !== room.id);

  const card = mk('div', [
    'room-card',
    iAmHere  ? 'has-me'  : '',
    started  ? 'started' : '',
    count > 0 && !iAmHere && !started ? 'has-players' : '',
  ].filter(Boolean).join(' '));
  card.dataset.roomId = room.id;

  // ── Top row ──────────────────────────────────────────────────────────
  const topRow  = mk('div', 'room-card-top');

  const idSpan  = mk('span', 'room-card-id');
  idSpan.textContent = `ROOM #${room.id}`;

  const cntSpan = mk('span', 'room-card-count');
  cntSpan.innerHTML  = `<strong>${count}</strong> / 4 players`;

  // Status badge  (waiting / countdown / started)
  const statusBadge = mk('span', `room-status-badge status-${room.status}`);
  statusBadge.textContent =
    started          ? '🎮 In Game'   :
    room.status === 'countdown' ? '⏳ Starting…' :
    count === 0      ? '🟢 Empty'     : '👥 Open';

  topRow.append(idSpan, cntSpan, statusBadge);
  card.appendChild(topRow);

  // Countdown bar (only during countdown)
  if (room.status === 'countdown' && room.countdown > 0) {
    const cdRow = mk('div', 'room-cd-row');
    const pill  = mk('div', `room-countdown-pill${room.countdown <= 8 ? ' urgent' : ''}`);
    pill.innerHTML = `⏱ <span>${room.countdown}s</span>`;
    const bar   = mk('div', 'room-cd-bar');
    const fill  = mk('div', 'room-cd-fill');
    fill.style.width = `${(room.countdown / 30) * 100}%`;
    if (room.countdown <= 8) fill.classList.add('urgent');
    bar.appendChild(fill);
    cdRow.append(pill, bar);
    card.appendChild(cdRow);
  }

  // ── Players list ─────────────────────────────────────────────────────
  const list    = mk('div', 'room-players-list');
  const showVs  = count === 2;

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
    const inGameBadge = mk('div', 'room-ingame-badge');
    inGameBadge.textContent = '🎮 Game in progress';
    card.appendChild(inGameBadge);
  } else if (iAmHere) {
    const leaveBtn = mk('button', 'room-join-btn leave');
    leaveBtn.textContent = '✗ Leave Room';
    leaveBtn.addEventListener('click', handleLeave);
    card.appendChild(leaveBtn);

    if (count >= 2 && room.status === 'countdown') {
      const playBtn = mk('button', 'room-play-btn');
      playBtn.disabled = true;
      playBtn.innerHTML = `▶ Starting in ${room.countdown}s…`;
      card.appendChild(playBtn);
    } else if (count === 1) {
      // I'm the only one — show a "waiting" message
      const waitMsg = mk('div', 'room-wait-msg');
      waitMsg.innerHTML = `<span>⏳ Waiting for more players to join…</span>`;
      card.appendChild(waitMsg);
    }
  } else {
    // Not in this room — show Join button
    const joinBtn = mk('button', 'room-join-btn join');
    if (isFull) {
      joinBtn.textContent = '🔒 Full';
      joinBtn.disabled = true;
    } else if (inOther) {
      joinBtn.textContent = '⚠ Leave your room first';
      joinBtn.disabled = true;
    } else {
      joinBtn.innerHTML = count === 0
        ? '+ Create Room (join first)'
        : `+ Join Room (${count}/4)`;
      joinBtn.addEventListener('click', () => handleJoin(room.id));
    }
    card.appendChild(joinBtn);
  }

  return card;
}

// ── Player mini-card ──────────────────────────────────────────────────────
function buildPlayerCard(player, myName, betAmount) {
  const isMe   = player.name === myName;
  const card   = mk('div', `player-mini-card${isMe ? ' is-me' : ''}`);
  const colors = ['#7c6af7','#f0b133','#36e89c','#ff4465','#4e94ff','#ff9040','#30c0c0'];
  const color  = colors[Math.abs(hashCode(player.name)) % colors.length];
  const init   = (player.name || 'P').charAt(0).toUpperCase();

  card.innerHTML = `
    <div class="pm-avatar online" style="background:${color}">${init}</div>
    <div class="pm-info">
      <div class="pm-name">
        ${escHtml(player.name)}
        ${isMe
          ? '<span class="pm-you-tag">YOU</span>'
          : '<span class="pm-online-tag">Online</span>'}
      </div>
      <div class="pm-stats">
        <span class="pm-stat wins">✓ ${player.wins   ?? 0}</span>
        <span class="pm-stat losses">✗ ${player.losses ?? 0}</span>
        <span class="pm-stat coins">🪙 ${player.balance ?? 0}</span>
      </div>
    </div>
    <div class="pm-right">
      <span class="pm-bet-pill">${betAmount} ETB</span>
      ${player.balance != null
        ? `<span class="pm-balance">Balance: ${Number(player.balance).toLocaleString()} ETB</span>`
        : ''}
    </div>`;
  return card;
}

function buildVsDivider() {
  const row = mk('div', 'room-vs-row');
  row.innerHTML = `
    <div class="room-vs-line"></div>
    <div class="room-vs-badge">VS</div>
    <div class="room-vs-line"></div>`;
  return row;
}

function buildEmptySlot(slotNum) {
  const row = mk('div', 'empty-slot-row');
  row.innerHTML = `
    <div class="empty-slot-avatar">+</div>
    <div class="empty-slot-label">Waiting for player ${slotNum}…</div>`;
  return row;
}

// ── Join / Leave ───────────────────────────────────────────────────────────
function handleJoin(roomId) {
  if (!state.socket?.connected) {
    toast('Connecting… try again in a moment', 'error'); return;
  }
  if (state.currentRoomId) {
    toast('Leave your current room first', 'error'); return;
  }
  // Only check balance at join time, not when displaying rooms
  if (state.player.balance < state.selectedBet) {
    toast(`You need ${state.selectedBet} ETB to join this room`, 'error'); return;
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

  // Auto-dismiss joining overlay if server is silent for 6s
  setTimeout(() => {
    if ($('joiningOverlay')?.getAttribute('aria-hidden') === 'false') {
      hideOverlay('joiningOverlay');
      toast('Server not responding — try again', 'error');
    }
  }, 6000);
}

function handleLeave() {
  if (!state.currentRoomId) return;
  state.socket?.emit('room:leave');
  state.currentRoomId = null;
  toast('Left the room', 'info');
}

// ── Cancel joining overlay ─────────────────────────────────────────────────
$('joiningCancelBtn')?.addEventListener('click', () => {
  hideOverlay('joiningOverlay');
  handleLeave();
});

// ── Back button ────────────────────────────────────────────────────────────
$('lobbyBackBtn')?.addEventListener('click', () => {
  handleLeave();
  const auth = JSON.parse(sessionStorage.getItem('appAuth') || '{}');
  const qs   = new URLSearchParams();
  if (auth.token)  qs.set('token',  auth.token);
  if (auth.launch) qs.set('launch', auth.launch);
  window.location.href = `index.html${qs.toString() ? '?' + qs.toString() : ''}`;
});

// ── Utilities ──────────────────────────────────────────────────────────────
function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return h;
}
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
(async function init() {
  await initAuth();
  connectSocket();

  // If redirected from index.html with a pre-selected bet, auto-select it
  const params    = new URLSearchParams(window.location.search);
  const presetBet = Number(params.get('bet'));
  if (presetBet) {
    const chip = document.querySelector(`.bet-chip[data-amount="${presetBet}"]`);
    if (chip) chip.click();
  }
})();
