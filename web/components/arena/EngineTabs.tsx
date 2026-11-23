import Link from 'next/link';
import { Gamepad2, LayoutDashboard } from 'lucide-react';
import type { GameId } from '@arena/shared';
import { cn } from '@/lib/utils';

type EngineTabsProps = {
  current: GameId;
  view: 'overview' | 'play';
};

/** Switch between an engine's overview and playing it (the header switches engines). */
const EngineTabs = ({ current, view }: EngineTabsProps) => (
  <div data-slot="engine-tabs" className="flex justify-end border-b border-line pb-4">
    <nav aria-label="Engine views" className="flex gap-0.5 rounded-md bg-panel p-0.5">
      {(
        [
          { id: 'overview', label: 'Overview', icon: LayoutDashboard, href: `/engines/${current}` },
          { id: 'play', label: 'Play', icon: Gamepad2, href: `/engines/${current}/play` },
        ] as const
      ).map(({ id, label, icon: Icon, href }) => (
        <Link
          key={id}
          href={href}
          aria-current={view === id ? 'page' : undefined}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-[5px] px-3 py-1 text-[13px] transition-colors',
            view === id
              ? 'bg-panel-raised text-fg shadow-[0_1px_2px_rgb(0_0_0/0.4)]'
              : 'text-fg-3 hover:text-fg',
          )}
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  </div>
);

export { EngineTabs };
