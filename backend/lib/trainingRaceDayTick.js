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
export const TRAINING_RACE_DAY_CONFIG = Object.freeze({
  // #4847 (ejer-beslutning 15/9, TRAINING_RULES.md §13.3 beslutning 2): 140 loebsdage
  // pr. saeson i ALLE fire divisioner (= 28 loebsdatoer x D1's 5 slots). Tallet er
  // IKKE frit her: `resolveRaceDaysPerSeason()` nedenfor LAESER det fra
  // calendarRaceDayTargets.js' SEASON_RACE_DAY_TARGET, saa kalenderpakkeren og
  // traeningsdeleren ALDRIG kan divergere. Vaerdien her bruges kun hvis tabellen
  // ikke baerer et eneste positivt maal.
  raceDaysPerSeason: 140,
  // Maalt antal kalenderdags-ticks pr. sæson i dag (S3), spec §3.2.
  calendarTicksPerSeasonToday: 31,
  // DAILY_TRAINING_CONFIG.daysPerSeason — gentaget her som reference for deleren.
  // Bevidst ikke importeret: dailyTraining.js skal kunne koere uden denne fil.
  legacyDaysPerSeason: 28,
  // #4801: loftet paa hele point pr. evne pr. tick. Med loebsdagen som tick-enhed
  // betyder "+1 pr. evne pr. dag" +1 pr. LOEBSDAG. Roret (hardDailyCap) har altid
  // vaeret der; reglen er ny (spec §3.1).
  abilityGainCapPerRaceDay: 1,
});

/**
 * Budget-deleren der holder sæsonens samlede udvikling uaendret (G1).
 * D = raceDaysPerSeason × legacyDaysPerSeason / calendarTicksPerSeasonToday.
 * @returns {number}
 */
export function raceDayBudgetDivisor(cfg = TRAINING_RACE_DAY_CONFIG) {
  return (cfg.raceDaysPerSeason * cfg.legacyDaysPerSeason) / cfg.calendarTicksPerSeasonToday;
}

// ── Loebsdags-maalet laeses fra kalenderen, ikke duplikeret ───────────────────
//
// #4847 punkt 5 (kommentar paa #4845 15/9): deleren SKAL kalibreres mod det tal
// kalenderpakkeren rent faktisk pakker efter. To kopier af "140" — een i pakkeren og
// een her — er praecis den divergens der giver systematisk under- eller overtraening
// naar ejeren senere aendrer maalet ét af stederne.
//
// STATISK IMPORT (#4846). Foer #5169 var merget fandtes calendarRaceDayTargets.js ikke
// paa main, og en defensiv dynamisk import med fallback holdt backenden bootbar. Filen
// er nu paa main, og kalenderpakkeren kan ikke koere uden den, saa den dynamiske sti
// kunne kun skjule en fejl (en ny import-fejl ville tavst give fallback-tallet i stedet
// for at vaelte boot). Den statiske import goer ogsaa opslaget SYNKRONT, saa
// traenings-lukningen (trainingDayCloseTrigger.js) kan bruge det rent.

/**
 * Antal loebsdage pr. saeson for EN given saeson.
 *
 * Praecedens: SEASON_RACE_DAY_TARGET[seasonNumber] > det hoejeste maal i tabellen >
 * TRAINING_RACE_DAY_CONFIG.raceDaysPerSeason. Den mellemste tager hoejde for at
 * tabellen i dag kun har `{ 4: 140 }`: en saeson 5 uden eget tal skal arve S4's maal
 * frem for at falde tilbage paa en konstant der kan vaere aeldre end kalenderen.
 *
 * @param {{seasonNumber?: number|null, cfg?: object, table?: object}} [args]
 *   `table` er kun et test-hook; default er kalenderens SEASON_RACE_DAY_TARGET.
 * @returns {number}
 */
export function resolveRaceDaysPerSeason({
  seasonNumber = null, cfg = TRAINING_RACE_DAY_CONFIG, table = SEASON_RACE_DAY_TARGET,
} = {}) {
  if (table && typeof table === "object") {
    const exact = Number(table[seasonNumber]);
    if (Number.isFinite(exact) && exact > 0) return exact;
    const known = Object.values(table).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (known.length) return Math.max(...known);
  }
  return cfg.raceDaysPerSeason;
}

/**
 * Budget-deleren for en KONKRET saeson, med maalet laest fra kalenderen.
 * Synkron siden importen blev statisk (#4846); kald-stedet i dailyTrainingEngine.js
 * `await`'er den stadig, hvilket er harmloest paa en almindelig vaerdi.
 *
 * @param {{seasonNumber?: number|null, cfg?: object}} [args]
 * @returns {number}
 */
export function resolveRaceDayBudgetDivisor({ seasonNumber = null, cfg = TRAINING_RACE_DAY_CONFIG } = {}) {
  const raceDaysPerSeason = resolveRaceDaysPerSeason({ seasonNumber, cfg });
  return (raceDaysPerSeason * cfg.legacyDaysPerSeason) / cfg.calendarTicksPerSeasonToday;
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
export async function loadBoundRiderIdsForRaceDay({ supabase, riderIds, seasonId, gameDay }) {
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
      .select("rider_id")
      // pagination-safe: afgraenset til ÉT holds egen trup (typisk < 30) paa ÉN
      // loebsdag i ÉN saeson — hoejst én raekke pr. rytter, fordi
      // no_rider_double_booking_day er UNIQUE (rider_id, season_id, game_day).
      // Langt under PostgREST's 1000-raekkers-loft.
      .in("rider_id", riderIds)
      .eq("season_id", seasonId)
      .eq("game_day", Number(gameDay));
    if (error) return { data: null, error };
    return { data: new Set((data ?? []).map((r) => r.rider_id)), error: null };
  } catch (err) {
    // best-effort HER, men ikke hos kalderen: fejlen sluges ikke, den RETURNERES
    // (`data: null` = "ved det ikke", ikke "ingen er bundet"), og
    // dailyTrainingEngine.js KASTER paa den. Grunden til at synkrone/netvaerks-
    // fejl fanges her frem for at boble er at kontrakten skal vaere ÉN form —
    // { data, error } — saa kald-stedet har ét sted at traeffe sin beslutning.
    return { data: null, error: err };
  }
}
