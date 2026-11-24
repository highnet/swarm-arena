import Link from 'next/link';
import { ArrowRight, Cpu, Gamepad2, Swords, type LucideIcon } from 'lucide-react';
import type { GameId } from '@arena/shared';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { Typography } from '@/components/ui/Typography';
import { PAGES, type PageKey } from '@/lib/pages';
import { SHORT_NAME } from '@/lib/tracks';
import { cn } from '@/lib/utils';

export type NextStep = {
  href: string;
  label: string;
  blurb: string;
  icon: LucideIcon;
};

/** The three places every engine-scoped page can send a reader: overview, play, games. */
const engineSteps = (track: GameId): NextStep[] => [
  {
    href: `/engines/${track}`,
    label: `${SHORT_NAME[track]} engine`,
    blurb: 'Its rating, ladder, lineage and code.',
    icon: Cpu,
  },
  {
    href: `/engines/${track}/play`,
    label: `Play ${SHORT_NAME[track]}`,
    blurb: 'Take on the current version on the board yourself.',
    icon: Gamepad2,
  },
  {
    href: `/games?engine=${track}`,
    label: `${SHORT_NAME[track]} games`,
    blurb: 'Every game this engine played, with replays and downloads.',
    icon: Swords,
  },
];

type NextStepsProps = {
  /** Site pages by key, or a link of the page's own (an engine, a match, a version). */
  links: (PageKey | NextStep)[];
  title?: string;
  /**
   * `cards`: the dashboard pages' row of link cards. `list`: the editorial pages' quiet list of
   * text links under a sub-chapter heading (web/DESIGN.md: no grid of same-shaped cards), for
   * the last section of a page built from `Section`s.
   */
  variant?: 'cards' | 'list';
  className?: string;
};

/** The end of a page: where to go next, so no page is a dead end. */
const NextSteps = ({
  links,
  title = 'Keep exploring',
  variant = 'cards',
  className,
}: NextStepsProps) => {
  const steps = links.map((l) => (typeof l === 'string' ? PAGES[l] : l));
  if (variant === 'list')
    return (
      <nav data-slot="next-steps" aria-labelledby="next-steps-title" className={className}>
        <SectionHeading id="next-steps-title" level="sub" space="none" title={title} />
        <ul className="mt-6 grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map(({ href, label, blurb }) => (
            <li key={href}>
              <Link href={href} className="group block">
                <span className="text-[15px] text-fg underline-offset-4 group-hover:underline">
                  {label}
                </span>
                <span className="mt-1 block text-[13px] leading-5 text-fg-3 text-pretty">
                  {blurb}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    );
  return (
    <nav
      data-slot="next-steps"
      aria-label={title}
      className={cn('mt-10 border-t border-line pt-6', className)}
    >
      <Typography variant="sectionTitle">{title}</Typography>
      <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
        {steps.map(({ href, label, blurb, icon: Icon }) => (
          <li
            key={href}
            className="group relative flex min-w-0 gap-3 rounded-lg border border-line bg-panel p-3.5 transition-colors focus-within:border-line-strong hover:border-line-strong hover:bg-panel-raised"
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-fg-3" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <Link
                href={href}
                className="text-[13px] font-medium text-fg outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:underline"
              >
                {label}
              </Link>
              <Typography variant="meta" as="p" className="mt-0.5 text-pretty">
                {blurb}
              </Typography>
            </div>
            <ArrowRight
              className="mt-0.5 size-4 shrink-0 text-fg-3 transition-transform group-hover:translate-x-0.5 group-hover:text-fg"
              aria-hidden="true"
            />
          </li>
        ))}
      </ul>
    </nav>
  );
};

export { NextSteps, engineSteps };
