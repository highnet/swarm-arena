import type { NextRequest } from 'next/server';
import { TRACK_ORDER } from '@/lib/tracks';
import { getAllGames, getSnapshot } from '@/lib/data';
import {
  EXPORT_FORMATS,
  FORMAT_GAME,
  FORMAT_MIME,
  exportGames,
  type ExportFormat,
} from '@/lib/gameExport';
import type { GameId } from '@arena/shared';

/** Every game of the run as a file: ?format=json|csv|pgn|sgf and an optional &engine=<id>. */
export const GET = async (req: NextRequest) => {
  const params = req.nextUrl.searchParams;
  const format = (params.get('format') ?? 'json') as ExportFormat;
  if (!EXPORT_FORMATS.includes(format)) {
    return new Response(`Unknown format. Use one of: ${EXPORT_FORMATS.join(', ')}`, {
      status: 400,
    });
  }
  const requested = params.get('engine') as GameId | null;
  if (requested && !TRACK_ORDER.includes(requested)) {
    return new Response(`Unknown engine. Use one of: ${TRACK_ORDER.join(', ')}`, { status: 400 });
  }
  const engine = FORMAT_GAME[format] ?? requested;
  const [s, all] = await Promise.all([getSnapshot(), getAllGames()]);
  const games = engine ? all.filter((g) => g.track_id === engine) : all;
  const name = `swarm-arena-${s.run.id}-${engine ?? 'all'}-games.${format}`;
  return new Response(exportGames(format, s, games), {
    headers: {
      'Content-Type': FORMAT_MIME[format],
      'Content-Disposition': `attachment; filename="${name}"`,
    },
  });
};
