import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Geist, Geist_Mono } from 'next/font/google';
import { SiteFooter } from '@/components/arena/SiteFooter';
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
        <div id="content" className="flex flex-1 flex-col">
          {children}
        </div>
        <SiteFooter runLabel={snapshot.run.label} startedAt={snapshot.run.started_at} />
      </body>
    </html>
  );
};

export default RootLayout;
