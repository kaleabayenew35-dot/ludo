/* ================================================================
   lobby.js  —  Ludo Bet Rooms
   ================================================================
   STRATEGY
   ─────────
   1. On chip click → fetch rooms via plain HTTP GET /api/rooms?bet=N
      → renders immediately, NO socket needed to see rooms.

   2. Socket.io connects in background → when ready it subscribes
      for live room:update events (countdown ticks, player joins).

   3. Join/Leave → try HTTP first (always works), socket emits as
      bonus for instant broadcast to other viewers.

   4. room:started (socket) → redirect to game.html.

   socket.io loaded as global via <script> in lobby.html.
   ================================================================ */

var LUDO_API_URL       = (window.__LUDO_BACKEND_URL__   || 'https://ludo-backend-wykz.onrender.com').replace(/\/$/, '');
var SYSTEM_BACKEND_URL = (window.__SYSTEM_BACKEND_URL__ || 'https://system-backend-1u5m.onrender.com').replace(/\/$/, '');
var POLL_MS            = 4000; // HTTP poll interval as fallback when no socket

// ── State ──────────────────────────────────────────────────────────────────
var state = {
  player        : { name: 'Player', balance: 0, wins: 0, losses: 0 },
  selectedBet   : 0,
  currentRoomId : null,
  rooms         : {},        // roomId → room object
  socket        : null,
  socketReady   : false,
  pollTimer     : null,
};

// ── DOM ────────────────────────────────────────────────────────────────────
function eid(id)       { return document.getElementById(id); }
function mk(tag, cls)  { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
function show(id)      { var el = eid(id); if (el) el.setAttribute('aria-hidden','false'); }
function hide(id)      { var el = eid(id); if (el) el.setAttribute('aria-hidden','true');  }

function toast(msg, type) {
  type = type || 'info';
  var t = mk('div', 'toast ' + type);
  t.textContent = msg;
  eid('toastContainer').appendChild(t);
  setTimeout(function(){ t.parentNode && t.parentNode.removeChild(t); }, 3000);
}

// ── Auth ───────────────────────────────────────────────────────────────────
function initAuth() {
  var params = new URLSearchParams(window.location.search);
  var token  = params.get('token');
  var launch = params.get('launch');

  if (token && launch) sessionStorage.setItem('appAuth', JSON.stringify({ token: token, launch: launch }));
  else if (token)      sessionStorage.setItem('appAuth', JSON.stringify({ token: token }));

  var auth = JSON.parse(sessionStorage.getItem('appAuth') || '{}');

  // Use whatever we have in session — resolve from system_backend in background
  state.player.name    = auth.username || auth.user || 'Player';
  state.player.balance = Number(auth.balance || 0);
  state.player.wins    = Number(auth.wins    || 0);
  state.player.losses  = Number(auth.losses  || 0);

  var balEl = eid('lobbyBalance');
  if (balEl) balEl.textContent = state.player.balance.toLocaleString();

  // Resolve real balance async — update display when done
  if (auth.launch) {
    fetch(SYSTEM_BACKEND_URL + '/api/verify-launch-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ launch: auth.launch }),
      cache: 'no-store',
    })
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (data && data.valid !== false) {
        state.player.name    = data.username || data.user && data.user.username || state.player.name;
        state.player.balance = Number(data.balance != null ? data.balance : (data.user && data.user.balance != null ? data.user.balance : state.player.balance));
        auth.username = state.player.name;
        auth.balance  = state.player.balance;
        sessionStorage.setItem('appAuth', JSON.stringify(auth));
        var b = eid('lobbyBalance');
        if (b) b.textContent = state.player.balance.toLocaleString();
      }
    })
    .catch(function(e){ console.warn('[lobby] auth resolve failed', e); });
  }
}

// ── HTTP: load rooms ────────────────────────────────────────────────────────
function fetchRooms(bet) {
  return fetch(LUDO_API_URL + '/api/rooms?bet=' + bet, { cache: 'no-store' })
    .then(function(r){
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(data){
      return data.rooms || [];
    });
}

// ── HTTP: join room ─────────────────────────────────────────────────────────
function httpJoin(roomId) {
  return fetch(LUDO_API_URL + '/api/rooms/' + encodeURIComponent(roomId) + '/join', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ player: {
      name   : state.player.name,
      wins   : state.player.wins,
      losses : state.player.losses,
      balance: state.player.balance,
    }}),
  })
  .then(function(r){ return r.json(); });
}

// ── HTTP: leave room ────────────────────────────────────────────────────────
function httpLeave(roomId) {
  if (!roomId) return Promise.resolve();
  return fetch(LUDO_API_URL + '/api/rooms/' + encodeURIComponent(roomId) + '/leave', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ name: state.player.name }),
  }).catch(function(){});
}

// ── Polling fallback (when socket not connected) ────────────────────────────
function startPolling() {
  stopPolling();
  if (!state.selectedBet) return;
  state.pollTimer = setInterval(function(){
    if (state.socketReady) { stopPolling(); return; } // socket took over
    if (!state.selectedBet) return;
    fetchRooms(state.selectedBet).then(function(rooms){
      rooms.forEach(function(r){ state.rooms[r.id] = r; });
      renderRooms();
    }).catch(function(){});
  }, POLL_MS);
}

function stopPolling() {
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
}

// ── Socket (live updates only — display never depends on it) ────────────────
function connectSocket() {
  if (typeof io === 'undefined') {
    console.warn('[lobby] socket.io not loaded, HTTP-only mode');
    return;
  }
  var socket;
  try {
    socket = io(LUDO_API_URL, {
      transports          : ['websocket', 'polling'],
      reconnectionAttempts: 5,
      timeout             : 8000,
    });
  } catch(e) {
    console.warn('[lobby] socket init failed', e);
    return;
  }
  state.socket = socket;

  socket.on('connect', function(){
    console.log('[lobby] socket connected', socket.id);
    state.socketReady = true;
    stopPolling();
    if (state.selectedBet) {
      socket.emit('subscribe:bet', { betAmount: state.selectedBet });
    }
  });

  socket.on('disconnect', function(){
    console.warn('[lobby] socket disconnected');
    state.socketReady = false;
    // Fall back to HTTP polling
    startPolling();
  });

  socket.on('connect_error', function(e){
    console.warn('[lobby] socket error', e.message);
    state.socketReady = false;
    startPolling();
  });

  // Live snapshot when we subscribe to a tier
  socket.on('rooms:snapshot', function(data){
    var rooms = data.rooms || [];
    rooms.forEach(function(r){ state.rooms[r.id] = r; });
    renderRooms();
  });

  // Single room updated
  socket.on('room:update', function(room){
    if (room.betAmount !== state.selectedBet) return;
    state.rooms[room.id] = room;
    renderOneRoom(room.id);
    updateReadyCount();
  });

  // Game starting
  socket.on('room:started', function(payload){
    var roomId    = payload.roomId;
    var betAmount = payload.betAmount;
    var players   = payload.players;
    if (roomId !== state.currentRoomId) return;
    hide('joiningOverlay');
    show('gameStartingOverlay');
    var pl = eid('startingPlayersList');
    if (pl) pl.textContent = players.map(function(p){ return p.name; }).join(' · ');
    redirectToGame(betAmount, players);
  });
}

function redirectToGame(betAmount, players) {
  var auth = JSON.parse(sessionStorage.getItem('appAuth') || '{}');
  var gameState = {
    name          : state.player.name,
    balance       : state.player.balance,
    wins          : state.player.wins,
    losses        : state.player.losses,
    totalWon      : 0,
    totalLost     : 0,
    selectedAmount: betAmount,
    opponent      : players.filter(function(p){ return p.name !== state.player.name; })[0] || { name: 'Opponent' },
    autoStart     : true,
    lobbyPlayers  : players,
  };
  sessionStorage.setItem('ludoGameState', JSON.stringify(gameState));
  var qs = new URLSearchParams();
  if (auth.token)  qs.set('token',  auth.token);
  if (auth.launch) qs.set('launch', auth.launch);
  setTimeout(function(){
    window.location.href = 'game.html' + (qs.toString() ? '?' + qs.toString() : '');
  }, 1800);
}

// ── Bet chip click ─────────────────────────────────────────────────────────
document.querySelectorAll('.bet-chip').forEach(function(btn){
  btn.addEventListener('click', function(){
    var amt = Number(btn.dataset.amount);

    document.querySelectorAll('.bet-chip').forEach(function(b){ b.classList.remove('selected'); });
    btn.classList.add('selected');

    state.rooms       = {};
    state.selectedBet = amt;

    // Show header immediately
    var emptyState = eid('roomsEmptyState');
    var header     = eid('roomsHeader');
    var title      = eid('roomsTitle');
    if (emptyState) emptyState.classList.add('hidden');
    if (header)     header.classList.remove('hidden');
    if (title)      title.textContent = 'AVAILABLE ROOMS — ' + amt + ' ETB';

    // Show skeletons immediately so there's always something visible
    showSkeletons(amt);

    // ── FETCH ROOMS VIA HTTP RIGHT NOW ──────────────────────────────────
    fetchRooms(amt)
      .then(function(rooms){
        if (state.selectedBet !== amt) return; // user switched bet before response
        rooms.forEach(function(r){ state.rooms[r.id] = r; });
        renderRooms();
        // Start polling as fallback in case socket never connects
        startPolling();
      })
      .catch(function(e){
        console.error('[lobby] fetchRooms failed', e);
        toast('Could not load rooms — retrying…', 'error');
        startPolling(); // keep retrying via poll
      });

    // Tell socket to subscribe (if already connected)
    if (state.socketReady && state.socket) {
      state.socket.emit('subscribe:bet', { betAmount: amt });
    }
  });
});

// ── Skeletons ──────────────────────────────────────────────────────────────
function showSkeletons(bet) {
  var grid = eid('roomsGrid');
  if (!grid) return;
  grid.innerHTML = '';
  for (var i = 1; i <= 5; i++) {
    var card = mk('div', 'room-card room-skeleton');
    card.setAttribute('data-skeleton', i);
    card.innerHTML =
      '<div class="room-card-top">' +
        '<span class="room-card-count" style="opacity:.35"><strong>0</strong> / 4 players</span>' +
        '<span class="room-status-badge status-waiting">🟢 Empty</span>' +
      '</div>' +
      '<div class="room-players-list">' +
        buildEmptySlotHTML(1) + buildEmptySlotHTML(2) +
        buildEmptySlotHTML(3) + buildEmptySlotHTML(4) +
      '</div>' +
      '<button class="room-join-btn join" disabled>+ Join Room</button>';
    grid.appendChild(card);
  }
}

// ── Render all rooms ───────────────────────────────────────────────────────
function renderRooms() {
  var grid = eid('roomsGrid');
  if (!grid) return;

  var myName = state.player.name;
  var all    = Object.values(state.rooms).filter(function(r){ return r.betAmount === state.selectedBet; });

  if (all.length === 0) return; // keep skeletons

  all.sort(function(a, b){
    var aMe = a.players.some(function(p){ return p.name === myName; }) ? 1 : 0;
    var bMe = b.players.some(function(p){ return p.name === myName; }) ? 1 : 0;
    if (aMe !== bMe) return bMe - aMe;
    if (a.status === 'started') return 1;
    if (b.status === 'started') return -1;
    return b.players.length - a.players.length;
  });

  grid.innerHTML = '';
  all.forEach(function(room){ grid.appendChild(buildRoomCard(room)); });
  updateReadyCount();
}

function renderOneRoom(roomId) {
  var room     = state.rooms[roomId];
  if (!room) return;
  var existing = document.querySelector('[data-room-id="' + roomId + '"]');
  if (existing) {
    existing.parentNode.replaceChild(buildRoomCard(room), existing);
  } else {
    renderRooms(); // first real data arrives — replace all skeletons
  }
}

function updateReadyCount() {
  var total = Object.values(state.rooms)
    .filter(function(r){ return r.betAmount === state.selectedBet; })
    .reduce(function(s, r){ return s + r.players.length; }, 0);
  var badge = eid('roomsReadyCount');
  if (badge) badge.textContent = total + ' Ready';
}

// ── Build room card ────────────────────────────────────────────────────────
function buildRoomCard(room) {
  var myName  = state.player.name;
  var iAmHere = room.players.some(function(p){ return p.name === myName; });
  var count   = room.players.length;
  var isFull  = count >= 4;
  var started = room.status === 'started';
  var inOther = !!(state.currentRoomId && state.currentRoomId !== room.id);

  var classes = ['room-card'];
  if (iAmHere) classes.push('has-me');
  if (started) classes.push('started');
  if (count > 0 && !iAmHere && !started) classes.push('has-players');
  var card = mk('div', classes.join(' '));
  card.setAttribute('data-room-id', room.id);

  // Top row
  var topRow = mk('div', 'room-card-top');
  var cntSpan = mk('span', 'room-card-count');
  cntSpan.innerHTML = '<strong>' + count + '</strong> / 4 players';
  var badge = mk('span', 'room-status-badge status-' + room.status);
  badge.textContent = started ? '🎮 In Game' :
    room.status === 'countdown' ? '⏳ Starting…' :
    count === 0 ? '🟢 Empty' : '👥 Open';
  topRow.appendChild(cntSpan);
  topRow.appendChild(badge);
  card.appendChild(topRow);

  // Countdown bar
  if (room.status === 'countdown' && room.countdown > 0) {
    var cdRow = mk('div', 'room-cd-row');
    var pill  = mk('div', 'room-countdown-pill' + (room.countdown <= 8 ? ' urgent' : ''));
    pill.innerHTML = '⏱ <span>' + room.countdown + 's</span>';
    var bar  = mk('div', 'room-cd-bar');
    var fill = mk('div', 'room-cd-fill' + (room.countdown <= 8 ? ' urgent' : ''));
    fill.style.width = Math.round((room.countdown / 30) * 100) + '%';
    bar.appendChild(fill);
    cdRow.appendChild(pill);
    cdRow.appendChild(bar);
    card.appendChild(cdRow);
  }

  // Players list
  var list   = mk('div', 'room-players-list');
  var showVs = count === 2;
  room.players.forEach(function(p, idx){
    list.appendChild(buildPlayerCard(p, myName, room.betAmount));
    if (showVs && idx === 0) list.appendChild(buildVsDivider());
  });
  for (var i = count; i < 4; i++) {
    var emptyRow = mk('div', 'empty-slot-row');
    emptyRow.innerHTML = buildEmptySlotHTML(i + 1);
    list.appendChild(emptyRow);
  }
  card.appendChild(list);

  // Action button
  if (started) {
    var inGameMsg = mk('div', 'room-ingame-badge');
    inGameMsg.textContent = '🎮 Game in progress';
    card.appendChild(inGameMsg);
  } else if (iAmHere) {
    var leaveBtn = mk('button', 'room-join-btn leave');
    leaveBtn.textContent = '✗ Leave Room';
    leaveBtn.addEventListener('click', handleLeave);
    card.appendChild(leaveBtn);
    if (count >= 2 && room.status === 'countdown') {
      var playBtn = mk('button', 'room-play-btn');
      playBtn.disabled = true;
      playBtn.textContent = '▶ Starting in ' + room.countdown + 's…';
      card.appendChild(playBtn);
    } else if (count === 1) {
      var waitMsg = mk('div', 'room-wait-msg');
      waitMsg.textContent = '⏳ Waiting for more players to join…';
      card.appendChild(waitMsg);
    }
  } else {
    var joinBtn = mk('button', 'room-join-btn join');
    if (isFull) {
      joinBtn.textContent = '🔒 Full';
      joinBtn.disabled = true;
    } else if (inOther) {
      joinBtn.textContent = '⚠ Leave your room first';
      joinBtn.disabled = true;
    } else {
      joinBtn.textContent = count === 0 ? '+ Create Room' : '+ Join Room (' + count + '/4)';
      (function(rid){ joinBtn.addEventListener('click', function(){ handleJoin(rid); }); })(room.id);
    }
    card.appendChild(joinBtn);
  }

  return card;
}

// ── Player card ────────────────────────────────────────────────────────────
function buildPlayerCard(player, myName, betAmount) {
  var isMe  = player.name === myName;
  var card  = mk('div', 'player-mini-card' + (isMe ? ' is-me' : ''));
  var colors = ['#7c6af7','#f0b133','#36e89c','#ff4465','#4e94ff','#ff9040','#30c0c0'];
  var color  = colors[Math.abs(hashCode(player.name)) % colors.length];
  var init   = (player.name || 'P').charAt(0).toUpperCase();
  card.innerHTML =
    '<div class="pm-avatar online" style="background:' + color + '">' + escHtml(init) + '</div>' +
    '<div class="pm-info">' +
      '<div class="pm-name">' + escHtml(player.name) +
        (isMe ? '<span class="pm-you-tag">YOU</span>' : '<span class="pm-online-tag">Online</span>') +
      '</div>' +
      '<div class="pm-stats">' +
        '<span class="pm-stat wins">✓ ' + (player.wins || 0) + '</span>' +
        '<span class="pm-stat losses">✗ ' + (player.losses || 0) + '</span>' +
        '<span class="pm-stat coins">🪙 ' + (player.balance || 0) + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="pm-right">' +
      '<span class="pm-bet-pill">' + betAmount + ' ETB</span>' +
      (player.balance != null ? '<span class="pm-balance">Balance: ' + Number(player.balance).toLocaleString() + ' ETB</span>' : '') +
    '</div>';
  return card;
}

function buildVsDivider() {
  var row = mk('div', 'room-vs-row');
  row.innerHTML = '<div class="room-vs-line"></div><div class="room-vs-badge">VS</div><div class="room-vs-line"></div>';
  return row;
}

function buildEmptySlotHTML(n) {
  return '<div class="empty-slot-row">' +
    '<div class="empty-slot-avatar">+</div>' +
    '<div class="empty-slot-label">Waiting for player ' + n + '…</div>' +
  '</div>';
}

// ── Join ───────────────────────────────────────────────────────────────────
function handleJoin(roomId) {
  if (state.currentRoomId) { toast('Leave your current room first', 'error'); return; }
  if (state.player.balance < state.selectedBet) {
    toast('You need ' + state.selectedBet + ' ETB to join', 'error'); return;
  }

  var labelEl = eid('joiningRoomLabel');
  if (labelEl) labelEl.textContent = 'Room #' + roomId;
  show('joiningOverlay');

  httpJoin(roomId)
    .then(function(data){
      if (!data.ok) throw new Error(data.error || 'Join failed');
      state.currentRoomId = roomId;
      state.rooms[roomId] = data.room;
      hide('joiningOverlay');
      renderRooms();
      toast('Joined Room #' + roomId + '!', 'success');
      // Also tell socket so other live viewers update
      if (state.socketReady && state.socket) {
        state.socket.emit('room:join', {
          roomId: roomId,
          player: { name: state.player.name, wins: state.player.wins,
                    losses: state.player.losses, balance: state.player.balance },
        });
      }
    })
    .catch(function(e){
      hide('joiningOverlay');
      toast(e.message || 'Could not join room', 'error');
    });
}

// ── Leave ──────────────────────────────────────────────────────────────────
function handleLeave() {
  if (!state.currentRoomId) return;
  var roomId = state.currentRoomId;
  state.currentRoomId = null;
  httpLeave(roomId).then(function(){
    toast('Left the room', 'info');
    // Refresh rooms display
    fetchRooms(state.selectedBet).then(function(rooms){
      rooms.forEach(function(r){ state.rooms[r.id] = r; });
      renderRooms();
    }).catch(function(){});
  });
  if (state.socketReady && state.socket) state.socket.emit('room:leave');
}

// ── Cancel / Back ──────────────────────────────────────────────────────────
var cancelBtn = eid('joiningCancelBtn');
if (cancelBtn) cancelBtn.addEventListener('click', function(){ hide('joiningOverlay'); handleLeave(); });

var backBtn = eid('lobbyBackBtn');
if (backBtn) backBtn.addEventListener('click', function(){
  handleLeave();
  var auth = JSON.parse(sessionStorage.getItem('appAuth') || '{}');
  var qs   = new URLSearchParams();
  if (auth.token)  qs.set('token',  auth.token);
  if (auth.launch) qs.set('launch', auth.launch);
  window.location.href = 'index.html' + (qs.toString() ? '?' + qs.toString() : '');
});

// ── Utilities ──────────────────────────────────────────────────────────────
function hashCode(str) {
  var h = 0;
  for (var i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return h;
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Boot ───────────────────────────────────────────────────────────────────
initAuth();
connectSocket();   // starts in background — display never waits for it

// Auto-select bet if passed in URL
var _presetBet = Number(new URLSearchParams(window.location.search).get('bet'));
if (_presetBet) {
  var _chip = document.querySelector('.bet-chip[data-amount="' + _presetBet + '"]');
  if (_chip) _chip.click();
}
