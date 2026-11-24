import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * A hairline that fills left to right as the page is read. It is driven by the page scroll
 * itself (`animation-timeline: scroll(root)` in `globals.css`), so it costs no script and no
 * layout, and it is hidden for readers who ask for reduced motion. Decorative: the
 * `SectionNav`'s current chapter is what tells assistive technology where the reader is.
 */
const readingProgressVariants = cva('reading-progress pointer-events-none h-px', {
  variants: {
    placement: {
      /** Along the bottom edge of its (positioned) parent, as inside `SectionNav`. */
      edge: 'absolute inset-x-0 -bottom-px',
      /** Pinned under the 48px top bar, for long pages that carry no section nav (articles). */
      bar: 'fixed inset-x-0 top-12 z-30',
    },
  },
  defaultVariants: { placement: 'edge' },
});

type ReadingProgressProps = VariantProps<typeof readingProgressVariants> & {
  className?: string;
};

const ReadingProgress = ({ placement, className }: ReadingProgressProps) => (
  <div
    data-slot="reading-progress"
    aria-hidden="true"
    className={cn(readingProgressVariants({ placement }), className)}
  />
);

export { ReadingProgress, readingProgressVariants };
