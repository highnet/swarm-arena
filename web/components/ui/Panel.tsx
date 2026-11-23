import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Typography } from './Typography';

const panelVariants = cva('min-w-0', {
  variants: {
    variant: {
      default: 'rounded-lg border border-line bg-panel',
      flush: 'border-y border-line bg-panel sm:rounded-lg sm:border',
    },
  },
  defaultVariants: { variant: 'default' },
});

type PanelProps = VariantProps<typeof panelVariants> & {
  title?: ReactNode;
  /** Lucide icon shown before the title. */
  icon?: LucideIcon;
  /** Right side of the header: filters, links, counts. */
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
  children: ReactNode;
};

const Panel = ({
  variant,
  title,
  icon: Icon,
  actions,
  className,
  bodyClassName,
  id,
  children,
}: PanelProps) => (
  <section
    data-slot="panel"
    id={id}
    aria-labelledby={id && title ? `${id}-title` : undefined}
    className={cn(panelVariants({ variant }), className)}
  >
    {(title || actions) && (
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-2">
        {title && (
          <Typography
            variant="sectionTitle"
            id={id ? `${id}-title` : undefined}
            className="flex items-center gap-2"
          >
            {Icon && <Icon className="size-4 shrink-0 text-fg-3" aria-hidden="true" />}
            {title}
          </Typography>
        )}
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
    )}
    <div className={bodyClassName}>{children}</div>
  </section>
);

export { Panel, panelVariants };
