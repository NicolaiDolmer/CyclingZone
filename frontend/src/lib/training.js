// Progression L2 — træning (teaser) (#1163) — frontend display-helpers.
//
// Ren visning: hvilke evner et fokus træner, så assistenten kan forklare
// trade-off'en. Tallene SPEJLER backend (backend/lib/training.TRAINING_CONFIG)
// men er display-only — den faktiske bias beregnes server-side ved
// sæson-skift (og er gated bag #1137-flaget).

// Fokus-nøgle → evner det skubber mod cap (matcher backend TRAINING_FOCUSES).
// #4631: `vo2max` er uændret og er nu hybriden; de to specialiserede sessioner
// står ved siden af den. Nøglen beholdes, så ingen gemt plan skal migreres.
export const TRAINING_FOCUS_ABILITIES = Object.freeze({
  vo2max:       Object.freeze(["climbing", "punch", "tempo"]),
  vo2max_climb: Object.freeze(["climbing", "tempo"]),
  vo2max_punch: Object.freeze(["punch", "tempo"]),
  threshold:   Object.freeze(["time_trial", "tempo"]),
  sprint:      Object.freeze(["sprint", "acceleration"]),
  endurance:   Object.freeze(["endurance", "recovery", "durability"]),
  technique:   Object.freeze(["descending", "cobblestone"]),
  aero:        Object.freeze(["time_trial", "flat"]),
  tempo:       Object.freeze(["tempo", "flat", "durability"]),
  restitution: Object.freeze(["recovery"]),
  // #3709 trin 2 (spec §2.3, ejer-go 16/8): positioning flytter hertil fra
  // `technique`. tactics + aggression kunne før ikke trænes af NOGET fokus.
  loebslaere:  Object.freeze(["positioning", "tactics", "aggression"]),
  // #5236/#5237 (ejer-valg 14/9): brosten, vifte og angreb — se backend
  // training.js for den fulde begrundelse. Rækkefølgen/evnerne skal matche
  // backend PRÆCIST (håndhævet af backend/lib/handheldCopyGuards.test.js).
  cobbled_sectors: Object.freeze(["cobblestone", "durability", "positioning"]),
  echelon_drills:  Object.freeze(["flat", "positioning", "durability"]),
  attack_repeats:  Object.freeze(["aggression", "punch", "acceleration"]),
});
export const TRAINING_FOCUS_KEYS = Object.freeze(Object.keys(TRAINING_FOCUS_ABILITIES));

// Alle gyldige intensiteter inkl. rest (bruges i daglig træning + TrainingFocus).
// #3762: intensiteten er ikke længere et frit valg — den er en egenskab ved
// sessionen (se trainingDayTypes.js). Listen bevares fordi ugerytmen (#1895)
// stadig sætter en intensitet pr. ugedag.
export const TRAINING_INTENSITIES = Object.freeze(["rest", "recovery", "easy", "normal", "hard"]);

// #1895 PR 1: ugentlig træningsrytme — display-helpers. Spejrer backend
// (backend/lib/training.js WEEKDAY_KEYS/isValidWeekPlanDays/resolveDayIntensity)
// men er ren visning: sandheden om dagens EFFEKTIVE intensitet beregnes af
// motoren (dailyTrainingEngine.js) ved dagens tick. Bruges KUN til at markere
// rækker hvor rytmen ville afvige fra rytterens sæson-intensitet lige nu.
export const WEEKDAY_KEYS = Object.freeze(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

export function isValidWeekPlanDays(days) {
  if (!days || typeof days !== "object" || Array.isArray(days)) return false;
  const keys = Object.keys(days);
  if (keys.length !== WEEKDAY_KEYS.length) return false;
  for (const key of keys) if (!WEEKDAY_KEYS.includes(key)) return false;
  for (const weekday of WEEKDAY_KEYS) {
    const entry = days[weekday];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    if (!isValidIntensity(entry.intensity)) return false;
  }
  return true;
}

// Ugedags-nøgle for en Date i BRUGERENS lokale tid (display-only — motoren
// bruger Copenhagen-tid server-side; en visnings-hint kan afvige i sjældne
// tidszone-kanttilfælde uden konsekvens, da den aldrig styrer noget selv).
const WEEKDAY_ORDER = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export function weekdayKeyForDate(date = new Date()) {
  return WEEKDAY_ORDER[date.getDay()];
}

// Samme lagdeling som backend resolveDayIntensity (training.js): rytter-override
// (individuel ugeplan) > rytterens EGEN eksplicitte plan (hasExplicitPlan) >
// holdrytme (default for ryttere UDEN egen override) > sæson-intensitet > "normal".
// #2438 — en individuel rytter-indstilling overtrumfer den ugentlige rutine;
// rutinen er kun default for ryttere uden override.
export function resolveDayIntensityDisplay({
  weekday, riderOverrideDays, teamWeekDays, planIntensity, hasExplicitPlan = false,
}) {
  const riderOverride = riderOverrideDays?.[weekday]?.intensity;
  if (isValidIntensity(riderOverride)) return riderOverride;
  if (hasExplicitPlan && isValidIntensity(planIntensity)) return planIntensity;
  const teamDay = teamWeekDays?.[weekday]?.intensity;
  if (isValidIntensity(teamDay)) return teamDay;
  if (isValidIntensity(planIntensity)) return planIntensity;
  return "normal";
}

// #2438 — hvilket LAG afgør dagens effektive intensitet (til "én sandhed pr.
// rytter"-visningen i TrainingPage). Samme prioritet som resolveDayIntensityDisplay,
// men returnerer kilden i stedet for værdien.
//   "individualPlan" — rytterens egen ugeplan-override for netop i dag
//   "ownSetting"      — rytterens egen eksplicitte focus+intensity (training_plans)
//   "teamRhythm"      — holdets ugentlige rutine (default, ingen egen override)
//   "default"         — hverken override, egen plan eller holdrytme
export function resolveDayIntensitySource({ weekday, riderOverrideDays, teamWeekDays, hasExplicitPlan = false }) {
  const riderOverride = riderOverrideDays?.[weekday]?.intensity;
  if (isValidIntensity(riderOverride)) return "individualPlan";
  if (hasExplicitPlan) return "ownSetting";
  const teamDay = teamWeekDays?.[weekday]?.intensity;
  if (isValidIntensity(teamDay)) return "teamRhythm";
  return "default";
}

export function isValidFocus(focus) {
  return Object.prototype.hasOwnProperty.call(TRAINING_FOCUS_ABILITIES, focus);
}
export function isValidIntensity(intensity) {
  return TRAINING_INTENSITIES.includes(intensity);
}

// Beregn antal RESTERENDE skadedage (inklusiv i dag) givet en injured_until dato
// og dags dato. Returnerer 0 hvis rask, positivt tal hvis skadet.
// today er en Date (default = new Date()).
//
// injured_until er en DATE-kolonne (database/2026-06-12-daily-training.sql) =
// den SIDSTE skadede dag, inklusiv: backend regner rytteren som skadet så længe
// injured_until >= dagens dato (dailyTrainingEngine.js: injured_until >= tickDate).
// Tælleren skal derfor være INKLUSIV den sidste skadedag, ellers viser den "0 dage"
// på selve injured_until-datoen, hvor rytteren stadig er skadet (#1672).
//
// Sammenlign rene KALENDERDAGE, ikke tidsstempler: injured_until er en dato uden
// klokkeslæt (DATE-kolonne), mens today bærer brugerens lokale klokkeslæt. Vi mapper
// begge til UTC-midnat ud fra deres respektive kalenderfelter (injured_until i UTC,
// today i lokal tid) — så hverken tidszone eller sommertid kan flytte en kalenderdag.
function calendarDayUTC(value, useLocal) {
  const d = value instanceof Date ? value : new Date(value);
  return useLocal
    ? Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
    : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function injuryDaysLeft(injured_until, today = new Date()) {
  if (!injured_until) return 0;
  const untilDay = calendarDayUTC(injured_until, false); // UTC-dato fra DB
  const todayDay = calendarDayUTC(today, true);          // brugerens lokale dag
  const diffDays = Math.round((untilDay - todayDay) / 86_400_000);
  // diffDays >= 0 ⇒ stadig skadet i dag; +1 tæller den indeværende skadedag med.
  return diffDays >= 0 ? diffDays + 1 : 0;
}

// #1531: er rytteren skadet lige nu? Bruges til skade-badget i Status-kolonnen på
// hold-tabellerne (eget hold + andres hold). injured_until = ISO-datostreng eller null.
// Genbruger injuryDaysLeft så "skadet"-tærsklen er ÉN kilde til sandhed (samme som
// skade-chippen på rytterprofilen).
export function isRiderInjured(injured_until, today = new Date()) {
  return injuryDaysLeft(injured_until, today) > 0;
}

// #5462 (ejer-laast 15/9, TRAINING_RULES §13.3 pkt. 7): skadesvarigheden udtrykkes i
// LOEBSDAGE naar `training_tick_per_race_day` er on. Backenden skriver da
// `rider_condition.injury_race_days_left` (resterende loebsdage INKLUSIV den
// indevaerende, samme semantik som injuryDaysLeft) og udleder `injured_until` af
// slut-loebsdagen. Fladen skal IKKE kende holdets divisions-akse — den laeser tallet.
//
// EN FUNKTION, TO FLAG-TILSTANDE. Uden loebsdags-tallet (flag off, eller en skade
// skrevet FOER flippet) svares der praecis som i dag: kalenderdage. Det er ogsaa
// overgangs-reglen — en igangvaerende skade skifter ikke betydning tavst.
//
// `approxDate` er ALTID et skoen: en kalenderdato baerer fra S4 fem loebsdage, og en
// tom loebsdag har ingen etape at slaa en dato op paa (CALENDAR_RULES §1e-b). Derfor
// "ca. <dato>" i teksten, aldrig en bar dato.
//
// @returns {{count: number, unit: "race_day"|"calendar_day", approxDate: string|null}}
export function injuryTimeLeft(condition, today = new Date()) {
  const injuredUntil = condition?.injured_until ?? null;
  const rawRaceDaysLeft = condition?.injury_race_days_left;
  const raceDaysLeft = Number(rawRaceDaysLeft);
  // Tallet er SAT (ogsaa naar det er 0) ⇒ loebsdags-aksen ejer svaret. Faldt vi
  // tilbage til datoen ved 0, ville en rytter der netop er raskmeldt paa aksen
  // stadig staa som "skadet 1 dag" resten af kalenderdatoen (CodeRabbit 21/9).
  if (rawRaceDaysLeft != null && Number.isFinite(raceDaysLeft)) {
    return { count: Math.max(0, Math.trunc(raceDaysLeft)), unit: "race_day", approxDate: injuredUntil };
  }
  return {
    count: injuryDaysLeft(injuredUntil, today),
    unit: "calendar_day",
    approxDate: injuredUntil,
  };
}

// #5462: hvilken NØGLE i `training`-namespacet skal skade-badget bruge? Ren
// funktion, saa alle traenings-flader (roster-raekken, rapport-raekken, mobil-kortet)
// vaelger ens — og saa valget kan faeldes af en test uden at rendere React.
// `date` er raa ISO; kald-stedet formaterer den med lib/intl.js' formatDate.
// `compact` = fladen har kun plads til ÉN kort linje (roster-tabellens smalle
// Status-celle). Da staar loebsdagene i badget og ca.-datoen i title'en — samme
// arbejdsdeling som ConditionChips paa rytterprofilen. Uden `compact` staar hele
// saetningen inkl. "(ca. <dato>)", som issuet beder om.
export function injuryBadgeMessage(injury, { compact = false } = {}) {
  if (injury?.unit === "race_day") {
    return injury.approxDate && !compact
      ? { key: "injuredRaceDays", days: injury.count, date: injury.approxDate }
      : { key: "injuredRaceDaysPlain", days: injury.count, date: null };
  }
  const count = injury?.count ?? 0;
  return { key: count === 1 ? "injured" : "injured_plural", days: count, date: null };
}

// #1531: PostgREST select-fragment til at embedde skade-status på en riders-query
// eller en nested rider:rider_id(...)-join. rider_condition har
// RLS SELECT TO authenticated USING(true), så det virker også på andres hold.
// #5462: `injury_race_days_left` er med, saa skade-badget paa ANDRES hold kan sige
// loebsdage praecis som paa eget hold. Kolonnen er NULL indtil flaget flippes.
export const CONDITION_SELECT = "rider_condition(injured_until, injury_race_days_left)";

// Løft det joinede rider_condition.injured_until op på selve rytter-objektet (samme
// mønster som flattenAbilities). Supabase-embed kan komme som array (to-many) eller
// objekt (to-one); vi håndterer begge. Manglende rad = injured_until forbliver
// undefined → isRiderInjured returnerer false.
export function flattenCondition(rider) {
  if (!rider) return rider;
  const rc = rider.rider_condition;
  const cond = Array.isArray(rc) ? rc[0] : rc;
  const out = { ...rider };
  if (cond) {
    out.injured_until = cond.injured_until;
    // #5462: loebsdags-tallet foelger med op, saa isRiderInjured/injuryTimeLeft kan
    // kaldes paa selve rytter-objektet. undefined naar flaget er off.
    out.injury_race_days_left = cond.injury_race_days_left;
  }
  delete out.rider_condition;
  return out;
}
