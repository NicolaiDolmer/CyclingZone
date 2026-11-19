// #8049 · Område pr. patch note: hvilken del af spillet en ændring forbedrer.
//
// Siden grupperer ugen efter område (ejer 12/11). Nye spillervendte noter skriver
// selv `area` i data/patchNotes.js (docs/PATCH_NOTES_RULES.md §2b, CI-vagten i
// scripts/check-patch-notes-version.js). Gamle noter røres aldrig; deres område
// slås op her, i denne rækkefølge (ejerens valg 16/11):
//   1. `area` skrevet på noten.
//   2. AREA_BY_KEY: alle noter fra november, noter hvor området kan udledes af
//      roadmap-punkt eller known issue via `refs`, og noter klassificeret ud fra
//      titel og tekst. Tabellen med kilde pr. note står i
//      docs/design/reviews/2026-11-16-8049-klassificering.md.
//   3. TOPIC_AREA: notens eksisterende `topic`.
//   4. "other": kun hvad der ikke kan placeres sikkert. Vises kun i arkivet.
// Ingen notetekst ændres; området er kun en etiket ved siden af.
//
// Rene funktioner (node --test-venlige). Bruges af vite-pluginet ved build-tid,
// så klienten får området færdigregnet i JSON'en og aldrig henter denne fil.
import { AREA_BY_KEY } from "./patchNotesAreaData.ts";
import { PATCH_NOTE_AREAS, PATCH_NOTE_AREAS_WITH_OTHER, OTHER_AREA } from "./patchNotes.js";

export { OTHER_AREA };
/** Områderne i ejerens faste rækkefølge (én kilde: lib/patchNotes.js). */
export const AREAS = PATCH_NOTE_AREAS;
export const ALL_AREAS = PATCH_NOTE_AREAS_WITH_OTHER;
const AREA_SET = new Set<string>(ALL_AREAS);

/**
 * Billede ved en gammel note (ejer 16/11, valg 4: kun ved ugens nyhed, genbrug et
 * allerede godkendt PR-billede uden holdnavne, højst ca. 60 KB). Nye noter skriver
 * selv `image` i data/patchNotes.js. Stien er relativ til sitets rod.
 */
export const IMAGE_BY_KEY: Readonly<Record<string, string>> = Object.freeze({
  // Træn nu med det samme for alle (#7737): skærmen fra PR'ens godkendte billede, syntetisk rytter.
  "7.451#0": "/patch-notes-images/train-now-instant-7737.webp",
});

/** En patch note-change som data (patchNotes.js er utypet JS). */
export interface PatchChangeLike { area?: unknown; topic?: string; image?: unknown }

export function resolveImage(change: PatchChangeLike | null | undefined, key?: string, images: Record<string, string> = IMAGE_BY_KEY): string | null {
  if (typeof change?.image === "string" && change.image.startsWith("/patch-notes-images/")) return change.image;
  return (key && images[key]) || null;
}

export function isArea(value: unknown): value is string {
  return typeof value === "string" && AREA_SET.has(value);
}

/** Gyldige værdier for et nyt `area`-felt (reserven "other" skrives aldrig af en redaktør). */
export function isWritableArea(value: unknown): value is string {
  return typeof value === "string" && AREAS.includes(value);
}

// Backfill fra notens eksisterende `topic` (designnoten 16/11, tabellen "Sådan mappes
// de 2.335 noter"). "Races" blander løbsmotor og løbsfilm; historikken lægges i
// "races", og nyere noter er sat eksplicit i AREA_BY_KEY.
export const TOPIC_AREA: Readonly<Record<string, string>> = Object.freeze({
  Tactics: "tactics", "Race tactics": "tactics", Planning: "tactics", "Race selection": "tactics",
  "Team selection": "tactics", "Squad selection": "tactics", "Season planner": "tactics", Assistant: "tactics",
  Races: "races", Racing: "races", "Race results": "races", Results: "races", "Race calendar": "races",
  Calendar: "races", Standings: "races", Rankings: "races",
  "Race engine": "engine",
  Training: "training", "Daily Training": "training",
  "Rider development": "development", Development: "development", Riders: "development",
  "Rider values": "development", Ratings: "development",
  Transfers: "market", Auctions: "market", Market: "market", "Transfer market": "market",
  Scouting: "market", Contracts: "market", Watchlist: "market", "Rider database": "market",
  Academy: "academy", "Youth teams": "academy", Youth: "academy",
  Board: "board", "The board": "board", Boardroom: "board",
  Economy: "economy", Finance: "economy", Finances: "economy", Sponsors: "economy", Staff: "economy",
  Interface: "interface", UI: "interface", Dashboard: "interface", Notifications: "interface",
  Inbox: "interface", Team: "interface", "Team page": "interface", Squad: "interface", Squads: "interface",
  Season: "interface", Seasons: "interface", Forum: "interface", Onboarding: "interface",
  "Getting started": "interface", Roadmap: "interface", Design: "interface", "UI and notifications": "interface",
  Profile: "interface", Teams: "interface", Accessibility: "interface", Feedback: "interface",
  Achievements: "interface", Account: "interface", "Sign-up": "interface", Auth: "interface",
  Mobile: "mobile", "Mobile polish": "mobile", App: "mobile",
  Help: "help",
});

/**
 * Notens område. `key` er `${version}#${index}` (samme nøgle som siden bruger).
 * Returnerer altid et område; "other" når intet kan placeres sikkert.
 */
export function resolveArea(change: PatchChangeLike | null | undefined, key?: string, overrides: Readonly<Record<string, string>> = AREA_BY_KEY): string {
  if (isWritableArea(change?.area)) return change.area;
  const byKey = key ? overrides[key] : undefined;
  if (isArea(byKey)) return byKey;
  const byTopic = change?.topic ? TOPIC_AREA[change.topic] : undefined;
  if (byTopic) return byTopic;
  return OTHER_AREA;
}
