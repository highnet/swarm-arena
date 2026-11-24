import { cpus, totalmem } from "node:os";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { outsideHelp } from "./rules";
import { buildWasm, wasmPaths } from "./wasm";
import { boardDigest } from "./messages";
import { relative, resolve } from "node:path";
import {
  agentName,
  GAMES,
  newOpeningSeed,
  randomPlayer,
  type Task,
} from "@arena/shared";
import {
  agent,
  bumpSessions,
  now,
  post,
  records,
  rungs,
  setAgent,
  tasks,
  track,
} from "./board";
import {
  ARENA_HOME,
  ARENA_ROOT,
  ENGINES_DIR,
  GATE_PAIRS,
  log,
  MOVE_MS,
  MOVE_SLACK_MS,
  run,
  RUN_ID,
} from "./config";
import { arenaEngine, killAll } from "./engine";
import { withVerdict } from "./verdict";
import {
  describeSprt,
  GATE_SPRT,
  gateShortfall,
  needsRungBaseline,
  sprtState,
  sprtVerdict,
  type Rating,
} from "./gate";
import { gateRung, isMatchAborted, runMatch, type MatchAborted } from "./match";
import { reference } from "./references";
import { openingsNote } from "./openings";
import { getStore } from "./store";
import {
  claimIssue,
  ghApi,
  openIssue,
  REPO,
  sessionAgentId,
  claimHolder,
  issueComments,
} from "./rallypoint";

/**
 * Agent sessions run as Claude Code cloud sessions on this repository. A session calls
 * `arena next` to claim a task, improves the engine crate itself, then `arena submit <task>`
 * hands the result to the referee. The harness never launches a model.
 */

const crate = (trackId: string) => `${trackId}-engine`;

/** A step on a task in flight, shown live on the task's page. */
export const progress = (
  task: Pick<Task, "id" | "track_id">,
  by: string,
  title: string,
  detail: string | null = null,
  matchId: string | null = null,
) =>
  post("progress", {
    track_id: task.track_id,
    agent_id: by,
    task_id: task.id,
    match_id: matchId,
    title,
    detail,
  });

const seatOf = async (task: Task) => {
  const opened = (await records()).find(
    (r) => r.task_id === task.id && r.kind === "task_opened",
  );
  return String(
    (opened?.data as { seat?: string })?.seat ?? `${task.track_id}/builder`,
  );
};

const briefing = async (task: Task, seat: string, branch = "") => {
  const t = await track(task.track_id);
  const ladder = await rungs(task.track_id);
  const recent = (await records())
    .filter(
      (r) =>
        r.track_id === task.track_id &&
        ["match_verdict", "patch_landed", "idea_dead"].includes(r.kind),
    )
    .slice(-12)
    .map((r) => `- [${r.kind}] ${r.title}${r.detail ? `: ${r.detail}` : ""}`)
    .join("\n");
  return `ROLE worker (Rallypoint)
TASK ${task.id}${task.issue ? ` · issue #${task.issue} https://github.com/${REPO}/issues/${task.issue}` : ""}
Branch: ${branch || "(none)"}: you are on it. Commit nothing to main; the referee opens the pull request.
Type: ${task.type}${task.concept ? ` · concept: ${task.concept} (see the concepts skill for how it did in other games)` : ""}
You are ${agentName(seat)}, seat ${seat}. Sign messages with --as ${seat}.
Engine: ${GAMES[task.track_id].name}, crate ${relative(ARENA_ROOT, resolve(ENGINES_DIR, task.track_id))}
Title: ${task.title}
Spec: ${task.spec}

Current version: ${t.current_version ?? "none yet"} at ${t.current_elo === null ? "no rating" : Math.round(t.current_elo)}.
Hardware: ${cpus().length} cores here, ${Math.round(totalmem() / 2 ** 30)} GB RAM, but the engine gets ONE thread and must also run in a browser.
Time: answer \`go <ms>\` within <ms> (gate matches use ${MOVE_MS} ms, players on the site choose 0.5–3 s); later than <ms> + ${MOVE_SLACK_MS} ms forfeits.
Ladder: ${ladder.map((r) => `${r.label} (${r.elo})${r.cleared_at ? " cleared" : ""}`).join(", ")}.
Recent results:
${recent || "- none yet"}

Discussion board (this engine and engine-wide). Comment on threads that concern your task, and open\none (with --title and --tags) for a question or hand-off; cite issues and PRs as #12 or pr#12:
${(await boardDigest(task.track_id, 8)) || "- quiet"}

Log progress as you go: npm run arena -- progress ${task.id} "..."
When cargo build --release and cargo test pass in the crate, run:
  npm run arena -- submit ${task.id}
It measures the branch and opens the pull request (Closes #${task.issue ?? "?"}) for an independent reviewer.
If you cannot finish, run:
  npm run arena -- release ${task.id}`;
};

/**
 * Claim the oldest open task on a track nobody else is working on (only the one mirroring
 * `onlyIssue`, when a conductor dispatched this session to it). Returns the briefing.
 */
export const claimNext = async (onlyTrack?: string, onlyIssue?: number) => {
  const db = getStore();
  const all = await tasks();
  const busy = new Set(
    all.filter((t) => t.status === "claimed").map((t) => t.track_id),
  );
  const open = all
    .filter(
      (t) =>
        t.status === "open" &&
        !busy.has(t.track_id) &&
        (!onlyTrack || t.track_id === onlyTrack) &&
        (!onlyIssue || t.issue === onlyIssue),
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  for (const task of open) {
    const seat = await seatOf(task);
    const seatId = await agent(seat, task.track_id, "builder");
    const claimed = await db.claim(
      "tasks",
      { id: task.id, status: "open" },
      { status: "claimed", claimed_by: seatId },
    );
    if (!claimed) continue;
    // Rallypoint: the task is a GitHub issue, reserved atomically for this session.
    let issue = task.issue ?? null;
    if (!issue) {
      issue = await openIssue(task);
      await db.update("tasks", { id: task.id }, { issue });
      task.issue = issue;
    }
    const agentId = sessionAgentId(seat);
    const rpClaim = await claimIssue(issue, agentId);
    if (!rpClaim.ok) {
      await db.update(
        "tasks",
        { id: task.id },
        { status: "open", claimed_by: null },
      );
      log(`issue #${issue} could not be claimed: ${rpClaim.why}`);
      continue;
    }
    await git(["fetch", "origin", "main"]);
    await git(["checkout", "-B", rpClaim.branch, "origin/main"]);
    await bumpSessions(seatId);
    await setAgent(seatId, {
      status: "working",
      rp_role: "worker",
      task_id: task.id,
      pr: null,
      activity: `Claimed issue #${issue}`,
      session_id: process.env.CLAUDE_CODE_REMOTE_SESSION_ID ?? null,
      started_at: now(),
    });
    await post("task_claimed", {
      track_id: task.track_id,
      agent_id: seatId,
      task_id: task.id,
      title: `${seat} claimed “${task.title}”`,
      detail: `Issue #${issue}, branch ${rpClaim.branch}.`,
    });
    return briefing(task, seat, rpClaim.branch);
  }
  return null;
};

/**
 * Check out a claim's branch to resume it (#177) and merge current origin/main into it. A local
 * branch of that name is kept (it may hold unpushed work), else it is taken from the remote, else
 * started from origin/main. Returns one line saying where the session now stands.
 */
export const resumeCheckout = async (branch: string, remote: boolean) => {
  await git(["fetch", "origin", "main"]);
  if (remote) await git(["fetch", "origin", branch]);
  const local =
    (await git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]))
      .code === 0;
  const co = local
    ? await git(["checkout", branch])
    : await git([
        "checkout",
        "-B",
        branch,
        remote ? `origin/${branch}` : "origin/main",
      ]);
  if (co.code !== 0)
    return `could not check out ${branch} (${(co.stderr || co.stdout).trim().slice(0, 200)}): check it out yourself before you change anything`;
  for (const from of [
    ...(local && remote ? [`origin/${branch}`] : []),
    "origin/main",
  ]) {
    const m = await git(["merge", "--no-edit", from]);
    if (m.code !== 0) {
      await git(["merge", "--abort"]);
      return `on ${branch}, but ${from} does not merge cleanly: run git merge ${from} and resolve the conflicts first`;
    }
  }
  return `on ${branch}${remote ? "" : " (no branch was published, so it starts from origin/main)"}, with origin/main merged in`;
};

/**
 * Resume an arena task whose claim this session's agent id already holds (#177): a resubmit after
 * an inconclusive gate (#164), or a lesson pull request closed as superseded. The task is claimed
 * again in the store whatever status the last submit left it in, and the branch is checked out.
 */
export const resumeTask = async (
  task: Task,
  branch: string,
  remote: boolean,
) => {
  const seat = await seatOf(task);
  const seatId = await agent(seat, task.track_id, "builder");
  await getStore().update(
    "tasks",
    { id: task.id },
    { status: "claimed", claimed_by: seatId, closed_at: null },
  );
  const where = await resumeCheckout(branch, remote);
  await bumpSessions(seatId);
  await setAgent(seatId, {
    status: "working",
    rp_role: "worker",
    task_id: task.id,
    pr: null,
    activity: `Resumed issue #${task.issue}`,
    session_id: process.env.CLAUDE_CODE_REMOTE_SESSION_ID ?? null,
    started_at: now(),
  });
  await post("progress", {
    track_id: task.track_id,
    agent_id: seatId,
    task_id: task.id,
    title: `${seat} resumed its claim on #${task.issue}`,
    detail: `Branch ${branch}.`,
  });
  return `${await briefing(task, seat, branch)}

RESUMED: this session's agent id already holds the claim on #${task.issue}, so nothing was claimed
again. You are ${where}. Pick up where the last attempt stopped (its progress log and playbook notes).`;
};

/** Put a claimed task back on the board (the session could not finish it). */
export const release = async (taskId: string) => {
  const db = getStore();
  const [task] = await db.select<Task>("tasks", { id: taskId });
  if (!task || task.status !== "claimed")
    throw new Error(`task ${taskId} is not claimed`);
  await db.update(
    "tasks",
    { id: taskId },
    { status: "open", claimed_by: null },
  );
  if (task.claimed_by)
    await setAgent(task.claimed_by, {
      status: "idle",
      activity: null,
      task_id: null,
    });
  if (task.issue && task.claimed_by) {
    const { rp } = await import("./rallypoint");
    await rp("release-claim", [
      "--issue",
      String(task.issue),
      "--agent-id",
      sessionAgentId(task.claimed_by.replace(/-/, "/")),
    ]);
  }
  log(`released ${taskId}`);
};

const git = (args: string[]) => run("git", args, { cwd: ARENA_ROOT });

/** The paths a session executes from: a checkout missing a commit to them runs a stale harness. */
const HARNESS_PATHS = ["harness", "shared", ".rallypoint"];

/**
 * Harness files origin/main changed since this checkout's merge base with it (three dots, as
 * `freshness.mjs` measures: the branch's own edits do not count). Null when origin/main could not
 * be fetched or compared, which is no evidence either way.
 */
export const staleHarness = async (fetch = true) => {
  if (fetch && (await git(["fetch", "origin", "main"])).code !== 0) return null;
  const r = await git([
    "diff",
    "--name-only",
    "HEAD...origin/main",
    "--",
    ...HARNESS_PATHS,
  ]);
  return r.code === 0 ? r.stdout.split("\n").filter(Boolean) : null;
};

/**
 * Cloud containers can start on a local `main` that diverged from origin/main (its pre-squash
 * history, issue #115), so a setup `git pull` fails and the session runs a stale harness. On a
 * clean `main` this detaches to origin/main (the local branch keeps its commits); anywhere else it
 * says what is wrong and how to fix it.
 */
const syncWithMain = async () => {
  if ((await git(["fetch", "origin", "main"])).code !== 0) {
    log(
      "warn: git fetch origin main failed; cannot tell whether this checkout is current",
    );
    return;
  }
  const out = async (args: string[]) => (await git(args)).stdout.trim();
  const branch = await out(["branch", "--show-current"]);
  const behind =
    Number(await out(["rev-list", "--count", "HEAD..origin/main"])) || 0;
  const hasMain =
    (await git(["rev-parse", "--verify", "-q", "refs/heads/main"])).code === 0;
  const diverged =
    hasMain &&
    (await git(["merge-base", "--is-ancestor", "main", "origin/main"])).code !==
      0;
  const fix = "git checkout --detach origin/main";
  if (branch === "main") {
    if (!behind && !diverged) return;
    const what = diverged
      ? "local main has diverged from origin/main"
      : `main is ${behind} commit(s) behind origin/main`;
    const clean =
      (await out(["status", "--porcelain", "--untracked-files=no"])) === "";
    if (
      clean &&
      (await git(["checkout", "--detach", "origin/main"])).code === 0
    ) {
      log(
        `${what}: detached HEAD to origin/main (${await out(["rev-parse", "--short", "HEAD"])}) so this session runs the current harness; local main is untouched`,
      );
      return;
    }
    log(
      `warn: ${what} and ${clean ? "detaching failed" : "the working tree has changes"}. Fix: ${fix}`,
    );
    return;
  }
  if (branch) {
    const stale = await staleHarness(false);
    if (stale?.length)
      log(
        `warn: ${branch} lacks harness changes on origin/main (${stale.slice(0, 3).join(", ")}${stale.length > 3 ? ", …" : ""}). Rebase it onto origin/main, or for a fresh session: ${fix}`,
      );
  } else if (behind)
    log(
      `warn: detached HEAD is ${behind} commit(s) behind origin/main. Fix: ${fix}`,
    );
  if (diverged)
    log(
      "warn: local main has diverged from origin/main (not checked out here). Fix: git branch -f main origin/main",
    );
};

/**
 * Workspace dependencies missing from node_modules. A container snapshot from before a workspace
 * was added (swarm-graph's d3) leaves `tsc -p web` with a wall of implicit-any errors.
 */
const missingWorkspaceDeps = () => {
  const root = JSON.parse(
    readFileSync(resolve(ARENA_ROOT, "package.json"), "utf8"),
  ) as { workspaces?: string[] };
  const missing = new Set<string>();
  for (const ws of root.workspaces ?? []) {
    const file = resolve(ARENA_ROOT, ws, "package.json");
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const name of Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    }))
      if (
        ![resolve(ARENA_ROOT, ws), ARENA_ROOT].some((dir) =>
          existsSync(resolve(dir, "node_modules", name, "package.json")),
        )
      )
        missing.add(name);
  }
  return [...missing];
};

const playbook = (trackId: string) =>
  resolve(ARENA_ROOT, ".claude/skills", `${trackId}-playbook`, "SKILL.md");

/** The referee's one-line verdict at the end of the engine's playbook, one line per task. */
const logVerdict = (trackId: string, title: string, line: string) => {
  const p = playbook(trackId);
  if (existsSync(p))
    writeFileSync(
      p,
      withVerdict(
        readFileSync(p, "utf8"),
        title,
        `- ${now().slice(0, 16).replace("T", " ")} UTC · ${line}`,
      ),
    );
};

/**
 * Cross-game evidence lives one file per verdict, named by the task. Every pull request adds a file
 * nobody else touches, so two engine PRs in flight never conflict on the evidence log (they did when
 * every verdict appended to the end of the same SKILL.md).
 */
const EVIDENCE = resolve(ARENA_ROOT, ".claude/skills/concepts/evidence");

/** One line of cross-game evidence: what a concept did for one engine. Returns the file written. */
const logConcept = (task: Task, outcome: string): string | null => {
  if (!task.concept) return null;
  mkdirSync(EVIDENCE, { recursive: true });
  const file = resolve(EVIDENCE, `${task.id}.md`);
  writeFileSync(
    file,
    `- ${now().slice(0, 10)} · **${task.concept}** · ${GAMES[task.track_id].name} · ${outcome} · ${task.title}\n`,
  );
  return file;
};

/** Take back the last verdict line (a ship that could not be pushed). */
const unlogVerdict = (trackId: string) => {
  const p = playbook(trackId);
  if (!existsSync(p)) return;
  const lines = readFileSync(p, "utf8").trimEnd().split("\n");
  if (lines.at(-1)?.startsWith("- "))
    writeFileSync(p, `${lines.slice(0, -1).join("\n")}\n`);
};

/** The Rallypoint branch this checkout is on, or null when it is not an agent branch. */
const currentBranch = async () => {
  const b = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
  return b.startsWith("agent/") ? b : null;
};

/**
 * Commit on the agent branch, bring main in, push the branch, and open (or update) the pull request.
 * Nothing goes to main here: an independent reviewer and a merger do that.
 *
 * Main is MERGED in, never rebased: a rebase rewrites the branch, needs a force-push, and fails
 * outright on a branch that already merged main (a fixer's conflict resolution), which used to bury
 * results that had passed the referee. A merge keeps the branch's own commits, so an earlier
 * verdict can carry forward. If main genuinely conflicts, the merge is abandoned and the branch is
 * pushed as it is: the measured result stands and the pull request says a fixer must resolve it.
 */
const deliver = async (
  task: Task,
  paths: string[],
  message: string,
  pr: { title: string; body: string; labels: string[] },
) => {
  const branch = await currentBranch();
  if (!branch)
    throw new Error("not on an agent/ branch: claim with `arena next` first");
  await git(["add", "-A", ...paths.map((p) => relative(ARENA_ROOT, p))]);
  await git(["commit", "-m", message]);
  await git(["fetch", "origin", "main"]);
  let conflicts = false;
  if ((await git(["merge", "--no-edit", "origin/main"])).code !== 0) {
    await git(["merge", "--abort"]);
    conflicts = true;
  }
  const push = () => git(["push", "-u", "origin", branch]);
  if ((await push()).code !== 0) {
    // Somebody pushed to the branch meanwhile (a fixer): take their commits, never overwrite them.
    await git(["fetch", "origin", branch]);
    if ((await git(["merge", "--no-edit", `origin/${branch}`])).code !== 0) {
      await git(["merge", "--abort"]);
      return null;
    }
    if ((await push()).code !== 0) return null;
  }
  if (conflicts)
    pr = {
      ...pr,
      body: `${pr.body}\n\n> **Conflicts with main.** The referee could not merge main into this branch. A fixer merges \`origin/main\` in (never rebase) and resolves it; the measured result above still applies to this branch's own change.`,
    };
  const existing = await ghApi<{ number: number; html_url: string }[]>(
    "GET",
    `repos/${REPO}/pulls?state=open&head=${REPO.split("/")[0]}:${encodeURIComponent(branch)}`,
  );
  const pull = existing[0]
    ? await ghApi<{ number: number; html_url: string }>(
        "PATCH",
        `repos/${REPO}/pulls/${existing[0].number}`,
        {
          title: pr.title,
          body: pr.body,
        },
      )
    : await ghApi<{ number: number; html_url: string }>(
        "POST",
        `repos/${REPO}/pulls`,
        {
          title: pr.title,
          body: pr.body,
          head: branch,
          base: "main",
        },
      );
  await ghApi("POST", `repos/${REPO}/issues/${pull.number}/labels`, {
    labels: pr.labels,
  });
  for (const stale of ["arena:referee-passed", "arena:lesson"].filter(
    (l) => !pr.labels.includes(l),
  )) {
    await ghApi(
      "DELETE",
      `repos/${REPO}/issues/${pull.number}/labels/${encodeURIComponent(stale)}`,
    ).catch(() => null);
  }
  return pull;
};

/** What the main version of an engine is made of: its crate tree plus the lockfile. */
const mainKey = async (trackId: Task["track_id"], ref = "origin/main") => {
  const rel = relative(ARENA_ROOT, ENGINES_DIR);
  const crateTree = await git(["rev-parse", `${ref}:${rel}/${trackId}`]);
  const lock = await git(["rev-parse", `${ref}:${rel}/Cargo.lock`]);
  return `${crateTree.stdout.trim()}:${lock.stdout.trim()}`;
};

const mainBin = (trackId: string) =>
  resolve(ARENA_HOME, "bin", `${trackId}-main`);

/** Keep a main binary only while it still matches main; skips rebuilding main on every submit. */
const cachedMain = async (trackId: Task["track_id"]) => {
  const bin = mainBin(trackId);
  const key = await mainKey(trackId);
  const ok =
    existsSync(bin) &&
    existsSync(`${bin}.key`) &&
    readFileSync(`${bin}.key`, "utf8") === key;
  return { bin, key, ok };
};

/** Build the engine as it is on origin/main, in a separate worktree, and start it. Cached by tree. */
export const currentVersion = async (
  trackId: Task["track_id"],
  label: string,
) => {
  await git(["fetch", "origin", "main"]);
  const { bin, key, ok } = await cachedMain(trackId);
  if (ok) return arenaEngine(label, bin, trackId, MOVE_MS);
  const dir = resolve(ARENA_HOME, "main-build");
  await git(["worktree", "remove", "--force", dir]);
  const add = await git(["worktree", "add", "--detach", dir, "origin/main"]);
  if (add.code !== 0)
    throw new Error(`could not check out main: ${add.stderr.slice(0, 120)}`);
  const target = resolve(ARENA_HOME, "main-target");
  const build = await run(
    "cargo",
    ["build", "--release", "-p", crate(trackId), "--target-dir", target],
    {
      cwd: resolve(dir, relative(ARENA_ROOT, ENGINES_DIR)),
    },
  );
  if (build.code !== 0)
    throw new Error("could not build the current version from main");
  mkdirSync(resolve(ARENA_HOME, "bin"), { recursive: true });
  copyFileSync(resolve(target, "release", crate(trackId)), bin);
  writeFileSync(`${bin}.key`, key);
  await git(["worktree", "remove", "--force", dir]);
  return arenaEngine(label, bin, trackId, MOVE_MS);
};

/**
 * Get a session ready in one step: reference engines, a warm cargo build (native, tests and
 * wasm) and cached main binaries. Run by the environment's setup script, so it lands in the
 * container snapshot; when an agent runs it again it finishes in seconds.
 */
export const prepare = async () => {
  const step = async (
    name: string,
    cmd: string,
    args: string[],
    cwd = ENGINES_DIR,
  ) => {
    const t0 = Date.now();
    const r = await run(cmd, args, { cwd });
    log(
      `${r.code === 0 ? "ok  " : "FAIL"} ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
    );
    if (r.code !== 0)
      log((r.stderr || r.stdout).trim().split("\n").slice(-8).join("\n"));
    return r.code === 0;
  };
  await syncWithMain();
  const missing = missingWorkspaceDeps();
  let ok = missing.length
    ? await step(
        `npm install (missing ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ", …" : ""})`,
        "npm",
        ["install", "--no-audit", "--no-fund"],
        ARENA_ROOT,
      )
    : true;
  // The site imports swarm-graph as source; typecheck it so a reviewer's `tsc -p web` is trustworthy.
  ok =
    (await step(
      "tsc swarm-graph (the site's workspace package)",
      process.execPath,
      [
        resolve(ARENA_ROOT, "node_modules/typescript/bin/tsc"),
        "--noEmit",
        "-p",
        "swarm-graph",
      ],
      ARENA_ROOT,
    )) && ok;
  ok =
    (await step(
      "reference engines",
      "bash",
      [resolve(ARENA_ROOT, "scripts/install-references.sh")],
      ARENA_ROOT,
    )) && ok;
  ok =
    (await step("cargo build (release)", "cargo", [
      "build",
      "--release",
      "--workspace",
    ])) && ok;
  ok =
    (await step("cargo test (compile only)", "cargo", [
      "test",
      "--release",
      "--workspace",
      "--no-run",
    ])) && ok;
  ok =
    (await step("cargo build (wasm32-wasip1)", "cargo", [
      "build",
      "--release",
      "--target",
      "wasm32-wasip1",
      "--workspace",
    ])) && ok;
  // When this checkout is main, its fresh release binaries are main's: cache them for self-play.
  mkdirSync(resolve(ARENA_HOME, "bin"), { recursive: true });
  for (const trackId of Object.keys(GAMES) as Task["track_id"][]) {
    const { bin, key, ok: cached } = await cachedMain(trackId);
    if (cached) continue;
    if ((await mainKey(trackId, "HEAD")) !== key) continue;
    const built = resolve(ENGINES_DIR, "target", "release", crate(trackId));
    if (!existsSync(built)) continue;
    copyFileSync(built, bin);
    writeFileSync(`${bin}.key`, key);
  }
  log(ok ? "ready" : "prepared with failures (see above)");
  return ok;
};

/**
 * A submit with no verdict. Either the referee aborted a match because the reference kept failing
 * (#164), which measured the reference's process, not the candidate; or the gate's sequential
 * test reached its game cap undecided (#195), which says the change is too close to main to tell
 * at that cost. Neither is a burial: the engine code stays on the branch, no lesson pull request
 * is opened, the task keeps its claim and status, and no rating is written. The worker may
 * resubmit (fresh openings), strengthen the change first, or release the task.
 */
export const inconclusive = async (
  task: Pick<Task, "id" | "track_id" | "title"> & {
    issue?: number | null;
  },
  aborted: Pick<MatchAborted, "matchId" | "reason">,
  kind: "reference" | "undecided" = "reference",
) => {
  // The claim outlives this session: a later one resumes it under the same agent id (#177).
  const holder = task.issue
    ? claimHolder(await issueComments(task.issue).catch(() => []))
    : null;
  const agentId = holder ?? "<the agent id that claimed it>";
  const resume = task.issue
    ? ` If this session ends first, a new one resumes the claim with \`npm run arena -- next --role worker ${task.track_id} --issue ${task.issue} --agent-id ${agentId}\`, then resubmits.`
    : "";
  const cause =
    kind === "reference"
      ? `reference failure (${aborted.reason})`
      : `the sequential test against main reached its cap undecided (${aborted.reason})`;
  const next =
    kind === "reference"
      ? `resubmit with \`npm run arena -- submit ${task.id}\``
      : `resubmit with \`npm run arena -- submit ${task.id}\` (fresh openings), strengthen the change first, or release the task; an inconclusive idea is not a failed one`;
  const why = `inconclusive: ${cause}. No verdict: the engine change stays on the branch and the task keeps its claim; ${next}.${resume}`;
  await progress(
    task,
    "referee",
    kind === "reference"
      ? "Inconclusive: reference failure, not a burial."
      : "Inconclusive: too close to main to decide at the cap, not a burial.",
    why,
    aborted.matchId,
  ).catch(() => undefined);
  log(`inconclusive: ${task.title} (${aborted.reason})`);
  return {
    shipped: false as const,
    inconclusive: true as const,
    why,
    matchId: aborted.matchId,
  };
};

/**
 * Referee a finished task: build gate, legality smoke test, gate match against the next
 * uncleared rung, then open the pull request (main merged in) or bury with the measured reason.
 */
export const submit = async (taskId: string) => {
  const db = getStore();
  const [task] = await db.select<Task>("tasks", { id: taskId, run_id: RUN_ID });
  if (!task || !["claimed", "review"].includes(task.status))
    throw new Error(`task ${taskId} is not claimed or in review`);
  const seatId = task.claimed_by ?? "referee";
  const closes = task.issue ? `Closes #${task.issue}` : "";
  const crateDir = resolve(ENGINES_DIR, task.track_id);

  const bury = async (why: string, matchId: string | null = null) => {
    // The engine change is discarded; the playbook keeps the lesson, delivered as its own PR.
    await git([
      "checkout",
      "origin/main",
      "--",
      relative(ARENA_ROOT, crateDir),
    ]);
    await git(["clean", "-fdq", "--", relative(ARENA_ROOT, crateDir)]);
    // A browser build written for delivery goes back too: the lesson PR ships no engine.
    for (const p of wasmPaths(task.track_id))
      await git(["checkout", "origin/main", "--", relative(ARENA_ROOT, p)]);
    logVerdict(task.track_id, task.title, `buried · ${task.title} · ${why}`);
    const evidence = logConcept(task, `buried: ${why}`);
    const lesson = await deliver(
      task,
      [playbook(task.track_id), ...(evidence ? [evidence] : [])],
      `docs(${task.track_id}): playbook lesson from “${task.title}”\n\nBuried: ${why}`,
      {
        title: `docs(${task.track_id}): lesson from “${task.title}”`,
        body: `${closes}\n\nThe referee buried this idea: ${why}\n\nOnly the playbook lesson is delivered; the engine change was discarded.\n\nArena task: \`${task.id}\``,
        labels: [
          "arena",
          "arena:lesson",
          `engine:${task.track_id}`,
          `type:${task.type}`,
        ],
      },
    ).catch(() => null);
    if (lesson)
      await db.update("tasks", { id: task.id }, { pr: lesson.number });
    await db.update(
      "tasks",
      { id: task.id },
      { status: "dead", closed_at: now() },
    );
    await post("patch_rejected", {
      track_id: task.track_id,
      agent_id: "referee",
      task_id: task.id,
      match_id: matchId,
      title: `Rejected: ${task.title}`,
      detail: why,
    });
    await post("idea_dead", {
      track_id: task.track_id,
      agent_id: "strategist",
      task_id: task.id,
      title: task.title,
      detail: why,
    });
    log(`buried: ${task.title} (${why})`);
    return { shipped: false as const, why };
  };

  try {
    await setAgent(seatId, { status: "working" });
    const breach = outsideHelp(crateDir);
    if (breach) return await bury(`Engines think alone: ${breach}`);
    await progress(
      task,
      "referee",
      "Submitted. No outside help found in the crate.",
    );
    const build = await run(
      "cargo",
      ["build", "--release", "-p", crate(task.track_id)],
      { cwd: ENGINES_DIR },
    );
    if (build.code !== 0) return await bury("Build failed.");
    const test = await run(
      "cargo",
      ["test", "--release", "-p", crate(task.track_id)],
      { cwd: ENGINES_DIR },
    );
    if (test.code !== 0) return await bury("Tests failed.");
    await progress(task, "referee", "Build and tests passed.");
    // The browser build is the sandbox: no sockets, no processes, one thread. It must compile.
    // Compile only: web/public/wasm is written once the version is delivered.
    const wasmOk = await buildWasm(task.track_id);
    if (!wasmOk) {
      return await bury(
        "The browser build (wasm32-wasip1) failed: engines must run sandboxed, single-threaded, with no network or processes.",
      );
    }
    await progress(
      task,
      "referee",
      "Browser build passed: it runs sandboxed, single-threaded.",
    );
    const bin = resolve(ARENA_HOME, "bin", task.id);
    mkdirSync(resolve(ARENA_HOME, "bin"), { recursive: true });
    copyFileSync(
      resolve(ENGINES_DIR, "target/release", crate(task.track_id)),
      bin,
    );

    const candidate = await arenaEngine(task.id, bin, task.track_id, MOVE_MS);
    const smoke = await runMatch({
      track: task.track_id,
      candidate,
      candidateVersion: "candidate",
      opponent: randomPlayer(1),
      opponentLabel: "Random mover",
      opponentElo: 0,
      pairs: 2,
      purpose: "calibration",
      taskId: task.id,
    });
    if (smoke.forfeits.length) {
      await candidate.close?.();
      return await bury(
        `Forfeited ${smoke.forfeits.length} of 4 smoke games: ${smoke.forfeits[0]}.`,
        smoke.matchId,
      );
    }

    await progress(
      task,
      "referee",
      "Smoke test passed: no illegal moves, no timeouts.",
    );
    const t = await track(task.track_id);
    const ladder = await rungs(task.track_id);
    const rung = gateRung(ladder, t.current_elo);
    const shipped = (
      await db.select<Task>("tasks", {
        run_id: RUN_ID,
        track_id: task.track_id,
        status: "landed",
      })
    ).length;
    const version = `v0.${shipped + 1}`;
    // Past the top of the ladder there is no finish line: play the current version instead.
    const seed = Date.now() % 1e9;
    // Every gate match of this submit starts its pairs from the same seeded openings (balanced
    // suite entries, or random lines without a suite), so deterministic engines meet a different
    // position each pair and the run can be replayed.
    const openingSeed = newOpeningSeed();
    const prev = t.current_elo;
    const mainLabel = `${t.name} ${t.current_version ?? "current"}`;

    // The decision (#195): a sequential test on the head-to-head with the version on main, same
    // openings, colours swapped in each pair, played in this submit. It stops as soon as the
    // evidence is clear; reaching the cap undecided is inconclusive, not a burial. No stored
    // rating is a yardstick: it is the sample that won its own gate (the winner's curse).
    let decided: { line: string; matchId: string } | null = null;
    let h2hGate: Awaited<ReturnType<typeof runMatch>> | null = null;
    if (t.current_version) {
      const previous = await currentVersion(task.track_id, mainLabel);
      const h2h = await runMatch({
        track: task.track_id,
        candidate,
        candidateVersion: version,
        opponent: previous,
        opponentLabel: mainLabel,
        opponentElo: prev ?? 0,
        pairs: GATE_SPRT.maxPairs,
        referenceOpponent: false,
        purpose: "gate",
        taskId: task.id,
        openingSeed,
        stop: (ps) => sprtVerdict(ps) !== "continue",
      });
      await previous.close?.();
      const games = h2h.result.wins + h2h.result.draws + h2h.result.losses;
      const wld = `${h2h.result.wins}–${h2h.result.losses}–${h2h.result.draws}`;
      if (h2h.forfeits.length) {
        await candidate.close?.();
        return await bury(
          `Forfeited ${h2h.forfeits.length} games against ${t.current_version}.`,
          h2h.matchId,
        );
      }
      const state = sprtState(h2h.pairScores);
      const verdict = sprtVerdict(h2h.pairScores);
      const line = `${version} vs ${mainLabel} (main): ${wld} (W–L–D) over ${games} games, openings from seed \`${openingSeed}\`; sequential test: ${describeSprt(state)}. Games: https://swarm-arena-race.vercel.app/matches/${h2h.matchId}`;
      await progress(
        task,
        "referee",
        `Head to head with ${t.current_version}: ${verdict === "pass" ? "decided gain" : verdict === "fail" ? "decided no gain" : "inconclusive at the cap"} (${wld} W–L–D).`,
        describeSprt(state),
        h2h.matchId,
      );
      if (verdict === "fail") {
        await candidate.close?.();
        return await bury(
          gateShortfall({ verdict, state, currentVersion: t.current_version })!,
          h2h.matchId,
        );
      }
      if (verdict !== "pass") {
        await candidate.close?.();
        return await inconclusive(
          task,
          { matchId: h2h.matchId, reason: describeSprt(state) },
          "undecided",
        );
      }
      decided = { line, matchId: h2h.matchId };
      if (!rung) h2hGate = h2h;
    }

    // The rating: against the first uncleared rung, for the curve and for clearing rungs. It is
    // reported, not compared. Past the top of the ladder the head-to-head above is the gate match.
    if (!rung && !h2hGate)
      throw new Error("no rung to rate against and no version on main");
    const opponent = rung
      ? await reference(rung.opponent, task.track_id, MOVE_MS, seed)
      : null;
    const gate =
      h2hGate ??
      (await runMatch({
        track: task.track_id,
        candidate,
        candidateVersion: version,
        opponent: opponent!,
        opponentLabel: rung!.label,
        opponentElo: rung!.elo,
        pairs: GATE_PAIRS,
        referenceOpponent: true,
        purpose: "gate",
        taskId: task.id,
        openingSeed,
      }));
    await opponent?.close?.();
    await candidate.close?.();
    if (gate.forfeits.length) {
      return await bury(
        `Forfeited ${gate.forfeits.length} gate games.`,
        gate.matchId,
      );
    }
    // The stored rating may come from an easier rung than the candidate just played. For the
    // curve to compare like with like, main (built from main) is rated on the same rung with the
    // same openings. Reported only: the head-to-head above decided.
    let sameRung: Rating | null = null;
    let sameRungMatch: string | null = null;
    if (rung && t.current_version && needsRungBaseline(rung.elo, prev)) {
      const main = await currentVersion(task.track_id, mainLabel);
      const yardstick = await reference(
        rung.opponent,
        task.track_id,
        MOVE_MS,
        seed,
      );
      const baseline = await runMatch({
        track: task.track_id,
        candidate: main,
        candidateVersion: t.current_version,
        opponent: yardstick,
        opponentLabel: rung.label,
        opponentElo: rung.elo,
        pairs: GATE_PAIRS,
        purpose: "gate",
        taskId: task.id,
        openingSeed,
      });
      await yardstick.close?.();
      await main.close?.();
      sameRung = { elo: baseline.est.elo, error: baseline.est.error };
      sameRungMatch = baseline.matchId;
      await progress(
        task,
        "referee",
        `${t.current_version} re-rated on ${rung.label}: ${Math.round(sameRung.elo)} ± ${Math.round(sameRung.error)} (its stored ${Math.round(prev ?? 0)} came from another rung).`,
        undefined,
        baseline.matchId,
      );
    }
    const headToHead = decided
      ? decided.line
      : "none: no version on main yet, so the rating gate alone applies (a first version always passes).";

    // Deliver: the crate, its playbook and the browser build go to review as one pull request.
    const yard = sameRung ? sameRung.elo : prev;
    const delta =
      yard === null
        ? "first rated version"
        : `${gate.est.elo - yard >= 0 ? "+" : ""}${Math.round(gate.est.elo - yard)}${sameRung ? ` vs ${t.current_version} on the same rung` : ""}`;
    logVerdict(
      task.track_id,
      task.title,
      `${version} passed the referee · ${task.title} · rated ${Math.round(gate.est.elo)} (${delta})`,
    );
    const evidence = logConcept(
      task,
      `${version} rated ${Math.round(gate.est.elo)} (${delta})`,
    );
    const wasm = await buildWasm(task.track_id, {
      version,
      elo: Math.round(gate.est.elo),
    });
    const result = {
      version,
      elo: Math.round(gate.est.elo),
      error: Math.round(gate.est.error),
      prev,
      delta,
      matchId: gate.matchId,
      // The version being replaced, re-rated on this rung: on landing it goes on the curve too,
      // so the curve compares like with like instead of keeping a rating from an easier rung.
      baseline:
        sameRung && sameRungMatch && t.current_version
          ? {
              version: t.current_version,
              elo: Math.round(sameRung.elo),
              error: Math.round(sameRung.error),
              matchId: sameRungMatch,
            }
          : null,
      score: {
        wins: gate.result.wins,
        draws: gate.result.draws,
        losses: gate.result.losses,
      },
      opponent: rung ? rung.label : `${t.name} ${t.current_version}`,
    };
    const pull = await deliver(
      task,
      [
        crateDir,
        resolve(ENGINES_DIR, "Cargo.lock"),
        playbook(task.track_id),
        ...(evidence ? [evidence] : []),
        ...(wasm ? wasmPaths(task.track_id) : []),
      ],
      `feat(${task.track_id}): ${task.title}\n\nArena ${version}, rated ${Math.round(gate.est.elo)} (${delta}).`,
      {
        title: `feat(${task.track_id}): ${task.title}`,
        body: `${closes}

## Referee
- Decision (head-to-head with main, sequential test): ${headToHead}
- Rating (reported, not compared): ${version} vs ${result.opponent}: ${gate.result.wins}–${gate.result.losses}–${gate.result.draws}, rated **${result.elo} ± ${result.error}** (${delta}).${sameRung ? `\n- Yardstick: ${t.current_version}'s stored ${Math.round(prev ?? 0)} came from another rung, so main was re-rated vs ${result.opponent}: **${Math.round(sameRung.elo)} ± ${Math.round(sameRung.error)}**.` : ""}
- Checks passed: no outside help, build and tests, browser build (wasm32-wasip1), smoke test, sequential head-to-head with the version on main.
- Games: https://swarm-arena-race.vercel.app/matches/${gate.matchId}
- Openings: ${openingsNote(task.track_id, gate.result, openingSeed)}

## For the reviewer
Judge the change against the issue and the arena rules: original search and evaluation (nothing ported from open-source engines), one thread, no network or processes, tests for anything that could make an illegal move, playbook updated truthfully.

Arena task: \`${task.id}\``,
        labels: [
          "arena",
          "arena:referee-passed",
          `engine:${task.track_id}`,
          `type:${task.type}`,
        ],
      },
    );
    if (!pull) {
      unlogVerdict(task.track_id);
      return await bury(
        "Passed the referee, but the branch could not be pushed.",
        gate.matchId,
      );
    }
    await db.update(
      "tasks",
      { id: task.id },
      { status: "review", pr: pull.number, result },
    );
    await progress(
      task,
      "referee",
      `Passed. Pull request #${pull.number} opened for an independent review.`,
      `${version} rated ${result.elo} ± ${result.error} (${delta}). It lands when a reviewer approves and a merger merges.`,
      gate.matchId,
    );
    await setAgent(seatId, {
      pr: pull.number,
      activity: `Waiting for review on #${pull.number}`,
    });
    log(
      `${task.track_id} ${version} passed at ${result.elo}: ${pull.html_url}`,
    );
    return {
      shipped: false as const,
      review: pull.number,
      version,
      elo: result.elo,
    };
  } catch (e) {
    // A reference that kept failing is not the candidate's fault: no burial (#164).
    if (isMatchAborted(e)) return await inconclusive(task, e);
    return await bury(`Referee error: ${String(e).slice(0, 160)}`);
  } finally {
    // An aborted match skips the engines' close(): nothing it started may outlive the submit, or
    // a hanging reference keeps `arena submit` from exiting (#164).
    const killed = killAll();
    if (killed)
      log(
        `stopped ${killed} engine process${killed > 1 ? "es" : ""} left running`,
      );
    // The seat stays working until its session's retro; only the clock moves here.
    await setAgent(seatId, {});
  }
};

type TaskResult = {
  version: string;
  elo: number;
  error: number;
  prev: number | null;
  delta: string;
  matchId: string;
  baseline?: {
    version: string;
    elo: number;
    error: number;
    matchId: string;
  } | null;
};

/**
 * After a merger merges a referee-passed pull request: the version becomes current, its rating
 * goes on the curve, and any rung it beat is cleared. The games were played at submit time.
 */
export const land = async (taskId: string, mergedBy = "merger") => {
  const db = getStore();
  const [task] = await db.select<Task>("tasks", { id: taskId, run_id: RUN_ID });
  if (!task) throw new Error(`no task ${taskId}`);
  if (task.status === "landed") return log(`${taskId} already landed`);
  const r = task.result as TaskResult | null;
  if (!r) throw new Error(`${taskId} has no referee result to land`);
  const t = await track(task.track_id);
  await db.update(
    "tasks",
    { id: task.id },
    { status: "landed", closed_at: now() },
  );
  await db.update(
    "tracks",
    { run_id: RUN_ID, id: task.track_id },
    { current_elo: r.elo, current_version: r.version },
  );
  if (r.baseline) {
    await db.insert("elo_points", {
      run_id: RUN_ID,
      track_id: task.track_id,
      at: now(),
      engine_version: r.baseline.version,
      elo: r.baseline.elo,
      elo_error: r.baseline.error,
      match_id: r.baseline.matchId,
    });
  }
  await db.insert("elo_points", {
    run_id: RUN_ID,
    track_id: task.track_id,
    at: now(),
    engine_version: r.version,
    elo: r.elo,
    elo_error: r.error,
    match_id: r.matchId,
  });
  await post("patch_landed", {
    track_id: task.track_id,
    agent_id: task.claimed_by ?? mergedBy,
    task_id: task.id,
    match_id: r.matchId,
    title: `${r.version} shipped: ${task.title}`,
    detail: `${r.prev === null ? "First rated version." : `${r.delta} over the previous version.`} Merged in #${task.pr} after an independent review.`,
  });
  for (const rung of await rungs(task.track_id)) {
    if (!rung.cleared_at && r.elo - r.error / 2 > rung.elo) {
      await db.update(
        "rungs",
        { id: rung.id },
        { cleared_at: now(), cleared_by_match: r.matchId },
      );
      await post("rung_cleared", {
        track_id: task.track_id,
        agent_id: "referee",
        match_id: r.matchId,
        title: `${t.name} cleared ${rung.label} (${rung.elo})`,
      });
    }
  }
  log(`landed ${task.track_id} ${r.version} at ${r.elo}`);
};
