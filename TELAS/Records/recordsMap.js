export const RECORD_GAMES = {
  // Sem segmentação
  thinkfast: {
    key: 'thinkfast',
    title: 'ThinkFast',
    table: 'thinkfast_leaderboard',          // globais (apenas melhor)
    select: 'user_id,user_name,total_count,percent,avg_ms,best_single_ms,pos,created_at',
    // NOVO: configuração específica para "Meus"
    personalTable: 'thinkfast_results',      // histórico bruto
    personalSelect: 'user_id,user_name,total_count,percent,avg_ms,best_single_ms,created_at',
    personalOrders: [
      { col: 'percent', asc: false },
      { col: 'avg_ms', asc: true },
      { col: 'best_single_ms', asc: true },
      { col: 'total_count', asc: false },
      { col: 'created_at', asc: false },
    ],
    orders: [
      { col: 'total_count', asc: false },
      { col: 'percent', asc: false },
      { col: 'avg_ms', asc: true },
      { col: 'best_single_ms', asc: true },
    ],
    globalLimit: 10,
    personalLimit: 3,
    metric: (r) =>
      `bolas ${r.total_count ?? '—'} • ${r.percent ?? '—'}% • média ${r.avg_ms ?? '—'} ms • melhor ${r.best_single_ms ?? '—'} ms`,
    localKey: 'thinkfast:last',
  },

  // Com segmentação (Fácil/Difícil)
  thinkfast90: {
    key: 'thinkfast90',
    title: 'ThinkFast 90s',
    table: 'thinkfast90_results',
    select: 'user_name,difficulty,avg_ms,best_single_ms,best_streak_count,best_streak_time_ms,percent,hits,created_at',
    orders: [
      { col: 'percent', asc: false },
      { col: 'avg_ms', asc: true },
      { col: 'best_single_ms', asc: true },
    ],
    globalLimit: 10,
    personalLimit: 3, // <--- se quiser 1 por segmento
    metric: (r) => {
      const diff = r.difficulty === 'hard' ? 'Difícil' : 'Fácil';
      const streak =
        r.best_streak_count != null
          ? ` • streak ${r.best_streak_count}x${r.best_streak_time_ms != null ? `/${r.best_streak_time_ms}ms` : ''}`
          : '';
      return `${diff} • ${r.percent ?? '—'}% • média ${r.avg_ms ?? '—'} ms • melhor ${r.best_single_ms ?? '—'} ms${streak}`;
    },
    localKey: 'thinkfast90:last',
    segmentField: 'difficulty',
    segments: [
      { value: 'normal', label: 'Fácil' },
      { value: 'hard', label: 'Difícil' },
    ],
  },

  // Com segmentação (Fácil/Médio/Difícil)
  sequences: {
    key: 'sequences',
    title: 'Sequências de Números',
    table: 'sequences_results_best', // globais: somente melhor por nível
    select: 'user_id,user_name,level,percent,time_total_s,avg_time_s,score,total_answered,created_at',
    // PESSOAIS: usar histórico bruto
    personalTable: 'sequences_results',
    personalSelect: 'user_id,user_name,level,percent,time_total_s,avg_time_s,score,total_answered,created_at',
    personalOrders: [
      { col: 'percent', asc: false },
      { col: 'time_total_s', asc: true },
      { col: 'avg_time_s', asc: true },
      { col: 'created_at', asc: true },
    ],
    orders: [
      { col: 'percent', asc: false },
      { col: 'time_total_s', asc: true },
      { col: 'avg_time_s', asc: true },
      { col: 'created_at', asc: true },
    ],
    globalLimit: 10,
    personalLimit: 3,
    metric: (r) => {
      const lv = r.level === 'medio' ? 'Médio' : r.level === 'dificil' ? 'Difícil' : 'Fácil';
      const avg = r.avg_time_s != null ? `${Number(r.avg_time_s).toFixed(1)}s` : '—';
      return `${lv} • ${r.percent ?? '—'}% • ${r.time_total_s ?? '—'}s (${avg}/questão)`;
    },
    localKey: 'sequences:last',
    segmentField: 'level',
    segments: [
      { value: 'facil', label: 'Fácil' },
      { value: 'medio', label: 'Médio' },
      { value: 'dificil', label: 'Difícil' },
    ],
  },

  // Com segmentação (Fácil/Médio/Difícil)
  procurarSimbolos: {
    key: 'procurarSimbolos',
    title: 'Procurar Símbolos',
    table: 'procurar_simbolos_results_best', // globais: apenas melhor por nível
    select: 'user_id,user_name,level,percent,time_total_s,avg_time_s,score,total_answered,created_at',
    // PESSOAIS: usar histórico bruto para listar até 3 melhores
    personalTable: 'procurar_simbolos_results',
    personalSelect: 'user_id,user_name,level,percent,time_total_s,avg_time_s,score,total_answered,created_at',
    personalOrders: [
      { col: 'percent', asc: false },
      { col: 'time_total_s', asc: true },
      { col: 'avg_time_s', asc: true },
      { col: 'created_at', asc: true },
    ],
    orders: [
      { col: 'percent', asc: false },
      { col: 'time_total_s', asc: true },
      { col: 'avg_time_s', asc: true },
      { col: 'created_at', asc: true },
    ],
    globalLimit: 10,
    personalLimit: 3,
    metric: (r) => {
      const lv = r.level === 'medio' ? 'Médio' : r.level === 'dificil' ? 'Difícil' : 'Fácil';
      const avg = r.avg_time_s != null ? `${Number(r.avg_time_s).toFixed(1)}s` : '—';
      return `${lv} • ${r.percent ?? '—'}% • ${r.time_total_s ?? '—'}s (${avg}/item)`;
    },
    localKey: 'procurar:last',
    segmentField: 'level',
    segments: [
      { value: 'facil', label: 'Fácil' },
      { value: 'medio', label: 'Médio' },
      { value: 'dificil', label: 'Difícil' },
    ],
  },

  // Sem segmentação
  matrices: {
    key: 'matrices',
    title: 'Matrizes',
    table: 'matrices_leaderboard',            // globais: melhor por usuário
    select: 'pos,user_id,user_name,score,time_ms,created_at',
    orders: [{ col: 'pos', asc: true }],
    // PESSOAIS: histórico bruto
    personalTable: 'matrices_results',
    personalSelect: 'user_id,user_name,score,time_ms,created_at',
    personalOrders: [
      { col: 'score', asc: false },
      { col: 'time_ms', asc: true },
      { col: 'created_at', asc: false },
    ],
    globalLimit: 10,
    personalLimit: 3,
    metric: (r) => `score ${r.score ?? '—'} • ${r.time_ms ?? '—'} ms`,
    localKey: 'matrices:last',
  },

  // Sem segmentação
  adivinhe: {
    key: 'adivinhe',
    title: 'Personalidades • Adivinhe',
    table: 'personalities_adivinhe_leaderboard',
    select: 'pos,user_id,user_name,score,percent,time_ms,created_at',
    orders: [{ col: 'pos', asc: true }],
    globalLimit: 10,
    personalLimit: 3,
    metric: (r) => `pontos ${r.score ?? '—'} • ${r.percent ?? '—'}%`,
    localKey: 'adivinhe:last',
  },
  
  // Sem segmentação
  iq: {
    key: 'iq',
    title: 'Personalidades • IQ',
    table: 'personalities_iq_leaderboard',
    select: 'pos,user_id,user_name,percent,score,time_ms,created_at',
    orders: [{ col: 'pos', asc: true }],
    globalLimit: 10,
    personalLimit: 3,
    metric: (r) => `${r.percent ?? '—'}% • ${r.time_ms ?? '—'} ms`,
    localKey: 'iq:last',
  },

  // Sem segmentação
  connections: {
    key: 'connections',
    title: 'Personalidades • Conexões',
    table: 'personalities_connections_leaderboard',
    select: 'pos,user_id,user_name,percent,score,time_ms,created_at',
    orders: [{ col: 'pos', asc: true }],
    globalLimit: 10,
    personalLimit: 3,
    metric: (r) => `${r.percent ?? '—'}% • ${r.time_ms ?? '—'} ms`,
    localKey: 'connections:last',
  },
}