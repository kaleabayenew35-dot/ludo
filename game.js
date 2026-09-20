'use strict';
/* ============================================================
   LUDO — GAME ENGINE  (game.html)
   Reads player/bet state from sessionStorage set by index.html
   ============================================================ */

// ── Board geometry (same as main script) ─────────────────────
const MAIN_PATH = [
  [6,1],[6,2],[6,3],[6,4],[6,5],
  [5,6],[4,6],[3,6],[2,6],[1,6],[0,6],
  [0,7],[0,8],
  [1,8],[2,8],[3,8],[4,8],[5,8],
  [6,9],[6,10],[6,11],[6,12],[6,13],[6,14],
  [7,14],
  [8,14],[8,13],[8,12],[8,11],[8,10],[8,9],
  [9,8],[10,8],[11,8],[12,8],[13,8],[14,8],
  [14,7],[14,6],
  [13,6],[12,6],[11,6],[10,6],[9,6],
  [8,5],[8,4],[8,3],[8,2],[8,1],[8,0],
  [7,0],[6,0]
];
const SAFE_POSITIONS = new Set([0,8,13,21,26,34,39,47]);
// ── Board corner layout ──────────────────────────────────────
// ┌────────────┬────────────┐
// │  GREEN(TL) │   RED(TR)  │
// ├────────────┼────────────┤
// │ YELLOW(BL) │  BLUE(BR)  │
// └────────────┴────────────┘
// 2-player pairs: Green+Blue (diagonal) or Yellow+Red (diagonal)

// Home-column runways (5 cells leading toward center)
// green  → left  arm  (row 7, cols 1-5)   → bc-hc-g
// red    → top   arm  (col 7, rows 1-5)   → bc-hc-r
// blue   → right arm  (row 7, cols 9-13)  → bc-hc-b
// yellow → bottom arm (col 7, rows 9-13)  → bc-hc-y
const HOME_COLS = {
  green:  [[7,1],[7,2],[7,3],[7,4],[7,5]],     // left  arm (bc-hc-g)
  red:    [[1,7],[2,7],[3,7],[4,7],[5,7]],      // top   arm (bc-hc-r)
  blue:   [[7,13],[7,12],[7,11],[7,10],[7,9]],  // right arm (bc-hc-b)
  yellow: [[13,7],[12,7],[11,7],[10,7],[9,7]]   // bottom arm(bc-hc-y)
};
// Path index where each color's pieces enter the main track
const ENTRY_POS      = { green:0, red:13, blue:26, yellow:39 };
// Path index at which a piece diverts into its home-column runway
const HOME_COL_ENTRY = { green:50, red:11, blue:24, yellow:37 };
// Starting home slots — each color in its own board corner
const HOME_SLOTS = {
  green:  [[1,1],[1,4],[4,1],[4,4]],            // top-left     (bc-gh area)
  red:    [[1,10],[1,13],[4,10],[4,13]],         // top-right    (bc-rh area)
  blue:   [[10,10],[10,13],[13,10],[13,13]],     // bottom-right (bc-bh area)
  yellow: [[10,1],[10,4],[13,1],[13,4]]          // bottom-left  (bc-yh area)
};

const COLORS     = ['red','blue','green','yellow'];
const DICE_FACES = ['⚀','⚁','⚂','⚃','⚄','⚅'];
const LUDO_API_URL = (window.__LUDO_BACKEND_URL__ || 'https://ludo-backend-wykz.onrender.com').replace(/\/$/, '');
const GAME_SOCKET = typeof io !== 'undefined' ? io(LUDO_API_URL, { transports: ['websocket', 'polling'] }) : null;

function getColorOrderForPlayerCount(playerCount, roomId) {
  const safeCount = Math.min(Math.max(Number(playerCount) || 2, 2), 4);
  if (safeCount === 2) {
    // Two diagonal pairs that sit in opposite corners:
    //   green(TL) + blue(BR)   — even room numbers
    //   yellow(BL) + red(TR)   — odd  room numbers
    const roomNumber = Number(String(roomId || '').split('-').pop());
    return Number.isInteger(roomNumber) && roomNumber % 2 === 0
      ? ['green', 'blue']
      : ['yellow', 'red'];
  }
  if (safeCount === 3) return ['green', 'red', 'yellow'];
  return ['green', 'red', 'blue', 'yellow'];
}

// ── Load state from sessionStorage ───────────────────────────
const saved = JSON.parse(sessionStorage.getItem('ludoGameState') || '{}');
const player = {
  name:      saved.name      || '',
  balance:   saved.balance   ?? 0,
  wins:      saved.wins      || 0,
  losses:    saved.losses    || 0,
  draws:     saved.draws     || 0,
  totalWon:  saved.totalWon  || 0,
  totalLost: saved.totalLost || 0
};
const selectedAmount = saved.selectedAmount || 10;
const opponent       = saved.opponent       || { name: 'AI' };
const autoStart      = saved.autoStart      || false;
const roomId          = saved.roomId || null;
const lobbyPlayers   = Array.isArray(saved.lobbyPlayers) ? saved.lobbyPlayers.filter(Boolean) : [];
const playerCount    = Math.min(Math.max(lobbyPlayers.length || 2, 2), 4);

// Color rosters — ONLY the colors that are actually playing
// Board layout:  green(TL)  red(TR)
//                yellow(BL) blue(BR)
// 2 players: green+blue  (TL↔BR diagonal) or yellow+red (BL↔TR diagonal)
// 3 players: green + red + yellow
// 4 players: green + red + blue + yellow
const ACTIVE_COLORS = playerCount === 2
  ? getColorOrderForPlayerCount(playerCount, roomId)
  : playerCount === 3
    ? ['green', 'red', 'yellow']
    : ['green', 'red', 'blue', 'yellow'];

const localPlayerIndex = lobbyPlayers.findIndex(lobbyPlayer => String(lobbyPlayer.name) === String(player.name));
const lobbyColorMap = {};
ACTIVE_COLORS.forEach((color, idx) => {
  const lobbyEntry = lobbyPlayers[idx];
  if (lobbyEntry && lobbyEntry.color && ACTIVE_COLORS.includes(lobbyEntry.color)) {
    lobbyColorMap[color] = lobbyEntry.color;
  }
});
const localColor = saved.playerColor && ACTIVE_COLORS.includes(saved.playerColor)
  ? saved.playerColor
  : (lobbyPlayers[localPlayerIndex] && lobbyPlayers[localPlayerIndex].color && ACTIVE_COLORS.includes(lobbyPlayers[localPlayerIndex].color)
      ? lobbyPlayers[localPlayerIndex].color
      : ACTIVE_COLORS[Math.max(0, localPlayerIndex)]);

// ── Game state ────────────────────────────────────────────────
// ── Game state ────────────────────────────────────────────────
const G = {
  active: false,
  started: false,
  turn: 0,
  diceValue: 0,
  rolled: false,
  pieces: { red:[-1,-1,-1,-1], blue:[-1,-1,-1,-1], green:[-1,-1,-1,-1], yellow:[-1,-1,-1,-1] },
  finished: { red:0, blue:0, green:0, yellow:0 },
  eliminated: { red:false, blue:false, green:false, yellow:false }, // true = player has lost / left
  winnerColor: null,
  log: []
};


// Duplicate game state definition removed – kept single definition above

// ── DOM helpers ───────────────────────────────────────────────
const $ = id => document.getElementById(id);
const make = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };

function toast(msg, type = 'info') {
  const t = make('div', `toast ${type}`);
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  t.textContent = `${icon}  ${msg}`;
  $('toastContainer').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
function showOverlay(id) { $(id).setAttribute('aria-hidden','false'); }
function hideOverlay(id) { $(id).setAttribute('aria-hidden','true'); }
function formatMoney(n) { return '$' + Math.abs(n).toFixed(0); }

// ── Header sync ───────────────────────────────────────────────
function syncHeader() {
  const balEl = $('gameBalance');
  if (balEl) balEl.textContent = formatMoney(player.balance);
  const betEl = $('gameBetAmt');
  if (betEl) betEl.textContent = '$' + selectedAmount;
}
syncHeader();

// ── Timer ─────────────────────────────────────────────────────
let turnTimer = null;
let secondsLeft = 60;
let presenceTimer = null;

function stopTurnTimer() {
  if (turnTimer) { clearInterval(turnTimer); turnTimer = null; }
}

function stopPresenceWatch() {
  if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; }
}

function notifyRoomLeave() {
  if (!roomId || !player.name) return;
  fetch(`${LUDO_API_URL}/api/rooms/${encodeURIComponent(roomId)}/leave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: player.name }),
    keepalive: true,
  }).catch(() => {});
}

// Notify the backend that the game has ended so the room resets to 'waiting'.
// Called once by endGame() — fires both a socket event and an HTTP endpoint.
function notifyGameEnd() {
  if (!roomId) return;
  // Socket is the fastest path — backend resets room immediately
  if (GAME_SOCKET?.connected) {
    GAME_SOCKET.emit('game:over', { roomId, winnerColor: G.winnerColor });
  }
  // HTTP fallback: also hits the REST reset endpoint (keepalive so it survives page unload)
  fetch(`${LUDO_API_URL}/api/rooms/${encodeURIComponent(roomId)}/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ winnerColor: G.winnerColor }),
    keepalive: true,
  }).catch(() => {});
}

function eliminatePlayer(color) {
  if (!ACTIVE_COLORS.includes(color) || G.eliminated[color]) return;
  G.eliminated[color] = true;
  removePlayerPieces(color);
  addLog(`${color.charAt(0).toUpperCase() + color.slice(1)} left the game.`, 'move');
  updateGameUI();
  const alive = ACTIVE_COLORS.filter(activeColor => !G.eliminated[activeColor]);
  if (alive.length === 1 && G.started) declareWinner(alive[0]);
}

function startPresenceWatch() {
  stopPresenceWatch();
  if (!roomId || !lobbyPlayers.length) return;
  const checkPresence = async () => {
    if (!G.started) return;
    try {
      const response = await fetch(`${LUDO_API_URL}/api/rooms?bet=${encodeURIComponent(selectedAmount)}`, { cache: 'no-store' });
      const payload = await response.json();
      const room = (payload.rooms || []).find(candidate => candidate.id === roomId);
      if (!room || room.status !== 'started') return;
      const present = new Set((room.players || []).map(currentPlayer => String(currentPlayer.name)));
      lobbyPlayers.filter(lobbyPlayer => String(lobbyPlayer.name) !== String(player.name)).forEach((lobbyPlayer, index) => {
        if (present.has(String(lobbyPlayer.name))) return;
        eliminatePlayer(ACTIVE_COLORS[index + 1]);
      });
    } catch (_) {}
  };
  checkPresence();
  presenceTimer = setInterval(checkPresence, 1000);
}
function resetTurnTimer() {
  stopTurnTimer();
  secondsLeft = 60;
  updateTimerDisplay();
  if (!G.started) return;
  // Remote turns wait for that player's own connected game client.
  turnTimer = setInterval(() => {
    secondsLeft--;
    updateTimerDisplay();
    if (secondsLeft <= 0) { stopTurnTimer(); handleTimeout(); }
  }, 1000);
}
function updateTimerDisplay() {
  const el = $('gameTimer');
  if (!el) return;
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function handleTimeout() {
  addLog("Time's up! Turn skipped.", 'move');
  const col = currentColor();
  if (col === localColor && !G.rolled) {
    addLog('Your turn is waiting for your dice roll.', 'move');
  }
}

// ── Board ─────────────────────────────────────────────────────
function getCellClass(r, c) {
  if (r >= 6 && r <= 8 && c >= 6 && c <= 8) {
    if (r === 7 && c === 7) return 'bc bc-center-core';
    return 'bc bc-center';
  }
  // Corner quadrants — each shows its actual playing color background
  if (r <= 5 && c <= 5) return 'bc bc-gh';       // top-left    = GREEN
  if (r <= 5 && c >= 9) return 'bc bc-rh';       // top-right   = RED
  if (r >= 9 && c >= 9) return 'bc bc-bh';       // bottom-right= BLUE
  if (r >= 9 && c <= 5) return 'bc bc-yh';       // bottom-left = YELLOW
  // Home-column runways — colored to match the owner's color
  if (r === 7 && c >= 1 && c <= 5)  return 'bc bc-hc-g'; // left  arm → GREEN
  if (c === 7 && r >= 1 && r <= 5)  return 'bc bc-hc-r'; // top   arm → RED
  if (r === 7 && c >= 9 && c <= 13) return 'bc bc-hc-b'; // right arm → BLUE
  if (c === 7 && r >= 9 && r <= 13) return 'bc bc-hc-y'; // bottom arm→ YELLOW
  const idx = MAIN_PATH.findIndex(([pr,pc]) => pr === r && pc === c);
  if (idx >= 0) return SAFE_POSITIONS.has(idx) ? 'bc bc-safe' : 'bc bc-path';
  return 'bc bc-path';
}
function cellId(r,c) { return `bc-${r}-${c}`; }
function buildBoard() {
  const board = $('ludoBoard');
  board.innerHTML = '';
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      const div = make('div', getCellClass(r,c));
      div.id = cellId(r,c);
      // Slot circles — must match the new HOME_SLOTS color layout:
      // green=TL, red=TR, blue=BR, yellow=BL
      const allSlots   = [...HOME_SLOTS.green,...HOME_SLOTS.red,...HOME_SLOTS.blue,...HOME_SLOTS.yellow];
      const slotColors = [...HOME_SLOTS.green.map(()=>'g'),...HOME_SLOTS.red.map(()=>'r'),...HOME_SLOTS.blue.map(()=>'b'),...HOME_SLOTS.yellow.map(()=>'y')];
      const si = allSlots.findIndex(([sr,sc]) => sr===r && sc===c);
      if (si >= 0) div.classList.add('bc-hcircle', slotColors[si]);
      board.appendChild(div);
    }
  }
}

// ── Pieces ────────────────────────────────────────────────────
function clearPieces() { document.querySelectorAll('.piece, .piece-stack').forEach(p => p.remove()); }

function piecePos(color, idx) {
  const pos = G.pieces[color][idx];
  if (pos === -1) return HOME_SLOTS[color][idx];
  if (pos >= 52 && pos <= 56) return HOME_COLS[color][pos-52];
  if (pos === 57) return null;
  return MAIN_PATH[pos];
}

function renderPieces() {
  // Guard: ensure ACTIVE_COLORS is defined and non‑empty before rendering pieces.
  if (!Array.isArray(ACTIVE_COLORS) || ACTIVE_COLORS.length === 0) return;
  clearPieces();

  // Build a map: "r-c" => [{color, idx}, ...]
  const cellMap = {};
  ACTIVE_COLORS.forEach(color => {
    G.pieces[color].forEach((_, idx) => {
      const rc = piecePos(color, idx);
      if (!rc) return;
      const key = rc[0] + '-' + rc[1];
      if (!cellMap[key]) cellMap[key] = { rc, pieces: [] };
      cellMap[key].pieces.push({ color, idx });
    });
  });

  // Render each cell's pieces
  Object.values(cellMap).forEach(({ rc, pieces }) => {
    const [r, c] = rc;
    const cell = $(cellId(r, c));
    if (!cell) return;

    const count = pieces.length;

    // Wrapper that positions pieces side-by-side inside the cell
    const stack = document.createElement('div');
    stack.className = `piece-stack count-${Math.min(count, 4)}`;

    pieces.forEach(({ color, idx }) => {
      const piece = make('div', `piece ${color}`);
      piece.id = `piece-${color}-${idx}`;
      piece.dataset.color = color;
      piece.dataset.idx = idx;
      piece.addEventListener('click', (e) => {
        e.stopPropagation();
        handlePieceClick(color, idx);
      });
      stack.appendChild(piece);
    });

    cell.appendChild(stack);
  });
}

// ── Players panel ─────────────────────────────────────────────
function renderGamePlayers() {
  const container = $('gamePlayers');
  if (!container) return;
  container.innerHTML = '';
  const names = ACTIVE_COLORS.map((color, index) => {
    if (color === localColor) return `You (${color.charAt(0).toUpperCase()}${color.slice(1)})`;
    // Find the matching lobby player for this slot
    const lobbyIdx = index; // slot index maps to lobbyPlayers index
    const lp = lobbyPlayers[lobbyIdx];
    if (lp && lp.name && lp.name !== player.name) return `${lp.name} (${color.charAt(0).toUpperCase()}${color.slice(1)})`;
    return `AI ${color.charAt(0).toUpperCase()}${color.slice(1)}`;
  });
  ACTIVE_COLORS.forEach((col,i) => {
    const row = make('div', 'game-player-row' + (i === G.turn % ACTIVE_COLORS.length ? ' active-player' : ''));
    row.id = `gpr-${col}`;
    row.innerHTML = `
      <div class="color-dot ${col}"></div>
      <span style="flex:1;font-size:11px">${names[i]}</span>
      <span class="gpr-result" style="font-size:10px;color:var(--text-3)">${G.finished[col]}/4</span>`;
    container.appendChild(row);
  });
}

// ── Game UI ───────────────────────────────────────────────────
function currentColor() { return ACTIVE_COLORS[G.turn % ACTIVE_COLORS.length]; }
function updateGameUI() {
  // Guard: ensure ACTIVE_COLORS is defined and non‑empty before updating UI elements.
  if (!Array.isArray(ACTIVE_COLORS) || ACTIVE_COLORS.length === 0) return;

  const col = currentColor();
  const dot = $('turnDot'); if (dot) dot.className = `turn-dot ${col}`;
  const txt = $('turnText');
  if (txt) {
    const displayColor = typeof col === 'string' && col ? col : ACTIVE_COLORS[0];
    const isLocalTurn = !!localColor && displayColor === localColor;
    const turnLabel = isLocalTurn ? 'Your Turn' : `${displayColor.charAt(0).toUpperCase() + displayColor.slice(1)}'s Turn`;
    txt.textContent = turnLabel;
  }
  const rollBtn = $('rollDiceBtn');
  if (rollBtn) rollBtn.disabled = !G.started || G.rolled || col !== localColor || G.eliminated[localColor];

  // Update only the active players' rows (ignore inactive colors)
  ACTIVE_COLORS.forEach((c, i) => {
    const row = $(`gpr-${c}`);
    if (!row) return;
    const isActive = (i === G.turn % ACTIVE_COLORS.length);
    row.className = 'game-player-row' + (isActive ? ' active-player' : '');
    if (G.eliminated[c]) row.classList.add('player-lost');
    const span = row.querySelector('.gpr-result');
    if (span) {
      span.textContent  = G.eliminated[c] ? 'LOSE' : G.winnerColor === c ? 'WIN' : `${G.finished[c]}/4`;
      span.className    = `gpr-result ${G.eliminated[c] ? 'player-result-loss' : G.winnerColor === c ? 'player-result-win' : ''}`;
    }
  });
}

function addLog(text, type='') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = text;
  const log = $('gameLog');
  if (log) {
    log.prepend(entry);
    if (log.children.length > 50) log.lastElementChild.remove();
  }
}

// ── Reset / Start ─────────────────────────────────────────────
function resetGame() {
  G.active=false; G.started=false; G.turn=0; G.diceValue=0; G.rolled=false;
  // Reset all 4 color slots in state (safe), only ACTIVE_COLORS are rendered
  COLORS.forEach(col => {
    G.pieces[col]=[-1,-1,-1,-1]; G.finished[col]=0; G.eliminated[col]=false;
  });
  G.winnerColor = null;
  G.log=[];
  // Reset one-shot guards so a replay works correctly
  endGame._called = false;
  buildBoard();
  renderPieces();
  updateGameUI();
  const gameLog=$('gameLog'); if (gameLog) gameLog.innerHTML='<div class="log-entry">Game ready — press Start.</div>';
  const startBtn=$('startGameBtn'); if (startBtn) startBtn.disabled=false;
  const rollBtn=$('rollDiceBtn'); if (rollBtn) rollBtn.disabled=true;
  stopTurnTimer(); updateTimerDisplay();
  const idEl=$('gameHeaderId'); if (idEl) idEl.textContent='#——';
}


function broadcastGameState(source = 'local') {
  if (!roomId || !GAME_SOCKET || !GAME_SOCKET.connected) return;
  GAME_SOCKET.emit('game:state:update', {
    roomId,
    state: {
      ...G,
      roomId,
      source,
      updatedAt: Date.now(),
      players: lobbyPlayers.map((playerEntry, index) => ({
        ...playerEntry,
        color: ACTIVE_COLORS[index] || playerEntry.color,
      })),
    },
  });
}

/**
 * Broadcast a single discrete action (dice roll or piece move) to all
 * other players in the room.  This is the fast path — the full state sync
 * via broadcastGameState() still runs afterwards as a consistency catch-up.
 *
 * action shape:
 *   { type: 'roll',  color, value }
 *   { type: 'move',  color, idx, fromPos, steps, finalPos }
 *   { type: 'capture', color, capturedColor, capturedIdx }
 */
function broadcastAction(action) {
  if (!roomId || !GAME_SOCKET || !GAME_SOCKET.connected) return;
  GAME_SOCKET.emit('game:action', {
    roomId,
    action: { ...action, socketId: GAME_SOCKET.id, ts: Date.now() },
  });
}

/**
 * Handle a discrete action broadcast by another player in real time.
 * This is the fast path — dice rolls and piece moves are animated live.
 * The full state sync via applyRemoteGameState() catches up any drift.
 */
function applyRemoteAction(action) {
  if (!action || !G.started) return;
  if (action.socketId === GAME_SOCKET?.id) return;
  if (action.color === localColor) return;

  if (action.type === 'roll') {
    const colorLabel = action.color.charAt(0).toUpperCase() + action.color.slice(1);
    addLog(`${colorLabel} rolled a ${action.value}`, 'roll');
    animateDice(action.value, null);
    G.diceValue = action.value;
    G.rolled    = true;
    updateGameUI();
    return;
  }

  if (action.type === 'move') {
    G.pieces[action.color][action.idx] = action.fromPos;
    animatePieceMove(action.color, action.idx, action.steps, () => {
      G.pieces[action.color][action.idx] = action.finalPos;
      if (action.finalPos === 57) {
        G.finished[action.color]++;
        addLog(`${action.color} piece ${action.idx+1} reached home! 🏠`, 'win');
      } else if (action.fromPos === -1) {
        addLog(`${action.color} piece ${action.idx+1} entered the board!`, 'move');
      }
      if (action.capture) {
        G.pieces[action.capture.other][action.capture.oidx] = -1;
        addLog(`${action.color} captured ${action.capture.other} piece ${action.capture.oidx+1}!`, 'win');
      }
      renderPieces();
      updateGameUI();
    });
    return;
  }
}

/**
 * Apply a full game state snapshot from a remote player.
 * Used as a consistency catch-up after actions — merges all fields
 * and (if a roll is detected and not yet animated by applyRemoteAction)
 * shows the dice animation.
 */
function applyRemoteGameState(remoteState) {
  if (!remoteState || !G.started) return;

  // Snapshot previous dice value so we can detect a new roll
  const prevDiceValue = G.diceValue;
  const prevRolled    = G.rolled;

  // ── Merge core turn/rolled/dice fields ──────────────────────
  if (typeof remoteState.turn       === 'number')  G.turn       = remoteState.turn;
  if (typeof remoteState.rolled     === 'boolean') G.rolled     = remoteState.rolled;
  if (typeof remoteState.diceValue  === 'number')  G.diceValue  = remoteState.diceValue;
  if (typeof remoteState.winnerColor !== 'undefined') G.winnerColor = remoteState.winnerColor;
  if (remoteState.updatedAt) G.updatedAt = remoteState.updatedAt;

  // ── Merge piece positions — only ACTIVE_COLORS ──────────────
  if (remoteState.pieces) {
    ACTIVE_COLORS.forEach(color => {
      if (Array.isArray(remoteState.pieces[color])) {
        G.pieces[color] = [...remoteState.pieces[color]];
      }
    });
  }

  // ── Merge finished / eliminated counts ──────────────────────
  if (remoteState.finished) {
    ACTIVE_COLORS.forEach(color => {
      if (typeof remoteState.finished[color] === 'number') {
        G.finished[color] = remoteState.finished[color];
      }
    });
  }
  if (remoteState.eliminated) {
    ACTIVE_COLORS.forEach(color => {
      if (typeof remoteState.eliminated[color] === 'boolean') {
        G.eliminated[color] = remoteState.eliminated[color];
      }
    });
  }

  // ── Detect a remote dice roll not yet covered by game:action ─
  // Only animate if the roll event arrives here before game:action
  // (race condition safety net — won't double-animate because
  //  applyRemoteAction returns early if source===localColor, and
  //  this path only fires for non-local source rolls)
  const rollingColor = ACTIVE_COLORS[remoteState.turn % ACTIVE_COLORS.length];
  const isRemoteRoll = rollingColor !== localColor;
  const diceChanged  = remoteState.diceValue !== prevDiceValue || (!prevRolled && remoteState.rolled);
  const isRollEvent  = remoteState.source === 'roll' || remoteState.source === 'bonus';
  const validDice    = remoteState.diceValue >= 1 && remoteState.diceValue <= 6;

  if (isRemoteRoll && diceChanged && isRollEvent && validDice) {
    animateDice(remoteState.diceValue, null);
    const colorLabel = rollingColor.charAt(0).toUpperCase() + rollingColor.slice(1);
    addLog(`${colorLabel} rolled a ${remoteState.diceValue}`, 'roll');
  }

  // ── Refresh board & UI ───────────────────────────────────────
  renderPieces();
  updateGameUI();
  renderGamePlayers();
}



function connectGameSocket() {
  if (!roomId || !GAME_SOCKET) return;
  GAME_SOCKET.on('connect', () => {
    GAME_SOCKET.emit('game:join', {
      roomId,
      player: { name: player.name, color: localColor },
    });
  });

  GAME_SOCKET.on('game:state', (remoteState) => {
    if (!remoteState || remoteState.roomId !== roomId) return;

    // Drop stale local-echo updates but always process remote roll events so
    // the opponent's dice animation is never skipped.
    const isRollEvent = remoteState.source === 'roll' || remoteState.source === 'bonus';
    const isStaleEcho = remoteState.source === 'local'
      && remoteState.updatedAt
      && remoteState.updatedAt <= (G.updatedAt || 0);

    if (isStaleEcho && !isRollEvent) return;

    applyRemoteGameState(remoteState);
  });

  GAME_SOCKET.on('game:action', (payload) => {
    if (!payload || payload.roomId !== roomId) return;
    const action = payload.action;
    if (!action) return;

    // Ignore sender echo but still animate on every other client in the room.
    if (action.socketId === GAME_SOCKET.id) return;
    applyRemoteAction(action);
  });
}

function startGame() {
  resetGame();
  G.active=true; G.started=true;
  G.roomId = roomId;
  G.updatedAt = Date.now();
  const startBtn = $('startGameBtn'); if (startBtn) startBtn.disabled=true;
  const rollBtn  = $('rollDiceBtn');  if (rollBtn)  rollBtn.disabled=(ACTIVE_COLORS[0] !== localColor);
  renderGamePlayers();
  updateGameUI();
  addLog(`Game started! ${localColor.charAt(0).toUpperCase()+localColor.slice(1)} is your color. 🎲`,'roll');
  const gameId = Math.floor(10000 + Math.random()*90000);
  const idEl   = $('gameHeaderId'); if (idEl) idEl.textContent='#'+gameId;
  resetTurnTimer();
  startPresenceWatch();
  broadcastGameState('start');
  // Auto-roll only for AI / solo play. Multiplayer rooms must wait for the
  // actual player turn to roll, and remote turns should never trigger a local roll.
  if (ACTIVE_COLORS[0] !== localColor && !roomId) {
    setTimeout(() => rollDice(true), 1000);
  }
}

// ── Button listeners ──────────────────────────────────────────
$('startGameBtn').addEventListener('click', startGame);
$('gameBackBtn')?.addEventListener('click', () => {
  if (G.started) {
    notifyRoomLeave();
    endGame(false, ACTIVE_COLORS.find(color => color !== localColor) || 'AI');
  } else {
    window.location.href = 'index.html';
  }
});
$('forfeitBtn').addEventListener('click', () => {
  if (!G.started) return;
  notifyRoomLeave();
  endGame(false, ACTIVE_COLORS.find(color => color !== localColor) || 'AI');
});
$('rollDiceBtn').addEventListener('click', () => { if (!G.started||G.rolled) return; rollDice(); });

// Click anywhere on the dice scene (scene wrapper is the reliable hit target)
$('dice').addEventListener('click', () => { if (!G.started||G.rolled) return; rollDice(); });
document.querySelector('.dice-scene') && document.querySelector('.dice-scene').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!G.started||G.rolled) return;
  rollDice();
});

// ── Dice face transforms (maps value 1-6 to the correct cube rotation) ───
// Faces: front=1, top=2, right=3, left=4, bottom=5, back=6
const DICE_TRANSFORMS = {
  1: 'translateZ(-28px) rotateX(0deg)   rotateY(0deg)',
  2: 'translateZ(-28px) rotateX(-90deg) rotateY(0deg)',
  3: 'translateZ(-28px) rotateX(0deg)   rotateY(-90deg)',
  4: 'translateZ(-28px) rotateX(0deg)   rotateY(90deg)',
  5: 'translateZ(-28px) rotateX(90deg)  rotateY(0deg)',
  6: 'translateZ(-28px) rotateX(0deg)   rotateY(180deg)',
};

// ── Dice rolling helpers ──────────────────────────────────────
// Each roll gets a random diagonal spin offset so no two rolls look the same
function randomSpinTransform() {
  const rx = Math.floor(Math.random() * 4 + 2) * 90 + Math.floor(Math.random()*45);
  const ry = Math.floor(Math.random() * 4 + 2) * 90 + Math.floor(Math.random()*45);
  const rz = Math.floor(Math.random() * 3 + 1) * 60 + Math.floor(Math.random()*30);
  return `translateZ(-28px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`;
}

// Shared dice roll visual — works for both player and AI
function animateDice(value, onDone) {
  const diceEl  = $('dice');
  const lbl     = $('diceValueLabel');
  const diceArea = diceEl.closest('.dice-area');

  // Reset glow & label
  if (diceArea) diceArea.classList.remove('rolled');
  if (lbl) { lbl.textContent = ''; lbl.style.cssText = ''; }

  // Phase 1: fast diagonal spin (600ms)
  diceEl.style.transition = 'none';
  diceEl.style.transform  = randomSpinTransform();
  diceEl.classList.add('rolling');

  // Phase 2: slow wobble then land (after 600ms fast spin)
  setTimeout(() => {
    diceEl.classList.remove('rolling');

    // Intermediate slow spin to a random angle (200ms)
    diceEl.style.transition = 'transform 0.25s ease-out';
    diceEl.style.transform  = randomSpinTransform();

    // Phase 3: glide to correct face
    setTimeout(() => {
      diceEl.style.transition = 'transform 0.5s cubic-bezier(0.15, 0.8, 0.25, 1)';
      diceEl.style.transform  = DICE_TRANSFORMS[value];

      // Light up gold glow
      if (diceArea) diceArea.classList.add('rolled');

      // Show value label
      if (lbl) {
        lbl.textContent = value;
        lbl.style.cssText = 'font-size:22px;font-weight:800;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,0.5);';
      }

      if (onDone) setTimeout(onDone, 550);
    }, 260);
  }, 600);
}

function rollDice(computerTurn = false) {
  const col   = currentColor();
  if (!G.started || G.rolled || (!computerTurn && col !== localColor)) return;
  const value = Math.floor(Math.random()*6)+1;
  G.diceValue=value; G.rolled=true;
  const rollBtn = $('rollDiceBtn'); if(rollBtn) rollBtn.disabled=true;

  // Broadcast the roll immediately so remote clients start their animation
  // in parallel — don't wait for the local animation to finish
  broadcastAction({ type: 'roll', color: col, value });

  animateDice(value, () => {
    G.updatedAt = Date.now();
    addLog(`${col.charAt(0).toUpperCase()+col.slice(1)} rolled a ${value}`,'roll');
    if (col===localColor) {
      const movable = getMovablePieces(localColor, value);
      if (movable.length === 0) {
        addLog('No valid moves. Turn skipped.','move');
        broadcastGameState('roll');
        setTimeout(nextTurn, 900);
      } else if (movable.length === 1) {
        addLog('Auto-moving only available piece.','move');
        const el = $(`piece-${localColor}-${movable[0]}`);
        if (el) el.classList.add('blinking');
        setTimeout(() => {
          clearBlink();
          movePiece(localColor, movable[0], value);
        }, 700);
      } else {
        highlightMovable(value);
      }
    } else {
      setTimeout(()=>aiMove(col,value),400);
    }
    broadcastGameState('roll');
  });
}

// ── Pieces ────────────────────────────────────────────────────
function getMovablePieces(color, diceVal) {
  const movable=[];
  G.pieces[color].forEach((pos,idx)=>{
    if (pos===57) return;
    if (pos===-1 && diceVal===6){movable.push(idx);return;}
    if (pos===-1) return;
    if (pos>=52){ if((pos-52+diceVal)<=5) movable.push(idx); }
    else { movable.push(idx); }
  });
  return movable;
}
function highlightMovable(diceVal) {
  document.querySelectorAll('.piece').forEach(p => p.classList.remove('selectable','blinking'));
  if (currentColor() !== localColor) return;
  getMovablePieces(localColor, diceVal).forEach(idx => {
    const el = $(`piece-${localColor}-${idx}`);
    if (el) el.classList.add('selectable', 'blinking');
  });
}

function clearBlink() {
  document.querySelectorAll('.piece').forEach(p => p.classList.remove('selectable','blinking'));
}

function handlePieceClick(color,idx) {
  if (color!==localColor||!G.rolled) return;
  const movable=getMovablePieces(localColor,G.diceValue);
  if (!movable.includes(idx)){toast('Cannot move this piece!','error');return;}
  clearBlink();
  movePiece(localColor,idx,G.diceValue);
}
// ── Step-by-step piece animation ─────────────────────────────
const STEP_DELAY = 160; // ms per cell

// Compute the full path of board positions a piece will walk through
function computeSteps(color, pieceIdx, steps) {
  const pos = G.pieces[color][pieceIdx];
  const path = []; // array of board positions (numbers) to visit

  if (pos === -1) {
    // Entering from home slot
    path.push(ENTRY_POS[color]);
    return path;
  }

  if (pos >= 52) {
    // Already in home column
    for (let s = 1; s <= steps; s++) {
      const next = pos - 52 + s;
      if (next >= 5) { path.push(57); break; }
      path.push(52 + next);
    }
    return path;
  }

  // On main path
  const homeEntry = HOME_COL_ENTRY[color];
  let curPos = pos;
  for (let s = 0; s < steps; s++) {
    curPos = (curPos + 1) % 52;
    if (curPos === homeEntry) {
      const remaining = steps - s - 1;
      // Enter home column
      for (let h = 0; h < remaining; h++) {
        path.push(52 + h);
      }
      if (remaining >= 5) path.push(57);
      else path.push(52 + remaining);
      return path;
    }
    path.push(curPos);
  }
  return path;
}

// Animate piece walking step by step, then resolve final logic
function animatePieceMove(color, idx, steps, onDone) {
  const stepPositions = computeSteps(color, idx, steps);
  if (stepPositions.length === 0) { onDone(); return; }

  clearBlink(); // stop blinking as soon as movement starts
  let stepIdx = 0;

  function doStep() {
    const nextPos = stepPositions[stepIdx];
    // Temporarily set piece position for render
    G.pieces[color][idx] = nextPos;
    renderPieces();

    // Bounce animation on the piece
    const pieceEl = $(`piece-${color}-${idx}`);
    if (pieceEl) {
      pieceEl.classList.add('stepping');
      setTimeout(() => { if(pieceEl) pieceEl.classList.remove('stepping'); }, STEP_DELAY - 20);
    }

    stepIdx++;
    if (stepIdx < stepPositions.length) {
      setTimeout(doStep, STEP_DELAY);
    } else {
      setTimeout(onDone, STEP_DELAY);
    }
  }

  doStep();
}

function movePiece(color, idx, steps) {
  const pos = G.pieces[color][idx];
  let finalPos, bonusTurn = false;
  let captureInfo = null;

  // ── Calculate final position & side-effects (don't apply yet) ──
  if (pos === -1) {
    finalPos = ENTRY_POS[color];
    if (steps === 6) bonusTurn = true;
  } else if (pos >= 52) {
    const next = pos - 52 + steps;
    finalPos = next >= 5 ? 57 : 52 + next;
  } else {
    const homeEntry = HOME_COL_ENTRY[color];
    let curPos = pos;
    finalPos = undefined;
    for (let s = 0; s < steps; s++) {
      curPos = (curPos + 1) % 52;
      if (curPos === homeEntry) {
        const remaining = steps - s - 1;
        finalPos = remaining === 0 ? curPos : 52 + (remaining - 1);
        break;
      }
    }
    if (finalPos === undefined) finalPos = (pos + steps) % 52;

    // Check captures on final position
    if (finalPos < 52 && !SAFE_POSITIONS.has(finalPos)) {
      ACTIVE_COLORS.forEach(other => {
        if (other === color) return;
        G.pieces[other].forEach((opos, oidx) => {
          if (opos === finalPos) {
            captureInfo = { other, oidx };
            bonusTurn = true;
          }
        });
      });
    }
  }

  // ── Animate step by step ──
  // Broadcast the move to remote clients immediately so they animate in parallel
  broadcastAction({ type: 'move', color, idx, fromPos: pos, steps, finalPos,
    capture: captureInfo ? { other: captureInfo.other, oidx: captureInfo.oidx } : null });

  animatePieceMove(color, idx, steps, () => {
    // Apply final state
    G.pieces[color][idx] = finalPos;
    G.updatedAt = Date.now();

    if (finalPos === 57) {
      G.finished[color]++;
      addLog(`${color} piece ${idx+1} reached home! 🏠`, 'win');
      checkWin(color);
    } else if (pos === -1) {
      addLog(`${color} piece ${idx+1} entered the board!`, 'move');
    }

    // Apply capture
    if (captureInfo) {
      G.pieces[captureInfo.other][captureInfo.oidx] = -1;
      addLog(`${color} captured ${captureInfo.other} piece ${captureInfo.oidx+1}!`, 'win');
    }

    renderPieces();
    broadcastGameState('move');

    if (bonusTurn && color === localColor) {
      addLog('Bonus turn! Roll again.', 'roll');
      G.rolled = false;
      updateGameUI();
      broadcastGameState('bonus');
    } else if (bonusTurn) {
      nextTurn(color);
    } else {
      nextTurn();
    }
  });
}

// ── AI ────────────────────────────────────────────────────────
function aiMove(color,diceVal) {
  const movable=getMovablePieces(color,diceVal);
  if(movable.length===0){addLog(`${color} has no valid moves.`,'move');nextTurn();return;}
  let best=movable[0],bestScore=-999;
  movable.forEach(idx=>{
    const pos=G.pieces[color][idx];
    let score=pos===-1?(diceVal===6?10:-999):pos>=52?100+(pos-52):pos;
    if(score>bestScore){bestScore=score;best=idx;}
  });
  movePiece(color,best,diceVal);
}

function nextTurn(forceColor) {
  G.rolled=false;
  if (!forceColor) {
    // advance turn, skipping eliminated players
    do {
      G.turn = (G.turn + 1) % ACTIVE_COLORS.length;
    } while (G.eliminated[ACTIVE_COLORS[G.turn]]);
  } else {
    G.turn = Math.max(0, ACTIVE_COLORS.indexOf(forceColor));
  }
  updateGameUI();
  resetTurnTimer();

  // Auto-declare winner if only one player left
  const alive = ACTIVE_COLORS.filter(c => !G.eliminated[c]);
  if (alive.length === 1 && G.started) {
    declareWinner(alive[0]);
    return;
  }

  // Auto-roll only for AI / solo play. Multiplayer rooms sync turns from the
  // real socket state and should never auto-roll on another player's turn.
  const col = currentColor();
  if (G.started && col !== localColor && !roomId) {
    setTimeout(() => rollDice(true), 900);
  }
}

function checkWin(color) {
  if (G.finished[color] >= 4) {
    addLog(`${color} finished all pieces! 🏆`, 'win');
    // This color wins — declare immediately, do NOT mark them eliminated
    if (G.started) declareWinner(color);
  }
}

function removePlayerPieces(color) {
  G.pieces[color] = [57, 57, 57, 57];
  document.querySelectorAll(`.piece.${color}, [id^="piece-${color}-"]`).forEach(piece => piece.remove());
}

// ── End game ──────────────────────────────────────────────────
function declareWinner(winnerColor) {
  // Guard: only run once per game — prevents double modal from re-entry
  if (G.winnerColor) return;

  G.winnerColor = winnerColor;
  // Mark every other active player as eliminated
  ACTIVE_COLORS.forEach(c => {
    if (c !== winnerColor) G.eliminated[c] = true;
  });
  updateGameUI();

  if (winnerColor === localColor) {
    endGame(true, null);
  } else {
    endGame(false, winnerColor);
  }
}

function endGame(playerWon, winnerColor) {
  // Guard: only run once — prevents double modal if declareWinner fires twice
  if (endGame._called) return;
  endGame._called = true;

  G.winnerColor = playerWon ? localColor : (G.winnerColor || winnerColor);
  if (!playerWon) {
    G.eliminated[localColor] = true;
    removePlayerPieces(localColor);
  }
  updateGameUI();

  // Tell the backend: game is over — resets room to 'waiting'
  notifyGameEnd();

  // Persist result to backend (players balances & game log)
  async function persistResult() {
    const bet = selectedAmount;
    const actualWinner = G.winnerColor;
    for (const col of ACTIVE_COLORS) {
      const delta = (col === actualWinner) ? bet * (ACTIVE_COLORS.length - 1) : -bet;
      try {
        await fetch(`${LUDO_API_URL}/api/player/${col}/bet`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ delta })
        });
      } catch (e) {
        console.error('Failed to update balance for', col, e);
      }
    }
    try {
      await fetch(`${LUDO_API_URL}/api/game/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winnerColor: actualWinner, bet, log: G.log })
      });
    } catch (e) {
      console.error('Failed to record game', e);
    }
  }

  G.active = false; G.started = false;
  stopPresenceWatch();
  const startBtn = $('startGameBtn'); if (startBtn) startBtn.disabled = false;
  const rollBtn = $('rollDiceBtn'); if (rollBtn) rollBtn.disabled = true;
  stopTurnTimer();

  const bet = selectedAmount;
  if (playerWon) {
    const gain = bet * (ACTIVE_COLORS.length - 1); player.balance += gain; player.wins++; player.totalWon += gain;
    $('winMsg').textContent = `You earned ${gain} ETB!`;
    $('winAmount').textContent = `+${gain} ETB`;
    showOverlay('winModal');
    spawnConfetti();
  } else {
    if (player.balance >= bet) { player.balance -= bet; }
    player.losses++; player.totalLost += bet;
    const w = G.winnerColor || winnerColor || 'Opponent';
    $('loseMsg').textContent = `${w.charAt(0).toUpperCase()+w.slice(1)} wins. You lost ${bet} ETB.`;
    $('loseAmount').textContent = `−${bet} ETB`;
    showOverlay('loseModal');
  }
  let seconds = 3;
  const modalId = playerWon ? 'winModal' : 'loseModal';
  const text = $(playerWon ? 'winCountdownText' : 'loseCountdownText');
  const timer = setInterval(() => { seconds--; if (text) text.textContent = seconds > 0 ? `Closing in ${seconds}s` : 'Closing…'; }, 1000);
  setTimeout(() => { clearInterval(timer); hideOverlay(modalId); window.location.href = 'index.html'; }, 3000);
  syncHeader();
  saveStateBack();
  // Fire‑and‑forget persistence
  persistResult().catch(console.error);
}

function saveStateBack() {
  const state = JSON.parse(sessionStorage.getItem('ludoGameState')||'{}');
  state.balance   = player.balance;
  state.wins      = player.wins;
  state.losses    = player.losses;
  state.draws     = player.draws || 0;
  state.totalWon  = player.totalWon;
  state.totalLost = player.totalLost;
  sessionStorage.setItem('ludoGameState', JSON.stringify(state));
}

// ── Confetti ──────────────────────────────────────────────────
function spawnConfetti() {
  const burst=$('confettiBurst'); if(!burst) return;
  burst.innerHTML='';
  const colors=['#f0b133','#7c6af7','#36e89c','#ff4465','#4e94ff','#ffd93d'];
  for(let i=0;i<22;i++){
    const p=make('div','confetti-piece');
    p.style.setProperty('--x',(Math.random()*300-150)+'px');
    p.style.setProperty('--r',(Math.random()*720-360)+'deg');
    p.style.left=(Math.random()*100)+'%';
    p.style.background=colors[Math.floor(Math.random()*colors.length)];
    p.style.animationDelay=(Math.random()*0.4)+'s';
    burst.appendChild(p);
  }
}

// ── Modal buttons ─────────────────────────────────────────────
$('winContinueBtn').addEventListener('click', () => {
  hideOverlay('winModal');
  window.location.href = 'index.html';
});
$('loseContinueBtn').addEventListener('click', () => {
  hideOverlay('loseModal');
  resetGame();
  startGame();
});
$('winCloseBtn')?.addEventListener('click', () => { hideOverlay('winModal'); window.location.href = 'index.html'; });
$('loseCloseBtn')?.addEventListener('click', () => { hideOverlay('loseModal'); window.location.href = 'index.html'; });

// ── Init ──────────────────────────────────────────────────────
buildBoard();
renderPieces();
renderGamePlayers();
updateTimerDisplay();
connectGameSocket();

if (autoStart) {
  // Small delay so the board renders first
  setTimeout(startGame, 300);
}
