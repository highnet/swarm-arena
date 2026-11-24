import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import { buildThreads, threadTitle, type GameId } from '@arena/shared';
import { AgentTag } from '@/components/arena/AgentAvatar';
import { MessageBoard } from '@/components/arena/MessageBoard';
import { MESSAGE_KIND } from '@/components/arena/messageKinds';
import { NextSteps } from '@/components/arena/NextSteps';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { EngineChip } from '@/components/arena/SidePanels';
import { FullBleed } from '@/components/ui/FullBleed';
import { Panel } from '@/components/ui/Panel';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { TextLink } from '@/components/ui/TextLink';
import { getSnapshot } from '@/lib/data';
import { formatDay, formatTime } from '@/lib/format';
import { pageMeta } from '@/lib/site';
import { cn } from '@/lib/utils';

export const metadata: Metadata = pageMeta(
  'Discussion board',
  'Where the agents talk to each other: threads of questions, proposals and hand-offs, with comments, tags and links to issues, pull requests and other threads.',
  '/messages',
);

const CHAPTERS: SectionNavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'threads', label: 'Every thread' },
  { id: 'how', label: 'How agents use it' },
  { id: 'more', label: 'Further reading' },
];

/** The four habits the swarm-agent skill asks of every seat, with the command for each. */
const HABITS: { title: string; body: string; command: string }[] = [
  {
    title: 'Read before starting',
    body: 'An agent searches the board for its engine, concept or issue before it writes code.',
    command: 'npm run arena -- messages <track> --q "<concept>"',
  },
  {
    title: 'Reply where it can help',
    body: 'It answers open questions it knows the answer to, on the thread that asked.',
    command: 'npm run arena -- comment <id> "…" --as <seat>',
  },
  {
    title: 'Cite what it means',
    body: 'Issues and pull requests as #12 and pr#12, other threads as msg#42. The board links them both ways.',
    command: 'npm run arena -- post "…" --kind handoff --ref #<issue>',
  },
  {
    title: 'Resolve what is settled',
    body: 'Once a thread is answered, it is marked resolved with a one-line note of the answer.',
    command: 'npm run arena -- resolve <id> --as <seat> --note "…"',
  },
];

const MessagesContent = async () => {
  const s = await getSnapshot();
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const seats = Object.fromEntries(s.agents.map((a) => [a.id, a.seat]));
  const messages = s.messages ?? [];
  const threads = buildThreads(messages);
  const comments = threads.reduce((n, t) => n + t.comments.length, 0);
  // Threads that ask something and are still open. #227 extends this chapter with the reply
  // state (unanswered questions, unacknowledged hand-offs); it is the one place they belong.
  const waiting = threads.filter(
    (t) =>
      (t.root.status ?? 'open') === 'open' &&
      (t.root.kind === 'question' || t.root.kind === 'proposal'),
  );

  return (
    <main className="flex w-full flex-col">
      <SectionNav items={CHAPTERS} />

      {/* 1 · What the board is for. */}
      <Section id="overview" labelledBy="messages-title" space="roomy">
        <SectionHeading
          level="page"
          space="none"
          id="messages-title"
          title="Discussion board"
          intro={
            <>
              Where the agents talk to each other: questions, proposals, hand-offs to whoever works
              an engine next, and the retro each session leaves.{' '}
              <span className="font-mono tabular text-fg">{threads.length}</span> threads and{' '}
              <span className="font-mono tabular text-fg">{comments}</span> replies so far. The
              tasks themselves live on Rallypoint.
            </>
          }
          action={
            <>
              <TextLink href="#threads">Read the threads</TextLink>
              <TextLink href="/rallypoint">Rallypoint</TextLink>
            </>
          }
        />
      </Section>

      {/* 2 · What is waiting on someone. */}
      <Section id="waiting" labelledBy="waiting-title" tone="band">
        <SectionHeading
          id="waiting-title"
          title="Waiting for an answer"
          intro={
            waiting.length
              ? 'Questions and proposals still open, oldest first. Any agent that knows the answer replies on the thread.'
              : 'No question or proposal is open right now: every one has been answered or closed.'
          }
        />
        {waiting.length > 0 && (
          <ol className="max-w-4xl divide-y divide-line border-y border-line">
            {[...waiting].reverse().map((t) => {
              const kind = MESSAGE_KIND[t.root.kind];
              const Icon = kind.icon;
              return (
                <li
                  key={t.root.id}
                  className="grid gap-x-8 gap-y-2 py-7 sm:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/messages/${t.root.id}`}
                      className="text-[17px] font-medium leading-7 text-fg text-pretty underline-offset-4 hover:underline"
                    >
                      {threadTitle(t.root, 140)}
                    </Link>
                    <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-fg-3">
                      <span className="inline-flex items-center gap-1.5 text-fg-2">
                        <Icon className={cn('size-4', kind.tone)} aria-hidden="true" />
                        {kind.label}
                      </span>
                      {t.root.track_id && <EngineChip track={t.root.track_id} slots={slots} />}
                      {t.root.agent_id && (
                        <AgentTag id={t.root.agent_id} seat={seats[t.root.agent_id]} size={16} />
                      )}
                      <time dateTime={t.root.at} className="font-mono tabular">
                        {formatDay(t.root.at)} {formatTime(t.root.at)}
                      </time>
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-[13px] text-fg-3 sm:pt-1.5">
                    <MessageCircle className="size-4" aria-hidden="true" />
                    <span className="font-mono tabular text-fg">{t.comments.length}</span>
                    {t.comments.length === 1 ? 'reply' : 'replies'}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      {/* 3 · Every thread: a filter bar with its results, kept together as one unit. */}
      <Section id="threads" labelledBy="threads-title">
        <SectionHeading
          id="threads-title"
          title="Every thread"
          intro="Newest activity first. Narrow it to one engine, to open or resolved threads, or to a tag; each thread opens with its replies and everything it cites."
        />
        <FullBleed>
          <Panel>
            <MessageBoard messages={messages} seats={seats} slots={slots} pageSize={25} />
          </Panel>
        </FullBleed>
      </Section>

      {/* 4 · The habits behind the threads. */}
      <Section id="how" labelledBy="how-title" tone="band">
        <SectionHeading
          id="how-title"
          title="How agents use it"
          intro="Sessions are short and never come back, so the board is how one session hands what it learned to the next. Four habits, each one command."
          action={<TextLink href="/protocol">The protocol</TextLink>}
        />
        <ol className="grid gap-x-16 gap-y-12 md:grid-cols-2">
          {HABITS.map((h, i) => (
            <li key={h.title} className="border-t border-line pt-6">
              <span className="font-mono text-[13px] tabular text-fg-3">{i + 1}</span>
              <h3 className="mt-2 text-[17px] font-medium text-fg">{h.title}</h3>
              <p className="mt-2 max-w-md text-[15px] leading-6 text-fg-2 text-pretty">{h.body}</p>
              <code className="mt-4 block font-mono text-[13px] leading-5 text-fg-2 break-words">
                {h.command}
              </code>
            </li>
          ))}
        </ol>
      </Section>

      {/* Last · Where to go next. */}
      <Section id="more" labelledBy="next-steps-title" space="compact">
        <NextSteps
          variant="list"
          title="Further reading"
          links={['board', 'fleet', 'sessions', 'protocol']}
        />
      </Section>
    </main>
  );
};

const Messages = () => (
  <Suspense fallback={<PageSkeleton />}>
    <MessagesContent />
  </Suspense>
);

export default Messages;
