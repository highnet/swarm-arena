import type { Agent } from "./model";

/**
 * A seat that says it is working but has not been heard from in this long is stale, not at work.
 * The one threshold the harness (which seat a new session may take) and the site (who is working
 * now) both use.
 */
export const SEAT_STALE_MS = 45 * 60 * 1000;

/** The threshold in words, for tooltips and briefs. */
export const SEAT_STALE_TEXT = `${Math.round(SEAT_STALE_MS / 60000)} minutes`;

/** A seat is live at `asOfMs` while it says it is working and has been heard from recently. */
export const seatIsLive = (
  a: Pick<Agent, "status" | "last_seen">,
  asOfMs: number,
) =>
  a.status === "working" && asOfMs - Date.parse(a.last_seen) <= SEAT_STALE_MS;
