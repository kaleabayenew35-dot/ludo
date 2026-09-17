// Helper used by index.html to navigate to game.html
function goToGame(opponentName) {
  if ((opponentName || 'AI') === 'AI' && window.__LUDO_AI_ENABLED__ !== true) return;
  const auth = JSON.parse(sessionStorage.getItem('appAuth') || '{}');
  const state = {
    name:           S.player.name,
    balance:        S.player.balance,
    wins:           S.player.wins,
    losses:         S.player.losses,
    totalWon:       S.player.totalWon,
    totalLost:      S.player.totalLost,
    selectedAmount: S.selectedAmount || 10,
    opponent:       { name: opponentName || 'AI' },
    autoStart:      true
  };
  sessionStorage.setItem('ludoGameState', JSON.stringify(state));
  const params = new URLSearchParams();
  if (auth.token) params.set('token', auth.token);
  if (auth.launch) params.set('launch', auth.launch);
  window.location.href = `game.html${params.toString() ? '?' + params.toString() : ''}`;
}
