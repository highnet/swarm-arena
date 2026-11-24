import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, BadgeCheck } from 'lucide-react';
import type { GameId } from '@arena/shared';
import { NextSteps } from '@/components/arena/NextSteps';
import { EngineChip } from '@/components/arena/SidePanels';
import { Panel } from '@/components/ui/Panel';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { TextLink } from '@/components/ui/TextLink';
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
  /** Show the date as well as the time (the lead story stands alone, without a day label). */
  day?: boolean;
};

/** Engine, time and reading time, in one quiet line under a headline. */
const StoryMeta = ({ article: a, slots, day }: StoryMetaProps) => (
  <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-fg-3">
    {a.engine && <EngineChip track={a.engine} slots={slots} />}
    {day && (
      <time dateTime={a.published} className="font-mono tabular">
        {formatDay(a.published)}, {formatTime(a.published)} UTC
      </time>
    )}
    <span>{a.minutes} min read</span>
  </p>
);

type LeadStoryProps = {
  article: Article;
  slots: Slots;
};

/** The newest story, set large: the one lead item a list may give a card (web/DESIGN.md). */
const LeadStory = ({ article: a, slots }: LeadStoryProps) => (
  <Panel className="relative max-w-4xl p-6 transition-colors duration-150 hover:border-line-strong sm:p-10">
    <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-good-text">
      <BadgeCheck className="size-4" aria-hidden="true" />
      Refereed
    </p>
    <h3 className="mt-5 text-2xl font-semibold tracking-tight text-fg text-balance sm:text-4xl">
      <Link href={newsHref(a.slug)} className="after:absolute after:inset-0 after:content-['']">
        {a.title}
      </Link>
    </h3>
    {a.dek && (
      <p className="mt-5 max-w-[36em] text-base leading-7 text-fg-2 text-pretty sm:text-lg sm:leading-8">
        {a.dek}
      </p>
    )}
    <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
      <div className="relative z-1">
        <StoryMeta article={a} slots={slots} day />
      </div>
      <span className="inline-flex items-center gap-1 text-[15px] text-fg">
        Read the story
        <ArrowRight className="size-4" aria-hidden="true" />
      </span>
    </div>
  </Panel>
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
  const chapters: SectionNavItem[] = [
    { id: 'overview', label: 'Overview' },
    ...(lead ? [{ id: 'latest', label: 'The latest' }] : []),
    ...(rest.length ? [{ id: 'earlier', label: 'Earlier' }] : []),
    { id: 'more', label: 'Further reading' },
  ];

  return (
    <main className="flex w-full flex-col">
      {chapters.length >= 4 && <SectionNav items={chapters} />}

      {/* 1 · What the news is. */}
      <Section id="overview" labelledBy="news-title" space="roomy">
        <SectionHeading
          level="page"
          space="none"
          id="news-title"
          title="News"
          intro="Short stories about the swarm’s breakthroughs, written for people who don’t play these games. Every one is about a result the referee recorded, and links to it."
          action={
            <>
              <TextLink href="/feed.xml" external type="application/rss+xml">
                RSS feed
              </TextLink>
              <TextLink href="/versions">Every version shipped</TextLink>
            </>
          }
        />
      </Section>

      {/* 2 · The newest story, given room. */}
      {lead ? (
        <Section id="latest" labelledBy="latest-title" tone="band">
          <SectionHeading id="latest-title" title="The latest" space="tight" />
          <LeadStory article={lead} slots={slots} />
        </Section>
      ) : (
        <Section id="latest" labelledBy="latest-title" tone="band">
          <SectionHeading
            id="latest-title"
            title="No stories yet"
            intro="The first one runs when an engine passes the referee."
            space="none"
          />
        </Section>
      )}

      {/* 3 · Everything before it, by day. */}
      {rest.length > 0 && (
        <Section id="earlier" labelledBy="earlier-title">
          <SectionHeading
            id="earlier-title"
            title="Earlier"
            intro={`${rest.length} more ${rest.length === 1 ? 'story' : 'stories'}, newest first.`}
          />
          <div className="max-w-4xl space-y-16">
            {[...days.entries()].map(([day, stories]) => (
              <section key={day} aria-labelledby={`day-${day.replace(/\W+/g, '-')}`}>
                <h3
                  id={`day-${day.replace(/\W+/g, '-')}`}
                  className="text-[15px] font-medium text-fg-2"
                >
                  {day}
                </h3>
                <ol className="mt-4 divide-y divide-line border-y border-line">
                  {stories.map((a) => (
                    <li
                      key={a.slug}
                      className="relative grid gap-x-8 gap-y-2 py-8 sm:grid-cols-[4rem_minmax(0,1fr)]"
                    >
                      <time
                        dateTime={a.published}
                        className="pt-1 font-mono text-[13px] tabular text-fg-3"
                      >
                        {formatTime(a.published)}
                      </time>
                      <div className="min-w-0">
                        <h4 className="text-lg font-medium leading-7 text-fg text-pretty sm:text-xl">
                          <Link
                            href={newsHref(a.slug)}
                            className="underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline"
                          >
                            {a.title}
                          </Link>
                        </h4>
                        {a.dek && (
                          <p className="mt-2 line-clamp-3 max-w-[34em] text-[15px] leading-7 text-fg-2 text-pretty">
                            {a.dek}
                          </p>
                        )}
                        <div className="relative z-1 mt-4">
                          <StoryMeta article={a} slots={slots} />
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </Section>
      )}

      {/* Last · Where the numbers in the stories come from. */}
      <Section
        id="more"
        labelledBy="next-steps-title"
        tone={rest.length ? 'band' : 'plain'}
        space="compact"
      >
        <NextSteps
          variant="list"
          title="Further reading"
          links={['versions', 'graveyard', 'engines', 'board']}
        />
      </Section>
    </main>
  );
};

export default NewsPage;
