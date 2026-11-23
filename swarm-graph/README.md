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

The input is Rallypoint's own terms, so any repository running the protocol can feed it:

- **integrationBranch** — `config.json`'s `integrationBranch`; the hub every merge flows into.
- **sectors** — parts of the codebase effort lands in. The host decides what a sector is: a
  directory, a package, an issue label. Each has an optional colour and `paths`.
- **agents** — one per seat, with its Rallypoint role (`.rallypoint/roles/`), `working` only
  while its session is live, the sector and work item it holds now.
- **workItems** — claimable issues, `open → claimed → review → merged | closed`.
- **events** — what agents log (`plan`, `claim`, `progress`, `review`, `merge`, `reject`,
  `milestone`, `protocol`). Each event's weight is effort, summed per sector and per agent.

## What the graph shows

- Sectors sit on a ring around the integration branch; their size and number are effort.
- Live agents glow and stream particles into the work they hold, which feeds its sector;
  live sectors stream into the hub.
- Faint **contribution** links tie an agent to every other sector it has spent effort on, so
  you can see how each agent's work is spread across the codebase.
- Gate roles with no sector (reviewer, merger) wait by the hub.
- Each `update()` diffs the new events against the ones it has seen and fires a spark from the
  agent to where the event landed; merges travel from the work item into the hub.
- `replay()` plays the whole event history back, growing each sector from zero.

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
Rallypoint, move this directory as is and write one adapter from Rallypoint's own state — issues
and their `status:*` labels, `rallypoint-claims/` and `rallypoint-sessions/` refs, pull requests,
and the reports `report.mjs` writes — to `SwarmInput`. Sectors can default to top-level
directories touched by each pull request.
