// #4223: hvilken saeson er "den gaeldende" naar INGEN er aktiv?
//
// Rodaarsag (ejer 25/8: "Alderen bliver lige nu ikke vist korrekt paa rytterne"):
// hver eneste alders-flade spurgte paa `status='active'` og fik nul raekker i
// mellemrummet mellem to saesoner. Prod 25/8: S2 completed (sluttede 23/8), S3
// upcoming (starter 28/8) — ingen aktiv. riderAge.js's kontrakt er "null frem
// for at gaette", saa alle ryttere viste "—", U23/U25-badget forsvandt og
// pensionsrisiko-advarslen paa bud blev tavs. Det er ikke en engangsfejl: hullet
// aabner ved hvert saesonskifte.
//
// Ejer-beslutning 25/8: i mellemrummet bruges den KOMMENDE saeson. Rytterne er
// allerede progresseret ind i den, det er cykelsportens egen konvention (alderen
// man fylder i saesonens kalenderaar), og tallet hopper derfor ikke naar
// saesonen taendes.
//
// Praeference-raekkefoelge: active → naermeste upcoming → seneste completed.
// Saeson 0 er aabne-beta-fasens bogfoerings-saeson (0 loeb) og maa aldrig blive
// reference — samme diskriminator som #2763/#2600 (`number > 0`).

const ACTIVE = "active";
const UPCOMING = "upcoming";
const COMPLETED = "completed";

function usable(row) {
  return Number.isInteger(row?.number) && row.number > 0;
}

/**
 * @param {Array<{number:number, status:string}>|null|undefined} rows
 * @returns {{number:number, status:string}|null} null naar intet kan afgoeres.
 */
export function pickReferenceSeason(rows) {
  if (!Array.isArray(rows)) return null;
  const valid = rows.filter(usable);
  if (!valid.length) return null;

  const active = valid.filter((r) => r.status === ACTIVE);
  // Flere aktive saesoner ville vaere en datafejl; tag den hoejeste og lad
  // invariant-vagterne om at raabe op — vi gaetter ikke, vi vaelger stabilt.
  if (active.length) return active.reduce((a, b) => (b.number > a.number ? b : a));

  // Naermeste kommende saeson = laveste nummer over 0.
  const upcoming = valid.filter((r) => r.status === UPCOMING);
  if (upcoming.length) return upcoming.reduce((a, b) => (b.number < a.number ? b : a));

  const completed = valid.filter((r) => r.status === COMPLETED);
  if (completed.length) return completed.reduce((a, b) => (b.number > a.number ? b : a));

  return null;
}

/** Saeson-NUMMERET fra samme praeference-raekkefoelge, eller null. */
export function pickReferenceSeasonNumber(rows) {
  return pickReferenceSeason(rows)?.number ?? null;
}

/**
 * #4225: RESULTAT-varianten. Til flader der viser hvad der ER sket (ranglister,
 * stillinger, resultatlister) frem for hvad der kommer.
 *
 * Praeferencen er bevidst den OMVENDTE af `pickReferenceSeason`: en kommende
 * saeson har per definition nul resultater, saa den maa aldrig vinde over en
 * afsluttet der faktisk har noget at vise. Ejer-beslutning 25/8: mellem to
 * saesoner viser ranglisten sidste afsluttede saeson, tydeligt maerket.
 *
 * `upcoming` er stadig med som sidste udvej, saa den foerste saeson nogensinde
 * giver et saesonnummer frem for null (en tom liste er en bedre tilstand end en
 * fejl).
 *
 * @param {Array<{number:number, status:string}>|null|undefined} rows
 * @returns {{number:number, status:string}|null}
 */
export function pickResultsSeason(rows) {
  if (!Array.isArray(rows)) return null;
  const valid = rows.filter(usable);
  if (!valid.length) return null;

  const active = valid.filter((r) => r.status === ACTIVE);
  if (active.length) return active.reduce((a, b) => (b.number > a.number ? b : a));

  const completed = valid.filter((r) => r.status === COMPLETED);
  if (completed.length) return completed.reduce((a, b) => (b.number > a.number ? b : a));

  const upcoming = valid.filter((r) => r.status === UPCOMING);
  if (upcoming.length) return upcoming.reduce((a, b) => (b.number < a.number ? b : a));

  return null;
}
