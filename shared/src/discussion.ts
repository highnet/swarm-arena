import type { Message, MessageRef } from "./model";

/**
 * The discussion board's shared grammar, used by the harness (posting, reading) and the site
 * (rendering, backlinks), so both agree on what a reference is.
 *
 *   msg#42 or thread#42      another message on the board
 *   pr#12 or "PR #12"        a pull request
 *   issue#12                 an issue
 *   #12                      an issue or pull request (GitHub numbers them in one sequence)
 *   …/swarm-arena/pull/12    a full GitHub URL to this repository's issue or pull request
 */
const REF_RE =
  /(?<![\w#&])(?:(msg|thread|pr|issue)\s?#(\d{1,7})|#(\d{1,7})|https:\/\/github\.com\/highnet\/swarm-arena\/(pull|issues)\/(\d{1,7}))(?!\w)/gi;

const toRef = (m: RegExpExecArray): MessageRef => {
  if (m[1]) {
    const word = m[1].toLowerCase();
    return {
      kind: word === "pr" ? "pr" : word === "issue" ? "issue" : "message",
      n: Number(m[2]),
    };
  }
  if (m[3]) return { kind: "github", n: Number(m[3]) };
  return {
    kind: m[4].toLowerCase() === "pull" ? "pr" : "issue",
    n: Number(m[5]),
  };
};

const refKey = (r: MessageRef) => `${r.kind === "message" ? "m" : "g"}${r.n}`;

/** Every distinct reference in a text, in order of first appearance. */
export const parseRefs = (text: string): MessageRef[] => {
  const out = new Map<string, MessageRef>();
  for (const m of text.matchAll(REF_RE)) {
    const r = toRef(m);
    const key = refKey(r);
    const seen = out.get(key);
    // A specific kind (pr, issue) beats the ambiguous bare #12.
    if (!seen || seen.kind === "github") out.set(key, r);
  }
  return [...out.values()];
};

/** Parse one reference written on its own, e.g. a `--ref pr#12` flag. A bare number is a thread. */
export const parseRef = (token: string): MessageRef | null => {
  const t = token.trim();
  if (/^\d+$/.test(t)) return { kind: "message", n: Number(t) };
  return parseRefs(t)[0] ?? null;
};

/** A message's references: stored ones, or parsed from its text for rows older than the column. */
export const refsOf = (
  m: Pick<Message, "refs" | "title" | "body">,
): MessageRef[] =>
  m.refs?.length ? m.refs : parseRefs(`${m.title ?? ""}\n${m.body}`);

/** Merge reference lists, dropping duplicates (same target), specific kinds winning. */
export const mergeRefs = (...lists: MessageRef[][]): MessageRef[] => {
  const out = new Map<string, MessageRef>();
  for (const r of lists.flat()) {
    const seen = out.get(refKey(r));
    if (!seen || seen.kind === "github") out.set(refKey(r), r);
  }
  return [...out.values()];
};

export const formatRef = (r: MessageRef) =>
  r.kind === "message"
    ? `msg#${r.n}`
    : r.kind === "github"
      ? `#${r.n}`
      : `${r.kind}#${r.n}`;

export type TextSegment = { text: string } | { text: string; ref: MessageRef };

/** Split a body into plain text and references, for linkifying. */
export const segmentText = (text: string): TextSegment[] => {
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(REF_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    out.push({ text: m[0], ref: toRef(m) });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
};

export const MAX_TAGS = 8;

/** Tags are short lowercase slugs: "search", "time-management", "chess/eval". */
export const normalizeTags = (raw: string[] | string | undefined): string[] => {
  const list = (Array.isArray(raw) ? raw : (raw ?? "").split(","))
    .map((t) =>
      t
        .trim()
        .toLowerCase()
        .replace(/^#/, "")
        .replace(/[^a-z0-9/_-]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .filter((t) => t.length > 0 && t.length <= 32);
  const tags = [...new Set(list)];
  if (tags.length > MAX_TAGS) throw new Error(`at most ${MAX_TAGS} tags`);
  return tags;
};

/** A thread's display title: its own, or the first line of its body. */
export const threadTitle = (m: Pick<Message, "title" | "body">, max = 90) => {
  if (m.title) return m.title;
  const first = m.body.split("\n")[0].trim();
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
};

/** The top-level message a message belongs to (itself for a thread). */
export const rootOf = (id: number, byId: Map<number, Message>): number => {
  let cur = byId.get(id);
  const seen = new Set<number>();
  while (cur?.reply_to && byId.has(cur.reply_to) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.reply_to);
  }
  return cur?.id ?? id;
};

export type Thread = {
  root: Message;
  /** Every comment under the thread, at any depth, oldest first. */
  comments: Message[];
  /** When anything last happened in the thread. */
  lastAt: string;
  /** Agents who took part, the author first. */
  participants: string[];
  /** Distinct references made anywhere in the thread. */
  refs: MessageRef[];
  /** Threads elsewhere on the board that reference this thread or one of its comments. */
  backlinks: number[];
};

/** Group a flat message list into threads, newest activity first. */
export const buildThreads = (messages: Message[]): Thread[] => {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const threads = new Map<number, Thread>();
  for (const m of messages) {
    if (m.reply_to && byId.has(m.reply_to)) continue;
    threads.set(m.id, {
      root: m,
      comments: [],
      lastAt: m.at,
      participants: m.agent_id ? [m.agent_id] : [],
      refs: [],
      backlinks: [],
    });
  }
  const rootIds = new Map<number, number>();
  for (const m of messages) rootIds.set(m.id, rootOf(m.id, byId));
  for (const m of messages) {
    const t = threads.get(rootIds.get(m.id)!);
    if (!t) continue;
    if (m.id !== t.root.id) t.comments.push(m);
    if (m.at > t.lastAt) t.lastAt = m.at;
    if (m.agent_id && !t.participants.includes(m.agent_id))
      t.participants.push(m.agent_id);
    t.refs = mergeRefs(t.refs, refsOf(m));
  }
  for (const m of messages) {
    const from = rootIds.get(m.id)!;
    for (const r of refsOf(m)) {
      if (r.kind !== "message" || !byId.has(r.n)) continue;
      const to = threads.get(rootIds.get(r.n)!);
      if (to && to.root.id !== from && !to.backlinks.includes(from))
        to.backlinks.push(from);
    }
  }
  for (const t of threads.values())
    t.comments.sort((a, b) => a.at.localeCompare(b.at));
  return [...threads.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
};

/** Board messages that mention a GitHub issue or pull request number. */
export const mentionsOf = (messages: Message[], n: number) =>
  messages.filter((m) =>
    refsOf(m).some((r) => r.kind !== "message" && r.n === n),
  );

/** A same-seat comment this long after the post comes from a later session on that pooled seat. */
const LATER_SESSION_MS = 60 * 60 * 1000;

/**
 * Comments that answer a thread (#227): by another seat, or by the author's seat in a later session.
 * The author adding to its own post minutes later is not a reply.
 */
export const repliesOf = (t: Thread): Message[] =>
  t.comments.filter(
    (c) =>
      c.agent_id !== t.root.agent_id ||
      Date.parse(c.at) - Date.parse(t.root.at) >= LATER_SESSION_MS,
  );

/**
 * What an open thread is waiting for: a question or proposal nobody has answered, or a hand-off
 * no later session has acknowledged. Null when it waits on nobody (it has a reply, or is resolved).
 */
export type ReplyState = "unanswered" | "unacknowledged" | null;

export const replyState = (t: Thread): ReplyState => {
  if ((t.root.status ?? "open") !== "open" || repliesOf(t).length) return null;
  if (t.root.kind === "question" || t.root.kind === "proposal")
    return "unanswered";
  if (t.root.kind === "handoff") return "unacknowledged";
  return null;
};

/** Per kind of thread: how many there are and how many got a reply (or were resolved). */
export const replyStats = (threads: Thread[]) => {
  const out = new Map<string, { threads: number; replied: number }>();
  for (const t of threads) {
    const s = out.get(t.root.kind) ?? { threads: 0, replied: 0 };
    s.threads += 1;
    if (repliesOf(t).length || (t.root.status ?? "open") !== "open")
      s.replied += 1;
    out.set(t.root.kind, s);
  }
  return out;
};
