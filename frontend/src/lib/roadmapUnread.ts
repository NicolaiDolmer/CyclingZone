// #5673: gul ulæst-prik ved "Roadmap" i navigationen (Layout.jsx) og ved
// nye enkelt-punkter på selve /roadmap (RoadmapPage.jsx). Ejer 24/9: "samme
// mekanik som ved nye patch notes og forum".
//
// Storage-strategien er bevidst kopieret fra lib/patchNotesUnread.js
// (cz_patchnotes_last_seen), IKKE fra forum (forumUnreadFold.js + server-side
// last_read_at) — roadmap_items er offentligt læsbare (samme RLS som
// RoadmapPage's egen items-query, ingen session nødvendig), så en lokal
// localStorage-dato sammenlignet mod roadmap_items.created_at er nok, uden en
// ny server-side "last seen"-tabel/migration.
//
// Rene funktioner her (node --test-venlige), React-wiringen bor i
// Layout.jsx (nav-prikken) + RoadmapPage.jsx (prikken på det enkelte punkt).

export const LAST_SEEN_KEY = "cz_roadmap_last_seen";

export interface RoadmapItemLike {
  created_at?: string | null;
}

/**
 * Er der ulæste roadmap-punkter? Samme semantik som isPatchNotesUnread
 * (patchNotesUnread.js): en tom `lastSeen` (aldrig besøgt /roadmap) tæller
 * som ulæst, IKKE som "intet at sammenligne med" — det er præcis tilfældet
 * for enhver spiller lige nu (#5673: Roadmap v2's 42 punkter kom i prod
 * 24/9, og denne nøgle har aldrig eksisteret i deres localStorage før). Se
 * PR-beskrivelsen for A/B-afvejningen — B (ingen seed) er hvad denne
 * funktion giver uden videre.
 */
export function isRoadmapUnread(
  latestCreatedAt: string | null | undefined,
  lastSeen: string | null | undefined
): boolean {
  if (!latestCreatedAt) return false;
  if (!lastSeen) return true;
  return latestCreatedAt > lastSeen;
}

/** Samme sammenligning, men for ét enkelt punkts created_at — prikken på selve punktet. */
export function isRoadmapItemNew(
  itemCreatedAt: string | null | undefined,
  lastSeen: string | null | undefined
): boolean {
  return isRoadmapUnread(itemCreatedAt, lastSeen);
}

/** Nyeste created_at blandt en liste roadmap-punkter, eller null hvis listen er tom. */
export function latestRoadmapCreatedAt(
  items: RoadmapItemLike[] | null | undefined
): string | null {
  const list = Array.isArray(items) ? items : [];
  let latest: string | null = null;
  for (const item of list) {
    const createdAt = item?.created_at;
    if (createdAt && (!latest || createdAt > latest)) {
      latest = createdAt;
    }
  }
  return latest;
}

export function readLastSeenRoadmap(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

export function writeLastSeenRoadmap(date: string | null | undefined): void {
  if (!date) return;
  try {
    localStorage.setItem(LAST_SEEN_KEY, date);
  } catch {
    /* ignore — samme fail-silent som writeLastSeenPatchNotes */
  }
}
