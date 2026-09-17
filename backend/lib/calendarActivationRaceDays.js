// backend/lib/calendarActivationRaceDays.js
// ============================================================
// #5272 — LØBSDAGS-MÅLET for en pulje der aktiveres MIDT i sæsonen.
//
// FEJLEN (fundet som out-of-scope i #5169-lanen 15/9). Når signup-allokeringen vækker en
// sovende pulje, kalder `reconcilePoolCalendarOnActivation` materializeren for netop den
// tier — og har aldrig sagt noget om hvor lang puljens LØBSDAGS-akse (`game_day`) skal
// være. Aksens længde har derfor været et SØGERESULTAT: pakkeren fylder de resterende
// kalenderdage op mod overlap-cap'en og lander hvor den lander. Resultatet er en pulje
// hvis spillere får en anden udviklingstakt end alle andre i samme division — præcis den
// ulighed #4845 lukker for sæson-genereringen, men ad en bagdør ingen kiggede på.
//
// HVORFOR DET IKKE BARE ER "SÆSONENS MÅL". En pulje der vågner på dag 18 af 28 skal ikke
// have sæsonens fulde antal løbsdage presset ned i ti kalenderdage — den skal have DET
// DER ER TILBAGE af målet: sæsonens mål MINUS de løbsdage der allerede er afviklet. Det
// er et REMAINING-HORIZON-mål, og det er den eneste udgave der giver puljen samme takt
// som de øvrige divisioner uden at bryde §1's tæthed.
//
// HVOR MÅLET KOMMER FRA. To kilder, i den rækkefølge:
//
//   1. `seasonTarget` — et eksplicit tal fra kalderen. Det er hullet #4845/#5169's
//      `SEASON_RACE_DAY_TARGET` falder ned i, i ÉN linje, den dag PR #5169 lander.
//   2. MÅLT på de divisioner der allerede HAR en kalender i sæsonen: den længste akse
//      vinder. Samme fallback-præcedens som #5169's `resolveCommonRaceDayTarget`
//      ("højeste målte division"), og af samme grund: et gæt der ligger UNDER en
//      divisions naturlige antal kan ikke opnås ved at tilføje tomme løbsdage.
//
// Aksen MÅLES som `max(game_day) + 1` — §0b: databasen er 0-baseret. Det er dét tal en
// read-only måling mod DB kan komme frem til, og det er med vilje ikke `COUNT(DISTINCT
// game_day)`: en løbsdag uden løb (#4845's rene træningsdag) har ingen række i
// `race_stage_schedule` og ville forsvinde ud af en tælling.
//
// MÅLET OG DET AFVIKLEDE LÆSES AF SAMME DIVISION. Er sæsonens akser skæve (D1 80 mod D4
// 56, målt 11/9 — netop det #4845 er ved at rette), giver det ingen mening at tage målet
// fra den ene division og det afviklede fra den anden: de to tal ville være målt på hver
// sin skala. Den division der sætter målet, sætter også hvor langt sæsonen er nået.
//
// REN: ingen DB, intet ur, ingen tilfældighed. Refs #5272 #4845 #5169 #4270 #4192
// ============================================================

/**
 * Løbsdags-aksens længde og hvor langt den er afviklet, pr. division.
 *
 * @param {{stageRows?: Array<{league_division_id: number|string, game_day: number, scheduled_at: string}>,
 *   from?: Date|string|number}} args
 *   `from` = første kalenderdag den NYE pulje må bruge. Alt planlagt FØR det tidspunkt
 *   tæller som afviklet (eller i det mindste som uden for den nye puljes horisont).
 * @returns {Map<string, {axisLength: number, elapsedRaceDays: number, remainingRaceDays: number}>}
 *   nøglet på division-id som STRENG — id'er kommer fra DB som tal, men bruges som
 *   objekt-nøgler flere steder i kaldekæden, og en blandet Map ville tavst dublere dem.
 */
export function measureDivisionRaceDayAxes({ stageRows = [], from = null } = {}) {
  const grænse = from == null ? null : (from instanceof Date ? from.getTime() : Date.parse(String(from)));
  const perDivision = new Map();

  for (const row of stageRows) {
    const divId = row?.league_division_id;
    if (divId == null) continue;
    // NULL/"" SKAL afvises FØR Number(): `Number(null)` og `Number("")` er begge 0, så en
    // række uden game_day ville ellers snige sig ind som løbsdag 0 — og
    // `race_stage_schedule.game_day` kan være NULL i skemaet. Konsekvensen ville være
    // stille: en sådan række før `from` hæver elapsedRaceDays med 1 (et mål afkortet af en
    // løbsdag der aldrig blev kørt), og en division hvis rækker ALLE mangler game_day
    // ville få axisLength 1 og kunne sætte målet. Fanget af CodeRabbit 17/9.
    if (row.game_day == null || row.game_day === "") continue;
    const gd = Number(row.game_day);
    if (!Number.isInteger(gd) || gd < 0) continue;

    const nøgle = String(divId);
    if (!perDivision.has(nøgle)) perDivision.set(nøgle, { maxGameDay: -1, maxElapsedGameDay: -1 });
    const post = perDivision.get(nøgle);
    if (gd > post.maxGameDay) post.maxGameDay = gd;

    if (grænse != null && Number.isFinite(grænse)) {
      const t = Date.parse(String(row.scheduled_at));
      if (Number.isFinite(t) && t < grænse && gd > post.maxElapsedGameDay) post.maxElapsedGameDay = gd;
    }
  }

  const ud = new Map();
  for (const [nøgle, post] of perDivision) {
    const axisLength = post.maxGameDay + 1;
    const elapsedRaceDays = post.maxElapsedGameDay + 1;
    ud.set(nøgle, { axisLength, elapsedRaceDays, remainingRaceDays: Math.max(0, axisLength - elapsedRaceDays) });
  }
  return ud;
}

/**
 * Remaining-horizon-målet for en pulje der aktiveres midt i sæsonen.
 *
 * @param {{stageRows?: Array<object>, from?: Date|string|number, seasonTarget?: number|null,
 *   excludeDivisionId?: number|string|null}} args
 *   `excludeDivisionId` = den pulje der aktiveres. Den må aldrig være sin egen målestok;
 *   i praksis har den ingen rækker (reconcile's precheck), men en tidligere halvskrevet
 *   kalender må ikke kunne sætte målet ned.
 * @returns {{raceDayTarget: number|null, source: string, seasonRaceDayTarget: number|null,
 *   elapsedRaceDays: number, sourceDivisionId: string|null, axisSpread: number,
 *   axisByDivision: Record<string, number>}}
 *   `raceDayTarget` er null når intet mål kan afgøres (frisk sæson uden andre kalendere)
 *   ELLER når der ikke er noget tilbage af målet — i begge tilfælde skal kalderen lade
 *   være med at sende et mål videre, i stedet for at sende et gæt.
 */
export function resolveActivationRaceDayTarget({
  stageRows = [], from = null, seasonTarget = null, excludeDivisionId = null,
} = {}) {
  const alle = measureDivisionRaceDayAxes({ stageRows, from });
  const udeladt = excludeDivisionId == null ? null : String(excludeDivisionId);
  const målte = [...alle.entries()].filter(([nøgle, m]) => nøgle !== udeladt && m.axisLength > 0);

  const axisByDivision = Object.fromEntries(målte.map(([nøgle, m]) => [nøgle, m.axisLength]));
  const tom = {
    raceDayTarget: null, source: "ingen", seasonRaceDayTarget: null, elapsedRaceDays: 0,
    sourceDivisionId: null, axisSpread: 0, axisByDivision,
  };
  if (!målte.length) return tom;

  // Den takt-sættende division: længste akse, laveste id som stabilt tiebreak.
  const [sourceDivisionId, taktsætter] = målte
    .slice()
    .sort((a, b) => b[1].axisLength - a[1].axisLength || String(a[0]).localeCompare(String(b[0])))[0];

  const længder = målte.map(([, m]) => m.axisLength);
  const axisSpread = Math.max(...længder) - Math.min(...længder);

  const eksplicit = Number.isInteger(Number(seasonTarget)) && Number(seasonTarget) > 0 ? Number(seasonTarget) : null;
  const seasonRaceDayTarget = eksplicit ?? taktsætter.axisLength;
  const elapsedRaceDays = taktsætter.elapsedRaceDays;
  const rest = seasonRaceDayTarget - elapsedRaceDays;

  return {
    raceDayTarget: rest > 0 ? rest : null,
    source: eksplicit != null ? "eksplicit saeson-maal" : "hoejeste maalte division",
    seasonRaceDayTarget,
    elapsedRaceDays,
    sourceDivisionId: String(sourceDivisionId),
    axisSpread,
    axisByDivision,
  };
}
