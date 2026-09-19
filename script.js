'use strict';

/* =============================================================
   LUDO — FULL GAME ENGINE & UI CONTROLLER
   ============================================================= */

// ─── BOARD GEOMETRY ──────────────────────────────────────────
// 15×15 grid path (52 cells, clockwise from Red's entry at pos 0)
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
// Safe positions (by index in MAIN_PATH)
const SAFE_POSITIONS = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

// Home columns [row,col] leading to center, indexed 0→4 (5 steps before center)
const HOME_COLS = {
  red:    [[7,1],[7,2],[7,3],[7,4],[7,5]],
  blue:   [[1,7],[2,7],[3,7],[4,7],[5,7]],
  yellow: [[7,13],[7,12],[7,11],[7,10],[7,9]],
  green:  [[13,7],[12,7],[11,7],[10,7],[9,7]]
};

// Where each color enters the main path
const ENTRY_POS = { red: 0, blue: 13, yellow: 26, green: 39 };

// Where each color enters its home column (path index AFTER this triggers home col entry)
const HOME_COL_ENTRY = { red: 51, blue: 12, yellow: 25, green: 38 };

// Home piece slots (where pieces sit when not yet entered)
const HOME_SLOTS = {
  red:    [[1,1],[1,4],[4,1],[4,4]],
  blue:   [[1,10],[1,13],[4,10],[4,13]],
  yellow: [[10,10],[10,13],[13,10],[13,13]],
  green:  [[10,1],[10,4],[13,1],[13,4]]
};

// ─── APP STATE ───────────────────────────────────────────────
const S = {
  player: {
    name: '',
    balance: null,
    wins: 0,
    losses: 0,
    draws: 0,
    totalWon: 0,
    totalLost: 0
  },
  selectedAmount: 0,
  currentSection: 'game',
  matchmaking: false,
  matchTimer: null,

  game: {
    active: false,
    started: false,
    turn: 0,          // 0=red, 1=blue, 2=green, 3=yellow
    diceValue: 0,
    rolled: false,
    pieces: {
      red:    [-1,-1,-1,-1],
      blue:   [-1,-1,-1,-1],
      green:  [-1,-1,-1,-1],
      yellow: [-1,-1,-1,-1]
    },
    finished: { red:0, blue:0, green:0, yellow:0 },
    log: []
  },

  history: [],
  transactions: [],
  leaderboard: []
};

const COLORS = ['red','blue','green','yellow'];
const COLOR_EMOJIS = { red:'🔴', blue:'🔵', green:'🟢', yellow:'🟡' };
const DICE_FACES = ['⚀','⚁','⚂','⚃','⚄','⚅'];
const LUDO_API_URL = (window.__LUDO_BACKEND_URL__ || 'https://ludo-backend-g2ir.onrender.com').replace(/\/$/, '');
const SYSTEM_BACKEND_URL = (window.__SYSTEM_BACKEND_URL__ || 'https://system-backend-1u5m.onrender.com').replace(/\/$/, '');
let aiEnabled = false;

async function loadAiConfig() {
  const aiButton = $('playAiSidebar');
  if (aiButton) aiButton.classList.add('hidden');
  try {
    const response = await fetch(`${LUDO_API_URL}/api/ai/config`, { cache: 'no-store' });
    const json = await response.json();
    aiEnabled = response.ok && Boolean((json?.data ?? json)?.ai_enabled);
  } catch {
    aiEnabled = false;
  }
  window.__LUDO_AI_ENABLED__ = aiEnabled;
  if (aiButton) aiButton.classList.toggle('hidden', !aiEnabled);
}

function refreshAiButtonVisibility() {
  loadAiConfig().catch(() => {
    aiEnabled = false;
    window.__LUDO_AI_ENABLED__ = false;
    $('playAiSidebar')?.classList.add('hidden');
  });
}

// ─── SAMPLE DATA ─────────────────────────────────────────────
function buildSampleLeaderboard() {
  const names = ['ThunderLudo','CrownKing','BlitzPiece','DiceWizard','RollMaster',
    'PurpleAce','GoldenRoll','NightShade','SwiftPiece','LuckyDice',
    'BoardBoss','TacticalR','RapidFire','QuietStorm','IronLudo'];
  const colors = ['#7c6af7','#f0b133','#ff4465','#36e89c','#4e94ff',
    '#a89cf5','#ffd93d','#ff9040','#40d0ff','#c060ff',
    '#ff6060','#60ff90','#6090ff','#ffb060','#30c0c0'];
  return names.map((n,i) => ({
    name: n,
    wins: Math.max(1, 80 - i*5 + Math.floor(Math.random()*8)),
    losses: Math.floor(Math.random()*20) + 5,
    earnings: Math.max(20, 1200 - i*80 + Math.floor(Math.random()*60)),
    color: colors[i],
    initial: n[0]
  }));
}

// ─── DOM HELPERS ─────────────────────────────────────────────
const $ = id => document.getElementById(id);
const make = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };

function goToGame(opponentName) {
  if ((opponentName || 'AI') === 'AI' && window.__LUDO_AI_ENABLED__ !== true) return;
  const auth = JSON.parse(sessionStorage.getItem('appAuth') || '{}');
  const state = {
    name: S.player.name, balance: S.player.balance, wins: S.player.wins, losses: S.player.losses,
    totalWon: S.player.totalWon, totalLost: S.player.totalLost,
    selectedAmount: S.selectedAmount || 10, opponent: { name: opponentName || 'AI' }, autoStart: true,
  };
  sessionStorage.setItem('ludoGameState', JSON.stringify(state));
  const params = new URLSearchParams();
  if (auth.token) params.set('token', auth.token);
  if (auth.launch) params.set('launch', auth.launch);
  window.location.href = `game.html${params.toString() ? '?' + params.toString() : ''}`;
}
window.goToGame = goToGame;

function toast(msg, type = 'info') {
  const t = make('div', `toast ${type}`);
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  t.textContent = `${icon}  ${msg}`;
  $('toastContainer').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function showOverlay(id)  { $(id).setAttribute('aria-hidden','false'); }
function hideOverlay(id)  { $(id).setAttribute('aria-hidden','true'); }

function formatMoney(n) { return '$' + Math.abs(n).toFixed(0); }
function timeAgo(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m/60)}h ago`;
}

// ─── NAVIGATION ──────────────────────────────────────────────
const SECTION_TITLES = {
  dashboard: 'Dashboard', game: 'Play', wallet: 'Wallet',
  leaderboard: 'Rankings', history: 'History'
};

function navTo(section) {
  if (S.currentSection === section) return;
  document.querySelectorAll('.nav-tab').forEach(n => n.classList.toggle('active', n.dataset.section === section));
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const el = $(`section-${section}`);
  if (el) el.classList.add('active');
  S.currentSection = section;

  // Lazy renders
  if (section === 'leaderboard') renderLeaderboard();
  if (section === 'history')     renderHistory();
  if (section === 'wallet')      renderWallet();
}

document.querySelectorAll('.nav-tab').forEach(item => {
  item.addEventListener('click', () => navTo(item.dataset.section));
});

function showSessionExpiredOverlay(authData) {
  document.getElementById('ludoAuthBlock')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'ludoAuthBlock';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:radial-gradient(ellipse at center,#1a0f00 0%,#0d0d0d 70%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:32px 24px;text-align:center;color:#f5e6c8;font-family:Rajdhani,sans-serif;';
  overlay.innerHTML = `
    <div style="font-size:3.6rem;line-height:1;">⏰</div>
    <h1 style="font-family:Cinzel,serif;font-size:1.4rem;color:#f0c94a;margin:0;">Session Expired</h1>
    <p style="max-width:300px;line-height:1.6;color:rgba(245,230,200,.75);">Your game link has expired. Get a fresh link to continue.</p>
    <button id="ludoReloadGameBtn" style="background:linear-gradient(135deg,#a07810,#d4a017);color:#1a1005;border:0;border-radius:999px;padding:13px 32px;font-weight:800;cursor:pointer;font-family:inherit;font-size:.95rem;">🔄 Reload Game</button>
    <div id="ludoReloadStatus" style="min-height:1.2em;color:rgba(245,230,200,.55);font-size:.75rem;"></div>`;
  document.getElementById('loader')?.style.setProperty('display', 'none');
  document.body.appendChild(overlay);
  document.getElementById('ludoReloadGameBtn')?.addEventListener('click', async () => {
    const button = document.getElementById('ludoReloadGameBtn');
    const status = document.getElementById('ludoReloadStatus');
    button.disabled = true;
    button.textContent = '⏳ Getting fresh link…';
    try {
      const response = await fetch(`${SYSTEM_BACKEND_URL}/api/admin/games/game-tokens/refresh-launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: authData?.token || '',
          phone: authData?.phonenumber || '',
          username: authData?.username || '',
          balance: authData?.balance ?? 0,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.launch) throw new Error(data.error || `HTTP ${response.status}`);
      const url = new URL(window.location.href);
      url.searchParams.set('token', data.token || authData.token);
      url.searchParams.set('launch', data.launch);
      window.location.href = url.toString();
    } catch (error) {
      status.textContent = 'Could not refresh. Please open the game again from Telegram.';
      button.disabled = false;
      button.textContent = '🔄 Reload Game';
    }
  });
}

// ─── URL PARAMS & AUTH INIT ──────────────────────────────────
(async function checkAccess() {
  if (!document.getElementById('appHeader')) return;

  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const launch = params.get('launch');
  const phonenumber = params.get('phonenumber');
  const username = params.get('username');
  const balance = params.get('balance');

  if (token && launch) {
    sessionStorage.setItem('appAuth', JSON.stringify({ token, launch, phonenumber, username, balance }));
  } else if (token && phonenumber && username && balance) {
    sessionStorage.setItem('appAuth', JSON.stringify({ token, phonenumber, username, balance }));
  }

  const authData = JSON.parse(sessionStorage.getItem('appAuth'));
  const hasSecureAuth = authData?.token && authData?.launch;
  const hasLegacyAuth = authData?.token && authData?.phonenumber && authData?.username && authData.balance !== undefined;

  if (!hasSecureAuth && !hasLegacyAuth) {
    document.body.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; background:var(--bg-0); color:var(--red); font-family:'Outfit',sans-serif; text-align:center; padding:20px;">
        <div style="font-size:60px; margin-bottom:20px;">🚫</div>
        <h1 style="font-size:24px; font-weight:800; margin-bottom:10px;">Access Denied</h1>
        <p style="color:var(--text-2); font-size:14px; max-width:300px;">
          Missing required parameters. Please launch the app with a valid token, phone number, username, and balance.
        </p>
      </div>
    `;
    throw new Error('Access Denied: Missing URL parameters.');
  }

  // Resolve the launch token against system_backend so the profile and balance
  // always reflect the real account, rather than URL or session values.
  if (authData.launch) {
    try {
      const response = await fetch(`${SYSTEM_BACKEND_URL}/api/verify-launch-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ launch: authData.launch }),
        cache: 'no-store',
      });
      const resolved = await response.json().catch(() => ({}));
      if (!response.ok || resolved.valid === false) {
        const authError = new Error(resolved.reason || `HTTP ${response.status}`);
        authError.status = response.status;
        throw authError;
      }
      authData.username = resolved.username || resolved.user?.username || authData.username;
      authData.balance = resolved.balance ?? resolved.user?.balance ?? authData.balance;
      authData.phonenumber = resolved.phone || resolved.user?.phone || authData.phonenumber;
      sessionStorage.setItem('appAuth', JSON.stringify(authData));
      window.XO_USERNAME = authData.username;
      window.XO_BALANCE = Number(authData.balance ?? 0);
    } catch (error) {
      console.error('[Ludo] Failed to resolve real system account', error);
      if (error.status === 401 || /expired|jwt/i.test(error.message || '')) {
        showSessionExpiredOverlay(authData);
        return;
      }
      if (!hasLegacyAuth && (authData.balance === undefined || authData.balance === null)) {
        throw new Error('Could not load your account from system_backend.');
      }
    }
  }

  S.player.name = authData.username || '';
  if (authData.balance !== undefined && authData.balance !== null && Number.isFinite(Number(authData.balance))) {
    S.player.balance = Number(authData.balance);
  }

  if (window.Telegram && window.Telegram.WebApp) {
    const tg = window.Telegram.WebApp;
    try { tg.expand(); } catch(e) {}
    tg.MainButton?.hide?.();
  }
  syncProfile();
  window.XO_USERNAME = S.player.name;
  window.XO_BALANCE = S.player.balance;
  if (S.player.balance !== null) updateBalanceDisplay(S.player.balance);
  $('balRefreshBtn')?.addEventListener('click', () => refreshBalance(false));
  const loader = document.getElementById('loader');
  if (loader) {
    loader.style.opacity = '0';
    loader.style.transition = 'opacity .4s ease';
    setTimeout(() => { loader.style.display = 'none'; }, 400);
  }
})();

function syncProfile() {
  const name = S.player.name;
  const initial = name.trim().charAt(0).toUpperCase();
  const avatarEl = $('hdrAvatar'); if (avatarEl) avatarEl.textContent = initial;
  const telegramUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (telegramUser?.photo_url && avatarEl) {
    avatarEl.innerHTML = `<img src="${telegramUser.photo_url}" alt="avatar">`;
  }
  const nameEl = $('hdrName'); if (nameEl) nameEl.textContent = name;
  const dashEl = $('dashName'); if (dashEl) dashEl.textContent = name;
  syncBalance();
}

function updateBalanceDisplay(balance) {
  const value = Number(balance);
  if (!Number.isFinite(value)) return;
  S.player.balance = value;
  const balanceEl = $('headerBalance');
  if (balanceEl) balanceEl.textContent = '💰 ' + value.toLocaleString();
  syncBalance();
  window.XO_BALANCE = value;
}

async function refreshBalance(silent = false) {
  const spinner = $('balSpinner');
  const button = $('balRefreshBtn');
  if (!silent) {
    spinner?.classList.remove('hidden');
    if (button) button.disabled = true;
  }
  try {
    const auth = JSON.parse(sessionStorage.getItem('appAuth') || '{}');
    if (auth.launch) {
      const response = await fetch(`${SYSTEM_BACKEND_URL}/api/verify-launch-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ launch: auth.launch }),
        cache: 'no-store',
      });
      const resolved = await response.json().catch(() => ({}));
      if (!response.ok || resolved.valid === false) throw new Error(resolved.reason || `HTTP ${response.status}`);
      auth.username = resolved.username || resolved.user?.username || auth.username;
      auth.balance = resolved.balance ?? resolved.user?.balance ?? auth.balance;
      sessionStorage.setItem('appAuth', JSON.stringify(auth));
      S.player.name = auth.username || S.player.name;
      syncProfile();
    }
    if (auth.balance !== undefined && auth.balance !== null) updateBalanceDisplay(auth.balance);
  } catch (error) {
    if (!silent) console.error('[Ludo] Failed to refresh system balance', error);
  } finally {
    if (!silent) {
      spinner?.classList.add('hidden');
      if (button) button.disabled = false;
    }
  }
}

function syncBalance() {
  const b = S.player.balance;
  const header = $('headerBalance');
  if (header) header.textContent = b === null ? '💰 …' : '💰 ' + Number(b).toLocaleString();
  const wbal = $('walletBalance'); if(wbal) wbal.textContent = b === null ? '— ETB' : Number(b).toLocaleString() + ' ETB';
  const mhbal = $('mhBalance'); if(mhbal) mhbal.textContent = formatMoney(b);
}

// ─── DASHBOARD & RIGHT PANEL RENDERING ───────────────────────
function renderDashboard() {
  const wins = S.player.wins;
  const losses = S.player.losses;
  const netEarnings = S.player.totalWon - S.player.totalLost;
  const rank = Math.max(1, 50 - wins);

  // Update Stats section in Dashboard
  const wEl = $('statWins'); if (wEl) wEl.textContent = wins;
  const lEl = $('statLosses'); if (lEl) lEl.textContent = losses;
  const eEl = $('statEarnings'); if (eEl) eEl.textContent = formatMoney(netEarnings);
  
  const total = wins + losses;
  const wrEl = $('statWinRate'); if (wrEl) wrEl.textContent = total > 0 ? Math.round(wins/total*100) + '%' : '—';
  
  // Update Rank badges
  const rankVal = '#' + rank;
  document.querySelectorAll('[id$="Rank"]').forEach(el => {
    if (el.id === 'dashRank' || el.id === 'mhRank') el.textContent = rankVal;
  });

  // Mini-header Wins
  const mhw = $('mhWins'); if (mhw) mhw.textContent = wins;

  // Right Panel Stats
  const rpw = $('sideWins'); if (rpw) rpw.textContent = wins;
  const rpl = $('sideLosses'); if (rpl) rpl.textContent = losses;
  const rpd = $('sideDraws'); if (rpd) rpd.textContent = S.player.draws || 0;
  const rpr = $('ringPct');
  const ring = $('ringFill');
  if (rpr) {
    const totalGames = wins + losses + (S.player.draws || 0);
    const percent = totalGames ? Math.round(wins / totalGames * 100) : 0;
    rpr.textContent = percent + '%';
    if (ring) ring.setAttribute('stroke-dasharray', `${percent} 100`);
    const sub = $('winrateSub'); if (sub) sub.textContent = `${totalGames} total games`;
  }

  // Mini History on Dashboard
  const miniHist = $('miniHistory');
  if (miniHist) {
    miniHist.innerHTML = '';
    if (S.history.length === 0) {
      miniHist.innerHTML = '<div class="mh-empty">No games yet — play your first game!</div>';
    } else {
      S.history.slice(0, 3).forEach((h, i) => {
        const item = make('div', 'mh-item');
        item.innerHTML = `
          <div class="mh-res ${h.type}">${h.type === 'win' ? '🏆' : '💀'}</div>
          <span>Match vs AI</span>
          <span class="mh-amt ${h.type}">${h.type === 'win' ? '+' : '-'}${formatMoney(h.amount * (h.type==='win'?2:1))}</span>`;
        miniHist.appendChild(item);
      });
    }
  }

  // Right Panel: Online List
  const rpOnline = $('onlineList');
  if (rpOnline) rpOnline.innerHTML = '';

  // Right Panel: Players Stats
  const rpStats = $('statsList');
  if (rpStats) {
    rpStats.innerHTML = '';
    // Display our stat first, then general list
    const playersList = [
      { name: 'You (Red)', wins: wins, losses: losses, color: '#ff4465', initial: 'Y' },
      { name: 'AI Blue', wins: 14, losses: 10, color: '#4e94ff', initial: 'B' },
      { name: 'AI Green', wins: 9, losses: 12, color: '#36e89c', initial: 'G' },
      { name: 'AI Yellow', wins: 18, losses: 15, color: '#ffd93d', initial: 'Y' }
    ];
    playersList.forEach(p => {
      const li = make('li', 'rp-stat-item');
      li.innerHTML = `
        <div class="rp-stat-avatar" style="background:${p.color}">${p.initial}</div>
        <div class="rp-stat-name">${p.name}</div>
        <div class="rp-stat-wl">${p.wins}W / ${p.losses}L</div>`;
      rpStats.appendChild(li);
    });
  }
}

// Amount selector sync
document.querySelectorAll('.amount-selector').forEach(sel => {
  sel.addEventListener('click', e => {
    const btn = e.target.closest('.amount-btn');
    if (!btn) return;
    sel.querySelectorAll('.amount-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    S.selectedAmount = Number(btn.dataset.amount);

    // Sync all amount selectors
    document.querySelectorAll(`.amount-btn[data-amount="${S.selectedAmount}"]`)
      .forEach(b => b.classList.add('selected'));
    document.querySelectorAll(`.amount-btn:not([data-amount="${S.selectedAmount}"])`)
      .forEach(b => b.classList.remove('selected'));

    const betDisp = $('gameBetDisplay'); if(betDisp) betDisp.textContent = '$' + S.selectedAmount;
    const rpBetDisp = $('rpBetAmount'); if(rpBetDisp) rpBetDisp.textContent = '$' + S.selectedAmount;
    
    renderOnlineBar();
  });
});

// ─── MATCHMAKING & ACTIONS ───────────────────────────────────
const findMatchBtn = $('findMatchBtn');
if (findMatchBtn) findMatchBtn.addEventListener('click', startMatchmaking);
const rpFindMatchBtn = $('rpFindMatchBtn');
if (rpFindMatchBtn) rpFindMatchBtn.addEventListener('click', startMatchmaking);

const playAiBtn = $('playAiSidebar');
if (playAiBtn) {
  playAiBtn.addEventListener('click', () => {
    if (!aiEnabled) return;
    if (S.selectedAmount === 0) {
      toast('Please select a bet amount first!', 'error'); return;
    }
    goToGame('AI');
  });
}
const mhPlayBtn = $('mhPlayBtn');
if (mhPlayBtn) {
  mhPlayBtn.addEventListener('click', () => {
    if (!aiEnabled) return;
    if (S.selectedAmount === 0) {
      toast('Please select a bet amount first!', 'error'); return;
    }
    goToGame('AI');
  });
}

loadAiConfig();
setInterval(refreshAiButtonVisibility, 10000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshAiButtonVisibility();
});

function startMatchmaking() {
  if (S.selectedAmount === 0) {
    toast('Please select a bet amount first!', 'error'); return;
  }
  if (S.player.balance < S.selectedAmount) {
    toast('Insufficient balance! Deposit funds first.', 'error'); return;
  }
  showOverlay('matchModal');
  S.matchmaking = true;
  const delay = 1800 + Math.random() * 1500;
  S.matchTimer = setTimeout(() => {
    hideOverlay('matchModal');
    S.matchmaking = false;
    goToGame(S.selectedOpponent ? S.selectedOpponent.name : 'AI');
    toast('Match found! Game starting…', 'success');
  }, delay);
}

$('cancelMatchBtn').addEventListener('click', () => {
  clearTimeout(S.matchTimer);
  S.matchmaking = false;
  hideOverlay('matchModal');
});

// Header quick-action buttons
$('historyBtn').addEventListener('click', () => navTo('history'));
$('helpBtn').addEventListener('click', () => showOverlay('helpModal'));

const notifBtn = $('notifBtn');
if (notifBtn) {
  notifBtn.addEventListener('click', () => {
    toast('No new notifications.', 'info');
    const dot = document.querySelector('.notif-dot');
    if (dot) dot.style.display = 'none';
  });
}

// Dashboard first game play button helper
const historyPlayBtn = $('historyPlayBtn');
if (historyPlayBtn) {
  historyPlayBtn.addEventListener('click', () => {
    goToGame('AI');
  });
}

// ─── LUDO BOARD RENDERER (only runs on game.html — guarded) ──
if (document.getElementById('ludoBoard')) {
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

function cellId(r, c) { return `bc-${r}-${c}`; }

function buildBoard() {
  const board = $('ludoBoard');
  board.innerHTML = '';
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      const div = make('div', getCellClass(r, c));
      div.id = cellId(r, c);
      const allSlots = [...HOME_SLOTS.red, ...HOME_SLOTS.blue, ...HOME_SLOTS.yellow, ...HOME_SLOTS.green];
      const slotColors = [
        ...HOME_SLOTS.red.map(()=>'r'), ...HOME_SLOTS.blue.map(()=>'b'),
        ...HOME_SLOTS.yellow.map(()=>'y'), ...HOME_SLOTS.green.map(()=>'g')
      ];
      const si = allSlots.findIndex(([sr,sc]) => sr === r && sc === c);
      if (si >= 0) div.classList.add('bc-hcircle', slotColors[si]);
      board.appendChild(div);
    }
  }
}

// ─── PIECE RENDERING ─────────────────────────────────────────
function clearPieces() {
  document.querySelectorAll('.piece').forEach(p => p.remove());
}

function piecePos(color, idx) {
  const pos = S.game.pieces[color][idx];
  if (pos === -1) return HOME_SLOTS[color][idx];
  if (pos >= 52 && pos <= 56) return HOME_COLS[color][pos - 52];
  if (pos === 57) return null;
  return MAIN_PATH[pos];
}

function renderPieces() {
  clearPieces();
  COLORS.forEach(color => {
    S.game.pieces[color].forEach((_, idx) => {
      const rc = piecePos(color, idx);
      if (!rc) return;
      const [r, c] = rc;
      const cell = $(cellId(r, c));
      if (!cell) return;
      const piece = make('div', `piece ${color}`);
      piece.id = `piece-${color}-${idx}`;
      piece.textContent = idx + 1;
      piece.dataset.color = color;
      piece.dataset.idx = idx;
      piece.addEventListener('click', () => handlePieceClick(color, idx));
      cell.appendChild(piece);
    });
  });
}

// ─── GAME STATE MACHINE ──────────────────────────────────────
let turnTimer = null;
let secondsLeft = 60;

function stopTurnTimer() {
  if (turnTimer) {
    clearInterval(turnTimer);
    turnTimer = null;
  }
}

function resetTurnTimer() {
  stopTurnTimer();
  secondsLeft = 60;
  updateTimerDisplay();
  
  if (!S.game.started) return;
  
  turnTimer = setInterval(() => {
    secondsLeft--;
    updateTimerDisplay();
    
    if (secondsLeft <= 0) {
      stopTurnTimer();
      handleTimeout();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const el = $('mhTimer');
  if (!el) return;
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  el.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function handleTimeout() {
  addLog(`Time's up! Auto-rolled or turn skipped.`, 'move');
  const col = currentColor();
  if (col === 'red') {
    if (!S.game.rolled) {
      rollDice();
    } else {
      const movable = getMovablePieces('red', S.game.diceValue);
      if (movable.length > 0) {
        movePiece('red', movable[0], S.game.diceValue);
      } else {
        nextTurn();
      }
    }
  } else {
    nextTurn();
  }
}

function resetGame() {
  const g = S.game;
  g.active = false; g.started = false;
  g.turn = 0; g.diceValue = 0; g.rolled = false;
  COLORS.forEach(col => {
    g.pieces[col] = [-1,-1,-1,-1];
    g.finished[col] = 0;
  });
  g.log = [];
  renderPieces();
  updateGameUI();
  $('gameLog').innerHTML = '<div class="log-entry">Game ready — press Start.</div>';

  stopTurnTimer();
  const timerEl = $('mhTimer');
  if (timerEl) timerEl.textContent = '01:00';
  const gameIdEl = $('mhGameId');
  if (gameIdEl) gameIdEl.textContent = '#——';
}

function startAIGame() {
  resetGame();
  S.game.active = true;
  S.game.started = true;
  $('startGameBtn').disabled = true;
  $('rollDiceBtn').disabled = false;
  renderGamePlayers();
  updateGameUI();
  addLog('Game started! Red goes first. 🎲', 'roll');

  const gameId = Math.floor(10000 + Math.random() * 90000);
  const gameIdEl = $('mhGameId');
  if (gameIdEl) gameIdEl.textContent = '#' + gameId;

  resetTurnTimer();
}

const _startGameBtn = document.getElementById('startGameBtn');
if (_startGameBtn) {
  _startGameBtn.addEventListener('click', () => {
    if (S.selectedAmount === 0) {
      toast('Please select a bet amount first!', 'error'); return;
    }
    if (S.player.balance < S.selectedAmount) {
      toast('Insufficient balance!', 'error'); return;
    }
    goToGame('AI');
  });
}

const _forfeitBtn = document.getElementById('forfeitBtn');
if (_forfeitBtn) {
  _forfeitBtn.addEventListener('click', () => {
    if (!S.game.started) return;
    endGame(false);
    toast('You forfeited the game.', 'error');
  });
}

function currentColor() { return COLORS[S.game.turn % 4]; }

function renderGamePlayers() {
  const container = $('gamePlayers');
  container.innerHTML = '';
  const playerNames = ['You (Red)','AI Blue','AI Green','AI Yellow'];
  COLORS.forEach((col, i) => {
    const row = make('div', 'game-player-row' + (i === S.game.turn ? ' active-player' : ''));
    row.id = `gpr-${col}`;
    row.innerHTML = `<div class="color-dot ${col}"></div><span>${playerNames[i]}</span>
      <span style="margin-left:auto;font-size:11px;color:var(--text-3)">${S.game.finished[col]}/4 home</span>`;
    container.appendChild(row);
  });
}

function updateGameUI() {
  const col = currentColor();
  const dot = $('turnDot'); if (dot) dot.className = `turn-dot ${col}`;
  const txt = $('turnText'); if (txt) txt.textContent = (col === 'red' ? 'Your' : col.charAt(0).toUpperCase()+col.slice(1)) + "'s Turn";
  const rollBtn = $('rollDiceBtn'); if (rollBtn) rollBtn.disabled = !S.game.started || S.game.rolled;

  COLORS.forEach((c, i) => {
    const row = $(`gpr-${c}`);
    if (row) row.className = 'game-player-row' + (i === S.game.turn % 4 ? ' active-player' : '');
  });

  COLORS.forEach(c => {
    const row = $(`gpr-${c}`);
    if (row) {
      const span = row.querySelector('span:last-child');
      if (span) span.textContent = `${S.game.finished[c]}/4 home`;
    }
  });
}

$('rollDiceBtn') && $('rollDiceBtn').addEventListener('click', () => {
  if (!S.game.started || S.game.rolled) return;
  rollDice();
});

$('dice') && $('dice').addEventListener('click', () => {
  if (!S.game.started || S.game.rolled) return;
  rollDice();
});

function rollDice() {
  const col = currentColor();
  const value = Math.floor(Math.random() * 6) + 1;
  S.game.diceValue = value;
  S.game.rolled = true;
  $('rollDiceBtn').disabled = true;

  const diceEl = $('dice');
  diceEl.classList.add('rolling');
  setTimeout(() => {
    diceEl.classList.remove('rolling');
    diceEl.textContent = DICE_FACES[value - 1];
    $('diceValueLabel').textContent = 'Rolled ' + value;
    addLog(`${col.charAt(0).toUpperCase()+col.slice(1)} rolled a ${value}`, 'roll');

    if (col === 'red') {
      highlightMovable(value);
      const movable = getMovablePieces(col, value);
      if (movable.length === 0) {
        addLog('No valid moves. Turn skipped.', 'move');
        setTimeout(nextTurn, 900);
      }
    } else {
      setTimeout(() => aiMove(col, value), 700);
    }
  }, 560);
}

function getMovablePieces(color, diceVal) {
  const pieces = S.game.pieces[color];
  const movable = [];
  pieces.forEach((pos, idx) => {
    if (pos === 57) return;
    if (pos === -1 && diceVal === 6) { movable.push(idx); return; }
    if (pos === -1) return;
    if (pos >= 52) {
      const newStep = pos - 52 + diceVal;
      if (newStep <= 4) movable.push(idx);
      else if (newStep === 5) movable.push(idx);
    } else {
      movable.push(idx);
    }
  });
  return movable;
}

function highlightMovable(diceVal) {
  document.querySelectorAll('.piece').forEach(p => p.classList.remove('selectable'));
  if (currentColor() !== 'red') return;
  getMovablePieces('red', diceVal).forEach(idx => {
    const el = $(`piece-red-${idx}`);
    if (el) el.classList.add('selectable');
  });
}

function handlePieceClick(color, idx) {
  if (color !== 'red' || !S.game.rolled) return;
  const movable = getMovablePieces('red', S.game.diceValue);
  if (!movable.includes(idx)) { toast('Cannot move this piece!', 'error'); return; }
  movePiece('red', idx, S.game.diceValue);
  document.querySelectorAll('.piece').forEach(p => p.classList.remove('selectable'));
}

function movePiece(color, idx, steps) {
  const g = S.game;
  const pos = g.pieces[color][idx];
  let newPos;
  let bonusTurn = false;

  if (pos === -1) {
    newPos = ENTRY_POS[color];
    addLog(`${color} piece ${idx+1} entered the board!`, 'move');
    if (steps === 6) bonusTurn = true;
  } else if (pos >= 52) {
    const hcStep = pos - 52;
    const next = hcStep + steps;
    if (next >= 5) {
      newPos = 57;
      g.finished[color]++;
      addLog(`${color} piece ${idx+1} reached home! 🏠`, 'win');
      checkWin(color);
    } else {
      newPos = 52 + next;
    }
  } else {
    const homeEntry = HOME_COL_ENTRY[color];
    let remaining = steps;
    let curPos = pos;

    for (let s = 0; s < steps; s++) {
      curPos = (curPos + 1) % 52;
      if (curPos === homeEntry) {
        remaining = steps - s - 1;
        if (remaining === 0) {
          newPos = curPos;
        } else {
          newPos = 52 + (remaining - 1);
        }
        break;
      }
    }
    if (newPos === undefined) {
      newPos = (pos + steps) % 52;
    }

    if (newPos < 52) {
      COLORS.forEach(other => {
        if (other === color) return;
        g.pieces[other].forEach((opos, oidx) => {
          if (opos === newPos && !SAFE_POSITIONS.has(newPos)) {
            g.pieces[other][oidx] = -1;
            addLog(`${color} captured ${other} piece ${oidx+1}!`, 'win');
            bonusTurn = true;
          }
        });
      });
    }
  }

  g.pieces[color][idx] = newPos;
  renderPieces();

  if (bonusTurn && color === 'red') {
    addLog('Bonus turn! Roll again.', 'roll');
    g.rolled = false;
    updateGameUI();
  } else if (bonusTurn) {
    nextTurn(color);
  } else {
    nextTurn();
  }
}

function aiMove(color, diceVal) {
  const movable = getMovablePieces(color, diceVal);
  if (movable.length === 0) {
    addLog(`${color} has no valid moves.`, 'move');
    nextTurn();
    return;
  }
  let best = movable[0];
  let bestScore = -999;
  movable.forEach(idx => {
    const pos = S.game.pieces[color][idx];
    let score = 0;
    if (pos === -1) score = diceVal === 6 ? 10 : -999;
    else if (pos >= 52) score = 100 + (pos - 52);
    else score = pos;
    if (score > bestScore) { bestScore = score; best = idx; }
  });
  movePiece(color, best, diceVal);
}

function nextTurn(forceColor) {
  S.game.rolled = false;
  if (!forceColor) S.game.turn = (S.game.turn + 1) % 4;
  updateGameUI();
  resetTurnTimer();

  const col = currentColor();
  if (col !== 'red' && S.game.started) {
    setTimeout(() => {
      if (!S.game.started) return;
      const val = Math.floor(Math.random() * 6) + 1;
      S.game.diceValue = val;
      S.game.rolled = true;
      $('dice').classList.add('rolling');
      $('diceValueLabel').textContent = '…';
      setTimeout(() => {
        $('dice').classList.remove('rolling');
        $('dice').textContent = DICE_FACES[val - 1];
        $('diceValueLabel').textContent = 'Rolled ' + val;
        addLog(`${col.charAt(0).toUpperCase()+col.slice(1)} rolled ${val}`, 'roll');
        setTimeout(() => aiMove(col, val), 400);
      }, 560);
    }, 600);
  }
}

function checkWin(color) {
  if (S.game.finished[color] >= 4) {
    S.game.started = false;
    if (color === 'red') {
      endGame(true);
    } else {
      endGame(false, color);
    }
  }
}

function endGame(playerWon, winnerColor) {
  S.game.active = false;
  S.game.started = false;
  $('startGameBtn').disabled = false;
  $('rollDiceBtn').disabled = true;
  stopTurnTimer();

  const bet = S.selectedAmount;
  const ts = Date.now();

  if (playerWon) {
    const gain = bet * 2;
    S.player.balance += gain;
    S.player.wins++;
    S.player.totalWon += gain;
    addTransaction('win', gain, ts);
    addHistory('win', bet, ts);
    $('winMsg').textContent = `You earned ${formatMoney(gain)}!`;
    showOverlay('winModal');
    spawnConfetti();
  } else {
    S.player.balance -= bet;
    S.player.losses++;
    S.player.totalLost += bet;
    addTransaction('loss', bet, ts);
    addHistory('loss', bet, ts);
    const w = winnerColor ? winnerColor : 'AI';
    $('loseMsg').textContent = `${w.charAt(0).toUpperCase()+w.slice(1)} wins. You lost ${formatMoney(bet)}.`;
    showOverlay('loseModal');
  }

  syncBalance();
  renderDashboard();
}

$('winContinueBtn') && $('winContinueBtn').addEventListener('click', () => { hideOverlay('winModal'); resetGame(); });
$('loseContinueBtn') && $('loseContinueBtn').addEventListener('click', () => { hideOverlay('loseModal'); resetGame(); });

// ─── GAME LOG ────────────────────────────────────────────────
function addLog(text, type = '') {
  S.game.log.unshift({ text, type });
  if (S.game.log.length > 50) S.game.log.pop();
  const log = $('gameLog');
  if (log) {
    // Inline control bar — just show the latest entry
    log.innerHTML = `<div class="log-entry ${type}">${text}</div>`;
  }
}

// ─── CONFETTI ────────────────────────────────────────────────
function spawnConfetti() {
  const burst = $('confettiBurst');
  if (!burst) return;
  burst.innerHTML = '';
  const colors = ['#f0b133','#7c6af7','#36e89c','#ff4465','#4e94ff','#ffd93d'];
  for (let i = 0; i < 22; i++) {
    const p = make('div','confetti-piece');
    p.style.setProperty('--x', (Math.random()*300-150)+'px');
    p.style.setProperty('--r', (Math.random()*720-360)+'deg');
    p.style.left = (Math.random()*100) + '%';
    p.style.background = colors[Math.floor(Math.random()*colors.length)];
    p.style.animationDelay = (Math.random()*0.4)+'s';
    burst.appendChild(p);
  }
}

} // end ludoBoard guard

// ─── WALLET ──────────────────────────────────────────────────
function addTransaction(type, amount, ts) {
  S.transactions.unshift({ type, amount, ts });
}

function renderWallet() {
  const wWon = $('wWon'), wLost = $('wLost'), wNet = $('wNet');
  if (wWon) wWon.textContent = formatMoney(S.player.totalWon);
  if (wLost) wLost.textContent = formatMoney(S.player.totalLost);
  const net = S.player.totalWon - S.player.totalLost;
  if (wNet) {
    wNet.textContent = (net >= 0 ? '+' : '-') + formatMoney(net);
    wNet.className = 'wm-value ' + (net >= 0 ? 'green' : 'red');
  }

  const list = $('txList');
  if (!list) return;
  list.innerHTML = '';
  $('txCount').textContent = S.transactions.length + ' records';

  if (S.transactions.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">💸</div><div>No transactions yet</div></div>`;
    return;
  }

  S.transactions.slice(0, 30).forEach(tx => {
    const div = make('div', 'tx-item');
    const isPos = tx.type === 'win' || tx.type === 'deposit';
    const icons = { win:'🏆', loss:'💀', deposit:'💳', withdraw:'📤' };
    const labels = { win:'Game Win', loss:'Game Loss', deposit:'Deposit', withdraw:'Withdrawal' };
    div.innerHTML = `
      <div class="tx-icon ${tx.type}">${icons[tx.type]}</div>
      <div class="tx-info">
        <div class="tx-title">${labels[tx.type]}</div>
        <div class="tx-time">${timeAgo(tx.ts)}</div>
      </div>
      <div class="tx-amount ${isPos ? 'pos' : 'neg'}">${isPos ? '+' : '-'}${formatMoney(tx.amount)}</div>`;
    list.appendChild(div);
  });
}

$('depositBtn').addEventListener('click', () => {
  $('depositAmount').value = '';
  showOverlay('depositModal');
});
$('withdrawBtn').addEventListener('click', () => {
  $('withdrawAmount').value = '';
  showOverlay('withdrawModal');
});

$('confirmDeposit').addEventListener('click', () => {
  const amt = parseFloat($('depositAmount').value);
  if (!amt || amt <= 0) { toast('Enter a valid amount', 'error'); return; }
  S.player.balance += amt;
  S.player.totalWon += amt;
  addTransaction('deposit', amt, Date.now());
  syncBalance();
  hideOverlay('depositModal');
  toast(`Deposited ${formatMoney(amt)} successfully!`, 'success');
  renderWallet();
  renderDashboard();
});

$('confirmWithdraw').addEventListener('click', () => {
  const amt = parseFloat($('withdrawAmount').value);
  if (!amt || amt <= 0) { toast('Enter a valid amount', 'error'); return; }
  if (amt > S.player.balance) { toast('Insufficient balance!', 'error'); return; }
  S.player.balance -= amt;
  S.player.totalLost += amt;
  addTransaction('withdraw', amt, Date.now());
  syncBalance();
  hideOverlay('withdrawModal');
  toast(`Withdrawn ${formatMoney(amt)} successfully!`, 'success');
  renderWallet();
  renderDashboard();
});

// ─── HISTORY ─────────────────────────────────────────────────
function addHistory(type, amount, ts) {
  S.history.unshift({ type, amount, ts });
}

function renderHistory() {
  const filter = document.querySelector('#historyFilter .tab-btn.active');
  const f = filter ? filter.dataset.filter : 'all';
  const list = $('historyList');
  if (!list) return;
  list.innerHTML = '';

  const items = S.history.filter(h => f === 'all' || h.type === f);

  if (items.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🎮</div>
      <div>${f === 'all' ? 'No games played yet' : 'No ' + f + 's yet'}</div>
      <button class="btn-primary" style="margin-top:16px" onclick="goToGame('AI')">Play Now</button>
    </div>`;
    return;
  }

  items.forEach((h, i) => {
    const div = make('div', `history-item ${h.type}`);
    const opponents = ['AI Bob','AI Carol','AI Dave','AI Eve','AI Frank'];
    const opp = opponents[i % opponents.length];
    div.innerHTML = `
      <div class="history-result ${h.type}">${h.type === 'win' ? '🏆' : '💀'}</div>
      <div class="history-info">
        <div class="history-title">${h.type === 'win' ? 'Victory' : 'Defeat'} vs ${opp}</div>
        <div class="history-meta">${timeAgo(h.ts)} · Bet ${formatMoney(h.amount)}</div>
      </div>
      <div class="history-amount ${h.type}">${h.type === 'win' ? '+' : '-'}${formatMoney(h.amount * (h.type==='win'?2:1))}</div>`;
    list.appendChild(div);
  });
}

document.getElementById('historyFilter').addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('#historyFilter .tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderHistory();
});

// ─── LEADERBOARD ─────────────────────────────────────────────
function renderLeaderboard() {
  const lb = S.leaderboard.length ? S.leaderboard : buildSampleLeaderboard();
  S.leaderboard = lb;

  const podium = $('podium'); if (!podium) return;
  podium.innerHTML = '';
  const order = [1, 0, 2];
  const classes = ['second','first','third'];
  const medals = ['🥈','🥇','🥉'];
  order.forEach((i, pi) => {
    const p = lb[i];
    const card = make('div', `podium-card ${classes[pi]}`);
    const wr = Math.round(p.wins/(p.wins+p.losses)*100);
    card.innerHTML = `
      <div class="podium-rank">${medals[pi]}</div>
      <div class="podium-avatar" style="background:${p.color}">${p.initial}</div>
      <div class="podium-name">${p.name}</div>
      <div class="podium-stat">${p.wins}W · ${wr}% WR</div>
      <div class="podium-earn">${formatMoney(p.earnings)}</div>`;
    podium.appendChild(card);
  });

  const body = $('lbBody'); if (!body) return;
  body.innerHTML = '';
  lb.slice(0, 15).forEach((p, i) => {
    const isMe = i === 11;
    const row = make('div', `lb-row${isMe ? ' me' : ''}`);
    const wr = Math.round(p.wins/(p.wins+p.losses)*100);
    row.innerHTML = `
      <span class="lb-rank">#${i+1}</span>
      <span class="lb-player">
        <div class="lb-avatar" style="background:${p.color}">${p.initial}</div>
        ${p.name}${isMe ? ' <span style="color:var(--purple-light);font-size:10px">(You)</span>' : ''}
      </span>
      <span class="lb-wins">${p.wins}</span>
      <span class="lb-earn">${formatMoney(p.earnings)}</span>
      <span class="lb-wr">${wr}%</span>`;
    body.appendChild(row);
  });
}

$('lbTabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('#lbTabs .tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  S.leaderboard = [];
  renderLeaderboard();
});

// ─── MODAL CLOSE BUTTONS ─────────────────────────────────────
document.addEventListener('click', e => {
  const closeBtn = e.target.closest('.close-btn');
  if (closeBtn) hideOverlay(closeBtn.dataset.close);

  const overlay = e.target.closest('.overlay');
  if (overlay && overlay.id !== 'matchModal' && e.target === overlay) {
    hideOverlay(overlay.id);
  }
});

// ─── KEYBOARD ────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.overlay[aria-hidden="false"]').forEach(ov => {
      if (ov.id !== 'matchModal') hideOverlay(ov.id);
    });
  }
  if (e.key === 'r' || e.key === 'R') {
    if (S.game.started && !S.game.rolled && currentColor() === 'red') rollDice();
  }
});

// ─── DICE ANIMATION ON WELCOME ───────────────────────────────
const welcomeDice = $('welcomeDice');
if (welcomeDice) {
  welcomeDice.addEventListener('click', () => {
    const faces = ['🎲','🎰','🃏','🀄','🎴','🎯'];
    welcomeDice.classList.add('rolling');
    let t = 0;
    const iv = setInterval(() => {
      welcomeDice.textContent = faces[Math.floor(Math.random()*faces.length)];
      if (++t > 6) { clearInterval(iv); welcomeDice.textContent = '🎲'; welcomeDice.classList.remove('rolling'); }
    }, 80);
  });
}

// ─── ONLINE PLAYERS BAR ──────────────────────────────────────
// Ludo room rules: 1 host (required) + 0–3 invited = 1–4 players total
const ONLINE_PLAYERS_EXTENDED = [
  {
    name: 'Alice', wins: 12, losses: 3, draws: 2, betAmount: 10, balance: 250, color: '#7c6af7', status: 'idle',
    gameRoom: null
  },
  {
    name: 'Bob',   wins: 8,  losses: 5, draws: 1, betAmount: 50, balance: 180, color: '#f0b133', status: 'idle',
    gameRoom: null
  },
  {
    // 1 player total: host only (minimum valid room)
    name: 'Carol', wins: 20, losses: 4, draws: 4, betAmount: 100, balance: 420, color: '#36e89c', status: 'playing',
    gameRoom: {
      id: '#48291',
      players: [
        { name: 'Carol', wins: 20, losses: 4,  color: '#36e89c', role: 'host' }
      ]
    }
  },
  {
    name: 'Dave',  wins: 5,  losses: 8, draws: 2, betAmount: 250, balance: 110, color: '#ff4465', status: 'waiting',
    gameRoom: null
  },
  {
    name: 'Eva',   wins: 15, losses: 6, draws: 5, betAmount: 500, balance: 310, color: '#4e94ff', status: 'idle',
    gameRoom: null
  },
  {
    // 2 players total: 1 host + 1 invited
    name: 'Frank', wins: 3,  losses: 10, draws: 0, betAmount: 10, balance: 90, color: '#a89cf5', status: 'playing',
    gameRoom: {
      id: '#73104',
      players: [
        { name: 'Frank', wins: 3,  losses: 10, color: '#a89cf5', role: 'host'    },
        { name: 'Henry', wins: 9,  losses: 4,  color: '#30c0c0', role: 'invited' }
      ]
    }
  },
  {
    // 3 players total: 1 host + 2 invited
    name: 'Grace', wins: 22, losses: 7,  balance: 540, color: '#ff9040', status: 'playing',
    gameRoom: {
      id: '#91823',
      players: [
        { name: 'Grace', wins: 22, losses: 7,  color: '#ff9040', role: 'host'    },
        { name: 'Alice', wins: 12, losses: 3,  color: '#7c6af7', role: 'invited' },
        { name: 'Bob',   wins: 8,  losses: 5,  color: '#f0b133', role: 'invited' }
      ]
    }
  },
  {
    // 4 players total: 1 host + 3 invited (maximum)
    name: 'Henry', wins: 9,  losses: 4,  balance: 200, color: '#30c0c0', status: 'playing',
    gameRoom: {
      id: '#55017',
      players: [
        { name: 'Henry', wins: 9,  losses: 4,  color: '#30c0c0', role: 'host'    },
        { name: 'Carol', wins: 20, losses: 4,  color: '#36e89c', role: 'invited' },
        { name: 'Dave',  wins: 5,  losses: 8,  color: '#ff4465', role: 'invited' },
        { name: 'Eva',   wins: 15, losses: 6,  color: '#4e94ff', role: 'invited' }
      ]
    }
  }
];

ONLINE_PLAYERS_EXTENDED.forEach((p, i) => {
  const amounts = [10, 20, 30, 50, 100, 200];
  p.betAmount = amounts[i % amounts.length];
});

function buildExpandRow(p, colSpan) {
  const total       = p.wins + p.losses;
  const wr          = total > 0 ? Math.round((p.wins / total) * 100) : 0;
  const winPct      = total > 0 ? (p.wins  / total * 100).toFixed(1) : 0;
  const lossPct     = total > 0 ? (p.losses / total * 100).toFixed(1) : 0;
  const statusLabel = p.status === 'idle' ? 'Available' : p.status === 'playing' ? 'In Game' : 'Waiting';
  const canChallenge = p.status === 'idle';

  const roomPlayers = p.gameRoom ? p.gameRoom.players : [];
  const host        = roomPlayers.find(rp => rp.role === 'host') || { name: p.name, wins: p.wins, losses: p.losses, color: p.color, role: 'host' };
  const invited     = roomPlayers.filter(rp => rp.role === 'invited');
  const roomId      = p.gameRoom ? p.gameRoom.id : '——';
  const filledCount = roomPlayers.length || 1;

  function filledRow(rp, slotNum) {
    const t  = rp.wins + rp.losses;
    const w  = t > 0 ? Math.round((rp.wins / t) * 100) : 0;
    const wP = t > 0 ? (rp.wins   / t * 100).toFixed(0) : 0;
    const lP = t > 0 ? (rp.losses / t * 100).toFixed(0) : 0;
    const isHost = rp.role === 'host';
    return `<tr class="pt-row ${isHost ? 'pt-host' : 'pt-invited'}">
        <td class="pt-num">${slotNum}</td>
        <td class="pt-player-cell"><div class="pt-player">
          <div class="pt-avatar" style="background:${rp.color}">${rp.name[0]}</div>
          <span class="pt-name">${rp.name}</span>
        </div></td>
        <td class="pt-role-cell"><span class="pt-role-badge ${isHost ? 'host' : 'invited'}">${isHost ? '&#128081; Host' : '&#128279; Invited'}</span></td>
        <td class="pt-wins">${rp.wins}</td>
        <td class="pt-losses">${rp.losses}</td>
        <td class="pt-wr-cell"><div class="pt-wr-wrap">
          <div class="pt-wr-bar"><div class="pt-wr-win" style="width:${wP}%"></div><div class="pt-wr-loss" style="width:${lP}%"></div></div>
          <span class="pt-wr-pct">${w}%</span>
        </div></td>
      </tr>`;
  }

  function emptyRow(slotNum) {
    return `<tr class="pt-row pt-empty">
        <td class="pt-num">${slotNum}</td>
        <td class="pt-player-cell"><div class="pt-player">
          <div class="pt-avatar empty-av">+</div>
          <span class="pt-name" style="color:var(--text-3)">Open Slot</span>
        </div></td>
        <td class="pt-role-cell"><span class="pt-role-badge open">Open</span></td>
        <td colspan="3" style="color:var(--text-3);font-size:11px">Waiting for player...</td>
      </tr>`;
  }

  const rows =
    filledRow(host, 1) +
    (invited[0] ? filledRow(invited[0], 2) : emptyRow(2)) +
    (invited[1] ? filledRow(invited[1], 3) : emptyRow(3)) +
    (invited[2] ? filledRow(invited[2], 4) : emptyRow(4));

  const tr = make('tr', 'ot-expand-row');
  const td = make('td');
  td.colSpan = colSpan;
  td.innerHTML = `
    <div class="ot-expand-inner">
      <div class="ot-exp-right">
        <div class="ot-slots-header">
          <span class="ot-slots-title">🎮 Room ${roomId}</span>
          <span class="ot-slots-count">${filledCount} / 4 players</span>
        </div>
        <div class="pt-wrapper">
          <table class="players-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Role</th>
                <th>Wins</th>
                <th>Losses</th>
                <th>Win Rate</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  tr.appendChild(td);
  return tr;
}

async function renderOnlineBar() {
  const countBadge = $('opCount');
  const tbody = document.querySelector('#onlineTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!S.selectedAmount) {
    if (countBadge) countBadge.textContent = '0 Online';
    tbody.innerHTML = '<tr><td colspan="6" class="ludo-empty-prompt">Select a bet amount above to see available players.</td></tr>';
    return;
  }

  try {
    const response = await fetch(`${LUDO_API_URL}/api/player?bet=${encodeURIComponent(S.selectedAmount)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const current = String(S.player.name || '').trim().toLowerCase();
    const players = (Array.isArray(data) ? data : data?.data || [])
      .filter(player => ![1, '1', true, 'true'].includes(player.is_demo))
      .filter(player => ![1, '1', true, 'true'].includes(player.is_ai))
      .filter(player => String(player.name || '').trim().toLowerCase() !== current);

    if (countBadge) countBadge.textContent = `${players.length} Online`;
    if (!players.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="ludo-empty-prompt">No players available at ${S.selectedAmount} ETB yet. Waiting…</td></tr>`;
      return;
    }

    players.forEach(player => {
      const row = make('tr');
      const roomSize = 1;
      const color = player.color || '#d4a017';
      row.innerHTML = `
        <td><span class="ot-count-cell">${roomSize} / 4</span></td>
        <td><span class="ot-ingame-badge">3 open</span></td>
        <td><div class="ot-player"><div class="ot-avatar" style="background:${color}">${String(player.name || 'P').slice(0, 1).toUpperCase()}</div><div class="ot-player-info"><span class="ot-name">${player.name || 'Player'}</span></div></div></td>
        <td><span class="ot-stats-badges"><b>${Number(player.wins || 0)}W</b><b>${Number(player.draws || 0)}D</b><b>${Number(player.losses || 0)}L</b></span></td>
        <td><span class="ot-status idle"><span class="ot-status-dot"></span>Available</span></td>
        <td><button class="ot-challenge-btn" type="button">▶ Play</button></td>`;
      row.querySelector('.ot-challenge-btn').addEventListener('click', () => {
        S.selectedOpponent = player;
        goToGame(player.name);
      });
      tbody.appendChild(row);
    });
  } catch (error) {
    console.error('[Ludo] Failed to load real players', error);
    if (countBadge) countBadge.textContent = '0 Online';
    tbody.innerHTML = '<tr><td colspan="6" class="ludo-empty-prompt">Unable to load players. Please try again.</td></tr>';
  }
}

// ─── GAME ROOM / LOBBY ───────────────────────────────────────
const SLOT_COLORS    = ['red', 'blue', 'green', 'yellow'];
const SLOT_COLOR_HEX = { red: '#ff4465', blue: '#4e94ff', green: '#36e89c', yellow: '#ffd93d' };
const MAX_PLAYERS    = 4;
const MIN_PLAYERS    = 1;

const room = {
  active:  false,
  id:      null,
  players: []
};

function rpRenderSlots() {
  const container = $('rpSlots');
  if (!container) return;
  container.innerHTML = '';

  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p     = room.players[i];
    const color = SLOT_COLORS[i];
    const div   = make('div', p ? (p.isYou ? 'rp-slot you filled' : 'rp-slot filled') : 'rp-slot empty');

    if (p) {
      div.innerHTML = `
        <div class="rp-slot-avatar" style="background:${SLOT_COLOR_HEX[color]}">${p.name[0]}</div>
        <div class="rp-slot-info">
          <span class="rp-slot-name">${p.name}</span>
          <span class="rp-slot-wl">${p.wins}W / ${p.losses}L</span>
        </div>
        ${p.isYou ? '<span class="rp-slot-you-badge">YOU</span>' : ''}
        <span class="rp-slot-color ${color}">${color}</span>
      `;
    } else {
      div.innerHTML = `
        <div class="rp-slot-avatar">+</div>
        <div class="rp-slot-info">
          <span class="rp-slot-name" style="color:var(--text-3)">Waiting…</span>
          <span class="rp-slot-wl">Empty slot</span>
        </div>
        <span class="rp-slot-color empty">${color}</span>
      `;
    }
    container.appendChild(div);
  }

  const startBtn = $('rpStartRoomBtn');
  if (startBtn) startBtn.disabled = room.players.length < MIN_PLAYERS;
}

function rpShowLobby() {
  const actions = $('rpRoomActions');
  const lobby   = $('rpLobby');
  const badge   = $('rpRoomBadge');
  if (actions) actions.style.display = 'none';
  if (lobby)   lobby.style.display   = 'flex';
  if (badge) { badge.textContent = 'Active'; badge.classList.add('active'); }
  rpRenderSlots();
}

function rpHideLobby() {
  const actions = $('rpRoomActions');
  const lobby   = $('rpLobby');
  const badge   = $('rpRoomBadge');
  if (actions) actions.style.display = 'flex';
  if (lobby)   lobby.style.display   = 'none';
  if (badge) { badge.textContent = 'No Room'; badge.classList.remove('active'); }
  room.active  = false;
  room.id      = null;
  room.players = [];
}

$('rpCreateRoomBtn')?.addEventListener('click', () => {
  if (room.active) return;
  room.id      = Math.floor(10000 + Math.random() * 89999).toString();
  room.active  = true;
  room.players = [{ name: S.player.name, wins: S.player.wins, losses: S.player.losses, isYou: true }];
  const lobbyId = $('rpLobbyId');
  if (lobbyId) lobbyId.textContent = '#' + room.id;
  rpShowLobby();
  toast('Room #' + room.id + ' created!', 'success');

  const fakes = [
    { name: 'Alice', wins: 12, losses: 3 },
    { name: 'Bob',   wins: 8,  losses: 5 },
    { name: 'Carol', wins: 20, losses: 4 }
  ];
  fakes.forEach((fp, i) => {
    setTimeout(() => {
      if (!room.active || room.players.length >= MAX_PLAYERS) return;
      room.players.push({ ...fp, isYou: false });
      rpRenderSlots();
      toast(fp.name + ' joined the room!', 'info');
    }, (i + 1) * 2200);
  });
});

$('rpJoinRoomBtn')?.addEventListener('click', () => {
  $('joinRoomInput').value = '';
  showOverlay('joinRoomModal');
});

$('confirmJoinRoomBtn')?.addEventListener('click', () => {
  const code = $('joinRoomInput').value.trim();
  if (!code || code.length < 4) { toast('Enter a valid Room ID', 'error'); return; }
  hideOverlay('joinRoomModal');
  room.id      = code;
  room.active  = true;
  room.players = [
    { name: 'Grace', wins: 22, losses: 7,  isYou: false },
    { name: S.player.name, wins: S.player.wins, losses: S.player.losses, isYou: true }
  ];
  const lobbyId = $('rpLobbyId');
  if (lobbyId) lobbyId.textContent = '#' + room.id;
  rpShowLobby();
  toast('Joined room #' + code + '!', 'success');
});

$('rpCopyInviteBtn')?.addEventListener('click', () => {
  const id = room.id || '——';
  navigator.clipboard.writeText('Join my Ludo room! ID: ' + id)
    .then(() => toast('Invite copied to clipboard!', 'success'))
    .catch(() => toast('Room ID: ' + id, 'info'));
});

$('rpLeaveRoomBtn')?.addEventListener('click', () => {
  rpHideLobby();
  toast('You left the room.', 'info');
});

$('rpStartRoomBtn')?.addEventListener('click', () => {
  if (room.players.length < MIN_PLAYERS) return;
  if (S.selectedAmount === 0) { toast('Select a bet amount first!', 'error'); return; }
  rpHideLobby();
  goToGame(room.players.length > 1 ? room.players[1].name : 'AI');
  toast('Game started with ' + room.players.length + ' player(s)!', 'success');
});

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => hideOverlay(btn.dataset.close));
});

// ─── INIT ────────────────────────────────────────────────────
(function init() {
  if (document.getElementById('ludoBoard')) {
    buildBoard();
    renderPieces();
    renderGamePlayers();
    updateGameUI();
  }
  renderDashboard();
  renderOnlineBar();
  syncBalance();

  setInterval(() => {
    if (S.currentSection === 'dashboard') {
      const el = $('welcomeDice');
      if (el) {
        const faces = ['🎲', '🎯', '🏆'];
        el.textContent = faces[Math.floor(Math.random() * faces.length)];
        setTimeout(() => { if (el) el.textContent = '🎲'; }, 400);
      }
    }
  }, 4000);
})();
