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
// Spec §4 sagde oprindelig "Class1/Class2 giver ingen gulv-kredit". Kørsel 2
// (docs/audits/reputation-calibration-2026-09-05.md, punkt 2) fandt at 93 %
// af ALLE hændelser ligger i ProSeries/Class1/Class2 — uden en Class1-kredit
// kunne en rytter vinde 31 løb og stadig have et karriere-gulv på 22, hvilket
// holdt to af de 20 mest vindende ryttere i S1-S3 under Stjerne-tærsklen 70.
// Class1 har derfor fået en lille kredit (se FLOOR_CREDITS nedenfor); Class2
// står stadig uden — det var IKKE nødvendigt for at ramme spec §9's mål.
export const NO_FLOOR_CREDIT_CLASSES = Object.freeze(["Class2"]);

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
//
// KØRSEL 2 (docs/audits/reputation-calibration-2026-09-05.md): ProSeries- og
// Class1-sejre er sat op fra spec §4's udgangspunkt (ProSeries 1 → 2, Class1
// 0 → 1). Uden det holdt en gulv-kredit på 1 for en ProSeries-sejr og 0 for
// Class1 to af de 20 mest vindende ryttere i S1-S3 under Stjerne-tærsklen 70
// — 93 % af alle hændelser ligger netop i ProSeries/Class1/Class2. Grid-
// varianten er valgt, ikke gættet: se harnessens `GRID_VARIANTS` og
// audit-rapportens "Kørsel 2"-afsnit.
export const FLOOR_CREDITS = Object.freeze({
  [EVENT_BASE.ONE_DAY]: Object.freeze({
    Monuments: 15,
    OtherWorldTourA: 6,
    OtherWorldTourB: 6,
    OtherWorldTourC: 6,
    ProSeries: 2,
    Class1: 1,
  }),
  [EVENT_BASE.GC]: Object.freeze({
    TourFrance: 20,
    GiroVuelta: 15,
    OtherWorldTourA: 6,
    OtherWorldTourB: 6,
    OtherWorldTourC: 6,
    ProSeries: 2,
    Class1: 1,
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
// Vægten på "ry ved ankomst" (riders.popularity). Kørsel 1 (spec §9's
// bekymring: for mange seedede Stjerner uden resultater) viste 0 sådanne
// tilfælde i data — ejer-godkendt 4/9: bliver på 1,0
// (docs/audits/reputation-calibration-2026-09-05.md punkt 3).
export const SEED_FLOOR_WEIGHT = 1.0;
// Bevaret KUN fordi kørsel 1's harness-kode sammenlignede mod den — selve
// vægten er ikke længere en åben beslutning. Ny kalibrering rører den ikke.
export const SEED_FLOOR_WEIGHT_ALTERNATIVE = 0.5;
// Form halveres ved hvert sæsonskifte.
export const SEASON_DECAY_FACTOR = 0.5;

// ── Blødt loft (kørsel 2, docs/audits/reputation-calibration-2026-09-05.md) ─
// Kørsel 1 viste at den hårde `clamp(floor + form, 0, 100)` klemte 29 ryttere
// fast på præcis 100 (rå formpoint op til 3× loftet), mens Stjerne-båndet
// (70-89) samtidig var for tyndt. Et blødt loft løser begge på én gang:
// `reputation = 100 · tanh(raw / SOFT_CAP)`, raw = floor + form. FLOOR_CAP
// (60) er stadig det RÅ gulv og er UÆNDRET af det bløde loft — kun selve
// slutresultatet mætter i stedet for at klemmes. tanh(x) → 1 for store x, så
// reputation nærmer sig 100 asymptotisk uden nogensinde at ramme det eksakt
// (bortset fra afrunding ved POINT_DECIMALS ved ekstreme raw-værdier).
//
// 74 er valgt af harnessens 8-variant-grid (docs/audits/reputation-
// calibration-2026-09-05.md, kørsel 2): sammen med gulv-kredit-ændringerne
// nedenfor er det den LAVESTE værdi i det afsøgte interval [70, 95] der
// rammer BÅDE Stjerne- (1-2 %) og Legende-målet (≤ 0,3 %) samtidig, uden en
// eneste rytter ≥ 99 (mod 70, som klarer star-målet men lander 1 rytter på
// 99,1 — for tæt på det gamle "klemt på 100"-problem).
export const SOFT_CAP = 74;

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

// ── Kalibrerings-overrides (KUN kalibrerings-harnessen — reputationEngine.js'
// produktionssti importerer W_CLASS/FLOOR_CREDITS/SOFT_CAP direkte og ser
// ALDRIG denne fil, uanset hvad harnessen kaldes med) ────────────────────────
//
// defaultConstantsBundle() kopierer (aldrig muterer) de frosne exports til én
// almindelig, overskrivbar bundle. buildConstants(overrides) tager en flad
// liste af `{ "sti.til.felt": værdi }` (fra CLI `--set` eller en grid-
// variant i harnessen) og returnerer en NY bundle — de originale konstanter
// ovenfor rører den aldrig.
export function defaultConstantsBundle() {
  return {
    W_CLASS: { ...W_CLASS },
    FLOOR_CREDITS: Object.fromEntries(
      Object.entries(FLOOR_CREDITS).map(([base, byClass]) => [base, { ...byClass }]),
    ),
    NO_FLOOR_CREDIT_CLASSES: [...NO_FLOOR_CREDIT_CLASSES],
    BASE_FORM_POINTS: { ...BASE_FORM_POINTS },
    OUTCOME_MULTIPLIER: { ...OUTCOME_MULTIPLIER },
    LEADER_DAY_FORM_POINTS,
    FLOOR_CAP,
    SOFT_CAP,
    SEED_FLOOR_WEIGHT,
    SEASON_DECAY_FACTOR,
    DEFAULT_CLASS_WEIGHT,
  };
}

// CodeQL #356 (js/prototype-pollution-utility): setAtPath skrev tidligere
// direkte til `node[key]` uden at afvise `__proto__`/`constructor`/
// `prototype`. En sti som "--set __proto__.polluted=1" (tastefejl, ikke
// nødvendigvis ondsindet — men harnessen tager CLI-input) ville forurene
// Object.prototype for HELE processen, ikke kun den returnerede bundle.
// Disse tre nøgler er derfor forbudte i ethvert segment af stien.
const FORBIDDEN_PATH_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function setAtPath(root, path, value) {
  const parts = path.split(".");
  for (const key of parts) {
    if (FORBIDDEN_PATH_KEYS.has(key)) {
      throw new Error(
        `buildConstants: overrides-stien "${path}" bruger det forbudte segment "${key}" ` +
          `(__proto__/constructor/prototype er blokeret for at undgå prototype-pollution, #1099). ` +
          `Tjek for tastefejl i --set.`,
      );
    }
  }
  // Top-niveau-nøglen skal allerede findes i default-bundlen: en ukendt
  // konstant er en tastefejl, ikke en gyldig kalibrerings-tilføjelse (harnessen
  // og CLI'en overskriver/nulstiller kun eksisterende akser, se toppen af
  // filen). Nestede nøgler (fx en ny race_class i FLOOR_CREDITS.<base>) må
  // gerne oprettes — det er reel kalibrerings-udforskning.
  const topKey = parts[0];
  if (!Object.hasOwn(root, topKey)) {
    throw new Error(
      `buildConstants: ukendt konstant "${topKey}" (fra stien "${path}") findes ikke i ` +
        `default-bundlen — tjek for tastefejl i --set.`,
    );
  }
  // CodeQL (js/prototype-pollution-utility, #356) genkender kun en vagt der
  // staar INLINE lige foer tildelingen: derfor gentages sammenligningen her,
  // selv om loekken ovenfor allerede har kastet. Nye mellemobjekter oprettes
  // uden prototype, saa et arvet felt aldrig kan blive skrive-maal.
  let node = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new Error(`buildConstants: forbudt segment "${key}" i stien "${path}"`);
    }
    if (typeof node[key] !== "object" || node[key] === null || !Object.hasOwn(node, key)) {
      node[key] = Object.create(null);
    }
    node = node[key];
  }
  const leaf = parts[parts.length - 1];
  if (leaf === "__proto__" || leaf === "constructor" || leaf === "prototype") {
    throw new Error(`buildConstants: forbudt segment "${leaf}" i stien "${path}"`);
  }
  node[leaf] = value;
}

/**
 * @param {Record<string, number|string|Array>} overrides  dot-path → værdi.
 *   `"W_CLASS.ProSeries" -> 0.35`, `"SOFT_CAP" -> 80`,
 *   `"FLOOR_CREDITS.one_day.Class1" -> 1`,
 *   `"NO_FLOOR_CREDIT_CLASSES" -> ["Class2"]` (erstatter HELE listen).
 * @throws {Error} hvis et stisegment er `__proto__`/`constructor`/`prototype`,
 *   eller hvis stiens TOP-niveau-nøgle ikke findes i default-bundlen (typisk
 *   en tastefejl i `--set`).
 * @returns {object} ny, ikke-frosset konstant-bundle. Modulets egne frosne
 *   exports er UÆNDREDE.
 */
export function buildConstants(overrides = {}) {
  const bundle = defaultConstantsBundle();
  for (const [path, value] of Object.entries(overrides)) {
    setAtPath(bundle, path, value);
  }
  return bundle;
}
