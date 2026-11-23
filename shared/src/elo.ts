/** Expected score of a player rated `a` against one rated `b`. */
export const expectedScore = (a: number, b: number) => 1 / (1 + 10 ** ((b - a) / 400));

export type MatchLine = {
  opponentElo: number;
  /** Points scored (wins + draws / 2). */
  score: number;
  games: number;
};

export type EloEstimate = {
  elo: number;
  /** Approximate 95% half-width. */
  error: number;
  games: number;
  score: number;
};

/**
 * Maximum-likelihood performance rating against opponents of known Elo.
 * Perfect or zero scores are pulled in by half a point so the estimate stays finite.
 */
export const performanceElo = (lines: MatchLine[]): EloEstimate => {
  const games = lines.reduce((n, l) => n + l.games, 0);
  const rawScore = lines.reduce((n, l) => n + l.score, 0);
  if (games === 0) return { elo: 0, error: Infinity, games: 0, score: 0 };
  const score = Math.min(Math.max(rawScore, 0.5), games - 0.5);

  let elo = lines.reduce((n, l) => n + l.opponentElo * l.games, 0) / games;
  for (let iter = 0; iter < 100; iter++) {
    let expected = 0;
    let slope = 0;
    for (const l of lines) {
      const e = expectedScore(elo, l.opponentElo);
      expected += e * l.games;
      slope += l.games * e * (1 - e) * (Math.LN10 / 400);
    }
    const step = (score - expected) / Math.max(slope, 1e-9);
    elo += Math.max(Math.min(step, 400), -400);
    if (Math.abs(step) < 0.01) break;
  }

  let info = 0;
  for (const l of lines) {
    const e = expectedScore(elo, l.opponentElo);
    info += l.games * e * (1 - e) * (Math.LN10 / 400) ** 2;
  }
  return { elo, error: 1.96 / Math.sqrt(Math.max(info, 1e-12)), games, score: rawScore };
};
