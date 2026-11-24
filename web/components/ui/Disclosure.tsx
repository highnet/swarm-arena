import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

type DisclosureProps = {
  /** What opening it shows, as a short phrase ("The ladders, rung by rung"). */
  summary: ReactNode;
  /** Open on first render. */
  open?: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * Progressive disclosure: the essentials stay on the page, the detail waits one click away.
 * A native <details>, so it works without JavaScript and with the keyboard as is.
 */
const Disclosure = ({ summary, open, className, children }: DisclosureProps) => (
  <details data-slot="disclosure" open={open} className={cn('group', className)}>
    <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md py-1 text-[15px] text-fg-2 transition-colors duration-150 hover:text-fg [&::-webkit-details-marker]:hidden">
      <ChevronRight
        className="size-4 shrink-0 transition-transform duration-150 group-open:rotate-90"
        aria-hidden="true"
      />
      {summary}
    </summary>
    <div className="pt-6">{children}</div>
  </details>
);

export { Disclosure };
