'use client';

import { Fragment, Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { GameId } from '@arena/shared';
import { SHORT_NAME } from '@/lib/tracks';
import { cn } from '@/lib/utils';

export type Crumb = {
  label: string;
  /** Omitted when the path has no page of its own (e.g. /engines/chess/ladder). */
  href?: string;
  /** An id rather than a name: set in mono, and replaced by the page's own title once known. */
  opaque?: boolean;
};

/** Top-level sections. No `href` marks a prefix with no index page of its own. */
const SECTIONS: Record<string, { label: string; href?: string }> = {
  engines: { label: 'Engines', href: '/engines' },
  games: { label: 'Games', href: '/games' },
  matches: { label: 'Games', href: '/games' },
  versions: { label: 'Versions', href: '/versions' },
  graveyard: { label: 'Ideas buried', href: '/graveyard' },
  news: { label: 'News', href: '/news' },
  fleet: { label: 'Fleet', href: '/fleet' },
  sessions: { label: 'Sessions', href: '/sessions' },
  rallypoint: { label: 'Rallypoint', href: '/rallypoint' },
  board: { label: 'Board', href: '/board' },
  messages: { label: 'Messages', href: '/messages' },
  'how-it-works': { label: 'How it works', href: '/how-it-works' },
  protocol: { label: 'Protocol', href: '/protocol' },
  concepts: { label: 'Concepts', href: '/concepts' },
  skills: { label: 'Skills', href: '/skills' },
  tasks: { label: 'Tasks' },
};

const engineName = (id: string) => SHORT_NAME[id as GameId] ?? id;
const engineIn = (id: string) =>
  (Object.keys(SHORT_NAME) as GameId[]).find((g) => id.includes(`-${g}-`)) ?? null;
const short = (id: string) => (id.length > 12 ? `…${id.slice(-8)}` : id);

/** The trail for a path, from the section down to the page. Pure, so it renders on the server too. */
const crumbsFor = (pathname: string, titles: Record<string, string>): Crumb[] => {
  const seg = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (seg.length === 0) return [];
  const [section, a, b, c] = seg;
  // Tasks and matches belong to an engine, named inside their id (`run-001-othello-mwtp…`).
  const owner = (section === 'tasks' || section === 'matches') && a ? engineIn(a) : null;
  if (owner) {
    return [
      SECTIONS.engines,
      { label: engineName(owner), href: `/engines/${owner}` },
      {
        label: section === 'tasks' ? `Task ${short(a)}` : `Match ${short(a)}`,
        href: pathname,
        opaque: true,
      },
    ];
  }
  // A game's id is its match's id plus its number (`run-001-chess-mwt4t2zv-g2`).
  const game =
    section === 'games' && a ? /^(.*-(?:chess|go9|othello|hex)-[^-]+)-g(\d+)$/.exec(a) : null;
  const gameOwner = game ? engineIn(game[1]) : null;
  if (game && gameOwner) {
    return [
      SECTIONS.engines,
      { label: engineName(gameOwner), href: `/engines/${gameOwner}` },
      {
        label: `Match ${short(game[1])}`,
        href: `/matches/${encodeURIComponent(game[1])}`,
        opaque: true,
      },
      { label: `Game ${game[2]}`, href: pathname },
    ];
  }
  const top = SECTIONS[section] ?? { label: section.replace(/-/g, ' ') };
  const crumbs: Crumb[] = [top];
  if (a === undefined) return crumbs;

  switch (section) {
    case 'engines':
      crumbs.push({ label: engineName(a), href: `/engines/${a}` });
      if (b === 'play') crumbs.push({ label: 'Play', href: `/engines/${a}/play` });
      if (b === 'ladder') {
        crumbs.push({ label: 'Ladder' });
        if (c !== undefined)
          crumbs.push({ label: `Rung ${c}`, href: `/engines/${a}/ladder/${c}`, opaque: true });
      }
      break;
    case 'versions':
      crumbs.push({ label: engineName(a), href: `/engines/${a}` });
      if (b !== undefined) crumbs.push({ label: b, href: pathname });
      break;
    case 'news':
      crumbs.push({ label: titles[a] ?? a, href: pathname, opaque: !titles[a] });
      break;
    case 'games':
      crumbs.push({ label: `Game ${short(a)}`, href: pathname, opaque: true });
      break;
    case 'matches':
      crumbs.push({ label: `Match ${short(a)}`, href: pathname, opaque: true });
      break;
    case 'messages':
    case 'graveyard':
    case 'board':
      crumbs.push({ label: `#${a}`, href: pathname, opaque: true });
      break;
    default:
      crumbs.push({ label: a, href: pathname, opaque: true });
  }
  return crumbs;
};

/** The current page's own name, from its <title> (`Name · Swarm Arena`). */
const useDocumentTitle = (pathname: string) => {
  const [title, setTitle] = useState<{ path: string; text: string } | null>(null);
  const lastPathTitle = useRef<string | null>(null);

  useEffect(() => {
    const clean = () => document.title.replace(/\s·\s[^·]+$/, '').trim();
    const stale = lastPathTitle.current;
    const read = () => {
      const text = clean();
      // Right after a client navigation the old page's title is still up: wait for the new one.
      // Later mutations that leave the title alone change nothing.
      if (text === stale || text === lastPathTitle.current) return;
      lastPathTitle.current = text;
      setTitle({ path: pathname, text });
    };
    read();
    // Streamed metadata can land in <body>, so watch the whole document for the <title>.
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    return () => obs.disconnect();
  }, [pathname]);

  return title?.path === pathname ? title.text : null;
};

type BreadcrumbTrailProps = {
  pathname: string;
  titles: Record<string, string>;
};

const BreadcrumbTrail = ({ pathname, titles }: BreadcrumbTrailProps) => {
  const pageTitle = useDocumentTitle(pathname);
  const crumbs = crumbsFor(pathname, titles);
  if (crumbs.length === 0) return null;
  const last = crumbs.length - 1;
  // `Hex ladder: MCTS 2000` under Hex / Ladder reads as just `MCTS 2000`.
  const named =
    pageTitle && !/^\d{3}\b/.test(pageTitle)
      ? pageTitle.replace(/^([^:]+):\s+/, (all, head: string) =>
          crumbs.some((c) => head.startsWith(c.label)) ? '' : all,
        )
      : null;
  if (crumbs[last].opaque && named) crumbs[last] = { ...crumbs[last], label: named, opaque: false };

  return (
    <nav aria-label="Breadcrumb" data-slot="breadcrumbs" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-[13px]">
        {crumbs.map((c, i) => {
          const current = i === last;
          // The brand stands for everything above: phones show the page, tablets add its parent.
          const visibility = cn(
            i < last - 1 && 'hidden md:block',
            i === last - 1 && 'hidden sm:block',
          );
          const text = (
            <span className={cn('block truncate', c.opaque && 'font-mono text-xs tabular')}>
              {c.label}
            </span>
          );
          return (
            <Fragment key={`${i}-${c.label}`}>
              <li aria-hidden="true" className={cn('select-none text-fg-3/50', visibility)}>
                /
              </li>
              <li
                className={cn(
                  'min-w-0',
                  current ? 'max-w-[28rem] shrink' : 'max-w-48 shrink-[2]',
                  visibility,
                )}
              >
                {current ? (
                  <span aria-current="page" className="block min-w-0 text-fg" title={c.label}>
                    {text}
                  </span>
                ) : c.href ? (
                  <Link
                    href={c.href}
                    className="block min-w-0 rounded-md px-1 py-0.5 text-fg-2 transition-colors hover:bg-panel-raised hover:text-fg"
                  >
                    {text}
                  </Link>
                ) : (
                  <span className="block min-w-0 px-1 text-fg-3">{text}</span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
};

type ActiveBreadcrumbsProps = {
  titles: Record<string, string>;
};

/** Reads the URL, so it must render inside <Suspense> (see Breadcrumbs). */
const ActiveBreadcrumbs = ({ titles }: ActiveBreadcrumbsProps) => (
  <BreadcrumbTrail pathname={usePathname()} titles={titles} />
);

type BreadcrumbsProps = {
  /** News story titles by slug: the only names the URL cannot carry and every page can use. */
  titles: Record<string, string>;
};

/**
 * Where this page sits, after the brand in the top bar: Engines / Chess / Ladder / Rung 3. Built
 * from the URL; a page named by an id swaps in its own title once the browser has it.
 */
const Breadcrumbs = ({ titles }: BreadcrumbsProps) => (
  <Suspense fallback={null}>
    <ActiveBreadcrumbs titles={titles} />
  </Suspense>
);

export { Breadcrumbs, crumbsFor };
