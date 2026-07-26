// #2863 — sæsonens bedste ryttere. Ren normalisering af det jsonb
// public.get_season_honours(p_season_id) leverer, holdt uden for React så
// tie-break og talbehandling kan testes med node --test uden DOM.
//
// To målinger (ejerens model, Discord 23/7): flest point og flest sejre. Begge
// tal kommer fra rider_rankings_mv, altså PRÆCIS de samme kolonner
// rytter-ranglisten har vist hele sæsonen (points + #925's "Sejre i alt" = de
// seks sejrs-kategorier lagt sammen). Optællingen må ikke regne anderledes end
// den liste spillerne har fulgt.
//
// Modulet navngiver bevidst INGENTING udadtil: det leverer tal og rækkefølge,
// og al player-facing copy bor i seasonEnd-namespacet. Derfor kunne
// verdensmester/europamester skiftes til "flest point"/"flest sejre"
// (ejer-beslutning 26/7) uden at røre en linje her.

// jsonb serialiserer bigint som streng gennem PostgREST. `Number(v) || 0` er
// derfor ikke pedanteri: uden den ville "28" > "9" sammenlignes som tekst og
// sortere forkert, og "4595" + "3861" ville blive strengsammensat i enhver
// senere sum. Samme coercion som useRiderRankings.js:17.
const num = (v) => Number(v) || 0;

export const HONOURS_CATEGORIES = ["points", "wins"];

/**
 * Én række fra RPC'ens to lister, i den form UI'et bruger.
 * @param {object} row
 * @param {number} index 0-baseret plads i listen
 */
function normalizeEntry(row, index) {
  const firstname = (row?.firstname || "").trim();
  const lastname = (row?.lastname || "").trim();
  return {
    rank: index + 1,
    riderId: row?.rider_id || null,
    // Ryttere uden navn findes ikke i praksis, men et tomt navn må aldrig blive
    // en tom celle uden forklaring øverst på listen.
    name: [firstname, lastname].filter(Boolean).join(" "),
    nationalityCode: row?.nationality_code || null,
    teamId: row?.team_id || null,
    teamName: row?.team_name || null,
    isAi: row?.is_ai === true,
    points: num(row?.points),
    wins: num(row?.wins),
  };
}

/**
 * @param {unknown} raw jsonb fra get_season_honours, eller null/fejlagtig form
 * @returns {{ points: Array, wins: Array }} altid to arrays, aldrig undefined
 */
export function normalizeHonours(raw) {
  const pick = (key) => (Array.isArray(raw?.[key]) ? raw[key] : []).map(normalizeEntry);
  return { points: pick("points"), wins: pick("wins") };
}

/**
 * Nr. 1 i en måling plus de øvrige på listen, og om toppen er delt.
 *
 * Hedder `topOf`/`leader` og IKKE `championOf`/`champion` med vilje: fladen
 * kårer ingen mester (ejer-beslutning 26/7), og et `champion` i koden ville
 * invitere den næste til at "genindføre" en titel der bevidst blev fravalgt.
 *
 * `shared` er ikke hypotetisk: sæson 1 sluttede med Jakub Adamczyk og George
 * Whitfield på 28 sejre hver. Tie-breaket (flest point) afgør rækkefølgen, men
 * UI'et skal kunne sige det højt i stedet for at lade nr. 2 undre sig over
 * hvorfor det samme tal gav to forskellige placeringer.
 *
 * @param {Array} entries normaliseret liste (allerede sorteret af serveren)
 * @param {"points"|"wins"} metric
 */
export function topOf(entries, metric) {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length === 0) return { leader: null, runnersUp: [], shared: false };
  const [leader, ...runnersUp] = list;
  const shared = runnersUp.some((e) => e[metric] === leader[metric]);
  return { leader, runnersUp, shared };
}

/**
 * PostgREST svarer PGRST202 (og Postgres 42883) når funktionen ikke findes.
 * Migrationen applies EFTER merge OG efter cutoveren (ejer-beslutning 26/7), så
 * i vinduet imellem skal siden bare undlade at vise blokken. Enhver ANDEN fejl
 * er ægte og skal vises som en fejl-tilstand, ikke skjules: en tom liste der ser
 * bevidst ud er værre end en synlig fejl (#1851-klassen).
 */
export function isMissingFunctionError(error) {
  if (!error) return false;
  const code = String(error.code || "");
  if (code === "PGRST202" || code === "42883") return true;
  const message = String(error.message || "").toLowerCase();
  return message.includes("could not find the function")
    || message.includes("does not exist");
}
