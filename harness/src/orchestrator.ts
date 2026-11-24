import { agentName, type Agent, type Message, type Task } from "@arena/shared";
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
import { getStore } from "./store";
import {
  APPROVED,
  CHANGES,
  getIssue,
  ghApi,
  hasLabel,
  isReleasedMarker,
  BRANCH_PREFIX,
  CLAIM_REF_PREFIX,
  claimBranch,
  HOLDS,
  holdsClaim,
  issueComments,
  type Issue,
  isRallypointPull,
  openPulls,
  REPO,
  reviewState,
  rp,
  sessionAgentId,
  taskOf,
  type Pull,
} from "./rallypoint";
import { claimNext, land, resumeCheckout, resumeTask } from "./seat";
import { adopt, issueTrack } from "./strategist";

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
  patch: { activity: string; task_id?: string | null } & Record<
    string,
    unknown
  >,
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
  const task = taskId
    ? (await tasks()).find((t) => t.id === taskId)
    : undefined;
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
    if (isReleasedMarker(c.message)) continue;
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
  /** The issue a worker was dispatched to (an arena task, or a harness or site issue). */
  issue?: number;
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
  const arena = hasLabel(p, "arena");
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
2. Read the issue it closes, the diff (gh api repos/${REPO}/pulls/${p.number}/files)${arena ? ", and the referee evidence in the PR body" : ", and the validation the PR body reports"}.
3. Judge against the issue${arena ? ` and the arena rules:${hasLabel(p, "arena:lesson") ? " this is a lesson-only PR: the playbook entry must be true and useful;" : " original search and evaluation (nothing ported or translated from open-source engines), one thread, no network or processes, tests for anything that could produce an illegal move, the playbook updated truthfully, the change scoped to the issue;"}` : ": not engine work, so there is no referee evidence; the change must be scoped to the issue and keep the repository green (npm test);"}${hasLabel(p, "loop:improvement") ? " a protocol change must stay inside the improver paths and keep the harness typechecking (npm test);" : ""}
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

/**
 * A dispatched worker whose agent id already holds the issue's claim resumes it (#177) instead of
 * being turned away by its own `status:claimed`. Returns the brief, or null when it is not the
 * holder (or the issue is held for any other reason), so the normal checks refuse it.
 */
const resumeWorker = async (issue: Issue, track?: string) => {
  const agentId = sessionAgentId("worker");
  const labels = issue.labels;
  if (!labels.some((l) => l.name === "status:claimed")) return null;
  const [comments, reserved] = await Promise.all([
    issueComments(issue.number),
    hasReservation(issue.number),
  ]);
  if (!holdsClaim({ labels, comments, agentId, reserved })) return null;
  const { branch, remote } = await claimBranch(issue.number, issue.title);
  if (issueTrack(labels)) {
    const { task } = await adopt(issue.number);
    if (track && task.track_id !== track)
      return overtaken(
        "worker",
        `#${issue.number} is a ${task.track_id} task, not ${track}`,
      );
    return resumeTask(task, branch, remote);
  }
  const where = await resumeCheckout(branch, remote);
  await fleet("worker", "worker", {
    rp_role: "worker",
    activity: `Resumed issue #${issue.number}`,
  });
  return `ROLE worker (Rallypoint) · not an arena task · RESUMED
You are ${agentName("worker")}. Issue #${issue.number} ${issue.title} (${issue.html_url}).
Your Rallypoint agent id: ${agentId}. It already holds the claim, so do not run claim.mjs again.
You are ${where}.
1. Read .rallypoint/roles/worker.md, the issue, and what the last attempt left on the branch.
2. Finish the change the issue asks for, nothing more, and run its validation (npm test, npm run typecheck).
3. node .rallypoint/scripts/preflight.mjs --body "<prepared body>" --base main
4. Open a ready-for-review pull request from ${branch} with \`Closes #${issue.number}\` and the validation
   results (gh api repos/${REPO}/pulls -X POST ...). An independent reviewer judges it.`;
};

/**
 * A worker dispatched to one issue. An arena issue without a `tasks` row is adopted and claimed
 * like any arena task; a harness or site issue gets a plain Rallypoint brief: claim it with
 * claim.mjs and deliver a normal pull request (there is no referee for it).
 */
const issueWorker = async (number: number, track?: string) => {
  const issue = await getIssue(number);
  if (issue.pull_request)
    return overtaken("worker", `#${number} is a pull request`);
  if (issue.state !== "open")
    return overtaken("worker", `#${number} is closed`);
  const resumed = await resumeWorker(issue, track);
  if (resumed) return resumed;
  const held = issue.labels.map((l) => l.name).filter((l) => HOLDS.includes(l));
  if (held.length || issue.assignees?.length)
    return overtaken(
      "worker",
      `#${number} is not claimable (${held.join(", ") || "it has an assignee"})`,
    );
  if (issueTrack(issue.labels)) {
    const { task, created } = await adopt(number);
    if (track && task.track_id !== track)
      return overtaken(
        "worker",
        `#${number} is a ${task.track_id} task, not ${track}`,
      );
    if (task.status !== "open")
      return overtaken("worker", `its task ${task.id} is ${task.status}`);
    return (
      (await claimNext(task.track_id, number)) ??
      overtaken(
        "worker",
        `#${number}${created ? " (adopted just now)" : ""} could not be claimed: another ${task.track_id} task is in progress, or claim.mjs refused (see the log above)`,
      )
    );
  }
  const agentId = sessionAgentId("worker");
  await fleet("worker", "worker", {
    rp_role: "worker",
    activity: `Working issue #${number}`,
  });
  return `ROLE worker (Rallypoint) · not an arena task
You are ${agentName("worker")}. Issue #${number} ${issue.title} (${issue.html_url}).
Your Rallypoint agent id: ${agentId}
It has no engine:<track> label, so there is no referee and no \`arena submit\`.
1. Read .rallypoint/roles/worker.md and the issue in full.
2. Claim it: node .rallypoint/scripts/claim.mjs --issue ${number} --agent-id ${agentId}
   and check out the CLAIM_BRANCH it prints, from origin/main.
3. Make the change the issue asks for, nothing more, and run its validation (npm test, npm run typecheck).
4. node .rallypoint/scripts/preflight.mjs --body "<prepared body>" --base main
5. Open a ready-for-review pull request from that branch with \`Closes #${number}\` and the validation
   results (gh api repos/${REPO}/pulls -X POST ...). An independent reviewer judges it.`;
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

/**
 * Open pull requests a merger, fixer or reviewer can act on. Not only `arena`-labelled ones: a
 * Rallypoint or harness fix delivered from an `agent/` branch needs the same review (issue #10).
 */
const loopPulls = async () => (await openPulls()).filter(isRallypointPull);

/** A role a conductor dispatched: re-check that its target still needs it, then brief it. */
const dispatched = async ({
  role,
  pr,
  track,
  issue,
}: NextOptions & { role: Role }) => {
  if (issue && role !== "worker")
    throw new Error(
      "--issue is for a worker; a merger, fixer or reviewer takes --pr",
    );
  if (role === "worker" && issue) return issueWorker(issue, track);
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
    if ((await loopPulls()).some((p) => hasLabel(p, "loop:improvement")))
      return overtaken(
        "improver",
        "an improvement pull request is already open",
      );
    return improverBrief(await retrosSinceLastProtocol());
  }
  if (!pr) throw new Error(`--role ${role} needs --pr <n>`);
  const p = (await loopPulls()).find((x) => x.number === pr);
  if (!p) {
    const any = (await openPulls()).find((x) => x.number === pr);
    return overtaken(
      role,
      !any
        ? `#${pr} is no longer open`
        : any.draft
          ? `#${pr} is a draft`
          : `#${pr} is not a Rallypoint pull request (head \`${any.head.ref}\` is not an \`${BRANCH_PREFIX}\` branch), so review.mjs cannot bind a verdict to it; it is the operator's`,
    );
  }
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
  if (opts.role || opts.issue)
    return dispatched({ ...opts, role: opts.role ?? "worker" });
  const may = (r: Role) => !opts.only || opts.only.includes(r);
  const pulls = await loopPulls();
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
  // Still working: the session goes on to its retro, which is what marks the seat idle.
  await setAgent(reviewer, {
    activity:
      decision === "approve"
        ? `Approved #${pr}`
        : `Requested changes on #${pr}`,
  });
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
  const summary = await reconcileClaim(pull, merged.sha);
  // Still working: the session goes on to its retro, which is what marks the seat idle.
  await setAgent(merger, { activity: `Merged #${pr}` });
  log(
    `merged #${pr}${taskId ? ` (${taskId})` : ""} as ${merged.sha.slice(0, 7)}`,
  );
  log(summary);
};

/** The issue a pull request delivers: its `Closes #N` / `Refs #N` line, else its `agent/<N>-…` branch. */
export const deliveredIssue = (pull: Pull) => {
  const closes =
    /^\s*(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/im.exec(
      pull.body ?? "",
    )?.[1];
  const refs = /^\s*refs\s+#(\d+)/im.exec(pull.body ?? "")?.[1];
  const branch = new RegExp(`^${BRANCH_PREFIX}(\\d+)-`).exec(
    pull.head.ref,
  )?.[1];
  const n = Number(closes ?? refs ?? branch);
  return n ? { issue: n, closes: Boolean(closes) } : null;
};

/**
 * Whether the claim reservation for an issue is still live. A ref whose tip is a
 * `rallypoint: released` marker is released: that is how a cloud session (which may not delete
 * refs) removes one, and the maintenance workflow deletes it for good later. `ghApi` is a raw read,
 * so it is checked here exactly as the Rallypoint scripts' REST transport checks it.
 */
const hasReservation = async (issue: number) => {
  const ref = `refs/heads/${CLAIM_REF_PREFIX}${issue}`;
  const refs = await ghApi<{ ref: string; object: { sha: string } }[]>(
    "GET",
    `repos/${REPO}/git/matching-refs/heads/${CLAIM_REF_PREFIX}${issue}`,
  );
  const hit = refs.find((r) => r.ref === ref);
  if (!hit) return false;
  const tip = await ghApi<{ message: string }>(
    "GET",
    `repos/${REPO}/git/commits/${hit.object.sha}`,
  );
  return !isReleasedMarker(tip.message);
};

/**
 * After a merge: close the delivered issue and release its claim (close-referenced-issues.mjs on
 * the merge SHA), then read the issue back and clear what is left on a closed one
 * (clear-status-labels.mjs for the label; the reservation ref close-referenced-issues would have
 * removed). Returns one line saying what was reconciled.
 */
const reconcileClaim = async (pull: Pull, sha: string) => {
  const target = deliveredIssue(pull);
  const pass = async () => {
    const r = await rp("close-referenced-issues", [sha]);
    if (r.code !== 0)
      log(
        `close-referenced-issues exited ${r.code} for ${sha.slice(0, 7)}: ${(r.stderr || r.stdout).trim().slice(0, 300)}`,
      );
  };
  await pass();
  if (!target)
    return "reconciled: the PR names no issue, so there was no claim to release";
  const read = async () => {
    const issue = await getIssue(target.issue);
    return {
      closed: issue.state === "closed",
      claimed: hasLabel(issue, "status:claimed"),
      status: issue.labels
        .map((l) => l.name)
        .filter((l) => l.startsWith("status:")),
      reserved: await hasReservation(target.issue),
    };
  };
  let state = await read().catch(() => null);
  // GitHub indexes a fresh merge commit's pull request a moment late; one more pass picks it up.
  if (
    state &&
    (state.reserved || state.claimed || (target.closes && !state.closed))
  ) {
    await new Promise((r) => setTimeout(r, 5000));
    await pass();
    state = await read().catch(() => null);
  }
  if (!state)
    return `reconciled: could not read #${target.issue} back; a janitor pass will check it`;
  if (state.closed && state.status.length) {
    const r = await rp("clear-status-labels", [
      "--issue",
      String(target.issue),
    ]);
    if (r.code !== 0)
      log(
        `clear-status-labels exited ${r.code}: ${(r.stderr || r.stdout).trim().slice(0, 300)}`,
      );
  }
  // Through cleanup.mjs, not a raw DELETE: the session proxy refuses ref deletes (403), and the
  // scripts' transport releases the ref with a marker commit instead.
  if (state.closed && state.reserved) {
    const r = await rp("cleanup", ["--issue", String(target.issue)]);
    if (r.code !== 0)
      log(
        `could not release the reservation: cleanup exited ${r.code}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`,
      );
  }
  const after = await read().catch(() => null);
  if (!after)
    return `reconciled: could not read #${target.issue} back; a janitor pass will check it`;
  const parts = [
    `issue #${target.issue} ${after.closed ? "closed" : target.closes ? "STILL OPEN" : "left open (no Closes line)"}`,
    after.claimed ? "status:claimed STILL SET" : "no status:claimed",
    after.reserved ? "reservation ref STILL PRESENT" : "no reservation ref",
  ];
  const clean =
    !after.claimed && !after.reserved && (after.closed || !target.closes);
  return `reconciled: ${parts.join(", ")}${clean ? "" : " (a janitor pass will reconcile the rest)"}`;
};

/** A retro: what slowed this session down, or what would make the protocol better. */
export const retro = async (seat: string, body: string) => {
  const { postMessage } = await import("./messages");
  const { message: msg } = await postMessage({
    seat,
    body,
    kind: "retro",
    tags: ["retro"],
  });
  // The retro is a session's last step, so it is what takes the seat off the fleet. A session
  // may retro under another name than the seat it was dispatched as; the session id joins them.
  const ids = new Set<string>(msg.agent_id ? [msg.agent_id] : []);
  const session = process.env.CLAUDE_CODE_REMOTE_SESSION_ID;
  if (session)
    for (const a of await getStore().select<Agent>("agents", {
      session_id: session,
      status: "working",
    }))
      ids.add(a.id);
  for (const id of ids) await setAgent(id, { status: "idle", activity: null });
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
