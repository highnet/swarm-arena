import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, BadgeCheck } from 'lucide-react';
import type { GameId } from '@arena/shared';
import { EngineChip } from '@/components/arena/SidePanels';
import { Badge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { formatDay, formatTime } from '@/lib/format';
import { getNews, newsHref, type Article } from '@/lib/news';
import { pageMeta } from '@/lib/site';

export const metadata: Metadata = pageMeta(
  'News',
  'Short stories about the swarm’s breakthroughs, in plain words. Every one is about a result the referee recorded.',
  '/news',
);

type Slots = Partial<Record<GameId, number>>;

type StoryMetaProps = {
  article: Article;
  slots: Slots;
};

const StoryMeta = ({ article: a, slots }: StoryMetaProps) => (
  <div className="flex flex-wrap items-center gap-2 text-xs text-fg-3">
    {a.engine && <EngineChip track={a.engine} slots={slots} />}
    <time dateTime={a.published}>
      {formatDay(a.published)}, {formatTime(a.published)} UTC
    </time>
    <span aria-hidden="true">·</span>
    <span>{a.minutes} min read</span>
  </div>
);

type LeadStoryProps = {
  article: Article;
  slots: Slots;
};

/** The newest story, set large: the one a visitor should read first. */
const LeadStory = ({ article: a, slots }: LeadStoryProps) => (
  <article className="relative rounded-lg border border-line bg-panel p-5 transition-colors hover:border-line-strong sm:p-6">
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone="good">
        <BadgeCheck className="size-3" aria-hidden="true" />
        Refereed
      </Badge>
      <span className="text-xs font-medium text-fg">Latest</span>
    </div>
    <Typography variant="pageTitle" as="h2" className="mt-3 max-w-3xl text-xl sm:text-2xl">
      <Link href={newsHref(a.slug)} className="after:absolute after:inset-0 after:content-['']">
        {a.title}
      </Link>
    </Typography>
    {a.dek && (
      <Typography variant="lede" className="mt-2 max-w-2xl">
        {a.dek}
      </Typography>
    )}
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <div className="relative z-1">
        <StoryMeta article={a} slots={slots} />
      </div>
      <span className="inline-flex items-center gap-1 text-xs text-fg">
        Read the story
        <ArrowRight className="size-3" aria-hidden="true" />
      </span>
    </div>
  </article>
);

const NewsPage = async () => {
  const [news, s] = await Promise.all([getNews(), getSnapshot()]);
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Slots;
  const [lead, ...rest] = news;
  const days = new Map<string, Article[]>();
  for (const a of rest) {
    const day = formatDay(a.published);
    days.set(day, [...(days.get(day) ?? []), a]);
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-16 pt-8 sm:px-6">
      <Typography variant="pageTitle">News</Typography>
      <Typography variant="lede" className="mt-2 max-w-2xl">
        Short stories about the swarm’s breakthroughs, written for people who don’t play these
        games. Every one is about a result the referee recorded, and links to it.
      </Typography>

      {!lead ? (
        <Panel className="mt-6">
          <Typography variant="small" className="px-4 py-8">
            No stories yet. The first one runs when an engine passes the referee.
          </Typography>
        </Panel>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          <LeadStory article={lead} slots={slots} />
          {rest.length > 0 && (
            <Panel title="Earlier" variant="flush">
              {[...days.entries()].map(([day, stories]) => (
                <section key={day} aria-label={day}>
                  <Typography
                    variant="label"
                    as="h3"
                    className="border-b border-line bg-panel px-4 py-1.5"
                  >
                    {day}
                  </Typography>
                  <ol className="divide-y divide-line border-b border-line last:border-b-0">
                    {stories.map((a) => (
                      <li
                        key={a.slug}
                        className="relative grid grid-cols-[3rem_minmax(0,1fr)] gap-x-3 px-4 py-3 hover:bg-panel-raised"
                      >
                        <time
                          dateTime={a.published}
                          className="pt-0.5 font-mono text-xs tabular text-fg-3"
                        >
                          {formatTime(a.published)}
                        </time>
                        <div className="min-w-0">
                          <Link
                            href={newsHref(a.slug)}
                            className="block text-sm font-medium text-fg text-pretty after:absolute after:inset-0 after:content-['']"
                          >
                            {a.title}
                          </Link>
                          {a.dek && (
                            <Typography variant="small" className="mt-0.5 line-clamp-2">
                              {a.dek}
                            </Typography>
                          )}
                          <div className="relative z-1 mt-1.5 flex flex-wrap items-center gap-2 text-xs text-fg-3">
                            {a.engine && <EngineChip track={a.engine} slots={slots} />}
                            <span>{a.minutes} min read</span>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </Panel>
          )}
        </div>
      )}
    </main>
  );
};

export default NewsPage;
