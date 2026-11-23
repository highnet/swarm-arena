/**
 * The referee's gate comparison, kept free of I/O so it can be tested without playing games.
 *
 * A candidate's gate rating comes from one opponent (the first uncleared rung). The current
 * version's stored rating may come from a different, easier rung: a sweep of a weak opponent is
 * only a lower bound, often inflated far above what that version would score one rung up. Two
 * ratings from different opponents are not comparable, so when the yardstick can mismatch the
 * current version is rated again on the candidate's rung and the candidate is held to that.
 */

export type Rating = { elo: number; error: number };

/**
 * Whether the current version must be re-rated on the gate rung before the comparison. The rung
 * sits below the stored rating only when that rating was earned elsewhere (a cleared, easier
 * rung) or is an uncleared, noisy rating on this rung; either way re-rating is the fair
 * yardstick. A rung above the stored rating (or no rung, or no rating yet) keeps today's rule.
 */
export const needsRungBaseline = (
  rungElo: number | null,
  currentElo: number | null,
) => rungElo !== null && currentElo !== null && rungElo < currentElo;

/** The rating a candidate must beat: main's same-rung rating when there is one. */
export const gateBaseline = (
  currentElo: number | null,
  sameRung: Rating | null,
): number | null => (sameRung ? sameRung.elo : currentElo);

/** Null when the candidate passes the rating gate, otherwise the burial reason. */
export const gateShortfall = (opts: {
  candidate: Rating;
  currentElo: number | null;
  sameRung: Rating | null;
  rungLabel: string | null;
  currentVersion: string | null;
}): string | null => {
  const { candidate, currentElo, sameRung, rungLabel, currentVersion } = opts;
  const baseline = gateBaseline(currentElo, sameRung);
  if (baseline === null || candidate.elo > baseline) return null;
  const rated = `Rated ${Math.round(candidate.elo)} ± ${Math.round(candidate.error)}`;
  if (!sameRung) return `${rated}, not above ${Math.round(baseline)}.`;
  return `${rated} vs ${rungLabel}; ${currentVersion ?? "main"} rated ${Math.round(sameRung.elo)} ± ${Math.round(sameRung.error)} on the same rung.`;
};
