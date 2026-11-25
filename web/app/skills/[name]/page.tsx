import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { GameId } from '@arena/shared';
import { NextSteps } from '@/components/arena/NextSteps';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { SkillIcon } from '@/components/arena/SkillIcon';
import { ReadingProgress } from '@/components/ui/ReadingProgress';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { TextLink } from '@/components/ui/TextLink';
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
  const isPlaybook = name.endsWith('-playbook');
  // The skill's own chapters are the page's sections; a nav only pays once there are three.
  const chapters: SectionNavItem[] = [
    { id: 'overview', label: 'Overview' },
    ...skill.sections.map((c) => ({ id: c.id, label: c.title })),
    { id: 'more', label: 'Further reading' },
  ];
  const withNav = skill.sections.length >= 2;

  return (
    <main className="flex w-full flex-col">
      {withNav ? (
        <SectionNav items={chapters} label="Chapters of this skill" />
      ) : (
        <ReadingProgress placement="bar" />
      )}

      {/* 1 · What this skill is for, and where it lives. */}
      <Section id="overview" labelledBy="skill-title" space="roomy">
        <div className="flex items-start gap-5">
          <span className="mt-1 hidden sm:block">
            <SkillIcon name={skill.name} slots={slots} />
          </span>
          <SectionHeading
            level="page"
            space="none"
            id="skill-title"
            title={skill.title}
            intro={skill.description}
            action={
              <>
                {isPlaybook && <TextLink href={`/engines/${game}`}>Open the engine</TextLink>}
                <TextLink href={`${REPO_URL}/blob/main/${skill.path}`} external>
                  The source on GitHub
                </TextLink>
              </>
            }
          />
        </div>
        <p className="mt-10 font-mono text-[13px] text-fg-3 break-words sm:pl-14">{skill.path}</p>
      </Section>

      {/* 2 · The skill in full, at a reading measure; each of its chapters is a nav stop. */}
      <Section id="skill" labelledBy="skill-body-title" tone="band">
        <h2 id="skill-body-title" className="sr-only">
          The skill in full
        </h2>
        <article
          className="playbook playbook-read"
          dangerouslySetInnerHTML={{ __html: skill.html }}
        />
      </Section>

      {/* Last · Where to go next. */}
      <Section id="more" labelledBy="next-steps-title" space="compact">
        <NextSteps
          variant="list"
          title="Further reading"
          links={['skills', 'concepts', 'protocol', 'engines']}
        />
      </Section>
    </main>
  );
};

const SkillPage = ({ params }: SkillPageProps) => (
  <Suspense fallback={<PageSkeleton className="max-w-4xl px-4 pt-6" />}>
    <SkillContent params={params} />
  </Suspense>
);

export default SkillPage;
