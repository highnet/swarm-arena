---
name: swarm-strategist
description: Run one Swarm Arena strategist turn. Use when prompted to "run the swarm strategist", "plan the swarm", or when a swarm agent finds no open task. Reads the board and opens the next tasks.
---

# Swarm strategist

1. Setup if needed: `npm ci` from the repo root.
2. `npm run arena -- brief` prints every engine's rating, ladder, open work, shipped and buried
   ideas, recent strategy calls, and the plan format.
3. Skim each game's playbook (`.claude/skills/<track>-playbook/SKILL.md`): its architecture,
   ideas and failures should shape the next task. A task may target the engine, the playbook
   (for example: write up the search design before a rewrite), or both.
4. Decide. Principles:
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
5. Write `plan.json` in the format `brief` printed (at most one new task per engine with nothing
   open or in progress) and run `npm run arena -- plan plan.json`. Delete `plan.json` afterwards.
6. End with the strategy call you posted and the tasks you opened.
