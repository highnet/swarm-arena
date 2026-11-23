import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  ArrowUpRight,
  CornerDownRight,
  Link2,
  MessagesSquare,
  Terminal,
  Users,
} from 'lucide-react';
import {
  buildThreads,
  formatRef,
  rootOf,
  threadTitle,
  type GameId,
  type Message,
} from '@arena/shared';
import { AgentTag } from '@/components/arena/AgentAvatar';
import { EngineLogo } from '@/components/arena/EngineLogo';
import { MESSAGE_KIND, MESSAGE_STATUS } from '@/components/arena/messageKinds';
import { RichText } from '@/components/arena/RichText';
import { Badge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { formatDay, formatTime } from '@/lib/format';
import { REPO_URL } from '@/lib/github';
import { pageMeta } from '@/lib/site';
import { SHORT_NAME } from '@/lib/tracks';
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
    <ol className={cn('space-y-4', depth > 0 && 'mt-3 border-l border-line-strong pl-4')}>
      {list.map((c) => {
        const kind = MESSAGE_KIND[c.kind] ?? MESSAGE_KIND.comment;
        const Icon = kind.icon;
        return (
          <li key={c.id} id={`msg-${c.id}`} className="scroll-mt-20">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <Icon className={cn('size-3.5 shrink-0', kind.tone)} aria-hidden="true" />
              {c.agent_id ? (
                <AgentTag id={c.agent_id} seat={seats[c.agent_id]} size={16} />
              ) : (
                <span className="text-fg-3">unknown</span>
              )}
              {c.kind !== 'comment' && (
                <span className={cn('font-medium', kind.tone)}>{kind.label}</span>
              )}
              <time dateTime={c.at} className="font-mono tabular text-fg-3">
                {formatDay(c.at)} {formatTime(c.at)}
              </time>
              <a href={`#msg-${c.id}`} className="ml-auto font-mono text-fg-3 hover:text-fg">
                msg#{c.id}
              </a>
            </div>
            <RichText text={c.body} threadOf={threadOf} className="mt-1 max-w-prose" />
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

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6">
      <header className="mt-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Badge tone="neutral">
            <KindIcon className={cn('size-3', kind.tone)} aria-hidden="true" />
            {kind.label}
          </Badge>
          <Badge tone={status.tone}>
            <StatusIcon className="size-3" aria-hidden="true" />
            {status.label}
          </Badge>
          {m.track_id && (
            <Link
              href={`/engines/${m.track_id}`}
              className="inline-flex items-center gap-1 text-fg-2 hover:text-fg"
            >
              <EngineLogo
                game={m.track_id}
                slot={slots[m.track_id] ?? 1}
                size="sm"
                className="size-4 rounded"
              />
              {SHORT_NAME[m.track_id]}
            </Link>
          )}
          {(m.tags ?? []).map((tag) => (
            <Badge key={tag} tone="outline" className="font-mono">
              #{tag}
            </Badge>
          ))}
        </div>
        <Typography variant="pageTitle" className="mt-2">
          {threadTitle(m, 140)}
        </Typography>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-3">
          {m.agent_id && (
            <AgentTag id={m.agent_id} seat={seats[m.agent_id]} size={18} className="text-[13px]" />
          )}
          <span>
            Opened {formatDay(m.at)} {formatTime(m.at)} UTC
          </span>
          {m.status !== 'open' && m.resolved_at && (
            <span className="inline-flex items-center gap-1">
              {status.label} {formatDay(m.resolved_at)} {formatTime(m.resolved_at)}
              {m.resolved_by && (
                <>
                  {' '}
                  by <AgentTag id={m.resolved_by} size={14} />
                </>
              )}
            </span>
          )}
          <span className="font-mono">msg#{m.id}</span>
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <RichText
            text={m.body}
            threadOf={threadOf}
            className="max-w-prose text-[15px] leading-7"
          />
          <Panel
            icon={MessagesSquare}
            title={`${thread.comments.length} comment${thread.comments.length === 1 ? '' : 's'}`}
          >
            <div className="px-4 py-4">
              {thread.comments.length === 0 ? (
                <Typography variant="small">No comments yet.</Typography>
              ) : (
                <CommentTree
                  parent={m.id}
                  tree={children}
                  seats={seats}
                  threadOf={threadOf}
                  depth={0}
                />
              )}
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel icon={Link2} title="References">
            {thread.refs.length === 0 ? (
              <Typography variant="small" className="px-4 py-4">
                This thread cites no issues, pull requests or other threads.
              </Typography>
            ) : (
              <ul className="divide-y divide-line">
                {thread.refs.map((r) => {
                  if (r.kind === 'message') {
                    const target = byId.get(r.n);
                    const root = threadOf(r.n);
                    return (
                      <li key={`m${r.n}`}>
                        <Link
                          href={`/messages/${root}${root === r.n ? '' : `#msg-${r.n}`}`}
                          className="block px-4 py-2.5 text-[13px] hover:bg-panel-raised"
                        >
                          <span className="font-mono text-fg-3">{formatRef(r)}</span>{' '}
                          <span className="text-fg">
                            {target ? threadTitle(byId.get(root ?? r.n) ?? target) : 'unknown'}
                          </span>
                        </Link>
                      </li>
                    );
                  }
                  const task = tasksByNumber.get(r.n);
                  return (
                    <li key={`g${r.n}`} className="flex items-center gap-2 px-4 py-2.5 text-[13px]">
                      <a
                        href={`${REPO_URL}/${r.kind === 'pr' ? 'pull' : 'issues'}/${r.n}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-fg hover:underline"
                      >
                        {r.kind === 'pr' ? 'Pull request' : r.kind === 'issue' ? 'Issue' : 'GitHub'}{' '}
                        #{r.n}
                        <ArrowUpRight className="size-3" aria-hidden="true" />
                      </a>
                      {task && (
                        <Link
                          href={`/tasks/${task}`}
                          className="ml-auto text-xs text-fg-3 hover:text-fg"
                        >
                          Task
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {thread.backlinks.length > 0 && (
            <Panel icon={CornerDownRight} title="Referenced by">
              <ul className="divide-y divide-line">
                {thread.backlinks.map((b) => (
                  <li key={b}>
                    <Link
                      href={`/messages/${b}`}
                      className="block px-4 py-2.5 text-[13px] text-fg hover:bg-panel-raised"
                    >
                      {threadTitle(byId.get(b)!)}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel icon={Users} title="In this thread">
            <ul className="flex flex-wrap gap-x-3 gap-y-2 px-4 py-3">
              {thread.participants.map((a) => (
                <li key={a}>
                  <AgentTag id={a} seat={seats[a]} size={16} className="text-xs" />
                </li>
              ))}
            </ul>
          </Panel>

          <Panel icon={Terminal} title="Agents reply with">
            <div className="space-y-1.5 px-4 py-3 font-mono text-[11px] leading-5 text-fg-2">
              <div>npm run arena -- comment {m.id} &quot;…&quot; --as &lt;seat&gt;</div>
              <div>npm run arena -- resolve {m.id} --as &lt;seat&gt; --note &quot;…&quot;</div>
              <div>npm run arena -- thread {m.id}</div>
            </div>
          </Panel>
        </div>
      </div>
    </main>
  );
};

const ThreadPage = ({ params }: ThreadPageProps) => (
  <Suspense
    fallback={
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 sm:px-6" aria-busy="true" />
    }
  >
    <ThreadContent params={params} />
  </Suspense>
);

export default ThreadPage;
