// #7003 (spec 2026-10-25-taktik-roller-design §3 + §7 variant A): ordrer der
// udelukker hinanden for samme rytter. Fladen spaerrer det modsatte valg graat
// med en kort linje, saa spilleren aldrig kan gemme noget serveren afviser.
//
// SSOT er backend/lib/raceTeamOrdersApi.js (oppositeOrderError). Denne kopi
// holdes lig af backend/lib/raceTeamOrdersApi.oppositeOrders7003.test.js.
//
//   Grupetto + Forsoeg udbrud     udelukket
//   Grupetto + Sprinttog          udelukket
//   Arbejd + Forsoeg udbrud       udelukket ("Arbejd" = protect for hjaelper/jaeger)
//   Sprinttog + Forsoeg udbrud    udelukket
//
// Kun det at slaa et valg TIL spaerres. Et valg der allerede staar (fx en gemt
// raekke fra foer reglen) kan altid slaas fra, saa spilleren selv vaelger hvilket.

const WORK_ROLES = new Set(["helper", "hunter"]);

// Toget virker kun for et hold med spurtkaptajn og aldrig for ham selv (motoren
// koerer intet tog uden kaptajn). Et doedt tog-flag spaerrer derfor intet, saa en
// gemt raekke aldrig laaser rytteren (#7281 review).
function liveLeadout(rider, role, opts) {
  return rider?.leadout === true && opts?.teamHasSprintCaptain !== false && role !== "sprint_captain";
}

/** Foerste modsaetning i en rytters ordre (serverens fejlkode), eller null. */
export function oppositeOrderError(rider, role, opts) {
  const tryBreak = rider?.try_break === true;
  const leadout = liveLeadout(rider, role, opts);
  if (rider?.effort === "grupetto" && tryBreak) return "team_orders_grupetto_with_break";
  if (rider?.effort === "grupetto" && leadout) return "team_orders_grupetto_with_train";
  if (rider?.effort === "protect" && tryBreak && WORK_ROLES.has(role ?? "")) return "team_orders_work_with_break";
  if (leadout && tryBreak) return "team_orders_train_with_break";
  return null;
}

/** Foerste rytter i ordren med en modsaetning: serverens fejlkode, eller null. */
export function firstOppositeOrderError(riders, roleFor, opts) {
  for (const r of riders ?? []) {
    const code = oppositeOrderError(r, roleFor(r?.rider_id), opts);
    if (code) return code;
  }
  return null;
}

/**
 * Hvorfor et valg ikke kan slaas til lige nu: i18n-noeglen til den korte linje
 * (races-namespace), eller null naar valget er frit. `choice` er "try_break",
 * "leadout" eller et indsatstrin ("grupetto", "protect", ...).
 * @param {string} choice
 * @param {{effort?: string, try_break?: boolean, leadout?: boolean}} state rytterens valg i dag
 * @param {string|null|undefined} role rytterens rolle paa etapen
 * @param {{teamHasSprintCaptain?: boolean}} [opts] holdet har en spurtkaptajn paa etapen
 */
export function blockedReasonKey(choice, state, role, opts) {
  const effort = state?.effort;
  const tryBreak = state?.try_break === true;
  const leadout = liveLeadout(state, role, opts);
  const works = WORK_ROLES.has(role ?? "");
  if (choice === "try_break") {
    if (tryBreak) return null;
    if (effort === "grupetto") return "tacticsOrders.blocked.notWithGrupetto";
    if (effort === "protect" && works) return "tacticsOrders.blocked.notWithWork";
    if (leadout) return "tacticsOrders.blocked.notWithTrain";
    return null;
  }
  if (choice === "leadout") {
    if (leadout || !liveLeadout({ leadout: true }, role, opts)) return null; // et doedt tog aendrer intet
    if (effort === "grupetto") return "tacticsOrders.blocked.notWithGrupetto";
    if (tryBreak) return "tacticsOrders.blocked.notWithBreak";
    return null;
  }
  if (choice === effort) return null;
  if (choice === "grupetto") {
    if (tryBreak) return "tacticsOrders.blocked.notWithBreak";
    if (leadout) return "tacticsOrders.blocked.notWithTrain";
    return null;
  }
  if (choice === "protect" && works && tryBreak) return "tacticsOrders.blocked.notWithBreak";
  return null;
}
