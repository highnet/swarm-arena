import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/utils';

type PageSkeletonProps = {
  /** Width and padding of the page's `<main>`, matching the page it stands in for. */
  className?: string;
};

/** Loading state for a whole page: title, lede and a grid of panels. */
const PageSkeleton = ({ className }: PageSkeletonProps) => (
  <main
    aria-busy="true"
    aria-label="Loading"
    className={cn('mx-auto w-full max-w-[90rem] flex-1 px-4 pb-16 pt-8 sm:px-6', className)}
  >
    <Skeleton className="h-7 w-56" />
    <Skeleton className="mt-4 h-4 w-full max-w-xl" />
    <Skeleton className="mt-2 h-4 w-2/3 max-w-md" />
    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <Skeleton variant="panel" className="h-80" />
      <Skeleton variant="panel" className="h-80" />
    </div>
    <Skeleton variant="panel" className="mt-6 h-56" />
  </main>
);

export { PageSkeleton };
