import type { Store } from "./store";

/**
 * Games in progress, streamed to `live_games` so the site can show them (#144).
 *
 * Every write is fire-and-forget: the match never awaits the store while a game is being played,
 * so a slow or failing store cannot touch the engines' clocks or the result. Plies are batched:
 * each game has at most one write in flight and at most one write per `intervalMs`; moves played
 * meanwhile go out with the next one. When the game ends its row is deleted, after the game's
 * last upsert, so a late upsert cannot bring it back. Failures are logged once per stream and
 * otherwise ignored: a row that is left behind goes stale (`LIVE_GAME_STALE_MS`) and readers skip it.
 */
export const LIVE_TABLE = "live_games";

export type LiveGameInfo = {
  run_id: string;
  match_id: string;
  track_id: string;
  candidate_version: string;
  opponent: string;
};

export type LiveGame = {
  /** A move was played: `ply` counts every ply on the board, the opening included. */
  move: (move: string, ply: number) => void;
  /** The game is over (or voided): delete its row once the pending write settles. */
  end: () => void;
};

export type LiveStream = {
  /** A game starts from `opening`. `id` is the live row's primary key. */
  start: (id: string, engineFirst: boolean, opening: string[]) => LiveGame;
  /** Wait (at most `timeoutMs`) for every pending write and delete. Never throws. */
  flush: (timeoutMs?: number) => Promise<void>;
};

type Options = {
  intervalMs?: number;
  log?: (line: string) => void;
  now?: () => number;
};

export const liveStream = (
  store: Store,
  info: LiveGameInfo,
  { intervalMs = 1000, log = () => {}, now = Date.now }: Options = {},
): LiveStream => {
  const pending = new Set<Promise<void>>();
  let failed = false;
  /** Run a store call without letting it throw or reject into the match. */
  const safe = (what: string, call: () => Promise<unknown>): Promise<void> => {
    let p: Promise<void>;
    try {
      p = call().then(
        () => undefined,
        (e) => report(what, e),
      );
    } catch (e) {
      p = Promise.resolve(report(what, e));
    }
    pending.add(p);
    void p.finally(() => pending.delete(p));
    return p;
  };
  const report = (what: string, e: unknown) => {
    if (failed) return;
    failed = true;
    log(
      `  live games: ${what} failed (${e instanceof Error ? e.message : String(e)}); the match carries on without streaming`,
    );
  };

  const start = (id: string, engineFirst: boolean, opening: string[]) => {
    const moves = [...opening];
    const startedAt = new Date(now()).toISOString();
    let ply = moves.length;
    let inflight: Promise<void> | null = null;
    let dirty = false;
    let lastWrite = -Infinity;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ended = false;

    const pump = () => {
      if (ended) return;
      if (inflight) {
        dirty = true;
        return;
      }
      const wait = lastWrite + intervalMs - now();
      if (wait > 0) {
        timer ??= setTimeout(() => {
          timer = undefined;
          pump();
        }, wait);
        return;
      }
      dirty = false;
      lastWrite = now();
      const row = {
        id,
        ...info,
        engine_first: engineFirst,
        moves: [...moves],
        ply,
        started_at: startedAt,
        updated_at: new Date(lastWrite).toISOString(),
      };
      inflight = safe(`upsert ${id}`, () => store.upsert(LIVE_TABLE, row)).then(
        () => {
          inflight = null;
          if (dirty) pump();
        },
      );
    };

    pump();
    return {
      move: (m: string, p: number) => {
        if (ended) return;
        moves.push(m);
        ply = p;
        pump();
      },
      end: () => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        const after = inflight ?? Promise.resolve();
        // Tracked in `pending` straight away, so a flush right after `end` waits for the delete.
        const done = after.then(() =>
          safe(`delete ${id}`, () => store.remove(LIVE_TABLE, { id })),
        );
        pending.add(done);
        void done.finally(() => pending.delete(done));
      },
    };
  };

  const flush = async (timeoutMs = 5000) => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<void>((ok) => (t = setTimeout(ok, timeoutMs)));
    // A delete is queued behind its game's last upsert, so loop until nothing new appears.
    const drain = async () => {
      while (pending.size) await Promise.all([...pending]);
    };
    await Promise.race([drain(), limit]);
    clearTimeout(t);
  };

  return { start, flush };
};
