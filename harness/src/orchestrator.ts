import { agentName, type Message, type Task } from "@arena/shared";
import {
  agent,
  bumpSessions,
  now,
  post,
  records,
  setAgent,
  tasks,
} from "./board";
import { log, RUN_ID } from "./config";
import { readMessages } from "./messages";
import {
  APPROVED,
  CHANGES,
  ghApi,
  hasLabel,
  openPulls,
  REPO,
  reviewState,
  rp,
  sessionAgentId,
  taskOf,
  type Pull,
} from "./rallypoint";
import { claimNext, land } from "./seat";

/**
 * The orchestrator: one session, one Rallypoint role, chosen from the state of the repository.
 * Finishing work beats starting it: merge what is approved, review what is waiting, fix what was
 * sent back, improve the protocol when retros pile up, and only then claim new work.
 */

/** Retros since the last protocol change that make an improver session due. */
export const RETROS_FOR_IMPROVER = 3;

/** Files an improver may change: the swarm's own skills and the tunable Rallypoint roles. */
export const IMPROVER_PATHS = [
  /^\.claude\/skills\/swarm-(?!conductor\/)[a-z-]+\//,
  /^\.claude\/skills\/concepts\//,
  /^\.rallypoint\/roles\/(worker|planner|tester|fixer|janitor|orchestrator)\.md$/,
  /^docs\/SWARM\.md$/,
];

/**
 * Seat a dispatched role on the fleet: mark it working, count the session and log the step that
 * started it, so the seat's page shows what it took on. `countSession: false` is for a role whose
 * own command already counts it (the strategist's `arena brief`).
 */
const fleet = async (
  seat: string,
  role: Parameters<typeof agent>[2],
  patch: { activity: string; task_id?: string | null } & Record<string, unknown>,
  { countSession = true }: { countSession?: boolean } = {},
) => {
  const id = await agent(seat, null, role);
  if (countSession) await bumpSessions(id);
  await setAgent(id, {
    status: "working",
    session_id: process.env.CLAUDE_CODE_REMOTE_SESSION_ID ?? null,
    started_at: now(),
    ...patch,
  });
  const taskId = patch.task_id ?? null;
  const task = taskId ? (await tasks()).find((t) => t.id === taskId) : undefined;
  await post("progress", {
    agent_id: id,
    task_id: taskId,
    track_id: task?.track_id ?? null,
    title: patch.activity,
  });
  return id;
};

const prLine = (p: Pull) => `#${p.number} ${p.title} (${p.html_url})`;

const retrosSinceLastProtocol = async () => {
  const last = (await records()).filter((r) => r.kind === "protocol").at(-1);
  const all = (await readMessages(undefined, 200)) as Message[];
  return all.filter((m) => m.kind === "retro" && (!last || m.at > last.at));
};

/** The agent holding a live reviewer lease on this PR, or null. Released leases are deleted refs. */
const leaseHolder = async (pr: number): Promise<string | null> => {
  const refs = await ghApi<{ ref: string; object: { sha: string } }[]>(
    "GET",
    `repos/${REPO}/git/matching-refs/heads/rallypoint-sessions`,
  ).catch(() => []);
  for (const r of refs.filter((x) => x.ref.endsWith(`/pr-${pr}-reviewer`))) {
    const c = await ghApi<{ message: string }>(
      "GET",
      `repos/${REPO}/git/commits/${r.object.sha}`,
    ).catch(() => null);
    if (!c) return "unknown"; // unreadable is never free
    if (c.message.startsWith("rallypoint: released")) continue;
    return (
      /^Rallypoint-Lease-Agent:\s*(\S+)\s*$/m.exec(c.message)?.[1] ?? "unknown"
    );
  }
  return null;
};

/** Leased by somebody other than this session. */
const leasedByOther = async (pr: number, mine: string) => {
  const holder = await leaseHolder(pr);
  return holder !== null && holder !== mine;
};

export const ROLES = [
  "merger",
  "fixer",
  "reviewer",
  "improver",
  "worker",
  "planner",
] as const;
export type Role = (typeof ROLES)[number];

export type NextOptions = {
  /** Take exactly this role instead of picking one from the board (a conductor dispatched it). */
  role?: Role;
  /** The pull request a merger, fixer or reviewer was dispatched to. */
  pr?: number;
  /** Engine track for a worker. */
  track?: string;
  /** Pick only among these roles (a builder or judge loop); nothing fitting prints ROLE none. */
  only?: Role[];
};

/** A dispatched target that no longer needs this role: the session stops, which is a normal outcome. */
const overtaken = (role: string, why: string) =>
  `ROLE none (Rallypoint)
You were dispatched as ${role}, but ${why}. The board moved on; that is the loop working.
Do nothing else: leave a one-line retro only if the dispatch itself was wrong, then stop.`;

const mergerBrief = async (p: Pull) => {
  await fleet("merger", "merger", {
    rp_role: "merger",
    pr: p.number,
    task_id: taskOf(p.body),
    activity: `Merging #${p.number}`,
  });
  return `ROLE merger (Rallypoint)
You are ${agentName("merger")}. Pull request ${prLine(p)} has an independent approve.
1. Read .rallypoint/roles/merger.md.
2. Run: npm run arena -- merge ${p.number}
   It re-checks the verdict, refuses a red or unfinished check run, squash-merges with the PR title,
   deletes the branch, reconciles the issue and claim (close-referenced-issues.mjs), and lands the
   arena task (version, rating, ladder) when the PR carries the referee's pass.
3. Then run \`npm run arena -- next\` again only if the prompt asked for more than one role.`;
};

const fixerBrief = async (p: Pull) => {
  const taskId = taskOf(p.body);
  await fleet("fixer", "worker", {
    rp_role: "fixer",
    pr: p.number,
    task_id: taskId,
    activity: `Fixing review feedback on #${p.number}`,
  });
  return `ROLE fixer (Rallypoint)
You are ${agentName("fixer")}. Review sent back ${prLine(p)}.
1. Read .rallypoint/roles/fixer.md and the newest request-changes verdict on the PR
   (gh api repos/${REPO}/issues/${p.number}/comments and .../pulls/${p.number}/reviews).
2. git fetch origin ${p.head.ref} && git checkout ${p.head.ref}
3. Address each actionable point, nothing more. Log it: npm run arena -- progress ${taskId ?? "<task>"} "..."
4. ${taskId ? `npm run arena -- submit ${taskId}` : "Push the branch"}: the referee measures again and updates the PR; the old verdict no longer applies.`;
};

const reviewerBrief = async (p: Pull) => {
  const taskId = taskOf(p.body);
  const id = await fleet("reviewer", "reviewer", {
    rp_role: "reviewer",
    pr: p.number,
    task_id: taskId,
    activity: `Reviewing #${p.number}`,
  });
  return `ROLE reviewer (Rallypoint)
You are ${agentName("reviewer")}. Review ${prLine(p)}.
Your Rallypoint agent id: ${sessionAgentId("reviewer")}
1. Read .rallypoint/roles/reviewer.md and docs/AGENT_LOOP.md (Review).
2. Read the issue it closes, the diff (gh api repos/${REPO}/pulls/${p.number}/files), and the referee evidence in the PR body.
3. Judge against the issue and the arena rules:${hasLabel(p, "arena:lesson") ? " this is a lesson-only PR: the playbook entry must be true and useful;" : " original search and evaluation (nothing ported or translated from open-source engines), one thread, no network or processes, tests for anything that could produce an illegal move, the playbook updated truthfully, the change scoped to the issue;"}${hasLabel(p, "loop:improvement") ? " a protocol change must stay inside the improver paths and keep the harness typechecking (npm test);" : ""}
4. Record exactly one verdict:
   npm run arena -- verdict ${p.number} approve "<one line>"
   npm run arena -- verdict ${p.number} request-changes "<the one actionable point>"
   Never review a PR your own session wrote. (fleet seat ${id})`;
};

const improverBrief = async (retros: Message[]) => {
  await fleet("steward", "improver", {
    rp_role: "improver",
    activity: `Improving the protocol from ${retros.length} retros`,
  });
  return `ROLE improver (Rallypoint) · the swarm improving its own protocol
You are ${agentName("steward")}. Follow the swarm-steward skill (.claude/skills/swarm-steward/SKILL.md).
Retros since the last protocol change:
${retros.map((m) => `- #${m.id} ${m.agent_id}: ${m.body}`).join("\n") || "- none"}

${await metrics()}`;
};

const plannerBrief = async () => {
  await fleet(
    "strategist",
    "strategist",
    { rp_role: "planner", activity: "Planning the next experiments" },
    { countSession: false },
  );
  return `ROLE planner (Rallypoint) · the strategist
No open arena task. Run the swarm-strategist skill: \`npm run arena -- brief\`, write plan.json,
\`npm run arena -- plan plan.json\` (each task becomes a GitHub issue), then \`npm run arena -- next\` once more.`;
};

const arenaPulls = async () =>
  (await openPulls()).filter(
    (p) =>
      !p.draft && (hasLabel(p, "arena") || hasLabel(p, "loop:improvement")),
  );

/** A role a conductor dispatched: re-check that its target still needs it, then brief it. */
const dispatched = async ({
  role,
  pr,
  track,
}: NextOptions & { role: Role }) => {
  if (role === "worker")
    return (
      (await claimNext(track)) ??
      overtaken(
        "worker",
        `no claimable arena task${track ? ` on ${track}` : ""} is left`,
      )
    );
  if (role === "planner") return plannerBrief();
  if (role === "improver") {
    if ((await arenaPulls()).some((p) => hasLabel(p, "loop:improvement")))
      return overtaken(
        "improver",
        "an improvement pull request is already open",
      );
    return improverBrief(await retrosSinceLastProtocol());
  }
  if (!pr) throw new Error(`--role ${role} needs --pr <n>`);
  const p = (await arenaPulls()).find((x) => x.number === pr);
  if (!p)
    return overtaken(role, `#${pr} is no longer an open arena pull request`);
  const s = await reviewState(pr);
  if (role === "merger")
    return APPROVED.has(s.code)
      ? mergerBrief(p)
      : overtaken(
          "merger",
          `#${pr} has no independent approve at its head (check ${s.code})`,
        );
  if (role === "fixer")
    return CHANGES.has(s.code) || hasLabel(p, "status:changes-requested")
      ? fixerBrief(p)
      : overtaken(
          "fixer",
          `#${pr} has no outstanding request-changes (check ${s.code})`,
        );
  if (APPROVED.has(s.code) || CHANGES.has(s.code))
    return overtaken(
      "reviewer",
      `#${pr} already has a verdict at its head (check ${s.code})`,
    );
  if (await leasedByOther(pr, sessionAgentId("reviewer")))
    return overtaken(
      "reviewer",
      `another session holds the reviewer lease on #${pr}`,
    );
  return reviewerBrief(p);
};

/** Decide this session's role and print its brief. */
export const next = async (opts: NextOptions = {}) => {
  if (opts.role) return dispatched({ ...opts, role: opts.role });
  const may = (r: Role) => !opts.only || opts.only.includes(r);
  const pulls = await arenaPulls();
  const states = await Promise.all(
    pulls.map(async (p) => ({ p, s: await reviewState(p.number) })),
  );

  // 1. Merger: an independent approve at the current head.
  const approved = states.find(({ s }) => APPROVED.has(s.code));
  if (approved && may("merger")) return mergerBrief(approved.p);

  // 2. Fixer: changes requested at the head.
  const sentBack = states.find(
    ({ p, s }) =>
      CHANGES.has(s.code) || hasLabel(p, "status:changes-requested"),
  );
  if (sentBack && may("fixer")) return fixerBrief(sentBack.p);

  // 3. Reviewer: a pull request waiting for its verdict, not already leased.
  if (may("reviewer"))
    for (const { p, s } of states) {
      if (APPROVED.has(s.code) || CHANGES.has(s.code)) continue;
      if (await leasedByOther(p.number, sessionAgentId("reviewer"))) continue;
      return reviewerBrief(p);
    }

  // 4. Improver: retros have piled up since the last protocol change.
  if (may("improver")) {
    const retros = await retrosSinceLastProtocol();
    const improving = pulls.some((p) => hasLabel(p, "loop:improvement"));
    if (retros.length >= RETROS_FOR_IMPROVER && !improving)
      return improverBrief(retros);
  }

  // 5. Worker: claim the next arena task through Rallypoint.
  if (may("worker")) {
    const briefing = await claimNext(opts.track);
    if (briefing) return briefing;
  }

  // 6. Planner: nothing open. The strategist calls the next experiments.
  if (may("planner")) return plannerBrief();
  return `ROLE none (Rallypoint)
Nothing on the board needs ${opts.only!.join(", ")} right now. Stop; the next tick looks again.`;
};

/** Record a reviewer verdict through Rallypoint, under a reviewer lease. */
export const verdict = async (pr: number, decision: string, note: string) => {
  if (!["approve", "request-changes"].includes(decision))
    throw new Error("verdict is approve or request-changes");
  const id = sessionAgentId("reviewer");
  const holder = await leaseHolder(pr);
  if (holder !== null && holder !== id)
    throw new Error(
      `another session (${holder}) holds the reviewer lease on #${pr}: stand down`,
    );
  if (holder === null)
    await rp("lease", [
      "--role",
      "reviewer",
      "--pr",
      String(pr),
      "--agent-id",
      id,
    ]);
  const r = await rp("review", [
    "record",
    "--pr",
    String(pr),
    "--agent-id",
    id,
    "--verdict",
    decision,
    "--note",
    note,
  ]);
  await rp("lease", [
    "--release",
    "--role",
    "reviewer",
    "--pr",
    String(pr),
    "--agent-id",
    id,
  ]);
  if (r.code !== 0)
    throw new Error(
      `review.mjs record refused (${r.code}): ${(r.stderr || r.stdout).trim().slice(0, 400)}`,
    );
  const pull = await ghApi<Pull>("GET", `repos/${REPO}/pulls/${pr}`);
  const taskId = taskOf(pull.body);
  const reviewer = await agent("reviewer", null, "reviewer");
  if (taskId) {
    await post("progress", {
      task_id: taskId,
      agent_id: reviewer,
      title:
        decision === "approve"
          ? `Review: approved #${pr}.`
          : `Review: changes requested on #${pr}.`,
      detail: note,
    });
  }
  await setAgent(reviewer, { status: "idle", activity: null });
  log(`${decision} recorded on #${pr}`);
};

/**
 * `review.mjs check` never reads CI, so the merger does: a failed or unfinished check run at the
 * head refuses the merge. Skipped and neutral runs are not failures.
 */
const requireGreenChecks = async (sha: string) => {
  const { check_runs } = await ghApi<{
    check_runs: { name: string; status: string; conclusion: string | null }[];
  }>("GET", `repos/${REPO}/commits/${sha}/check-runs?per_page=100`);
  const bad = check_runs.filter(
    (c) =>
      c.status !== "completed" ||
      ["failure", "cancelled", "timed_out", "action_required"].includes(
        c.conclusion ?? "",
      ),
  );
  if (bad.length)
    throw new Error(
      `CI is not green at ${sha.slice(0, 7)}: ${bad.map((c) => `${c.name} ${c.conclusion ?? c.status}`).join(", ")}`,
    );
};

/** Merge an approved pull request, then land its arena task. */
export const merge = async (pr: number) => {
  const state = await reviewState(pr);
  if (!APPROVED.has(state.code))
    throw new Error(
      `#${pr} has no independent approve at its head (review.mjs check ${state.code}: ${state.said})`,
    );
  const pull = await ghApi<Pull>("GET", `repos/${REPO}/pulls/${pr}`);
  if (hasLabel(pull, "loop:improvement")) {
    const files = await ghApi<{ filename: string }[]>(
      "GET",
      `repos/${REPO}/pulls/${pr}/files?per_page=100`,
    );
    const outside = files
      .map((f) => f.filename)
      .filter((f) => !IMPROVER_PATHS.some((re) => re.test(f)));
    if (outside.length)
      throw new Error(
        `protocol change touches frozen files: ${outside.join(", ")}`,
      );
  }
  await requireGreenChecks(pull.head.sha);
  const merged = await ghApi<{ sha: string }>(
    "PUT",
    `repos/${REPO}/pulls/${pr}/merge`,
    {
      merge_method: "squash",
      commit_title: `${pull.title} (#${pr})`,
      sha: pull.head.sha,
    },
  );
  await ghApi(
    "DELETE",
    `repos/${REPO}/git/refs/heads/${encodeURIComponent(pull.head.ref)}`,
  ).catch(() => null);
  const merger = await agent("merger", null, "merger");
  const taskId = taskOf(pull.body);
  if (taskId && hasLabel(pull, "arena:referee-passed")) await land(taskId);
  if (hasLabel(pull, "loop:improvement")) {
    const version =
      (await records()).filter((r) => r.kind === "protocol").length + 1;
    await post("protocol", {
      agent_id: merger,
      title: `Protocol p${version}: ${pull.title.replace(/^[a-z]+(\([^)]*\))?:\s*/, "")}`,
      detail:
        (pull.body ?? "")
          .split("\n")
          .find((l) => l.trim() && !l.startsWith("#") && !/^closes/i.test(l))
          ?.slice(0, 300) ?? null,
      data: { pr, url: pull.html_url },
    });
  }
  // Closes/Refs, the claim, its labels and its reservation: the script reads the body and the
  // landed commit, so a Refs #N partial delivery stays open with its claim released.
  const reconciled = await rp("close-referenced-issues", [merged.sha]);
  if (reconciled.code !== 0)
    log(
      `close-referenced-issues exited ${reconciled.code} for ${merged.sha}: ${(reconciled.stderr || reconciled.stdout).trim().slice(0, 300)} (a janitor pass will reconcile it)`,
    );
  await setAgent(merger, { status: "idle", activity: null });
  log(`merged #${pr}${taskId ? ` (${taskId})` : ""}`);
};

/** A retro: what slowed this session down, or what would make the protocol better. */
export const retro = async (seat: string, body: string) => {
  const { postMessage } = await import("./messages");
  await postMessage({ seat, body, kind: "retro" });
  log("retro posted");
};

/** What the protocol is achieving, measured from the board: the improver's evidence. */
export const metrics = async () => {
  const all = (await tasks()) as Task[];
  const recs = await records();
  const claimedAt = new Map(
    recs.filter((r) => r.kind === "task_claimed").map((r) => [r.task_id, r.at]),
  );
  const closed = all.filter((t) => t.closed_at && claimedAt.get(t.id));
  const minutes = closed
    .map(
      (t) =>
        (Date.parse(t.closed_at!) - Date.parse(claimedAt.get(t.id)!)) / 60000,
    )
    .sort((a, b) => a - b);
  const median = minutes.length
    ? Math.round(minutes[Math.floor(minutes.length / 2)])
    : null;
  const landed = all.filter((t) => t.status === "landed").length;
  const dead = all.filter((t) => t.status === "dead").length;
  const reasons = recs
    .filter((r) => r.kind === "idea_dead")
    .map((r) => (r.detail ?? "").split(/[:.]/)[0])
    .reduce<Record<string, number>>(
      (acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }),
      {},
    );
  return `Protocol metrics (run ${RUN_ID}):
- tasks landed ${landed}, buried ${dead}, in review ${all.filter((t) => t.status === "review").length}, open ${all.filter((t) => t.status === "open").length}
- ship rate ${landed + dead ? Math.round((100 * landed) / (landed + dead)) : 0}%
- median minutes from claim to close: ${median ?? "n/a"}
- burial reasons: ${
    Object.entries(reasons)
      .map(([k, v]) => `${k} ×${v}`)
      .join("; ") || "none"
  }
- progress notes per task: ${all.length ? (recs.filter((r) => r.kind === "progress").length / all.length).toFixed(1) : "0"}`;
};
