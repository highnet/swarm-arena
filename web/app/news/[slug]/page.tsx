import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, ArrowUpRight, BadgeCheck } from 'lucide-react';
import type { GameId } from '@arena/shared';
import { EngineChip } from '@/components/arena/SidePanels';
import { Badge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
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

const EvidenceLink = ({ href, label, value, external }: EvidenceLinkProps) => {
  const Icon = external ? ArrowUpRight : ArrowRight;
  const body = (
    <>
      <span className="text-xs text-fg-3">{label}</span>
      <span className="flex items-center gap-1 text-[13px] text-fg">
        <span className="truncate">{value}</span>
        <Icon className="size-3 shrink-0 text-fg-3" aria-hidden="true" />
      </span>
    </>
  );
  const className = 'flex flex-col gap-0.5 bg-panel px-4 py-3 hover:bg-panel-raised';
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
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-8 sm:px-6">
      <article>
        <header>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="good">
              <BadgeCheck className="size-3" aria-hidden="true" />
              Refereed
            </Badge>
            {a.engine && <EngineChip track={a.engine} slots={slots} />}
            {a.version && <span className="font-mono text-xs tabular text-fg-2">{a.version}</span>}
          </div>
          <Typography variant="pageTitle" className="mt-4 sm:text-[2rem] sm:leading-tight">
            {a.title}
          </Typography>
          {a.dek && (
            <Typography variant="lede" className="mt-3 text-base leading-7">
              {a.dek}
            </Typography>
          )}
          <Typography variant="meta" as="p" className="mt-5 border-b border-line pb-5">
            <time dateTime={a.published}>
              {formatDay(a.published)}, {formatTime(a.published)} UTC
            </time>
            <span aria-hidden="true"> · </span>
            {a.minutes} min read
          </Typography>
        </header>
        <div className="article mt-6" dangerouslySetInnerHTML={{ __html: a.html }} />
      </article>

      <section aria-labelledby="evidence" className="mt-10">
        <Typography variant="sectionTitle" id="evidence">
          Behind this story
        </Typography>
        <Typography variant="meta" as="p" className="mt-0.5">
          The numbers above come from these records. Every one can be checked.
        </Typography>
        <div className="mt-3 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2">
          {evidence.map((e) => (
            <EvidenceLink key={e.href} {...e} />
          ))}
        </div>
      </section>

      {more.length > 0 && (
        <Panel
          title="More news"
          className="mt-10"
          actions={
            <Link
              href="/news"
              className="inline-flex items-center gap-1 text-xs text-fg-2 hover:text-fg"
            >
              All stories
              <ArrowRight className="size-3" aria-hidden="true" />
            </Link>
          }
        >
          <ol className="divide-y divide-line">
            {more.map((n) => (
              <li key={n.slug} className="relative px-4 py-2.5 hover:bg-panel-raised">
                <Link
                  href={newsHref(n.slug)}
                  className="block text-[13px] text-fg text-pretty after:absolute after:inset-0 after:content-['']"
                >
                  {n.title}
                </Link>
                <Typography variant="meta" as="p">
                  {n.engine && `${SHORT_NAME[n.engine]} · `}
                  {formatDay(n.published)}, {formatTime(n.published)} UTC
                </Typography>
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </main>
  );
};

export default StoryPage;
