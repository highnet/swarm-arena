const timeFmt = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});
const dayFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

export const formatTime = (iso: string) => `${timeFmt.format(new Date(iso))}`;
export const formatDay = (iso: string) => dayFmt.format(new Date(iso));
export const formatElo = (elo: number | null | undefined) =>
  elo === null || elo === undefined ? '—' : Math.round(elo).toLocaleString('en-US');
export const formatInt = (n: number) => n.toLocaleString('en-US');

/** "41h 12m" between two instants. */
export const formatSpan = (fromIso: string, toIso: string) => {
  const ms = Math.max(0, Date.parse(toIso) - Date.parse(fromIso));
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h ? `${h}h ${m}m` : `${m}m`;
};
