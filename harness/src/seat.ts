import { cpus, totalmem } from "node:os";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { outsideHelp } from "./rules";
import { buildWasm, wasmPaths } from "./wasm";
import { formatMessages, readMessages } from "./messages";
import { relative, resolve } from "node:path";
import { agentName, GAMES, randomPlayer, type Task } from "@arena/shared";
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
import { arenaEngine } from "./engine";
import { gateRung, runMatch } from "./match";
import { reference } from "./references";
import { getStore } from "./store";
import {
  claimIssue,
  ghApi,
  openIssue,
  REPO,
  sessionAgentId,
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

Message board (latest for this engine and engine-wide):
${formatMessages(await readMessages(task.track_id, 12)) || "- quiet"}

Log progress as you go: npm run arena -- progress ${task.id} "..."
When cargo build --release and cargo test pass in the crate, run:
  npm run arena -- submit ${task.id}
It measures the branch and opens the pull request (Closes #${task.issue ?? "?"}) for an independent reviewer.
If you cannot finish, run:
  npm run arena -- release ${task.id}`;
};

/** Claim the oldest open task on a track nobody else is working on. Returns the briefing. */
export const claimNext = async (onlyTrack?: string) => {
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
        (!onlyTrack || t.track_id === onlyTrack),
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

const playbook = (trackId: string) =>
  resolve(ARENA_ROOT, ".claude/skills", `${trackId}-playbook`, "SKILL.md");

/** The referee's one-line verdict at the end of the engine's playbook. */
const logVerdict = (trackId: string, line: string) => {
  const p = playbook(trackId);
  if (existsSync(p))
    appendFileSync(
      p,
      `- ${now().slice(0, 16).replace("T", " ")} UTC · ${line}\n`,
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
  let ok = await step(
    "reference engines",
    "bash",
    [resolve(ARENA_ROOT, "scripts/install-references.sh")],
    ARENA_ROOT,
  );
  await git(["fetch", "origin", "main"]);
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
    logVerdict(task.track_id, `buried · ${task.title} · ${why}`);
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
    const t0 = await track(task.track_id);
    const wasmOk = await buildWasm(task.track_id, {
      version: "candidate",
      elo: t0.current_elo,
    });
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
    const opponent = rung
      ? await reference(rung.opponent, task.track_id, MOVE_MS, Date.now() % 1e9)
      : await currentVersion(task.track_id, t.current_version ?? "current");
    const gate = await runMatch({
      track: task.track_id,
      candidate,
      candidateVersion: version,
      opponent,
      opponentLabel: rung ? rung.label : `${t.name} ${t.current_version}`,
      opponentElo: rung ? rung.elo : (t.current_elo ?? 0),
      pairs: GATE_PAIRS,
      purpose: "gate",
      taskId: task.id,
    });
    await opponent.close?.();

    const prev = t.current_elo;
    if (gate.forfeits.length) {
      await candidate.close?.();
      return await bury(
        `Forfeited ${gate.forfeits.length} gate games.`,
        gate.matchId,
      );
    }
    if (prev !== null && gate.est.elo <= prev) {
      await candidate.close?.();
      return await bury(
        `Rated ${Math.round(gate.est.elo)} ± ${Math.round(gate.est.error)}, not above ${Math.round(prev)}.`,
        gate.matchId,
      );
    }

    // Head to head with the version it would replace (built from main). A new version must not
    // lose to its predecessor, whatever the ladder says. Past the ladder this was the gate itself.
    if (rung && t.current_version) {
      const label = `${t.name} ${t.current_version}`;
      const previous = await currentVersion(task.track_id, label);
      const h2h = await runMatch({
        track: task.track_id,
        candidate,
        candidateVersion: version,
        opponent: previous,
        opponentLabel: label,
        opponentElo: prev ?? 0,
        pairs: Math.max(2, Math.round(GATE_PAIRS / 2)),
        purpose: "gate",
        taskId: task.id,
      });
      await previous.close?.();
      await candidate.close?.();
      const games = h2h.result.wins + h2h.result.draws + h2h.result.losses;
      if (h2h.forfeits.length)
        return await bury(
          `Forfeited ${h2h.forfeits.length} games against ${t.current_version}.`,
          h2h.matchId,
        );
      if (h2h.result.score < games / 2) {
        return await bury(
          `Rated higher on the ladder but lost to ${t.current_version} head to head (${h2h.result.wins}–${h2h.result.losses}–${h2h.result.draws}).`,
          h2h.matchId,
        );
      }
    } else {
      await candidate.close?.();
    }

    // Deliver: the crate, its playbook and the browser build go to review as one pull request.
    const delta =
      prev === null
        ? "first rated version"
        : `${gate.est.elo - prev >= 0 ? "+" : ""}${Math.round(gate.est.elo - prev)}`;
    logVerdict(
      task.track_id,
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
- Gate: ${version} vs ${result.opponent}: ${gate.result.wins}–${gate.result.losses}–${gate.result.draws}, rated **${result.elo} ± ${result.error}** (${delta}).
- Checks passed: no outside help, build and tests, browser build (wasm32-wasip1), smoke test, head-to-head with the version on main.
- Games: https://swarm-arena-race.vercel.app/matches/${gate.matchId}

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
    return await bury(`Referee error: ${String(e).slice(0, 160)}`);
  } finally {
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
