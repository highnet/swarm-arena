import { Chess } from 'chess.js';
import type { GameId, GameRow, Match, Snapshot } from '@arena/shared';
import { SHORT_NAME } from './tracks';

export const EXPORT_FORMATS = ['json', 'csv', 'pgn', 'sgf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Formats that only make sense for one game. */
export const FORMAT_GAME: Partial<Record<ExportFormat, GameId>> = { pgn: 'chess', sgf: 'go9' };

export const FORMAT_LABEL: Record<ExportFormat, string> = {
  json: 'JSON',
  csv: 'CSV',
  pgn: 'PGN (chess)',
  sgf: 'SGF (Go)',
};

export const FORMAT_MIME: Record<ExportFormat, string> = {
  json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  pgn: 'application/x-chess-pgn; charset=utf-8',
  sgf: 'application/x-go-sgf; charset=utf-8',
};

type Labelled = {
  game: GameRow;
  match: Match | undefined;
  engine: string;
  first: string;
  second: string;
};

const label = (s: Snapshot, g: GameRow): Labelled => {
  const match = s.matches.find((m) => m.id === g.match_id);
  const engine = `${SHORT_NAME[g.track_id]} ${match?.engine_version ?? ''}`.trim();
  const opponent = match?.opponent ?? 'Opponent';
  return {
    game: g,
    match,
    engine,
    first: g.engine_first ? engine : opponent,
    second: g.engine_first ? opponent : engine,
  };
};

const resultTag = (outcome: number) => (outcome === 1 ? '1-0' : outcome === 0 ? '0-1' : '1/2-1/2');

const csvCell = (v: string | number | boolean) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const toJson = (s: Snapshot, games: GameRow[]) =>
  JSON.stringify(
    games.map((g) => {
      const l = label(s, g);
      return {
        id: g.id,
        engine: g.track_id,
        match_id: g.match_id,
        engine_version: l.match?.engine_version ?? null,
        opponent: l.match?.opponent ?? null,
        first_player: l.first,
        second_player: l.second,
        engine_first: g.engine_first,
        outcome: g.outcome,
        result: resultTag(g.outcome),
        termination: g.termination,
        ply_count: g.ply_count,
        finished_at: g.finished_at,
        moves: g.moves,
      };
    }),
    null,
    2,
  );

const toCsv = (s: Snapshot, games: GameRow[]) => {
  const head = [
    'id',
    'engine',
    'match_id',
    'engine_version',
    'opponent',
    'first_player',
    'second_player',
    'result',
    'termination',
    'ply_count',
    'finished_at',
    'moves',
  ];
  const rows = games.map((g) => {
    const l = label(s, g);
    return [
      g.id,
      g.track_id,
      g.match_id,
      l.match?.engine_version ?? '',
      l.match?.opponent ?? '',
      l.first,
      l.second,
      resultTag(g.outcome),
      g.termination,
      g.ply_count,
      g.finished_at,
      g.moves.join(' '),
    ]
      .map(csvCell)
      .join(',');
  });
  return [head.join(','), ...rows].join('\n') + '\n';
};

const pgnDate = (iso: string) => iso.slice(0, 10).replace(/-/g, '.');

/** Chess moves are stored as UCI; PGN wants SAN, so replay them. */
const toPgn = (s: Snapshot, games: GameRow[]) =>
  games
    .filter((g) => g.track_id === 'chess')
    .map((g) => {
      const l = label(s, g);
      const board = new Chess();
      const sans: string[] = [];
      let note = '';
      for (const uci of g.moves) {
        try {
          const m = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
          sans.push(m.san);
        } catch {
          note = ` {illegal move ${uci}}`;
          break;
        }
      }
      const body = sans.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san)).join(' ');
      const tags = [
        ['Event', 'Swarm Arena'],
        ['Site', `match ${g.match_id}`],
        ['Date', pgnDate(g.finished_at)],
        ['White', l.first],
        ['Black', l.second],
        ['Result', resultTag(g.outcome)],
        ['Termination', g.termination],
        ['PlyCount', String(g.ply_count)],
      ];
      return `${tags.map(([k, v]) => `[${k} "${v.replace(/"/g, "'")}"]`).join('\n')}\n\n${body}${note} ${resultTag(g.outcome)}\n`;
    })
    .join('\n');

/** GTP columns skip "i"; SGF counts rows from the top. */
const GTP_COLS = 'abcdefghj';
const sgfPoint = (gtp: string, size: number) => {
  const col = GTP_COLS.indexOf(gtp[0]?.toLowerCase());
  const row = Number(gtp.slice(1));
  if (col < 0 || !row) return '';
  return `${String.fromCharCode(97 + col)}${String.fromCharCode(97 + size - row)}`;
};

const toSgf = (s: Snapshot, games: GameRow[]) =>
  games
    .filter((g) => g.track_id === 'go9')
    .map((g) => {
      const l = label(s, g);
      const result = g.outcome === 1 ? 'B+' : g.outcome === 0 ? 'W+' : '0';
      const moves = g.moves
        .map((m, i) => `;${i % 2 === 0 ? 'B' : 'W'}[${sgfPoint(m, 9)}]`)
        .join('');
      return `(;GM[1]FF[4]SZ[9]EV[Swarm Arena]GN[${g.id}]DT[${g.finished_at.slice(0, 10)}]PB[${l.first}]PW[${l.second}]RE[${result}]${moves})\n`;
    })
    .join('');

export const exportGames = (format: ExportFormat, s: Snapshot, games: GameRow[]) =>
  ({ json: toJson, csv: toCsv, pgn: toPgn, sgf: toSgf })[format](s, games);
