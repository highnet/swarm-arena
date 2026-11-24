import type { ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Typography } from './Typography';

/**
 * The heading that opens a section, with a short intro, so each band reads as a new chapter.
 * `level` picks the rung of the page's outline (web/DESIGN.md, "Headings"):
 *   - `page`: the route's one h1, in the opening section;
 *   - `chapter`: the h2 that opens every other section (the default);
 *   - `sub`: an h3 inside a section ("The latest game", "Further reading").
 */
const sectionHeadingVariants = cva('max-w-3xl', {
  variants: {
    level: {
      page: 'max-w-4xl',
      chapter: '',
      sub: 'max-w-2xl',
    },
    /** Space between the heading block and what follows it. */
    space: {
      default: 'mb-chapter',
      tight: 'mb-8 sm:mb-10',
      none: '',
    },
  },
  defaultVariants: { level: 'chapter', space: 'default' },
});

const TITLE = { page: 'display', chapter: 'chapter', sub: 'subchapter' } as const;

type SectionHeadingProps = VariantProps<typeof sectionHeadingVariants> & {
  /** Id the section's `labelledBy` points to. */
  id: string;
  title: ReactNode;
  /** One or two sentences: what this chapter shows and why it matters. */
  intro?: ReactNode;
  /** At most two quiet `TextLink`s after the intro (`More on the fleet →`). */
  action?: ReactNode;
  className?: string;
};

const SectionHeading = ({
  id,
  title,
  intro,
  action,
  level,
  space,
  className,
}: SectionHeadingProps) => {
  const rung = level ?? 'chapter';
  return (
    <header
      data-slot="section-heading"
      data-level={rung}
      className={cn(sectionHeadingVariants({ level, space }), className)}
    >
      <Typography variant={TITLE[rung]} id={id}>
        {title}
      </Typography>
      {intro && (
        <Typography
          variant="intro"
          className={cn('max-w-2xl', rung === 'page' ? 'mt-8' : rung === 'sub' ? 'mt-3' : 'mt-5')}
        >
          {intro}
        </Typography>
      )}
      {action && (
        <div className={cn('flex flex-wrap gap-x-6 gap-y-2', rung === 'page' ? 'mt-10' : 'mt-5')}>
          {action}
        </div>
      )}
    </header>
  );
};

export { SectionHeading, sectionHeadingVariants };
