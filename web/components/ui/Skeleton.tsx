import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const skeletonVariants = cva('block animate-skeleton', {
  variants: {
    variant: {
      line: 'h-3 rounded-[5px] bg-panel-raised',
      block: 'rounded-lg bg-panel-raised',
      panel: 'rounded-lg border border-line bg-panel',
    },
  },
  defaultVariants: { variant: 'line' },
});

type SkeletonProps = VariantProps<typeof skeletonVariants> & {
  className?: string;
};

/** A placeholder shape shown while content streams in. Hidden from assistive tech. */
const Skeleton = ({ variant, className }: SkeletonProps) => (
  <span
    data-slot="skeleton"
    aria-hidden="true"
    className={cn(skeletonVariants({ variant }), className)}
  />
);

export { Skeleton, skeletonVariants };
