// Loebsdags-tick (#4846, fase B2) — konstanter, seed-noegler og loebsdags-opslag.
// Ren matematik + ét tyndt I/O-opslag; ingen forretningslogik fra motoren flyttes hertil.
//
// Spec: docs/superpowers/specs/2026-09-06-traening-pr-loebsdag-og-traeningsscore-design.md
// §3.1 (tick-noeglen), §3.2 (determinisme), §7 G1/G2.

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
  // IKKE laengere frit her: `resolveRaceDaysPerSeason()` nedenfor LAESER det fra
  // calendarRaceDayTargets.js' SEASON_RACE_DAY_TARGET naar den fil findes, saa
  // kalenderpakkeren og traeningsdeleren ALDRIG kan divergere. Vaerdien her er
  // udelukkende fallback for den tilstand hvor PR #5169 endnu ikke er merget.
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
// DEFENSIV IMPORT, med vilje. `calendarRaceDayTargets.js` lander med PR #5169
// (branch feat/4845-calendar-packs-equal-race-days) og findes IKKE paa main mens
// dette spor bygges. Et statisk `import` ville derfor vaelte HELE backenden ved boot.
// Derfor: cachet dynamisk import i en try/catch, med `TRAINING_RACE_DAY_CONFIG
// .raceDaysPerSeason` som fallback. Naar #5169 er merget, er filen sandheden — uden
// at denne kode skal roeres.
let raceDayTargetModuleCache; // undefined = ikke forsoegt endnu, null = findes ikke
async function loadRaceDayTargetModule() {
  if (raceDayTargetModuleCache !== undefined) return raceDayTargetModuleCache;
  try {
    raceDayTargetModuleCache = await import("./calendarRaceDayTargets.js");
  } catch {
    // best-effort: ERR_MODULE_NOT_FOUND (#5169 ikke merget endnu) — eller enhver
    // anden indlaesningsfejl. Begge betyder det samme her: brug fallbacken. En
    // capture ville fyre ved HVERT boot saa laenge #5169 ikke er merget, altsaa
    // stoej om en tilstand vi allerede kender og har et defineret svar paa.
    raceDayTargetModuleCache = null;
  }
  return raceDayTargetModuleCache;
}

/** Kun til test: glem den cachede import saa naeste kald slaar op igen. */
export function __resetRaceDayTargetCacheForTests() {
  raceDayTargetModuleCache = undefined;
}

/**
 * Antal loebsdage pr. saeson for EN given saeson.
 *
 * Praecedens: SEASON_RACE_DAY_TARGET[seasonNumber] > det hoejeste maal i tabellen >
 * TRAINING_RACE_DAY_CONFIG.raceDaysPerSeason. Den mellemste tager hoejde for at
 * tabellen i dag kun har `{ 4: 140 }`: en saeson 5 uden eget tal skal arve S4's maal
 * frem for at falde tilbage paa en konstant der kan vaere aeldre end kalenderen.
 *
 * @param {{seasonNumber?: number|null, cfg?: object}} [args]
 * @returns {Promise<number>}
 */
export async function resolveRaceDaysPerSeason({ seasonNumber = null, cfg = TRAINING_RACE_DAY_CONFIG } = {}) {
  const mod = await loadRaceDayTargetModule();
  const table = mod?.SEASON_RACE_DAY_TARGET;
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
 * Asynkron fordi kilden er en defensiv dynamisk import (se ovenfor); kald-stedet
 * i dailyTrainingEngine.js awaiter den én gang pr. hold pr. tick.
 *
 * @param {{seasonNumber?: number|null, cfg?: object}} [args]
 * @returns {Promise<number>}
 */
export async function resolveRaceDayBudgetDivisor({ seasonNumber = null, cfg = TRAINING_RACE_DAY_CONFIG } = {}) {
  const raceDaysPerSeason = await resolveRaceDaysPerSeason({ seasonNumber, cfg });
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
