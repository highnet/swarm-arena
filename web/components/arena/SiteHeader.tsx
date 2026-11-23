import Link from 'next/link';
import {
  Activity,
  BookOpen,
  Cpu,
  MessagesSquare,
  ScrollText,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { GameId } from '@arena/shared';
import { SHORT_NAME, TRACK_ORDER } from '@/lib/tracks';
import { EngineLogo } from './EngineLogo';
import { LiveIndicator } from './LiveIndicator';
import { SearchBox } from './SearchBox';

type SiteHeaderProps = {
  runId: string;
  working: number;
  slots: Partial<Record<GameId, number>>;
};

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: 'Race', icon: Activity },
  { href: '/engines', label: 'Engines', icon: Cpu },
  { href: '/board', label: 'Board', icon: ScrollText },
  { href: '/messages', label: 'Messages', icon: MessagesSquare },
  { href: '/skills', label: 'Skills', icon: BookOpen },
  { href: '/how-it-works', label: 'How it works', icon: Workflow },
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
    <circle cx="17" cy="16" r="1.75" fill="var(--series-1)" />
  </svg>
);

const navLink =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] text-fg-2 transition-colors hover:bg-panel-raised hover:text-fg';

const SiteHeader = ({ runId, working, slots }: SiteHeaderProps) => (
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
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={navLink}>
            <Icon className="size-3.5 text-fg-3" aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex min-w-0 items-center gap-3">
        <div className="hidden w-56 sm:block">
          <SearchBox />
        </div>
        <LiveIndicator runId={runId} working={working} />
      </div>
    </div>
    <nav
      aria-label="Sections"
      className="flex flex-wrap gap-0.5 border-t border-line px-2 py-1 lg:hidden"
    >
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} className={navLink}>
          <Icon className="size-3.5 text-fg-3" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
    <nav aria-label="Engines" className="border-t border-line">
      <div className="mx-auto flex max-w-[90rem] flex-wrap items-center gap-1 px-2 py-1 sm:px-4">
        {TRACK_ORDER.map((id) => (
          <Link
            key={id}
            href={`/engines/${id}`}
            className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-[13px] text-fg-2 transition-colors hover:bg-panel-raised hover:text-fg"
          >
            <EngineLogo game={id} slot={slots[id] ?? 1} size="sm" />
            {SHORT_NAME[id]}
          </Link>
        ))}
      </div>
    </nav>
  </header>
);

export { SiteHeader };
