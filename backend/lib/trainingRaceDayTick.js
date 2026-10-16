// Loebsdags-tick (#4846, fase B2) — konstanter, seed-noegler og loebsdags-opslag.
// Ren matematik + ét tyndt I/O-opslag; ingen forretningslogik fra motoren flyttes hertil.
//
// Spec: docs/superpowers/specs/2026-09-06-traening-pr-loebsdag-og-traeningsscore-design.md
// §3.1 (tick-noeglen), §3.2 (determinisme), §7 G1/G2.

import { SEASON_RACE_DAY_TARGET } from "./calendarRaceDayTargets.js";

// ── Rate-rekalibrering (gate G1) ─────────────────────────────────────────────
//
// Naar tick-enheden skifter fra kalenderdag til loebsdag, aendrer ANTALLET af ticks
// pr. saeson sig. Sæsonens samlede evne-udvikling afhaenger af forholdet mellem antal
// ticks og budget-deleren, saa G1 ("sæsonens samlede evne-udvikling pr. rytter
// uaendret") er praecis kravet: hold det forhold konstant. Deleren nedenfor er derfor
// kalibreret, ikke valgt frit.
//
// Rekalibreringen BEVARER nutiden i stedet for at genoprette den oprindelige
// design-intention; at lukke det gab er en selvstaendig balance-beslutning ejeren
// ejer, ikke en foelgevirkning af en noegle-omlaegning.
//
// Rule 17 (AGENTS.md §17): formler, eksponenter og maalte drift-tal hoerer ikke
// hjemme i det offentlige repo — de er delt med ejeren i chat.
//
// #6711 (#5833 plan-PR 2, ejer-go 16/10): deleren er FORANKRET i loebsdage pr. DATO,
// ikke i saesonens samlede antal loebsdage. Foer #6711 laeste deleren saesonens maal
// (SEASON_RACE_DAY_TARGET), saa en laengere saeson tyndede hver loebsdag ud og en
// kortere gav mere pr. dag.
// Kalenderen pakker altid 5 loebsdage paa hver kalenderdato (CALENDAR_RULES §1e-b), saa
// et fast udbytte pr. loebsdag er et fast udbytte pr. VIRKELIG dato. En laengere saeson
// giver derfor mere samlet udvikling, fordi den har flere datoer - ikke mindre pr. dato.
const RACE_DAYS_PER_DATE = 5;
const LEGACY_DAYS_PER_SEASON = 28;

export const TRAINING_RACE_DAY_CONFIG = Object.freeze({
  // #6711: ankeret. Kalenderens loebsdage pr. kalenderdato (D1's 5 slots, §1e-b).
  raceDaysPerDate: RACE_DAYS_PER_DATE,
  // Reference-saesonen deleren er kalibreret mod (G1): 28 loebsdatoer x 5 = S4's 140.
  // UDLEDT af ankeret, ikke et frit tal, og IKKE laest fra SEASON_RACE_DAY_TARGET
  // laengere (#6711): saesonens eget maal styrer kun aksens laengde, aldrig udbyttet.
  raceDaysPerSeason: RACE_DAYS_PER_DATE * LEGACY_DAYS_PER_SEASON,
  // Maalt antal kalenderdags-ticks pr. sæson i dag (S3), spec §3.2.
  calendarTicksPerSeasonToday: 31,
  // DAILY_TRAINING_CONFIG.daysPerSeason — gentaget her som reference for deleren.
  // Bevidst ikke importeret: dailyTraining.js skal kunne koere uden denne fil.
  legacyDaysPerSeason: LEGACY_DAYS_PER_SEASON,
  // #4801: loftet paa hele point pr. evne pr. tick. Med loebsdagen som tick-enhed
  // betyder "+1 pr. evne pr. dag" +1 pr. LOEBSDAG. Roret (hardDailyCap) har altid
  // vaeret der; reglen er ny (spec §3.1).
  abilityGainCapPerRaceDay: 1,
});

/**
 * Budget-deleren der holder udbyttet pr. loebsdag fast (G1, forankret i #6711).
 * D = (raceDaysPerDate × legacyDaysPerSeason) × legacyDaysPerSeason / calendarTicksPerSeasonToday.
 *
 * Reference-saesonen (raceDaysPerDate × legacyDaysPerSeason) er S4's antal loebsdage, saa
 * S4 faar PRAECIS den deler den havde foer #6711 (alle led er hele tal, saa produktet er
 * eksakt og float-resultatet bit-identisk). Deleren afhaenger ikke af saesonens laengde.
 * @returns {number}
 */
export function raceDayBudgetDivisor(cfg = TRAINING_RACE_DAY_CONFIG) {
  const referenceRaceDays = cfg.raceDaysPerDate * cfg.legacyDaysPerSeason;
  return (referenceRaceDays * cfg.legacyDaysPerSeason) / cfg.calendarTicksPerSeasonToday;
}

// ── Saesonens maal styrer aksen, ikke udbyttet (#6711) ────────────────────────
//
// Foer #6711 laeste deleren SEASON_RACE_DAY_TARGET (#4847 punkt 5) for at undgaa to
// kopier af "140". Det koblede udbyttet pr. loebsdag til saesonens laengde, saa S5's 160
// tyndede hver dag ud. Ankeret er nu kalenderens loebsdage pr. DATO, som er den regel
// pakkeren selv bruger til at regne et saesonmaal ud (datoer x 5, se
// calendarRaceDayTargets.js). Maalet laeses stadig fra kalenderen, men kun til aksens
// laengde: `resolveCalendarRaceDayTarget` nedenfor.

/**
 * Loebsdags-AKSENS laengde for en saeson, laest med PRAECIS kalenderens regel (#4846).
 *
 * Kalenderen pakker efter `SEASON_RACE_DAY_TARGET[saesonnummer] ?? null`, baade i
 * auto-stien (seasonTransition.js) og i CLI-stien (buildSeasonCalendar.js). En saeson
 * UDEN eget tal faar altsaa INTET maal, og aksen er pakkerens naturlige laengde. Det er
 * det tal traenings-lukningen skal forlaenge saesonens sidste loebsdato til — aldrig et
 * arvet maal, som ville ticke loebsdage kalenderen aldrig har pakket (diff-tjekket af
 * PR #5608, 24/9).
 *
 * @param {{seasonNumber?: number|null, table?: object}} [args]
 *   `table` er kun et test-hook; default er kalenderens SEASON_RACE_DAY_TARGET.
 * @returns {number|null} saesonens eget, positive maal — ellers null (ingen forlaengelse)
 */
export function resolveCalendarRaceDayTarget({ seasonNumber = null, table = SEASON_RACE_DAY_TARGET } = {}) {
  // `Number(null)` er 0 — en manglende saeson maa ikke blive "saeson 0".
  if (seasonNumber === null || seasonNumber === undefined) return null;
  if (!table || typeof table !== "object") return null;
  const n = Number(seasonNumber);
  if (!Number.isSafeInteger(n)) return null;
  const raw = table[n];
  const target = raw === null || raw === undefined ? NaN : Number(raw);
  return Number.isSafeInteger(target) && target > 0 ? target : null;
}

/**
 * Budget-deleren for en KONKRET saeson. Siden #6711 er den ens for alle saesoner
 * (forankret i loebsdage pr. dato), saa `seasonNumber` paavirker den ikke. Parameteren
 * beholdes, fordi kald-stederne (dailyTrainingEngine.js, trainingSlotHealthWatch.js og
 * dev-scripts) sender den, og fordi "deleren for saeson N" stadig er det rigtige
 * spoergsmaal at stille: svaret er bare det samme for alle N.
 *
 * @param {{seasonNumber?: number|null, cfg?: object}} [args]
 * @returns {number}
 */
export function resolveRaceDayBudgetDivisor({ cfg = TRAINING_RACE_DAY_CONFIG } = {}) {
  return raceDayBudgetDivisor(cfg);
}

/**
 * Seed-noegle for stoej og skade-rul paa en loebsdag (arkitekt-beslutning A3).
 * I dag er seeds noeglet paa kalenderdatoen (`dtick:${riderId}:${dateStr}`), saa tre
 * loebsdage samme kalenderdag ville give tre IDENTISKE udfald. Noeglen skal derfor
 * baere sæson + loebsdag, ikke datoen.
 *
 * @param {{seasonId: string, gameDay: number}} args
 * @returns {string} fx "season-abc#gd42"
 */
export function raceDaySeedKey({ seasonId, gameDay }) {
  return `${seasonId}#gd${gameDay}`;
}

/**
 * Slaa holdets AKTUELLE loebsdag op.
 *
 * AKSE-FAELDEN (CALENDAR_RULES §0, kostede #4155 og #4161): `game_day` maa ALDRIG
 * UDLEDES af `scheduled_at`. Det goer denne funktion heller ikke — den LAESER den
 * lagrede `race_stage_schedule.game_day` og bruger kun `scheduled_at` til at vaelge
 * HVILKEN lagret raekke der er den seneste der er gaaet i gang. Vaerdien kommer altid
 * fra kalenderen.
 *
 * `game_day` er saeson- OG divisions-relativ, saa opslaget er altid scoped til
 * holdets egen division (raceBinding.js' pulje-semantik).
 *
 * FAIL-SAFE, aldrig throw: alt der ikke kan besvares giver { gameDay: null, reason }.
 * Kald-stedet falder saa tilbage til den gamle kalenderdags-noegle i stedet for at
 * stoppe holdets udvikling stille (spec §3.2: de 4 AI-hold uden league_division_id
 * "skal have et defineret svar").
 *
 * BEGRAENSNING (fase B2). En loebsdag UDEN loeb (B1's rene traeningsdage) har ingen
 * raekke i race_stage_schedule og kan derfor ikke findes her. Udloeseren "loebsdagen
 * lukker" — den der ogsaa daekker tomme loebsdage — er fase B4. Indtil da svarer
 * opslaget "seneste loebsdag der er gaaet i gang", hvilket er praecis nok til at
 * mutexen kan forhindre dobbelt-tick paa samme loebsdag.
 *
 * @param {{supabase: object, teamId: string, seasonId: string, now?: Date}} args
 * @returns {Promise<{gameDay: number|null, reason: string}>}
 */
export async function resolveTeamRaceDay({ supabase, teamId, seasonId, now = new Date() }) {
  if (!supabase?.from || !teamId || !seasonId) return { gameDay: null, reason: "bad_args" };
  try {
    const { data: team, error: teamError } = await supabase
      .from("teams")
      .select("league_division_id")
      .eq("id", teamId)
      .maybeSingle();
    if (teamError) return { gameDay: null, reason: "team_error" };
    const divisionId = team?.league_division_id ?? null;
    // Spec §3.2: 4 AI-hold har ingen division. De har ingen loebsdags-akse, saa de
    // bliver paa kalenderdagen — et defineret svar, ikke en stille stopper.
    if (!divisionId) return { gameDay: null, reason: "no_division" };

    const { data: races, error: racesError } = await supabase
      .from("races")
      .select("id")
      .eq("season_id", seasonId)
      .eq("league_division_id", divisionId);
    if (racesError) return { gameDay: null, reason: "races_error" };
    const raceIds = (races ?? []).map((r) => r.id).filter(Boolean);
    if (!raceIds.length) return { gameDay: null, reason: "no_races" };

    const { data: stages, error: stagesError } = await supabase
      .from("race_stage_schedule")
      .select("game_day")
      // pagination-safe: raceIds er ÉN divisions loeb i ÉN saeson (32-37 i S4-dry-runnet,
      // langt under PostgREST's 1000-raekkers-loft), og limit(1) bounder svaret.
      .in("race_id", raceIds)
      .lte("scheduled_at", now.toISOString())
      .order("game_day", { ascending: false })
      .limit(1);
    if (stagesError) return { gameDay: null, reason: "stages_error" };

    const gameDay = stages?.[0]?.game_day;
    if (gameDay === null || gameDay === undefined || !Number.isFinite(Number(gameDay))) {
      return { gameDay: null, reason: "no_started_stage" };
    }
    return { gameDay: Number(gameDay), reason: "ok" };
  } catch {
    // Best-effort: en netvaerks-/synkron fejl maa aldrig vaelte holdets traeningsdag.
    return { gameDay: null, reason: "exception" };
  }
}

/**
 * Hvilke af holdets ryttere er BUNDET paa denne loebsdag? (#4847, ejer-regel 2+3, 18/9)
 *
 * EJERENS REGEL (18/9, #5267-kommentaren, laast som princip):
 *   2. Paa en loebsdag koerer rytteren ét loeb ELLER traener. Aldrig begge.
 *   3. Et etapeloeb binder rytteren fra foerste til sidste etape — ogsaa paa
 *      hviledagene imellem. "Hviledag i et etapeloeb = hvile, ikke traening."
 *
 * KILDEN ER `race_entry_days`, IKKE dagens etaperesultater. Det er hele pointen:
 * `race_results` fortaeller hvem der KOERTE en etape i dag, og dermed intet om en
 * GT-hviledag, hvor rytteren er bundet uden at koere. `race_entry_days` baerer siden
 * #4217 HELE spaendet min(game_day)..max(game_day) pr. udtagelse (bevist mod en aegte
 * Postgres-motor i testdb/raceEntryDaysGtRestDay.integration.test.js: 19 dag-raekker
 * for et 17-etapers loeb med 2 hviledage), og #4191's rebuild-porte holder afmeldte
 * loeb (race_withdrawals) UDE af mængden. Det er praecis regel 3's mængde.
 *
 * INGEN FLAG-AFHAENGIGHED (regel 2's fix). Den gamle detektion hang paa
 * `race_day_development_enabled`; med kun `training_tick_per_race_day` taendt var
 * mængden derfor altid tom, og en rytter der koerte loeb fik traening ovenpaa. Dette
 * opslag kender ingen flag — det koeres naar tick'et er paa loebsdags-aksen, punktum.
 *
 * FEJL-KONTRAKTEN ER DEN MODSATTE AF loadRacedRiderIdsToday's. Det lookup er en
 * BERIGELSE (hvilken profil-type gav loebet?), og "ved det ikke" er dér et lovligt
 * svar. Dette er en REGEL-GATE: gaetter vi forkert, uddeler vi enten traening oven i
 * et loeb (bryder regel 2) eller naegter hele truppen en dag. Derfor returneres
 * fejlen, og kald-stedet KASTER i stedet for at gaette. Tick'et er idempotent og
 * dags-claimen saettes kun ved `failed === 0`, saa naeste cron-tick (5 min) proever igen.
 *
 * @param {{supabase: object, riderIds: string[], seasonId: string, gameDay: number}} args
 * @returns {Promise<{data: Set<string>|null, error: unknown}>}
 */
export async function loadBoundRiderIdsForRaceDay({ supabase, riderIds, seasonId, gameDay, releaseDns = true }) {
  if (!supabase?.from) return { data: null, error: new Error("supabase client required") };
  if (!seasonId) return { data: null, error: new Error("seasonId required") };
  // `Number(null)` er 0, ikke NaN — en manglende loebsdag ville ellers slippe
  // igennem som loebsdag 0 og slaa den forkerte binding op.
  if (gameDay === null || gameDay === undefined || !Number.isFinite(Number(gameDay))) {
    return { data: null, error: new Error("finite gameDay required") };
  }
  if (!riderIds?.length) return { data: new Set(), error: null };
  try {
    const { data, error } = await supabase
      .from("race_entry_days")
      .select("rider_id, race_id")
      // pagination-safe: afgraenset til ÉT holds egen trup (typisk < 30) paa ÉN
      // loebsdag i ÉN saeson — hoejst én raekke pr. rytter, fordi
      // no_rider_double_booking_day er UNIQUE (rider_id, season_id, game_day).
      // Langt under PostgREST's 1000-raekkers-loft.
      .in("rider_id", riderIds)
      .eq("season_id", seasonId)
      .eq("game_day", Number(gameDay));
    if (error) return { data: null, error };
    const started = releaseDns ? await releaseNonStarters(supabase, data ?? []) : { data: data ?? [], error: null };
    if (started.error) return { data: null, error: started.error };
    // #5949: a rider who abandoned the race is bound up to and including the day he
    // left, then follows the team's programme again. This applies on both paths
    // (with and without the DNS release). Injured riders still rest through the
    // engine's injury gate, which does not depend on this binding.
    const exits = await loadRaceExitGameDays({ supabase, rows: started.data });
    if (exits.error) return { data: null, error: exits.error };
    return { data: new Set(dropBindingsAfterRaceExit(started.data, exits.data, Number(gameDay)).map(row => row.rider_id)), error: null };
  } catch (err) {
    // best-effort HER, men ikke hos kalderen: fejlen sluges ikke, den RETURNERES
    // (`data: null` = "ved det ikke", ikke "ingen er bundet"), og
    // dailyTrainingEngine.js KASTER paa den. Grunden til at synkrone/netvaerks-
    // fejl fanges her frem for at boble er at kontrakten skal vaere ÉN form —
    // { data, error } — saa kald-stedet har ét sted at traeffe sin beslutning.
    return { data: null, error: err };
  }
}

// Saved selections can include riders excluded from the actual start field.
// Only an immutable first-stage snapshot proves DNS; missing evidence keeps
// the binding. Never infer DNS from finishers or a missing result.
async function releaseNonStarters(supabase, rows) {
  const raceIds = [...new Set(rows.map(row => row.race_id).filter(Boolean))];
  const fields = new Map();
  if (raceIds.length) {
    // pagination-safe: one first-stage run per bound race in this team's roster.
    const { data: runs, error: runError } = await supabase.from("race_simulation_runs")
      .select("race_id, entrant_snapshot").in("race_id", raceIds).eq("stage_number", 1);
    if (runError) return { data: null, error: runError };
    for (const run of runs ?? []) {
      const entrantIds = Array.isArray(run.entrant_snapshot) ? run.entrant_snapshot.map(entry => typeof entry === "string" ? entry : entry?.rider_id) : null;
      if (!entrantIds || !entrantIds.every(id => typeof id === "string" && id)) {
        return { data: null, error: new Error("invalid immutable start field") };
      }
      if (fields.has(run.race_id)) return { data: null, error: new Error("ambiguous immutable start field") };
      fields.set(run.race_id, new Set(entrantIds));
    }
  }
  return { data: rows.filter(row => !fields.has(row.race_id) || fields.get(row.race_id).has(row.rider_id)), error: null };
}

const raceExitKey = (riderId, raceId) => `${riderId}:${raceId}`;

/**
 * #5949: on which race day did each bound rider leave his race?
 *
 * A rider who abandons a stage race (crash, mechanical, time limit, or the
 * injury withdrawal from #4418) is written to `race_incidents` with
 * outcome='abandon' on the stage he left. That stage's `game_day` in
 * `race_stage_schedule` is his exit day. `race_entry_days` still carries the
 * rest of the race span, which made him rest until the race ended.
 *
 * Missing evidence keeps the binding: an abandon whose stage has no scheduled
 * game_day gives no exit day. Errors are RETURNED (same contract as the binding):
 * the engine refuses to tick rather than guess.
 *
 * @param {{supabase: object, rows: Array<{rider_id: string, race_id: string}>}} args
 * @returns {Promise<{data: Map<string, number>|null, error: unknown}>}
 *   key `${rider_id}:${race_id}` -> earliest exit game_day
 */
export async function loadRaceExitGameDays({ supabase, rows }) {
  const exits = new Map();
  const bound = (rows ?? []).filter(row => row?.rider_id && row?.race_id);
  if (!bound.length) return { data: exits, error: null };
  const wanted = new Set(bound.map(row => raceExitKey(row.rider_id, row.race_id)));
  const raceIds = [...new Set(bound.map(row => row.race_id))];
  const riderIds = [...new Set(bound.map(row => row.rider_id))];
  try {
    const { data: incidents, error } = await supabase.from("race_incidents")
      .select("race_id, stage_number, rider_id")
      // pagination-safe: one team's bound riders (one roster) in their bound races,
      // and an abandoned rider is excluded from every later stage, so at most a
      // handful of rows per rider. Far below the 1000-row cap.
      .in("race_id", raceIds)
      .in("rider_id", riderIds)
      .eq("outcome", "abandon");
    if (error) return { data: null, error };
    const abandons = (incidents ?? []).filter(row => wanted.has(raceExitKey(row.rider_id, row.race_id)));
    if (!abandons.length) return { data: exits, error: null };
    const abandonRaceIds = [...new Set(abandons.map(row => row.race_id))];
    const { data: schedule, error: scheduleError } = await supabase.from("race_stage_schedule")
      .select("race_id, stage_number, game_day")
      // pagination-safe: the few races a roster abandoned, at most ~21 stages each.
      .in("race_id", abandonRaceIds);
    if (scheduleError) return { data: null, error: scheduleError };
    const dayByStage = new Map();
    for (const row of schedule ?? []) {
      const day = row.game_day == null ? NaN : Number(row.game_day);
      if (Number.isFinite(day)) dayByStage.set(`${row.race_id}:${Number(row.stage_number)}`, day);
    }
    for (const row of abandons) {
      const day = dayByStage.get(`${row.race_id}:${Number(row.stage_number)}`);
      if (day === undefined) continue;
      const key = raceExitKey(row.rider_id, row.race_id);
      if (!exits.has(key) || day < exits.get(key)) exits.set(key, day);
    }
    return { data: exits, error: null };
  } catch (err) {
    // best-effort here only: the error is RETURNED, and the binding's caller throws on it.
    return { data: null, error: err };
  }
}

/**
 * #5949: drop binding rows that lie AFTER the rider's exit day from that race.
 * The exit day itself stays bound (he rode, or could not start, that stage).
 * Pure; shared by the engine's binding and the fatigue forecast.
 *
 * @param {Array<{rider_id: string, race_id: string, game_day?: number}>} rows
 * @param {Map<string, number>} exits from loadRaceExitGameDays
 * @param {number} [gameDay] the race day for rows without their own game_day
 */
export function dropBindingsAfterRaceExit(rows, exits, gameDay) {
  if (!exits?.size) return [...(rows ?? [])];
  return (rows ?? []).filter((row) => {
    const exitDay = exits.get(raceExitKey(row.rider_id, row.race_id));
    if (exitDay === undefined) return true;
    const day = Number(row.game_day ?? gameDay);
    return !Number.isFinite(day) || day <= exitDay;
  });
}
