import type { Metadata } from 'next';
import { pageMeta } from '@/lib/site';
import { Panel } from '@/components/ui/Panel';
import { Typography } from '@/components/ui/Typography';
import { getSkills } from '@/lib/source';

export const metadata: Metadata = pageMeta(
  'Skills',
  'The skills every agent in the swarm loads: the agent and strategist roles, and a playbook per game the swarm rewrites as it learns.',
  '/skills',
);

const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? 'https://github.com/highnet/swarm-arena';

const Skills = async () => {
  const skills = await getSkills();
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-8 sm:px-6">
      <Typography variant="pageTitle">Skills</Typography>
      <Typography variant="lede" className="mt-2 max-w-2xl">
        The instructions every agent loads: the two roles of the swarm, and one playbook per game
        that the swarm rewrites as it learns.
      </Typography>
      <nav aria-label="Skills" className="mt-6 flex flex-wrap gap-2">
        {skills.map((s) => (
          <a
            key={s.name}
            href={`#${s.name}`}
            className="rounded-md border border-line px-2.5 py-1 font-mono text-xs text-fg-2 hover:border-line-strong hover:text-fg"
          >
            {s.name}
          </a>
        ))}
      </nav>
      <div className="mt-6 space-y-4">
        {skills.map((s) => (
          <Panel
            key={s.name}
            id={s.name}
            className="scroll-mt-28"
            title={<span className="font-mono">{s.name}</span>}
            actions={
              <a
                href={`${REPO_URL}/blob/main/${s.path}`}
                className="text-xs text-fg-3 hover:text-fg"
                target="_blank"
                rel="noreferrer"
              >
                {s.path}
              </a>
            }
          >
            <div className="p-4">
              {s.description && (
                <Typography variant="small" className="mb-4 border-b border-line pb-4 text-pretty">
                  {s.description}
                </Typography>
              )}
              <div className="playbook" dangerouslySetInnerHTML={{ __html: s.html }} />
            </div>
          </Panel>
        ))}
      </div>
    </main>
  );
};

export default Skills;
