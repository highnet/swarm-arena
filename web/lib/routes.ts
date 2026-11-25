import type { BoardRecord, GameId, Rung } from '@arena/shared';

/** One place for every item's own page, so lists link the same way everywhere. */

/** `v0.4 shipped: …` → `v0.4`. */
export const versionOf = (r: Pick<BoardRecord, 'title'>) => r.title.split(' ')[0];

export const taskHref = (id: string) => `/tasks/${encodeURIComponent(id)}`;
export const matchHref = (id: string) => `/matches/${encodeURIComponent(id)}`;
export const gameHref = (id: string) => `/games/${encodeURIComponent(id)}`;
/**
 * Where an engine board links (#262). A stored game opens its own page. A game still being played
 * has no `games` row yet, so `/games/<id>` would 404 until it ends: it opens its match's games
 * instead (the match row is written before its first game starts), or, for an `arena versus`
 * game, which has no match, the engine's page.
 */
export const boardHref = (
  game: { id: string; track: GameId; matchId: string | null },
  stored: boolean,
) =>
  stored
    ? gameHref(game.id)
    : game.matchId
      ? `${matchHref(game.matchId)}#games`
      : `/engines/${game.track}`;
export const messageHref = (id: number) => `/messages/${id}`;
export const ideaHref = (id: number) => `/graveyard/${id}`;
export const versionHref = (track: GameId, version: string) =>
  `/versions/${track}/${encodeURIComponent(version)}`;
export const rungHref = (r: Pick<Rung, 'track_id' | 'position'>) =>
  `/engines/${r.track_id}/ladder/${r.position}`;

export const conceptSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
export const conceptHref = (name: string) => `/concepts/${conceptSlug(name)}`;

/** A board record's own page: shipped versions and buried ideas have dedicated ones. */
export const recordHref = (
  r: Pick<BoardRecord, 'id' | 'kind' | 'title'> & { track_id?: GameId | null },
) => {
  if (r.kind === 'patch_landed' && r.track_id) return versionHref(r.track_id, versionOf(r));
  if (r.kind === 'idea_dead') return ideaHref(r.id);
  return `/board/${r.id}`;
};
