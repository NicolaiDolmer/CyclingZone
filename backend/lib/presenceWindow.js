// #5385: Én kilde til hvor længe en manager regnes som online efter sidste livstegn.
export const ONLINE_WINDOW_MS = 30 * 60 * 1000;

export function isOnlineSince(lastSeen, now = Date.now()) {
  if (!lastSeen) return false;
  const t = new Date(lastSeen).getTime();
  if (Number.isNaN(t)) return false;
  return now - t < ONLINE_WINDOW_MS;
}

export function onlineCutoffIso(now = Date.now()) {
  return new Date(now - ONLINE_WINDOW_MS).toISOString();
}
