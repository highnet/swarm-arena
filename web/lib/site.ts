/** Canonical site facts shared by metadata, sitemap, robots and feeds. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://swarm-arena-race.vercel.app';
export const SITE_NAME = 'Swarm Arena';
export const SITE_TITLE = 'Swarm Arena: four engines, built from nothing, ranked only by games';
export const SITE_DESCRIPTION =
  'A swarm of coding agents writes chess, Go, Othello and Hex engines from empty files. Every version earns its rating against Stockfish, GNU Go and Edax, then against itself. Watch the race, read the code, play the engines.';

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
