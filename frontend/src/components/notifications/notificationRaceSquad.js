// #8853 · Indbakken skal vise tydeligt, om en løbsbesked handler om et U23-
// eller juniorløb. Beskeden selv bærer ikke løbets niveau, men den bærer
// løbets id (metadata.raceId, eller related_id på løbsbeskeder, samme kilde
// som lib/notificationLink.js). Niveauet slås derfor op i races.squad med ét
// samlet opslag for hele listen — aldrig gættet ud fra løbsnavnet.
//
// Ren modul uden React, så node --test kan loade det.

// Beskedtyper hvor related_id ER løbets id (spejler lib/notificationLink.js).
const RACE_RELATED_TYPES = new Set([
  "race_result",
  "stage_result",
  "selection_warning",
  "assistant_filled_squad",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asRaceId(value) {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

/** Løbets id for én enkelt besked, eller null. */
export function notificationRaceId(n) {
  if (!n) return null;
  return asRaceId(n.metadata?.raceId)
    ?? (RACE_RELATED_TYPES.has(n.type) ? asRaceId(n.related_id) : null);
}

/** Løbets id for en samlet bøtte (groupNotifications), eller null. */
export function aggregateRaceId(entry) {
  if (!entry) return null;
  return asRaceId(entry.sample_metadata?.raceId)
    ?? asRaceId(entry.related_id)
    ?? notificationRaceId(entry.items?.[0]);
}

/** Unikke løbs-id'er i listen, sorteret så opslagsnøglen er stabil. */
export function collectNotificationRaceIds(notifications = []) {
  const ids = new Set();
  for (const n of notifications || []) {
    const id = notificationRaceId(n);
    if (id) ids.add(id);
  }
  return [...ids].sort();
}

/** races-rækker → Map(raceId → "u23" | "junior"). Seniorløb udelades. */
export function youthSquadMap(rows = []) {
  const map = new Map();
  for (const r of rows || []) {
    if (r?.id && (r.squad === "u23" || r.squad === "junior")) map.set(r.id, r.squad);
  }
  return map;
}
