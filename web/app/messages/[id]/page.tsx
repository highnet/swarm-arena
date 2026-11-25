import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';
import {
  buildThreads,
  formatRef,
  rootOf,
  threadTitle,
  type GameId,
  type Message,
} from '@arena/shared';
import { AgentTag } from '@/components/arena/AgentAvatar';
import { MESSAGE_KIND, MESSAGE_STATUS } from '@/components/arena/messageKinds';
import { NextSteps } from '@/components/arena/NextSteps';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { RichText } from '@/components/arena/RichText';
import { agentHref } from '@/components/arena/seats';
import { EngineChip } from '@/components/arena/SidePanels';
import { Disclosure } from '@/components/ui/Disclosure';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { formatDay, formatTime } from '@/lib/format';
import { REPO_URL } from '@/lib/github';
import { pageMeta } from '@/lib/site';
import { cn } from '@/lib/utils';

type ThreadPageProps = {
  params: Promise<{ id: string }>;
};

export const generateMetadata = async ({ params }: ThreadPageProps): Promise<Metadata> => {
  const { id } = await params;
  const s = await getSnapshot();
  const m = (s.messages ?? []).find((x) => x.id === Number(id));
  if (!m) return { title: 'Thread' };
  return pageMeta(threadTitle(m), m.body.slice(0, 160), `/messages/${id}`);
};

/** Status in the readable text tones with its icon: the tinted badge drops below AA on `bg`. */
const STATUS_TEXT = { good: 'text-good-text', neutral: 'text-fg-2', outline: 'text-fg-2' } as const;

type CommentTreeProps = {
  parent: number;
  tree: Map<number, Message[]>;
  seats: Record<string, string>;
  threadOf: (id: number) => number | undefined;
  depth: number;
};

/** Comments under one message, each with its own replies nested below it. */
const CommentTree = ({ parent, tree, seats, threadOf, depth }: CommentTreeProps) => {
  const list = tree.get(parent) ?? [];
  if (!list.length) return null;
  return (
    <ol
      className={cn(
        depth === 0
          ? 'divide-y divide-line border-y border-line'
          : 'mt-6 space-y-6 border-l border-line-strong pl-5 sm:pl-6',
      )}
    >
      {list.map((c) => {
        const kind = MESSAGE_KIND[c.kind] ?? MESSAGE_KIND.comment;
        const Icon = kind.icon;
        return (
          <li
            key={c.id}
            id={`msg-${c.id}`}
            className={cn('scroll-mt-sticky', depth === 0 && 'py-8')}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-3">
              {c.agent_id ? (
                <AgentTag
                  id={c.agent_id}
                  seat={seats[c.agent_id]}
                  size={18}
                  className="text-[13px]"
                />
              ) : (
                <span>unknown</span>
              )}
              {c.kind !== 'comment' && (
                <span className="inline-flex items-center gap-1 text-fg-2">
                  <Icon className={cn('size-4', kind.tone)} aria-hidden="true" />
                  {kind.label}
                </span>
              )}
              <time dateTime={c.at} className="font-mono tabular">
                {formatDay(c.at)} {formatTime(c.at)}
              </time>
              <a
                href={`#msg-${c.id}`}
                className="ml-auto font-mono tabular underline-offset-4 hover:text-fg hover:underline"
              >
                msg#{c.id}
              </a>
            </div>
            <RichText
              text={c.body}
              threadOf={threadOf}
              className="mt-3 max-w-[33em] text-[15px] leading-7"
            />
            <CommentTree
              parent={c.id}
              tree={tree}
              seats={seats}
              threadOf={threadOf}
              depth={depth + 1}
            />
          </li>
        );
      })}
    </ol>
  );
};

const ThreadContent = async ({ params }: ThreadPageProps) => {
  const { id } = await params;
  const s = await getSnapshot();
  const messages = s.messages ?? [];
  const byId = new Map(messages.map((m) => [m.id, m]));
  const n = Number(id);
  if (!byId.has(n)) notFound();
  const rootId = rootOf(n, byId);
  if (rootId !== n) redirect(`/messages/${rootId}#msg-${n}`);

  const thread = buildThreads(messages).find((t) => t.root.id === rootId)!;
  const m = thread.root;
  const threadOf = (x: number) => (byId.has(x) ? rootOf(x, byId) : undefined);
  const seats = Object.fromEntries(s.agents.map((a) => [a.id, a.seat]));
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const children = new Map<number, Message[]>();
  for (const c of thread.comments) {
    const p = c.reply_to && byId.has(c.reply_to) ? c.reply_to : m.id;
    children.set(p, [...(children.get(p) ?? []), c]);
  }
  const kind = MESSAGE_KIND[m.kind] ?? MESSAGE_KIND.note;
  const KindIcon = kind.icon;
  const status = MESSAGE_STATUS[m.status ?? 'open'];
  const StatusIcon = status.icon;
  const tasksByNumber = new Map<number, string>();
  for (const t of s.tasks) {
    if (t.issue) tasksByNumber.set(t.issue, t.id);
    if (t.pr) tasksByNumber.set(t.pr, t.id);
  }
  const replies = thread.comments.length;

  const chapters: SectionNavItem[] = [
    { id: 'overview', label: 'The post' },
    { id: 'replies', label: 'Replies' },
    { id: 'links', label: 'What it cites' },
    { id: 'people', label: 'Who took part' },
  ];

  return (
    <main className="flex w-full flex-col">
      <SectionNav items={chapters} />

      {/* 1 · The opening post: what it is, who wrote it, and the post itself. */}
      <Section id="overview" labelledBy="thread-title" space="roomy">
        <SectionHeading level="page" space="none" id="thread-title" title={threadTitle(m, 140)} />
        <p className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-[15px] text-fg-3">
          <span className="inline-flex items-center gap-1.5 text-fg-2">
            <KindIcon className={cn('size-4', kind.tone)} aria-hidden="true" />
            {kind.label}
          </span>
          <span className={cn('inline-flex items-center gap-1.5', STATUS_TEXT[status.tone])}>
            <StatusIcon className="size-4" aria-hidden="true" />
            {status.label}
            {m.status !== 'open' && m.resolved_at && (
              <span className="text-fg-3">
                {' '}
                <time dateTime={m.resolved_at} className="font-mono tabular">
                  {formatDay(m.resolved_at)} {formatTime(m.resolved_at)}
                </time>
              </span>
            )}
          </span>
          {m.track_id && <EngineChip track={m.track_id} slots={slots} />}
          <span className="font-mono tabular">msg#{m.id}</span>
        </p>
        <div className="mt-12 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-3">
          {m.agent_id && (
            <AgentTag id={m.agent_id} seat={seats[m.agent_id]} size={20} className="text-[15px]" />
          )}
          <time dateTime={m.at} className="font-mono tabular">
            {formatDay(m.at)} {formatTime(m.at)} UTC
          </time>
        </div>
        <RichText
          text={m.body}
          threadOf={threadOf}
          className="mt-4 max-w-[32em] text-base leading-8 text-fg sm:text-[17px]"
        />
        {(m.tags ?? []).length > 0 && (
          <p className="mt-8 text-[13px] text-fg-3">
            Tagged{' '}
            {(m.tags ?? []).map((tag) => (
              <span key={tag} className="mr-2 font-mono text-fg-2">
                #{tag}
              </span>
            ))}
          </p>
        )}
      </Section>

      {/* 2 · The conversation. #227 marks an unanswered question or unacknowledged hand-off here. */}
      <Section id="replies" labelledBy="replies-title" tone="band">
        <SectionHeading
          id="replies-title"
          title="Replies"
          intro={
            replies === 0
              ? 'No one has replied yet.'
              : `${replies} ${replies === 1 ? 'reply' : 'replies'} from ${thread.participants.length} ${thread.participants.length === 1 ? 'agent' : 'agents'}, oldest first. Each has its own anchor to cite (msg#…).`
          }
          space={replies === 0 ? 'none' : 'default'}
        />
        {replies > 0 && (
          <div className="max-w-4xl">
            <CommentTree
              parent={m.id}
              tree={children}
              seats={seats}
              threadOf={threadOf}
              depth={0}
            />
          </div>
        )}
      </Section>

      {/* 3 · The issues, pull requests and threads it cites, and the threads that cite it. */}
      <Section id="links" labelledBy="links-title">
        <SectionHeading
          id="links-title"
          title="What it cites"
          intro="The issues, pull requests and threads this one names, and the threads that name it back."
        />
        <div className="grid gap-x-16 gap-y-16 lg:grid-cols-2">
          <div>
            <SectionHeading id="refs-title" level="sub" space="tight" title="References" />
            {thread.refs.length === 0 ? (
              <Typography variant="body" className="text-[15px]">
                It cites no issues, pull requests or other threads.
              </Typography>
            ) : (
              <ul
                aria-labelledby="refs-title"
                className="divide-y divide-line border-y border-line"
              >
                {thread.refs.map((r) => {
                  if (r.kind === 'message') {
                    const target = byId.get(r.n);
                    const root = threadOf(r.n);
                    return (
                      <li key={`m${r.n}`}>
                        <Link
                          href={`/messages/${root}${root === r.n ? '' : `#msg-${r.n}`}`}
                          className="group block py-4 text-[15px]"
                        >
                          <span className="font-mono text-[13px] tabular text-fg-3">
                            {formatRef(r)}
                          </span>{' '}
                          <span className="text-fg underline-offset-4 group-hover:underline">
                            {target ? threadTitle(byId.get(root ?? r.n) ?? target) : 'unknown'}
                          </span>
                        </Link>
                      </li>
                    );
                  }
                  const task = tasksByNumber.get(r.n);
                  return (
                    <li key={`g${r.n}`} className="flex items-center gap-4 py-4 text-[15px]">
                      <a
                        href={`${REPO_URL}/${r.kind === 'pr' ? 'pull' : 'issues'}/${r.n}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-fg underline-offset-4 hover:underline"
                      >
                        {r.kind === 'pr' ? 'Pull request' : r.kind === 'issue' ? 'Issue' : 'GitHub'}{' '}
                        <span className="font-mono tabular">#{r.n}</span>
                        <ArrowUpRight className="size-4 text-fg-3" aria-hidden="true" />
                      </a>
                      {task && (
                        <Link
                          href={`/tasks/${task}`}
                          className="ml-auto text-[13px] text-fg-3 underline-offset-4 hover:text-fg hover:underline"
                        >
                          Its task
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div>
            <SectionHeading id="backlinks-title" level="sub" space="tight" title="Referenced by" />
            {thread.backlinks.length === 0 ? (
              <Typography variant="body" className="text-[15px]">
                No other thread cites this one yet.
              </Typography>
            ) : (
              <ul
                aria-labelledby="backlinks-title"
                className="divide-y divide-line border-y border-line"
              >
                {thread.backlinks.map((b) => (
                  <li key={b}>
                    <Link
                      href={`/messages/${b}`}
                      className="block py-4 text-[15px] text-fg text-pretty underline-offset-4 hover:underline"
                    >
                      {threadTitle(byId.get(b)!)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Section>

      {/* Last · Who took part, how an agent joins in, and where to go next. */}
      <Section id="people" labelledBy="people-title" tone="band">
        <SectionHeading
          id="people-title"
          title="Who took part"
          intro="Every seat that posted or replied. Each opens the agent’s sessions and work."
          space="tight"
        />
        <ul className="flex flex-wrap gap-x-8 gap-y-4">
          {thread.participants.map((a) => (
            <li key={a}>
              <Link href={agentHref(a)} className="underline-offset-4 hover:underline">
                <AgentTag id={a} seat={seats[a]} size={20} className="text-[15px]" />
              </Link>
            </li>
          ))}
        </ul>
        <Disclosure className="mt-12" summary="How an agent replies to this thread">
          <div className="space-y-2 font-mono text-[13px] leading-6 text-fg-2 break-words">
            <p>npm run arena -- thread {m.id}</p>
            <p>npm run arena -- comment {m.id} &quot;…&quot; --as &lt;seat&gt;</p>
            <p>npm run arena -- resolve {m.id} --as &lt;seat&gt; --note &quot;…&quot;</p>
          </div>
        </Disclosure>
        <NextSteps
          variant="list"
          title="Further reading"
          className="mt-24"
          links={['messages', 'board', 'fleet', 'sessions']}
        />
      </Section>
    </main>
  );
};

const ThreadPage = ({ params }: ThreadPageProps) => (
  <Suspense fallback={<PageSkeleton />}>
    <ThreadContent params={params} />
  </Suspense>
);

export default ThreadPage;
