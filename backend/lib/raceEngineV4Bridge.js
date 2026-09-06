// Løbsmotor v4 — flip-infrastruktur, skridt 1 (#3855, #4707).
//
// HVAD DEN ER: seamen mellem den UÆNDREDE resultat-pipeline (raceRunner.js →
// race_results/race_stage_passages/race_stage_timelines) og v4-kernen
// (backend/lib/engine/v4/index.ts). Auditten 5/9 konstaterede at v4 hverken
// havde et flag, et kaldssted, en vej tilbage til databasen, et
// motor-versionsnummer eller en kill-switch. Denne fil er de fire midterste;
// flaget bor i raceEngineFlag.js.
//
// DESIGNVALG (bevidst, så PR'en kan være ren infrastruktur):
//
//  1. v4's output oversættes til PRÆCIS den `ranked`-form v3's simulateStage
//     returnerer ({rider_id, team_id, rank, stageGap, components}). Alt
//     nedstrøms — pushIndiv, computePassages, accumulateStageRows,
//     buildStageTimeline, GC/point/bjerg/ungdom — er derfor UÆNDRET og ser
//     ingen forskel på hvilken motor der kørte etapen. Det er også dét der gør
//     kill-switchen billig: etape 1 kan være skrevet af v4 og etape 2 af v3,
//     og klassementet regnes stadig ud af race_results som før.
//
//  2. Dynamisk import. v4-kernen er TypeScript (kører på Node 24's type-
//     stripping). Med `await import()` inde i den flag-tændte gren betaler et
//     flag-OFF-backend ikke ét eneste modul-load, og "flag off ⇒ ingen v4-
//     import" er testbart som en hård garanti, ikke en påstand.
//
//  3. Ingen incidents. v4 har ingen abandon-mekanik (index.ts's egen note:
//     status 'abandoned' sættes aldrig i F2/F3), og v3's uheldsmodel er
//     bevidst ikke genbrugt — mekanikkerne er paritets-slicens arbejde.
//     `incidents` er derfor ALTID [] fra denne bro. Ryttere v4 alligevel
//     måtte markere som abandoned udelades af `ranked` (samme konvention som
//     v3's abandon-gren), så raceClassifications ekskluderer dem fra GC.
//
//  4. Neutral fortælling. raceNarrative.extractStageMoments læser v3's
//     score-komponenter (terrain/team/work_cost/dayform), som v4 ikke
//     producerer. Kaldstedet springer momenter over når v4 kører (moments =
//     []); tidslinjen bygges stadig af den SAMME buildStageTimeline som v3,
//     der degraderer gracefully til et tyndere artefakt uden momenter — samme
//     mekanisme flaget `race_stage_timeline` allerede dokumenterer for v3=off.
//     v4's egen (rigere) timeline i StageOutput.timeline kasseres i dette
//     skridt; at persistere den kræver en beslutning om timeline_version og en
//     frontend-aftager, og hører til paritets-slicen.

const V4_MODULE_SPECIFIERS = Object.freeze({
  core: "./engine/v4/index.ts",
  tuning: "./engine/v4/tuning.ts",
  entrants: "./engine/v4/adapters/entrantAdapter.ts",
  route: "./engine/v4/adapters/routeAdapter.ts",
  orders: "./engine/v4/orders/teamOrdersAdapter.ts",
});

/**
 * race_simulation_runs.engine_version for v4.
 * 1 = light-motoren (#1102), 2 = race v3-scoring (#2352, flippet 12/7), 4 = v4.
 * 3 springes over med vilje: der findes ingen motor med det nummer, og at
 * genbruge det ville gøre "v3" tvetydigt i prod-loggen.
 */
export const ENGINE_VERSION_V4 = 4;

/** Sikkerhedsloft på etape-gaps — SAMME værdi som raceSimulator.MAX_STAGE_GAP_SECONDS. */
const MAX_STAGE_GAP_SECONDS = 1800;

function clampGap(seconds) {
  if (!Number.isFinite(seconds)) return 0;
  return Math.min(Math.max(Math.round(seconds), 0), MAX_STAGE_GAP_SECONDS);
}

/**
 * Hvilke ryttere var i et udbrud på et tidspunkt i løbet?
 *
 * v4 producerer ingen score-komponenter, men gruppe-snapshottene bærer
 * kind='breakaway'. #1499's konvention nedstrøms er `components.breakaway > 0`
 * (deriveBreakawayStatus + computePassages' inFront-gate), så broen sætter
 * netop dét felt — og kun dét. Ingen anden komponent opdigtes.
 *
 * @param {Array<{groups?: Array<{kind?: string, rider_ids?: string[]}>}>} groupSnapshots
 * @returns {Set<string>}
 */
export function breakawayRiderIdsFromSnapshots(groupSnapshots = []) {
  const ids = new Set();
  for (const snapshot of groupSnapshots) {
    for (const group of snapshot?.groups ?? []) {
      if (group?.kind !== "breakaway") continue;
      for (const riderId of group.rider_ids ?? []) ids.add(riderId);
    }
  }
  return ids;
}

/**
 * v4's StageOutput → v3's `ranked`-form (den eneste form raceRunner kender).
 *
 * @param {{results: Array<{rider_id, rank, time_seconds, status}>, groupSnapshots?: Array}} output
 * @param {{teamIdByRider?: Map<string, string|null>}} [ctx]
 * @returns {Array<{rider_id, team_id, rank, stageGap, components}>}
 */
export function rankedFromV4Output(output, { teamIdByRider = new Map() } = {}) {
  const results = (output?.results ?? []).filter((r) => r.status !== "abandoned");
  if (!results.length) return [];
  const inBreakaway = breakawayRiderIdsFromSnapshots(output?.groupSnapshots);
  // v4 rangerer allerede (tid, finish_order, rider_id); vinderens tid er
  // referencen for etape-gappet, præcis som v3's gapFor er gap-til-vinder.
  const winnerTime = results[0].time_seconds;
  return results.map((r, index) => ({
    rider_id: r.rider_id,
    team_id: teamIdByRider.get(r.rider_id) ?? null,
    // Re-indekseret: v4's egen rank tælles over HELE feltet inkl. evt.
    // abandoned, som vi netop har filtreret fra. 1..N uden huller er det
    // nedstrøms-kontrakten (pointopslag, countback) forudsætter.
    rank: index + 1,
    stageGap: clampGap(r.time_seconds - winnerTime),
    components: { breakaway: inBreakaway.has(r.rider_id) ? 1 : 0 },
  }));
}

/**
 * raceRunner's simEntrant-form → v4's Entrant (kerne-kontrakten).
 * Bruger v4's EGEN entrantAdapter — ingen parallel evne-normalisering her.
 *
 * `condition` er 0-1; raceRunner bærer `fatigue` på 0-100-skalaen, så den
 * inverteres. v4's F2/F3-kerne læser feltet men bruger det ikke endnu (M7 er
 * paritets-scope); mapningen står her så den ikke skal opfindes to gange.
 */
function toV4Entrants(entrants, entrantAdapter) {
  return entrants.map((e) => {
    const fatigue = Number(e.fatigue);
    const condition = Number.isFinite(fatigue) ? 1 - Math.min(Math.max(fatigue, 0), 100) / 100 : 1;
    return entrantAdapter.entrantFromAbilitiesRow(e.abilities ?? {}, {
      riderId: e.rider_id,
      role: e.race_role,
      effort: e.effort,
      condition,
    });
  });
}

/**
 * Byg v4's StageInput af PRÆCIS de data raceRunner allerede har i hånden.
 * REN: ingen DB-kald (kaldstedet henter etape-rækken og ordre-rækkerne).
 *
 * @param {{
 *   modules: object,
 *   entrants: Array<object>,
 *   stageProfile: object,
 *   seedString: string,
 *   stageNumber: number,
 *   teamOrderRows?: Array<object>,
 * }} args
 */
export function buildV4StageInput({ modules, entrants, stageProfile, seedString, stageNumber, teamOrderRows = [] }) {
  const route = modules.route.routeFromStageProfileRow(stageProfile);
  const startlist = toV4Entrants(entrants, modules.entrants);
  // Ordrer: hold UDEN gemt række får T4-defaulten (neutral) af adapteren selv,
  // så et løb hvor ingen har rørt taktik-kortet er den neutrale kørsel.
  const teamIdsInStartlist = [
    ...new Set(entrants.map((e) => e.team_id).filter((id) => id != null).map(String)),
  ].sort();
  const orders = modules.orders.buildStageOrders({
    rows: teamOrderRows,
    stageNumber,
    teamIdsInStartlist,
  });
  return { route, startlist, orders, seed: seedString, tuning: modules.tuning.RACE_V4_TUNING };
}

/**
 * Byg en drop-in-erstatning for raceSimulator.simulateStage oven på et sæt
 * allerede-indlæste v4-moduler. Eksporteret separat fra loadRaceEngineV4 så
 * tests kan bygge adapteren af rigtige imports uden dynamisk import.
 *
 * @param {object} modules  { core, tuning, entrants, route, orders }
 * @returns {{ version: number, simulateStage: Function }}
 */
export function createRaceEngineV4Adapter(modules) {
  return {
    version: ENGINE_VERSION_V4,
    /**
     * @param {{entrants, stageProfile, seedString, stageNumber, teamOrderRows?}} args
     * @returns {{ranked: Array, incidents: Array, v4Output: object}}
     */
    simulateStage({ entrants, stageProfile, seedString, stageNumber, teamOrderRows = [] }) {
      if (!Array.isArray(entrants) || entrants.length === 0) {
        throw new Error("raceEngineV4Bridge: entrants kræves");
      }
      if (typeof seedString !== "string" || !seedString) {
        throw new Error("raceEngineV4Bridge: seedString (streng) kræves");
      }
      const input = buildV4StageInput({ modules, entrants, stageProfile, seedString, stageNumber, teamOrderRows });
      const v4Output = modules.core.simulateStageV4(input);
      const teamIdByRider = new Map(entrants.map((e) => [e.rider_id, e.team_id ?? null]));
      return {
        ranked: rankedFromV4Output(v4Output, { teamIdByRider }),
        // Se designvalg 3 øverst: v4 har ingen uheldsmekanik endnu.
        incidents: [],
        v4Output,
      };
    },
  };
}

// Modul-cache: v4-kernen er ren og statsløs, så ét load pr. proces rækker.
let cachedAdapterPromise = null;

/**
 * Indlæs v4-motoren (dynamisk import) og returnér adapteren.
 * Kaldes KUN når flaget `race_engine_v4` er tændt — flag-off rører aldrig
 * TypeScript-modulerne.
 */
export function loadRaceEngineV4({ importModule = (spec) => import(spec) } = {}) {
  if (cachedAdapterPromise) return cachedAdapterPromise;
  cachedAdapterPromise = (async () => {
    const [core, tuning, entrants, route, orders] = await Promise.all([
      importModule(V4_MODULE_SPECIFIERS.core),
      importModule(V4_MODULE_SPECIFIERS.tuning),
      importModule(V4_MODULE_SPECIFIERS.entrants),
      importModule(V4_MODULE_SPECIFIERS.route),
      importModule(V4_MODULE_SPECIFIERS.orders),
    ]);
    return createRaceEngineV4Adapter({ core, tuning, entrants, route, orders });
  })().catch((err) => {
    // Fejlet load må ikke forgifte cachen: næste afvikling skal kunne prøve igen
    // (og kaldstedet falder tilbage til v3, se raceRunner's resolveRaceEngine).
    cachedAdapterPromise = null;
    throw err;
  });
  return cachedAdapterPromise;
}

/** Kun til tests. */
export function __resetRaceEngineV4Cache() {
  cachedAdapterPromise = null;
}

/**
 * Hent ALLE holdordre-rækker for ét løb (v4's ordre-input). Kaldes KUN når
 * v4-flaget er tændt, så flag-off ikke betaler et ekstra DB-kald.
 *
 * Pagination-safe: PK-scopet (team, race, stage) — maks holdantal × etaper
 * rækker for ét løb. Fejl → tom liste (motoren kræver ALDRIG ordrer, T4:
 * neutral default), aldrig et væltet løb.
 */
export async function loadTeamOrderRows({ supabase, raceId }) {
  try {
    const { data, error } = await supabase
      .from("race_team_orders")
      .select("team_id, stage_number, breakaway_stance, riders")
      .eq("race_id", raceId);
    if (error) {
      console.error(`  ⚠️  race ${raceId}: race_team_orders kunne ikke læses (${error.message}) — v4 kører med neutrale ordrer`);
      return [];
    }
    return (data ?? []).map((row) => ({ ...row, team_id: String(row.team_id) }));
  } catch (err) {
    console.error(`  ⚠️  race ${raceId}: race_team_orders-opslag fejlede (${err?.message}) — v4 kører med neutrale ordrer`);
    return [];
  }
}
