import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type Filter = Record<string, unknown>;

type Result = {
  data: unknown;
  error: { message: string; code?: string } | null;
  status?: number;
};

/**
 * A transient network failure ("fetch failed", a reset, a gateway 5xx): no database error code.
 * Constraint and permission errors carry a code (23505, 42501, PGRST…) and are never retried.
 */
export const transient = (r: Result) =>
  !!r.error && !r.error.code && (!r.status || r.status >= 500);

/** Run a write up to `attempts` times, backing off 0.5 s, 1 s, … while it fails transiently. */
export const withRetry = async <R extends Result>(
  write: () => PromiseLike<R>,
  attempts = 3,
  baseMs = 500,
): Promise<R> => {
  for (let i = 1; ; i++) {
    const r = await write();
    if (i >= attempts || !transient(r)) return r;
    await new Promise((ok) => setTimeout(ok, baseMs * 2 ** (i - 1)));
  }
};

/**
 * Minimal table store. Supabase in production (service role key, bypasses RLS);
 * a JSON file for dry runs (`ARENA_STORE=file`), so the harness can be exercised offline.
 */
export type Store = {
  kind: "supabase" | "file";
  select: <T = Row>(table: string, filter?: Filter) => Promise<T[]>;
  insert: <T = Row>(table: string, row: Row) => Promise<T>;
  update: (table: string, filter: Filter, patch: Row) => Promise<number>;
  /** Atomic compare-and-set: update rows matching filter, returning how many changed. */
  claim: (table: string, filter: Filter, patch: Row) => Promise<number>;
};

const secretKey = () =>
  process.env.SUPABASE_SECRET_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "sb_secret_injected_by_proxy";

const supabaseStore = (): Store => {
  // The secret key travels only in the apikey header. In cloud sessions the network proxy
  // injects the real key there, so SUPABASE_SECRET_KEY can be any placeholder.
  const apiKeyOnly: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete("Authorization");
    // The database rejects any API write without the arena password (see the arena_password migration).
    if (process.env.ARENA_PASSWORD)
      headers.set("x-arena-password", process.env.ARENA_PASSWORD);
    return fetch(input, { ...init, headers });
  };
  const db: SupabaseClient = createClient(
    process.env.SUPABASE_URL!,
    secretKey(),
    {
      auth: { persistSession: false },
      global: { fetch: apiKeyOnly },
    },
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apply = (q: any, f: Filter): any =>
    Object.entries(f).reduce((acc, [k, v]) => acc.eq(k, v), q);
  const check = <T>(
    r: { data: T; error: { message: string } | null },
    what: string,
  ) => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return r.data;
  };
  return {
    kind: "supabase",
    select: async (table, filter = {}) =>
      check(
        await apply(db.from(table).select("*"), filter).limit(10000),
        `select ${table}`,
      ) as never,
    insert: async (table, row) =>
      check(
        await withRetry(() => db.from(table).insert(row).select().single()),
        `insert ${table}`,
      ) as never,
    update: async (table, filter, patch) =>
      (
        check(
          await withRetry(() =>
            apply(db.from(table).update(patch), filter).select("*"),
          ),
          `update ${table}`,
        ) as Row[]
      ).length,
    claim: async (table, filter, patch) =>
      (
        check(
          await apply(db.from(table).update(patch), filter).select("*"),
          `claim ${table}`,
        ) as Row[]
      ).length,
  };
};

const fileStore = (path: string): Store => {
  const load = (): Record<string, Row[]> =>
    existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const save = (d: Record<string, Row[]>) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(d, null, 1));
  };
  const matches = (r: Row, f: Filter) =>
    Object.entries(f).every(([k, v]) => r[k] === v);
  const update = async (table: string, filter: Filter, patch: Row) => {
    const d = load();
    let n = 0;
    for (const r of d[table] ?? []) {
      if (matches(r, filter)) {
        Object.assign(r, patch);
        n++;
      }
    }
    save(d);
    return n;
  };
  return {
    kind: "file",
    select: async (table, filter = {}) =>
      (load()[table] ?? []).filter((r) => matches(r, filter)) as never,
    insert: async (table, row) => {
      const d = load();
      const rows = (d[table] ??= []);
      const full = { ...row } as Row;
      if (
        table === "records" ||
        table === "elo_points" ||
        table === "messages"
      ) {
        full.id =
          (rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) as number) +
          1;
      }
      full.at ??= new Date().toISOString();
      rows.push(full);
      save(d);
      return full as never;
    },
    update,
    claim: update,
  };
};

let store: Store | undefined;

export const getStore = (): Store => {
  if (store) return store;
  if (process.env.ARENA_STORE !== "file" && process.env.SUPABASE_URL) {
    store = supabaseStore();
  } else {
    store = fileStore(
      resolve(process.env.ARENA_HOME ?? ".arena", "store.json"),
    );
  }
  return store;
};
