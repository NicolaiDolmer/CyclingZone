// backend/lib/seasonLookup.js
// #4270/#4557: EEN kontrakt for "findes den naeste saeson?".
//
// HVORFOR DEN FINDES. Aarsmoedet (bestyrelsens mandat for naeste saeson) slaar den
// KOMMENDE saeson op paa `number` og springer holdet over hvis raekken mangler
// (boardMandateEngine.js's proposeNextMandate → `skipped: "target_season_not_found"`).
// Saa laenge der ikke findes en raekke for saeson 4, faar INTET hold et mandat — uden at
// noget fejler hoejlydt. Samtidig opretter buildSeasonCalendar.js kun saeson-raekken i
// sin --apply-sti. De to fakta moedes i EEN konsekvens der er let at overse:
// kalender-dry-runnet kan vaere helt groent samtidig med at aarsmoedet er doedt.
//
// KONTRAKTEN, ordret: opslaget filtrerer PAA `number` OG IKKE PAA `status`. En raekke med
// status 'upcoming' er derfor NOK — den behoever ikke vaere 'active'. Det er praecis dét
// der goer det sikkert at pre-oprette saeson 4 laenge foer cutoveren:
// seasonTransition.js's insertSeasonIfMissing promoverer selv 'upcoming' → 'active'
// (og kolliderer altsaa ikke med en pre-oprettet raekke).
//
// Ren I/O-funktion: kun .select(), aldrig en skrivning. Testet i seasonLookup.test.js
// med en stub-supabase, saa kontrakten er laast uden at der skal en database til.

/**
 * Slå EN sæson op på dens nummer. Ingen status-filtrering — se fil-docstringen.
 *
 * @param {{supabase:object, number:number, columns?:string}} args
 * @returns {Promise<{found:boolean, season:object|null, number:number}>}
 */
export async function findSeasonByNumber({ supabase, number, columns = "id, number, status, start_date" } = {}) {
  if (!supabase) throw new Error("findSeasonByNumber: supabase kræves");
  const seasonNumber = Number(number);
  if (!Number.isFinite(seasonNumber)) return { found: false, season: null, number: seasonNumber };

  const { data, error } = await supabase
    .from("seasons")
    .select(columns)
    .eq("number", seasonNumber)
    .maybeSingle();
  if (error) throw new Error(`seasons lookup failed: ${error.message}`);
  return { found: Boolean(data?.id), season: data ?? null, number: seasonNumber };
}

/**
 * Sæsonen EFTER `currentNumber` — dén årsmødet skriver mandater til.
 *
 * @param {{supabase:object, currentNumber:number, columns?:string}} args
 * @returns {Promise<{found:boolean, season:object|null, number:number}>}
 */
export async function findNextSeason({ supabase, currentNumber, columns } = {}) {
  const current = Number(currentNumber);
  if (!Number.isFinite(current)) throw new Error("findNextSeason: currentNumber skal være et tal");
  return findSeasonByNumber({ supabase, number: current + 1, columns });
}
