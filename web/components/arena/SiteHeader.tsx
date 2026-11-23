import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { LiveIndicator } from './LiveIndicator';

type SiteHeaderProps = {
  runId: string;
  isSample: boolean;
};

const NAV = [
  { href: '/', label: 'Race' },
  { href: '/#board', label: 'Board' },
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

const SiteHeader = ({ runId, isSample }: SiteHeaderProps) => (
  <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur-md">
    <div className="mx-auto flex h-12 max-w-[90rem] items-center gap-4 px-4 sm:px-6">
      <Link
        href="/"
        className="flex items-center gap-2 text-sm font-semibold tracking-tight text-fg"
      >
        <Mark />
        Swarm Arena
      </Link>
      {isSample && (
        <Badge tone="sample" title="Synthetic data showing the format. A real run replaces it.">
          Sample data
        </Badge>
      )}
      <nav aria-label="Main" className="ml-auto flex items-center gap-1">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className="hidden rounded-md px-2.5 py-1.5 text-[13px] text-fg-2 transition-colors hover:bg-panel-raised hover:text-fg sm:block"
          >
            {n.label}
          </Link>
        ))}
        <span className="mx-2 hidden h-4 w-px bg-line sm:block" />
        <LiveIndicator runId={runId} isSample={isSample} />
      </nav>
    </div>
  </header>
);

export { SiteHeader };
