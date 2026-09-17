// Helper used by index.html to navigate to game.html
function goToGame(opponentName) {
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
  window.location.href = 'game.html';
}
