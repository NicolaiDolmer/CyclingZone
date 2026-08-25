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

// Saeson 0 er aabne-beta-fasens bogfoerings-saeson (0 loeb) og maa aldrig blive
// reference - samme diskriminator som #2763/#2600 (`number > 0`).
const usable = (r) => Number.isInteger(r?.number) && r.number > 0;

// naermeste = laveste nummer (den der kommer foerst), seneste = hoejeste.
const naermeste = (rows) => rows.reduce((a, b) => (b.number < a.number ? b : a));
const seneste = (rows) => rows.reduce((a, b) => (b.number > a.number ? b : a));

// Foerste status i `orden` der har mindst én raekke vinder. Flere aktive saesoner
// ville vaere en datafejl; vi tager den seneste og lader invariant-vagten
// (exactly_one_active_season) om at raabe op - vi gaetter ikke, vi vaelger stabilt.
function pick(rows, orden) {
  if (!Array.isArray(rows)) return null;
  const valid = rows.filter(usable);
  for (const status of orden) {
    const traef = valid.filter((r) => r.status === status);
    if (traef.length) return status === UPCOMING ? naermeste(traef) : seneste(traef);
  }
  return null;
}

/**
 * ALDERS-varianten: peger FREMAD. Til flader der viser hvad en rytter ER nu
 * (alder, U23/U25, pensionsrisiko).
 *
 * @param {Array<{number:number, status:string}>|null|undefined} rows
 * @returns {{number:number, status:string}|null} null naar intet kan afgoeres.
 */
export function pickReferenceSeason(rows) {
  return pick(rows, [ACTIVE, UPCOMING, COMPLETED]);
}

/** Saeson-NUMMERET fra samme praeference-raekkefoelge, eller null. */
export function pickReferenceSeasonNumber(rows) {
  return pickReferenceSeason(rows)?.number ?? null;
}

/**
 * #4225: RESULTAT-varianten: peger BAGUD. Til flader der viser hvad der ER sket
 * (ranglister, stillinger, resultatlister).
 *
 * Raekkefoelgen er bevidst den OMVENDTE af alders-variantens: en kommende saeson
 * har per definition nul resultater, saa den maa aldrig vinde over en afsluttet
 * der faktisk har noget at vise. Ejer-beslutning 25/8: mellem to saesoner viser
 * ranglisten sidste afsluttede saeson, tydeligt maerket.
 *
 * `upcoming` er stadig med som sidste udvej, saa den foerste saeson nogensinde
 * giver et saesonnummer frem for null - en tom liste er en bedre tilstand end
 * en fejl.
 *
 * @param {Array<{number:number, status:string}>|null|undefined} rows
 * @returns {{number:number, status:string}|null}
 */
export function pickResultsSeason(rows) {
  return pick(rows, [ACTIVE, COMPLETED, UPCOMING]);
}
