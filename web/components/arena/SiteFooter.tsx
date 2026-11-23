import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatDay } from '@/lib/format';

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
  <footer className="mt-auto border-t border-line">
    <div className="mx-auto grid max-w-[90rem] gap-8 px-4 py-8 sm:grid-cols-3 sm:px-6 lg:grid-cols-[1fr_1fr_1fr_2fr]">
      <FooterColumn title="Site">
        {[
          item('/', 'Race'),
          item('/engines', 'Engines'),
          item('/board', 'Board'),
          item('/how-it-works', 'How it works'),
        ]}
      </FooterColumn>
      <FooterColumn title="About">
        {[
          item('/skills', 'Skills'),
          item('/board?kind=strategy', 'Strategy calls'),
          item('/board?kind=dead', 'Graveyard'),
        ]}
      </FooterColumn>
      <FooterColumn title="Follow">
        {[item('/feed.xml', 'RSS'), item('/engines', 'Follow an engine')]}
      </FooterColumn>
      <div className="text-[13px] text-fg-3 sm:col-span-3 lg:col-span-1 lg:text-right">
        <p>No rating here counts unless the referee played it.</p>
        <p className="mt-1">
          {runLabel} · started {formatDay(startedAt)}
        </p>
      </div>
    </div>
  </footer>
);

export { SiteFooter };
