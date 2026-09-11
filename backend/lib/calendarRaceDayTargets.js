// backend/lib/calendarRaceDayTargets.js
// #4845 (ejer-beslutning 6/9): SAMME ANTAL LOEBSDAGE I ALLE FIRE DIVISIONER pr. saeson.
//
// EJEREN ORDRET (#4845, 6/9): "Det skal vaere samme antal dage ind i spillet. Men
// divisionerne behoeves ikke noedvendigvis at koere lige mange loeb. Altsaa det kan sagtens
// vaere, at divisionerne der er lidt lavere, de bare faar flere muligheder for at traene."
//
// HVORFOR DET ER EN EGEN REGEL OG IKKE EN KVOTE-JUSTERING. Kvoten (density x loebsdatoer,
// CALENDAR_RULES.md §1b) bestemmer hvor mange ETAPER en division koerer. Antallet af
// LOEBSDAGE - laengden af `game_day`-aksen - har aldrig vaeret et maal: det har vaeret et
// SOEGERESULTAT, fordi pakkeren fylder hver loebsdag op mod overlap-cap'en (tae­ttest
// foerst, raceCalendarLanePacker.js). Maalt paa S4-dry-runnet 11/9: D1 80 loebsdage,
// D2/D3/D4 56. Naar traeningens tick bliver loebsdagen (#4846), er det forskellen mellem
// 80 og 56 traenings-ticks pr. saeson - altsaa 43 % mere udvikling i D1 end i D4 for samme
// spil. Den ulighed er IKKE en balance-nuance, den er spillets udviklingstakt.
//
// DE TO AKSER (CALENDAR_RULES.md §0) GAELDER UAENDRET. Reglen her roerer KUN loebsdags-
// aksen (`game_day`). Kalenderdage, kvote, tae­thed og slots er uroerte, og `game_day` kan
// fortsat ALDRIG udledes af `scheduled_at`.
//
// MEKANIKKEN: TOMME LOEBSDAGE, IKKE FLERE LOEB. En division der naturligt lander paa 56
// loebsdage faar de manglende 24 som loebsdage UDEN loeb - rene traeningsdage. Loebene
// selv roeres ikke: samme antal, samme typefordeling, samme overlap-struktur.
//
// HVOR EN TOM LOEBSDAG MAA LIGGE (den bindende begraensning). Ejer-reglen 25/8 siger at et
// loebs loebsdage ligger I TRAEK ("Loebsdag 4-5-6-7"), og kun Grand Tours har hviledage
// (GRAND_TOUR_REST_DAYS). En tom loebsdag maa derfor ALDRIG lande inde i et loebs spaend -
// saa ville en 4-etapers etapeloeb faa en hviledag den ikke har i virkeligheden. Den maa
// kun ligge dér hvor INTET loeb er i gang. MAALT paa S4-planen 11/9 (probe af pakkerens
// output): der er kun 4-10 saadanne punkter pr. division i den pakning pakkeren finder i
// dag, saa reglen kan IKKE gennemfoeres som en efterbehandling af et faerdigt output -
// den skal vaere en BINDING i selve soegningen (raceCalendarLanePacker.js's
// `emptyGameDayBudget`), saa soegningen vaelger en pakning der HAR plads til dem.
//
// HVAD DENNE FIL ER: maalet som DATA + de rene funktioner der maaler og doemmer. Selve
// placeringen af de tomme loebsdage ligger i pakkeren; materializeren beder om budgettet.
// Ren: ingen DB, ingen Date.now(), ingen random.
//
// Refs #4845 #4846 #4270 #4192 #3329 #4236

/**
 * Maalet pr. saeson (antal loebsdage paa `game_day`-aksen, ens i alle fire divisioner).
 *
 * TALLET ER MAALT, IKKE VALGT PAA FORNEMMELSE: 80 er D1's EGET naturlige antal loebsdage i
 * S4-dry-runnet 11/9 (28 loebsdatoer, density 5, cap 3, 140 etaper). Maalet kan ikke
 * saettes LAVERE end den hoejeste divisions naturlige antal, fordi en division ikke kan
 * presses sammen paa loebsdags-aksen uden at bryde andre laaste regler: D1's Grand Tours
 * skal have 21 etaper inden for MAX_GT_SPAN_DAYS kalenderdage, og det kraever netop de
 * mange loebsdage pr. kalenderdag. Derfor er maalet = D1's naturlige antal, og de tre
 * andre divisioner fyldes OP til det.
 *
 * Saetter du en ny saeson ind her, skal tallet efterregnes mod et dry-run af netop den
 * saesons D1-pakning (CALENDAR_RULES.md §1d) - ikke arves fra S4.
 */
export const SEASON_RACE_DAY_TARGET = Object.freeze({ 4: 80 });

/**
 * Divisionerne der skal have samme antal loebsdage. Ikke udledt af TIER_DENSITY, fordi
 * reglen gaelder de fire SPILBARE divisioner - en femte tier ville vae­re en ny
 * ejer-beslutning, ikke en automatisk konsekvens.
 */
export const EQUAL_RACE_DAY_TIERS = Object.freeze([1, 2, 3, 4]);

/**
 * Loebsdags-aksens laengde for eet divisions-output.
 *
 * `timelineLength` fra pakkeren ER aksens laengde (antal loebsdage, tomme medregnet).
 * Mangler den, udledes laengden af raekkerne som max(game_day) + 1 — det er dét tal en
 * read-only maaling mod DB kan komme frem til (CALENDAR_RULES.md §1d), og aksen er
 * 0-baseret (§0b).
 *
 * @param {{ stageRows?: Array<{game_day:number}>, timelineLength?: number|null }} args
 * @returns {{ axisLength:number, raceBearingDays:number, emptyGameDays:number }}
 */
export function summarizeRaceDayAxis({ stageRows = [], timelineLength = null } = {}) {
  const gameDays = new Set();
  let hi = -1;
  for (const row of stageRows) {
    const gd = Number(row?.game_day);
    if (!Number.isFinite(gd)) continue;
    gameDays.add(gd);
    if (gd > hi) hi = gd;
  }
  const fraRows = hi >= 0 ? hi + 1 : 0;
  const axisLength = Number.isFinite(Number(timelineLength)) && Number(timelineLength) > 0
    ? Math.max(Number(timelineLength), fraRows)
    : fraRows;
  return { axisLength, raceBearingDays: gameDays.size, emptyGameDays: Math.max(0, axisLength - gameDays.size) };
}

/**
 * Det faelles maal + hvor mange tomme loebsdage hver division mangler for at naa det.
 *
 * PRAECEDENS: eksplicit `override` (CLI `--race-day-target`) > saeson-maalet i
 * SEASON_RACE_DAY_TARGET > det hoejeste MAALTE antal loebsdage blandt divisionerne.
 * Den sidste er fallbacken for en saeson ingen har sat et tal for endnu: den kan altid
 * opnaas (de oevrige fyldes op), modsat et gaet der ligger under en divisions naturlige
 * antal.
 *
 * @param {{ axisByTier?: object|Map, season?: number|null, override?: number|null }} args
 * @returns {{ target:number|null, source:string, deficitByTier:object, impossibleTiers:Array }}
 */
export function resolveCommonRaceDayTarget({ axisByTier = {}, season = null, override = null } = {}) {
  const axis = axisByTier instanceof Map ? Object.fromEntries(axisByTier) : { ...axisByTier };
  const maalte = Object.entries(axis)
    .map(([tier, n]) => [Number(tier), Number(n)])
    .filter(([, n]) => Number.isFinite(n) && n > 0);

  const seasonTarget = season == null ? null : (SEASON_RACE_DAY_TARGET[Number(season)] ?? null);
  const eksplicit = Number.isFinite(Number(override)) && Number(override) > 0 ? Number(override) : null;

  let target = null;
  let source = "ingen";
  if (eksplicit != null) { target = eksplicit; source = "override"; }
  else if (seasonTarget != null) { target = seasonTarget; source = `saeson ${season}`; }
  else if (maalte.length) { target = Math.max(...maalte.map(([, n]) => n)); source = "hoejeste maalte division"; }

  const deficitByTier = {};
  const impossibleTiers = [];
  for (const [tier, n] of maalte) {
    if (target == null) continue;
    deficitByTier[tier] = Math.max(0, target - n);
    // Et maal UNDER en divisions naturlige antal kan ikke opnaas ved at tilfoeje tomme
    // loebsdage - det ville kraeve at pakke divisionen tae­ttere, hvilket er en anden
    // (ejer-laast) regel. Rapportér det, gaet aldrig.
    if (n > target) impossibleTiers.push({ tier, natural: n, target });
  }

  return { target, source, deficitByTier, impossibleTiers };
}

/**
 * §1d/#4845: fejl hvis divisionerne IKKE har samme antal loebsdage (eller ikke rammer
 * maalet). Samme violations-form som de oevrige gates (strenge, en pr. brud).
 *
 * `target = null` betyder "intet maal sat" — da doemmes kun LIGHEDEN mellem divisionerne,
 * ikke afstanden til et tal vi ikke har.
 *
 * @param {{ axisByTier?: object|Map, target?: number|null, tiers?: Array<number> }} args
 * @returns {string[]}
 */
export function detectRaceDayEqualityViolations({ axisByTier = {}, target = null, tiers = EQUAL_RACE_DAY_TIERS } = {}) {
  const axis = axisByTier instanceof Map ? Object.fromEntries(axisByTier) : { ...axisByTier };
  const kendte = tiers
    .map((t) => [Number(t), Number(axis[t] ?? axis[String(t)])])
    .filter(([, n]) => Number.isFinite(n) && n > 0);
  if (kendte.length < 2) return [];

  const violations = [];
  const vaerdier = kendte.map(([, n]) => n);
  const lav = Math.min(...vaerdier);
  const hoej = Math.max(...vaerdier);
  if (lav !== hoej) {
    violations.push(
      `loebsdage pr. saeson er IKKE ens: ${kendte.map(([t, n]) => `D${t} ${n}`).join(" · ")} ` +
      `(spredning ${hoej - lav} loebsdage) — §1d/#4845 kraever samme antal i alle divisioner`,
    );
  }
  if (target != null) {
    for (const [tier, n] of kendte) {
      if (n === target) continue;
      violations.push(
        `tier ${tier}: ${n} loebsdage mod maalet ${target} (${n > target ? "+" : ""}${n - target}) — §1d/#4845 (#4846's tick-enhed)`,
      );
    }
  }
  return violations;
}

/**
 * Hvor mange tomme loebsdage en division maa lae­gge pr. kalenderdag. Budgettet spredes
 * saa jae­vnt som muligt: ellers ville alle de tomme loebsdage klumpe paa de faa datoer
 * hvor intet loeb er i gang, og en spiller ville faa 6 traenings-ticks paa een dag og
 * ingen paa de naeste fem.
 *
 * +1 er bevidst slack: helt uden den ville budgettet vae­re uopnaaeligt i praksis, fordi
 * en tom loebsdag kun kan ligge dér hvor intet loeb er i gang (se filens docstring).
 *
 * @param {{ budget:number, days:number }} args
 * @returns {number}
 */
export function maxEmptyGameDaysPerDate({ budget = 0, days = 1 } = {}) {
  const b = Math.max(0, Number(budget) || 0);
  const d = Math.max(1, Number(days) || 1);
  return b === 0 ? 0 : Math.ceil(b / d) + 1;
}
