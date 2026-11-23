import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Geist, Geist_Mono } from 'next/font/google';
import { SiteFooter } from '@/components/arena/SiteFooter';
import { SiteHeader } from '@/components/arena/SiteHeader';
import { getSnapshot } from '@/lib/data';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from '@/lib/site';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    'agent swarm',
    'coding agents',
    'game engines',
    'chess engine',
    'Go engine',
    'Othello engine',
    'Hex engine',
    'Elo',
    'Stockfish',
    'GNU Go',
    'Edax',
  ],
  alternates: {
    canonical: '/',
    types: { 'application/rss+xml': [{ url: '/feed.xml', title: `${SITE_NAME} record` }] },
  },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: '/',
    locale: 'en_US',
  },
  twitter: { card: 'summary_large_image', title: SITE_TITLE, description: SITE_DESCRIPTION },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#101116',
  colorScheme: 'dark',
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
