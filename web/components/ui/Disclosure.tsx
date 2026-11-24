import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Progressive disclosure: the essentials stay on the page, the detail waits one click away
 * (web/DESIGN.md, "Progressive disclosure"). A native <details>, so it works without JavaScript
 * and with the keyboard as is, and the browser's find-in-page opens it.
 *   - `inline`: a quiet summary line under the thing it expands (the homepage's ladders);
 *   - `row`: a full-width hairline row, for a stack of several (a FAQ, a version's details).
 */
const disclosureVariants = cva('group', {
  variants: {
    variant: {
      inline: '',
      row: 'border-b border-line first:border-t',
    },
  },
  defaultVariants: { variant: 'inline' },
});

const SUMMARY = {
  inline: 'inline-flex rounded-md py-1 text-[15px] text-fg-2',
  row: 'flex w-full py-5 text-base font-medium text-fg',
} as const;

type DisclosureProps = VariantProps<typeof disclosureVariants> & {
  /** What opening it shows, as a short phrase ("The ladders, rung by rung"). */
  summary: ReactNode;
  /** Open on first render. */
  open?: boolean;
  className?: string;
  children: ReactNode;
};

const Disclosure = ({ summary, open, variant, className, children }: DisclosureProps) => {
  const kind = variant ?? 'inline';
  return (
    <details
      data-slot="disclosure"
      open={open}
      className={cn(disclosureVariants({ variant }), className)}
    >
      <summary
        className={cn(
          'cursor-pointer list-none items-center gap-1.5 transition-colors duration-150 hover:text-fg [&::-webkit-details-marker]:hidden',
          SUMMARY[kind],
        )}
      >
        <ChevronRight
          className="size-4 shrink-0 transition-transform duration-150 group-open:rotate-90"
          aria-hidden="true"
        />
        {summary}
      </summary>
      <div className={kind === 'row' ? 'pb-6' : 'pt-6'}>{children}</div>
    </details>
  );
};

export { Disclosure, disclosureVariants };
