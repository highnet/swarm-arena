import type { ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Lets a child of `Section` leave the reading column: `wide` for charts and tables that want
 * room, `full` for edge-to-edge data. It never reaches past the band, so it never scrolls the page.
 */
const fullBleedVariants = cva('min-w-0', {
  variants: {
    width: {
      wide: 'bleed-wide',
      full: 'bleed-full',
    },
  },
  defaultVariants: { width: 'wide' },
});

type FullBleedProps = VariantProps<typeof fullBleedVariants> & {
  className?: string;
  children: ReactNode;
};

const FullBleed = ({ width, className, children }: FullBleedProps) => (
  <div data-slot="full-bleed" className={cn(fullBleedVariants({ width }), className)}>
    {children}
  </div>
);

export { FullBleed, fullBleedVariants };
