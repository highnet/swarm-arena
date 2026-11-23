import Link from 'next/link';
import type { GameId } from '@arena/shared';
import { Breadcrumbs } from './Breadcrumbs';
import { LiveIndicator } from './LiveIndicator';
import { SearchBox } from './SearchBox';
import { MobileNav } from './SiteNav';

type SiteHeaderProps = {
  runId: string;
  working: number;
  slots: Partial<Record<GameId, number>>;
  /** News story titles by slug, for the breadcrumb of a story page. */
  storyTitles: Record<string, string>;
};

const Mark = () => (
  <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true">
    <path
      d="M3 16 7 10l3 3 3-6 4 9"
      fill="none"
      stroke="var(--fg)"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="17" cy="16" r="1.75" fill="var(--series-1)" />
  </svg>
);

/**
 * Top bar: menu (below lg), brand and the breadcrumb trail, search and the live indicator.
 * Navigation lives in the sidebar.
 */
const SiteHeader = ({ runId, working, slots, storyTitles }: SiteHeaderProps) => (
  <header className="group/header sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-md">
    <a
      href="#content"
      className="sr-only rounded-md bg-primary px-3 py-1.5 text-[13px] text-primary-fg focus:not-sr-only focus:absolute focus:left-4 focus:top-2"
    >
      Skip to the content
    </a>
    <div className="flex h-12 items-center gap-3 px-4 sm:px-6">
      <MobileNav slots={slots} />
      <div className="flex min-w-0 items-center gap-1.5">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-sm font-semibold tracking-tight text-fg"
        >
          <Mark />
          {/* Phones keep the mark alone once a trail follows it. */}
          <span className="max-sm:group-has-[[data-slot=breadcrumbs]]/header:sr-only">
            Swarm Arena
          </span>
        </Link>
        <Breadcrumbs titles={storyTitles} />
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <div className="hidden w-56 sm:block">
          <SearchBox />
        </div>
        <LiveIndicator runId={runId} working={working} />
      </div>
    </div>
  </header>
);

export { SiteHeader };
