import type { ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[5px] border px-1.5 text-[11px] font-medium leading-5',
  {
    variants: {
      tone: {
        neutral: 'border-line bg-panel-raised text-fg-2',
        sample: 'border-warning/40 bg-warning/10 text-warning',
        good: 'border-good/40 bg-good/10 text-good-text',
        critical: 'border-critical/40 bg-critical/10 text-critical-text',
        outline: 'border-line text-fg-3',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

type BadgeProps = VariantProps<typeof badgeVariants> & {
  className?: string;
  title?: string;
  children: ReactNode;
};

const Badge = ({ tone, className, title, children }: BadgeProps) => (
  <span data-slot="badge" title={title} className={cn(badgeVariants({ tone }), className)}>
    {children}
  </span>
);

export { Badge, badgeVariants };
