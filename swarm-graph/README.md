# @rallypoint/swarm-graph

A live force graph of a Rallypoint swarm: which agents are working which sectors of the codebase,
the work items (issues) they hold, and how their effort flows into the integration branch.

Built here for the Swarm Arena fleet page, and kept free of the arena so it can ship with
Rallypoint as is. Nothing in `src/` imports React, Next.js, Tailwind or `@arena/*`.

## Layout

| File                | What it is                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/model.ts`      | Pure, deterministic. `buildSwarmGraph(input)` turns agents, work items and events into a graph.                      |
| `src/render.ts`     | Plain D3 on an SVG. `createSwarmGraph(el, options)` returns `{ update, anchor, replay, highlight, reset, destroy }`. |
| `src/model.test.ts` | `npm test -w swarm-graph`.                                                                                           |

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
  approved). Nodes pop when work reaches them, and a merge throws a burst of sparks with a
  `+N merged` tag. `totals.stages` gives every work item by stage for a progress bar.
- The number inside a sector is the host's `count` (`SwarmSector.count`: merged pull requests,
  landed versions, all-time), labelled under the sector's name with its recent part
  (`merged · 3 today`). It never comes from the events a view was given, so it does not move with a
  filter or a replay. A sector with no count shows no number.
- Dead nodes leave. With `buildSwarmGraph(input, { lifetimes: LIFETIMES.live, now })`, an agent
  that is not working leaves 10 minutes after its last activity, merged work an hour after it
  merged, and a branch nobody holds an hour after its last activity; sectors, the hub, issues and
  open pull requests stay. A node spends its last minutes `fading` (drawn 30% dimmer). The thresholds
  are one table, `LIFETIMES`. The renderer fades a leaving node out (opacity to 0, radius to 60%,
  label first, edges with it, over about 1.8 s, staggered) before it leaves the simulation, and a
  new node grows out of its parent and glides to its place (about 1.3 s, staggered); see
  `lifecycle.ts`. Both are instant with `reducedMotion`. `node scripts/lifecycle-check.mjs` checks
  them in Chromium.
- **View changes hold still.** `update(graph, { view: true })` says the same data is seen another
  way (the site's preset switch, whose `Everything` keeps dead nodes longer): the nodes both views
  show stay where they are while the others fade in or out, and go free once the layout settles.
  With `reducedMotion` the switch is static. `node scripts/view-check.mjs` checks it in Chromium.

## Using it

```ts
import { buildSwarmGraph, createSwarmGraph } from '@rallypoint/swarm-graph';

const view = createSwarmGraph(document.getElementById('swarm')!, {
  onSelect: (node) => console.log(node),
});
view.update(buildSwarmGraph(input)); // call again on every realtime push or poll
```

Events carry an optional host `sub` (what a filter keys on), a burst `group` (one match's games,
say, so a feed can show them as one updating line), an `outcome` and a `delta`; all pass through
to the flows. A host that filters which flows it draws passes `update(graph, { quiet: true })`
when only the filter changed, so newly visible history does not spark as news. `anchor(nodeId,
el)` pins an HTML element beside a node (outward, inside the canvas, following zoom and pan), for
badges the SVG should not draw.

Colours default to the host's CSS variables (`--fg`, `--line`, `--panel`, …) with fallbacks, and
can be overridden through `options.theme`. Honour `prefers-reduced-motion` by passing
`reducedMotion: true`.

## Moving it into Rallypoint

The only arena-specific code is the adapter (`web/lib/swarmGraph.ts`, Supabase snapshot →
`SwarmInput`, with the row mapping it shares with Realtime in `web/lib/swarmEvents.ts`) and the React mount (`web/components/arena/SwarmGraph.tsx`). To ship with
Rallypoint, move this directory as is. Then write one adapter to `SwarmInput` from Rallypoint's
own state: issues and their `status:*` labels, `rallypoint-claims/` and `rallypoint-sessions/`
refs, pull requests and their `review:*` labels, and the reports `report.mjs` writes. The arena's
adapter already derives stages from the same labels (`web/lib/github.ts` `stageOf`). Sectors can
default to the top-level directories each pull request touches.
