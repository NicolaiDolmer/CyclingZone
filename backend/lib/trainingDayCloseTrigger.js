// Udloeseren "dagens loebsdage lukker" (#4847, fase B4).
// ============================================================================
// Spec: docs/superpowers/specs/2026-09-06-traening-pr-loebsdag-og-traeningsscore-design.md
//       §3.1 ("Udloeser"), §3.2 ("Udloeser og kapacitet"), §7 G6.
// Ejer-beslutninger 15/9: docs/TRAINING_RULES.md §13.3 beslutning 3 + 4.
//
// HVAD DEN ER. EEN samlet sweep pr. KALENDERDAG der koerer ALLE dagens loebsdage i
// ALLE divisioner i EEN koersel. Den erstatter IKKE trainingSweep.js — den loeber
// ved siden af og tager over naar `training_tick_per_race_day` er on (se §"To sweeps"
// nedenfor). Flag off ⇒ den returnerer { ran:false, skipped:"flag_off" } uden et
// eneste DB-kald ud over selve flag-opslaget.
//
// DE TO BETINGELSER (ejer 15/9, beslutning 3+4) — BEGGE skal vaere opfyldt:
//   1. Klokken er mindst 20:00 DANSK tid. Maalt aktivitet: kl. 16 = 218 aktive
//      spillerdage/time, 17-20 ≈ 185-199, 21 = 127. Kl. 20 er "dagens oejeblik":
//      sent nok til at dagens loeb er kaldt hjem, tidligt nok til at rapporten
//      bliver laest samme aften.
//   2. Dagens SIDSTE finalization er faerdig. En etape der stadig afvikles eller
//      sidder i en halv afslutning (races.finalize_state != null, #4147) ville
//      ellers give rytteren en TRAENINGSDAG for en loebsdag han faktisk KOERTE —
//      dailyTrainingEngine.js's racedToday-opslag ville simpelthen ikke se resultatet
//      endnu. Vi UDSKYDER derfor i stedet for at gaette.
//
// MAKS-VENTETID OG ALARM. En etape der haenger maa ikke koste hele bestanden en
// loebsdags udvikling: en udeblevet loebsdag kan ikke hentes igen (noeglen er
// (team, season, game_day), og i morgen er det en anden game_day). Efter
// MAX_WAIT_HOUR koerer sweepen derfor ALLIGEVEL og fyrer en alarm med praecis hvilke
// etaper der stadig var aabne. Byttet er bevidst: en haandfuld ryttere faar en
// traeningsdag hvor de skulle have haft en loebsdag (udbyttet er i samme
// stoerrelsesorden — se dailyTraining.js' RACE_DEV_CONFIG.devMult 1.15), mod at
// HELE bestanden ellers mistede dagen.
//
// IDEMPOTENS. Tre lag, i den raekkefoelge:
//   a) overlap-guard (modul-lokal) — samme moenster som stage-scheduleren fik efter
//      #2090. Sweepen tager 130-150 s i dag og ca. 5x det ved 5 loebsdage/dag; et
//      5-min-tick ville ellers starte tick nr. 2 OVENI.
//   b) dags-claim (modul-lokal) — naar dagen er koert faerdig, springer resten af
//      dagens ticks over uden DB-arbejde.
//   c) det PARTIELLE unikke index paa training_day_runs (team_id, season_id,
//      COALESCE(squad,'senior'), game_day) — den ENESTE af de tre der overlever en
//      proces-genstart, og derfor den der faktisk BAERER idempotensen. a) og b) er
//      kapacitet, ikke korrekthed.
//
// AKSE-FAELDEN (CALENDAR_RULES §0). `game_day` LAESES fra race_stage_schedule.game_day.
// Den udledes ALDRIG af scheduled_at — `scheduled_at` bruges KUN til at afgraense
// hvilke raekker der hoerer til DAGENS danske kalenderdoegn.
//
// Refs #4847 #4846 #4850 #4620 #2090 #4147

import { copenhagenHour, copenhagenDateString, copenhagenMidnightUTC } from "./copenhagenTime.js";
import { isDailyTrainingEnabled } from "./dailyTrainingFlag.js";
import { isRaceDayEngineEnabled } from "./raceDayEngineFlag.js";
import { isTrainingTickPerRaceDayEnabled } from "./trainingTickRaceDayFlag.js";
import { runTeamTrainingDay } from "./dailyTrainingEngine.js";
import { resolveCalendarRaceDayTarget } from "./trainingRaceDayTick.js";
import { fetchAllRows } from "./supabasePagination.js";

/** Tidligste danske klokketime sweepen maa koere (ejer 15/9, beslutning 4). */
export const SWEEP_FROM_HOUR = 20;

/**
 * Efter denne danske klokketime venter vi ikke laengere paa en haengende
 * finalization — vi koerer og alarmerer. Tre timers slack fra kl. 20 er rundhaandet
 * i forhold til den maalte stage-scheduler-kadence (5 min) og #4147-vagtens
 * 10-minutters stuck-marker-graense.
 */
export const MAX_WAIT_HOUR = 23;

/** Standard-truppen. #4620 giver senere U23/junior deres egen loebsdags-akse. */
export const DEFAULT_SQUAD = "senior";

/**
 * Hvor mange hold der traenes samtidig. 1 = sekventielt, praecis som
 * trainingSweep.js koerer i dag. G6-harnessen (backend/scripts/dev/
 * trainingDayCloseCapacity.mjs) maaler hvad tallet betyder for varigheden;
 * vaerdien her er den KONSERVATIVE default, ikke et maal.
 */
export const TEAM_CONCURRENCY = 1;

/**
 * Hvor mange loebsdage én kalenderdags sweep hoejst maa daekke pr. division.
 *
 * #4847 (ejer-regel 4, 18/9): en loebsdag UDEN loeb er en ren traeningsdag og skal
 * have sit tick. Den findes ikke i `race_stage_schedule`, saa den kan kun udledes af
 * HULLET mellem gaarsdagens sidste loebsdag og dagens (se `gameDaySpansByDivision`).
 * Med den jaevne pakning (#5267, 140/28) er spaendet normalt praecis datoens egne 5
 * loebsdage. Loftet her er en OPS-sikring, ikke et design-tal: har en division ligget
 * stille laenge (kalender-rebuild, frossen saeson, en sweep der ikke har koert i en
 * uge), maa én aften ikke pludselig skrive tyve loebsdage for hele bestanden.
 * Overskrides loftet, koeres de NYESTE loebsdage og resten rapporteres som
 * `skippedGameDays` — synligt, ikke tavst.
 *
 * Forlaengelsen paa saesonens sidste loebsdato (#4846) er IKKE et efterslaeb og kan
 * aldrig koste aftenens egne loebsdage en plads under loftet: den er alt-eller-intet
 * (se `gameDaySpansByDivision`).
 */
export const MAX_GAME_DAY_CATCH_UP = 8;

/**
 * "Divisionen har BEVISLIGT ingen loebsdag foer i dag" (#4846).
 *
 * Aksen er 0-baseret (CALENDAR_RULES §0b), saa "sidste loebsdag foer i dag var -1"
 * betyder at spaendet aabner paa loebsdag 0. Vaerdien er noget ANDET end `null`:
 * null er "ved det ikke" (query-fejl) og beholder fail-safen (kun dagens egne
 * loebsdage). Kun et VELLYKKET, tomt opslag giver denne vaerdi.
 */
export const NO_PRIOR_GAME_DAY = -1;

// ── Modul-lokal tilstand (lag a + b i idempotens-kaskaden) ───────────────────
let sweepRunning = false;
let lastCompletedDate = null;
// #4848: off-season logges ÉN gang pr. dansk dato (se runTrainingDayCloseSweep).
let lastOffSeasonLogDate = null;

/** Kun til test: nulstil overlap-guard, dags-claim og off-season-loggen. */
export function __resetTrainingDayCloseStateForTests() {
  sweepRunning = false;
  lastCompletedDate = null;
  lastOffSeasonLogDate = null;
}

/** Kun til test/ops: er en sweep i gang lige nu? */
export function isTrainingDayCloseSweepRunning() {
  return sweepRunning;
}

/**
 * PUR: er dansk tid inden for sweep-vinduet?
 * @param {Date} [now]
 * @returns {boolean}
 */
export function shouldSweepNow(now = new Date()) {
  return copenhagenHour(now) >= SWEEP_FROM_HOUR;
}

/**
 * PUR: er maks-ventetiden paa en haengende finalization udloebet?
 * @param {Date} [now]
 * @returns {boolean}
 */
export function waitedLongEnough(now = new Date()) {
  return copenhagenHour(now) >= MAX_WAIT_HOUR;
}

/**
 * PUR: hvilke af dagens etaper er endnu IKKE lukket?
 *
 * En etape regnes lukket naar BEGGE holder:
 *   - loebet har afviklet mindst saa mange etaper som etapens nummer
 *     (races.stages_completed >= stage_number), og
 *   - loebet baerer INGEN halv trin-markering (races.finalize_state == null, #4147).
 *
 * Et loeb der slet ikke findes i `raceById` regnes som AABENT — en manglende raekke
 * er en ukendt tilstand, og den fail-safe der udskyder er den rigtige her (vi
 * risikerer hoejst at vente til MAX_WAIT_HOUR).
 *
 * @param {Array<{race_id: string, stage_number: number, game_day: number}>} stageRows
 * @param {Map<string, {stages_completed?: number, finalize_state?: unknown}>} raceById
 * @returns {Array<{race_id: string, stage_number: number, reason: string}>}
 */
export function pendingStagesFor(stageRows, raceById) {
  const pending = [];
  for (const row of stageRows ?? []) {
    const race = raceById.get(row.race_id);
    if (!race) {
      pending.push({ race_id: row.race_id, stage_number: row.stage_number, reason: "race_missing" });
      continue;
    }
    const completed = Number(race.stages_completed ?? 0);
    if (!Number.isFinite(completed) || completed < Number(row.stage_number)) {
      pending.push({ race_id: row.race_id, stage_number: row.stage_number, reason: "stage_not_run" });
      continue;
    }
    if (race.finalize_state != null) {
      pending.push({ race_id: row.race_id, stage_number: row.stage_number, reason: "finalizing" });
    }
  }
  return pending;
}

/**
 * PUR: divisions-id → dagens loebsdage, stigende.
 *
 * `game_day` LAESES (akse-faelden, CALENDAR_RULES §0). Raekker uden division eller
 * uden et endeligt game_day springes over — de kan ikke placeres paa en akse.
 *
 * @param {Array<{race_id: string, game_day: number}>} stageRows
 * @param {Map<string, string|null>} divisionByRace
 * @returns {Map<string, number[]>}
 */
export function gameDaysByDivision(stageRows, divisionByRace) {
  const byDivision = new Map();
  for (const row of stageRows ?? []) {
    const divisionId = divisionByRace.get(row.race_id) ?? null;
    if (!divisionId) continue;
    const gd = Number(row.game_day);
    if (!Number.isFinite(gd)) continue;
    if (!byDivision.has(divisionId)) byDivision.set(divisionId, new Set());
    byDivision.get(divisionId).add(gd);
  }
  const out = new Map();
  for (const [divisionId, set] of byDivision) {
    out.set(divisionId, [...set].sort((a, b) => a - b));
  }
  return out;
}

/**
 * PUR: divisions-id → divisionens loeb-id'er. Input til det per-divisions opslag
 * af "sidste loebsdag foer i dag". Loeb uden division springes over — de hoerer
 * ikke til en akse (samme semantik som `gameDaysByDivision`).
 *
 * @param {Array<{id: string, league_division_id?: string|null}>} raceRows
 * @returns {Map<string, string[]>}
 */
export function groupRaceIdsByDivision(raceRows) {
  const out = new Map();
  for (const row of raceRows ?? []) {
    const divisionId = row?.league_division_id ?? null;
    if (!divisionId || !row.id) continue;
    if (!out.has(divisionId)) out.set(divisionId, []);
    out.get(divisionId).push(row.id);
  }
  return out;
}

/**
 * PUR: divisions-id → ALLE loebsdage denne kalenderdag lukker, stigende.
 *
 * #4847, EJER-REGEL 4 (18/9): "Alle divisioner faar lige mange loebsdage; loebsdage
 * uden loeb er rene traeningsdage." `gameDaysByDivision` ovenfor ser kun de loebsdage
 * der HAR en etape i dag — en ren traeningsdag har ingen raekke i
 * `race_stage_schedule` og fik derfor intet tick. Det var ejerens tredje fund i denne
 * PR 18/9.
 *
 * LOESNINGEN ER AKSENS MONOTONI, ikke et gaet. `game_day` vokser monotont hen over
 * kalenderdatoerne inden for en division. Er divisionens sidste loebsdag FOER i dag
 * nr. P, og dagens hoejeste loebsdag med loeb nr. E, saa er HELE spaendet P+1..E
 * lukket i aften — og de af dem der ikke havde et loeb, er praecis de rene
 * traeningsdage. Ingen loebsdag udledes af `scheduled_at` (akse-faelden,
 * CALENDAR_RULES §0): baade P og E er LAESTE `race_stage_schedule.game_day`-vaerdier,
 * og `scheduled_at` bruges kun til at vaelge HVILKE raekker der er "foer i dag" og
 * "i dag".
 *
 * TRE KANTER (#4846 — ejerens laaste regel: PRAECIS 140 tickede loebsdage i hver
 * division, lige mange overalt):
 *   · SAESONENS FOERSTE LOEBSDATO. Pakkeren (#5267) lae­gger tomme loebsdage FORAN
 *     datoens foerste loeb, ogsaa paa loebsdag 0. Har divisionen BEVISLIGT ingen
 *     loebsdag foer i dag (prior = NO_PRIOR_GAME_DAY, et vellykket tomt opslag),
 *     starter spaendet derfor paa loebsdag 0. Er prior `null` (opslaget FEJLEDE),
 *     tickes kun dagens egne loebsdage: fail-safen opfinder aldrig en loebsdag paa
 *     et gaet, og i vaerste fald taber vi de tomme dage foran.
 *   · SAESONENS SIDSTE LOEBSDATO. Positionen EFTER aksens sidste loeb arver den sidste
 *     dato, saa de tomme loebsdage dér har ingen senere dato der kan lukke dem. Har
 *     divisionen ingen etaper efter i dag, forlaenges spaendet derfor til aksens sidste
 *     loebsdag (`axisEndByDivision`, = kalenderens eget saesonmaal - 1). Ukendt ⇒ ingen
 *     forlaengelse. Forlaengelsen er ALT-ELLER-INTET: kan hele aftenens spaend inkl.
 *     forlaengelsen ikke vaere under ops-loftet, kan forlaengelsen ikke bevises. Enten
 *     passer aksen ikke til maalet (kalenderen er pakket uden det eller med et andet),
 *     eller aftenen baerer et efterslaeb (en dato uden loeb foran i dag); loftet alene
 *     kan ikke skelne de to. Saa droppes forlaengelsen helt og rapporteres i
 *     `droppedExtensionGameDays`, og aftenen koerer praecis som uden forlaengelse. Paa
 *     sidste loebsdato kan de dage ikke hentes igen, men en loebsdag der maaske ikke
 *     findes tickes aldrig paa et gaet. Forlaengelsen kan dermed aldrig skubbe dagens
 *     egne loebsdage ud i `skippedGameDays` (diff-tjekket af PR #5608: med et arvet maal
 *     paa en kortere akse tikkede loftet 8 loebsdage der ikke fandtes og sprang dagens
 *     egne over).
 *     BEGRAENSNING: en akse der kun er LIDT kortere end maalet (forlaengelsen passer
 *     stadig under loftet) kan ikke skelnes fra en rigtig her — den pakkede akses laengde
 *     gemmes ikke, saa sweepen kender kun maalet. Det lukkes i kalenderen (en gate der
 *     kraever aksen = maalet i alle divisioner), ikke i traenings-lukningen.
 *   · Ingen loeb i divisionen i dag ⇒ INTET spaend. E er ukendt. I en kalender med
 *     eksakt kvote (§1b: hver dato baerer praecis `density` etaper) opstaar kanten
 *     ikke; ellers samles dagene op af naeste dato med loeb.
 *
 * @param {Array<{race_id: string, game_day: number}>} todaysStageRows
 * @param {Map<string, string|null>} divisionByRace
 * @param {Map<string, number|null>} priorMaxGameDayByDivision — hoejeste loebsdag
 *   FOER dagens doegn, pr. division. NO_PRIOR_GAME_DAY ⇒ saesonens foerste loebsdato;
 *   null/ukendt ⇒ fail-safe (kun dagens egne).
 * @param {{maxCatchUp?: number, axisEndByDivision?: Map<string, number|null>|null}} [opts]
 *   `axisEndByDivision` — aksens sidste loebsdag for de divisioner hvor i dag er den
 *   sidste loebsdato. Mangler/null ⇒ spaendet slutter paa dagens hoejeste loebsdag.
 * @returns {Map<string, {gameDays: number[], skippedGameDays: number[], droppedExtensionGameDays: number[]}>}
 */
export function gameDaySpansByDivision(
  todaysStageRows, divisionByRace, priorMaxGameDayByDivision,
  { maxCatchUp = MAX_GAME_DAY_CATCH_UP, axisEndByDivision = null } = {},
) {
  const todaysByDivision = gameDaysByDivision(todaysStageRows, divisionByRace);
  const out = new Map();
  for (const [divisionId, todaysDays] of todaysByDivision) {
    if (!todaysDays.length) continue;
    const todaysLast = todaysDays[todaysDays.length - 1];
    // `Number(null)` er 0, ikke NaN — en division med UKENDT tidligere loebsdag ville
    // derfor blive laest som "sidste loebsdag var 0" og traekke hele spaendet fra
    // loebsdag 1 med. null/undefined skal vaere NaN her.
    const priorRaw = priorMaxGameDayByDivision?.get(divisionId);
    const prior = priorRaw === null || priorRaw === undefined ? NaN : Number(priorRaw);
    // Hullet aabner ved prior+1 (NO_PRIOR_GAME_DAY ⇒ loebsdag 0). `Math.min` mod dagens
    // foerste loebsdag holder spaendet korrekt ogsaa hvis prior af en eller anden grund
    // ligger EFTER dagens egne loebsdage (kalender-rebuild, omlagt schedule): saa falder
    // vi tilbage til dagens egne dage i stedet for at producere et tomt eller bagvendt
    // spaend. `Math.max(0, ...)`: aksen har ingen negative loebsdage.
    const start = Number.isFinite(prior)
      ? Math.max(0, Math.min(prior + 1, todaysDays[0]))
      : todaysDays[0];
    // Aftenens EGET spaend: hullet foran + dagens loebsdage.
    const core = [];
    for (let gd = start; gd <= todaysLast; gd += 1) core.push(gd);

    // Forlaengelsen (saesonens sidste loebsdato). `Number(null)` er 0, ikke NaN — derfor
    // det eksplicitte null-tjek, ogsaa her. Kun FREM: en akse-ende der ligger foer dagens
    // egne loebsdage (kalender laengere end maalet) giver ingen forlaengelse — vi
    // afkorter aldrig dagens loebsdage.
    const axisEndRaw = axisEndByDivision?.get(divisionId);
    const axisEnd = axisEndRaw === null || axisEndRaw === undefined ? NaN : Number(axisEndRaw);
    const extension = [];
    if (Number.isFinite(axisEnd)) {
      for (let gd = todaysLast + 1; gd <= axisEnd; gd += 1) extension.push(gd);
    }
    // ALT-ELLER-INTET (se doc-blokken): forlaengelsen maa aldrig kunne fortraenge
    // aftenens egne loebsdage under loftet. Faar den ikke plads, droppes den synligt —
    // aarsagen (akse != maal eller efterslaeb) kan loftet ikke afgoere.
    const extensionFits = core.length + extension.length <= maxCatchUp;
    const full = extensionFits ? [...core, ...extension] : core;
    const droppedExtensionGameDays = extensionFits ? [] : extension;

    // Ops-loft paa efterslaebet: koer de NYESTE, rapportér resten frem for at skrive
    // dem tavst.
    const skippedGameDays = full.length > maxCatchUp ? full.slice(0, full.length - maxCatchUp) : [];
    const gameDays = full.length > maxCatchUp ? full.slice(full.length - maxCatchUp) : full;
    out.set(divisionId, { gameDays, skippedGameDays, droppedExtensionGameDays });
  }
  return out;
}

/**
 * I/O: hoejeste loebsdag FOER dagens danske kalenderdoegn, pr. division.
 *
 * Een lille query pr. division, hver bounded af `.limit(1)` paa en
 * `order by game_day desc`. `game_day` LAESES; `scheduled_at` bruges kun som filter.
 *
 * ANTAL: `loadDayCloseSpans` sender kun divisioner MED etaper i dag. Det er ikke fire:
 * prod har 15 `league_division_id`'er (maalt 24/9, alle med loeb i den aktive saeson),
 * fordi en tier kan have flere puljer og trupper. Sammen med
 * `loadLastRaceDateByDivision` er det derfor op til 30 SEKVENTIELLE opslag pr. aften
 * (to pr. division) — smaa og bounded, men sekventielle.
 *
 * TRE SVAR, og de maa ikke blandes sammen (#4846):
 *   · et tal ⇒ divisionens sidste loebsdag foer i dag.
 *   · NO_PRIOR_GAME_DAY ⇒ opslaget LYKKEDES og fandt intet: i dag er divisionens
 *     foerste loebsdato, og spaendet starter paa loebsdag 0.
 *   · null ⇒ opslaget FEJLEDE (eller svarede med en ulaeselig raekke). FAIL-SAFE:
 *     kun dagens EGNE loebsdage tickes. Vi mister i vaerste fald de tomme dage foran;
 *     vi opfinder aldrig en loebsdag paa et gaet.
 *
 * @param {{supabase: object, raceIdsByDivision: Map<string, string[]>, dayStart: Date}} args
 * @returns {Promise<Map<string, number|null>>}
 */
export async function loadPriorMaxGameDayByDivision({ supabase, raceIdsByDivision, dayStart }) {
  const out = new Map();
  for (const [divisionId, raceIds] of raceIdsByDivision) {
    if (!raceIds.length) { out.set(divisionId, null); continue; }
    try {
      const { data, error } = await supabase
        .from("race_stage_schedule")
        .select("game_day")
        // pagination-safe: limit(1) paa ÉN divisions loeb i ÉN saeson.
        .in("race_id", raceIds)
        .lt("scheduled_at", dayStart.toISOString())
        .order("game_day", { ascending: false })
        .limit(1);
      // Et svar der ikke er en liste er en ukendt tilstand, ikke "ingen raekker".
      if (error || !Array.isArray(data)) { out.set(divisionId, null); continue; }
      if (!data.length) { out.set(divisionId, NO_PRIOR_GAME_DAY); continue; }
      const raw = data[0]?.game_day;
      const gd = raw === null || raw === undefined ? NaN : Number(raw);
      out.set(divisionId, Number.isFinite(gd) ? gd : null);
    } catch {
      // best-effort: "sidste loebsdag foer i dag" er en BERIGELSE, ikke en
      // regel-gate. Kan den ikke besvares, tickes divisionens EGNE loebsdage som
      // hidtil — vi taber i vaerste fald en ren traeningsdag, og vi opfinder
      // aldrig en loebsdag paa et gaet. En fejl her maa derfor ikke vaelte
      // aftenens sweep for hele bestanden.
      out.set(divisionId, null);
    }
  }
  return out;
}

/**
 * I/O: er i dag divisionens SIDSTE loebsdato? (#4846, kanten ved saesonens slutning)
 *
 * Een lille query pr. division, bounded af `.limit(1)`: findes der en etape planlagt
 * EFTER dagens danske kalenderdoegn? `scheduled_at` bruges kun som filter — ingen
 * loebsdag udledes af det (akse-faelden, CALENDAR_RULES §0).
 *
 * TRE SVAR, samme disciplin som `loadPriorMaxGameDayByDivision`:
 *   · true  ⇒ opslaget LYKKEDES og fandt intet efter i dag: sidste loebsdato.
 *   · false ⇒ der ligger etaper efter i dag.
 *   · null  ⇒ opslaget FEJLEDE. FAIL-SAFE: spaendet forlaenges ikke. Vi taber i
 *     vaerste fald de tomme loebsdage efter saesonens sidste loeb; vi skriver aldrig
 *     en loebsdag paa et gaet.
 *
 * @param {{supabase: object, raceIdsByDivision: Map<string, string[]>, dayEnd: Date}} args
 * @returns {Promise<Map<string, boolean|null>>}
 */
export async function loadLastRaceDateByDivision({ supabase, raceIdsByDivision, dayEnd }) {
  const out = new Map();
  for (const [divisionId, raceIds] of raceIdsByDivision) {
    if (!raceIds.length) { out.set(divisionId, null); continue; }
    try {
      const { data, error } = await supabase
        .from("race_stage_schedule")
        .select("game_day")
        // pagination-safe: limit(1) paa ÉN divisions loeb i ÉN saeson — et
        // eksistens-opslag, ikke en liste.
        .in("race_id", raceIds)
        .gte("scheduled_at", dayEnd.toISOString())
        .limit(1);
      if (error || !Array.isArray(data)) { out.set(divisionId, null); continue; }
      out.set(divisionId, data.length === 0);
    } catch {
      // best-effort: forlaengelsen er en BERIGELSE af aftenens spaend, ikke en
      // regel-gate. Kan den ikke besvares, slutter spaendet paa dagens hoejeste
      // loebsdag som hidtil, og en fejl her maa ikke vaelte sweepen for hele
      // bestanden.
      out.set(divisionId, null);
    }
  }
  return out;
}

/**
 * PUR: aksens sidste loebsdag pr. division — kun for de divisioner hvor i dag BEVISLIGT
 * er den sidste loebsdato (`true` fra `loadLastRaceDateByDivision`).
 *
 * Aksen er 0-baseret (§0b), saa med `raceDaysPerSeason` loebsdage er den sidste
 * loebsdag `raceDaysPerSeason - 1`. Et ukendt eller ugyldigt maal giver en TOM map —
 * ingen forlaengelse, samme fail-safe som et fejlet opslag.
 *
 * Maalet SKAL vaere kalenderens eget (`resolveCalendarRaceDayTarget`): et arvet maal paa
 * en saeson hvis kalender er pakket uden et, peger ud over aksens ende.
 *
 * @param {{lastRaceDateByDivision: Map<string, boolean|null>, raceDaysPerSeason: number|null}} args
 * @returns {Map<string, number>}
 */
export function axisEndByDivisionFor({ lastRaceDateByDivision, raceDaysPerSeason }) {
  const out = new Map();
  const n = raceDaysPerSeason === null || raceDaysPerSeason === undefined ? NaN : Number(raceDaysPerSeason);
  if (!Number.isSafeInteger(n) || n <= 0) return out;
  for (const [divisionId, isLast] of lastRaceDateByDivision ?? []) {
    if (isLast === true) out.set(divisionId, n - 1);
  }
  return out;
}

/**
 * I/O: aftenens fulde spaend pr. division — EEN sandhed for sweepen OG knappen
 * (ejer 15/9, beslutning 3: "samme betingelse som sweepen").
 *
 * Kun divisioner MED etaper i dag kan faa et spaend (`gameDaySpansByDivision`), saa
 * kun deres akse slaas op: hoejst to smaa, bounded queries pr. division.
 *
 * `raceDaysPerSeason` er en DOVEN kilde til maalet: den kaldes kun hvis mindst een
 * division er paa sin sidste loebsdato, saa knappens status-opslag ikke betaler et
 * saeson-opslag de andre 27 aftener. Kaster den eller svarer den ikke et tal,
 * forlaenges intet. Begge kaldere svarer med kalenderens EGET saesonmaal
 * (`resolveCalendarRaceDayTarget`): en saeson uden eget tal forlaenges ikke.
 *
 * @param {object} args
 * @param {object} args.supabase
 * @param {Array<{id: string, league_division_id?: string|null}>} args.raceRows
 * @param {Array<{race_id: string, game_day: number}>} args.todaysStages
 * @param {Date} args.dayStart
 * @param {Date} args.dayEnd
 * @param {() => (number|null|Promise<number|null>)} args.raceDaysPerSeason
 * @returns {Promise<Map<string, {gameDays: number[], skippedGameDays: number[], droppedExtensionGameDays: number[]}>>}
 */
export async function loadDayCloseSpans({
  supabase, raceRows, todaysStages, dayStart, dayEnd, raceDaysPerSeason,
}) {
  const divisionByRace = new Map((raceRows ?? []).map((r) => [r.id, r.league_division_id ?? null]));
  const todaysDivisions = new Set(gameDaysByDivision(todaysStages, divisionByRace).keys());
  const raceIdsByDivision = new Map(
    [...groupRaceIdsByDivision(raceRows)].filter(([divisionId]) => todaysDivisions.has(divisionId)),
  );
  const priorMaxByDivision = await loadPriorMaxGameDayByDivision({ supabase, raceIdsByDivision, dayStart });
  const lastRaceDateByDivision = await loadLastRaceDateByDivision({ supabase, raceIdsByDivision, dayEnd });

  let axisEndByDivision = null;
  if ([...lastRaceDateByDivision.values()].some((isLast) => isLast === true)) {
    let target = null;
    try {
      target = await raceDaysPerSeason?.();
    } catch {
      // best-effort: et maal der ikke kan slaas op betyder "forlaeng ikke" — den
      // samme fail-safe som et fejlet sidste-dato-opslag. Aftenens egne loebsdage
      // koeres stadig; de tomme dage efter sidste loeb er det eneste der kan tabes.
      target = null;
    }
    axisEndByDivision = axisEndByDivisionFor({ lastRaceDateByDivision, raceDaysPerSeason: target });
  }
  return gameDaySpansByDivision(todaysStages, divisionByRace, priorMaxByDivision, { axisEndByDivision });
}

/**
 * PUR: hvad skal koeres, for hvem?
 *
 * Bygger den fulde arbejdsliste FOER foerste write, saa kapaciteten (G6) kan maales
 * paa ét tal i stedet for at vokse undervejs.
 *
 * AI-HOLD UDEN `league_division_id` (4 maalt 6/9 blandt 362 berettigede hold) har
 * ingen loebsdags-akse. DE FAAR ET DEFINERET SVAR, ikke en stille stopper: praecis
 * ÉT tick paa den GAMLE kalenderdags-noegle (gameDay = null), som
 * dailyTrainingEngine.js's fail-safe-kaskade i forvejen falder tilbage til. De
 * udvikler sig altsaa videre i samme takt som i dag — de foelger bare ikke
 * loebsdags-aksen, fordi de ikke HAR en.
 *
 * @param {object} args
 * @param {Array<{id: string, league_division_id?: string|null}>} args.teams
 * @param {Map<string, number[]>} args.gameDaysByDivisionMap
 * @param {Set<string>} args.alreadyRanRaceDayKeys  — `${teamId}#${squad}#${gameDay}`
 * @param {Set<string>} args.alreadyRanLegacyTeamIds
 * @param {string} [args.squad]
 * @returns {Array<{teamId: string, gameDay: number|null, squad: string}>}
 */
export function buildSweepPlan({
  teams, gameDaysByDivisionMap, alreadyRanRaceDayKeys, alreadyRanLegacyTeamIds, squad = DEFAULT_SQUAD,
}) {
  const plan = [];
  for (const team of teams ?? []) {
    const divisionId = team.league_division_id ?? null;
    if (!divisionId) {
      if (!alreadyRanLegacyTeamIds.has(team.id)) {
        plan.push({ teamId: team.id, gameDay: null, squad });
      }
      continue;
    }
    for (const gameDay of gameDaysByDivisionMap.get(divisionId) ?? []) {
      if (alreadyRanRaceDayKeys.has(`${team.id}#${squad}#${gameDay}`)) continue;
      plan.push({ teamId: team.id, gameDay, squad });
    }
  }
  return plan;
}

/**
 * Slaa dagens LUKKE-TILSTAND op — den betingelse BAADE sweepen og den frivillige
 * knap "Koer dagens traening nu" haenger paa (ejer 15/9, beslutning 3: "samme
 * betingelse som sweepen"). Een sandhed, to forbrugere.
 *
 * `divisionId` afgraenser til EEN divisions loebsdage (knappen: holdets egne).
 * Udeladt ⇒ hele bestanden (sweepen).
 *
 * FAIL-SAFE: kaster aldrig. Alt der ikke kan besvares giver closed:false med en
 * `reason` — en ukendt tilstand maa ikke kunne AABNE knappen.
 *
 * `seasonNumber` er valgfri. Udeladt slaas den op (dovent, kun paa saesonens sidste
 * loebsdato — se `loadDayCloseSpans`), saa knappen forlaenger spaendet med SAMME maal
 * som sweepen. Fejler opslaget, forlaenges intet: knappen koerer da faerre dage end
 * sweepen ville, og aftenens sweep samler resten op (alreadyRan-noeglerne springer de
 * allerede koerte over). Faerre er den sikre side; flere ville vaere et gaet.
 *
 * @param {{supabase: object, seasonId: string, now?: Date, divisionId?: string|null, seasonNumber?: number|null}} args
 * @returns {Promise<{closed: boolean, reason: string, gameDays: number[], pending: number}>}
 */
export async function resolveDayCloseStatus({
  supabase, seasonId, now = new Date(), divisionId = null, seasonNumber = undefined,
}) {
  const empty = { closed: false, reason: "unknown", gameDays: [], pending: 0 };
  if (!supabase?.from || !seasonId) return { ...empty, reason: "bad_args" };
  try {
    let racesQuery = supabase
      .from("races")
      // schema-columns-ok: finalize_state tilfoejes af database/2026-08-23-4147-*.sql
      .select("id, league_division_id, stages_completed, finalize_state")
      .eq("season_id", seasonId);
    if (divisionId) racesQuery = racesQuery.eq("league_division_id", divisionId);
    const { data: races, error: racesError } = await racesQuery;
    if (racesError) return { ...empty, reason: "races_error" };
    const raceRows = races ?? [];
    if (!raceRows.length) return { closed: true, reason: "no_races", gameDays: [], pending: 0 };

    const raceById = new Map(raceRows.map((r) => [r.id, r]));

    const dayStart = copenhagenMidnightUTC(now);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    // pagination-safe: afgraenset til ÉT dansk kalenderdoegn, og naar `divisionId`
    // er sat endda til ÉN division. D1 koerer 5 slots/dag, saa raekkerne er i
    // titals-, ikke tusindtals-omraadet (PostgREST's loft er 1000).
    const { data: stageRows, error: stageError } = await supabase
      .from("race_stage_schedule")
      .select("race_id, stage_number, game_day, scheduled_at")
      .in("race_id", [...raceById.keys()])
      .gte("scheduled_at", dayStart.toISOString())
      .lt("scheduled_at", dayEnd.toISOString());
    if (stageError) return { ...empty, reason: "stages_error" };

    const todaysStages = stageRows ?? [];
    const pending = pendingStagesFor(todaysStages, raceById);
    // #4847 (ejer-regel 4): knappen skal vise SAMME loebsdage som sweepen vil koere,
    // inklusive de rene traeningsdage i hullet — ellers ville fladen love faerre dage
    // end den faktisk kunne koere. Een sandhed, to forbrugere (ejer 15/9, beslutning 3).
    // #4846: samme loader som sweepen, altsaa ogsaa de to kanter (loebsdag 0 og
    // dagene efter saesonens sidste loeb).
    const spansByDivision = await loadDayCloseSpans({
      supabase, raceRows, todaysStages, dayStart, dayEnd,
      raceDaysPerSeason: async () => {
        if (seasonNumber !== undefined && seasonNumber !== null) {
          return resolveCalendarRaceDayTarget({ seasonNumber });
        }
        const { data: season, error: seasonError } = await supabase
          .from("seasons")
          .select("number")
          .eq("id", seasonId)
          .maybeSingle();
        // `Number(null)` er 0 — en raekke uden nummer maa ikke blive "saeson 0".
        const raw = seasonError ? null : season?.number;
        const n = raw === null || raw === undefined ? NaN : Number(raw);
        // Ukendt saesonnummer, eller en saeson uden eget maal i kalenderen ⇒ ingen
        // forlaengelse (se doc-blokken).
        return Number.isFinite(n) ? resolveCalendarRaceDayTarget({ seasonNumber: n }) : null;
      },
    });
    const gameDays = [...new Set(
      [...spansByDivision.values()].flatMap((s) => s.gameDays),
    )].sort((a, b) => a - b);

    if (pending.length > 0) {
      return { closed: false, reason: "awaiting_finalization", gameDays, pending: pending.length };
    }
    return { closed: true, reason: "closed", gameDays, pending: 0 };
  } catch {
    // best-effort: en netvaerks-/synkron fejl maa ALDRIG kunne AABNE knappen eller
    // sweepen. En ukendt tilstand svarer "ikke lukket"; naeste cron-tick (5 min)
    // spoerger igen. Fejlen er derfor selv-helbredende og ikke Sentry-vaerdig.
    return { ...empty, reason: "exception" };
  }
}

/**
 * PUR: hvilke loebsdage gaelder for ÉT hold?
 *
 * `resolveDayCloseStatus` kaldes med `divisionId: team.league_division_id ?? null`,
 * og et NULL divisionId betyder dér "hele bestanden" — ikke "ingen loebsdage". Et
 * hold UDEN division ville derfor faa ALLE divisioners loebsdage tilbage.
 *
 * Det korrekte svar for et division-loest hold er det SAMME som sweepen giver
 * (`buildSweepPlan`): praecis ÉT tick paa den gamle kalenderdags-noegle, altsaa
 * `[null]`. Denne helper er den ene sandhed for de tre forbrugere — knappens
 * POST /api/training/run-today og de to GET-svar der viser knappens tilstand — saa
 * fladen ikke kan love andre loebsdage end POST'en faktisk koerer.
 *
 * @param {{teamDivisionId: string|null|undefined, gameDays: number[]|null|undefined}} args
 * @returns {Array<number|null>}
 */
export function teamGameDaysFromDayClose({ teamDivisionId, gameDays }) {
  if (!teamDivisionId) return [null];
  return gameDays ?? [];
}

/**
 * Koer den samlede daglige sweep.
 *
 * @param {object} args
 * @param {object} args.supabase      — service-role client
 * @param {Date}   [args.now]
 * @param {Function} [args.runDay]    — DI-hook; default runTeamTrainingDay
 * @param {Function} [args.onAlarm]   — kaldes med (Error, context) ved maks-ventetid
 * @param {object} [args.logger]
 * @returns {Promise<object>}
 */
export async function runTrainingDayCloseSweep({
  supabase,
  now = new Date(),
  runDay = runTeamTrainingDay,
  onAlarm = null,
  logger = console,
} = {}) {
  // ── a) Overlap-guard (#2090-moenstret, G6-krav) ─────────────────────────────
  // Kode-invariant: to sweeps kan ALDRIG vaere i luften samtidig i samme proces.
  if (sweepRunning) {
    return { ran: false, skipped: "overlap" };
  }

  const tickDate = copenhagenDateString(now);

  // ── b) Dags-claim ───────────────────────────────────────────────────────────
  if (lastCompletedDate === tickDate) {
    return { ran: false, skipped: "already_done_today", tickDate };
  }

  // ── Flag ────────────────────────────────────────────────────────────────────
  // `engineWrite` fordi en cron ingen viewer har (featureStage.js' skrive-gate).
  const raceDayTickOn = await isTrainingTickPerRaceDayEnabled(supabase, { engineWrite: true });
  if (!raceDayTickOn) return { ran: false, skipped: "flag_off" };

  const trainingOn = await isDailyTrainingEnabled(supabase);
  if (!trainingOn) return { ran: false, skipped: "daily_training_off" };

  // ── Betingelse 1: dansk tid >= kl. 20 ───────────────────────────────────────
  if (!shouldSweepNow(now)) return { ran: false, skipped: "before_window", tickDate };

  sweepRunning = true;
  const startedAt = Date.now();
  try {
    // ── Aktiv saeson ──────────────────────────────────────────────────────────
    const { data: season, error: seasonError } = await supabase
      .from("seasons")
      .select("id, number")
      .eq("status", "active")
      .maybeSingle();
    if (seasonError) throw new Error(`seasons: ${seasonError.message}`);
    // ── Off-season (#4848): defineret, logget skip — ikke en stille no-op ─────
    // Mellem to sæsoner findes ingen løbsdags-akse at ticke paa. En off-season-dato
    // er IKKE en traeningsdag: intet tick (heller ikke tickets restitution), ingen historik, og
    // INGEN loebsdag springes over — aksen starter forfra i den nye saeson, og
    // `gameDaySpansByDivision` opfinder aldrig traeningsdage foer saesonens foerste
    // loebsdato. Samme regel som trainingSweep.js; én linje pr. dansk dato (cron er
    // 5-min), ASCII-only fordi det er ops-log. Dags-claimen saettes IKKE: en saeson
    // der aktiveres senere samme aften skal kunne naa at koere.
    if (!season) {
      if (lastOffSeasonLogDate !== tickDate) {
        lastOffSeasonLogDate = tickDate;
        logger.warn?.(
          `  ⏸️ Traenings-lukning ${tickDate}: ingen aktiv saeson (off-season) - ingen loebsdage at ticke, intet traenings-tick i dag (heller ikke tickets restitution)`,
        );
      }
      return { ran: false, skipped: "no_active_season", offSeason: true, tickDate };
    }

    // ── Dagens loeb + etaper ──────────────────────────────────────────────────
    // schema-columns-ok: finalize_state tilfoejes af database/2026-08-23-4147-*.sql
    const { data: races, error: racesError } = await supabase
      .from("races")
      .select("id, league_division_id, stages_completed, finalize_state")
      .eq("season_id", season.id);
    if (racesError) throw new Error(`races: ${racesError.message}`);
    const raceRows = races ?? [];
    if (!raceRows.length) return { ran: false, skipped: "no_races", tickDate };

    const raceById = new Map(raceRows.map((r) => [r.id, r]));

    const dayStart = copenhagenMidnightUTC(now);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    // pagination-safe: afgraenset til ÉT dansk kalenderdoegn paa tvaers af fire
    // divisioner — D1 koerer 5 slots/dag, saa raekkerne er i titals-, ikke
    // tusindtals-omraadet (PostgREST's loft er 1000).
    const { data: stageRows, error: stageError } = await supabase
      .from("race_stage_schedule")
      .select("race_id, stage_number, game_day, scheduled_at")
      .in("race_id", [...raceById.keys()])
      .gte("scheduled_at", dayStart.toISOString())
      .lt("scheduled_at", dayEnd.toISOString());
    if (stageError) throw new Error(`race_stage_schedule: ${stageError.message}`);
    const todaysStages = stageRows ?? [];

    // ── #4847, ejer-regel 4 (18/9): rene traeningsdage tickes ogsaa ───────────
    // Ikke kun de loebsdage der HAR en etape i dag, men hele det spaend aftenen
    // lukker: fra divisionens sidste loebsdag foer i dag til dagens hoejeste. De
    // loebsdage i spaendet der ingen etape har, ER de rene traeningsdage.
    // #4846: ogsaa de to kanter — saesonens foerste loebsdato starter paa loebsdag 0,
    // og den sidste forlaenges til aksens sidste loebsdag (kalenderens eget saesonmaal
    // - 1), saa hver division ender paa PRAECIS maalet (140) tickede loebsdage. En
    // saeson uden eget maal i kalenderen forlaenges ikke (resolveCalendarRaceDayTarget).
    const spansByDivision = await loadDayCloseSpans({
      supabase, raceRows, todaysStages, dayStart, dayEnd,
      raceDaysPerSeason: () => resolveCalendarRaceDayTarget({ seasonNumber: season.number }),
    });
    const byDivision = new Map(
      [...spansByDivision].map(([divisionId, span]) => [divisionId, span.gameDays]),
    );
    const todaysGameDays = [...new Set([...byDivision.values()].flat())].sort((a, b) => a - b);
    const skippedGameDays = [...spansByDivision]
      .filter(([, span]) => span.skippedGameDays.length)
      .map(([divisionId, span]) => ({ divisionId, gameDays: span.skippedGameDays }));
    if (skippedGameDays.length) {
      // Synligt, ikke tavst (se MAX_GAME_DAY_CATCH_UP). ASCII-only: ops-log.
      logger.warn?.(
        `  ⚠️ Traenings-lukning: ${skippedGameDays.length} division(er) havde flere end ${MAX_GAME_DAY_CATCH_UP} uafviklede loebsdage - de aeldste springes over`,
      );
    }
    const droppedExtensionGameDays = [...spansByDivision]
      .filter(([, span]) => span.droppedExtensionGameDays?.length)
      .map(([divisionId, span]) => ({ divisionId, gameDays: span.droppedExtensionGameDays }));
    if (droppedExtensionGameDays.length) {
      // Synligt, ikke tavst. Aarsagen er enten en akse der ikke passer til
      // saesonmaalet eller et efterslaeb foran i dag (se gameDaySpansByDivision) —
      // loglinjen paastaar ingen af dem. ASCII-only: ops-log.
      logger.warn?.(
        `  ⚠️ Traenings-lukning: ${droppedExtensionGameDays.length} division(er) paa sidste loebsdato - forlaengelsen til saesonmaalet fik ikke plads under loftet (${MAX_GAME_DAY_CATCH_UP}) og er IKKE koert (akse != maal eller efterslaeb)`,
      );
    }

    // ── Betingelse 2: er dagens sidste finalization faerdig? ──────────────────
    const pending = pendingStagesFor(todaysStages, raceById);
    let ranDespitePending = false;
    if (pending.length > 0) {
      if (!waitedLongEnough(now)) {
        return {
          ran: false, skipped: "awaiting_finalization", tickDate,
          pending: pending.length, pendingStages: pending,
        };
      }
      // Maks-ventetid udloebet: koer alligevel + alarmér (se hoved-docblokken).
      ranDespitePending = true;
      const err = new Error(
        `training day-close sweep ran with ${pending.length} stage(s) still open after ${MAX_WAIT_HOUR}:00 Europe/Copenhagen`,
      );
      logger.error?.(`  ⚠️ Traenings-lukning: ${pending.length} etape(r) stadig aabne efter kl. ${MAX_WAIT_HOUR} — koerer alligevel (alarm sendt)`);
      try {
        await onAlarm?.(err, { tickDate, pending });
      } catch {
        // best-effort: en fejlende alarm (Sentry nede, DNS-fejl) maa ALDRIG vaelte
        // sweepen — dagens traening er vigtigere end notifikationen om at den er sen.
      }
    }

    // ── Hold ──────────────────────────────────────────────────────────────────
    // Samme hold-diskriminator som trainingSweep.js (kanonik for "rigtige hold").
    // #3459 D4: race_day_engine_enabled fjerner is_ai-filteret.
    const raceDayEngineOn = await isRaceDayEngineEnabled(supabase);
    let teamsQuery = supabase
      .from("teams")
      .select("id, league_division_id")
      .eq("is_bank", false)
      .eq("is_frozen", false)
      .eq("is_test_account", false);
    if (!raceDayEngineOn) teamsQuery = teamsQuery.eq("is_ai", false);
    const { data: teams, error: teamsError } = await teamsQuery;
    if (teamsError) throw new Error(`teams: ${teamsError.message}`);
    if (!teams) throw new Error("teams query returned null (unexpected)");

    // ── Allerede koerte ticks ─────────────────────────────────────────────────
    // To akser, to opslag: loebsdags-noeglen for hold MED division, den gamle
    // kalenderdags-noegle for de division-loese AI-hold.
    const [raceDayRunsRes, legacyRunsRes] = await Promise.all([
      todaysGameDays.length
        // PAGINERET (#3331-klassen): dette er det ENESTE bestands-brede opslag i
        // sweepen. 362 hold x 2-5 loebsdage er 724-1.810 raekker, og PostgREST's
        // 1.000-raekkers-cap ville TAVST kappe resten — hvorefter buildSweepPlan
        // ville planlaegge ticks der allerede er koert. Mutexen fanger dem (23505
        // ⇒ alreadyRan foer noget rytter-arbejde), saa skaden er spildte
        // reservations-kald, ikke dobbelt-traening — men op til 790 spildte kald
        // pr. sweep er ikke noget vi skal leve med. Regel 4 goer det kun vaerre:
        // spaendet kan nu indeholde flere loebsdage end dagens etaper alene.
        // `.order("team_id")` + `.order("game_day")`: fetchAllRows kraever en
        // stabil, unik sortering, ellers kan raekker falde mellem to sider.
        //
        // schema-columns-ok: `game_day`/`season_id` tilfoejes af database/
        // 2026-09-14-4846-training-tick-game-day.sql og `squad` af database/
        // 2026-09-15-4847-training-day-close-trigger.sql i denne PR. Snapshottet er
        // fra 10/9 og kender dem derfor ikke endnu (refresh kraever prod-adgang og
        // koeres post-merge af ejer/orkestrator).
        ? fetchAllRows(() => supabase
          .from("training_day_runs")
          .select("team_id, game_day, squad")
          .eq("season_id", season.id)
          .in("game_day", todaysGameDays)
          .order("team_id", { ascending: true })
          .order("game_day", { ascending: true }))
          .then((data) => ({ data, error: null }), (error) => ({ data: null, error }))
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("training_day_runs")
        .select("team_id")
        .eq("tick_date", tickDate)
        .is("game_day", null),
    ]);
    if (raceDayRunsRes.error) throw new Error(`training_day_runs (race day): ${raceDayRunsRes.error.message}`);
    if (legacyRunsRes.error) throw new Error(`training_day_runs (legacy): ${legacyRunsRes.error.message}`);

    const alreadyRanRaceDayKeys = new Set(
      (raceDayRunsRes.data ?? []).map((r) => `${r.team_id}#${r.squad ?? DEFAULT_SQUAD}#${r.game_day}`),
    );
    const alreadyRanLegacyTeamIds = new Set((legacyRunsRes.data ?? []).map((r) => r.team_id));

    const plan = buildSweepPlan({
      teams,
      gameDaysByDivisionMap: byDivision,
      alreadyRanRaceDayKeys,
      alreadyRanLegacyTeamIds,
    });

    // ── Eksekvering ───────────────────────────────────────────────────────────
    // Sekventielt pr. default (TEAM_CONCURRENCY = 1), praecis som trainingSweep.js:
    // én fejl maa aldrig stoppe resten, og skrivetrykket skal vaere forudsigeligt.
    let swept = 0;
    let alreadyRan = 0;
    let failed = 0;
    const failures = [];

    for (let i = 0; i < plan.length; i += TEAM_CONCURRENCY) {
      const slice = plan.slice(i, i + TEAM_CONCURRENCY);
      await Promise.all(slice.map(async (item) => {
        try {
          const result = await runDay({
            supabase,
            teamId: item.teamId,
            seasonId: season.id,
            seasonNumber: season.number,
            executedBy: "assistant",
            now,
            gameDay: item.gameDay,
            squad: item.squad,
          });
          if (result?.alreadyRan) alreadyRan += 1;
          else swept += 1;
        } catch (err) {
          // best-effort PR. HOLD: ét holds fejl maa aldrig stoppe de oevrige 361
          // (samme per-team-isolation som trainingSweep.js). Fejlen sluges IKKE —
          // den taelles i `failed` og returneres i `failures`, og cron.js laver ÉN
          // aggregeret sentryCapture pr. tick af dem (#2389 A2-moenstret). En
          // capture pr. hold ville give 362 Sentry-issues af én systemisk aarsag.
          failed += 1;
          failures.push({ teamId: item.teamId, gameDay: item.gameDay, message: err.message });
          logger.error?.(`  ❌ Traenings-lukning fejlede for hold ${item.teamId} (loebsdag ${item.gameDay}):`, err.message);
        }
      }));
    }

    // Dags-claimen saettes KUN naar HELE planen gik igennem uden fejl.
    //
    // Hvorfor ikke ubetinget: en Phase 1-fejl i motoren SLETTER reservationen igen
    // (dailyTrainingEngine.js's catch), saa netop det (hold, loebsdag) ville staa
    // paa planen igen ved naeste tick — men en claim ville forhindre naeste tick i
    // overhovedet at kigge. Den gamle trainingSweep.js er ingen bagstopper: den
    // filtrerer paa (team_id, tick_date), saa en ANDEN vellykket loebsdag samme dato
    // faar den til at springe holdet over. Uden guarden her ville en forbigaaende
    // netvaerksfejl altsaa koste netop det hold netop den loebsdag, permanent.
    //
    // BEGRAENSNING (bevidst): en Phase 2-fejl BEVARER reservationen med vilje (en
    // blokeret dag er sikrere end et dobbelt-tick efter delvise evne-writes), og
    // buildSweepPlan laeser enhver eksisterende raekke som "koert". Retry-forsoeget
    // her hjaelper derfor kun Phase 1-fejl. AEgte pending/completed-semantik paa
    // training_day_runs er et selvstaendigt stykke arbejde — se PR-body.
    if (failed === 0) {
      lastCompletedDate = tickDate;
    }

    return {
      ran: true,
      tickDate,
      seasonId: season.id,
      gameDays: todaysGameDays,
      skippedGameDays,
      droppedExtensionGameDays,
      divisions: byDivision.size,
      planned: plan.length,
      swept,
      alreadyRan,
      failed,
      failures,
      ranDespitePending,
      pending: pending.length,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    sweepRunning = false;
  }
}
