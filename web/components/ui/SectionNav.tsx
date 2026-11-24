'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export type SectionNavItem = {
  /** The section's `id`. */
  id: string;
  label: string;
};

type SectionNavProps = {
  items: SectionNavItem[];
  /** Accessible name of the navigation landmark. */
  label?: string;
  className?: string;
};

/**
 * Sticky table of contents for a long, vertical page. It sits under the site header, marks the
 * section being read (`aria-current`) and carries a hairline reading-progress bar. Anchor links
 * scroll smoothly only when the reader allows motion (see `globals.css`).
 */
const SectionNav = ({ items, label = 'On this page', className }: SectionNavProps) => {
  const [active, setActive] = useState(items[0]?.id);

  useEffect(() => {
    const sections = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;
    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting);
        const first = sections.find((s) => visible.get(s.id));
        if (first) setActive(first.id);
      },
      // A section counts as "being read" while it crosses a band just under the nav.
      { rootMargin: '-15% 0px -75% 0px' },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav
      data-slot="section-nav"
      aria-label={label}
      className={cn('sticky top-12 z-20 border-b border-line bg-bg/90 backdrop-blur-md', className)}
    >
      <div className="section-grid">
        <ul className="no-scrollbar -mx-2.5 flex gap-1 overflow-x-auto [mask-image:linear-gradient(to_right,black_85%,transparent)] sm:[mask-image:none]">
          {items.map((i) => (
            <li key={i.id} className="shrink-0">
              <a
                href={`#${i.id}`}
                aria-current={active === i.id ? 'location' : undefined}
                className="relative inline-flex h-11 items-center px-2.5 text-[13px] text-fg-3 transition-colors duration-150 hover:text-fg aria-[current]:text-fg after:absolute after:inset-x-2.5 after:bottom-0 after:h-px after:bg-transparent aria-[current]:after:bg-fg"
              >
                {i.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
      <div aria-hidden="true" className="reading-progress absolute inset-x-0 -bottom-px h-px" />
    </nav>
  );
};

export { SectionNav };
