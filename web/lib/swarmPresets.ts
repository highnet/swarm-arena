import type { SwarmFlow } from '@rallypoint/swarm-graph/model';

/**
 * Who the swarm graph's event feed is for. One table: each preset names its visitor and the
 * event subs it shows (see `TABLE_SUBS` in `swarmEvents.ts` for every sub a table produces, and
 * GitHub's `pr-*` / `issue-claimed`). A preset filters events and their animations, never the
 * nodes, so switching never re-lays the graph out. Adding a sub means choosing its presets here.
 */

export type SwarmPresetId = 'happening' | 'games' | 'ideas' | 'swarm' | 'all';

export type SwarmPreset = {
  id: SwarmPresetId;
  /** Short label for the switch. */
  label: string;
  /** Who it serves, for the switch's tooltip. */
  who: string;
  /** Subs shown; `null` shows every event. */
  subs: Set<string> | null;
  /** Step detail on the agent chips (the swarm preset); the others show role and target. */
  agentDetail: boolean;
  /** Wording a preset gives an event, when it words it differently from the event's own title. */
  word?: (flow: SwarmFlow) => string | null;
};

const LANDED = ['patch_landed', 'task-landed', 'pr-merged'];
const BURIED = ['idea_dead', 'task-dead', 'patch_rejected'];
const GATES = ['match-start', 'match', 'match_verdict'];
const RUNGS = ['rung', 'rung_cleared'];

export const PRESETS: SwarmPreset[] = [
  {
    id: 'happening',
    label: "What's happening",
    who: 'New here: only the big moments',
    subs: new Set([...LANDED, ...BURIED, ...RUNGS, ...GATES, 'rating']),
    agentDetail: false,
    word: (f) => {
      if (f.sub === 'rating' && f.delta !== null)
        return f.delta >= 0
          ? `${f.title.replace(/ rated .*/, '')} got stronger: +${f.delta}`
          : `${f.title.replace(/ rated .*/, '')} rated lower: ${f.delta}`;
      return null;
    },
  },
  {
    id: 'games',
    label: 'The games',
    who: 'Game fans: every game, match and rating',
    subs: new Set(['game', ...GATES, ...RUNGS, 'rating']),
    agentDetail: false,
  },
  {
    id: 'ideas',
    label: 'The ideas',
    who: 'Engine researchers: ideas tried, passed or buried',
    subs: new Set([
      'strategy',
      'task_opened',
      'task-opened',
      'concept-port',
      ...LANDED,
      ...BURIED,
      'match',
      'match_verdict',
      ...RUNGS,
      'rating',
    ]),
    agentDetail: false,
  },
  {
    id: 'swarm',
    label: 'The swarm',
    who: 'Swarm watchers: the agents at work',
    subs: new Set([
      'session-start',
      'session-step',
      'session-end',
      'task_claimed',
      'task-claimed',
      'issue-claimed',
      'task-review',
      'progress',
      'pr-opened',
      'pr-approved',
      'pr-changes',
      ...LANDED,
      'post',
      'protocol',
      'strategy',
    ]),
    agentDetail: true,
  },
  {
    id: 'all',
    label: 'Everything',
    who: 'Every event, bursts still grouped',
    subs: null,
    agentDetail: true,
  },
];

export const DEFAULT_PRESET: SwarmPresetId = 'happening';

export const presetOf = (id: string | null | undefined): SwarmPreset | null =>
  PRESETS.find((p) => p.id === id) ?? null;

export const showsFlow = (preset: SwarmPreset, flow: Pick<SwarmFlow, 'sub'>) =>
  !preset.subs || (flow.sub !== null && preset.subs.has(flow.sub));

/** The preset a visitor's previous page implies, if any. */
export const presetForPath = (path: string): SwarmPresetId | null => {
  if (/^\/(games|matches)(\/|$)/.test(path)) return 'games';
  if (/^\/fleet(\/|$)/.test(path) || /^\/(sessions|rallypoint)(\/|$)/.test(path)) return 'swarm';
  if (/^\/(concepts|versions|graveyard)(\/|$)/.test(path)) return 'ideas';
  return null;
};
