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
const HOME_COLS = {
  green:  [[7,1],[7,2],[7,3],[7,4],[7,5]],
  red:    [[1,7],[2,7],[3,7],[4,7],[5,7]],
  blue:   [[7,13],[7,12],[7,11],[7,10],[7,9]],
  yellow: [[13,7],[12,7],[11,7],[10,7],[9,7]]
};
const ENTRY_POS      = { green:0, red:13, blue:26, yellow:39 };
const HOME_COL_ENTRY = { green:51, red:12, blue:25, yellow:38 };
const HOME_SLOTS = {
  green:  [[1,1],[1,4],[4,1],[4,4]],
  red:    [[1,10],[1,13],[4,10],[4,13]],
  blue:   [[10,10],[10,13],[13,10],[13,13]],
  yellow: [[10,1],[10,4],[13,1],[13,4]]
};

const COLORS     = ['red','blue','green','yellow'];
const DICE_FACES = ['⚀','⚁','⚂','⚃','⚄','⚅'];
const LUDO_API_URL = (window.__LUDO_BACKEND_URL__ || 'https://ludo-backend-wykz.onrender.com').replace(/\/$/, '');

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
// 2 players: red + yellow  (opposite corners)
// 3 players: yellow + red + green
// 4 players: yellow + blue + green + red
const ACTIVE_COLORS = playerCount === 2
  ? ['red', 'yellow']
  : playerCount === 3
    ? ['yellow', 'red', 'green']
    : ['yellow', 'blue', 'green', 'red'];

const localPlayerIndex = lobbyPlayers.findIndex(lobbyPlayer => String(lobbyPlayer.name) === String(player.name));
// Use saved playerColor if available, otherwise derive from lobby slot
const localColor = saved.playerColor && ACTIVE_COLORS.includes(saved.playerColor)
  ? saved.playerColor
  : ACTIVE_COLORS[Math.max(0, localPlayerIndex)];

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
  if (r <= 5 && c <= 5) return 'bc bc-rh';
  if (r <= 5 && c >= 9) return 'bc bc-bh';
  if (r >= 9 && c >= 9) return 'bc bc-yh';
  if (r >= 9 && c <= 5) return 'bc bc-gh';
  if (r === 7 && c >= 1 && c <= 5)  return 'bc bc-hc-r';
  if (c === 7 && r >= 1 && r <= 5)  return 'bc bc-hc-b';
  if (r === 7 && c >= 9 && c <= 13) return 'bc bc-hc-y';
  if (c === 7 && r >= 9 && r <= 13) return 'bc bc-hc-g';
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
      const allSlots   = [...HOME_SLOTS.red,...HOME_SLOTS.blue,...HOME_SLOTS.yellow,...HOME_SLOTS.green];
      const slotColors = [...HOME_SLOTS.red.map(()=>'r'),...HOME_SLOTS.blue.map(()=>'b'),...HOME_SLOTS.yellow.map(()=>'y'),...HOME_SLOTS.green.map(()=>'g')];
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
  const col = currentColor();
  const dot = $('turnDot'); if (dot) dot.className = `turn-dot ${col}`;
  const txt = $('turnText');
  if (txt) {
    const label = col === localColor ? 'Your' : col.charAt(0).toUpperCase() + col.slice(1);
    txt.textContent = `${label}'s Turn`;
  }
  const rollBtn = $('rollDiceBtn');
  if (rollBtn) rollBtn.disabled = !G.started || G.rolled || col !== localColor || G.eliminated[localColor];

  // Update only the active players' rows (ignore blue/other inactive colors)
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
  buildBoard();
  renderPieces();
  updateGameUI();
  const gameLog=$('gameLog'); if (gameLog) gameLog.innerHTML='<div class="log-entry">Game ready — press Start.</div>';
  const startBtn=$('startGameBtn'); if (startBtn) startBtn.disabled=false;
  const rollBtn=$('rollDiceBtn'); if (rollBtn) rollBtn.disabled=true;
  stopTurnTimer(); updateTimerDisplay();
  const idEl=$('gameHeaderId'); if (idEl) idEl.textContent='#——';
}


function startGame() {
  resetGame();
  G.active=true; G.started=true;
  const startBtn = $('startGameBtn'); if (startBtn) startBtn.disabled=true;
  const rollBtn  = $('rollDiceBtn');  if (rollBtn)  rollBtn.disabled=(ACTIVE_COLORS[0] !== localColor);
  renderGamePlayers();
  updateGameUI();
  addLog(`Game started! ${localColor.charAt(0).toUpperCase()+localColor.slice(1)} is your color. 🎲`,'roll');
  const gameId = Math.floor(10000 + Math.random()*90000);
  const idEl   = $('gameHeaderId'); if (idEl) idEl.textContent='#'+gameId;
  resetTurnTimer();
  startPresenceWatch();
  // Auto-roll if first turn is AI
  if (ACTIVE_COLORS[0] !== localColor) {
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

  animateDice(value, () => {
    addLog(`${col.charAt(0).toUpperCase()+col.slice(1)} rolled a ${value}`,'roll');
    if (col===localColor) {
      const movable = getMovablePieces(localColor, value);
      if (movable.length === 0) {
        addLog('No valid moves. Turn skipped.','move');
        setTimeout(nextTurn, 900);
      } else if (movable.length === 1) {
        // Only one piece can move — auto-move it
        addLog('Auto-moving only available piece.','move');
        // Blink briefly then move
        const el = $(`piece-${localColor}-${movable[0]}`);
        if (el) el.classList.add('blinking');
        setTimeout(() => {
          clearBlink();
          movePiece(localColor, movable[0], value);
        }, 700);
      } else {
        // Multiple choices — blink all and wait for player click
        highlightMovable(value);
      }
    } else {
      setTimeout(()=>aiMove(col,value),400);
    }
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
  animatePieceMove(color, idx, steps, () => {
    // Apply final state
    G.pieces[color][idx] = finalPos;

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

    if (bonusTurn && color === localColor) {
      addLog('Bonus turn! Roll again.', 'roll');
      G.rolled = false;
      updateGameUI();
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

  // Auto-roll for AI turns
  const col = currentColor();
  if (G.started && col !== localColor) {
    setTimeout(() => rollDice(true), 900);
  }
}

function checkWin(color) {
  if (G.finished[color]>=4) {
    G.eliminated[color]=true;
    addLog(`${color} finished all pieces!`, 'win');
    // Auto win if only one player remains
    const alive = ACTIVE_COLORS.filter(c => !G.eliminated[c]);
    if (alive.length===1 && G.started) {
      declareWinner(alive[0]);
    }
  }
}

function removePlayerPieces(color) {
  G.pieces[color] = [57, 57, 57, 57];
  document.querySelectorAll(`.piece.${color}, [id^="piece-${color}-"]`).forEach(piece => piece.remove());
}

// ── End game ──────────────────────────────────────────────────
function declareWinner(winnerColor) {
  // Mark all other players as eliminated
  ACTIVE_COLORS.forEach(c => {
    if (c!==winnerColor) G.eliminated[c]=true;
  });
  G.winnerColor = winnerColor;
  // Update UI rows
  updateGameUI();
  // Populate loser list in win modal
  const loserList=$('loserList');
  if (loserList) {
    loserList.innerHTML='';
    ACTIVE_COLORS.filter(c=>c!==winnerColor).forEach(c=>{
      const li=document.createElement('li'); li.textContent=c.charAt(0).toUpperCase()+c.slice(1);
      loserList.appendChild(li);
    });
  }
  // Show win modal for the winner (if winner is red, we already have logic elsewhere)
  if (winnerColor === localColor) {
    endGame(true,null);
  } else {
    endGame(false,winnerColor);
  }
}

function endGame(playerWon, winnerColor) {
  G.winnerColor = playerWon ? localColor : winnerColor;
  if (!playerWon) {
    G.eliminated[localColor] = true;
    removePlayerPieces(localColor);
  }
  updateGameUI();

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
    const w = winnerColor ? winnerColor : 'AI';
    $('loseMsg').textContent = `${w.charAt(0).toUpperCase()+w.slice(1)} wins. You lost ${formatMoney(bet)}.`;
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

if (autoStart) {
  // Small delay so the board renders first
  setTimeout(startGame, 300);
}
