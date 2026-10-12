// #6385: indbakken skjuler bud-beskeder (overbudt / autobud / bud modtaget) for
// en auktion der er afgjort (groupNotifications, TERMINATING_TYPES). Rækker der
// blev skjult FØR backend begyndte at læse dem ved afslutning ligger stadig som
// ULÆSTE og taler med i nav-badgen — "to ulæste, men ingen er markeret".
// Her findes de, så siden kan læse dem stille og tallet bliver sandt.
import { TERMINATING_TYPES, aggregateGroup } from "../../lib/groupNotifications.js";

/**
 * @param {Array<{id: string, type: string, related_id?: string|null, is_read?: boolean}>} notifications
 * @returns {string[]} id'er på ulæste rækker som indbakken ikke længere viser
 */
export function findSupersededUnreadIds(notifications) {
  if (!Array.isArray(notifications) || notifications.length === 0) return [];

  const terminated = new Map();
  for (const n of notifications) {
    if (!n.related_id) continue;
    for (const [group, terminators] of Object.entries(TERMINATING_TYPES)) {
      if (terminators.has(n.type)) {
        if (!terminated.has(group)) terminated.set(group, new Set());
        terminated.get(group).add(n.related_id);
      }
    }
  }
  if (terminated.size === 0) return [];

  const ids = [];
  for (const n of notifications) {
    if (n.is_read || !n.related_id) continue;
    const group = aggregateGroup(n.type);
    if (group && terminated.get(group)?.has(n.related_id)) ids.push(n.id);
  }
  return ids;
}
