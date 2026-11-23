---
name: swarm-strategist
description: Run one Swarm Arena strategist turn. Use when prompted to "run the swarm strategist", "plan the swarm", or when a swarm agent finds no open task. Reads the board and opens the next tasks.
---

# Swarm strategist

1. Setup if needed: `npm ci` from the repo root.
2. `npm run arena -- brief` prints every engine's rating, ladder, open work, shipped and buried
   ideas, recent strategy calls, and the plan format.
3. Decide. Principles:
   - An engine that cannot play legal moves yet needs its rules library wired to the protocol first.
   - Spend the next tasks where the gap to the next rung is largest, but keep every engine moving.
   - One task is one focused change a single session can finish and the gate match can measure.
   - Never reopen a buried idea unchanged; if you retry one, say what is different in the spec.
   - Search and evaluation must be original; rules may come from libraries.
4. Write `plan.json` in the format `brief` printed (at most one new task per engine with nothing
   open or in progress) and run `npm run arena -- plan plan.json`. Delete `plan.json` afterwards.
5. End with the strategy call you posted and the tasks you opened.
