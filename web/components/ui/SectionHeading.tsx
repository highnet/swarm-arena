import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Typography } from './Typography';

type SectionHeadingProps = {
  /** Id the section's `labelledBy` points to. */
  id: string;
  title: ReactNode;
  /** One or two sentences: what this chapter shows and why it matters. */
  intro?: ReactNode;
  /** A quiet link or two at the end of the intro (`More on the fleet →`). */
  action?: ReactNode;
  className?: string;
};

/** An oversized chapter heading with a short intro, so each section reads as a new chapter. */
const SectionHeading = ({ id, title, intro, action, className }: SectionHeadingProps) => (
  <header data-slot="section-heading" className={cn('mb-12 max-w-3xl sm:mb-16', className)}>
    <Typography variant="chapter" id={id}>
      {title}
    </Typography>
    {intro && (
      <Typography variant="intro" className="mt-5 max-w-2xl">
        {intro}
      </Typography>
    )}
    {action && <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">{action}</div>}
  </header>
);

export { SectionHeading };
