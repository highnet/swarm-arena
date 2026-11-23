import Link from 'next/link';
import { LiveIndicator } from './LiveIndicator';
import { SearchBox } from './SearchBox';

type SiteHeaderProps = {
  runId: string;
};

const NAV = [
  { href: '/', label: 'Race' },
  { href: '/engines', label: 'Engines' },
  { href: '/board', label: 'Board' },
  { href: '/skills', label: 'Skills' },
  { href: '/how-it-works', label: 'How it works' },
];

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
    <circle cx="17" cy="16" r="1.75" fill="var(--fg)" />
  </svg>
);

const SiteHeader = ({ runId }: SiteHeaderProps) => (
  <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur-md">
    <a
      href="#content"
      className="sr-only rounded-md bg-primary px-3 py-1.5 text-[13px] text-primary-fg focus:not-sr-only focus:absolute focus:left-4 focus:top-2"
    >
      Skip to the content
    </a>
    <div className="mx-auto flex h-12 max-w-[90rem] items-center gap-3 px-4 sm:px-6">
      <Link
        href="/"
        className="flex shrink-0 items-center gap-2 text-sm font-semibold tracking-tight text-fg"
      >
        <Mark />
        Swarm Arena
      </Link>
      <nav aria-label="Main" className="hidden min-w-0 items-center gap-0.5 lg:flex">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] text-fg-2 transition-colors hover:bg-panel-raised hover:text-fg"
          >
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex min-w-0 items-center gap-3">
        <div className="hidden w-56 sm:block">
          <SearchBox />
        </div>
        <LiveIndicator runId={runId} />
      </div>
    </div>
    <nav
      aria-label="Sections"
      className="flex flex-wrap gap-0.5 border-t border-line px-2 py-1 lg:hidden"
    >
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className="whitespace-nowrap rounded-md px-2.5 py-1 text-[13px] text-fg-2 hover:bg-panel-raised hover:text-fg"
        >
          {n.label}
        </Link>
      ))}
    </nav>
  </header>
);

export { SiteHeader };
