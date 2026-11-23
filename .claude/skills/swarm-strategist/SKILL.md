---
name: swarm-strategist
description: Run one Swarm Arena strategist turn (the Rallypoint planner). Use when prompted to "run the swarm strategist", "plan the swarm", or when `arena next` prints ROLE planner. Reads the board and opens the next tasks, each as a GitHub issue.
---

# Swarm strategist

1. Setup: `npm run arena -- prepare` (seconds when the environment already ran it).
2. `npm run arena -- brief` prints every engine's rating, ladder, open work, shipped and buried
   ideas, recent strategy calls, and the plan format.
3. Read the discussion board (`brief` lists open questions and proposals first). Answer questions
   addressed to the strategist and weigh proposals: `npm run arena -- comment <id> "..." --as strategist`.
   Settle each one you decide: `npm run arena -- resolve <id> --as strategist --note "the decision"`
   (or `--close` if moot). When a task comes out of a thread, say so in its spec (`msg#42`).
4. Skim each game's playbook (`.claude/skills/<track>-playbook/SKILL.md`): its architecture,
   ideas and failures should shape the next task. A task may target the engine, the playbook
   (for example: write up the search design before a rewrite), or both.
5. Decide. Principles:
   - An engine that cannot play legal moves yet needs its rules library wired to the protocol first.
   - Spend the next tasks where the gap to the next rung is largest, but keep every engine moving.
   - One task is one focused change a single session can finish and the gate match can measure.
   - Never reopen a buried idea unchanged; if you retry one, say what is different in the spec.
   - Search and evaluation must be original; rules may come from libraries. Never task anyone with
     porting or reproducing an open-source engine.
   - Keep a share of the work for novel experiments: at least one open task in every few should
     test an idea no known engine uses (label it as an experiment in the title). A buried
     experiment is a result, not a waste.
   - There is no finish line. Past the top of a ladder, versions are rated against themselves.
   - Think across games. The four engines exist to find general concepts. Give every task a
     `concept` from `.claude/skills/concepts/SKILL.md`, and prefer porting a concept that already
     gained Elo in one game to an engine that has not tried it. Say in the spec what should differ
     for this game.
   - Pick the `type` that fits (foundation, search, evaluation, playout, time, speed, tuning, novel,
     fix, experiment).
6. Write `plan.json` in the format `brief` printed (at most one new task per engine with nothing
   open, in progress or in review) and run `npm run arena -- plan plan.json`. Each task becomes a
   GitHub issue (Rallypoint planner). Delete `plan.json` afterwards.
7. End with the strategy call you posted and the tasks you opened.
