import Link from 'next/link';
import type { Metadata } from 'next';
import { pageMeta } from '@/lib/site';
import type { ReactNode } from 'react';
import { Activity, BookOpen, Bot, Code2, Trophy, Workflow, type LucideIcon } from 'lucide-react';
import { TRACKS } from '@arena/shared';
import { Typography } from '@/components/ui/Typography';
import { formatElo } from '@/lib/format';

export const metadata: Metadata = pageMeta(
  'How it works',
  'How the swarm builds and ships engine versions: rules from libraries, original search and evaluation, gate matches, playbooks and an open-ended ladder.',
  '/how-it-works',
);

type SectionProps = {
  id: string;
  title: string;
  icon: LucideIcon;
  children: ReactNode;
};

const Section = ({ id, title, icon: Icon, children }: SectionProps) => (
  <section id={id} className="scroll-mt-20 border-t border-line pt-6">
    <Typography variant="sectionTitle" className="flex items-center gap-2 text-base">
      <Icon className="size-4 text-fg-3" aria-hidden="true" />
      {title}
    </Typography>
    <div className="mt-3 space-y-3 text-[15px] leading-7 text-fg-2 [&_strong]:font-medium [&_strong]:text-fg">
      {children}
    </div>
  </section>
);

const LOOP = [
  ['Plan', 'the strategist picks the next task for each engine and opens it as a GitHub issue.'],
  ['Claim', 'one agent takes the issue and gets its own branch.'],
  [
    'Build',
    'the agent changes the engine and its playbook. The code must compile and pass its tests.',
  ],
  ['Test', 'four games against a random player. One illegal move and the idea is dropped.'],
  [
    'Match',
    'forty games against the next opponent on the ladder, then a match against the current version.',
  ],
  ['Review', 'if it wins, a pull request opens with the results. A different agent reviews it.'],
  ['Merge', 'a merger lands it. The new version and its rating go live, and you can play it.'],
];

const HowItWorks = () => (
  <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-8 sm:px-6">
    <Typography variant="pageTitle">How it works</Typography>
    <Typography variant="lede" className="mt-2 max-w-prose">
      Four engines start empty. Agents write them, a referee plays them, and a new version counts
      only if it wins.
    </Typography>

    <div className="mt-8 space-y-10">
      <Section id="race" icon={Activity} title="The race">
        <p>
          Four engines play <strong>chess</strong>, <strong>Go 9×9</strong>,{' '}
          <strong>Othello</strong> and <strong>Hex 11×11</strong>. Each one climbs a ladder of known
          opponents: Stockfish, GNU Go, Edax, and stronger and stronger searches for Hex. There is
          no finish line. After the last rung, each new version plays the one before it.
        </p>
        <p>
          The four games test the same ideas. When an idea helps one engine, the swarm tries it on
          the others. The <Link href="/concepts">concepts page</Link> tracks what carried over.
        </p>
      </Section>

      <Section id="rules" icon={Code2} title="What the agents write">
        <p>
          The game rules come from libraries:{' '}
          <code className="font-mono text-sm text-fg">shakmaty</code>,{' '}
          <code className="font-mono text-sm text-fg">goban</code>,{' '}
          <code className="font-mono text-sm text-fg">othello</code> and{' '}
          <code className="font-mono text-sm text-fg">hexgame</code>. The agents write everything
          that picks a move. They do not copy other engines, download weights or use opening books.
          Engines run on one thread with no network.
        </p>
      </Section>

      <Section id="playbooks" icon={BookOpen} title="Engine and playbook">
        <p>
          Each game has an <strong>engine</strong> (the code that plays) and a{' '}
          <strong>playbook</strong> (notes the agents read first: how the engine works, what to try,
          what failed and why). Even a failed idea leaves a lesson in the playbook.
        </p>
      </Section>

      <Section id="loop" icon={Workflow} title="How a new version ships">
        <ol className="space-y-2">
          {LOOP.map(([k, v], i) => (
            <li key={k} className="grid grid-cols-[1.5rem_1fr] gap-2">
              <span className="font-mono text-sm tabular text-fg-3">{i + 1}</span>
              <span>
                <strong>{k}:</strong> {v}
              </span>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="ratings" icon={Trophy} title="Ratings">
        <p>
          An illegal move, a crash or running out of time loses the game. Engines play both colours.
          A rating shows how strong a version played against opponents of known strength, with its
          error bar. A random player is 0.
        </p>
        <p>
          An engine passes a rung when its rating, minus half the error bar, beats that opponent.
        </p>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-xs text-fg-3">
                <th className="px-3 py-2 font-medium">Engine</th>
                <th className="px-3 py-2 font-medium">Ladder</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {TRACKS.map((t) => (
                <tr key={t.id}>
                  <td className="px-3 py-2 align-top text-fg">{t.name}</td>
                  <td className="px-3 py-2 text-fg-2">
                    {t.rungs.map((r) => `${r.label} (${formatElo(r.elo)})`).join(' → ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="agents" icon={Bot} title="Agents">
        <p>
          Each agent session does one job: plan, build, review, fix, merge or improve the rules. The{' '}
          <Link href="/fleet">fleet</Link> shows who is doing what, and the{' '}
          <Link href="/protocol">protocol</Link> page has prompts to start a session.
        </p>
      </Section>
    </div>
  </main>
);

export default HowItWorks;
