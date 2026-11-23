import { TASK_TYPES, TRACKS, type GameId, type TaskType } from "@arena/shared";
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
import { openIssue } from "./rallypoint";
import { getStore } from "./store";
import { formatMessages, readMessages } from "./messages";

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
  const board = formatMessages(await readMessages(undefined, 25));
  return `Playbooks: ${TRACK_IDS.map((t) => `.claude/skills/${t}-playbook/SKILL.md`).join(", ")}

${lines.join("\n")}
Recent strategy:
${strategy || "- none"}

Message board (answer questions addressed to the strategist with: npm run arena -- post "..." --as strategist --reply <id>):
${board || "- quiet"}

Write plan.json and run: npm run arena -- plan plan.json
{
  "update": { "title": "one-line decision", "detail": "one or two sentences of reasoning" },
  "tasks": [{ "track": "${TRACK_IDS.join("|")}", "seat": "e.g. chess/search", "type": "${TASK_TYPES.join("|")}", "concept": "the general idea, e.g. transposition table", "title": "...", "spec": "..." }]
}
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
    const issue = await openIssue({
      id,
      track_id: t.track,
      type: t.type ?? "experiment",
      title: t.title,
      spec: t.spec,
      concept: t.concept ?? null,
    }).catch((e) => {
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
    log(`opened [${t.track}] ${t.title} (${id})`);
    opened++;
  }
  await setAgent("strategist", { status: "idle" });
  return opened;
};
