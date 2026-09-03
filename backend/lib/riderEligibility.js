// backend/lib/riderEligibility.js
// #1800/#1742/#1823 Rod B: ÉN definition af "valgbar/løbs-berettiget rytter".
import { copenhagenDateString } from "./copenhagenTime.js";
//
// En rytter er løbs-berettiget for et hold når han: er på holdet (team_id matcher),
// IKKE er akademirytter (is_academy), og IKKE er pensioneret (is_retired). Tidligere
// var dette afgrænset tre+ steder med let forskellige filtre — generatoren og
// raceRunner-autofill manglede akademi-filteret, så akademiryttere kunne auto-vælges
// (264 i prod 2026-06-25). Samtidig blev committede race_entries aldrig krydset mod
// rytterens NUVÆRENDE tilstand, så en solgt/fyret/promoveret rytter hang ved som
// "ghost" i lineup (151 off-team i prod). Konsolidér her; brug ét sted.

// Påfør eligibility-filteret (akademi + pensioneret + ikke-under-handel) på en
// supabase-query. Team-afgrænsningen (.eq/.in på team_id) sættes af kalderen, da den
// varierer (ét hold vs. mange). Idempotent at kæde oven på en eksisterende query.
//   - is_academy: kun rene seniorryttere (akademiryttere er ikke løbs-berettigede, #1307/#1308).
//   - is_retired: null ELLER false (pensionerede udelades; null = aldrig sat = aktiv).
//   - pending_team_id: null (#2579 — en rytter der er SOLGT, men hvis fysiske
//     holdskifte er PARKERET pga. et aktivt etapeløb hos sælger (#1995), må ikke
//     kunne tilføjes en NY udtagelse hos sælgeren, mens handlen afventer flush.
//     team_id peger stadig på sælger i den periode (se stageRaceTransferDefer.js),
//     så uden dette filter ville han fremstå som en helt almindelig rosterrytter for
//     ALLE fremtidige løb — ikke kun det ene han allerede er låst i. Rytterens
//     eksisterende entry i det AKTIVE løb rammes ikke af dette filter (det er en
//     candidate-pool-gate til NY udtagelse, ikke et ghost-tjek på committede
//     entries — se isEligibleRider/filterEligibleEntries, som bevidst IKKE tjekker
//     pending_team_id, da de bruges til at validere det låste løbs EGNE entries).
export function applyRiderEligibilityFilter(query) {
  return query.eq("is_academy", false).or("is_retired.is.null,is_retired.eq.false").is("pending_team_id", null);
}

// Rent predikat: må `rider` køre for `teamId`? Bruges til at krydse committede
// race_entries mod rytterens nuværende tilstand (forbrugs-punkt-gyldighed), så en
// ghost (solgt/fyret/akademi/pensioneret EFTER udtagelse) falder ud uanset hvordan
// han forsvandt fra holdet. teamId udeladt → spring team-tjekket over (kun status).
// (#1994: loanedOutRiderIds-parametret fjernet — udlåns-featuren er afviklet.)
export function isEligibleRider(rider, { teamId = null } = {}) {
  if (!rider) return false;
  if (rider.is_academy === true) return false;
  if (rider.is_retired === true) return false;
  if (teamId != null && rider.team_id !== teamId) return false;
  return true;
}

// Frafiltrér ghost-entries: behold kun entries hvis rytter (a) findes i ridersById og
// (b) er berettiget for entry'ens eget team_id. ridersById = Map<rider_id, riderRow>
// med mindst { id, team_id, is_academy, is_retired }. En entry uden rytter-row
// droppes (slettet rytter). Pure + deterministisk; bevarer rækkefølgen.
// #4418: opdel "forsvundne" start-felt-ryttere efter aarsag. En rytter der er
// forsvundet fra et igangvaerende etapeloeb FORDI han er skadet, er taget ud helt
// bevidst (skadefilteret, #3896 — ejer-beslutning 30/8: skadet = kan ikke koere
// loeb). Den udtagelse skal registreres som en udgaaelse, saa spilleren kan se
// hvorfor rytteren er vaek, og saa advarslen ikke gentages paa hver resterende
// etape. Er han forsvundet af en ANDEN grund (solgt, akademi-kontrakt midt i
// loebet, pensioneret), er det stadig et uforklaret brud der skal blive ved med
// at larme — derfor to spande, ikke én.
//
// Ren + deterministisk; bevarer raekkefoelgen i `missing`.
//   missing            = rider_ids fra freezeEntrantsToStartField
//   injuredUntilByRider = Map<rider_id, injured_until|null>
export function partitionMissingByInjury({ missing = [], injuredUntilByRider, todayStr }) {
  const injured = [];
  const unexplained = [];
  for (const riderId of missing) {
    if (isRiderInjured(injuredUntilByRider?.get(riderId) ?? null, todayStr)) injured.push(riderId);
    else unexplained.push(riderId);
  }
  return { injured, unexplained };
}

export function filterEligibleEntries({ entries = [], ridersById }) {
  return entries.filter((e) =>
    isEligibleRider(ridersById.get(e.rider_id), { teamId: e.team_id }));
}

// #3896: ÉN definition af "er rytteren skadet på dato X". Skadesstatus (rider_condition.
// injured_until, en DATE-streng YYYY-MM-DD eller null) blev tidligere tjekket med let
// forskellige inline-udtryk mindst 5 steder (udtagelses-panel, udtagelses-endpointets
// auto-fyld-guard, race-motorens auto-pick/auto-fyld, generator-sweepet) — men ALDRIG
// mod committede manager-udtagne race_entries i selve motoren (se filterOutInjuredEntries
// nedenfor), så en rytter der udtoges rask og siden blev skadet FØR løbsstart alligevel
// kunne starte og score (Discord-bug 17/8, ez4prebren/Cooper Bennett). Skadet = injured_until
// sat OG >= dagen der tjekkes (samme dag tæller stadig som skadet — spejler #1306/#2637's
// oprindelige `>=`-semantik).
export function isRiderInjured(injuredUntil, todayStr) {
  return !!(injuredUntil && injuredUntil >= todayStr);
}

// #4701 (ejer-bekræftet 2/9, Discord-fund @jaxx_38086_92839): reference-DATO for
// "er rytteren skadet FOR DETTE LØB" — udtagelses-gaten (raceSelection.js,
// api.js' auto-udfyld/regenerer-endpoints) skal spørge på LØBETS egen startdato
// (races.scheduled_for — "løbets første stages scheduled_at", se
// raceCalendarScheduling.js), ikke "nu". Havde rytteren tidligere KUN "nu" som
// reference, blev en fremtidig udtagelse forkert afvist af en skade der udløber
// FØR løbet overhovedet starter — man skulle vente til han var rask i DAG, selv
// om løbet lå uger ude. max(i dag, løbsdato): scheduled_for kan mangle (kalender
// ikke materialiseret endnu) → falder tilbage til i dag; en løbsdato der (i et
// degenereret tilfælde) ligger FØR i dag må aldrig gøre en i dag rask rytter
// "skadet" igen — deraf max, ikke direkte scheduled_for.
export function raceSelectionReferenceDateStr(race, todayStr) {
  if (!race?.scheduled_for) return todayStr;
  const raceDateStr = copenhagenDateString(new Date(race.scheduled_for));
  return raceDateStr > todayStr ? raceDateStr : todayStr;
}

// SQL-siden af isRiderInjured: begræns en rider_condition-query til KUN skadede rækker
// pr. todayStr. Bruges hvor vi henter en kandidat-pool direkte fra DB i stedet for at
// hente alt og filtrere i app-koden (fx auto-pick/auto-fyld-kandidater).
export function applyInjuredFilter(query, todayStr) {
  return query.gte("injured_until", todayStr);
}

// Frafiltrér skadede committede entries: rytteren ER på holdet/berettiget (allerede
// passeret filterEligibleEntries), men er skadet på dagen motoren bygger startfeltet.
// injuredUntilByRider = Map<rider_id, injured_until|null>. Adskilt fra filterEligibleEntries
// fordi skadestjekket er tidsafhængigt (kræver todayStr) og har sin egen bug-historik —
// #2637 dækkede kun auto-fyld/auto-pick-kandidatpuljer, aldrig manager-committede entries.
export function filterOutInjuredEntries({ entries = [], injuredUntilByRider, todayStr }) {
  return entries.filter((e) => !isRiderInjured(injuredUntilByRider.get(e.rider_id) ?? null, todayStr));
}
