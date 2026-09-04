// Omdømme-systemets ENESTE kilde til vægte og grænser (#1099, spec
// `docs/superpowers/specs/2026-09-04-reputation-system-design.md` §3-§4).
//
// Alt her er KALIBRERINGSUDGANGSPUNKT, ikke facit: harnessen
// (`backend/scripts/reputation-calibration.js`) afspiller alle sæsoner mod
// netop disse tal og rapporterer om fordelingen rammer spec §9's mål. Ændres
// en vægt, skal harnessen køres igen — der findes bevidst INGEN anden fil der
// definerer point, gulv-kreditter eller ordbånd.
//
// Filen er ren data + rene hjælpefunktioner. Ingen I/O, ingen tekst til UI:
// ordbåndene bærer kun nøgler (`bandKeyEn`/`bandKeyDa`), så oversættelsen bor
// i i18n når PR 3 (synlighed) lander.

// ── Løbsklasse-vægt (spec §4) ───────────────────────────────────────────────
// Nøglerne er `races.race_class` ordret (kanonisk liste:
// lib/uciRacePointDefaults.js UCI_MEN_RACE_CLASSES).
export const W_CLASS = Object.freeze({
  TourFrance: 1.0,
  GiroVuelta: 0.8,
  Monuments: 0.8,
  OtherWorldTourA: 0.6,
  OtherWorldTourB: 0.5,
  OtherWorldTourC: 0.4,
  ProSeries: 0.25,
  Class1: 0.15,
  Class2: 0.1,
});

// Ukendt/manglende klasse vejer nul: en race_class vi ikke kender må aldrig
// give omdømme ved et gæt (spec §4 lister ni klasser, og alle ni findes i
// prod — en tiende ville være en kalibrerings-beslutning, ikke en default).
export const DEFAULT_CLASS_WEIGHT = 0;

// ── Grand Tour / WorldTour-grupperinger til gulv-kreditter ──────────────────
export const GRAND_TOUR_CLASSES = Object.freeze(["TourFrance", "GiroVuelta"]);
export const WORLD_TOUR_CLASSES = Object.freeze([
  "Monuments",
  "OtherWorldTourA",
  "OtherWorldTourB",
  "OtherWorldTourC",
]);
// Spec §4: "Class1/Class2 giver ingen gulv-kredit." Listen står eksplicit, så
// reglen kan testes direkte i stedet for at være en stiltiende konsekvens af
// at klasserne mangler i tabellerne nedenfor.
export const NO_FLOOR_CREDIT_CLASSES = Object.freeze(["Class1", "Class2"]);

// ── Hændelsestyper (spec §4 + §5's dedupe_key) ──────────────────────────────
// event_kind = `<base>_<outcome>`. Base'en fortæller HVAD der blev vundet,
// outcome HVOR godt. Trøjerne har hver sin base (ikke én fælles `jersey`):
// point-, bjerg- og ungdomstrøjen afgøres på SAMME sidste etape, så en fælles
// base ville give tre identiske dedupe_keys og dermed tavst tabe to af tre
// trøjer for en rytter der vinder flere (spec §5's dedupe_key indeholder kun
// rider/race/stage/event_kind).
export const EVENT_BASE = Object.freeze({
  ONE_DAY: "one_day",
  GC: "gc",
  STAGE: "stage",
  JERSEY_POINTS: "jersey_points",
  JERSEY_MOUNTAIN: "jersey_mountain",
  JERSEY_YOUNG: "jersey_young",
});

export const EVENT_OUTCOME = Object.freeze({
  WIN: "win",
  PODIUM: "podium",
  TOP10: "top10",
});

// Dag i førertrøje har ingen podium/top10-variant (spec §4: kun rank 1).
export const LEADER_DAY_EVENT_KIND = "leader_day";

export function eventKind(base, outcome) {
  return `${base}_${outcome}`;
}

// ── Form-basispoint pr. base (spec §4, ganges med W_CLASS) ──────────────────
export const BASE_FORM_POINTS = Object.freeze({
  [EVENT_BASE.ONE_DAY]: 20,
  [EVENT_BASE.GC]: 25,
  [EVENT_BASE.STAGE]: 8,
  [EVENT_BASE.JERSEY_POINTS]: 10,
  [EVENT_BASE.JERSEY_MOUNTAIN]: 10,
  [EVENT_BASE.JERSEY_YOUNG]: 10,
});

export const LEADER_DAY_FORM_POINTS = 2;

// Spec §4: podium = 40 % af sejrens formpoint, top 10 = 10 %.
export const OUTCOME_MULTIPLIER = Object.freeze({
  [EVENT_OUTCOME.WIN]: 1,
  [EVENT_OUTCOME.PODIUM]: 0.4,
  [EVENT_OUTCOME.TOP10]: 0.1,
});

export const PODIUM_MIN_RANK = 2;
export const PODIUM_MAX_RANK = 3;
export const TOP10_MIN_RANK = 4;
export const TOP10_MAX_RANK = 10;

// ── Karriere-gulv-kreditter (spec §4, KUN ved sejr) ─────────────────────────
// Podium og top 10 giver 0 — gulvet er "hvad du har vundet", ikke "hvad du har
// været tæt på". Slås op pr. (base, race_class); manglende opslag = 0.
export const FLOOR_CREDITS = Object.freeze({
  [EVENT_BASE.ONE_DAY]: Object.freeze({
    Monuments: 15,
    OtherWorldTourA: 6,
    OtherWorldTourB: 6,
    OtherWorldTourC: 6,
    ProSeries: 1,
  }),
  [EVENT_BASE.GC]: Object.freeze({
    TourFrance: 20,
    GiroVuelta: 15,
    OtherWorldTourA: 6,
    OtherWorldTourB: 6,
    OtherWorldTourC: 6,
    ProSeries: 1,
  }),
  [EVENT_BASE.STAGE]: Object.freeze({
    TourFrance: 4,
    GiroVuelta: 4,
    Monuments: 1,
    OtherWorldTourA: 1,
    OtherWorldTourB: 1,
    OtherWorldTourC: 1,
  }),
  [EVENT_BASE.JERSEY_POINTS]: Object.freeze({ TourFrance: 4, GiroVuelta: 4 }),
  [EVENT_BASE.JERSEY_MOUNTAIN]: Object.freeze({ TourFrance: 4, GiroVuelta: 4 }),
  [EVENT_BASE.JERSEY_YOUNG]: Object.freeze({ TourFrance: 4, GiroVuelta: 4 }),
});

// ── Tal-model (spec §3) ─────────────────────────────────────────────────────
export const FLOOR_CAP = 60;
export const REPUTATION_MIN = 0;
export const REPUTATION_MAX = 100;
// Vægten på "ry ved ankomst" (riders.popularity). Spec §9: harnessen må sænke
// den til 0,5 hvis for mange seedede Stjerner uden resultater lander ≥ 70.
export const SEED_FLOOR_WEIGHT = 1.0;
export const SEED_FLOOR_WEIGHT_ALTERNATIVE = 0.5;
// Form halveres ved hvert sæsonskifte.
export const SEASON_DECAY_FACTOR = 0.5;

// Alle numeriske resultater afrundes hertil. Uden en fast afrunding ville
// 0,1-multiplikatoren og W_CLASS tilsammen give flydende-komma-hale
// (8 · 0,15 · 0,1 = 0,12000000000000002), som ville gøre enhedstests og
// dry-run-diffs urolige uden at betyde noget spilmæssigt.
export const POINT_DECIMALS = 4;

export function roundPoints(value) {
  const factor = 10 ** POINT_DECIMALS;
  return Math.round((Number(value) || 0) * factor) / factor;
}

// ── Ordbånd (spec §3, grænser 0/20/45/70/90) ────────────────────────────────
// Kun nøgler, ingen visningstekst: i18n ejer strengene (PR 3).
export const REPUTATION_BANDS = Object.freeze([
  Object.freeze({ key: "unknown", min: 0, bandKeyEn: "Unknown", bandKeyDa: "Ukendt" }),
  Object.freeze({ key: "known", min: 20, bandKeyEn: "Known", bandKeyDa: "Kendt" }),
  Object.freeze({ key: "profile", min: 45, bandKeyEn: "Profile", bandKeyDa: "Profil" }),
  Object.freeze({ key: "star", min: 70, bandKeyEn: "Star", bandKeyDa: "Stjerne" }),
  Object.freeze({ key: "legend", min: 90, bandKeyEn: "Legend", bandKeyDa: "Legende" }),
]);

// Bestyrelsens high-profile-tærskel (spec §7 punkt 1) — bor her, så PR 3 ikke
// opfinder sit eget tal. Ingen forbruger læser den endnu.
export const STAR_BAND_THRESHOLD = 70;
export const LEGEND_BAND_THRESHOLD = 90;
