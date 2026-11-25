'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Check, Copy, Gavel, Hammer, Radar, Wrench, type LucideIcon } from 'lucide-react';
import type { GameId } from '@arena/shared';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Segmented';
import { Typography } from '@/components/ui/Typography';
import { SHORT_NAME, TRACK_ORDER } from '@/lib/tracks';
import { cn } from '@/lib/utils';

type Mode = 'conductor' | 'builder' | 'judge' | 'janitor';
type Pace = 'self' | '10m' | '20m' | '30m' | '60m';
type Focus = 'balanced' | 'finish' | 'novel' | 'port';
type Effort = 'default' | 'high';

const MODES: { id: Mode; label: string; icon: LucideIcon; blurb: string }[] = [
  {
    id: 'conductor',
    label: 'Conductor',
    icon: Radar,
    blurb:
      'End to end. Surveys the board each tick and starts one cloud session per role and target. Needs the remote-session tools.',
  },
  {
    id: 'builder',
    label: 'Builder',
    icon: Hammer,
    blurb:
      'No remote sessions? Run this and the judge in two sessions. Claims, fixes, plans and improves; never judges.',
  },
  {
    id: 'judge',
    label: 'Judge',
    icon: Gavel,
    blurb:
      'The builder’s other half: reviews and merges, never writes. Run it in a second session.',
  },
  {
    id: 'janitor',
    label: 'Janitor',
    icon: Wrench,
    blurb:
      'Alongside any of the others: repairs only the coordination state the report proves stale.',
  },
];

const PACES: { id: Pace; label: string }[] = [
  { id: 'self', label: 'Self-paced' },
  { id: '10m', label: '10m' },
  { id: '20m', label: '20m' },
  { id: '30m', label: '30m' },
  { id: '60m', label: '1h' },
];

const FOCUS: { id: Focus; label: string; line: string }[] = [
  { id: 'balanced', label: 'Balanced', line: '' },
  {
    id: 'finish',
    label: 'Finish first',
    line: 'Drain the queue before new work: no new workers while any pull request waits for a verdict or a merge.',
  },
  {
    id: 'novel',
    label: 'Experiments',
    line: 'Planners lean novel: at least half of new tasks test an idea no known engine uses, titled as experiments.',
  },
  {
    id: 'port',
    label: 'Port concepts',
    line: 'Planners port the concept with the best evidence in .claude/skills/concepts to every engine that has not tried it.',
  },
];

const BUDGETS = [0, 6, 12, 24] as const;

const DEFAULT_PACE: Record<Mode, Pace> = {
  conductor: 'self',
  builder: '20m',
  judge: '10m',
  janitor: '60m',
};

const ONLY: Record<'builder' | 'judge', string> = {
  builder: 'worker,fixer,planner,improver',
  judge: 'merger,reviewer',
};

type Settings = {
  mode: Mode;
  pace: Pace;
  engines: GameId[];
  concurrency: number;
  budget: number;
  focus: Focus;
  effort: Effort;
  notify: boolean;
};

const loopHead = (pace: Pace, skill?: string) =>
  ['/loop', pace === 'self' ? null : pace, skill].filter(Boolean).join(' ');

const engineScope = (engines: GameId[]) =>
  engines.length === TRACK_ORDER.length ? null : engines.join(', ');

/** Compose the prompt. Pure, so the code block is always exactly what gets copied. */
const buildPrompt = (s: Settings, repo: string) => {
  const lines: string[] = [];
  const scope = engineScope(s.engines);
  const escalate = `Escalate needs:human and unknown sources to me${s.notify ? ' with a push notification' : ''}; never work around them.`;
  const stop = (unit: string, then = 'what merged, what was buried and what is escalated') =>
    s.budget
      ? `Budget: stop the loop after ${s.budget} ${unit}, then summarise ${then}.`
      : 'Budget: run until I stop the loop.';

  if (s.mode === 'conductor') {
    lines.push(loopHead(s.pace, '/swarm-conductor'));
    lines.push(`Repository: ${repo} (main).`);
    lines.push('I am the operator and confirm every round in advance for this run.');
    lines.push(`- Concurrency: at most ${s.concurrency} dispatched sessions running at once.`);
    lines.push(
      scope
        ? `- Engines: dispatch workers on ${scope} only; every other role as usual.`
        : '- Engines: all four.',
    );
    lines.push(`- ${stop('dispatched sessions have ended')}`);
    const focus = FOCUS.find((f) => f.id === s.focus)!.line;
    if (focus) lines.push(`- Focus: ${focus}`);
    if (s.effort === 'high') lines.push('- Dispatched sessions run at high effort.');
    lines.push('- Dispatch only through separate sessions; subagents stay inside a role.');
    lines.push(`- ${escalate}`);
    return lines.join('\n');
  }

  if (s.mode === 'janitor') {
    lines.push(loopHead(s.pace));
    lines.push(`Repository: ${repo} (main).`);
    lines.push(
      'Act as the Rallypoint janitor (.rallypoint/roles/janitor.md). Take the janitor lease:',
    );
    lines.push('  node .rallypoint/scripts/lease.mjs --role janitor --agent-id janitor-loop');
    lines.push('Exit 2 means another janitor is running: stop this tick. Otherwise run');
    lines.push('  node .rallypoint/scripts/janitor-pass.mjs --agent-id janitor-loop');
    lines.push('release the lease, and report only what changed.');
    lines.push(`- ${stop('passes', 'what you repaired and what is escalated')}`);
    lines.push(`- ${escalate}`);
    return lines.join('\n');
  }

  const one = s.engines.length === 1 ? ` ${s.engines[0]}` : '';
  lines.push(loopHead(s.pace, '/swarm-agent'));
  lines.push(`Repository: ${repo} (main).`);
  lines.push(`Take your role with: npm run arena -- next --only ${ONLY[s.mode]}${one}`);
  if (s.mode === 'builder') {
    lines.push('Do that one role to the end. ROLE none means nothing to build this tick: stop.');
    if (scope && !one) lines.push(`- Engines: claim only on ${scope}; release anything else.`);
    const focus = FOCUS.find((f) => f.id === s.focus)!.line;
    if (focus) lines.push(`- Focus: ${focus}`);
    lines.push('- Use subagents for research and competing prototypes; only you push.');
  } else {
    lines.push('Do that one role. ROLE none means the queue is clear: stop.');
    lines.push('- Never review a pull request this session pushed to.');
    lines.push('- One subagent may re-check a diff against the arena rules; the verdict is yours.');
  }
  lines.push(`- ${stop('ticks')}`);
  lines.push(`- ${escalate}`);
  lines.push('- Leave a retro each tick you did real work.');
  return lines.join('\n');
};

type PromptLineProps = {
  line: string;
};

/** Colour each line by what it is: the command, a parameter, or plain instruction. */
const PromptLine = ({ line }: PromptLineProps) => {
  if (line.startsWith('/loop')) return <span className="font-medium text-fg">{line}</span>;
  const param = /^- ([A-Z][a-z]+): (.*)$/.exec(line);
  if (param)
    return (
      <>
        <span className="text-fg-3">- </span>
        <span className="text-good-text">{param[1]}:</span> {param[2]}
      </>
    );
  if (line.startsWith('  ')) return <span className="text-fg">{line}</span>;
  return <>{line}</>;
};

type FieldProps = {
  label: string;
  hint?: string;
  children: ReactNode;
};

const Field = ({ label, hint, children }: FieldProps) => (
  <div>
    <div className="flex items-baseline justify-between gap-2">
      <Typography variant="label" as="h3">
        {label}
      </Typography>
      {hint && <span className="text-xs text-fg-3">{hint}</span>}
    </div>
    <Segmented label={label} wrap className="mt-1.5">
      {children}
    </Segmented>
  </div>
);

type LoopBuilderProps = {
  repo: string;
};

/** Pick the parameters; the one code block below is the prompt to paste. */
const LoopBuilder = ({ repo }: LoopBuilderProps) => {
  const [mode, setMode] = useState<Mode>('conductor');
  const [pace, setPace] = useState<Pace>(DEFAULT_PACE.conductor);
  const [engines, setEngines] = useState<GameId[]>(TRACK_ORDER);
  const [concurrency, setConcurrency] = useState(4);
  const [budget, setBudget] = useState(0);
  const [focus, setFocus] = useState<Focus>('balanced');
  const [effort, setEffort] = useState<Effort>('default');
  const [notify, setNotify] = useState(true);
  const [copied, setCopied] = useState(false);

  const prompt = useMemo(
    () => buildPrompt({ mode, pace, engines, concurrency, budget, focus, effort, notify }, repo),
    [mode, pace, engines, concurrency, budget, focus, effort, notify, repo],
  );

  const pickMode = (m: Mode) => {
    setMode(m);
    setPace(DEFAULT_PACE[m]);
  };
  const toggleEngine = (g: GameId) =>
    setEngines((cur) =>
      cur.includes(g)
        ? cur.length === 1
          ? cur
          : cur.filter((x) => x !== g)
        : TRACK_ORDER.filter((x) => x === g || cur.includes(x)),
    );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked: the block is selectable.
    }
  };

  const active = MODES.find((m) => m.id === mode)!;
  const usesEngines = mode === 'conductor' || mode === 'builder';
  const usesFocus = mode === 'conductor' || mode === 'builder';
  const perTick = mode === 'conductor' ? `≤ ${concurrency} sessions at once` : 'one role per tick';
  const summary = [
    pace === 'self' ? 'paces itself' : `every ${pace === '60m' ? 'hour' : pace}`,
    perTick,
    budget ? `stops after ${budget}` : 'runs until stopped',
  ].join(' · ');

  return (
    <div className="grid gap-4 rounded-lg border border-line bg-panel p-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <div>
          <Typography variant="label" as="h3">
            Loop
          </Typography>
          <div role="group" aria-label="Loop" className="mt-1.5 grid grid-cols-2 gap-1.5">
            {MODES.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                variant="secondary"
                size="sm"
                aria-pressed={mode === id}
                onClick={() => pickMode(id)}
                className="justify-start aria-pressed:border-line-strong aria-pressed:bg-panel-raised"
              >
                <Icon className="size-3.5" aria-hidden="true" />
                {label}
              </Button>
            ))}
          </div>
          <p className="mt-2 text-xs text-fg-3 text-pretty">{active.blurb}</p>
        </div>

        <Field label="Pace" hint={pace === 'self' ? 'wakes sooner while work runs' : undefined}>
          {PACES.map((p) => (
            <Button
              key={p.id}
              variant="segment"
              size="xs"
              aria-pressed={pace === p.id}
              onClick={() => setPace(p.id)}
            >
              {p.label}
            </Button>
          ))}
        </Field>

        {usesEngines && (
          <Field
            label="Engines"
            hint={engines.length === 4 ? 'all four' : `${engines.length} of 4`}
          >
            {TRACK_ORDER.map((g) => (
              <Button
                key={g}
                variant="segment"
                size="xs"
                aria-pressed={engines.includes(g)}
                onClick={() => toggleEngine(g)}
              >
                {SHORT_NAME[g]}
              </Button>
            ))}
          </Field>
        )}

        {mode === 'conductor' && (
          <Field label="Sessions at once" hint="mergers first, workers last">
            {[1, 2, 3, 4, 6, 8].map((n) => (
              <Button
                key={n}
                variant="segment"
                size="xs"
                aria-pressed={concurrency === n}
                onClick={() => setConcurrency(n)}
                className="min-w-8 tabular"
              >
                {n}
              </Button>
            ))}
          </Field>
        )}

        <Field label="Budget" hint={mode === 'conductor' ? 'sessions' : 'ticks'}>
          {BUDGETS.map((b) => (
            <Button
              key={b}
              variant="segment"
              size="xs"
              aria-pressed={budget === b}
              onClick={() => setBudget(b)}
              className="tabular"
            >
              {b ? b : 'Unbounded'}
            </Button>
          ))}
        </Field>

        {usesFocus && (
          <Field label="Focus">
            {FOCUS.map((f) => (
              <Button
                key={f.id}
                variant="segment"
                size="xs"
                aria-pressed={focus === f.id}
                onClick={() => setFocus(f.id)}
              >
                {f.label}
              </Button>
            ))}
          </Field>
        )}

        <div className="flex flex-wrap gap-x-6 gap-y-4">
          {mode === 'conductor' && (
            <Field label="Session effort">
              {(['default', 'high'] as const).map((e) => (
                <Button
                  key={e}
                  variant="segment"
                  size="xs"
                  aria-pressed={effort === e}
                  onClick={() => setEffort(e)}
                  className="capitalize"
                >
                  {e}
                </Button>
              ))}
            </Field>
          )}
          <Field label="Escalations">
            <Button
              variant="segment"
              size="xs"
              aria-pressed={notify}
              onClick={() => setNotify(true)}
            >
              Notify me
            </Button>
            <Button
              variant="segment"
              size="xs"
              aria-pressed={!notify}
              onClick={() => setNotify(false)}
            >
              In the log
            </Button>
          </Field>
        </div>
      </div>

      <div className="flex min-w-0 flex-col">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate font-mono text-xs text-fg-3" aria-live="polite">
            {summary}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={copy}
            aria-label="Copy the loop prompt"
            className={cn(copied && 'border-good/40 text-good-text')}
          >
            {copied ? (
              <Check className="size-3.5" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <pre className="mt-2 flex-1 overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-line bg-bg px-4 py-3 font-mono text-[12.5px] leading-6 text-fg-2 select-all">
          <code>
            {prompt.split('\n').map((line, i) => (
              <span key={i} className="block">
                <PromptLine line={line} />
              </span>
            ))}
          </code>
        </pre>
        <p className="mt-2 max-w-prose text-xs text-fg-3">
          Paste into a Claude Code session on the repository. Stop the loop to stop the swarm;
          anything already dispatched finishes its one job. More in{' '}
          <code className="font-mono">docs/LOOPS.md</code>.
        </p>
      </div>
    </div>
  );
};

export { LoopBuilder };
