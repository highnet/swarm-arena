import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import type { Task } from "@arena/shared";
import { ARENA_HOME, ARENA_ROOT, run } from "./config";

/**
 * The swarm's side of the Rallypoint protocol: every arena task is a GitHub issue, claimed with
 * `claim.mjs`, delivered as one pull request from `agent/<issue>-…`, judged by an independent
 * reviewer through `review.mjs`, and landed by a merger. The referee's games are the evidence a
 * reviewer reads; they do not replace the review.
 */

export const REPO = process.env.ARENA_REPO ?? "highnet/swarm-arena";
const SCRIPTS = resolve(ARENA_ROOT, ".rallypoint/scripts");

/** Cloud sessions block GitHub GraphQL; the Rallypoint scripts then use their REST transport. */
const rpEnv = {
  ...process.env,
  CLAUDE_CODE_REMOTE: process.env.CLAUDE_CODE_REMOTE ?? "true",
};

/** Run a Rallypoint script. */
export const rp = (script: string, args: string[]) =>
  run(process.execPath, [resolve(SCRIPTS, `${script}.mjs`), ...args], {
    cwd: ARENA_ROOT,
    env: rpEnv,
  });

/** A released coordination ref's tip: what `lib/gh.mjs` leaves instead of a delete it may not make. */
export const isReleasedMarker = (message: string | null | undefined) =>
  String(message ?? "").startsWith("rallypoint: released");

/** One GitHub REST call through the `gh` binary (REST works in every session; GraphQL does not). */
export const ghApi = async <T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> => {
  const args = [
    "api",
    "-X",
    method,
    path,
    "-H",
    "Accept: application/vnd.github+json",
  ];
  if (body !== undefined) args.push("--input", "-");
  const r = await run("gh", args, {
    cwd: ARENA_ROOT,
    input: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.code !== 0)
    throw new Error(
      `GitHub ${method} ${path} failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`,
    );
  return (r.stdout.trim() ? JSON.parse(r.stdout) : null) as T;
};

/** This session's Rallypoint identity: unique per session, stable across its commands. */
export const sessionAgentId = (seat: string) => {
  const file = resolve(ARENA_HOME, "session.json");
  const sessionKey = process.env.CLAUDE_CODE_REMOTE_SESSION_ID ?? "local";
  const saved = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, string>)
    : {};
  if (saved.session === sessionKey && saved["*"]) return saved["*"];
  if (saved.session === sessionKey && saved[seat]) return saved[seat];
  const id =
    `${seat.replace(/[^A-Za-z0-9._-]/g, "-")}-${randomBytes(3).toString("hex")}`.slice(
      0,
      64,
    );
  mkdirSync(ARENA_HOME, { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      ...(saved.session === sessionKey ? saved : {}),
      session: sessionKey,
      [seat]: id,
    }),
  );
  return id;
};

/** The agent id a conductor pinned for this session (`--agent-id`), or null. Reads only. */
export const pinnedAgentId = () => {
  const file = resolve(ARENA_HOME, "session.json");
  if (!existsSync(file)) return null;
  const saved = JSON.parse(readFileSync(file, "utf8")) as Record<
    string,
    string
  >;
  const sessionKey = process.env.CLAUDE_CODE_REMOTE_SESSION_ID ?? "local";
  return saved.session === sessionKey ? (saved["*"] ?? null) : null;
};

/**
 * Pin this session's Rallypoint identity for every seat: a conductor that dispatched the session
 * names the id it wrote the lease under, so the session's own lease calls and verdicts match it.
 */
export const pinAgentId = (id: string) => {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(id))
    throw new Error("--agent-id is 1-64 characters of A-Z a-z 0-9 . _ -");
  const file = resolve(ARENA_HOME, "session.json");
  const sessionKey = process.env.CLAUDE_CODE_REMOTE_SESSION_ID ?? "local";
  mkdirSync(ARENA_HOME, { recursive: true });
  writeFileSync(file, JSON.stringify({ session: sessionKey, "*": id }));
};

/** Issue options a plan can set: a priority (`prio:p0`…`prio:p9`) and the issue it waits on. */
export type IssueOptions = { prio?: string | number; blockedBy?: number };

/** The `prio:p<n>` label for a plan's priority (2, "p2" or "prio:p2"); `prio:p2` by default. */
export const prioLabel = (prio?: string | number) => {
  if (prio === undefined || prio === "") return "prio:p2";
  const n = /^(?:prio:)?p?([0-9])$/.exec(String(prio).trim())?.[1];
  if (n === undefined)
    throw new Error(`prio is 0-9 (or p0-p9, prio:p0-prio:p9); not "${prio}"`);
  return `prio:p${n}`;
};

export const issueBody = (
  task: Pick<Task, "id" | "spec" | "track_id" | "type"> & {
    concept?: string | null;
  },
  { blockedBy }: IssueOptions = {},
) =>
  `${task.spec}
${blockedBy ? `\nBlocked-By: #${blockedBy}\n` : ""}
---
Arena task: \`${task.id}\` · engine \`${task.track_id}\` · type \`${task.type}\`${task.concept ? ` · concept \`${task.concept}\`` : ""}

Delivered through the Rallypoint loop: claim with \`npm run arena -- next\`, measured by the referee with \`npm run arena -- submit ${task.id}\`, reviewed independently, merged by a merger.`;

/** Open the GitHub issue that mirrors an arena task. Returns its number. */
export const openIssue = async (
  task: Pick<Task, "id" | "title" | "spec" | "track_id" | "type"> & {
    concept?: string | null;
  },
  options: IssueOptions = {},
) => {
  const created = await ghApi<{ number: number }>(
    "POST",
    `repos/${REPO}/issues`,
    {
      title: task.title,
      body: issueBody(task, options),
      labels: [
        "arena",
        `engine:${task.track_id}`,
        `type:${task.type}`,
        prioLabel(options.prio),
        // Held out of the claimable pool until the blocker closes, when
        // close-referenced-issues.mjs clears the label from the Blocked-By: line.
        ...(options.blockedBy ? ["status:blocked"] : []),
      ],
    },
  );
  return created.number;
};

export type Issue = {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: { name: string }[];
  assignees?: { login: string }[];
  pull_request?: unknown;
  html_url: string;
};

export const getIssue = (issue: number) =>
  ghApi<Issue>("GET", `repos/${REPO}/issues/${issue}`);

/**
 * The agent id the issue's latest claim comment names, read as `provenance.mjs` reads it: the
 * comment must start with claim.mjs's line, and the last claim wins (a re-claim supersedes).
 */
export const claimHolder = (comments: { body?: string | null }[]) =>
  comments
    .map(
      (c) => /^Claimed by Rallypoint agent `([^`\n]+)`/.exec(c.body ?? "")?.[1],
    )
    .filter((id): id is string => Boolean(id))
    .at(-1) ?? null;

/** The labels that keep an issue out of the claim pool (`AGENTIC_LOOP.md`, Hard rules). */
export const HOLDS = [
  "status:claimed",
  "status:blocked",
  "status:deferred",
  "needs:human",
];

/**
 * Whether `agentId` holds this issue's claim and may resume it (#177): the only hold is
 * `status:claimed`, the latest claim comment names `agentId`, and the reservation ref is live. A
 * blocked, deferred or needs:human issue is never resumed, and nobody else's claim ever is.
 */
export const holdsClaim = ({
  labels,
  comments,
  agentId,
  reserved,
}: {
  labels: { name: string }[];
  comments: { body?: string | null }[];
  agentId: string;
  reserved: boolean;
}) => {
  const held = labels.map((l) => l.name).filter((l) => HOLDS.includes(l));
  return (
    reserved &&
    held.length === 1 &&
    held[0] === "status:claimed" &&
    claimHolder(comments) === agentId
  );
};

/** An issue's comments (the first 100: a claim comment is one of the earliest). */
export const issueComments = (issue: number) =>
  ghApi<{ body: string | null }[]>(
    "GET",
    `repos/${REPO}/issues/${issue}/comments?per_page=100`,
  );

/**
 * The branch a claim on this issue already uses: the published `agent/<issue>-…` branch if one
 * exists (claim.mjs pushes it at claim time), else the name claim.mjs prescribes from the title.
 * Returns whether it is on the remote.
 */
export const claimBranch = async (issue: number, title: string) => {
  const lib = resolve(ARENA_ROOT, ".rallypoint/scripts/lib/claim.mjs");
  const { branchSlug } = (await import(lib)) as {
    branchSlug: (t: string) => string;
  };
  const prescribed = `${BRANCH_PREFIX}${issue}-${branchSlug(title)}`;
  const refs = await ghApi<{ ref: string }[]>(
    "GET",
    `repos/${REPO}/git/matching-refs/heads/${BRANCH_PREFIX}${issue}-`,
  ).catch(() => []);
  const names = refs.map((r) => r.ref.replace(/^refs\/heads\//, ""));
  if (names.includes(prescribed)) return { branch: prescribed, remote: true };
  if (names[0]) return { branch: names[0], remote: true };
  return { branch: prescribed, remote: false };
};

/** Reserve the task's issue for this session with Rallypoint's atomic claim. Returns the branch. */
export const claimIssue = async (issue: number, agentId: string) => {
  const r = await rp("claim", [
    "--issue",
    String(issue),
    "--agent-id",
    agentId,
    "--allow-stale",
  ]);
  const branch = /CLAIM_BRANCH=(\S+)/.exec(r.stdout)?.[1];
  if (r.code !== 0 || !branch)
    return {
      ok: false as const,
      why: (r.stderr || r.stdout).trim().slice(0, 400),
    };
  return { ok: true as const, branch };
};

export type Pull = {
  number: number;
  title: string;
  body: string | null;
  head: { ref: string; sha: string };
  labels: { name: string }[];
  html_url: string;
  draft: boolean;
  user?: { login: string } | null;
};

export const openPulls = () =>
  ghApi<Pull[]>("GET", `repos/${REPO}/pulls?state=open&per_page=50`);

const config: { branchPrefix?: string; claimRefPrefix?: string } = (() => {
  try {
    return JSON.parse(
      readFileSync(resolve(ARENA_ROOT, ".rallypoint/config.json"), "utf8"),
    );
  } catch {
    return {};
  }
})();

/** The branch prefix `claim.mjs` prescribes (`agent/` unless `.rallypoint/config.json` says otherwise). */
export const BRANCH_PREFIX: string = config.branchPrefix || "agent/";

/** Where `claim.mjs` writes an issue's reservation ref: `refs/heads/<prefix><issue>`. */
export const CLAIM_REF_PREFIX: string =
  config.claimRefPrefix || "rallypoint-claims/issue-";

/**
 * A pull request the Rallypoint loop owns: delivered from a claimed `agent/<issue>-…` branch, or
 * opened by Dependabot (review.mjs's promotion path). These are the PRs `review.mjs record` can
 * bind a verdict to, whatever their labels; an operator's own branch (`claude/…`) has no claim
 * behind it, so it is left to the operator. `arena` and `loop:improvement` still count, so a
 * labelled delivery is never dropped.
 */
export const isRallypointPull = (p: Pull) =>
  !p.draft &&
  (p.head.ref.startsWith(BRANCH_PREFIX) ||
    p.user?.login === "dependabot[bot]" ||
    hasLabel(p, "arena") ||
    hasLabel(p, "loop:improvement"));

export const hasLabel = (p: { labels: { name: string }[] }, name: string) =>
  p.labels.some((l) => l.name === name);

/** The arena task a pull request delivers, from the marker its body carries. */
export const taskOf = (body: string | null) =>
  /Arena task: `([^`]+)`/.exec(body ?? "")?.[1] ?? null;

/**
 * `review.mjs check`: 0 or 13 is an independent approve at the current head, 10 an approve carried
 * forward because the branch's own contribution is unchanged (docs/AGENT_LOOP.md, "Carried verdicts").
 */
export const reviewState = async (pr: number) => {
  const r = await rp("review", ["check", "--pr", String(pr)]);
  return {
    code: r.code,
    said: (r.stdout || r.stderr).trim().split("\n").slice(-3).join(" "),
  };
};

export const APPROVED = new Set([0, 10, 13]);
export const CHANGES = new Set([11]);
