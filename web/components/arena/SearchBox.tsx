'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';

type SearchBoxProps = {
  placeholder?: string;
};

/** Search the record. "/" focuses it from anywhere on the page. */
const SearchBox = ({ placeholder = 'Search the record' }: SearchBoxProps) => {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key !== '/' || target.closest('input, textarea, [contenteditable]')) return;
      e.preventDefault();
      ref.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <form
      role="search"
      className="relative"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(q.trim() ? `/board?q=${encodeURIComponent(q.trim())}` : '/board');
      }}
    >
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-3"
        aria-hidden="true"
      />
      <input
        ref={ref}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label={placeholder}
        placeholder={placeholder}
        className="h-8 w-full min-w-0 rounded-md border border-line bg-panel pl-8 pr-8 text-[13px] text-fg placeholder:text-fg-3 hover:border-line-strong focus:border-line-strong focus:outline-none"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-line px-1.5 font-mono text-[11px] text-fg-3">
        /
      </kbd>
    </form>
  );
};

export { SearchBox };
