# @rallypoint/swarm-graph

A live force graph of a Rallypoint swarm: which agents are working which sectors of the codebase,
the work items (issues) they hold, and how their effort flows into the integration branch.

Built here for the Swarm Arena fleet page, and kept free of the arena so it can ship with
Rallypoint as is. Nothing in `src/` imports React, Next.js, Tailwind or `@arena/*`.

## Layout

| File                | What it is                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `src/model.ts`      | Pure, deterministic. `buildSwarmGraph(input)` turns agents, work items and events into a graph.   |
| `src/render.ts`     | Plain D3 on an SVG. `createSwarmGraph(el, options)` returns `{ update, replay, reset, destroy }`. |
| `src/model.test.ts` | `npm test -w swarm-graph`.                                                                        |

## Vocabulary

The input uses Rallypoint's own terms, so any repository running the protocol can feed it:

- **integrationBranch**: `config.json`'s `integrationBranch`, the trunk every branch forks from
  and merges back into.
- **sectors**: the parts of the codebase (paths in the integration branch) that work lands in.
  The host decides what a sector is: a directory, a package, an issue label.
- **agents**: one per seat, with its Rallypoint role (`.rallypoint/roles/`). An agent is
  `working` only while its session is live. Each agent also carries the work item and PR it is on.
- **workItems**: one per issue, carried through the protocol's stages: `backlog` / `held`
  (issue) → `claimed` (branch) → `review` / `changes` / `approved` (pull request) → `merged`,
  or `closed`. `rallypointBranch()` gives the same `agent/<issue>-<slug>` name `claim.mjs`
  prescribes.
- **events**: what agents log (`plan`, `claim`, `progress`, `review`, `merge`, `reject`,
  `milestone`, `protocol`).

## What the graph shows

It follows the protocol. **Nothing reaches the integration branch except a merge.**

- Sectors ring the integration branch. Each sector is sized by the effort logged in it.
- An open issue is a dashed node waiting outside its sector.
- A claim forks a branch (◇) from the integration branch's tip. The branch sits between the
  trunk and the sector it changes. The worker (or fixer) sits on its branch, streaming effort
  into its worktree.
- Once delivered, the branch becomes a pull request (▢), outlined by review state: in review,
  changes asked (warning), approved (good). Reviewers and the merger sit on the pull request
  they gate. The referee's gate matches spark into the branch they measure.
- A merge is the only flow into the integration branch. It travels from the branch into the
  trunk, then out to the sector whose paths it changed, where the work rests as landed.
- Faint dotted lines show every sector an agent has spent effort on. They light up when the
  agent is hovered.
- `replay()` plays the whole event history back, growing each sector from zero.
- Progress is drawn so it can be followed: a sector's ring fills with its merged work (solid) and
  work in flight (faint); an open branch or pull request's ring shows its stage (branch, in review,
  approved). Effort numbers count up, nodes pop when work reaches them, and a merge throws a burst
  of sparks with a `+N merged` tag. `totals.stages` gives every work item by stage for a progress bar.

## Using it

```ts
import { buildSwarmGraph, createSwarmGraph } from '@rallypoint/swarm-graph';

const view = createSwarmGraph(document.getElementById('swarm')!, {
  onSelect: (node) => console.log(node),
});
view.update(buildSwarmGraph(input)); // call again on every realtime push or poll
```

Colours default to the host's CSS variables (`--fg`, `--line`, `--panel`, …) with fallbacks, and
can be overridden through `options.theme`. Honour `prefers-reduced-motion` by passing
`reducedMotion: true`.

## Moving it into Rallypoint

The only arena-specific code is the adapter (`web/lib/swarmGraph.ts`, Supabase snapshot →
`SwarmInput`) and the React mount (`web/components/arena/SwarmGraph.tsx`). To ship with
Rallypoint, move this directory as is. Then write one adapter to `SwarmInput` from Rallypoint's
own state: issues and their `status:*` labels, `rallypoint-claims/` and `rallypoint-sessions/`
refs, pull requests and their `review:*` labels, and the reports `report.mjs` writes. The arena's
adapter already derives stages from the same labels (`web/lib/github.ts` `stageOf`). Sectors can
default to the top-level directories each pull request touches.
