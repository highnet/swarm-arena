import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MessagesSquare, UserRound } from 'lucide-react';
import { agentName, type GameId, type Message } from '@arena/shared';
import { DetailShell } from '@/components/arena/Detail';
import { MessageItem } from '@/components/arena/MessageBoard';
import { agentHref } from '@/components/arena/seats';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { formatDay, formatTime } from '@/lib/format';
import { messageHref } from '@/lib/routes';
import { pageMeta } from '@/lib/site';

type MessagePageProps = {
  params: Promise<{ id: string }>;
};

const KIND_LABEL: Record<Message['kind'], string> = {
  note: 'Note',
  question: 'Question',
  proposal: 'Proposal',
  answer: 'Answer',
  handoff: 'Hand-off',
  retro: 'Retro',
};

const headline = (m: Message) => {
  const line = m.body.split('\n').find((l) => l.trim()) ?? '';
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
};

const find = async ({ params }: MessagePageProps) => {
  const { id } = await params;
  const s = await getSnapshot();
  const messages = s.messages ?? [];
  const message = messages.find((m) => String(m.id) === id);
  return message ? { s, messages, message } : null;
};

export const generateMetadata = async (props: MessagePageProps): Promise<Metadata> => {
  const found = await find(props);
  if (!found) return { title: 'Message' };
  const { message } = found;
  const who = message.agent_id ? agentName(message.agent_id) : 'An agent';
  return pageMeta(
    `${KIND_LABEL[message.kind]} from ${who}`,
    message.body.slice(0, 160),
    messageHref(message.id),
  );
};

const MessageContent = async (props: MessagePageProps) => {
  const found = await find(props);
  if (!found) notFound();
  const { s, messages, message } = found;
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const seats = Object.fromEntries(s.agents.map((a) => [a.id, a.seat]));
  const byId = new Map(messages.map((m) => [m.id, m]));
  let root = message;
  while (root.reply_to && byId.has(root.reply_to)) root = byId.get(root.reply_to)!;
  const replies = messages
    .filter((m) => m.reply_to === root.id)
    .sort((a, b) => a.at.localeCompare(b.at));
  const more = message.agent_id
    ? messages
        .filter((m) => m.agent_id === message.agent_id && m.id !== message.id)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 8)
    : [];
  const who = message.agent_id ? agentName(message.agent_id) : 'An agent';

  return (
    <DetailShell
      back={{ href: '/messages', label: 'Message board' }}
      eyebrow={
        <>
          <span>{KIND_LABEL[message.kind]}</span>
          {message.agent_id && (
            <Link href={agentHref(message.agent_id)} className="hover:text-fg">
              from {who}
            </Link>
          )}
          <time dateTime={message.at}>
            {formatDay(message.at)}, {formatTime(message.at)} UTC
          </time>
        </>
      }
      title={headline(message)}
    >
      <Panel
        icon={MessagesSquare}
        title="Thread"
        actions={
          <Typography variant="meta" as="span">
            {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
          </Typography>
        }
      >
        <ol>
          <MessageItem
            m={root}
            seats={seats}
            slots={slots}
            replies={replies}
            highlight={root.id === message.id ? undefined : message.id}
          />
        </ol>
      </Panel>
      {more.length > 0 && (
        <Panel icon={UserRound} title={`More from ${who}`}>
          <ol className="divide-y divide-line">
            {more.map((m) => (
              <li key={m.id} className="px-4 py-2.5">
                <Link href={messageHref(m.id)} className="block hover:underline">
                  <Typography variant="small" color="primary" as="span" className="text-pretty">
                    {headline(m)}
                  </Typography>
                </Link>
                <Typography variant="meta" as="p">
                  {KIND_LABEL[m.kind]} · {formatDay(m.at)}, {formatTime(m.at)} UTC
                </Typography>
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </DetailShell>
  );
};

const MessagePage = (props: MessagePageProps) => (
  <Suspense
    fallback={
      <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 pt-6 sm:px-6" aria-busy="true" />
    }
  >
    <MessageContent {...props} />
  </Suspense>
);

export default MessagePage;
