// #3811: ulæst-prik ved "Patch Notes" i navigationen (Layout.jsx) — spillere der
// aldrig åbner siden i spillet opdager kun nye patch notes via Discord. Rene
// funktioner her (node --test-venlige, samme mønster som navBadges.js), React-
// wiringen bor i Layout.jsx.
//
// Henter IKKE hele changelog'en (~945 KB) — kun den ultra-lette
// patch-notes-meta.json ({version, date} for nyeste patch), emitteret af
// vite-plugins/patch-notes-json.js ved siden af patch-notes.json.
import { markSeen, SEEN_MARKER_LOCAL_KEYS } from "./seenMarkers6515.ts";

export const PATCH_NOTES_META_URL = "/patch-notes-meta.json";

// MÅ matche LAST_SEEN_KEY i src/pages/PatchNotesPage.jsx præcis — samme
// localStorage-nøgle, to steder. PatchNotesPage.jsx skrives IKKE til for
// dette issue (dens egen useEffect sætter allerede nøglen til nyeste dato,
// hver gang siden åbnes), så nøglen er duplikeret her i stedet for delt via
// import, for at holde ændringen ude af den fil.
export const LAST_SEEN_KEY = SEEN_MARKER_LOCAL_KEYS.patch_notes; // "cz_patchnotes_last_seen"

/** Henter {version, date} for nyeste patch. Kaster ved HTTP-fejl/ugyldig form. */
export async function loadPatchNotesMeta(url = PATCH_NOTES_META_URL, fetchImpl = fetch) {
  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`patch-notes-meta: fetch fejlede (${res.status} ${res.statusText})`);
  }
  const data = await res.json();
  if (!data || typeof data !== "object" || !data.date) {
    throw new Error("patch-notes-meta: forventede { version, date }");
  }
  return data;
}

/**
 * Er der ulæste patch notes? Modsat computeNewDays (patchNotes.js), som bevidst
 * IKKE fremhæver noget ved første besøg (intet at sammenligne med), skal prikken
 * her vise ulæst når `lastSeen` er tom — det er præcis spilleren fra #3811, som
 * aldrig har åbnet siden og derfor ingen lastSeen-værdi har.
 */
export function isPatchNotesUnread(latestDate, lastSeen) {
  if (!latestDate) return false;
  if (!lastSeen) return true;
  return latestDate > lastSeen;
}

export function readLastSeenPatchNotes() {
  try { return localStorage.getItem(LAST_SEEN_KEY); } catch { return null; }
}

// #6515: markøren rykker kun frem og sendes op på brugeren (lib/seenMarkers6515.ts),
// så prikken følger spilleren på tværs af enheder. Udlogget: kun localStorage, som før.
export function writeLastSeenPatchNotes(date) {
  if (!date) return;
  markSeen("patch_notes", date);
}

/** `to` → ulæst-boolean-kortet NavItem slår op i — samme recipe som buildNavBadgeCounts. */
export function buildNavDotFlags({ patchNotesUnread = false } = {}) {
  return { "/patch-notes": patchNotesUnread };
}

/** 0 for items uden `dot: true`, uanset hvad kortet indeholder for den `to`. */
export function resolveNavDot(item, dotFlags) {
  if (!item?.dot) return false;
  return Boolean(dotFlags?.[item.to]);
}
