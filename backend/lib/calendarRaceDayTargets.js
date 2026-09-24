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
// loebsdage faar resten op til maalet som loebsdage UDEN loeb - rene traeningsdage. Loebene
// selv roeres ikke: samme antal, samme typefordeling, samme overlap-struktur. Ejeren
// bekraeftede det ordret 15/9: "jeg vil ikke have at dette laver om i loebskalenderen".
//
// HVOR EN TOM LOEBSDAG LIGGER (ejer-valg 20/9, "maade B"). De tomme loebsdage fordeles
// JAEVNT: hver kalenderdato fyldes op til maalet/antal datoer (140/28 = 5). Ejer-reglen
// 25/8 om loebsdage i traek gaelder uae­ndret, men laeses paa de loebsdage der BAERER et
// loeb: en tom loebsdag bryder ikke raekken, og ligger den inde i et etapeloebs spaend, er
// den en dag hvor de bundne ryttere HVILER mens alle andre traener (CALENDAR_RULES §1d).
//
// DEN AFVISTE VEJ ("maade A"): kun dér hvor INTET loeb er i gang. MAALT paa S4-planen
// (11/9 + 19/9): der er kun 4-10 saadanne positioner pr. division, saa traeningsdagene
// klumpede (15-33 paa EEN kalenderdato; D3 havde 23 kalenderdatoer i traek uden en eneste).
// Ejeren valgte B 20/9. Begge maalinger staar i
// docs/audits/2026-09-19-5267-proevepakning{,-jaevn}.md.
//
// HVAD DENNE FIL ER: maalet som DATA + de rene funktioner der maaler og doemmer. Selve
// placeringen af de tomme loebsdage ligger i pakkeren; materializeren beder om budgettet.
// Ren: ingen DB, ingen Date.now(), ingen random.
//
// Refs #4845 #4846 #4270 #4192 #3329 #4236

/**
 * Maalet pr. saeson (antal loebsdage paa `game_day`-aksen, ens i alle fire divisioner).
 *
 * TALLET ER EN EJER-BESLUTNING, IKKE ET SOEGERESULTAT (15/9, TRAINING_RULES.md §13.3
 * beslutning 2, og #4850's kommentar 15/9): 140 loebsdage pr. saeson i ALLE fire
 * divisioner = 28 loebsdatoer x D1's 5 slots. Antallet af LOEB pr. division er uroert
 * ("jeg vil ikke have at dette laver om i loebskalenderen"); de ekstra loebsdage er rene
 * traeningsdage.
 *
 * FOER 15/9 stod her 80 - D1's EGET naturlige antal loebsdage i S4-dry-runnet 11/9. Det
 * tal var gulvet (maalet kan ikke saettes LAVERE end den hoejeste divisions naturlige
 * antal, for en division kan ikke presses sammen paa loebsdags-aksen uden at bryde andre
 * laaste regler). 140 er loftet: hver af de 28 loebsdatoer baerer D1's 5 slots.
 *
 * DEN MAALTE VAEG FRA 15/9 ER VAEK (#5267, 19/9). Den gang naaede D1 ikke 140, og
 * MAX_GT_STAGES_PER_DAY = 4 (#4103) fik skylden. Det var en FOELGE, ikke aarsagen: maalet
 * var en binding INDE i soegningen (R12), saa de tomme loebsdage skulle presses ind i
 * kalenderdatoernes egen etape-kvote. Da maalet blev en efterbehandling, naaede alle fire
 * divisioner 140 med GT-loftet uroert paa 4 - og overlap-gulvene holdt. Tre ting der
 * derfor IKKE laengere er sande: MAX_GT_STAGES_PER_DAY er ikke vaegen ·
 * TIER_MULTI_RACE_DAY_MIN_SHARE skal ikke saenkes · 112 er ikke noedvendigt som kompromis.
 * Se CALENDAR_RULES.md §1d.
 *
 * Saetter du en ny saeson ind her, skal tallet efterregnes mod et dry-run af netop den
 * saesons D1-pakning (CALENDAR_RULES.md §1d) - ikke arves fra S4.
 */
export const SEASON_RACE_DAY_TARGET = Object.freeze({ 4: 140 });

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
  // Kun et POSITIVT HELTAL. En brok kan pr. konstruktion ikke rammes af en akse der taelles
  // i hele loebsdage, og Infinity/NaN ville slippe igennem et bart `> 0` og tavst faa
  // pakkeren til at bygge noget andet end det der blev bedt om. Fanget af CodeRabbit 15/9.
  const eksplicit = Number.isSafeInteger(Number(override)) && Number(override) > 0 ? Number(override) : null;

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
  // Med FAERRE END TO maalte divisioner springes kun LIGHEDS-tjekket over — det kraever to
  // tal at sammenligne. Afstanden til maalet doemmes stadig: en enkelt division der er
  // materialiseret alene (fx en aktiveret pulje) skal ikke kunne slippe forbi
  // --apply-gaten bare fordi naboerne ikke er bygget endnu. Fanget af CodeRabbit 15/9.
  const violations = [];
  if (kendte.length >= 2) {
    const vaerdier = kendte.map(([, n]) => n);
    const lav = Math.min(...vaerdier);
    const hoej = Math.max(...vaerdier);
    if (lav !== hoej) {
      violations.push(
        `loebsdage pr. saeson er IKKE ens: ${kendte.map(([t, n]) => `D${t} ${n}`).join(" · ")} ` +
        `(spredning ${hoej - lav} loebsdage) — §1d/#4845 kraever samme antal i alle divisioner`,
      );
    }
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

// ── §1e/#5267: SPREDNINGEN MAALES PAA BLOKKE, IKKE PAA DATOER ────────────────────────
//
// FOER #5267 stod her `maxEmptyGameDaysPerDate` — et loft for hvor mange tomme loebsdage
// en division maatte lae­gge PR. KALENDERDATO. Det loft er fjernet, og det er en
// ejer-informeret aendring, ikke en oprydning: loftet var kun opfyldeligt fordi R12
// re-soegte hele placeringen for at skaffe frie positioner nok, og netop den re-soegning
// er det der slog mindste-overlap-gulvet (§1/#3329) ud i alle fire divisioner (maalt
// 18/9). Naar loebene ikke maa flyttes, er antallet af frie positioner givet af kataloget,
// og et loft pr. dato kan da hverken overholdes eller goere kalenderen bedre.
//
// Det kravet HANDLER om er noget andet: "der maa ikke gaa lang tid uden en traeningsdag".
// Det maales som den laengste raekke af KALENDERDATOER i traek helt uden en traeningsdag.
//
// TALLET ER EN REGRESSIONSVAGT, IKKE ET KVALITETSMAAL — samme disciplin som
// TIER_MULTI_RACE_DAY_MIN_SHARE (calendarTierCaps.js). Loftet er sat lige over den vaerste
// MAALTE division, saa en fremtidig aendring der goer rytmen DAARLIGERE gaar roedt.
//
// MAALT 20/9 paa S4's proevepakning med den jaevne fordeling (ejer-valget, §1d): D1 1 ·
// D2 0 · D3 0 · D4 0 kalenderdatoer. Loftet er derfor 2.
//
// FOER 20/9 stod her 24, maalt paa den afviste vej hvor traeningsdagene kun maatte ligge
// dér hvor intet loeb var i gang (D1 16 · D2 11 · D3 23 · D4 11). Det var netop den
// klumpning ejeren afviste, saa loftet foelger med ned: et loft paa 24 ville i dag lade en
// regression paa 23 datoer passere tavst.
export const MAX_DATES_WITHOUT_TRAINING_DAY = 2;

/**
 * §1e/#5267: laengste raekke af kalenderdatoer i traek HELT uden en traeningsdag.
 * Stimer i begyndelsen og slutningen af saesonen taeller med.
 *
 * @param {{ days:number, trainingRealDays?:Array<number> }} args
 * @returns {number}
 */
export function longestDateStreakWithoutTraining({ days = 0, trainingRealDays = [] } = {}) {
  const n = Math.max(0, Math.round(Number(days) || 0));
  if (n === 0) return 0;
  const harTraening = new Array(n).fill(false);
  for (const d of trainingRealDays) {
    const i = Number(d);
    if (Number.isFinite(i) && i >= 0 && i < n) harTraening[i] = true;
  }
  let laengste = 0;
  let nu = 0;
  for (let d = 0; d < n; d++) {
    if (harTraening[d]) { nu = 0; continue; }
    nu += 1;
    if (nu > laengste) laengste = nu;
  }
  return laengste;
}

/**
 * §1e/#5267: fejl naar en division har en for lang stime uden traeningsdag.
 *
 * Doemmer KUN divisioner der faktisk HAR et loebsdags-maal (uden maal er der ingen
 * traeningsdage at fordele, og en S3-kalender bygget foer reglen maa ikke blive ulovlig
 * bagud — samme disciplin som §1d's "kun naar saesonen har et maal").
 *
 * @param {{ streakByTier?:object|Map, max?:number }} args
 * @returns {string[]}
 */
export function detectTrainingDayStreakViolations({ streakByTier = {}, max = MAX_DATES_WITHOUT_TRAINING_DAY } = {}) {
  const kilde = streakByTier instanceof Map ? Object.fromEntries(streakByTier) : { ...streakByTier };
  const loft = Math.max(1, Number(max) || MAX_DATES_WITHOUT_TRAINING_DAY);
  const violations = [];
  for (const [tier, raa] of Object.entries(kilde)) {
    const n = Number(raa);
    if (!Number.isFinite(n) || n <= loft) continue;
    violations.push(
      `tier ${tier}: ${n} kalenderdatoer i traek uden en traeningsdag (loft ${loft}) — §1e/#5267`,
    );
  }
  return violations;
}
