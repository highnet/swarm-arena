import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, ArrowUpRight, BadgeCheck } from 'lucide-react';
import type { GameId } from '@arena/shared';
import { EngineChip } from '@/components/arena/SidePanels';
import { ReadingProgress } from '@/components/ui/ReadingProgress';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { TextLink } from '@/components/ui/TextLink';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { formatDay, formatTime } from '@/lib/format';
import { getArticle, getNews, newsHref } from '@/lib/news';
import { REPO_URL } from '@/lib/repo';
import { versionHref } from '@/lib/routes';
import { pageMeta } from '@/lib/site';
import { SHORT_NAME } from '@/lib/tracks';

type StoryPageProps = {
  params: Promise<{ slug: string }>;
};

export const generateStaticParams = async () => (await getNews()).map((a) => ({ slug: a.slug }));

export const generateMetadata = async ({ params }: StoryPageProps): Promise<Metadata> => {
  const { slug } = await params;
  const a = await getArticle(slug);
  if (!a) return pageMeta('News', 'A story from Swarm Arena.', '/news');
  return pageMeta(a.title, a.dek || a.title, newsHref(a.slug));
};

type EvidenceLinkProps = {
  href: string;
  label: string;
  value: string;
  external?: boolean;
};

/** One record behind the story, as a hairline row: what it is on the left, the link on the right. */
const EvidenceLink = ({ href, label, value, external }: EvidenceLinkProps) => {
  const Icon = external ? ArrowUpRight : ArrowRight;
  const body = (
    <>
      <span className="text-[13px] text-fg-3">{label}</span>
      <span className="inline-flex items-center gap-1.5 text-[17px] text-fg underline-offset-4 group-hover:underline">
        {value}
        <Icon className="size-4 shrink-0 text-fg-3" aria-hidden="true" />
      </span>
    </>
  );
  const className = 'group grid gap-1 py-6 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-baseline';
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {body}
    </a>
  ) : (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
};

const StoryPage = async ({ params }: StoryPageProps) => {
  const { slug } = await params;
  const [a, news, s] = await Promise.all([getArticle(slug), getNews(), getSnapshot()]);
  if (!a) notFound();
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const more = news.filter((n) => n.slug !== a.slug).slice(0, 3);
  const evidence: EvidenceLinkProps[] = [
    ...(a.engine && a.version
      ? [
          {
            href: versionHref(a.engine, a.version),
            label: 'Version',
            value: `${SHORT_NAME[a.engine]} ${a.version}`,
          },
        ]
      : []),
    ...(a.pr
      ? [
          {
            href: `${REPO_URL}/pull/${a.pr}`,
            label: 'Pull request',
            value: `#${a.pr} with the referee’s games`,
            external: true,
          },
        ]
      : []),
    ...(a.engine
      ? [{ href: `/engines/${a.engine}`, label: 'Engine', value: `${SHORT_NAME[a.engine]} ladder` }]
      : []),
    {
      href: `${REPO_URL}/blob/main/${a.path}`,
      label: 'This story',
      value: 'Source on GitHub',
      external: true,
    },
  ];

  return (
    <main className="flex w-full flex-col">
      <ReadingProgress placement="bar" />

      {/* 1 · The story: headline, standfirst, byline, then the text at a reading measure. */}
      <Section id="story" labelledBy="story-title" space="roomy">
        <article className="mx-auto w-full max-w-[38em]">
          <header>
            <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-good-text">
              <BadgeCheck className="size-4" aria-hidden="true" />
              Refereed
            </p>
            <Typography
              variant="display"
              id="story-title"
              className="mt-6 text-3xl sm:text-4xl lg:text-5xl"
            >
              {a.title}
            </Typography>
            {a.dek && (
              <Typography variant="intro" className="mt-6">
                {a.dek}
              </Typography>
            )}
            <p className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line pb-8 text-[13px] text-fg-3">
              {a.engine && <EngineChip track={a.engine} slots={slots} />}
              {a.version && <span className="font-mono tabular text-fg-2">{a.version}</span>}
              <time dateTime={a.published} className="font-mono tabular">
                {formatDay(a.published)}, {formatTime(a.published)} UTC
              </time>
              <span>{a.minutes} min read</span>
            </p>
          </header>
          <div className="article mt-10" dangerouslySetInnerHTML={{ __html: a.html }} />
        </article>
      </Section>

      {/* 2 · Where every number in the story comes from. */}
      <Section id="evidence" labelledBy="evidence-title" tone="band">
        <div className="mx-auto w-full max-w-[38em]">
          <SectionHeading
            id="evidence-title"
            title="Behind this story"
            intro="The numbers above come from these records. Every one can be checked."
            space="tight"
          />
          <nav
            aria-labelledby="evidence-title"
            className="divide-y divide-line border-y border-line"
          >
            {evidence.map((e) => (
              <EvidenceLink key={e.href} {...e} />
            ))}
          </nav>
        </div>
      </Section>

      {/* 3 · What to read next. */}
      {more.length > 0 && (
        <Section id="more" labelledBy="more-title" space="compact">
          <div className="mx-auto w-full max-w-[38em]">
            <SectionHeading
              id="more-title"
              level="sub"
              title="More news"
              space="tight"
              action={<TextLink href="/news">All stories</TextLink>}
            />
            <ol className="divide-y divide-line border-y border-line">
              {more.map((n) => (
                <li key={n.slug} className="relative py-6">
                  <Link
                    href={newsHref(n.slug)}
                    className="block text-[17px] font-medium leading-7 text-fg text-pretty underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline"
                  >
                    {n.title}
                  </Link>
                  <Typography variant="meta" as="p" className="mt-1 text-[13px]">
                    {n.engine && `${SHORT_NAME[n.engine]} · `}
                    {formatDay(n.published)}, {formatTime(n.published)} UTC
                  </Typography>
                </li>
              ))}
            </ol>
          </div>
        </Section>
      )}
    </main>
  );
};

export default StoryPage;
