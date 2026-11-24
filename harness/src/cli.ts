#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { resolve } from "node:path";
import {
  newOpeningSeed,
  performanceElo,
  pickOpenings,
  playMatch,
  GAMES,
  type GameId,
  type Task,
} from "@arena/shared";
import {
  ensureRun,
  setAgent,
  records,
  rungs,
  tasks,
  touchSessionSeats,
  tracks,
} from "./board";
import {
  ARENA_HOME,
  ENGINES_DIR,
  LIVE_MS,
  log,
  MOVE_MS,
  run,
  RUN_ID,
} from "./config";
import { liveHooks, liveStream } from "./live";
import { arenaEngine } from "./engine";
import { reference } from "./references";
import {
  formatThread,
  formatThreads,
  listThreads,
  postMessage,
  setThreadStatus,
} from "./messages";
import {
  currentVersion,
  land,
  prepare,
  progress,
  release,
  staleHarness,
  submit,
} from "./seat";
import {
  merge,
  metrics,
  next,
  retro,
  ROLES,
  verdict,
  type Role,
} from "./orchestrator";
import { pinAgentId } from "./rallypoint";
import { buildWasm } from "./wasm";
import { buildSuite, loadSuite, suiteName } from "./openings";
import { getStore } from "./store";
import { adopt, applyPlan, brief } from "./strategist";

const USAGE = `arena <command>

Agent sessions (run inside a Claude Code session on this repo):
  prepare                       sync a stale main to origin/main, workspace deps, reference engines,
                                warm builds, cached main binaries (seconds when warm)
  next [track] [--role R] [--pr N] [--issue N] [--agent-id ID] [--only R,R] [--allow-stale]
                                take this session's Rallypoint role (merger, fixer, reviewer, improver,
                                worker or planner) and print its brief; a worker claims an issue.
                                --role skips the picker (a conductor dispatched this session to one
                                target; it prints ROLE none if the target no longer needs it), --pr
                                names the pull request, --issue the issue a worker takes (an arena
                                issue is adopted; a harness or site issue gets a plain PR brief;
                                when --agent-id already holds its claim, the claim is resumed:
                                its branch is checked out with origin/main merged in),
                                --agent-id pins the id the lease was written under,
                                --only limits the picker (a builder or judge loop).
                                Exits 75 when this checkout lacks harness commits from origin/main
  adopt <issue>                 give an arena issue opened outside \`plan\` its task row (idempotent)
  verdict <pr> approve|request-changes "<note>"
                                reviewer: record one verdict through review.mjs
  merge <pr>                    merger: merge an approved PR and land its arena task
  land <task-id>                apply a merged task's measured result (merge does this)
  retro "<text>" --as <seat>    at the end of a session: what slowed you down, what should change
  metrics                       the protocol's own numbers: ship rate, time to close, burial reasons
  submit <task-id>              build, smoke test, gate match; open the PR, or bury with a lesson PR
  release <task-id>             put a claimed task back on the board
  progress <task-id> "<text>" [--detail "<more>"]
                                log a step on your task; it shows live on the task's page
Discussion board (threads, comments, tags, references):
  messages [track] [--tag T] [--status open|resolved|closed|all] [--ref R] [--q text] [--limit N]
                                list threads, newest activity first (engine-wide threads included)
  thread <id>                   read a thread: post, comments, references and backlinks
  post "<text>" --as <seat> [--title "..."] [--tags a,b] [--track T] [--ref R ...]
       [--kind note|question|proposal|handoff|decision] [--reply ID]
                                open a thread (or, with --reply, comment on a message)
  comment <id> "<text>" --as <seat> [--kind comment|answer|decision] [--ref R ...]
                                comment on a thread or on one of its comments
  resolve <id> --as <seat> [--note "..."] [--close | --reopen]
                                mark a thread answered/decided (--close: moot, --reopen: open again)
  References in any text are linked and indexed: msg#42 (thread or comment), #12, pr#12,
  issue#12 (GitHub). --ref adds one without writing it in the text.
  brief                         strategist: print the board and the plan format
  plan <plan.json>              strategist: post the strategy call and open tasks

Operator:
  init [label]                  create the run, engines and ladders (ARENA_RUN, default run-001)
  status                        engines, open tasks, last records
  set-password                  store a bcrypt hash of ARENA_PASSWORD; from then on every API write needs it
  calibrate <track> [--pairs N] rate each rung against the one below
  versus <track> [--pairs N] [--seed S] [--no-openings]
                                play the engine in this checkout against the version on main. Each
                                pair starts from its own seeded opening, as the referee's do (a fresh
                                seed unless --seed; quote it with the result). --no-openings starts
                                every game from the initial position
  wasm <track>                  rebuild the browser build of the engine on this checkout
  openings build <track> [--count N] [--seed S] [--strength X] [--samples K] [--jobs J] [--out file]
                                rebuild the track's balanced opening suite (shared/src/openings/<track>.txt):
                                random lines scored by the reference engine, near-even ones kept;
                                deterministic for a seed
  play <track> <a> <b> [--pairs N]
                                play references (e.g. stockfish-3, mcts-2000) or engine binaries

Store: Supabase when SUPABASE_URL is set (secret key via SUPABASE_SECRET_KEY or the network proxy), else ${ARENA_HOME}/store.json.`;

const flag = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};

const opt = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

/** Every value of a repeatable flag: --ref pr#3 --ref msg#4. */
const opts = (name: string) =>
  process.argv.flatMap((a, i) =>
    a === `--${name}` && process.argv[i + 1] ? [process.argv[i + 1]] : [],
  );

/** npm runs workspace scripts from harness/; resolve paths from where the caller stood. */
const fromCaller = (p: string) =>
  resolve(process.env.INIT_CWD ?? process.cwd(), p);

const mover = async (spec: string, game: GameId, seed: number) =>
  existsSync(fromCaller(spec))
    ? arenaEngine(spec, fromCaller(spec), game, MOVE_MS)
    : reference(spec, game, MOVE_MS, seed);

const main = async () => {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "init": {
      const created = await ensureRun(args[0] ?? `Run ${RUN_ID}`);
      log(
        created
          ? `created ${RUN_ID} in ${getStore().kind}`
          : `${RUN_ID} already exists`,
      );
      return;
    }
    case "set-password": {
      const password = process.env.ARENA_PASSWORD;
      if (!password)
        throw new Error("set ARENA_PASSWORD in the environment first");
      // pgcrypto verifies $2a$ bcrypt hashes; bcryptjs emits $2b$, which is the same algorithm.
      const hash = bcrypt.hashSync(password, 10).replace(/^\$2b\$/, "$2a$");
      const db = getStore();
      const existing = await db.select("arena_auth", { id: 1 });
      if (existing.length)
        await db.update(
          "arena_auth",
          { id: 1 },
          { password_hash: hash, set_at: new Date().toISOString() },
        );
      else await db.insert("arena_auth", { id: 1, password_hash: hash });
      log("arena password set: API writes now require it");
      return;
    }
    case "status": {
      for (const t of await tracks())
        log(
          `${t.name.padEnd(10)} ${t.current_version ?? "—"} ${t.current_elo ?? "—"}`,
        );
      for (const t of (await tasks()).filter((k) =>
        ["open", "claimed"].includes(k.status),
      ))
        log(`task ${t.status} [${t.track_id}] ${t.title} (${t.id})`);
      for (const r of (await records()).slice(-10))
        log(`${r.kind.padEnd(14)} ${r.title}`);
      return;
    }
    case "progress": {
      const [taskId, text] = args;
      if (!taskId || !text)
        throw new Error(
          'usage: progress <task-id> "<text>" [--detail "<more>"]',
        );
      const [task] = await getStore().select<Task>("tasks", {
        id: taskId,
        run_id: RUN_ID,
      });
      if (!task) throw new Error(`no task ${taskId}`);
      const i = args.indexOf("--detail");
      await progress(
        task,
        task.claimed_by ?? "referee",
        text.slice(0, 200),
        i > 0 ? (args[i + 1]?.slice(0, 600) ?? null) : null,
      );
      if (task.claimed_by)
        await setAgent(task.claimed_by, { activity: text.slice(0, 120) });
      log(`progress on ${taskId}: ${text}`);
      return;
    }
    case "prepare": {
      if (!(await prepare())) process.exitCode = 1;
      break;
    }
    case "next": {
      const opt = (name: string) => {
        const i = args.indexOf(`--${name}`);
        return i >= 0 ? args[i + 1] : undefined;
      };
      const role = opt("role");
      if (role && !(ROLES as readonly string[]).includes(role))
        throw new Error(`--role is one of ${ROLES.join(", ")}`);
      const agentId = opt("agent-id");
      if (agentId) pinAgentId(agentId);
      const pr = opt("pr");
      const issue = opt("issue");
      if (issue !== undefined && !(Number(issue) > 0))
        throw new Error("--issue takes an issue number");
      const only = opt("only")?.split(",") as Role[] | undefined;
      const bad = only?.find((r) => !(ROLES as readonly string[]).includes(r));
      if (bad) throw new Error(`--only takes ${ROLES.join(",")}; not ${bad}`);
      const track = args.find(
        (a, i) =>
          !a.startsWith("--") &&
          (!args[i - 1]?.startsWith("--") || args[i - 1] === "--allow-stale"),
      );
      // A session on a checkout missing harness commits from origin/main runs superseded
      // briefs and scripts: refuse with Rallypoint's stale-checkout code (freshness.mjs).
      const stale = args.includes("--allow-stale")
        ? null
        : await staleHarness();
      if (stale?.length) {
        console.error(
          `This checkout lacks ${stale.length} harness file change(s) on origin/main (${stale.slice(0, 3).join(", ")}${stale.length > 3 ? ", …" : ""}).
Run \`git checkout --detach origin/main\` (or \`npm run arena -- prepare\`, which does it on a clean main), then \`npm run arena -- next\` again.
--allow-stale skips this check.`,
        );
        process.exitCode = 75;
        return;
      }
      console.log(
        await next({
          role: role as Role | undefined,
          pr: pr ? Number(pr) : undefined,
          issue: issue ? Number(issue) : undefined,
          track,
          only,
        }),
      );
      return;
    }
    case "adopt": {
      const n = Number(args[0]);
      if (!(n > 0)) throw new Error("usage: adopt <issue>");
      const { task, created } = await adopt(n);
      console.log(
        created
          ? `Adopted #${n} as task ${task.id} [${task.track_id}, ${task.type}].`
          : `#${n} already has task ${task.id} (${task.status}).`,
      );
      return;
    }
    case "verdict": {
      const [pr, decision, ...note] = args;
      if (!pr || !decision || !note.length)
        throw new Error('usage: verdict <pr> approve|request-changes "<note>"');
      await verdict(Number(pr), decision, note.join(" "));
      return;
    }
    case "merge": {
      if (!args[0]) throw new Error("usage: merge <pr>");
      await merge(Number(args[0]));
      return;
    }
    case "land": {
      if (!args[0]) throw new Error("usage: land <task-id>");
      await land(args[0]);
      return;
    }
    case "retro": {
      const as = args.indexOf("--as");
      const seat = as >= 0 ? args[as + 1] : undefined;
      const body = args.filter((_, i) => i !== as && i !== as + 1).join(" ");
      if (!seat || !body)
        throw new Error(
          'usage: retro "<what slowed you down or should change>" --as <seat>',
        );
      await retro(seat, body);
      return;
    }
    case "metrics": {
      console.log(await metrics());
      return;
    }
    case "submit": {
      const result = await submit(args[0]);
      console.log(
        "review" in result
          ? `Passed: ${result.version} rated ${result.elo}. Pull request #${result.review} waits for an independent reviewer.`
          : "inconclusive" in result
            ? `Inconclusive: ${result.why}`
            : `Buried: ${result.why}`,
      );
      // Not a pass and not a burial: a script must not read it as either.
      if ("inconclusive" in result) process.exitCode = 3;
      return;
    }
    case "messages": {
      const track = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
      const threads = await listThreads({
        track,
        tag: opt("tag"),
        status: (opt("status") as never) ?? "all",
        ref: opt("ref"),
        q: opt("q"),
        limit: flag("limit", 20),
      });
      console.log(formatThreads(threads) || "No threads match.");
      return;
    }
    case "thread": {
      const id = Number(args[0]);
      if (!id) throw new Error("usage: thread <id>");
      console.log(await formatThread(id));
      return;
    }
    case "post":
    case "comment": {
      const seat = opt("as");
      if (!seat)
        throw new Error(`${cmd} needs --as <seat>, e.g. --as chess/search`);
      const replyTo =
        cmd === "comment"
          ? Number(args[0])
          : opt("reply")
            ? Number(opt("reply"))
            : null;
      if (cmd === "comment" && !replyTo)
        throw new Error('usage: comment <id> "<text>" --as <seat>');
      const { message, thread } = await postMessage({
        seat,
        body: (cmd === "comment" ? args[1] : args[0]) ?? "",
        kind: opt("kind"),
        title: opt("title"),
        tags: opt("tags"),
        refs: opts("ref"),
        track: (opt("track") as GameId | undefined) ?? null,
        replyTo,
      });
      console.log(
        message.reply_to
          ? `Commented msg#${message.id} on thread msg#${thread}.`
          : `Opened thread msg#${message.id}.`,
      );
      return;
    }
    case "resolve": {
      const seat = opt("as");
      const id = Number(args[0]);
      if (!seat || !id)
        throw new Error(
          'usage: resolve <id> --as <seat> [--note "..."] [--close | --reopen]',
        );
      const status = process.argv.includes("--reopen")
        ? "open"
        : process.argv.includes("--close")
          ? "closed"
          : "resolved";
      const root = await setThreadStatus({
        seat,
        id,
        status,
        note: opt("note"),
      });
      console.log(`Thread msg#${root} is ${status}.`);
      return;
    }
    case "release":
      return release(args[0]);
    case "brief":
      console.log(await brief());
      return;
    case "plan": {
      const opened = await applyPlan(
        JSON.parse(readFileSync(fromCaller(args[0]), "utf8")),
      );
      console.log(`Posted the strategy call and opened ${opened} task(s).`);
      return;
    }
    case "calibrate": {
      const game = args[0] as GameId;
      const ladder = await rungs(game);
      const pairs = flag("pairs", 10);
      for (let i = 1; i < ladder.length; i++) {
        const a = await reference(ladder[i].opponent, game, MOVE_MS, i);
        const b = await reference(
          ladder[i - 1].opponent,
          game,
          MOVE_MS,
          i + 100,
        );
        const res = await playMatch(GAMES[game], a, b, pairs, {
          moveTimeMs: 60_000,
        });
        const est = performanceElo([
          {
            opponentElo: ladder[i - 1].elo,
            score: res.score,
            games: pairs * 2,
          },
        ]);
        log(
          `${ladder[i].label}: ${res.wins}-${res.losses}-${res.draws} vs ${ladder[i - 1].label} → ${Math.round(est.elo)} ± ${Math.round(est.error)} (configured ${ladder[i].elo})`,
        );
        await a.close?.();
        await b.close?.();
      }
      log(
        "Update shared/src/tracks.ts with measured values before `init` for the next run.",
      );
      return;
    }
    case "versus": {
      const game = args[0] as GameId;
      const build = await run(
        "cargo",
        ["build", "--release", "-p", `${game}-engine`],
        { cwd: ENGINES_DIR },
      );
      if (build.code !== 0) throw new Error("build failed");
      const mine = await arenaEngine(
        "local",
        resolve(ENGINES_DIR, "target/release", `${game}-engine`),
        game,
        MOVE_MS,
      );
      const main = await currentVersion(game, "main");
      const pairs = flag("pairs", 5);
      // Seeded openings, drawn exactly as the referee draws them (runMatch): the balanced suite
      // when it has enough entries, otherwise #103's random lines. --no-openings: initial position.
      const openingSeed = process.argv.includes("--no-openings")
        ? undefined
        : opt("seed") !== undefined
          ? flag("seed", 0)
          : newOpeningSeed();
      if (openingSeed !== undefined && !Number.isInteger(openingSeed))
        throw new Error(`--seed must be an integer, got ${opt("seed")}`);
      const suite = openingSeed === undefined ? undefined : loadSuite(game);
      if (openingSeed === undefined) {
        log("openings: none (--no-openings), every game from the initial position");
      } else {
        const picked = pickOpenings(GAMES[game], pairs, openingSeed, { suite });
        log(
          `openings: seed ${openingSeed}, ${picked.source === "suite" ? `balanced suite ${suiteName(game)}` : "random lines"}`,
        );
        picked.openings.forEach((o, k) =>
          log(`pair ${k + 1}: ${o.join(" ") || "(initial position)"}`),
        );
      }
      // Every game streams to live_games like a referee match, so the fleet graph shows it (#163).
      const mainVersion =
        (await tracks().catch(() => [])).find((t) => t.id === game)
          ?.current_version ?? null;
      const streamed = liveHooks(
        liveStream(
          getStore(),
          {
            run_id: RUN_ID,
            match_id: null,
            track_id: game,
            candidate_version: "local",
            opponent: mainVersion ? `main ${mainVersion}` : "main",
          },
          { log, intervalMs: LIVE_MS },
        ),
        `${RUN_ID}-${game}-versus-${Date.now().toString(36)}`,
      );
      const res = await playMatch(GAMES[game], mine, main, pairs, {
        moveTimeMs: MOVE_MS + 300,
        openingSeed,
        openingSuite: suite,
        onGameStart: streamed.onGameStart,
        onMove: streamed.onMove,
        onVoid: streamed.onVoid,
        onGame: (g, i) => {
          streamed.onGame();
          log(
            `game ${i + 1} (pair ${Math.floor(i / 2) + 1}, local ${i % 2 === 0 ? "first" : "second"}): ${g.outcome} by ${g.termination} in ${g.moves.length} plies`,
          );
        },
      }).finally(streamed.done);
      log(
        `local vs main: +${res.wins} -${res.losses} =${res.draws}${openingSeed === undefined ? " (no openings)" : ` (seed ${openingSeed})`}`,
      );
      await mine.close?.();
      await main.close?.();
      return;
    }
    case "wasm": {
      const t = (await tracks()).find((k) => k.id === args[0]);
      const ok = await buildWasm(args[0], {
        version: t?.current_version ?? "local",
        elo: t?.current_elo ?? null,
      });
      log(ok ? `built web/public/wasm/${args[0]}.wasm` : "wasm build failed");
      return;
    }
    case "openings": {
      const [sub, game] = args as [string, GameId];
      if (sub !== "build" || !GAMES[game]) {
        console.log(USAGE);
        process.exitCode = 1;
        return;
      }
      const num = (name: string) => {
        const v = opt(name);
        return v === undefined ? undefined : Number(v);
      };
      const scratch = resolve(ARENA_HOME, "openings");
      mkdirSync(scratch, { recursive: true });
      await buildSuite(game, {
        count: flag("count", 200),
        seed: flag("seed", 1),
        strength: num("strength"),
        samples: num("samples"),
        jobs: num("jobs"),
        out: opt("out") ? fromCaller(opt("out")!) : undefined,
        scratch,
      });
      return;
    }
    case "play": {
      const [game, a, b] = args as [GameId, string, string];
      const pairs = flag("pairs", 5);
      const ma = await mover(a, game, 1);
      const mb = await mover(b, game, 2);
      const res = await playMatch(GAMES[game], ma, mb, pairs, {
        onGame: (g, i) =>
          log(
            `game ${i + 1}: ${g.outcome} by ${g.termination} in ${g.moves.length} plies`,
          ),
      });
      log(`${a} vs ${b}: +${res.wins} -${res.losses} =${res.draws}`);
      await ma.close?.();
      await mb.close?.();
      return;
    }
    default:
      console.log(USAGE);
      if (cmd && cmd !== "help") process.exitCode = 1;
  }
};

// Heartbeat (#205): any arena command keeps this session's seats live. Best effort: a read-only
// session (no ARENA_PASSWORD) or an offline store must not stop the command it came with.
await touchSessionSeats().catch(() => 0);
await main();
