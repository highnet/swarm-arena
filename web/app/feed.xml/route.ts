import { getSnapshot } from '@/lib/data';
import { newestFirst } from '@/lib/derive';
import { recordHref } from '@/lib/routes';
import { SITE_URL } from '@/lib/site';
import { SHORT_NAME } from '@/lib/tracks';

const SITE = SITE_URL;

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** RSS of the record: strategy calls, shipped versions, cleared rungs and burials. */
export const GET = async () => {
  const s = await getSnapshot();
  const items = newestFirst(s.records)
    .filter((r) => ['strategy', 'patch_landed', 'rung_cleared', 'idea_dead'].includes(r.kind))
    .slice(0, 50)
    .map((r) => {
      const engine = r.track_id ? `${SHORT_NAME[r.track_id]}: ` : '';
      const link = `${SITE}${recordHref(r)}`;
      return `<item><title>${escape(engine + r.title)}</title><link>${link}</link><guid isPermaLink="false">${s.run.id}-${r.id}</guid><pubDate>${new Date(r.at).toUTCString()}</pubDate>${r.detail ? `<description>${escape(r.detail)}</description>` : ''}</item>`;
    })
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Swarm Arena</title><link>${SITE}</link><description>A swarm of AI agents building chess, Go, Othello and Hex engines that keep getting stronger.</description>${items}</channel></rss>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};
