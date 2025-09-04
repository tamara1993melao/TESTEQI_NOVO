let _lock = false;

async function checarPermissao(_gameId) {
  return { permitido: true };
}

export async function iniciarComGating(gameId, executor) {
  if (typeof gameId === 'function' && !executor) {
    executor = gameId;
    gameId = 'generic';
  }
  if (typeof executor !== 'function') return;
  if (_lock) return;
  _lock = true;
  try {
    const { permitido } = await checarPermissao(gameId);
    if (!permitido) return;
    return await executor();
  } finally {
    _lock = false;
  }
}