// #7214 Testport: fire loebsgrupper med hver sine krav (ejer 26/10, PC1-chat):
// korte etapeloeb, Grand Tours, endagsloeb og MONUMENTER. I dag deler testporten
// kun efter antal etaper (v3Gates.raceGroupOfStages), og monumenter taelles som
// endagsloeb; her faar monumenterne deres egen gruppe, og en ny maaling tjekker
// hvor tit en favorit vinder pr. gruppe.
//
// REN: ingen IO. Baandene er private (hard rule 17) og laeses af motorTestport
// fra den private taerskelfil (noeglen `raceGroupBands`):
//   raceGroupBands.monumentBreakawayWinShare                  {min?, max?}
//   raceGroupBands.favouriteWinShare.<noegle>                 {min?, max?}
//     noegler: monument, one_day, stage_race_gc, gt_gc, stage_race_stage
// Her staar kun definitionerne, aldrig tallene.
//
// ── Favorit (dokumenteret valg) ──────────────────────────────────────────────
// En favorit er en af startfeltets FAVOURITE_TOP_N staerkeste ryttere til netop
// ruten, maalt med spillets egen egnethed: raceAutopick.suitabilityScore
// (raceSimulator.terrainScore af rytterens evner mod etapernes demand_vector,
// snittet over etaperne). Det er samme tal assistenten bruger til at udtage holdet
// og vaelge kaptajn, og det injiceres (`suitability`), saa denne fil er motor-fri.
//  - endagsloeb og monument: loebets ene etape. Maal: loebets vinder.
//  - samlet klassement (korte etapeloeb og GT): etaperne uden de flade, som
//    assistentens kaptajnvalg (raceAutopick.resolveCaptain/gcStages; kun flade
//    etaper = alle). Maal: klassementets vinder.
//  - etapesejre i etapeloeb (korte og GT): hver etapes egen demand_vector. Maal:
//    etapens vinder. Holdtidskoersel taeller ikke (vinderen er et hold, ikke en rytter).
// Evnerne er startlistens (cache.json), ikke dagsformen under --track-fatigue.
//
// ── Gaten ────────────────────────────────────────────────────────────────────
// Kontrollerne doemmes for begge revisioner. Et manglende baand vises "-" (ikke
// FAIL). Gaten BLOKERER kun en kandidat EFTER s5_profiles_v3 (ejer 26/10: "Maal
// nu, blokér fra v3.1"); dér er den fail closed som v3Gates: FAIL, MANGLER
// (gruppen er koert, men maalingen kan ikke laves) og "-" (privat baand mangler)
// blokerer alle. En gruppe uden loeb i koerslen er N/A og blokerer ikke.

import { GATE_STATUS, inBand, measureG17, measureSprintFinale, raceGroupOfStages } from "./v3Gates.mjs";

/** Loebsgrupperne i den raekkefoelge kortet viser dem. */
export const RACE_GROUPS = Object.freeze(["one_day", "monument", "stage_race", "gt"]);
export const RACE_GROUP_LABELS = Object.freeze({ one_day: "endagsloeb", monument: "monumenter", stage_race: "korte etapeloeb", gt: "Grand Tours" });

/** races.race_class for et monument (database/2026-05-09-race-pool.sql; raceAutopick.SELECTION_SIZE). */
export const MONUMENT_RACE_CLASS = "Monuments";

/** Ejerens definition (#7214): en af loebets 3 staerkeste til ruten. En definition, ikke et baand. */
export const FAVOURITE_TOP_N = 3;

/** Holdtidskoersel: vinderen er et hold, saa en favorit-dom giver ingen mening. */
const NO_FAVOURITE_PROFILES = new Set(["ttt"]);
/** Tidskoersler i udbrudsmaalingen (som motorTestportReport.TIME_TRIAL_CLASSES). */
const TIME_TRIALS = new Set(["itt", "itt_hilly", "ttt"]);

/**
 * Kontrollerne. `key` er noeglen under raceGroupBands.favouriteWinShare (eller
 * monumentBreakawayWinShare); `groups` er loebsgrupperne maalingen daekker.
 */
export const RACE_GROUP_CHECKS = Object.freeze([
  { id: "monument_breakaway", groups: ["monument"], kind: "breakaway", label: "monumenter: udbruddet vinder (andel af vejetaper)" },
  { id: "monument", groups: ["monument"], kind: "race", label: "monumenter: en favorit vinder loebet" },
  { id: "one_day", groups: ["one_day"], kind: "race", label: "endagsloeb: en favorit vinder loebet" },
  { id: "stage_race_gc", groups: ["stage_race"], kind: "gc", label: "korte etapeloeb: en favorit vinder samlet" },
  { id: "gt_gc", groups: ["gt"], kind: "gc", label: "Grand Tours: en favorit vinder samlet" },
  { id: "stage_race_stage", groups: ["stage_race", "gt"], kind: "stage", label: "etapeloeb (korte og GT): en favorit vinder etapen" },
]);

/** De kendte revisioner til og med s5_profiles_v3 (RACE_RULES_REVISIONS 26/10). Alt andet er en kandidat efter v3 (fail closed). */
export const RACE_GROUP_GATE_EXEMPT = Object.freeze(new Set([
  "legacy", "orders_gc_v1", "orders_gc_v2", "orders_gc_v3", "official_times_v1", "official_times_v2", "official_times_v3",
  "official_times_v4", "s5_profiles_v1", "official_times_v5", "s5_profiles_v2", "s5_profiles_v3",
]));

/** Blokerer gaten denne kandidat? Kun revisioner efter s5_profiles_v3 (ikke v3-taendingen selv). */
export function raceGroupGatesApply(revision) {
  if (revision === null || revision === undefined || revision === "") return false;
  return !RACE_GROUP_GATE_EXEMPT.has(String(revision));
}

/** Loebsgruppe med monumenter: endagsloeb med race_class "Monuments" er "monument". */
export function raceGroupOf({ stages, raceClass = null } = {}) {
  const base = raceGroupOfStages(stages);
  return base === "one_day" && raceClass === MONUMENT_RACE_CLASS ? "monument" : base;
}

const byScoreDesc = (score) => (a, b) => score(b) - score(a) || String(a).localeCompare(String(b));
const hasDemand = (p) => p?.demand_vector && typeof p.demand_vector === "object" && Object.values(p.demand_vector).some((v) => Number(v) > 0);

/**
 * Favoritterne for et loeb fra dets cache.json (startliste, evner, etaper).
 * `suitability(abilities, stages)` = raceAutopick.suitabilityScore (injiceres).
 * Returnerer { raceFav: Set|null, stageFav: Map<stage_number, Set|null> }; null =
 * ingen brugbar demand_vector eller ingen ryttere (maalingen er da MANGLER).
 */
export function routeFavourites(cache, { suitability, topN = FAVOURITE_TOP_N } = {}) {
  if (typeof suitability !== "function") throw new Error("routeFavourites kraever suitability (raceAutopick.suitabilityScore)");
  const profiles = (Array.isArray(cache?.profiles) ? cache.profiles : []).slice().sort((a, b) => Number(a.stage_number) - Number(b.stage_number));
  const abilities = new Map((cache?.abilities ?? []).map((a) => [a.rider_id, a]));
  const riders = [...new Set((cache?.entries ?? []).map((e) => e.rider_id).filter((id) => abilities.has(id)))];
  const top = (stages) => {
    if (!riders.length || !stages.length || !stages.every(hasDemand)) return null;
    const scores = new Map(riders.map((id) => [id, Number(suitability(abilities.get(id), stages)) || 0]));
    return new Set(riders.slice().sort(byScoreDesc((id) => scores.get(id))).slice(0, topN));
  };
  const stageFav = new Map(profiles.map((p) => [p.stage_number, NO_FAVOURITE_PROFILES.has(p.profile_type) ? null : top([p])]));
  const multi = profiles.length > 1;
  // Samlet klassement: som assistentens kaptajnvalg (raceAutopick.gcStages): uden de flade etaper.
  const gcStages = multi ? (profiles.filter((p) => p.profile_type !== "flat").length ? profiles.filter((p) => p.profile_type !== "flat") : profiles) : profiles;
  return { raceFav: top(gcStages.filter((p) => !NO_FAVOURITE_PROFILES.has(p.profile_type))), stageFav };
}

/** Loebets gruppe: kontekstens (cache.json) foerst, ellers scorecardets etaper + race_class. */
function groupOfRace(rr, ctx) {
  return ctx?.raceGroup ?? raceGroupOf({ stages: ctx?.stages ?? rr?.stages, raceClass: ctx?.raceClass ?? rr?.raceClass ?? null });
}

const share = (hits, n) => (n > 0 ? hits / n : null);

/**
 * Maalingen for EN kontrol og EN revision: { n, hits, share, races, missing }.
 * n = 0 og missing = 0: gruppen er ikke i koerslen (N/A). missing > 0: loeb i
 * gruppen uden favoritter/vinder (MANGLER, aldrig gaettet).
 */
export function measureCheck(check, raceResults, revision, contexts = new Map()) {
  let n = 0;
  let hits = 0;
  let missing = 0;
  const races = new Set();
  for (const rr of raceResults ?? []) {
    const run = rr?.runs?.[revision];
    if (!run) continue;
    const ctx = contexts?.get?.(rr.raceId) ?? null;
    if (!check.groups.includes(groupOfRace(rr, ctx))) continue;
    races.add(rr.raceId);
    for (const seed of run.perSeed ?? []) {
      if (check.kind === "breakaway") {
        for (const r of seed.rows ?? []) {
          if (TIME_TRIALS.has(r.cls ?? r.profile_type) || typeof r.breakawayWon !== "boolean") continue;
          n += 1;
          if (r.breakawayWon) hits += 1;
        }
        continue;
      }
      const fav = ctx?.favourites ?? null;
      if (check.kind === "race" || check.kind === "gc") {
        const winner = check.kind === "race" ? (seed.rows?.[0]?.winnerId ?? seed.gcWinner ?? null) : (seed.gcWinner ?? null);
        if (!fav?.raceFav || !winner) { missing += 1; continue; }
        n += 1;
        if (fav.raceFav.has(winner)) hits += 1;
        continue;
      }
      // kind "stage": hver etape (uden holdtidskoersel) i etapeloebet.
      for (const r of seed.rows ?? []) {
        if (NO_FAVOURITE_PROFILES.has(r.profile_type)) continue;
        const set = fav?.stageFav?.get?.(r.stage) ?? null;
        if (!set || !r.winnerId) { missing += 1; continue; }
        n += 1;
        if (set.has(r.winnerId)) hits += 1;
      }
    }
  }
  return { n, hits, share: share(hits, n), races: races.size, missing };
}

/** Det private baand for en kontrol (eller null). */
export function bandFor(check, bands) {
  const b = bands ?? {};
  return check.kind === "breakaway" ? b.monumentBreakawayWinShare ?? null : b.favouriteWinShare?.[check.id] ?? null;
}

/**
 * Doem kontrollerne for EN revision. `bands` = taerskelfilens `raceGroupBands`.
 * Status pr. kontrol: PASS/FAIL mod baandet, "-" naar baandet mangler, N/A naar
 * gruppen ikke er koert, MANGLER naar maalingen ikke kan laves. `blocked` =
 * mindst én kontrol er FAIL, MANGLER eller "-" (fail closed); om den blokerer
 * kandidaten afgoer raceGroupGatesApply.
 */
export function evaluateRaceGroupGates({ raceResults, revision, contexts = new Map(), bands = null }) {
  const checks = RACE_GROUP_CHECKS.map((check) => {
    const m = measureCheck(check, raceResults, revision, contexts);
    let status;
    let why = null;
    if (m.missing > 0) { status = GATE_STATUS.MISSING; why = `${m.missing} ${check.kind === "stage" ? "etaper" : "seeds"} uden favoritter eller vinder (cache.json/scorecard)`; }
    else if (m.n === 0) { status = GATE_STATUS.NA; why = "gruppen er ikke i koerslen"; }
    else {
      const ok = inBand(m.share, bandFor(check, bands));
      status = ok === null ? "-" : ok ? GATE_STATUS.PASS : GATE_STATUS.FAIL;
      if (ok === null) why = "privat baand mangler";
    }
    return { id: check.id, label: check.label, groups: check.groups, kind: check.kind, status, why, ...m };
  });
  const blocking = checks.filter((c) => c.status === GATE_STATUS.FAIL || c.status === GATE_STATUS.MISSING || c.status === "-");
  return { checks, blocked: blocking.length > 0, reasons: blocking.map((c) => `${c.id} ${c.status}${c.why ? ` (${c.why})` : ""}`) };
}

/**
 * G17/S0-udsnit pr. de fire grupper (kun visning): v3Gates' egne maalinger koert
 * paa hver gruppes loeb for sig. v3-gaternes domme er uaendrede (monumenter er
 * stadig endagsloeb dér), saa taendingen af v3 ikke flytter sig.
 */
export function groupSlices(raceResults, revision, contexts = new Map()) {
  const out = {};
  for (const g of RACE_GROUPS) {
    const subset = (raceResults ?? []).filter((rr) => rr?.runs?.[revision] && groupOfRace(rr, contexts?.get?.(rr.raceId) ?? null) === g);
    if (!subset.length) { out[g] = null; continue; }
    const g17 = measureG17(subset, revision, contexts);
    const g17Group = g17 ? Object.values(g17.byGroup)[0] ?? null : null;
    const s0 = measureSprintFinale(subset, revision, contexts)?.alle ?? null;
    out[g] = {
      races: subset.length,
      abandonShare: g17Group?.share ?? null,
      captainRate: g17?.captainRate ?? null,
      helperRate: g17?.helperRate ?? null,
      sprintFinales: s0?.n ?? 0,
      bestSprinterWins: s0?.bestSprinterWins ?? null,
    };
  }
  return out;
}

/** Kortets data: begge revisioners domme + udsnit; kun kandidatens dom kan blokere. */
export function buildRaceGroupCard({ raceResults, baseline, candidate, contexts = new Map(), thresholds = {} }) {
  const bands = thresholds?.raceGroupBands ?? null;
  return {
    applies: raceGroupGatesApply(candidate),
    baseline: evaluateRaceGroupGates({ raceResults, revision: baseline, contexts, bands }),
    candidate: evaluateRaceGroupGates({ raceResults, revision: candidate, contexts, bands }),
    slices: { baseline: groupSlices(raceResults, baseline, contexts), candidate: groupSlices(raceResults, candidate, contexts) },
  };
}

// ── Formatering (privat kort) ────────────────────────────────────────────────

const pct = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "-" : `${Math.round(v * 100)} %`);
const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)];

/** Kortets dom-linje for loebsgruppe-gaten. */
export function raceGroupGateLine(card) {
  const v = card?.raceGroupGates;
  if (!v?.candidate) return "- Loebsgrupper (ejer 26/10): ikke doemt.";
  if (!v.applies) return `- Loebsgrupper (ejer 26/10) blokerer kun kandidater efter s5_profiles_v3; ${card.candidate} doemmes til orientering${v.candidate.blocked ? ` (ville blokere: ${v.candidate.reasons.join("; ")})` : " (groen)"}.`;
  return v.candidate.blocked ? `- **LOEBSGRUPPE-GATE BLOKERET:** ${v.candidate.reasons.join("; ")}.` : "- Loebsgrupper (ejer 26/10): alle kontroller er groenne.";
}

/** Sektionen "Loebsgrupper (ejer 26/10)" i testport.md. */
export function raceGroupGateSection(card) {
  const v = card?.raceGroupGates;
  if (!v?.candidate) return [];
  const b = Object.fromEntries((v.baseline?.checks ?? []).map((c) => [c.id, c]));
  const cell = (c) => (c?.n ? `${pct(c.share)} (${c.hits}/${c.n}, ${c.races} loeb)` : "-");
  const out = ["", `## Løbsgrupper (ejer 26/10)${v.applies ? " - blokerende" : " - til orientering (blokerer fra kandidater efter s5_profiles_v3)"}`, "",
    "Fire grupper: endagsloeb, monumenter (race_class Monuments), korte etapeloeb (2-14 etaper), Grand Tours (15+). Dom mod de private baand (`raceGroupBands`); \"-\" = intet baand.", "",
    ...table(["Kontrol", `${card.baseline} vaerdi`, `${card.baseline} dom`, `${card.candidate} vaerdi`, `${card.candidate} dom`, "Hvorfor (kandidat)"],
      v.candidate.checks.map((c) => [c.label, cell(b[c.id]), b[c.id]?.status ?? "-", cell(c), c.status, c.why ?? "-"]))];
  const sides = card.sameRevision ? [["baseline", card.baseline]] : [["baseline", card.baseline], ["candidate", card.candidate]];
  out.push("", "### G17/S0 pr. loebsgruppe (udsnit, ingen dom; v3-gaterne doemmer stadig monumenter som endagsloeb)");
  for (const [side, rev] of sides) {
    const s = v.slices?.[side] ?? {};
    out.push("", `#### ${rev}`, "", ...table(["Gruppe", "loeb", "G17 udgaaet", "G17 kaptajn / hjaelper", "S0 spurtfinaler", "S0 bedste sprinter vandt"],
      RACE_GROUPS.map((g) => { const x = s[g]; return x ? [RACE_GROUP_LABELS[g], String(x.races), pct(x.abandonShare), `${pct(x.captainRate)} / ${pct(x.helperRate)}`, String(x.sprintFinales), pct(x.bestSprinterWins)] : [RACE_GROUP_LABELS[g], "0", "-", "-", "-", "-"]; })));
  }
  out.push("", `Favorit = en af startfeltets ${FAVOURITE_TOP_N} staerkeste til ruten efter spillets egnethed (raceAutopick.suitabilityScore: evner mod etapernes demand_vector). Endagsloeb/monument: loebets etape, maal = vinderen. Samlet: etaperne uden de flade (som assistentens kaptajnvalg), maal = klassementets vinder. Etapesejre: hver etapes egen demand_vector (uden holdtidskoersel).`);
  return out;
}
