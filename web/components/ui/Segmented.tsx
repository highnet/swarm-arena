import type { ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * The tray of a segmented control: a row of `<Button variant="segment">`. It is never wider than
 * its container (#249): on a narrow phone the row scrolls sideways inside the tray instead of
 * widening the page, or wraps where `wrap` asks for it.
 *
 * A scrolling tray clips on both axes (`overflow-x: auto` forces `overflow-y` too), so its 2 px
 * padding would cut off the global focus ring (2 px outline at a 2 px offset). In scroll mode the
 * segments draw their ring inset instead, fully inside the button (important: the global rule is
 * unlayered, so it beats a layered utility).
 */
const segmentedVariants = cva('flex max-w-full gap-0.5 rounded-md p-0.5', {
  variants: {
    tone: {
      sunken: 'bg-bg',
      raised: 'border border-line bg-panel',
    },
    wrap: {
      false:
        'no-scrollbar overflow-x-auto overscroll-x-contain [&>*:focus-visible]:outline-offset-[-2px]!',
      true: 'flex-wrap',
    },
  },
  defaultVariants: { tone: 'sunken', wrap: false },
});

type SegmentedProps = VariantProps<typeof segmentedVariants> & {
  label: string;
  className?: string;
  children: ReactNode;
};

const Segmented = ({ label, tone, wrap, className, children }: SegmentedProps) => (
  <div
    data-slot="segmented"
    role="group"
    aria-label={label}
    className={cn(segmentedVariants({ tone, wrap }), className)}
  >
    {children}
  </div>
);

export { Segmented, segmentedVariants };
