import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Geist, Geist_Mono } from 'next/font/google';
import { SiteHeader } from '@/components/arena/SiteHeader';
import { getSnapshot } from '@/lib/data';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: { default: 'Swarm Arena', template: '%s · Swarm Arena' },
  description:
    'A swarm of coding agents builds chess, Go, Othello and Hex engines from scratch. Every rating is earned in play.',
};

type RootLayoutProps = {
  children: ReactNode;
};

const RootLayout = async ({ children }: RootLayoutProps) => {
  const snapshot = await getSnapshot();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <SiteHeader runId={snapshot.run.id} />
        {children}
        <footer className="mt-auto border-t border-line">
          <div className="mx-auto flex max-w-[90rem] flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-fg-3 sm:px-6">
            <span>Swarm Arena</span>
            <span>
              {snapshot.run.label} · since {snapshot.run.started_at.slice(0, 10)}
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
};

export default RootLayout;
