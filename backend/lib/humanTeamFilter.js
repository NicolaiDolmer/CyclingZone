// Kanonisk "rigtigt manager-hold"-diskriminator (#2852).
//
// Diskriminatoren har hidtil været kopieret som løse `.eq(...)`-kæder i ~20
// filer. Hver kopi kunne drive fra hinanden, og det gjorde de: notifikations-
// stien blev strammet i #2832 (fund 4), mens sæson-start-økonomien
// (buildTransitionPlan + processSeasonStart) stadig kørte med den forkortede
// `is_ai`/`is_frozen`-udgave. Resultatet var at de 3 test-konti ("Test A"/
// "Test B"/"Test Seller") fik sponsor-payout + payroll ved hvert sæsonskifte og
// forurenede `teams_affected`/`sponsor_base_total` i admin_log (153 hold i
// prod-dry-run mod korrekte 150; 159 mod 156 pr. 2026-07-25).
//
// Rod-årsagen er at der ikke fandtes ÉT sted at ændre. Nye kald skal bruge
// `applyHumanTeamFilter(query)` (Supabase-builder) eller `isHumanTeam(row)`
// (allerede-hentede rækker), så en fremtidig ændring af diskriminatoren rammer
// alle stier på én gang.
//
// Bemærk: `is_test_account` er NOT NULL DEFAULT false i skemaet, så `.eq(...,
// false)` er sikkert (ingen NULL-rækker at tabe). `is_ai`/`is_bank`/`is_frozen`
// er nullable med default false — de har alle rows sat i prod, og `.eq(...,
// false)` er den etablerede form i resten af motoren (boardWeekendFinalization,
// emitSeasonStartedNotifications), så vi bevarer den frem for at introducere en
// ny `.or()`-variant midt i transition-motoren.

/** Kolonner der tilsammen udgør "rigtigt menneske-manager-hold". */
export const HUMAN_TEAM_FLAGS = Object.freeze([
  "is_ai",
  "is_bank",
  "is_frozen",
  "is_test_account",
]);

/**
 * Påfør den fulde menneske-hold-diskriminator på en Supabase-query-builder.
 * Returnerer builderen, så kaldet kan kædes:
 *
 *   applyHumanTeamFilter(supabase.from("teams").select("id")).order("id")
 *
 * @template T
 * @param {T} query  Supabase-query-builder med .eq()
 * @returns {T}
 */
export function applyHumanTeamFilter(query) {
  let q = query;
  for (const flag of HUMAN_TEAM_FLAGS) {
    q = q.eq(flag, false);
  }
  return q;
}

/**
 * Samme diskriminator anvendt på en allerede-hentet team-række. Bruger `!== true`
 * så en NULL/undefined-kolonne tæller som "ikke sat" (= menneskehold), præcis som
 * boardWeekendUpdate.js gør det i dag.
 *
 * @param {{is_ai?:boolean|null, is_bank?:boolean|null, is_frozen?:boolean|null, is_test_account?:boolean|null}|null|undefined} team
 * @returns {boolean}
 */
export function isHumanTeam(team) {
  if (!team) return false;
  return HUMAN_TEAM_FLAGS.every((flag) => team[flag] !== true);
}
