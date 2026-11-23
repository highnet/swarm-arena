import type { MetadataRoute } from 'next';
import { getSnapshot } from '@/lib/data';
import { snapshotNow } from '@/lib/derive';
import { SITE_URL } from '@/lib/site';
import {
  conceptHref,
  gameHref,
  matchHref,
  messageHref,
  recordHref,
  rungHref,
  taskHref,
} from '@/lib/routes';
import { getConcepts, getSkills } from '@/lib/source';
import { TRACK_ORDER } from '@/lib/tracks';

/** Every public page, and every item's own page: records, versions, ideas, tasks, matches, games, messages, concepts, rungs. */
const sitemap = async (): Promise<MetadataRoute.Sitemap> => {
  const [s, concepts] = await Promise.all([getSnapshot(), getConcepts()]);
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
  const item = (path: string, lastModified: string, priority: number) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    changeFrequency: 'weekly' as const,
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
    page('/messages', 0.7, 'hourly'),
    page('/fleet', 0.7, 'hourly'),
    page('/sessions', 0.6, 'hourly'),
    page('/games', 0.6, 'hourly'),
    page('/versions', 0.6, 'hourly'),
    page('/graveyard', 0.6, 'hourly'),
    page('/rallypoint', 0.7, 'hourly'),
    page('/concepts', 0.7, 'daily'),
    page('/protocol', 0.6, 'daily'),
    page('/skills', 0.6, 'daily'),
    ...(await getSkills()).map((k) => page(`/skills/${k.name}`, 0.5, 'daily')),
    page('/how-it-works', 0.5, 'weekly'),
    ...s.matches
      .filter((m) => m.finished_at)
      .map((m) => item(matchHref(m.id), m.finished_at!, 0.4)),
    ...s.records.map((r) => item(recordHref(r), r.at, r.kind === 'patch_landed' ? 0.5 : 0.3)),
    ...s.tasks.map((t) => item(taskHref(t.id), t.closed_at ?? t.created_at, 0.4)),
    ...s.games.map((g) => item(gameHref(g.id), g.finished_at, 0.2)),
    ...(s.messages ?? []).filter((m) => !m.reply_to).map((m) => item(messageHref(m.id), m.at, 0.2)),
    ...s.rungs.map((r) => item(rungHref(r), r.cleared_at ?? now, 0.3)),
    ...[
      ...new Set([
        ...concepts.vocabulary.map((v) => v.name),
        ...s.tasks.map((t) => t.concept).filter((x): x is string => Boolean(x)),
      ]),
    ].map((n) => page(conceptHref(n), 0.5, 'daily')),
  ];
};

export default sitemap;
