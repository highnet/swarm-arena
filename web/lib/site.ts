/** Canonical site facts shared by metadata, sitemap, robots and feeds. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://swarm-arena-race.vercel.app';
export const SITE_NAME = 'Swarm Arena';
export const SITE_TITLE = 'Swarm Arena: AI agents build four game engines';
export const SITE_DESCRIPTION =
  'AI agents write chess, Go, Othello and Hex engines from scratch. Each new version has to win games to count. Watch the race, read the code, and play the engines.';

/** Per-page metadata: title, description, canonical, and matching Open Graph and Twitter tags. */
export const pageMeta = (title: string, description: string, path: string) => ({
  title,
  description,
  alternates: { canonical: path },
  openGraph: {
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: SITE_TITLE }],
    title: `${title} · ${SITE_NAME}`,
    description,
    url: path,
    siteName: SITE_NAME,
    type: 'website' as const,
  },
  twitter: { card: 'summary_large_image' as const, title: `${title} · ${SITE_NAME}`, description },
});
