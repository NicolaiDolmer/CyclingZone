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
//  3. Uheld OG tidsgrænse persisteres (#4879, opdateret 6/9). Da denne fil blev
//     skrevet havde v4 hverken uheldstrappe (#2944) eller tidsgrænse (#2582);
//     `incidents` var derfor hårdkodet til []. Begge mekanikker er nu koblet
//     ind i motoren, og broen oversætter dem til PRÆCIS de kolonner v3's
//     `race_incidents` har (se v4RowsFromIncidents nedenfor). Ryttere v4
//     markerer som `abandoned` ELLER `otl` udelades af `ranked` — flip-
//     kontrakten i mechanics/timeLimit.ts punkt 1: race_results har ingen
//     status-kolonne, så en rytter der er ude af løbet får INGEN etape-række,
//     præcis som v3's DNF. raceClassifications ekskluderer ham derefter
//     automatisk fra alle klassementer.
//
//  4. Neutral fortælling + v4's EGEN tidslinje (#4879, opdateret 6/9).
//     raceNarrative.extractStageMoments læser v3's score-komponenter
//     (terrain/team/work_cost/dayform), som v4 ikke producerer — alle de
//     grene er komponent-guardede, så kaldstedet kan kalde den med v4's
//     `ranked` og få Tier 0 (vinder + udfaldstype + udbrud + holddag +
//     GC-skifte) plus uheldsmomenterne, uden at opdigte et eneste tal.
//     Tidslinjen er IKKE længere v3's syntetiske buildStageTimeline: v4's egen
//     `StageOutput.timeline` (timeline_version 2) er den ægte hændelsesrække,
//     og den persisteres nu under sit eget versionsnummer i den SAMME tabel
//     (raceTimeline.buildStageTimelineV4). Broen validerer den mod v4's egen
//     timeline-validator FØR den slippes videre, så et fog-gate-brud aldrig
//     kan nå en spillerflade.

const V4_MODULE_SPECIFIERS = Object.freeze({
  core: "./engine/v4/index.ts",
  tuning: "./engine/v4/tuning.ts",
  entrants: "./engine/v4/adapters/entrantAdapter.ts",
  route: "./engine/v4/adapters/routeAdapter.ts",
  orders: "./engine/v4/orders/teamOrdersAdapter.ts",
  timeline: "./engine/v4/timeline.ts",
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
 * Udfald der betyder "ude af løbet" og derfor IKKE giver en etaperække.
 * 'abandoned' = M10's alvorlige styrt (#2944). 'otl' = M15's tidsgrænse
 * (#2582) — rytteren KOM i mål, men er ude af løbet alligevel, og
 * `race_results` har ingen status-kolonne at skrive forskellen i.
 */
const V4_OUT_OF_RACE_STATUSES = Object.freeze(new Set(["abandoned", "otl"]));

/**
 * v4's StageOutput → v3's `ranked`-form (den eneste form raceRunner kender).
 *
 * @param {{results: Array<{rider_id, rank, time_seconds, status}>, groupSnapshots?: Array}} output
 * @param {{teamIdByRider?: Map<string, string|null>}} [ctx]
 * @returns {Array<{rider_id, team_id, rank, stageGap, components}>}
 */
export function rankedFromV4Output(output, { teamIdByRider = new Map() } = {}) {
  const results = (output?.results ?? []).filter((r) => !V4_OUT_OF_RACE_STATUSES.has(r.status));
  if (!results.length) return [];
  const inBreakaway = breakawayRiderIdsFromSnapshots(output?.groupSnapshots);
  // v4 rangerer allerede (tid, finish_order, rider_id); vinderens tid er
  // referencen for etape-gappet, præcis som v3's gapFor er gap-til-vinder.
  const winnerTime = results[0].time_seconds;
  return results.map((r, index) => ({
    rider_id: r.rider_id,
    team_id: teamIdByRider.get(r.rider_id) ?? null,
    // Re-indekseret: v4's egen rank tælles over HELE feltet inkl. de udgåede
    // og OTL-ryttere, som vi netop har filtreret fra. 1..N uden huller er det
    // nedstrøms-kontrakten (pointopslag, countback) forudsætter.
    rank: index + 1,
    stageGap: clampGap(r.time_seconds - winnerTime),
    components: { breakaway: inBreakaway.has(r.rider_id) ? 1 : 0 },
  }));
}

// ── v4-uheld → race_incidents (#4879) ────────────────────────────────────────
//
// `race_incidents` har UNIQUE (race_id, stage_number, rider_id): PRÆCIS ét
// uheld pr. rytter pr. etape. v3 opfylder det per konstruktion (én lodtrækning
// pr. rytter pr. etape); v4's M10-hook kaldes pr. SEGMENT og kan derfor ramme
// den samme rytter flere gange. Broen folder derfor etapens hændelser sammen
// til ÉN række pr. rytter efter en fast, deterministisk regel:
//
//   * REPRÆSENTANT = den mest indgribende hændelse (udgået > tidsgrænse >
//     hårdt styrt > let styrt > mekanisk; ved lighed den tidligste km, så
//     rækken er uafhængig af hook-kaldsrækkefølgen).
//   * time_loss_seconds = SUMMEN af dagens tidstab for rytteren. Det er dét
//     han faktisk tabte; at vise kun ét af to uheld ville underdrive dagen.
//   * injury_days = den LÆNGSTE skade fra et STYRT (#4520: kun styrt skader —
//     v4's mechanics/incidents.ts håndhæver det allerede i kontrolstrømmen,
//     her spejles værdien blot). Sættes uanset hvilken række der blev
//     repræsentant, så en rytter der både styrtede og røg uden for
//     tidsgrænsen stadig får sine skadedage.
const V4_INCIDENT_DB_OUTCOME = Object.freeze({
  abandoned: "abandon",
  time_loss: "time_loss",
  protected_three_km_rule: "protected_three_km_rule",
});

/** Hvor indgribende er hændelsen? Højere tal vinder repræsentant-valget. */
function incidentWeight(inc) {
  if (inc.outcome === "abandoned") return 4;
  if (inc.severity === "hard") return 3;
  if (inc.severity === "light") return 2;
  return 1; // mekanisk uheld (severity er null per konstruktion)
}

function roundSeconds(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

/**
 * v4's StageOutput → race_incidents-kompatible rækker (uden race_id/stage_number,
 * som kaldstedet stempler på — samme form som v3's rollIncidents-output).
 *
 * Rækkefølgen er stabil (rider_id) så to identiske kørsler giver identiske
 * rækker — determinismen skal holde hele vejen ud i databasen, ikke kun i
 * motoren.
 *
 * @param {{incidents?: Array, results?: Array<{rider_id, status, injury_days}>}} output
 * @returns {Array<{rider_id, kind, severity, outcome, time_loss_seconds, injury_days}>}
 */
export function incidentRowsFromV4Output(output) {
  const perRider = new Map();
  for (const inc of output?.incidents ?? []) {
    const current = perRider.get(inc.rider_id) ?? {
      rider_id: inc.rider_id,
      representative: null,
      timeLoss: 0,
      hasTimeLoss: false,
      injuryDays: null,
    };
    // `Number(null)` er 0, ikke NaN — uden null-tjekket ville en 3 km-beskyttet
    // rytter (time_loss_seconds = null pr. konstruktion) få skrevet "tabte 0
    // sekunder" i stedet for "tabte ingen tid". Det er ikke det samme udsagn.
    const loss = inc.time_loss_seconds == null ? NaN : Number(inc.time_loss_seconds);
    if (Number.isFinite(loss)) {
      current.timeLoss += loss;
      current.hasTimeLoss = true;
    }
    // #4520: injury_days er ALDRIG sat på et mekanisk uheld — filteret her er
    // andet lag, så en fremtidig kaldsvej ikke kan genindføre koblingen.
    if (inc.kind === "crash" && Number.isFinite(inc.injury_days)) {
      current.injuryDays = Math.max(current.injuryDays ?? 0, inc.injury_days);
    }
    const best = current.representative;
    if (
      !best
      || incidentWeight(inc) > incidentWeight(best)
      || (incidentWeight(inc) === incidentWeight(best) && inc.km < best.km)
    ) {
      current.representative = inc;
    }
    perRider.set(inc.rider_id, current);
  }

  // M15's tidsgrænse (#2582): rytteren har ingen uheldsrække, men SKAL have en
  // markering — den er hele forklaringen på hvorfor hans etaperække mangler,
  // og den er dét loadAbandonedRiderIds læser for at holde ham ude af næste
  // etapes startliste. En udgået rytter kan ikke også være OTL (M15 rører dem
  // ikke), så de to grene kan aldrig skrive den samme rytter to gange.
  const otlRiderIds = new Set(
    (output?.results ?? []).filter((r) => r.status === "otl").map((r) => r.rider_id),
  );

  const rows = [];
  for (const riderId of new Set([...perRider.keys(), ...otlRiderIds])) {
    const folded = perRider.get(riderId);
    const isOtl = otlRiderIds.has(riderId);
    const rep = folded?.representative ?? null;
    const outOfRace = rep?.outcome === "abandoned";
    // Terminal-udfald vinder over et tidstab: rækken skal forklare hvorfor
    // rytteren er ude, ikke hvad han tabte undervejs.
    const kind = outOfRace ? rep.kind : isOtl ? "time_limit" : (rep?.kind ?? "crash");
    const outcome = outOfRace || isOtl ? "abandon" : V4_INCIDENT_DB_OUTCOME[rep?.outcome] ?? "time_loss";
    rows.push({
      rider_id: riderId,
      kind,
      severity: kind === "time_limit" ? null : (rep?.severity ?? null),
      outcome,
      // En udgået eller OTL-rytter har ingen etapetid at tabe.
      time_loss_seconds: outOfRace || isOtl ? null : (folded?.hasTimeLoss ? roundSeconds(folded.timeLoss) : null),
      injury_days: folded?.injuryDays ?? null,
    });
  }
  return rows.sort((a, b) => String(a.rider_id).localeCompare(String(b.rider_id)));
}

// ── v4-passager → race_stage_passages/race_results (#2770/#2413) ────────────
//
// EJER-BESLUTNING 6/9 (LAAST): naar v4 koerer etapen er MOTORENS EGEN M9-mekanik
// eneste kilde til spurtpoint, bjergpoint og bonussekunder — laget uden for
// motoren (racePassages.computePassages) gates AF for netop den etape. Uden
// gaten ville en rytter faa point og bonussekunder TO gange (auditens aabne
// punkt 6, spec §4).
//
// Formen er PRAECIS computePassages' egen ({passages, perRider}), saa
// kaldstedet i raceRunner kun skal vaelge kilde — ikke oversaette. Alt
// nedstrøms (passageRows, pushIndiv, accumulateStageRows, klassementerne) er
// uaendret og kan ikke se hvilken motor der regnede passagerne.

/**
 * Har etapen overhovedet rutedata nok til at have passager?
 *
 * SAMME data-gate som racePassages.computePassages (#2784): en legacy-raekke
 * uden BAADE distance, stigninger og spurter er ikke en rute — den ville
 * ellers faa et fantom-maal ved km 0 og dele Tour-point ud midt i en sæson.
 * v4's routeAdapter syntetiserer segmenter for saadan en raekke, saa gaten SKAL
 * ligge her: motoren kan ikke selv se forskel paa en syntese og en rigtig rute.
 */
export function stageHasPassageRouteData(stageProfile = {}) {
  const rawDistance = stageProfile.distance_km;
  const distance = rawDistance == null ? NaN : Number(rawDistance);
  const hasDistance = Number.isFinite(distance) && distance > 0;
  const climbs = Array.isArray(stageProfile.climbs) ? stageProfile.climbs : [];
  const sprints = Array.isArray(stageProfile.sprints) ? stageProfile.sprints : [];
  return hasDistance || climbs.length > 0 || sprints.length > 0;
}

/**
 * v4's StageOutput → computePassages-kompatibelt passage-lag, eller `null` naar
 * v4 IKKE er kilden for denne etape (endagsloeb eller rutedata-loes raekke).
 * `null` betyder "brug det gamle lag" — og det gamle lag returnerer selv tomt
 * i praecis de to tilfaelde, saa ingen af dem giver point ad bagvejen.
 *
 * @param {{passages?: Array, passage_totals?: Array}} output
 * @param {{stageProfile?: object, isStageRace?: boolean}} ctx
 * @returns {{passages: Array, perRider: Map<string, {kom_points: number, sprint_points: number, bonus_seconds: number}>}|null}
 */
export function passagesFromV4Output(output, { stageProfile = {}, isStageRace = false } = {}) {
  if (!isStageRace) return null;
  if (!stageHasPassageRouteData(stageProfile)) return null;
  const passages = Array.isArray(output?.passages) ? output.passages : [];
  const perRider = new Map();
  for (const row of output?.passage_totals ?? []) {
    perRider.set(row.rider_id, {
      kom_points: row.kom_points ?? 0,
      sprint_points: row.sprint_points ?? 0,
      bonus_seconds: row.bonus_seconds ?? 0,
    });
  }
  return { passages, perRider };
}

/**
 * raceRunner's simEntrant-form → v4's Entrant (kerne-kontrakten).
 * Bruger v4's EGEN entrantAdapter — ingen parallel evne-normalisering her.
 *
 * `condition` er 0-1; raceRunner bærer `fatigue` på 0-100-skalaen, så den
 * inverteres. M7 (distance-slid) forbruger feltet siden 6/9.
 *
 * `team_id` (M16 holdspil, #4246): raceRunner's simEntrant bærer det allerede
 * (samme felt `rosterForOrders` nedenfor læser). Uden det kan v4 ikke kende
 * forskel på en kaptajn med tre hjælpere og en kaptajn helt alene — auditten
 * 5/9's "ved et flip forsvinder både hjælperens pris og kaptajnens fordel".
 * Rollen alene er IKKE nok: `mechanics/teamPlay.ts` kræver begge, præcis som
 * v3's `buildTeamContext` springer enhver entrant uden team_id ELLER
 * race_role over.
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
      teamId: e.team_id,
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
  // Ordrer (#4246): ROLLEN er standardordren, og etapens gemte række er dagens
  // overlay oven på den. Adapteren får derfor hele startlistens (hold, rytter,
  // rolle) — et løb hvor ingen har rørt taktik-kortet kører rollernes egen
  // standard (en `hunter` prøver udbruddet, et sprint-tog kører for holdets
  // spurt-kaptajn), ikke en tom neutral ordre.
  const rosterForOrders = entrants
    .filter((e) => e.team_id != null && e.rider_id != null)
    .map((e) => ({ team_id: String(e.team_id), rider_id: String(e.rider_id), role: e.race_role ?? null }));
  const orders = modules.orders.buildStageOrders({
    rows: teamOrderRows,
    stageNumber,
    roster: rosterForOrders,
  });
  return { route, startlist, orders, seed: seedString, tuning: modules.tuning.RACE_V4_TUNING };
}

/**
 * v4's egen tidslinje, kørt gennem motorens EGEN validator (#2410 §2.3 +
 * fog-gaten #1791) før den slippes videre til persistering.
 *
 * Auditten 5/9 fandt validatoren "bygget og slukket" — den havde nul
 * kaldssteder i drift. Her er kaldsstedet: præcis dér hvor motorens events
 * første gang forlader motoren på vej mod en spillerflade.
 *
 * KONTRAKT VED BRUD: tidslinjen er et ADDITIVT artefakt oven på resultatet
 * (spec §2.1) — den må aldrig vælte en etape. Et brud logges (så det larmer i
 * prod-loggen) og etapen kører videre UDEN tidslinje, hvilket er præcis den
 * degradering `race_stage_timeline`-flaget allerede beskriver for flag-off.
 *
 * @returns {{timeline_version: number, events: Array}|null}
 */
function safeV4Timeline({ modules, v4Output, riderIds, distanceKm, stageNumber }) {
  const timeline = v4Output?.timeline;
  if (!timeline || !Array.isArray(timeline.events)) return null;
  const validate = modules?.timeline?.validateTimelineEvents;
  if (typeof validate !== "function") return timeline;
  const violations = validate(timeline.events, {
    distanceKm: Number(distanceKm) || 0,
    knownRiderIds: new Set(riderIds),
  });
  if (violations.length) {
    console.error(
      `  ⚠️  loebsmotor v4 etape ${stageNumber}: tidslinjen brød #2410 §2.3 og persisteres IKKE — `
      + violations.map((v) => `[${v.rule}] ${v.message}`).join("; "),
    );
    return null;
  }
  return timeline;
}

/**
 * Byg en drop-in-erstatning for raceSimulator.simulateStage oven på et sæt
 * allerede-indlæste v4-moduler. Eksporteret separat fra loadRaceEngineV4 så
 * tests kan bygge adapteren af rigtige imports uden dynamisk import.
 *
 * @param {object} modules  { core, tuning, entrants, route, orders, timeline }
 * @returns {{ version: number, simulateStage: Function }}
 */
export function createRaceEngineV4Adapter(modules) {
  return {
    version: ENGINE_VERSION_V4,
    /**
     * @param {{entrants, stageProfile, seedString, stageNumber, teamOrderRows?, isStageRace?}} args
     * @returns {{ranked: Array, incidents: Array, passages: object|null, timeline: object|null, v4Output: object}}
     */
    simulateStage({ entrants, stageProfile, seedString, stageNumber, teamOrderRows = [], isStageRace = false }) {
      if (!Array.isArray(entrants) || entrants.length === 0) {
        throw new Error("raceEngineV4Bridge: entrants kraeves (tomt startfelt)");
      }
      if (typeof seedString !== "string" || !seedString) {
        throw new Error("raceEngineV4Bridge: seedString (streng) kraeves");
      }
      const input = buildV4StageInput({ modules, entrants, stageProfile, seedString, stageNumber, teamOrderRows });
      const v4Output = modules.core.simulateStageV4(input);
      const teamIdByRider = new Map(entrants.map((e) => [e.rider_id, e.team_id ?? null]));
      return {
        ranked: rankedFromV4Output(v4Output, { teamIdByRider }),
        // #4879: M10 (#2944) + M15 (#2582) er koblet ind i motoren, så broen
        // oversætter nu deres udfald til v3's race_incidents-form.
        incidents: incidentRowsFromV4Output(v4Output),
        // #2770/#2413: v4's egen M9-mekanik ER passage-laget naar motoren
        // koerer etapen. `null` => kaldstedet bruger det gamle lag (endagsloeb
        // eller en raekke uden rutedata) — de to kan aldrig begge give point.
        passages: passagesFromV4Output(v4Output, { stageProfile, isStageRace }),
        // #4879: v4's EGEN tidslinje, valideret mod motorens egen vagt (se
        // safeV4Timeline). Null ⇒ kaldstedet skriver ingen tidslinje for
        // etapen, i stedet for at persistere et artefakt der bryder §2.3.
        timeline: safeV4Timeline({
          modules,
          v4Output,
          riderIds: entrants.map((e) => e.rider_id),
          distanceKm: input.route.distance_km,
          stageNumber,
        }),
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
    const [core, tuning, entrants, route, orders, timeline] = await Promise.all([
      importModule(V4_MODULE_SPECIFIERS.core),
      importModule(V4_MODULE_SPECIFIERS.tuning),
      importModule(V4_MODULE_SPECIFIERS.entrants),
      importModule(V4_MODULE_SPECIFIERS.route),
      importModule(V4_MODULE_SPECIFIERS.orders),
      importModule(V4_MODULE_SPECIFIERS.timeline),
    ]);
    return createRaceEngineV4Adapter({ core, tuning, entrants, route, orders, timeline });
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
      console.error(`  ⚠️  race ${raceId}: race_team_orders kunne ikke laeses (${error.message}) - v4 koerer med neutrale ordrer`);
      return [];
    }
    return (data ?? []).map((row) => ({ ...row, team_id: String(row.team_id) }));
  } catch (err) {
    // best-effort: motoren KRAEVER aldrig ordrer (T4 = neutral default), saa et
    // fejlet opslag maa aldrig vaelte en etape. Fejlen logges med race-id, og
    // etapen koerer videre uden holdtaktik i stedet for slet ikke at koere.
    console.error(`  ⚠️  race ${raceId}: race_team_orders-opslag fejlede (${err?.message}) - v4 koerer med neutrale ordrer`);
    return [];
  }
}
