import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import type { GameId } from '@arena/shared';
import { SkillIcon } from '@/components/arena/SkillIcon';
import { Typography } from '@/components/ui/Typography';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { getSnapshot } from '@/lib/data';
import { pageMeta } from '@/lib/site';
import { getSkills } from '@/lib/source';

const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? 'https://github.com/highnet/swarm-arena';

type SkillPageProps = {
  params: Promise<{ name: string }>;
};

export const generateStaticParams = async () => (await getSkills()).map((k) => ({ name: k.name }));

export const generateMetadata = async ({ params }: SkillPageProps): Promise<Metadata> => {
  const { name } = await params;
  const skill = (await getSkills()).find((k) => k.name === name);
  return pageMeta(name, skill?.description ?? 'A Swarm Arena agent skill.', `/skills/${name}`);
};

const SkillContent = async ({ params }: SkillPageProps) => {
  const { name } = await params;
  const [skills, s] = await Promise.all([getSkills(), getSnapshot()]);
  const skill = skills.find((k) => k.name === name);
  if (!skill) notFound();
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const game = name.replace(/-playbook$/, '');
  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6 sm:px-6">
      <div className="mt-3 flex items-center gap-3">
        <SkillIcon name={skill.name} slots={slots} />
        <Typography variant="pageTitle" className="font-mono text-xl sm:text-2xl">
          {skill.name}
        </Typography>
      </div>
      {skill.description && (
        <Typography variant="lede" className="mt-3 text-pretty">
          {skill.description}
        </Typography>
      )}
      <div className="mt-4 flex flex-wrap gap-3 text-xs">
        <a
          href={`${REPO_URL}/blob/main/${skill.path}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-fg-2 hover:text-fg"
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
          {skill.path}
        </a>
        {name.endsWith('-playbook') && (
          <Link
            href={`/engines/${game}`}
            className="inline-flex items-center gap-1 text-fg-2 hover:text-fg"
          >
            Open the engine
          </Link>
        )}
      </div>
      <article
        className="playbook mt-6 rounded-lg border border-line bg-panel p-5"
        dangerouslySetInnerHTML={{ __html: skill.html }}
      />
    </main>
  );
};

const SkillPage = ({ params }: SkillPageProps) => (
  <Suspense fallback={<PageSkeleton className="max-w-4xl px-4 pt-6" />}>
    <SkillContent params={params} />
  </Suspense>
);

export default SkillPage;
