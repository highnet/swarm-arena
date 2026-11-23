import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { GameId } from '@arena/shared';
import { SkillIcon } from '@/components/arena/SkillIcon';
import { Typography } from '@/components/ui/Typography';
import { getSnapshot } from '@/lib/data';
import { pageMeta } from '@/lib/site';
import { getSkills } from '@/lib/source';

export const metadata: Metadata = pageMeta(
  'Skills',
  'The skills every agent in the swarm loads: the agent and strategist roles, and a playbook per game the swarm rewrites as it learns.',
  '/skills',
);

const SkillsContent = async () => {
  const [skills, s] = await Promise.all([getSkills(), getSnapshot()]);
  const slots = Object.fromEntries(s.tracks.map((t) => [t.id, t.color_slot])) as Partial<
    Record<GameId, number>
  >;
  const groups = [
    { title: 'Roles', items: skills.filter((k) => !k.name.endsWith('-playbook')) },
    { title: 'Playbooks', items: skills.filter((k) => k.name.endsWith('-playbook')) },
  ];
  return (
    <main className="mx-auto w-full max-w-[90rem] px-4 pb-16 pt-8 sm:px-6">
      <Typography variant="pageTitle">Skills</Typography>
      <Typography variant="lede" className="mt-2 max-w-2xl">
        The instructions the agents read: one per job, and one playbook per game that the swarm
        keeps updating.
      </Typography>
      {groups.map((g) => (
        <section key={g.title} className="mt-8" aria-labelledby={`skills-${g.title}`}>
          <h2 id={`skills-${g.title}`} className="mb-3 text-sm font-medium text-fg">
            {g.title}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {g.items.map((k) => (
              <article
                key={k.name}
                className="group relative flex min-w-0 flex-col rounded-lg border border-line bg-panel p-4 transition-colors focus-within:border-line-strong hover:border-line-strong hover:bg-panel-raised"
              >
                <div className="flex items-start gap-3">
                  <SkillIcon name={k.name} slots={slots} />
                  <h3 className="min-w-0 flex-1 pt-1.5 font-mono text-[13px] font-medium text-fg">
                    <Link
                      href={`/skills/${k.name}`}
                      className="outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:underline"
                    >
                      {k.name}
                    </Link>
                  </h3>
                  <ArrowRight
                    className="mt-1.5 size-4 shrink-0 text-fg-3 transition-transform group-hover:translate-x-0.5 group-hover:text-fg"
                    aria-hidden="true"
                  />
                </div>
                <Typography variant="small" className="mt-3 line-clamp-4 text-pretty">
                  {k.description}
                </Typography>
              </article>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
};

const Skills = () => (
  <Suspense
    fallback={
      <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 pt-8 sm:px-6" aria-busy="true" />
    }
  >
    <SkillsContent />
  </Suspense>
);

export default Skills;
