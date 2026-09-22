// Skadesvarighed paa LOEBSDAGS-aksen (#5462).
//
// EJERENS ORD 15/9: "Loebsdage" (docs/TRAINING_RULES.md §13.3 pkt. 7).
// Ejer-valg 21/9: varigheden skaleres med saesonens loebsdage pr. kalenderdato.
// "Samme antal ticks" var en konsekvens-tekst, ikke ejerens citat, og er afloest.
// Roadbook-loeftet 15/9: "Injuries counted in race days, so 'back in three race days'
// means what it says."
//
// ── DATAMODELLEN, OG HVORFOR DEN ER DEN MINDST INVASIVE ─────────────────────
//
// `rider_condition.injured_until` (DATE) er i dag skadens ENESTE sandhed, og den
// laeses af mindst syv steder: udtagelses-gaten (riderEligibility.applyInjuredFilter's
// `.gte("injured_until", todayStr)`), raceSelection.js, raceEntryGenerator.js,
// raceRunner's autofill + startfelt-frysning, racePeakPlans.js og hele frontend-kernen
// (frontend/src/lib/training.js). At skifte DEN kolonne ud med en loebsdag ville
// betyde at alle syv skulle kende holdets divisions-akse — inklusive rene SQL-filtre
// der ikke har et hold i haanden.
//
// Derfor: `injured_until` BLIVER datoen og bliver ved med at vaere gaten. Loebsdagen
// lægges VED SIDEN AF, som tre additive kolonner:
//
//   injury_end_game_day   — SIDSTE skadede loebsdag (0-baseret, som DB'en, §0b)
//   injury_season_id      — hvilken saesons akse den loebsdag hoerer til
//   injury_race_days_left — resterende loebsdage inkl. i dag, opfrisket hvert tick
//
// `injured_until` UDLEDES saa af `injury_end_game_day`: datoen for den foerste
// loebsdag >= slut-loebsdagen der rent faktisk har en etape i kalenderen. Gaten og
// alle flader laeser dermed fortsat ÉT felt, og det felt betyder nu "N loebsdage".
//
// TRADE-OFF (fordel / pris / alternativ), staar ogsaa i PR-body:
//   Fordel:    nul aendringer i gaten, i generatoren, i peak-planneren og i alle de
//              SQL-filtre der allerede virker. Flag off er bit-identisk.
//   Pris:      en kalenderdato baerer fra S4 fem loebsdage, saa en dato-gate er
//              grovere end aksen. Slutter skaden paa loebsdag 3 af 5 paa dato X, er
//              rytteren ude resten af dato X i UDTAGELSES-gaten. Konservativt (han er
//              aldrig ude for KORT tid) og derfor "ca. <dato>" i UI'et. Motorens egen
//              raskmelding (dailyTrainingEngine) bruger loebsdagen, ikke datoen.
//   Alternativ: en loebsdags-gate hele vejen — divisions-aksen skulle da plumbes ind
//              i hvert eneste udtagelses-kald og hver PostgREST-query. Det er en
//              stoerre omlaegning end selve beslutningen kraever, og den kan tages
//              senere uden at aendre denne datamodel.
//
// AKSE-FAELDEN (CALENDAR_RULES §0): `game_day` udledes ALDRIG af `scheduled_at`.
// Her gaar opslaget den ANDEN vej — fra en LAGRET `game_day` til dens lagrede
// `scheduled_at` — og det er ikke det forbudte. Den omvendte retning findes ikke
// i denne fil.
//
// TOM LOEBSDAG (CALENDAR_RULES §1e-b): fra S4 fyldes hver kalenderdato op til 5
// loebsdage, og en loebsdag UDEN loeb har ingen raekke i race_stage_schedule. Slutter
// skaden paa saadan en, kan datoen ikke slaas praecist op — vi tager derfor den
// foerste loebsdag >= slut der HAR en raekke. Det er den konservative retning
// (aldrig for kort) og praecis derfor UI'et siger "ca.".

import { copenhagenDateString } from "./copenhagenTime.js";
import { SEASON_RACE_DAY_TARGET } from "./calendarRaceDayTargets.js";
import { SEASON_RACE_DAYS_DEFAULT } from "./calendarStartDate.js";

/**
 * Sidste skadede LOEBSDAG. Varighed = kalenderdags-rullet gange aksens taethed.
 *
 * SAESONGRAENSEN (kendt, dokumenteret, CodeRabbit 21/9). Ligger slut-loebsdagen
 * efter saesonens sidste planlagte loebsdag, kan datoen ikke slaas op, og
 * `injured_until` beholder kalenderdags-fallbacken (tickDate + N KALENDERDAGE).
 * Den er i wall-clock ALTID mindst lige saa lang som N loebsdage — fra S4 er der
 * fem loebsdage pr. kalenderdato — saa rytteren kommer aldrig for TIDLIGT tilbage.
 * At baere resten videre paa naeste saesons akse kraever en cross-season-koordinat
 * og er bevidst ude af scope her; fallbacken bevarer det oprindelige antal
 * kalenderdage, og rest-varigheden maa ikke genbruges paa en anden saesons akse.
 *
 * Ejer-valg 22/9: dagens session er afsluttet naar skaden opstaar. De naeste
 * N gange aksens taethed ticks mistes, inklusive slutdagen gameDay + varigheden.
 * Kalenderstiens hidtidige aritmetik er uberoert.
 *
 * @param {{gameDay: number, days: number, seasonNumber?:number,
 *   raceDays?:number, calendarDates?:number}} args
 * @returns {number|null} null naar aksen ikke kendes (kald-stedet falder tilbage).
 */
export function injuryEndGameDay({ gameDay, days, seasonNumber,
  raceDays = SEASON_RACE_DAY_TARGET[seasonNumber],
  calendarDates = SEASON_RACE_DAYS_DEFAULT[seasonNumber] } = {}) {
  // `Number(null)` er 0, ikke NaN — samme faelde som i calendarActivationRaceDays.js.
  // Uden dette led ville en manglende akse tavst blive til loebsdag 0.
  if (gameDay == null || days == null) return null;
  const gd = Number(gameDay);
  const n = Number(days);
  if (!Number.isFinite(gd) || !Number.isInteger(gd) || gd < 0) return null;
  if (!Number.isInteger(n) || n <= 0) return null;
  if (raceDays == null || calendarDates == null) return null;
  const density = Number(raceDays) / Number(calendarDates);
  if (!Number.isFinite(density) || density < 1 || !Number.isInteger(density)) return null;
  return gd + n * density;
}

// Delayed finalization cannot move a fresh crash injury's date backwards.
export function conservativeInjuryEndDate(fallbackDate, raceDayDate) {
  return raceDayDate && (!fallbackDate || raceDayDate > fallbackDate) ? raceDayDate : fallbackDate;
}

export function resolveIncidentInjuryEndDate(row, raceDayDate) {
  const fallbackWins = !raceDayDate || (row.injured_until && raceDayDate < row.injured_until);
  return { ...row, injured_until: conservativeInjuryEndDate(row.injured_until, raceDayDate),
    // Otherwise the next training tick would prefer the earlier coordinate and
    // undo this protection. The later date must own this particular injury.
    ...(fallbackWins ? { injury_end_game_day: null, injury_season_id: null, injury_race_days_left: null } : {}) };
}

/**
 * Resterende loebsdage INKLUSIV den indevaerende — samme inklusiv-semantik som
 * frontendens `injuryDaysLeft` (#1672: paa selve den sidste skadedag skal der staa
 * "1", ikke "0").
 *
 * @param {{endGameDay: number|null, currentGameDay: number|null}} args
 * @returns {number} 0 = rask.
 */
export function injuryRaceDaysLeft({ endGameDay, currentGameDay } = {}) {
  // `Number(null)` er 0, ikke NaN — uden dette led ville en manglende loebsdag
  // slippe igennem som loebsdag 0 og give et opfundet antal dage tilbage.
  if (endGameDay == null || currentGameDay == null) return 0;
  const end = Number(endGameDay);
  const now = Number(currentGameDay);
  if (!Number.isFinite(end) || !Number.isFinite(now)) return 0;
  const left = end - now + 1;
  return left > 0 ? left : 0;
}

/**
 * Er rytteren skadet paa DENNE loebsdag?
 *
 * Praecedens: loebsdags-sandheden naar den findes OG hoerer til samme saeson;
 * ellers den gamle dato-sammenligning. Den sidste gren er derfor bit-identisk med
 * i dag for enhver raekke skrevet foer flippet (og for hele flag-off-stien).
 *
 * @param {{condition?: object|null, seasonId?: string|null, gameDay?: number|null,
 *   tickDate: string}} args
 * @returns {boolean}
 */
export function isInjuredOnRaceDay({ condition, seasonId = null, gameDay = null, tickDate } = {}) {
  const end = condition?.injury_end_game_day;
  const sameSeason = seasonId != null && condition?.injury_season_id === seasonId;
  if (sameSeason && end != null && Number.isFinite(Number(end)) && Number.isFinite(Number(gameDay))) {
    return Number(end) >= Number(gameDay);
  }
  const until = condition?.injured_until ?? null;
  return !!(until && tickDate && until >= tickDate);
}

/**
 * Slaa kalenderdatoen op for en eller flere SLUT-loebsdage paa ÉN divisions akse.
 *
 * ÉT opslag for alle de oenskede loebsdage: motoren kan skade flere ryttere i samme
 * tick, og et styrt-loeb kan ramme flere ryttere paa samme etape.
 *
 * FAIL-SAFE, kaster aldrig. Alt der ikke kan besvares giver `null` for den
 * paagaeldende loebsdag, og kald-stedet falder tilbage til kalenderdags-aritmetikken
 * (dagens adfaerd) i stedet for at stoppe en skade fra at blive skrevet.
 *
 * @param {{supabase: object, seasonId: string, divisionId: number|string|null,
 *   endGameDays?: number[]}} args
 * @returns {Promise<Map<number, string|null>>} loebsdag → "YYYY-MM-DD" (dansk dato)
 */
export async function resolveInjuryEndDates({ supabase, seasonId, divisionId, endGameDays = [] } = {}) {
  const wanted = [...new Set((endGameDays ?? []).map(Number).filter((n) => Number.isInteger(n) && n >= 0))];
  const out = new Map(wanted.map((gd) => [gd, null]));
  if (!out.size || !supabase?.from || !seasonId || divisionId == null) return out;

  try {
    const { data: races, error: racesError } = await supabase
      .from("races")
      .select("id")
      .eq("season_id", seasonId)
      .eq("league_division_id", divisionId);
    if (racesError) return out;
    const raceIds = (races ?? []).map((r) => r.id).filter(Boolean);
    if (!raceIds.length) return out;

    const lowest = Math.min(...wanted);
    const { data: stages, error: stagesError } = await supabase
      .from("race_stage_schedule")
      .select("game_day, scheduled_at")
      // pagination-safe: ÉN divisions loeb i ÉN saeson, afgraenset til loebsdage
      // >= den tidligste slut-loebsdag vi spoerger om. S4-maalet er 140 loebsdage
      // pr. division og 84-140 etaper — langt under PostgREST's 1000-raekkers-loft.
      .in("race_id", raceIds)
      .gte("game_day", lowest)
      .order("game_day", { ascending: true })
      .order("scheduled_at", { ascending: true });
    if (stagesError) {
      // Fejlen sluges IKKE tavst: fallbacken er bevidst, men en stille degradering
      // til kalenderdage kan ellers kun maales paa skadernes laengde.
      // ASCII-only: intern ops-logging, ikke en spiller-synlig API-fejl.
      console.warn(`  ⚠️ injury race-day calendar lookup failed (#5462, season ${seasonId}): ${stagesError.message} - injured_until falls back to calendar days`);
      return out;
    }

    // Foerste (laveste scheduled_at) raekke pr. loebsdag. Raekkefoelgen ovenfor goer
    // den foerste forekomst til den rigtige.
    const firstByGameDay = new Map();
    const sortedGameDays = [];
    for (const row of stages ?? []) {
      if (row?.game_day == null || row.game_day === "") continue;
      const gd = Number(row.game_day);
      if (!Number.isInteger(gd)) continue;
      if (firstByGameDay.has(gd)) continue;
      const t = new Date(row.scheduled_at);
      if (Number.isNaN(t.getTime())) continue;
      firstByGameDay.set(gd, copenhagenDateString(t));
      sortedGameDays.push(gd);
    }
    sortedGameDays.sort((a, b) => a - b);

    for (const target of wanted) {
      // Foerste loebsdag >= target der HAR en etape. En tom loebsdag har ingen
      // raekke (CALENDAR_RULES §1e-b), saa vi runder OP — aldrig ned.
      const hit = sortedGameDays.find((gd) => gd >= target);
      out.set(target, hit === undefined ? null : firstByGameDay.get(hit));
    }
    return out;
  } catch (err) {
    // best-effort: en netvaerks-/synkron fejl maa aldrig forhindre at skaden skrives.
    console.warn(`  ⚠️ injury race-day calendar lookup threw (#5462, season ${seasonId}): ${err.message} - injured_until falls back to calendar days`);
    return out;
  }
}

/**
 * Holdets division — det ene opslag `resolveInjuryEndDates` mangler naar kald-stedet
 * kun har et team_id (traenings-motoren). Fail-safe: null ved enhver fejl.
 *
 * @param {{supabase: object, teamId: string}} args
 * @returns {Promise<number|string|null>}
 */
export async function loadTeamDivisionId({ supabase, teamId } = {}) {
  if (!supabase?.from || !teamId) return null;
  try {
    const { data, error } = await supabase
      .from("teams").select("league_division_id").eq("id", teamId).maybeSingle();
    if (error) return null;
    return data?.league_division_id ?? null;
  } catch {
    // best-effort: division-opslaget er KUN til at finde skadens ca.-dato. En
    // netvaerks-/synkron fejl her maa aldrig forhindre at skaden bliver skrevet —
    // kald-stedet beholder kalenderdags-fallbacken paa injured_until, og
    // loebsdags-felterne baerer stadig den praecise sandhed.
    return null;
  }
}
