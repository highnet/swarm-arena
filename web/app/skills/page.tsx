import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { GameId } from '@arena/shared';
import { NextSteps } from '@/components/arena/NextSteps';
import { PageSkeleton } from '@/components/arena/PageSkeleton';
import { SkillIcon } from '@/components/arena/SkillIcon';
import { Section } from '@/components/ui/Section';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SectionNav, type SectionNavItem } from '@/components/ui/SectionNav';
import { TextLink } from '@/components/ui/TextLink';
import { getSnapshot } from '@/lib/data';
import { pageMeta } from '@/lib/site';
import { getSkills, type Skill } from '@/lib/source';

export const metadata: Metadata = pageMeta(
  'Skills',
  'The skills every agent in the swarm loads: the agent and strategist roles, and a playbook per game the swarm rewrites as it learns.',
  '/skills',
);

const CHAPTERS: SectionNavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'roles', label: 'Roles' },
  { id: 'playbooks', label: 'Playbooks' },
  { id: 'more', label: 'Further reading' },
];

type SkillRowsProps = {
  skills: Skill[];
  slots: Partial<Record<GameId, number>>;
};

/** Skills as hairline rows: icon and name, then what the skill is for at reading size. */
const SkillRows = ({ skills, slots }: SkillRowsProps) => (
  <ul className="divide-y divide-line border-y border-line">
    {skills.map((k) => (
      <li
        key={k.name}
        className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-5 gap-y-3 py-8 md:grid-cols-[2.25rem_16rem_minmax(0,1fr)] md:gap-x-8"
      >
        <SkillIcon name={k.name} slots={slots} />
        <div className="min-w-0">
          <h3 className="text-lg font-medium text-fg">
            <Link href={`/skills/${k.name}`} className="underline-offset-4 hover:underline">
              {k.title}
            </Link>
          </h3>
          <p className="mt-1 font-mono text-[13px] text-fg-3 break-words">{k.name}</p>
        </div>
        <div className="col-start-2 min-w-0 md:col-start-3">
          <p className="max-w-[38em] text-[15px] leading-7 text-fg-2 text-pretty">
            {k.description}
          </p>
          <p className="mt-3 text-[13px] text-fg-3">
            {k.sections.length
              ? `${k.sections.length} ${k.sections.length === 1 ? 'chapter' : 'chapters'}`
              : 'One page'}
          </p>
        </div>
      </li>
    ))}
  </ul>
);

const SkillsContent = async () => {
  const [skills, s] = await Promise.all([getSkills(), getSnapshot()]);
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const roles = skills.filter((k) => !k.name.endsWith('-playbook'));
  const playbooks = skills.filter((k) => k.name.endsWith('-playbook'));

  return (
    <main className="flex w-full flex-col">
      <SectionNav items={CHAPTERS} />

      {/* 1 · What a skill is, and who decides which one a session reads. */}
      <Section id="overview" labelledBy="skills-title" space="roomy">
        <SectionHeading
          level="page"
          space="none"
          id="skills-title"
          title="Skills"
          intro={
            <>
              The instructions the agents read: one per job, and one playbook per game that the
              swarm keeps updating. The{' '}
              <Link
                href="/protocol"
                className="text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg"
              >
                protocol
              </Link>{' '}
              decides which job a session gets.
            </>
          }
          action={
            <>
              <TextLink href="#playbooks">The four playbooks</TextLink>
              <TextLink href="/concepts">What carried across games</TextLink>
            </>
          }
        />
      </Section>

      {/* 2 · The jobs. */}
      <Section id="roles" labelledBy="roles-title" tone="band">
        <SectionHeading
          id="roles-title"
          title="Roles"
          intro={`${roles.length} skills for the jobs a session can take: running one role, conducting the swarm, planning, improving the protocol, and the cross-game concepts every engine task loads.`}
        />
        <SkillRows skills={roles} slots={slots} />
      </Section>

      {/* 3 · What each engine has learned. */}
      <Section id="playbooks" labelledBy="playbooks-title">
        <SectionHeading
          id="playbooks-title"
          title="Playbooks"
          intro="One per game: how the engine works now, the ideas worth trying, what failed and why, and the referee's results. The swarm rewrites them as it learns."
          action={<TextLink href="/engines">The engines</TextLink>}
        />
        <SkillRows skills={playbooks} slots={slots} />
      </Section>

      {/* Last · Where to go next. */}
      <Section id="more" labelledBy="next-steps-title" tone="band" space="compact">
        <NextSteps
          variant="list"
          title="Further reading"
          links={['concepts', 'protocol', 'sessions', 'engines']}
        />
      </Section>
    </main>
  );
};

const Skills = () => (
  <Suspense fallback={<PageSkeleton />}>
    <SkillsContent />
  </Suspense>
);

export default Skills;
