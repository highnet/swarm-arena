import type { MetadataRoute } from 'next';
import { getSnapshot } from '@/lib/data';
import { snapshotNow } from '@/lib/derive';
import { SITE_URL } from '@/lib/site';
import { getSkills } from '@/lib/source';
import { TRACK_ORDER } from '@/lib/tracks';

/** Every public page: the race, engines (and their play pages), the board, skills, matches. */
const sitemap = async (): Promise<MetadataRoute.Sitemap> => {
  const s = await getSnapshot();
  const now = snapshotNow(s);
  const page = (
    path: string,
    priority: number,
    changeFrequency: 'hourly' | 'daily' | 'weekly',
  ) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  });
  return [
    page('/', 1, 'hourly'),
    page('/engines', 0.9, 'hourly'),
    ...TRACK_ORDER.flatMap((id) => [
      page(`/engines/${id}`, 0.8, 'hourly'),
      page(`/engines/${id}/play`, 0.7, 'daily'),
    ]),
    page('/board', 0.7, 'hourly'),
    page('/skills', 0.6, 'daily'),
    ...(await getSkills()).map((k) => page(`/skills/${k.name}`, 0.5, 'daily')),
    page('/how-it-works', 0.5, 'weekly'),
    ...s.matches
      .filter((m) => m.finished_at)
      .map((m) => ({
        url: `${SITE_URL}/matches/${m.id}`,
        lastModified: m.finished_at!,
        changeFrequency: 'weekly' as const,
        priority: 0.4,
      })),
  ];
};

export default sitemap;
