'use client';

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { cn } from '@/lib/utils';
import { ReadingProgress } from './ReadingProgress';

export type SectionNavItem = {
  /** The section's `id`. */
  id: string;
  label: string;
};

type SectionNavProps = {
  items: SectionNavItem[];
  /** Accessible name of the navigation landmark. */
  label?: string;
  /** Show the hairline of reading progress along the nav's bottom edge. */
  progress?: boolean;
  className?: string;
};

/** How long a click owns the active state while the page glides to its section. */
const CLICK_HOLD_MS = 900;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Sticky table of contents for a long, vertical page (web/DESIGN.md, "Wayfinding"). It sits
 * under the site header and marks the section being read with `aria-current="location"`.
 *
 * Anchor scrolling: links are real `#id` anchors, so they work without JavaScript, open in a new
 * tab and update the URL. With JavaScript, a click marks its target at once (instead of lighting
 * every section the page glides past), scrolls smoothly only when the reader allows motion, moves
 * keyboard focus to the section, and keeps the current link in view on the phone's sideways list.
 * A page that loads with a hash lands on that section, and the observer marks it; at the very
 * bottom the last section is current, even when it is too short to reach the reading line.
 */
const SectionNav = ({
  items,
  label = 'On this page',
  progress = true,
  className,
}: SectionNavProps) => {
  const [active, setActive] = useState(items[0]?.id);
  const listRef = useRef<HTMLUListElement>(null);
  const heldUntil = useRef(0);

  useEffect(() => {
    const sections = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const visible = new Map<string, boolean>();
    const atBottom = () =>
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    const update = () => {
      if (Date.now() < heldUntil.current) return;
      if (atBottom()) {
        setActive(sections[sections.length - 1].id);
        return;
      }
      const first = sections.find((s) => visible.get(s.id));
      if (first) setActive(first.id);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting);
        update();
      },
      // A section counts as "being read" while it crosses a band just under the nav.
      { rootMargin: '-15% 0px -75% 0px' },
    );
    sections.forEach((s) => observer.observe(s));
    window.addEventListener('scroll', update, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', update);
    };
  }, [items]);

  // Keep the current link visible in the sideways-scrolling list on phones, without moving the page.
  useEffect(() => {
    const list = listRef.current;
    const link = list?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!list || !link || list.scrollWidth <= list.clientWidth) return;
    const left = link.offsetLeft - (list.clientWidth - link.offsetWidth) / 2;
    list.scrollTo({ left, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [active]);

  const onClick = useCallback((e: MouseEvent<HTMLAnchorElement>, id: string) => {
    // Leave modified clicks (new tab, new window) to the browser.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    const target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    heldUntil.current = Date.now() + CLICK_HOLD_MS;
    setActive(id);
    target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    // Move the keyboard's starting point too, as a plain anchor jump would.
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    window.history.replaceState(null, '', `#${id}`);
  }, []);

  return (
    <nav
      data-slot="section-nav"
      aria-label={label}
      className={cn('sticky top-12 z-20 border-b border-line bg-bg/90 backdrop-blur-md', className)}
    >
      <div className="section-grid">
        <ul
          ref={listRef}
          className="no-scrollbar -mx-2.5 flex gap-1 overflow-x-auto [mask-image:linear-gradient(to_right,black_85%,transparent)] sm:[mask-image:none]"
        >
          {items.map((i) => (
            <li key={i.id} className="shrink-0">
              <a
                href={`#${i.id}`}
                onClick={(e) => onClick(e, i.id)}
                aria-current={active === i.id ? 'location' : undefined}
                className="relative inline-flex h-11 items-center px-2.5 text-[13px] text-fg-3 transition-colors duration-150 hover:text-fg aria-[current]:text-fg after:absolute after:inset-x-2.5 after:bottom-0 after:h-px after:bg-transparent aria-[current]:after:bg-fg"
              >
                {i.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
      {progress && <ReadingProgress placement="edge" />}
    </nav>
  );
};

export { SectionNav };
