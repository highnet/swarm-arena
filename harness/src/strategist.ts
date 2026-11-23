import {
  TASK_TYPES,
  TRACKS,
  type GameId,
  type Task,
  type TaskType,
} from "@arena/shared";
import {
  bumpSessions,
  now,
  post,
  records,
  rungs,
  setAgent,
  tasks,
  tracks,
} from "./board";
import { log, RUN_ID } from "./config";
import { getIssue, openIssue, prioLabel, REPO } from "./rallypoint";
import { getStore } from "./store";
import { boardDigest } from "./messages";

/**
 * The strategist is a Claude Code cloud session too: it runs `arena brief`, decides, writes a
 * plan file, and runs `arena plan <file>`. The harness validates and posts the plan.
 */

export type Plan = {
  update: { title: string; detail: string };
  tasks: {
    track: GameId;
    seat: string;
    type?: TaskType;
    concept?: string;
    title: string;
    spec: string;
    /** The issue's `prio:p<n>`: 0-9, "p3" or "prio:p3"; `prio:p2` when absent. */
    prio?: string | number;
    /** An issue this task waits on: opened with `status:blocked` and a `Blocked-By:` line. */
    blocked_by?: number;
  }[];
};

const TRACK_IDS = TRACKS.map((t) => t.id) as string[];

export const brief = async () => {
  await bumpSessions("strategist");
  const ts = await tracks();
  const all = await tasks();
  const recs = await records();
  const lines: string[] = [];
  for (const t of ts) {
    const ladder = await rungs(t.id);
    lines.push(
      `## ${t.name} (${t.id}): ${t.current_version ?? "no version"} at ${t.current_elo ?? "no rating"}`,
      `Ladder: ${ladder.map((r) => `${r.label} ${r.elo}${r.cleared_at ? " ✓" : ""}`).join(" → ")}`,
      `Open or in progress: ${
        all
          .filter(
            (k) =>
              k.track_id === t.id && ["open", "claimed"].includes(k.status),
          )
          .map((k) => k.title)
          .join("; ") || "none"
      }`,
      `Shipped: ${
        all
          .filter((k) => k.track_id === t.id && k.status === "landed")
          .map((k) => k.title)
          .join("; ") || "none"
      }`,
      `Buried: ${
        recs
          .filter((r) => r.track_id === t.id && r.kind === "idea_dead")
          .map((r) => `${r.title} (${r.detail})`)
          .join("; ") || "none"
      }`,
      "",
    );
  }
  const strategy = recs
    .filter((r) => r.kind === "strategy")
    .slice(-3)
    .map((r) => `- ${r.title}`)
    .join("\n");
  const board = await boardDigest(undefined, 15);
  return `Playbooks: ${TRACK_IDS.map((t) => `.claude/skills/${t}-playbook/SKILL.md`).join(", ")}

${lines.join("\n")}
Recent strategy:
${strategy || "- none"}

Discussion board (answer with: npm run arena -- comment <id> "..." --as strategist; mark a settled question with: npm run arena -- resolve <id> --as strategist --note "...")
${board || "- quiet"}

Write plan.json and run: npm run arena -- plan plan.json
{
  "update": { "title": "one-line decision", "detail": "one or two sentences of reasoning" },
  "tasks": [{ "track": "${TRACK_IDS.join("|")}", "seat": "e.g. chess/search", "type": "${TASK_TYPES.join("|")}", "concept": "the general idea, e.g. transposition table", "title": "...", "spec": "...", "prio": "p2", "blocked_by": 42 }]
}
prio is optional (p2 by default; p0/p1 only for something broken). blocked_by is optional: the
issue number this task waits on; it opens with status:blocked and comes back when that issue closes.
At most one new task per engine that has nothing open or in progress.
Concepts: the four games exist to find general ideas that make each engine better. Name the concept
each task tests, prefer porting a concept that already gained Elo in one game to the others, and
read the concepts skill (.claude/skills/concepts/SKILL.md) for what transferred and what did not.
Types: foundation (protocol, rules wiring, legality), search, evaluation, playout (MCTS policy),
time (clock management), speed (raw nodes per second), tuning (constants, weights), novel (an idea
no engine is known for), fix (a bug or forfeit), experiment (anything else).`;
};

const validate = (raw: unknown): Plan => {
  const p = raw as Plan;
  if (!p?.update?.title || typeof p.update.detail !== "string")
    throw new Error("plan.update needs title and detail");
  if (!Array.isArray(p.tasks)) throw new Error("plan.tasks must be an array");
  for (const t of p.tasks) {
    if (!TRACK_IDS.includes(t.track))
      throw new Error(`unknown track "${t.track}"`);
    if (!t.seat || !t.title || !t.spec)
      throw new Error("each task needs seat, title and spec");
    if (t.type && !TASK_TYPES.includes(t.type))
      throw new Error(`task type must be one of: ${TASK_TYPES.join(", ")}`);
    prioLabel(t.prio);
    if (
      t.blocked_by !== undefined &&
      !(Number.isInteger(t.blocked_by) && t.blocked_by > 0)
    )
      throw new Error("blocked_by is an issue number, e.g. 42");
  }
  return p;
};

export const applyPlan = async (raw: unknown) => {
  const plan = validate(raw);
  await setAgent("strategist", { status: "working" });
  await post("strategy", {
    agent_id: "strategist",
    title: plan.update.title,
    detail: plan.update.detail,
  });
  const busy = new Set(
    (await tasks())
      .filter((k) => ["open", "claimed", "review"].includes(k.status))
      .map((k) => k.track_id),
  );
  let opened = 0;
  for (const t of plan.tasks) {
    if (busy.has(t.track)) {
      log(`skipped [${t.track}] ${t.title}: that engine already has work`);
      continue;
    }
    busy.add(t.track);
    const id = `${RUN_ID}-${t.track}-${Date.now().toString(36)}`;
    await getStore().insert("tasks", {
      id,
      run_id: RUN_ID,
      track_id: t.track,
      type: t.type ?? "experiment",
      concept: t.concept?.trim().toLowerCase() || null,
      title: t.title,
      spec: t.spec,
      status: "open",
      claimed_by: null,
      created_at: now(),
      closed_at: null,
    });
    // Rallypoint: every task is a GitHub issue the worker claims atomically.
    const issue = await openIssue(
      {
        id,
        track_id: t.track,
        type: t.type ?? "experiment",
        title: t.title,
        spec: t.spec,
        concept: t.concept ?? null,
      },
      { prio: t.prio, blockedBy: t.blocked_by },
    ).catch((e) => {
      log(
        `issue for ${id} not opened yet (${String(e).slice(0, 120)}); the worker opens it on claim`,
      );
      return null;
    });
    if (issue) await getStore().update("tasks", { id }, { issue });
    await post("task_opened", {
      track_id: t.track,
      agent_id: "strategist",
      task_id: id,
      title: t.title,
      detail: t.spec,
      data: { seat: t.seat, issue, concept: t.concept ?? null },
    });
    log(
      `opened [${t.track}] ${t.title} (${id}) → ${issue ? `issue #${issue} https://github.com/${REPO}/issues/${issue}` : "no issue yet"}${t.blocked_by ? `, blocked by #${t.blocked_by}` : ""}`,
    );
    opened++;
  }
  await setAgent("strategist", { activity: `Opened ${opened} tasks` });
  return opened;
};

/** The engine an issue's `engine:<track>` label names, or null for a harness or site issue. */
export const issueTrack = (labels: { name: string }[]) =>
  (labels
    .map((l) => /^engine:(.+)$/.exec(l.name)?.[1])
    .find((t) => t && TRACK_IDS.includes(t)) as GameId | undefined) ?? null;

/**
 * Give an arena issue opened outside `arena plan` its `tasks` row, so `next`, `submit` and
 * `progress` can find it. Idempotent: an issue that already has a row returns it unchanged.
 */
export const adopt = async (number: number) => {
  const existing = (await tasks()).find((t) => t.issue === number);
  if (existing) return { task: existing, created: false };
  const issue = await getIssue(number);
  if (issue.pull_request) throw new Error(`#${number} is a pull request`);
  if (issue.state !== "open") throw new Error(`#${number} is closed`);
  const track = issueTrack(issue.labels);
  if (!track)
    throw new Error(
      `#${number} has no engine:<${TRACK_IDS.join("|")}> label, so it is not an arena task`,
    );
  const named = issue.labels
    .map((l) => /^type:(.+)$/.exec(l.name)?.[1])
    .find((t) => t && (TASK_TYPES as readonly string[]).includes(t));
  const type = (named ?? "experiment") as TaskType;
  const body = issue.body ?? "";
  const task = {
    id: `${RUN_ID}-${track}-${Date.now().toString(36)}`,
    run_id: RUN_ID,
    track_id: track,
    type,
    concept:
      /· concept `([^`]+)`/.exec(body)?.[1]?.trim().toLowerCase() ?? null,
    title: issue.title,
    spec: body || issue.title,
    issue: number,
    status: "open" as const,
    claimed_by: null,
    created_at: now(),
    closed_at: null,
  };
  await getStore().insert("tasks", task);
  await post("task_opened", {
    track_id: track,
    agent_id: "strategist",
    task_id: task.id,
    title: issue.title,
    detail: `Adopted from issue #${number}.`,
    data: { seat: `${track}/builder`, issue: number, concept: task.concept },
  });
  log(`adopted #${number} as [${track}] ${task.id}`);
  return { task: task as Task, created: true };
};
