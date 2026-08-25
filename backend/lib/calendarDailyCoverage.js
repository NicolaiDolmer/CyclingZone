// backend/lib/calendarDailyCoverage.js
// #4215 — "løb hver kalenderdag" som gate, ikke som hensigt.
//
// EJER-DIREKTIV 25/8, ordret:
//   "Jeg vil ikke have dage uden løb. I den nye sæson skal der være løb hver dag."
//
// Reglen gælder KALENDERDAGE (scheduled_at), ikke løbsdage (game_day), og den gælder
// PR. DIVISION. En spiller i Division 4 skal have noget at se på hver eneste dag — det
// hjælper ham ikke at Division 1 kører. Det er præcis den fælde en global optælling
// falder i: spillet som helhed har løb hver dag længe før D4 har.
//
// HVORFOR DEN FINDES. Da sæsonstarten blev udskudt fra 25/8 til 28/8 med uændret
// slutdato 27/9, gik regnestykket fra 27 til 31 kalenderdage. D4 havde 29 løbsdage
// over 27 kalenderdage (1,07/dag) — spredt over 31 ville den have haft 2 tomme dage.
// Uden denne gate ville det først være opdaget af en spiller midt i sæsonen.
//
// SAMME FEJLKLASSE SOM #4155/#4161: en regel der kun levede som en konstant pakkeren
// FORSØGTE at ramme, og derfor blev brudt uden at nogen opdagede det. Gaten skal køre
// tre steder (#4176 §9): i CI mod pakkerens output, i preflighten før en ny kalender
// går live, og i verify-invariants mod prod.
//
// REN + deterministisk: ingen DB, ingen Date.now(), ingen random. Kalderen leverer
// datoerne som "YYYY-MM-DD"-strenge i dansk tid (copenhagenDateString).
//
// Refs #4215 #4176 #4131 #4155 #4161

/**
 * Alle datoer fra og med `from` til og med `to`, som "YYYY-MM-DD".
 * Rent streng-/UTC-regnestykke: en dato-streng mappes til UTC-midnat, hvor et døgn
 * altid er præcis 86.400.000 ms. Derfor er funktionen DST-immun — vi regner aldrig
 * i lokal tid, kun i kalenderdatoer.
 * @param {string} from "YYYY-MM-DD"
 * @param {string} to "YYYY-MM-DD"
 * @returns {string[]}
 */
export function calendarDateRange(from, to) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const out = [];
  for (let ms = start; ms <= end; ms += 86_400_000) {
    out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Find de kalenderdage hvor en division ingen løb har.
 *
 * @param {object} args
 * @param {Array<{division: number|string, date: string}>} args.stageDays
 *   Én række pr. (division, kalenderdato) der HAR mindst én etape. Dubletter er tilladt.
 * @param {string} args.from Første kalenderdato i sæsonen, "YYYY-MM-DD".
 * @param {string} args.to Sidste kalenderdato i sæsonen, "YYYY-MM-DD".
 * @param {Array<number|string>} [args.divisions] Divisioner der SKAL dækkes. Udelades
 *   den, udledes listen af stageDays — men så kan en division der mangler HELT ikke
 *   opdages, så preflight/verify bør altid sende den eksplicit.
 * @returns {{ok: boolean, violations: string[], emptyByDivision: Map<string, string[]>}}
 */
export function detectEmptyCalendarDays({ stageDays = [], from, to, divisions } = {}) {
  const allDates = calendarDateRange(from, to);
  if (!allDates.length) {
    return {
      ok: false,
      violations: [`#4215: ugyldigt datointerval ${from}..${to}`],
      emptyByDivision: new Map(),
    };
  }

  const seen = new Map(); // division -> Set(dato)
  for (const row of stageDays) {
    const div = String(row?.division ?? "");
    const date = row?.date;
    if (!div || typeof date !== "string") continue;
    if (!seen.has(div)) seen.set(div, new Set());
    seen.get(div).add(date);
  }

  const wanted = (divisions ?? [...seen.keys()]).map((d) => String(d));
  const violations = [];
  const emptyByDivision = new Map();

  for (const div of wanted) {
    const have = seen.get(div) ?? new Set();
    const empty = allDates.filter((d) => !have.has(d));
    if (empty.length) {
      emptyByDivision.set(div, empty);
      // Vis højst 5 datoer i beskeden — en division der mangler HELT ville ellers
      // producere 31 datoer i én linje og drukne de øvrige fund.
      const shown = empty.slice(0, 5).join(", ");
      const more = empty.length > 5 ? ` (+${empty.length - 5} flere)` : "";
      violations.push(
        `#4215: division ${div} har ${empty.length} kalenderdag(e) uden løb: ${shown}${more}`
      );
    }
  }

  return { ok: violations.length === 0, violations, emptyByDivision };
}

/**
 * Mindste antal løbsdage en division skal have for at kunne dække `realDays`
 * kalenderdage. Trivielt lig realDays — men navngivet, fordi det er dét tal
 * kvoterne skal efterregnes mod FØR generering, ikke efter (#4215).
 * @param {number} realDays
 * @returns {number}
 */
export function minGameDaysForFullCoverage(realDays) {
  const n = Number(realDays);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0;
}
