import type { ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * One chapter of a long, vertical page: a full-width band that answers one question. Bands
 * separate by tone and whitespace, never by borders or cards. Children sit in the content
 * column of `.section-grid`; wrap a chart or table in `FullBleed` to give it more width.
 */
const sectionVariants = cva('section-grid relative scroll-mt-24', {
  variants: {
    tone: {
      plain: 'bg-bg',
      band: 'bg-band',
    },
    space: {
      compact: 'py-14 sm:py-20',
      default: 'py-20 sm:py-28',
      roomy: 'py-24 sm:py-36',
    },
    /** `screen`: at least most of a viewport, content centred; for an opening chapter. */
    fill: {
      none: '',
      screen: 'min-h-[calc(100svh-8rem)] content-center',
    },
  },
  defaultVariants: { tone: 'plain', space: 'default', fill: 'none' },
});

type SectionProps = VariantProps<typeof sectionVariants> & {
  /** Anchor for `SectionNav` and links (`#engines`). */
  id: string;
  /** Id of the heading that names this section. */
  labelledBy: string;
  className?: string;
  children: ReactNode;
};

const Section = ({ id, labelledBy, tone, space, fill, className, children }: SectionProps) => (
  <section
    data-slot="section"
    data-section-tone={tone ?? 'plain'}
    id={id}
    aria-labelledby={labelledBy}
    className={cn(sectionVariants({ tone, space, fill }), className)}
  >
    {children}
  </section>
);

export { Section, sectionVariants };
