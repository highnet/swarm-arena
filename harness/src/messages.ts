import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  agentName,
  buildThreads,
  replyState,
  formatRef,
  mergeRefs,
  normalizeTags,
  parseRef,
  parseRefs,
  refsOf,
  rootOf,
  threadTitle,
  type Agent,
  type GameId,
  type Message,
  type MessageKind,
  type MessageRef,
  type MessageStatus,
  type ReplyState,
  type Thread,
} from "@arena/shared";
import { agent, now, sessionKey } from "./board";
import { ARENA_HOME, RUN_ID } from "./config";
import { pinnedAgentId, REPO } from "./rallypoint";
import { getStore } from "./store";

/**
 * The agent discussion board. A post without --reply opens a thread (title, tags, status);
 * a post with --reply comments on a thread or on one of its comments. References in the text
 * (msg#42, #12, pr#12, issue#12) are parsed and stored, so threads show their backlinks.
 */

const KINDS: MessageKind[] = [
  "note",
  "question",
  "proposal",
  "answer",
  "handoff",
  "retro",
  "comment",
  "decision",
];
const STATUSES: MessageStatus[] = ["open", "resolved", "closed"];

/**
 * What this session has done on the board, kept beside the checkout (#227): the context `next`
 * briefed it for, and the threads it commented on or resolved. `retro` reads it to say whether the
 * session replied anywhere, and the retro carries that line for a reviewer to see.
 */
export type BoardLedger = {
  session: string;
  role?: string;
  track?: string | null;
  issue?: number | null;
  pr?: number | null;
  /** Comments this session posted, as [comment id, thread id]. */
  replies: [number, number][];
  /** Threads this session resolved, closed or reopened. */
  resolved: number[];
};

const ledgerFile = () => resolve(ARENA_HOME, "board-session.json");
const ledgerSession = () => sessionKey() ?? "local";

export const readLedger = (): BoardLedger => {
  const empty = { session: ledgerSession(), replies: [], resolved: [] };
  try {
    const l = JSON.parse(readFileSync(ledgerFile(), "utf8")) as BoardLedger;
    return l.session === empty.session ? l : empty;
  } catch {
    return empty;
  }
};

export const writeLedger = (patch: Partial<BoardLedger>) => {
  const next = { ...readLedger(), ...patch };
  if (!existsSync(ARENA_HOME)) mkdirSync(ARENA_HOME, { recursive: true });
  writeFileSync(ledgerFile(), JSON.stringify(next, null, 2));
  return next;
};

/** Start a fresh ledger at the top of a session; returns it. */
export const startLedger = (
  ctx: Omit<BoardLedger, "session" | "replies" | "resolved">,
) => {
  const old = readLedger();
  return writeLedger({ ...old, ...ctx });
};

/** Rows written before the discussion board have none of its columns. */
const withDefaults = (m: Message): Message => ({
  ...m,
  title: m.title ?? null,
  tags: m.tags ?? [],
  refs: refsOf(m),
  status: m.status ?? "open",
});

/** Every message of this run, oldest first. */
const allMessages = async () =>
  (await getStore().select<Message>("messages", { run_id: RUN_ID }))
    .map(withDefaults)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);

/**
 * The seat a post is signed by. A session that signs with its own seat's name ("Rhea Pinecrest"),
 * its seat id or base ("worker" for `worker-2`), or its pinned agent id is that seat (#205); before,
 * each of those spellings became a new, never-working seat on the fleet.
 */
const seatAgent = async (seat: string, track: GameId | null) => {
  const mine = sessionKey();
  if (mine) {
    const want = seat.replace(/\//g, "-");
    const pinned = pinnedAgentId();
    const own = (
      await getStore().select<Agent>("agents", { session_id: mine })
    ).find(
      (a) =>
        a.id === want ||
        a.id.replace(/-\d+$/, "") === want ||
        agentName(a.id) === seat ||
        (pinned !== null && seat === pinned),
    );
    if (own) return own.id;
  }
  return agent(seat, track, roleOfSeat(seat));
};

/**
 * The role a seat first seen in a signature gets, from its name (`cd-d2-merger-pr223` is a merger):
 * every unknown name used to become a `builder`, whatever role the session had (#228).
 */
export const roleOfSeat = (seat: string): Agent["role"] => {
  const s = seat.toLowerCase();
  if (/strategist|planner/.test(s)) return "strategist";
  if (/merger/.test(s)) return "merger";
  if (/reviewer/.test(s)) return "reviewer";
  if (/improver|steward/.test(s)) return "improver";
  return "worker";
};

/** Post a thread or a comment as a seat. */
export const postMessage = async (opts: {
  seat: string;
  body: string;
  kind?: string;
  track?: GameId | null;
  replyTo?: number | null;
  title?: string | null;
  tags?: string[] | string;
  refs?: string[];
}) => {
  const body = opts.body.trim();
  if (!body) throw new Error("empty message");
  if (body.length > 2000)
    throw new Error("messages are at most 2000 characters");
  const all = await allMessages();
  const byId = new Map(all.map((m) => [m.id, m]));

  const parent = opts.replyTo ? byId.get(opts.replyTo) : undefined;
  if (opts.replyTo && !parent)
    throw new Error(`no message #${opts.replyTo} on this run's board`);
  const root = parent ? byId.get(rootOf(parent.id, byId)) : undefined;

  const kind = (opts.kind ?? (parent ? "comment" : "note")) as MessageKind;
  if (!KINDS.includes(kind))
    throw new Error(`kind must be one of ${KINDS.join(", ")}`);

  const title = opts.title?.trim() || null;
  if (title && parent)
    throw new Error("a comment has no title; only a new thread does");
  if (title && title.length > 140)
    throw new Error("titles are at most 140 characters");

  const explicit = (opts.refs ?? []).flatMap((s) =>
    s.split(",").filter(Boolean),
  );
  const flagRefs = explicit.map((s) => {
    const r = parseRef(s);
    if (!r)
      throw new Error(
        `cannot read reference "${s}" (try msg#42, pr#12, issue#12)`,
      );
    return r;
  });
  const refs = mergeRefs(parseRefs(`${title ?? ""}\n${body}`), flagRefs);
  const missing = refs.filter((r) => r.kind === "message" && !byId.has(r.n));
  if (missing.length)
    throw new Error(
      `no such message on this run's board: ${missing.map(formatRef).join(", ")}`,
    );

  // A comment inherits its thread's engine unless told otherwise.
  const track = opts.track ?? root?.track_id ?? null;
  const agentId = await seatAgent(opts.seat, track);
  const created = await getStore().insert<Message>("messages", {
    run_id: RUN_ID,
    at: now(),
    agent_id: agentId,
    track_id: track,
    reply_to: parent?.id ?? null,
    kind,
    body,
    title,
    tags: normalizeTags(opts.tags),
    refs,
    status: "open",
  });
  if (parent) {
    const l = readLedger();
    writeLedger({ replies: [...l.replies, [created.id, root!.id]] });
  }
  return { message: withDefaults(created), thread: root?.id ?? created.id };
};

/** Resolve, close or reopen the thread a message belongs to, optionally with a closing comment. */
export const setThreadStatus = async (opts: {
  seat: string;
  id: number;
  status: MessageStatus;
  note?: string;
}) => {
  if (!STATUSES.includes(opts.status))
    throw new Error(`status must be one of ${STATUSES.join(", ")}`);
  const all = await allMessages();
  const byId = new Map(all.map((m) => [m.id, m]));
  if (!byId.has(opts.id))
    throw new Error(`no message #${opts.id} on this run's board`);
  const root = byId.get(rootOf(opts.id, byId))!;
  if (opts.note)
    await postMessage({
      seat: opts.seat,
      body: opts.note,
      replyTo: opts.id,
      kind: opts.status === "resolved" ? "decision" : "comment",
    });
  const agentId = await seatAgent(opts.seat, root.track_id);
  const open = opts.status === "open";
  await getStore().update(
    "messages",
    { id: root.id },
    {
      status: opts.status,
      resolved_at: open ? null : now(),
      resolved_by: open ? null : agentId,
    },
  );
  const l = readLedger();
  if (!l.resolved.includes(root.id))
    writeLedger({ resolved: [...l.resolved, root.id] });
  return root.id;
};

/** The latest messages, oldest first, optionally for one engine (plus engine-wide ones). */
export const readMessages = async (track?: string, limit = 20) =>
  (await allMessages())
    .filter((m) => !track || m.track_id === track || m.track_id === null)
    .slice(-limit);

const who = (id: string | null) =>
  id ? `${agentName(id)} (${id})` : "unknown";
const stamp = (iso: string) => iso.slice(5, 16).replace("T", " ");
const refList = (refs: MessageRef[]) =>
  refs.length ? ` → ${refs.map(formatRef).join(" ")}` : "";

/** One line per message, flat (older callers and the retro digest). */
export const formatMessages = (msgs: Message[]) =>
  msgs
    .map(withDefaults)
    .map(
      (m) =>
        `msg#${m.id} ${stamp(m.at)} ${who(m.agent_id)}${m.track_id ? ` [${m.track_id}]` : ""} ${m.kind}${m.reply_to ? ` ↩msg#${m.reply_to}` : ""}${refList(m.refs!)}: ${m.body}`,
    )
    .join("\n");

const threadLine = (t: Thread) => {
  const r = t.root;
  const tags = r.tags?.length ? ` {${r.tags.join(", ")}}` : "";
  const n = t.comments.length;
  const waits = replyState(t);
  return `msg#${r.id} [${r.status}${waits ? `, ${waits}` : ""}] ${r.kind}${r.track_id ? ` [${r.track_id}]` : ""}${tags} "${threadTitle(r)}" by ${who(r.agent_id)} · ${n} comment${n === 1 ? "" : "s"} · last ${stamp(t.lastAt)}${refList(t.refs)}${t.backlinks.length ? ` ← ${t.backlinks.map((b) => `msg#${b}`).join(" ")}` : ""}`;
};

export type ThreadQuery = {
  track?: string;
  tag?: string;
  status?: MessageStatus | "all";
  q?: string;
  /** Only threads referencing this GitHub issue / PR number or board message. */
  ref?: string;
  /** Only threads of this kind (handoff, question, retro …). */
  kind?: MessageKind;
  /** Only threads waiting on somebody: an unanswered question or proposal, an unacknowledged hand-off. */
  unanswered?: boolean;
  /** Only threads opened at least this many minutes ago. */
  olderThanMin?: number;
  limit?: number;
};

/** Threads matching a query, newest activity first. */
export const listThreads = async (query: ThreadQuery = {}) => {
  if (query.kind && !KINDS.includes(query.kind))
    throw new Error(`kind must be one of ${KINDS.join(", ")}`);
  const all = await allMessages();
  const want = query.ref ? parseRef(query.ref) : null;
  if (query.ref && !want)
    throw new Error(`cannot read reference "${query.ref}"`);
  const tag = query.tag ? normalizeTags(query.tag)[0] : undefined;
  const q = query.q?.toLowerCase();
  return buildThreads(all)
    .filter((t) => {
      const r = t.root;
      if (query.track && r.track_id !== query.track && r.track_id !== null)
        return false;
      if (query.status && query.status !== "all" && r.status !== query.status)
        return false;
      if (tag && !(r.tags ?? []).includes(tag)) return false;
      if (query.kind && r.kind !== query.kind) return false;
      if (query.unanswered && !replyState(t)) return false;
      if (
        query.olderThanMin !== undefined &&
        Date.now() - Date.parse(r.at) < query.olderThanMin * 60000
      )
        return false;
      if (want) {
        const hit = t.refs.some((x) =>
          want.kind === "message"
            ? x.kind === "message" && x.n === want.n
            : x.kind !== "message" && x.n === want.n,
        );
        if (!hit) return false;
      }
      if (q) {
        const text = [r.title ?? "", r.body, ...t.comments.map((c) => c.body)]
          .join("\n")
          .toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    })
    .slice(0, query.limit ?? 20);
};

export const formatThreads = (threads: Thread[]) =>
  threads.map(threadLine).join("\n");

const ghLink = (r: MessageRef) =>
  r.kind === "message"
    ? `msg#${r.n}`
    : `${formatRef(r)} https://github.com/${REPO}/${r.kind === "pr" ? "pull" : "issues"}/${r.n}`;

/** A whole thread: the opening post, every comment (indented by depth), its references and backlinks. */
export const formatThread = async (id: number) => {
  const all = await allMessages();
  const byId = new Map(all.map((m) => [m.id, m]));
  if (!byId.has(id)) throw new Error(`no message #${id} on this run's board`);
  const t = buildThreads(all).find((x) => x.root.id === rootOf(id, byId))!;
  const r = t.root;
  const depth = (m: Message): number =>
    m.reply_to && byId.has(m.reply_to) && m.reply_to !== r.id
      ? 1 + depth(byId.get(m.reply_to)!)
      : 1;
  const lines = [
    `msg#${r.id} "${threadTitle(r, 140)}"`,
    `${r.kind} · ${r.status}${r.resolved_by ? ` by ${who(r.resolved_by)} at ${stamp(r.resolved_at ?? r.at)}` : ""}${r.track_id ? ` · ${r.track_id}` : " · engine-wide"}${r.tags?.length ? ` · tags: ${r.tags.join(", ")}` : ""}`,
    `${who(r.agent_id)} ${stamp(r.at)}:`,
    r.body,
    "",
    ...t.comments.flatMap((c) => {
      const pad = "  ".repeat(depth(c));
      return [
        `${pad}msg#${c.id} ${c.kind} ${who(c.agent_id)} ${stamp(c.at)}${c.reply_to !== r.id ? ` ↩msg#${c.reply_to}` : ""}:`,
        ...c.body.split("\n").map((l) => `${pad}  ${l}`),
      ];
    }),
  ];
  if (!t.comments.length) lines.push("(no comments yet)");
  if (t.refs.length)
    lines.push("", "References:", ...t.refs.map((x) => `  ${ghLink(x)}`));
  if (t.backlinks.length)
    lines.push(
      "",
      "Referenced by:",
      ...t.backlinks.map((b) => `  msg#${b} "${threadTitle(byId.get(b)!)}"`),
    );
  lines.push(
    "",
    `Comment: npm run arena -- comment ${r.id} "..." --as <seat>   (reply to a comment with its id)`,
    `Resolve: npm run arena -- resolve ${r.id} --as <seat> [--note "the answer or decision"]`,
  );
  return lines.join("\n");
};

/**
 * The board as a briefing sees it: open questions and proposals first (the ones waiting on
 * somebody), then the latest activity. Each line carries the thread id to comment on.
 */
export const boardDigest = async (track?: string, limit = 12) => {
  const threads = await listThreads({ track, status: "all", limit: 200 });
  const waiting = threads.filter(
    (t) =>
      t.root.status === "open" &&
      (t.root.kind === "question" || t.root.kind === "proposal"),
  );
  const handoffs = threads.filter((t) => replyState(t) === "unacknowledged");
  const recent = threads
    .filter((t) => !waiting.includes(t) && !handoffs.includes(t))
    .slice(0, limit);
  const out: string[] = [];
  if (waiting.length)
    out.push(
      "Open questions and proposals (comment, or resolve when answered):",
      formatThreads(waiting.slice(0, limit)),
    );
  if (handoffs.length)
    out.push(
      `Hand-offs no later session has acknowledged (${handoffs.length}; reply on the one you build on):`,
      formatThreads(handoffs.slice(0, Math.min(limit, 5))),
    );
  if (recent.length) out.push("Recent threads:", formatThreads(recent));
  if (out.length)
    out.push(
      "Read one: npm run arena -- thread <id>. References: msg#42 (thread), #12 / pr#12 / issue#12 (GitHub).",
    );
  return out.join("\n");
};

/** Threads a role should look at before it ends, each with why (#227). */
export type Waiting = { thread: Thread; why: string };

const refersTo = (t: Thread, n: number) =>
  t.refs.some((x) => x.kind !== "message" && x.n === n);

/**
 * "Threads waiting on you": the open threads this session's role is the right one to answer.
 *  - everyone: threads that cite its issue or pull request, unanswered questions on its engine;
 *  - worker: the latest unacknowledged hand-off on its engine (the one it builds on);
 *  - reviewer, fixer: the hand-off or question citing the PR or the issue it closes;
 *  - planner: every unanswered question, and the latest hand-off per engine;
 *  - improver: retros nobody has answered (comment with the PR that acts on one, then resolve it).
 * Pure over the thread list, so it is tested without a store.
 */
export const waitingFor = (
  threads: Thread[],
  ctx: {
    role?: string;
    track?: string | null;
    issue?: number | null;
    pr?: number | null;
  },
  limit = 6,
): Waiting[] => {
  const out = new Map<number, Waiting>();
  const add = (t: Thread, why: string) => {
    if (!out.has(t.root.id)) out.set(t.root.id, { thread: t, why });
  };
  const onTrack = (t: Thread) =>
    !ctx.track || t.root.track_id === ctx.track || t.root.track_id === null;
  const open = threads.filter((t) => t.root.status === "open");
  const state = new Map(open.map((t) => [t.root.id, replyState(t)] as const));
  for (const n of [ctx.issue, ctx.pr].filter((x): x is number => !!x))
    for (const t of open)
      if (refersTo(t, n) && t.root.kind !== "retro")
        add(
          t,
          `cites #${n}${state.get(t.root.id) ? ` and is ${state.get(t.root.id)}` : ""}`,
        );
  const waiting = (kind: ReplyState) =>
    open.filter((t) => state.get(t.root.id) === kind);
  for (const t of waiting("unanswered").filter(onTrack))
    add(t, `unanswered ${t.root.kind}`);
  const latestHandoff = (track: string | null | undefined) =>
    waiting("unacknowledged").find((t) => t.root.track_id === (track ?? null));
  if (ctx.role === "worker" && ctx.track) {
    const h = latestHandoff(ctx.track);
    if (h) add(h, `latest unacknowledged ${ctx.track} hand-off`);
  }
  if (ctx.role === "planner") {
    const tracks = [
      ...new Set(open.map((t) => t.root.track_id).filter(Boolean)),
    ];
    for (const tr of tracks) {
      const h = latestHandoff(tr);
      if (h) add(h, `latest unacknowledged ${tr} hand-off`);
    }
  }
  if (ctx.role === "improver")
    for (const t of open.filter(
      (t) => t.root.kind === "retro" && !t.comments.length,
    ))
      add(t, "retro nobody answered");
  return [...out.values()].slice(0, limit);
};

export const formatWaiting = (w: Waiting[]) =>
  w.map((x) => `${threadLine(x.thread)}\n    ↳ ${x.why}`).join("\n");

/** The session's waiting threads, read from the store. */
export const waitingOn = async (
  ctx: Parameters<typeof waitingFor>[1],
  limit = 6,
) => waitingFor(buildThreads(await allMessages()), ctx, limit);

/** The briefing section (#227); empty when nothing waits. */
export const waitingSection = async (ctx: Parameters<typeof waitingFor>[1]) => {
  const w = await waitingOn(ctx);
  if (!w.length) return "";
  return `
Threads waiting on you (reply with what you used or found, or resolve; no bare acks):
${formatWaiting(w)}
Read one: npm run arena -- thread <id>. Reply: npm run arena -- comment <id> "..." --as <seat>.
Your retro asks for one reply or resolve this session, or --no-reply "<why none applied>".`;
};
