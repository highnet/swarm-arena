import { agentName, type Message, type Task } from "@arena/shared";
import { agent, now, post, records, setAgent, tasks } from "./board";
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
  /^\.claude\/skills\/swarm-[a-z-]+\//,
  /^\.claude\/skills\/concepts\//,
  /^\.rallypoint\/roles\/(worker|planner|tester|fixer|janitor|orchestrator)\.md$/,
  /^docs\/SWARM\.md$/,
];

const fleet = async (
  seat: string,
  role: Parameters<typeof agent>[2],
  patch: Record<string, unknown>,
) => {
  const id = await agent(seat, null, role);
  await setAgent(id, {
    status: "working",
    session_id: process.env.CLAUDE_CODE_REMOTE_SESSION_ID ?? null,
    started_at: now(),
    ...patch,
  });
  return id;
};

const prLine = (p: Pull) => `#${p.number} ${p.title} (${p.html_url})`;

const retrosSinceLastProtocol = async () => {
  const last = (await records()).filter((r) => r.kind === "protocol").at(-1);
  const all = (await readMessages(undefined, 200)) as Message[];
  return all.filter((m) => m.kind === "retro" && (!last || m.at > last.at));
};

const leased = async (pr: number) => {
  // A live reviewer lease on this PR. Released leases sit on a marker commit until swept.
  const refs = await ghApi<{ ref: string; object: { sha: string } }[]>(
    "GET",
    `repos/${REPO}/git/matching-refs/heads/rallypoint-sessions`,
  ).catch(() => []);
  for (const r of refs.filter((x) => x.ref.endsWith(`/pr-${pr}-reviewer`))) {
    const c = await ghApi<{ message: string }>(
      "GET",
      `repos/${REPO}/git/commits/${r.object.sha}`,
    ).catch(() => null);
    if (c && !c.message.startsWith("rallypoint: released")) return true;
  }
  return false;
};

/** Decide this session's role and print its brief. */
export const next = async (onlyTrack?: string) => {
  const pulls = (await openPulls()).filter(
    (p) =>
      !p.draft && (hasLabel(p, "arena") || hasLabel(p, "loop:improvement")),
  );
  const states = await Promise.all(
    pulls.map(async (p) => ({ p, s: await reviewState(p.number) })),
  );

  // 1. Merger: an independent approve at the current head.
  const approved = states.find(({ s }) => APPROVED.has(s.code));
  if (approved) {
    await fleet("merger", "merger", {
      rp_role: "merger",
      pr: approved.p.number,
      task_id: taskOf(approved.p.body),
      activity: `Merging #${approved.p.number}`,
    });
    return `ROLE merger (Rallypoint)
You are ${agentName("merger")}. Pull request ${prLine(approved.p)} has an independent approve.
1. Read .rallypoint/roles/merger.md.
2. Run: npm run arena -- merge ${approved.p.number}
   It re-checks the verdict, squash-merges with the PR title, deletes the branch, and lands the
   arena task (version, rating, ladder) when the PR carries the referee's pass.
3. Then run \`npm run arena -- next\` again only if the prompt asked for more than one role.`;
  }

  // 2. Fixer: changes requested at the head.
  const sentBack = states.find(
    ({ p, s }) =>
      CHANGES.has(s.code) || hasLabel(p, "status:changes-requested"),
  );
  if (sentBack) {
    const taskId = taskOf(sentBack.p.body);
    await fleet("fixer", "worker", {
      rp_role: "fixer",
      pr: sentBack.p.number,
      task_id: taskId,
      activity: `Fixing review feedback on #${sentBack.p.number}`,
    });
    return `ROLE fixer (Rallypoint)
You are ${agentName("fixer")}. Review sent back ${prLine(sentBack.p)}.
1. Read .rallypoint/roles/fixer.md and the review comments on the PR.
2. git fetch origin ${sentBack.p.head.ref} && git checkout ${sentBack.p.head.ref}
3. Address the one actionable point. Log it: npm run arena -- progress ${taskId ?? "<task>"} "..."
4. ${taskId ? `npm run arena -- submit ${taskId}` : "Push the branch"}: the referee measures again and updates the PR; the old verdict no longer applies.`;
  }

  // 3. Reviewer: a pull request waiting for its verdict, not already leased.
  for (const { p, s } of states) {
    if (APPROVED.has(s.code) || CHANGES.has(s.code) || (await leased(p.number)))
      continue;
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
  }

  // 4. Improver: retros have piled up since the last protocol change.
  const retros = await retrosSinceLastProtocol();
  const improving = pulls.some((p) => hasLabel(p, "loop:improvement"));
  if (retros.length >= RETROS_FOR_IMPROVER && !improving) {
    await fleet("steward", "improver", {
      rp_role: "improver",
      activity: `Improving the protocol from ${retros.length} retros`,
    });
    return `ROLE improver (Rallypoint) · the swarm improving its own protocol
You are ${agentName("steward")}. Follow the swarm-steward skill (.claude/skills/swarm-steward/SKILL.md).
Retros since the last protocol change:
${retros.map((m) => `- #${m.id} ${m.agent_id}: ${m.body}`).join("\n")}

${await metrics()}`;
  }

  // 5. Worker: claim the next arena task through Rallypoint.
  const briefing = await claimNext(onlyTrack);
  if (briefing) return briefing;

  // 6. Planner: nothing open. The strategist calls the next experiments.
  await fleet("strategist", "strategist", {
    rp_role: "planner",
    activity: "Planning the next experiments",
  });
  return `ROLE planner (Rallypoint) · the strategist
No open arena task. Run the swarm-strategist skill: \`npm run arena -- brief\`, write plan.json,
\`npm run arena -- plan plan.json\` (each task becomes a GitHub issue), then \`npm run arena -- next\` once more.`;
};

/** Record a reviewer verdict through Rallypoint, under a reviewer lease. */
export const verdict = async (pr: number, decision: string, note: string) => {
  if (!["approve", "request-changes"].includes(decision))
    throw new Error("verdict is approve or request-changes");
  const id = sessionAgentId("reviewer");
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
  await ghApi("PUT", `repos/${REPO}/pulls/${pr}/merge`, {
    merge_method: "squash",
    commit_title: `${pull.title} (#${pr})`,
    sha: pull.head.sha,
  });
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
  const closed = /Closes #(\d+)/i.exec(pull.body ?? "")?.[1];
  if (closed) await rp("cleanup", ["--issue", closed]);
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
