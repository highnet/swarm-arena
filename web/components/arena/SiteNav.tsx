'use client';

import { Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import type { GameId } from '@arena/shared';
import { Button } from '@/components/ui/Button';
import { PAGE_GROUPS, PAGES } from '@/lib/pages';
import { SHORT_NAME, TRACK_ORDER } from '@/lib/tracks';
import { cn } from '@/lib/utils';
import { EngineLogo } from './EngineLogo';
import { SearchBox } from './SearchBox';

/** Every top-level page on the site, grouped. */
const GROUPS = PAGE_GROUPS.map((g) => ({ title: g.title, items: g.pages.map((k) => PAGES[k]) }));

const STORAGE_KEY = 'sidebar';

/** Runs before paint so a collapsed sidebar never flashes open. */
const SIDEBAR_INIT_SCRIPT = `try{if(localStorage.getItem('${STORAGE_KEY}')==='collapsed')document.documentElement.dataset.sidebar='collapsed'}catch(e){}`;

/** `pathname` is null while it is unknown (the prerendered shell): nothing is marked active. */
const isActive = (pathname: string | null, href: string) =>
  pathname !== null &&
  (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));

type Slots = Partial<Record<GameId, number>>;

type NavLinksProps = {
  slots: Slots;
  pathname: string | null;
  /** Desktop sidebar: hide labels when the sidebar is collapsed. */
  collapsible?: boolean;
};

const NavLinks = ({ slots, pathname, collapsible = false }: NavLinksProps) => {
  const label = collapsible ? 'sidebar-collapsed:sr-only' : undefined;
  const link = (active: boolean) =>
    cn(
      'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors',
      collapsible && 'sidebar-collapsed:justify-center sidebar-collapsed:px-0',
      active ? 'bg-panel-raised text-fg' : 'text-fg-2 hover:bg-panel-raised hover:text-fg',
    );
  const heading = cn(
    'px-2.5 pb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-3',
    collapsible && 'sidebar-collapsed:sr-only',
  );

  return (
    <div className="flex flex-col gap-4">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <h2 className={heading}>{g.title}</h2>
          <ul className="flex flex-col gap-0.5">
            {g.items.map(({ href, label: text, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    title={text}
                    aria-current={active ? 'page' : undefined}
                    className={link(active)}
                  >
                    <Icon
                      className={cn('size-4 shrink-0', active ? 'text-fg' : 'text-fg-3')}
                      aria-hidden="true"
                    />
                    <span className={label}>{text}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div>
        <h2 className={heading}>Engines</h2>
        <ul className="flex flex-col gap-0.5">
          {TRACK_ORDER.map((id) => {
            const href = `/engines/${id}`;
            const active = isActive(pathname, href);
            return (
              <li key={id}>
                <Link
                  href={href}
                  title={SHORT_NAME[id]}
                  aria-current={active ? 'page' : undefined}
                  className={link(active)}
                >
                  <EngineLogo game={id} slot={slots[id] ?? 1} size="sm" />
                  <span className={label}>{SHORT_NAME[id]}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

type ActiveNavLinksProps = Omit<NavLinksProps, 'pathname'>;

/** Reads the URL, so it must render inside <Suspense> (see Sidebar). */
const ActiveNavLinks = (props: ActiveNavLinksProps) => (
  <NavLinks {...props} pathname={usePathname()} />
);

type SidebarProps = {
  slots: Slots;
};

/** Desktop: fixed under the header, collapses to an icon rail. The choice is remembered. */
const Sidebar = ({ slots }: SidebarProps) => {
  // The state lives on <html> (set before paint), so CSS picks the icon and label.
  const toggle = () => {
    const root = document.documentElement;
    const next = root.dataset.sidebar !== 'collapsed';
    if (next) root.dataset.sidebar = 'collapsed';
    else delete root.dataset.sidebar;
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'collapsed' : 'open');
    } catch {}
  };

  return (
    <aside
      aria-label="Site"
      className="fixed bottom-0 left-0 top-12 z-20 hidden w-56 flex-col border-r border-line bg-bg/90 backdrop-blur-md transition-[width] duration-200 lg:flex sidebar-collapsed:w-14"
    >
      <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-4">
        <Suspense fallback={<NavLinks slots={slots} pathname={null} collapsible />}>
          <ActiveNavLinks slots={slots} collapsible />
        </Suspense>
      </nav>
      <div className="border-t border-line p-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          className="w-full justify-start sidebar-collapsed:justify-center sidebar-collapsed:px-0"
        >
          <PanelLeftClose
            className="size-4 text-fg-3 sidebar-collapsed:hidden"
            aria-hidden="true"
          />
          <PanelLeftOpen
            className="hidden size-4 text-fg-3 sidebar-collapsed:block"
            aria-hidden="true"
          />
          <span className="sidebar-collapsed:hidden">Collapse sidebar</span>
          <span className="hidden sidebar-collapsed:sr-only sidebar-collapsed:block">
            Expand sidebar
          </span>
        </Button>
      </div>
    </aside>
  );
};

type MobileNavDrawerProps = {
  slots: Slots;
};

const MobileNavDrawer = ({ slots }: MobileNavDrawerProps) => {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [openedAt, setOpenedAt] = useState(pathname);

  // Close when navigation lands on a new page.
  if (open && pathname !== openedAt) {
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <Button
        variant="icon"
        size="icon"
        className="-ml-1.5 lg:hidden"
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => {
          setOpenedAt(pathname);
          setOpen(true);
        }}
      >
        <Menu className="size-5" aria-hidden="true" />
      </Button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-40 lg:hidden">
            <div
              className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
              aria-hidden="true"
              onClick={() => setOpen(false)}
            />
            <div
              id="mobile-nav"
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line bg-bg shadow-2xl"
            >
              <div className="flex h-12 items-center justify-between border-b border-line px-4">
                <span className="text-sm font-semibold tracking-tight text-fg">Swarm Arena</span>
                <Button
                  variant="icon"
                  size="icon"
                  className="-mr-1.5"
                  aria-label="Close menu"
                  onClick={() => setOpen(false)}
                  autoFocus
                >
                  <X className="size-5" aria-hidden="true" />
                </Button>
              </div>
              <div className="border-b border-line p-3 sm:hidden">
                <SearchBox />
              </div>
              <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto px-2 py-4">
                <NavLinks slots={slots} pathname={pathname} />
              </nav>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};

type MobileNavProps = {
  slots: Slots;
};

/**
 * Below lg: a hamburger that opens the same links in a drawer. The drawer reads the URL, so it
 * renders inside <Suspense>; the prerendered shell shows the same button, inert until hydration.
 */
const MobileNav = ({ slots }: MobileNavProps) => (
  <Suspense
    fallback={
      <Button
        variant="icon"
        size="icon"
        className="-ml-1.5 lg:hidden"
        aria-label="Open menu"
        disabled
      >
        <Menu className="size-5" aria-hidden="true" />
      </Button>
    }
  >
    <MobileNavDrawer slots={slots} />
  </Suspense>
);

export { Sidebar, MobileNav, SIDEBAR_INIT_SCRIPT };
