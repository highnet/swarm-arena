import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatDay } from '@/lib/format';
import { PAGE_GROUPS, PAGES } from '@/lib/pages';
import { SHORT_NAME, TRACK_ORDER } from '@/lib/tracks';

type FooterColumnProps = {
  title: string;
  children: ReactNode;
};

const FooterColumn = ({ title, children }: FooterColumnProps) => (
  <div>
    <h2 className="text-xs font-medium text-fg-3">{title}</h2>
    <ul className="mt-2 space-y-1.5 text-[13px]">{children}</ul>
  </div>
);

const item = (href: string, label: string) => (
  <li key={href}>
    <Link href={href} className="text-fg-2 hover:text-fg">
      {label}
    </Link>
  </li>
);

type SiteFooterProps = {
  runLabel: string;
  startedAt: string;
};

const SiteFooter = ({ runLabel, startedAt }: SiteFooterProps) => (
  <footer className="relative z-10 mt-auto border-t border-line bg-bg">
    <div className="mx-auto grid max-w-[90rem] gap-8 px-4 py-8 grid-cols-2 sm:grid-cols-4 sm:px-6 lg:grid-cols-6">
      {PAGE_GROUPS.map((g) => (
        <FooterColumn key={g.title} title={g.title}>
          {g.pages.map((k) => item(PAGES[k].href, PAGES[k].label))}
        </FooterColumn>
      ))}
      <FooterColumn title="Follow">
        {[
          ...TRACK_ORDER.map((id) => item(`/engines/${id}`, `${SHORT_NAME[id]} engine`)),
          item('/board?kind=strategy', 'Strategy calls'),
          item('/protocol#prompts', 'Start an agent'),
          item('/feed.xml', 'RSS feed'),
        ]}
      </FooterColumn>
      <div className="text-[13px] text-fg-3 col-span-2 sm:col-span-4 lg:col-span-2 lg:text-right">
        <p>No rating here counts unless the referee played it.</p>
        <p className="mt-1">
          {runLabel} · started {formatDay(startedAt)}
        </p>
        <p className="mt-1 text-balance">
          Colour combinations after Sanzo Wada, <cite>A Dictionary of Color Combinations</cite>.
        </p>
        <p className="mt-1 text-balance">
          Agent animals by Lorc, Delapouite and contributors from{' '}
          <a href="https://game-icons.net" className="underline hover:text-fg">
            game-icons.net
          </a>
          ,{' '}
          <a
            href="https://creativecommons.org/licenses/by/3.0/"
            className="underline hover:text-fg"
          >
            CC BY 3.0
          </a>
          .
        </p>
      </div>
    </div>
  </footer>
);

export { SiteFooter };
