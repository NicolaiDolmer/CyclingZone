// backend/lib/riderEligibility.js
// #1800/#1742/#1823 Rod B: ÉN definition af "valgbar/løbs-berettiget rytter".
//
// En rytter er løbs-berettiget for et hold når han: er på holdet (team_id matcher),
// IKKE er akademirytter (is_academy), og IKKE er pensioneret (is_retired). Tidligere
// var dette afgrænset tre+ steder med let forskellige filtre — generatoren og
// raceRunner-autofill manglede akademi-filteret, så akademiryttere kunne auto-vælges
// (264 i prod 2026-06-25). Samtidig blev committede race_entries aldrig krydset mod
// rytterens NUVÆRENDE tilstand, så en solgt/fyret/promoveret rytter hang ved som
// "ghost" i lineup (151 off-team i prod). Konsolidér her; brug ét sted.

// Påfør eligibility-filteret (akademi + pensioneret) på en supabase-query. Team-
// afgrænsningen (.eq/.in på team_id) sættes af kalderen, da den varierer (ét hold
// vs. mange). Idempotent at kæde oven på en eksisterende query.
//   - is_academy: kun rene seniorryttere (akademiryttere er ikke løbs-berettigede, #1307/#1308).
//   - is_retired: null ELLER false (pensionerede udelades; null = aldrig sat = aktiv).
export function applyRiderEligibilityFilter(query) {
  return query.eq("is_academy", false).or("is_retired.is.null,is_retired.eq.false");
}

// Rent predikat: må `rider` køre for `teamId`? Bruges til at krydse committede
// race_entries mod rytterens nuværende tilstand (forbrugs-punkt-gyldighed), så en
// ghost (solgt/fyret/akademi/pensioneret EFTER udtagelse) falder ud uanset hvordan
// han forsvandt fra holdet. teamId udeladt → spring team-tjekket over (kun status).
//
// loanedOutRiderIds (Set, valgfri): rytter-id'er der lige nu er UDLÅNT (aktiv
// loan_agreements). En udlånt rytter beholder sit ejer-holds team_id, men kører for
// låneren — derfor er han IKKE valgbar for ejeren (ellers tæller han som en fantom-
// rytter i ejerens trup-kapacitet og kan dobbelt-feltes). Ekskludér ham overalt.
export function isEligibleRider(rider, { teamId = null, loanedOutRiderIds = null } = {}) {
  if (!rider) return false;
  if (rider.is_academy === true) return false;
  if (rider.is_retired === true) return false;
  if (loanedOutRiderIds && loanedOutRiderIds.has(rider.id)) return false;
  if (teamId != null && rider.team_id !== teamId) return false;
  return true;
}

// Frafiltrér ghost-entries: behold kun entries hvis rytter (a) findes i ridersById og
// (b) er berettiget for entry'ens eget team_id og (c) ikke er udlånt. ridersById =
// Map<rider_id, riderRow> med mindst { id, team_id, is_academy, is_retired }.
// loanedOutRiderIds (Set, valgfri) = aktivt udlånte ryttere (ekskluderes). En entry
// uden rytter-row droppes (slettet rytter). Pure + deterministisk; bevarer rækkefølgen.
export function filterEligibleEntries({ entries = [], ridersById, loanedOutRiderIds = null }) {
  return entries.filter((e) =>
    isEligibleRider(ridersById.get(e.rider_id), { teamId: e.team_id, loanedOutRiderIds }));
}
