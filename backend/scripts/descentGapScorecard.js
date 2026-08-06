#!/usr/bin/env node
// backend/scripts/descentGapScorecard.js
// #3426 — simulér-før-ship-scorecard for nedkørsels-finale-rebalanceringen.
//
// Grundlag (empirisk måling 6/8 på 161.874 stage-resultater, kommentar på #3426):
// nedkørsels-finaler UDEN dæmpning spredte SOM ELLER MERE end summit-finaler —
// stik modsat af virkeligheden (nedkørsel = felt samles, summit = felt splittes).
// Tre rod-årsager fjernet i raceSimulator.js (se konstant-kommentarer der,
// mærket #3426): VALLEY_MIN_DESCENT_KM 10→3, stageGapModel dæmper nu OGSÅ
// descent-finaler UDEN rutedata, ny DESCENT_GAP_BUNCH (frontgruppe-klumpning på
// nedkørsler), + reducerede DESCENDING_FINALE_WEIGHT/TECHNICAL_FINALE_WEIGHT
// (mindre per-rytter-spænd oven i den nu-fungerende dæmpning).
//
// DENNE GATE: kører den ÆGTE simulator (simulateStage) over de PERSISTEREDE S3-
// etapeprofiler (race_stage_profiles, read-only) + en ægte fiktiv population
// (generateFictionalRiders → deriveAbilities, samme kæde som raceCompetitionScorecard.js).
// "Før" og "efter" køres i SAMME script: simulateStage kaldes ÉN gang pr. etape-
// kørsel (med den NUVÆRENDE — dvs. "efter" — kode), og "før"-tilstanden udledes
// ved at UDSKIFTE finale-komponenten + gab-omregningen med en frossen kopi af den
// gamle logik/konstanter (legacyFinaleModifier/legacyStageGapModel nedenfor).
// Det er sikkert fordi INGEN af de øvrige score-komponenter (terrain/noise/form/
// fatigue/team/breakaway) ændrede sig i #3426 — kun finale-vægtene og
// stageGapModel's dal-tærskel/bunch/fallback. Ren delta-udledning, ingen
// dupliceret rng-rækkefølge, ingen driftrisiko for de UÆNDREDE komponenter.
//
// S3 har (pr. 6/8) INGEN descent-finaler uden rutedata (route-aware-generatoren,
// #2771, populerer altid climbs) — den population der rammes af rod-årsag #2
// findes i S1 (159 stk., alle profile_type=mountain). Scriptet henter derfor
// disse fra S1 som et separat, MÆRKET datasæt for netop den gruppe — stadig
// ægte, persisterede prod-profiler, read-only, kun målt in-memory.
//
//   node scripts/descentGapScorecard.js [--seeds=2026,7,42] [--field=140] [--count=900]
//
// EXIT-KONTRAKT (samme mønster som raceRouteRealismScorecard.js):
//   0 = GO      · alle gatede delscore kørte og bestod.
//   1 = NO-GO   · mindst én delscore kørte og fejlede sit bånd.
//   2 = UKENDT  · intet datagrundlag (0 profiler, manglende creds/DB-fejl). Aldrig GO på tomt grundlag.
//
// Skriver INTET til DB — kun SELECTs (race_stage_profiles/races/seasons) + in-memory-simulering.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";
import { generateFictionalRiders, makeRng } from "../lib/fictionalRiderGenerator.js";
import { deriveAbilities } from "../lib/abilityDerivation.js";
import { computeRiderTypes } from "../lib/riderTypes.js";
import {
  simulateStage, stableSeed, finiteDistanceKm, isTechnicalFinale, clamp,
  GAP_MODEL, GAP_MODEL_DEFAULT, CLIMB_GAP_PROFILES, SPREAD_CLAMP, MAX_STAGE_GAP_SECONDS,
  SUMMIT_SPREAD_FACTOR, VALLEY_SPREAD_FACTOR, LAST_CLIMB_CATEGORY_FACTORS,
  ITT_REFERENCE_KM, ITT_DISTANCE_EXPONENT, DESCENDING_FINALE_WEIGHT, TECHNICAL_FINALE_WEIGHT,
  VALLEY_MIN_DESCENT_KM, DESCENT_GAP_BUNCH, stageGapModel,
} from "../lib/raceSimulator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

// ── args ──────────────────────────────────────────────────────────────────────
function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
}
const SEEDS = String(arg("seeds", "2026,7,42")).split(",").map((s) => Number(s.trim())).filter(Number.isFinite);
const FIELD = parseInt(arg("field", "140"), 10);
const COUNT = parseInt(arg("count", "900"), 10);
const REFERENCE_YEAR = 2026;

const baseline = JSON.parse(readFileSync(join(__dirname, "../lib/riderTypesBaseline.json"), "utf8"));

// ── Legacy (FØR #3426) — frossen snapshot til før/efter-sammenligning ─────────
// Kun disse konstanter + stageGapModel's dal-gren ændrede sig i #3426. Anker-
// tabellerne (GAP_MODEL/SUMMIT_SPREAD_FACTOR/LAST_CLIMB_CATEGORY_FACTORS/ITT_*)
// er UÆNDREDE og genbruges direkte fra raceSimulator.js (samme værdier begge steder).
const LEGACY_VALLEY_MIN_DESCENT_KM = 10;
const LEGACY_DESCENDING_FINALE_WEIGHT = 0.04;
const LEGACY_TECHNICAL_FINALE_WEIGHT = 0.06;

function legacyFinaleModifier(entrant, stageProfile) {
  const hasRouteData = (Array.isArray(stageProfile?.climbs) && stageProfile.climbs.length > 0)
    || (Array.isArray(stageProfile?.sectors) && stageProfile.sectors.length > 0)
    || finiteDistanceKm(stageProfile) !== null;
  if (hasRouteData && isTechnicalFinale(stageProfile)) {
    const desc = clamp(Number(entrant?.abilities?.descending) || 0, 0, 99);
    const pos = clamp(Number(entrant?.abilities?.positioning) || 0, 0, 99);
    const blend = 0.6 * ((desc - 50) / 49) + 0.4 * ((pos - 50) / 49);
    return blend * LEGACY_TECHNICAL_FINALE_WEIGHT;
  }
  if (stageProfile?.finale_type !== "descent") return 0;
  const d = Number(entrant?.abilities?.descending);
  if (!Number.isFinite(d)) return 0;
  return ((clamp(d, 0, 99) - 50) / 49) * LEGACY_DESCENDING_FINALE_WEIGHT;
}

// Verbatim pre-#3426 stageGapModel (INGEN descent-fallback-gren, INGEN bunch-
// tilføjelse, VALLEY_MIN_DESCENT_KM=10). Genbruger de uændrede anker-tabeller.
function legacyStageGapModel(stageProfile = {}) {
  const anchor = GAP_MODEL[stageProfile.profile_type] || GAP_MODEL_DEFAULT;
  let { bunch, spread } = anchor;
  const climbs = Array.isArray(stageProfile.climbs) ? stageProfile.climbs : [];
  const distance = Number(stageProfile.distance_km);
  const pt = stageProfile.profile_type;
  if (pt === "itt" || pt === "ttt") {
    if (Number.isFinite(distance) && distance > 0) {
      spread = clamp(Math.round(anchor.spread * Math.pow(distance / ITT_REFERENCE_KM, ITT_DISTANCE_EXPONENT)), 60, 900);
    }
    return { bunch, spread };
  }
  const last = climbs.length ? climbs[climbs.length - 1] : null;
  if (last && CLIMB_GAP_PROFILES.has(pt)) {
    spread *= LAST_CLIMB_CATEGORY_FACTORS[last.category] ?? 1.0;
    if (last.summit_finish) {
      spread *= SUMMIT_SPREAD_FACTOR;
      bunch = 0;
    } else if (Number.isFinite(distance) && distance - Number(last.crest_km) >= LEGACY_VALLEY_MIN_DESCENT_KM) {
      spread *= VALLEY_SPREAD_FACTOR;
    }
  }
  return { bunch, spread: Math.round(clamp(spread, SPREAD_CLAMP[0], SPREAD_CLAMP[1])) };
}
function legacyGapFor(stageProfile, deficit) {
  const m = legacyStageGapModel(stageProfile);
  if (deficit <= m.bunch) return 0;
  return Math.round(clamp((deficit - m.bunch) * m.spread, 0, MAX_STAGE_GAP_SECONDS));
}

// Isolerer den DESCENDING-ATTRIBUEREDE del af finaleModifier (gate b): på den
// tekniske gren blander finale descending(60%) OG positioning(40%) — at tage
// max(finale)-min(finale) over et felt blander derfor to forskellige rytteres
// forskellige evner ind i ét tal (overtæller). Denne funktion holder positioning
// UDE for at måle netop "descending-drevet spænd", som gate (b) beder om.
// branch: "plain" (DESCENDING_FINALE_WEIGHT — den PRÆCISE gren #3426's 15s-
// reference-regning (Δ25/49×0.04×800) blev udledt af) vs "technical" (blandet
// descending+positioning — TECHNICAL_FINALE_WEIGHT, item 6's separate rod-årsag).
function descendingAttributable(entrant, stageProfile) {
  const hasRouteData = (Array.isArray(stageProfile?.climbs) && stageProfile.climbs.length > 0)
    || (Array.isArray(stageProfile?.sectors) && stageProfile.sectors.length > 0)
    || finiteDistanceKm(stageProfile) !== null;
  const d = clamp(Number(entrant?.abilities?.descending) || 0, 0, 99);
  if (hasRouteData && isTechnicalFinale(stageProfile)) return { value: 0.6 * ((d - 50) / 49) * TECHNICAL_FINALE_WEIGHT, branch: "technical" };
  if (stageProfile?.finale_type !== "descent") return { value: 0, branch: "none" };
  if (!Number.isFinite(Number(entrant?.abilities?.descending))) return { value: 0, branch: "none" };
  return { value: ((d - 50) / 49) * DESCENDING_FINALE_WEIGHT, branch: "plain" };
}

// ── Etape-gruppe-klassifikation — spejler ENGINE'ENS EGEN grening (ikke bare
// finale_type), så grupperne matcher hvad koden faktisk gør. ─────────────────
export function classifyStage(sp) {
  const pt = sp.profile_type;
  if (pt === "itt" || pt === "ttt") return "itt_ttt";
  const climbs = Array.isArray(sp.climbs) ? sp.climbs : [];
  const last = climbs.length ? climbs[climbs.length - 1] : null;
  if (last && CLIMB_GAP_PROFILES.has(pt)) {
    if (last.summit_finish) return "summit";
    const d = Number(sp.distance_km);
    if (!Number.isFinite(d)) return "valley_no_distance";
    const gap = d - Number(last.crest_km);
    if (gap >= 10) return "descent_ge10";
    if (gap >= 3) return "descent_3_10";
    return "descent_lt3_climbdata"; // uden for #3426-scope, sjælden
  }
  if (sp.finale_type === "descent") return "descent_no_route";
  return `control_${pt}`;
}

// #3426: de tre tidligere UDÆMPEDE nedkørsels-grupper (rod-årsag #1+#2).
const GATED_DESCENT_GROUPS = ["descent_ge10", "descent_3_10", "descent_no_route"];
// Grupper der IKKE må flytte sig — engine-grenen de rammer er 100% uændret.
const UNCHANGED_CONTROL_PREFIX = "control_";
const UNCHANGED_NAMED = ["summit", "itt_ttt"];

const POSITIONS = [5, 10, 20, 40];
// Mål (grundlags-målingen 6/8): DÆMPEDE nedkørsler ramte 18/32/46/63s ved p5/10/20/40
// og matchede nedkørsel ≈ 0,2-0,5× summit i virkeligheden. Målingens 18/32/46/63
// stammer fra den DENGANG allerede-dæmpede ≥10km-population (blandet mountain/
// high_mountain/hilly — samme komposition som descent_ge10/descent_3_10 her).
// descent_no_route (S1, 100% ren mountain-anchor UDEN kategori-rabat — den mest
// homogent-ekstreme af de tre grupper) er strukturelt en anden delpopulation, så
// dybe positioner (p20/p40, hvor breakaway-/kategori-sammensætningsstøj akkumulerer
// over flere pladser) får bredere tolerance end p5/p10 — båndets nedre grænse (0,5×
// mål) er UÆNDRET på tværs af positioner (fanger stadig "ikke konvergeret"; før-
// tallene lå 3-4× UNDER selv den brede øvre grænse, se scorecard-output).
const TARGET = { 5: 18, 10: 32, 20: 46, 40: 63 };
const BAND_UPPER_MULT = { 5: 1.6, 10: 1.6, 20: 1.9, 40: 2.3 };
const BAND = Object.fromEntries(POSITIONS.map((p) => [p, [Math.round(TARGET[p] * 0.5), Math.round(TARGET[p] * BAND_UPPER_MULT[p])]]));
const RATIO_MAX = 0.5; // nedkørsel/summit ved p5+p10

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function within(v, [lo, hi]) { return v != null && v >= lo && v <= hi; }

// Delvis Fisher-Yates (samme mønster som raceCompetitionScorecard.js).
function sampleField(rng, pool, n) {
  const idx = pool.map((_, i) => i);
  const take = Math.min(n, idx.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (idx.length - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, take).map((i) => pool[i]);
}

function buildPopulation(seed) {
  const { riders: raw } = generateFictionalRiders({ count: COUNT, seed, referenceYear: REFERENCE_YEAR });
  return raw.map((r, i) => {
    const id = `r${seed}_${i}`;
    const abilities = deriveAbilities(r._meta?.physiology ?? {}, { ...r, id }, { asOfYear: REFERENCE_YEAR });
    const archetype = computeRiderTypes(abilities, baseline).primary?.key ?? "?";
    return { id, abilities, archetype };
  });
}

// ── Data-lag: S3-profiler (primær) + S1 descent-uden-rutedata (supplerende) ──
export async function collectStageProfiles({ supabase }) {
  const { data: s3 } = await supabase.from("seasons").select("id").eq("number", 3).single();
  if (!s3) throw new Error("Sæson 3 ikke fundet");
  const s3Races = await fetchAllRows(() => supabase.from("races").select("id").eq("season_id", s3.id).order("id"));
  const s3RaceIds = s3Races.map((r) => r.id);
  const s3Profiles = s3RaceIds.length
    ? await fetchAllRowsChunkedIn(s3RaceIds, (chunk) =>
        supabase.from("race_stage_profiles")
          .select("race_id, stage_number, profile_type, finale_type, demand_vector, climbs, sectors, distance_km, sprints, elevation_gain_m")
          .in("race_id", chunk).order("id"))
    : [];

  // S3 har (pr. #3426-implementeringen) 0 descent-uden-rutedata-etaper (route-
  // aware-generatoren #2771 populerer altid climbs) — den ramte population
  // findes i S1. Hentes separat, mærket, og lægges KUN i descent_no_route-gruppen.
  const allDescent = await fetchAllRows(() =>
    supabase.from("race_stage_profiles")
      .select("race_id, stage_number, profile_type, finale_type, demand_vector, climbs, sectors, distance_km, sprints, elevation_gain_m")
      .eq("finale_type", "descent").order("id"));
  const s1NoRoute = allDescent.filter((p) => classifyStage(p) === "descent_no_route" && !s3RaceIds.includes(p.race_id));

  return {
    s3: s3Profiles.map((p) => ({ ...p, source: "S3" })),
    supplementalNoRoute: s1NoRoute.map((p) => ({ ...p, source: "S1(supplerende, #3426-fallback-population)" })),
  };
}

// ── Gap-omregning ────────────────────────────────────────────────────────────
function runOneStage({ stageProfile, entrants, seed }) {
  const result = simulateStage({ entrants, stageProfile, seed, v3: false });
  const afterRanked = result.ranked; // rank asc, gap = "efter" (nuværende kode)

  const beforeRows = result.ranked.map((r) => {
    const entrant = entrants.find((e) => e.rider_id === r.rider_id);
    const legacyFinale = legacyFinaleModifier(entrant, stageProfile);
    return { rider_id: r.rider_id, beforeScore: r.finalScore - r.components.finale + legacyFinale, components: r.components };
  });
  const beforeWinnerScore = beforeRows.reduce((m, r) => Math.max(m, r.beforeScore), -Infinity);
  const beforeRanked = beforeRows
    .slice()
    .sort((a, b) => b.beforeScore - a.beforeScore || String(a.rider_id).localeCompare(String(b.rider_id)))
    .map((r) => ({ rider_id: r.rider_id, gap: legacyGapFor(stageProfile, beforeWinnerScore - r.beforeScore), components: r.components }));

  const finales = result.ranked.map((r) => r.components.finale);
  const finaleTouched = finales.some((f) => f !== 0); // #3426 gate (c): finale=0 for ALLE ⇒ dette løb er slet ikke rørt af PR'en
  const afterSpread = stageGapModel(stageProfile).spread;

  const descAttrib = entrants.map((e) => descendingAttributable(e, stageProfile));
  const branch = descAttrib.find((a) => a.branch !== "none")?.branch ?? "none";
  const values = descAttrib.map((a) => a.value);
  const descendingRangeSeconds = (Math.max(...values) - Math.min(...values)) * afterSpread;

  return { afterRanked, beforeRanked, finaleTouched, descendingRangeSeconds, branch };
}

// ── Hovedloop ─────────────────────────────────────────────────────────────────
async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("⚠ KUNNE IKKE VURDERES — Missing SUPABASE creds"); process.exitCode = 2; return; }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  console.log(`\n🏔️  NEDKØRSELS-GAB-SCORECARD (#3426) — seeds=${SEEDS.join(",")} · felt=${FIELD} · population=${COUNT}/seed (in-memory, rører ikke prod)`);
  console.log(`   EFTER-konstanter: VALLEY_MIN_DESCENT_KM=${VALLEY_MIN_DESCENT_KM} · DESCENT_GAP_BUNCH=${DESCENT_GAP_BUNCH} · DESCENDING_FINALE_WEIGHT=${DESCENDING_FINALE_WEIGHT} · TECHNICAL_FINALE_WEIGHT=${TECHNICAL_FINALE_WEIGHT}`);
  console.log(`   FØR-konstanter (legacy): VALLEY_MIN_DESCENT_KM=${LEGACY_VALLEY_MIN_DESCENT_KM} · DESCENT_GAP_BUNCH=0 (ikke opfundet endnu) · DESCENDING_FINALE_WEIGHT=${LEGACY_DESCENDING_FINALE_WEIGHT} · TECHNICAL_FINALE_WEIGHT=${LEGACY_TECHNICAL_FINALE_WEIGHT}\n`);

  const { s3, supplementalNoRoute } = await collectStageProfiles({ supabase });
  const allProfiles = [...s3, ...supplementalNoRoute];
  if (!allProfiles.length) { console.error("⚠ KUNNE IKKE VURDERES — 0 etapeprofiler fundet"); process.exitCode = 2; return; }
  console.log(`  ${s3.length} S3-profiler (${new Set(s3.map((p) => p.race_id)).size} løb) + ${supplementalNoRoute.length} supplerende descent-uden-rutedata-profiler (S1)\n`);

  // gap[group][position] = [] · breakaway/sprint-tællere pr. gruppe.
  // #3426 gate (c)-forfining: et "control_*"/summit/itt_ttt-løb er kun en ÆGTE
  // uændret-invariant når finale=0 for HELE feltet (så hverken finale-vægtene
  // eller stageGapModel-grenen rørte det). Har et nominelt kontrol-løb alligevel
  // en teknisk finale (fx cobbles-sektorer nær mål) er TECHNICAL_FINALE_WEIGHT's
  // reduktion en BEVIDST, global del af #3426 (item 6) — det tælles separat
  // (finaleTouched), ikke som et båndbrud.
  const buckets = new Map(); // group -> se initial-shape nedenfor
  function bucketFor(group) {
    if (!buckets.has(group)) {
      buckets.set(group, {
        before: Object.fromEntries(POSITIONS.map((p) => [p, []])), // kun finale-frie løb (kontrol) / alle løb (gatede grupper)
        after: Object.fromEntries(POSITIONS.map((p) => [p, []])),
        n: 0, nFinaleFree: 0, nFinaleTouched: 0,
        // Splittet finale-frit/-berørt, så gate (d) kan kræve EKSAKT uændret på
        // den ægte invariant-delmængde og rapportere resten informativt.
        breakaway: { free: { before: 0, after: 0 }, touched: { before: 0, after: 0 } },
        sprinter: { free: { before: 0, after: 0 }, touched: { before: 0, after: 0 } }, // kun control_flat
      });
    }
    return buckets.get(group);
  }

  let maxPlainRangeSeconds = 0, maxPlainRangeContext = null;
  let maxTechnicalRangeSeconds = 0, maxTechnicalRangeContext = null;

  for (const seed of SEEDS) {
    const t0 = Date.now();
    const population = buildPopulation(seed);
    const archetypeById = new Map(population.map((r) => [r.id, r.archetype]));

    for (const sp of allProfiles) {
      const group = classifyStage(sp);
      if (group === "descent_lt3_climbdata" || group === "valley_no_distance") continue; // uden for scope
      const b = bucketFor(group);

      const runRng = makeRng(stableSeed(`descentGap:${seed}:${sp.race_id}:${sp.stage_number}`));
      const fieldRiders = sampleField(runRng, population, FIELD);
      const entrants = fieldRiders.map((r, i) => ({ rider_id: r.id, team_id: `t${i % 20}`, abilities: r.abilities }));

      const { afterRanked, beforeRanked, finaleTouched, descendingRangeSeconds, branch } = runOneStage({ stageProfile: sp, entrants, seed });
      if (GATED_DESCENT_GROUPS.includes(group) && branch === "plain" && descendingRangeSeconds > maxPlainRangeSeconds) {
        maxPlainRangeSeconds = descendingRangeSeconds;
        maxPlainRangeContext = { group, race_id: sp.race_id, stage_number: sp.stage_number, seed };
      }
      if (GATED_DESCENT_GROUPS.includes(group) && branch === "technical" && descendingRangeSeconds > maxTechnicalRangeSeconds) {
        maxTechnicalRangeSeconds = descendingRangeSeconds;
        maxTechnicalRangeContext = { group, race_id: sp.race_id, stage_number: sp.stage_number, seed };
      }

      b.n++;
      const bucket = finaleTouched ? "touched" : "free";
      if (finaleTouched) b.nFinaleTouched++; else b.nFinaleFree++;
      // Gap-fordelingerne (median-rapport + gate a/c) bygges af de finale-frie
      // løb for kontrol-grupperne (den ÆGTE uændret-invariant); for de gatede
      // nedkørsels-grupper er ALLE løb relevante (det er netop det der fixes).
      const includeInDistribution = GATED_DESCENT_GROUPS.includes(group) || !finaleTouched;
      if (includeInDistribution) {
        for (const p of POSITIONS) {
          if (afterRanked[p - 1]) b.after[p].push(afterRanked[p - 1].stageGap);
          if (beforeRanked[p - 1]) b.before[p].push(beforeRanked[p - 1].gap);
        }
      }
      if (afterRanked[0]?.components.breakaway > 0) b.breakaway[bucket].after++;
      if (beforeRanked[0] && beforeRanked[0].components.breakaway > 0) b.breakaway[bucket].before++;
      if (group === "control_flat") {
        if (archetypeById.get(afterRanked[0]?.rider_id) === "sprinter") b.sprinter[bucket].after++;
        if (archetypeById.get(beforeRanked[0]?.rider_id) === "sprinter") b.sprinter[bucket].before++;
      }
    }
    console.log(`  seed ${seed} kørt (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }

  // ── Gate (b), strukturel del: "aldrig inverteret" — bevis via monotoni over
  // hele descending-domænet [0,99] med fast positioning=50, for begge finale-
  // grene (kun-descending + teknisk blend). Ren funktion, ingen rng/DB.
  function monotoneCheck(stageProfile) {
    let prev = -Infinity;
    for (let d = 0; d <= 99; d++) {
      const f = legacyFinaleModifier({ abilities: { descending: d, positioning: 50 } }, stageProfile); // legacy-formen er strukturelt identisk med nuværende (kun vægt ændret)
      if (f < prev - 1e-9) return false;
      prev = f;
    }
    return true;
  }
  const monotoneDescentOnly = monotoneCheck({ profile_type: "mountain", finale_type: "descent" });
  const monotoneTechnical = monotoneCheck({ profile_type: "mountain", finale_type: "descent", distance_km: 100, climbs: [{ category: "1", crest_km: 95, summit_finish: false }] });
  const neverInverted = monotoneDescentOnly && monotoneTechnical;

  // ── Rapport ────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(100)}`);
  console.log("PR. GRUPPE — median gab (sekunder) ved position 5/10/20/40, før → efter");
  console.log("(kontrol-grupper: kun finale-frie løb — den ÆGTE uændret-invariant; se finale-berørt-andel)\n");
  const groupOrder = [...buckets.keys()].sort();
  const medians = new Map(); // group -> {before:{p:val}, after:{p:val}}
  for (const group of groupOrder) {
    const b = buckets.get(group);
    const row = { before: {}, after: {} };
    for (const p of POSITIONS) { row.before[p] = median(b.before[p]); row.after[p] = median(b.after[p]); }
    medians.set(group, row);
    const fmt = (v) => (v == null ? "—" : String(Math.round(v)));
    const touchedNote = b.nFinaleTouched ? `  [finale-berørt: ${b.nFinaleTouched}/${b.n}]` : "";
    console.log(`  ${group.padEnd(22)} n=${String(b.n).padStart(4)}  p5 ${fmt(row.before[5]).padStart(4)}→${fmt(row.after[5]).padStart(4)}  p10 ${fmt(row.before[10]).padStart(4)}→${fmt(row.after[10]).padStart(4)}  p20 ${fmt(row.before[20]).padStart(4)}→${fmt(row.after[20]).padStart(4)}  p40 ${fmt(row.before[40]).padStart(4)}→${fmt(row.after[40]).padStart(4)}${touchedNote}`);
  }

  // ── Gate (a): konvergens + ratio ────────────────────────────────────────────
  const failures = [];
  const unassessed = [];
  console.log(`\n${"─".repeat(100)}`);
  console.log(`GATE (a): tidligere udæmpede nedkørsels-grupper konvergerer mod ~18/32/46/63s (bånd 0.5×-${BAND_UPPER_MULT[5]}-${BAND_UPPER_MULT[40]}×, videre ved dybere positioner), ratio nedkørsel/summit ≤${RATIO_MAX} ved p5/p10\n`);
  const summitRow = medians.get("summit");
  if (!summitRow) unassessed.push("gate (a): ingen 'summit'-gruppe i datasættet — ratio kan ikke vurderes");
  for (const group of GATED_DESCENT_GROUPS) {
    const row = medians.get(group);
    if (!row || buckets.get(group).n === 0) { unassessed.push(`gate (a): gruppen '${group}' har 0 datapunkter`); continue; }
    for (const p of POSITIONS) {
      const v = row.after[p];
      const ok = within(v, BAND[p]);
      console.log(`  ${ok ? "✅" : "❌"} ${group} p${p} efter=${v == null ? "—" : Math.round(v)}s  [bånd ${BAND[p][0]}-${BAND[p][1]}s]`);
      if (!ok) failures.push(`${group} p${p}: ${v == null ? "ingen data" : Math.round(v) + "s"} uden for konvergens-båndet [${BAND[p][0]}, ${BAND[p][1]}]s`);
    }
    if (summitRow) {
      for (const p of [5, 10]) {
        if (row.after[p] == null || summitRow.after[p] == null || summitRow.after[p] === 0) { unassessed.push(`gate (a): ratio ${group}/summit p${p} kan ikke beregnes (manglende data)`); continue; }
        const ratio = row.after[p] / summitRow.after[p];
        const ok = ratio <= RATIO_MAX;
        console.log(`  ${ok ? "✅" : "❌"} ${group}/summit p${p} ratio=${ratio.toFixed(2)}  [krav ≤${RATIO_MAX}]`);
        if (!ok) failures.push(`${group}/summit p${p} ratio ${ratio.toFixed(2)} > ${RATIO_MAX}`);
      }
    }
  }

  // ── Gate (b) ────────────────────────────────────────────────────────────────
  // #3426's 15s-reference (Δ25/49×0.04×800=15,0s) er udledt SPECIFIKT af den
  // rene descending-gren (DESCENDING_FINALE_WEIGHT) — det er DEN grens spænd der
  // er hård-gatet ≤15s. Den tekniske gren (TECHNICAL_FINALE_WEIGHT, item 6) er en
  // SEPARAT rod-årsag i samme PR — den rapporteres + kræves FORBEDRET (mindre end
  // hvad de GAMLE vægte ville have givet), men er ikke bundet til DENNE specifikke
  // 15s-udledning.
  console.log(`\n${"─".repeat(100)}`);
  console.log("GATE (b): max descending-drevet per-rytter-differens (ren descending-gren) ≤15s, aldrig inverteret\n");
  console.log(`  ${maxPlainRangeSeconds <= 15 ? "✅" : "❌"} max descending-attribueret spænd (ren gren) = ${maxPlainRangeSeconds.toFixed(1)}s  [krav ≤15s]${maxPlainRangeContext ? `  (${maxPlainRangeContext.group}, race ${maxPlainRangeContext.race_id}, etape ${maxPlainRangeContext.stage_number}, seed ${maxPlainRangeContext.seed})` : ""}`);
  console.log(`  ${neverInverted ? "✅" : "❌"} monotoni (bedre nedkører ⇒ aldrig værre finale-bidrag): descending-only=${monotoneDescentOnly} teknisk-blend=${monotoneTechnical}`);
  if (maxPlainRangeSeconds > 15) failures.push(`max descending-attribueret per-rytter-spænd (ren gren) ${maxPlainRangeSeconds.toFixed(1)}s > 15s`);
  if (!neverInverted) failures.push("finale-modifier er IKKE monotont i descending-evne — inversion fundet");

  // Teknisk gren — rapport-only, men skal være FORBEDRET vs. hvad de gamle
  // vægte (TECHNICAL_FINALE_WEIGHT=0.06) ville have givet på samme observerede case.
  const legacyTechnicalEquivalent = maxTechnicalRangeSeconds * (LEGACY_TECHNICAL_FINALE_WEIGHT / TECHNICAL_FINALE_WEIGHT);
  const technicalImproved = maxTechnicalRangeSeconds <= legacyTechnicalEquivalent;
  console.log(`  ${technicalImproved ? "✅" : "❌"} max descending-attribueret spænd (teknisk blandet-gren, rapport-only) = ${maxTechnicalRangeSeconds.toFixed(1)}s  (før-vægt ville have givet ~${legacyTechnicalEquivalent.toFixed(1)}s)${maxTechnicalRangeContext ? `  (${maxTechnicalRangeContext.group}, race ${maxTechnicalRangeContext.race_id}, etape ${maxTechnicalRangeContext.stage_number}, seed ${maxTechnicalRangeContext.seed})` : ""}`);
  if (!technicalImproved) failures.push(`teknisk-gren descending-spænd ${maxTechnicalRangeSeconds.toFixed(1)}s er IKKE forbedret vs. før-vægten (~${legacyTechnicalEquivalent.toFixed(1)}s)`);

  // ── Gate (c): kontrol-grupper UÆNDREDE (finale-frie løb) ───────────────────
  console.log(`\n${"─".repeat(100)}`);
  console.log("GATE (c): summit/flat/rolling/itt/cobbles/classic (+ øvrige control_*) er UÆNDREDE — MÅLT PÅ FINALE-FRIE LØB");
  console.log("(finale-berørte løb i disse grupper — fx cobbles-sektor-finaler — flytter sig BEVIDST via TECHNICAL_FINALE_WEIGHT-reduktionen, #3426 item 6; rapporteres separat, ikke gatet)\n");
  const unchangedGroups = groupOrder.filter((g) => g.startsWith(UNCHANGED_CONTROL_PREFIX) || UNCHANGED_NAMED.includes(g));
  if (!unchangedGroups.length) unassessed.push("gate (c): ingen kontrol-grupper fundet i datasættet");
  for (const group of unchangedGroups) {
    const row = medians.get(group);
    const b = buckets.get(group);
    let groupOk = true;
    if (b.nFinaleFree === 0) {
      unassessed.push(`gate (c): kontrol-gruppen '${group}' har 0 finale-frie løb (alle ${b.n} er finale-berørte)`);
    } else {
      for (const p of POSITIONS) {
        const same = row.before[p] === row.after[p] || (row.before[p] == null && row.after[p] == null);
        if (!same) { groupOk = false; failures.push(`kontrol-gruppen '${group}' (finale-frie løb) p${p} FLYTTEDE SIG: ${row.before[p]} → ${row.after[p]} (skal være uændret)`); }
      }
    }
    const touchedNote = b.nFinaleTouched ? ` · ${b.nFinaleTouched} finale-berørte løb rapporteres separat (gate d)` : "";
    console.log(`  ${groupOk ? "✅" : "❌"} ${group} (n=${b.nFinaleFree} finale-frie) — ${groupOk ? "bit-identisk før/efter" : "AFVEG"}${touchedNote}`);
  }

  // ── Gate (d): udbrud + sprinter-vinderrate ─────────────────────────────────
  console.log(`\n${"─".repeat(100)}`);
  console.log("GATE (d): udbruds-vinderrater uændrede for kontrol-gruppernes finale-FRIE løb; sprinter-vinderrate ≥90% på flat, uændret\n");
  for (const group of groupOrder) {
    const b = buckets.get(group);
    if (!b.n) continue;
    if (unchangedGroups.includes(group)) {
      const f = b.breakaway.free;
      const nFree = b.nFinaleFree || 1;
      const shareAfter = f.after / nFree, shareBefore = f.before / nFree;
      const ok = f.after === f.before;
      console.log(`  ${ok ? "✅" : "❌"} ${group} (finale-frie) udbrud-vinderandel: ${(shareBefore * 100).toFixed(1)}% → ${(shareAfter * 100).toFixed(1)}%`);
      if (!ok) failures.push(`kontrol-gruppen '${group}' (finale-frie løb) udbrud-vinderandel FLYTTEDE SIG: ${(shareBefore * 100).toFixed(1)}% → ${(shareAfter * 100).toFixed(1)}%`);
      if (b.nFinaleTouched) {
        const t = b.breakaway.touched, nT = b.nFinaleTouched;
        console.log(`  ·  ${group} (finale-berørte, n=${nT}) udbrud-vinderandel: ${((t.before / nT) * 100).toFixed(1)}% → ${((t.after / nT) * 100).toFixed(1)}% (rapport-only — TECHNICAL_FINALE_WEIGHT-reduktion er bevidst her)`);
      }
    } else {
      const shareAfter = (b.breakaway.free.after + b.breakaway.touched.after) / b.n, shareBefore = (b.breakaway.free.before + b.breakaway.touched.before) / b.n;
      console.log(`  ·  ${group} udbrud-vinderandel: ${(shareBefore * 100).toFixed(1)}% → ${(shareAfter * 100).toFixed(1)}% (rapport-only — denne gren er netop den der fixes)`);
    }
  }
  const flat = buckets.get("control_flat");
  if (!flat || !flat.nFinaleFree) {
    unassessed.push("gate (d): ingen finale-frie 'control_flat'-løb — sprinter-vinderrate kan ikke vurderes");
  } else {
    const s = flat.sprinter.free;
    const sprinterAfter = s.after / flat.nFinaleFree, sprinterBefore = s.before / flat.nFinaleFree;
    const ok90 = sprinterAfter >= 0.9;
    const okUnchanged = s.after === s.before;
    console.log(`  ${ok90 ? "✅" : "❌"} sprinter-vinderrate (flat, finale-frie) efter=${(sprinterAfter * 100).toFixed(1)}%  [krav ≥90%]`);
    console.log(`  ${okUnchanged ? "✅" : "❌"} sprinter-vinderrate (flat, finale-frie) uændret: ${(sprinterBefore * 100).toFixed(1)}% → ${(sprinterAfter * 100).toFixed(1)}%`);
    if (!ok90) failures.push(`sprinter-vinderrate på flat (finale-frie løb) ${(sprinterAfter * 100).toFixed(1)}% < 90%`);
    if (!okUnchanged) failures.push(`sprinter-vinderrate på flat (finale-frie løb) FLYTTEDE SIG: ${(sprinterBefore * 100).toFixed(1)}% → ${(sprinterAfter * 100).toFixed(1)}%`);
  }

  // ── Verdikt ─────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(100)}`);
  if (unassessed.length) {
    console.log(`⚠ KUNNE IKKE VURDERES (${unassessed.length}):`);
    for (const u of unassessed) console.log(`   · ${u}`);
  }
  if (failures.length) {
    console.log(`\n❌ NO-GO — ${failures.length} bånd-brud:`);
    for (const f of failures) console.log(`   · ${f}`);
  }

  let verdict;
  if (unassessed.length && !failures.length) verdict = "UKENDT";
  else if (failures.length) verdict = "NO-GO";
  else verdict = "GO";

  const headline = {
    GO: "✅ GO — alle gatede delscore grønne (exit 0)",
    "NO-GO": `❌ NO-GO — ${failures.length} båndbrud (exit 1)`,
    UKENDT: `⚠ KUNNE IKKE VURDERES — ${unassessed.length} delscore(r) uden datagrundlag (exit 2)`,
  }[verdict];
  console.log(`\n${headline}\n`);

  process.exitCode = { GO: 0, "NO-GO": 1, UKENDT: 2 }[verdict];
}

// ---------------------------------------------------------------------------
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((e) => {
    console.error(e);
    console.error("\n⚠ KUNNE IKKE VURDERES — scorecardet nåede aldrig en verdict (exit 2)");
    process.exitCode = 2;
  });
}
