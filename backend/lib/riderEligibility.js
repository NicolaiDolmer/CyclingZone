// backend/lib/riderEligibility.js
// #1800/#1742/#1823 Rod B: ÉN definition af "valgbar/løbs-berettiget rytter".
import { copenhagenDateString } from "./copenhagenTime.js";
import { applySeniorSquadFilter, isSeniorSquadRider, isSquad, isYouthSquad, DEFAULT_SQUAD } from "./squads.js";
import { ageForSeason } from "./riderSeasonAge.js";

// #5645 (Y4, epic #2492): TRUP-parameteren. Hver funktion nedenfor tager en valgfri
// `squad` (løbets trup). Default "senior", så ALLE eksisterende kald er bit-identiske:
// senior-grenen er præcis den kode der stod her før (squads.applySeniorSquadFilter /
// isSeniorSquadRider). Et ungdomsløb (u23/junior) matcher KUN ryttere hvis
// `riders.squad` er løbets trup — aldrig en senior, og aldrig en rytter hvis squad-
// felt mangler i projektionen (fejl lukket: hellere et tomt ungdomsfelt end en
// senior i et U23-løb). Før riders.squad-backfill'en er kørt, har ingen rytter en
// ungdoms-squad, så ungdomsløb får et tomt felt — aldrig en forkert rytter.
//
// ANY_SQUAD: kun til BINDING (raceBinding.loadTeamBindingContext). En rytters
// committede entry binder hans løbsdag uanset hvilken trups løb den ligger i
// (YOUTH_RULES §2.2: "1 rytter = 1 løb pr. løbsdag", også på tværs af trupper).
export const ANY_SQUAD = "*";

// YOUTH_RULES §2.1: juniorer (sæsonalder 16-18) er løbsberettigede fra sæsonalder 17.
// Strukturregel (ikke et balance-tal), derfor ordret her og i YOUTH_RULES.
export const JUNIOR_MIN_RACE_AGE = 17;

// Løbets trup. Manglende/ukendt felt = senior (samme dom som squads.isSeniorSquadRow:
// en række uden `squad` i projektionen er per definition fra før trupperne).
export function raceSquadOf(race) {
  const squad = race?.squad;
  return isYouthSquad(squad) ? squad : DEFAULT_SQUAD;
}

function assertKnownSquad(squad, fn) {
  if (!isSquad(squad)) {
    throw new TypeError(`${fn}: ukendt trup "${squad}" (forventet senior/u23/junior)`);
  }
}

// Alders-gaten for løbsudtagelse: kun juniorløb har en (sæsonalder >= 17). Alderen
// kommer fra riderSeasonAge.js (SSOT) og beregnes aldrig i SQL. Ukendt fødselsdato
// eller sæsonnummer → ikke berettiget (fejl lukket; ageForSeason gætter aldrig).
export function meetsSquadRaceAge({ squad = DEFAULT_SQUAD, birthdate = null, seasonNumber = null } = {}) {
  if (squad !== "junior") return true;
  const age = ageForSeason(birthdate, seasonNumber);
  return Number.isFinite(age) && age >= JUNIOR_MIN_RACE_AGE;
}

// Filtrér en kandidat-liste (rækker med `birthdate`) til dem der må køre løbets trup.
// No-op for senior og u23. Bevarer rækkefølgen.
export function filterSquadRaceAge(riders, { squad = DEFAULT_SQUAD, seasonNumber = null } = {}) {
  const list = Array.isArray(riders) ? riders : [];
  if (squad !== "junior") return list;
  return list.filter((r) => meetsSquadRaceAge({ squad, birthdate: r?.birthdate ?? null, seasonNumber }));
}
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
//   - trup: kun seniortruppen (ungdomsryttere er ikke løbs-berettigede, #1307/#1308).
//     Siden #4619 kommer det led fra squads.applySeniorSquadFilter, ikke fra en
//     lokal `.eq("is_academy", false)`.
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
//   - #5645: `squad` (default senior) vælger truppen, se ANY_SQUAD-headeren øverst.
//     Junior-aldersgaten (>= 17) kan ikke udtrykkes i SQL uden en kopi af
//     aldersformlen; kalderen kører filterSquadRaceAge på resultatet.
export function applyRiderEligibilityFilter(query, { squad = DEFAULT_SQUAD } = {}) {
  return applyRosterVisibilityFilter(query, { squad }).is("pending_team_id", null);
}

// #4119: SYNLIGHEDS-filteret — samme akademi/pensioneret-gate som ovenfor, men UDEN
// pending_team_id. En solgt rytter hvis holdskifte er parkeret (#1995/#2579) koerer
// stadig for saelgeren indtil loebet er koert; han skal derfor STAA i truppen paa de
// flader der viser "dine ryttere", bare markeret som udgaaende og uden at kunne
// udtages til NYE loeb. To spillere rapporterede 22/8 at han bare forsvandt.
//
// Regel: brug DETTE filter naar du VISER en trup. Brug applyRiderEligibilityFilter
// naar du afgoer hvem der maa UDTAGES/auto-udfyldes. De to spoergsmaal er ikke det
// samme, og de blev blandet sammen.
//
// #4619: trup-leddet kommer fra squads.js' `applySeniorSquadFilter` — ÉN definition
// af "seniortruppen", delt med markedet, vagterne og kontrakt-stierne. Se headeren
// dér for hvorfor prædikatet kræver BEGGE kolonner i overgangsperioden. Filteret her
// er uændret i adfærd indtil backfill'en af `riders.squad` er kørt.
//
// #5645: `squad` (default senior). Senior = uændret squads.applySeniorSquadFilter.
// Ungdom = `.eq("squad", <trup>)`: en ungdomsrytter har efter backfill'en squad =
// u23/junior (og is_academy = true); før backfill'en matcher intet, så et ungdomsløb
// aldrig kan få en senior ind ad denne vej.
export function applyRosterVisibilityFilter(query, { squad = DEFAULT_SQUAD } = {}) {
  assertKnownSquad(squad, "applyRosterVisibilityFilter");
  const scoped = squad === DEFAULT_SQUAD ? applySeniorSquadFilter(query) : query.eq("squad", squad);
  return scoped.or("is_retired.is.null,is_retired.eq.false");
}

// Rent predikat: må `rider` køre for `teamId`? Bruges til at krydse committede
// race_entries mod rytterens nuværende tilstand (forbrugs-punkt-gyldighed), så en
// ghost (solgt/fyret/akademi/pensioneret EFTER udtagelse) falder ud uanset hvordan
// han forsvandt fra holdet. teamId udeladt → spring team-tjekket over (kun status).
// (#1994: loanedOutRiderIds-parametret fjernet — udlåns-featuren er afviklet.)
// #4619: akademi-leddet er nu trup-leddet (squads.isSeniorSquadRider). Rækker SKAL
// projicere `squad` OG `is_academy` (squads.SENIOR_SQUAD_COLUMNS) — mangler `squad`,
// svarer prædikatet stadig som i dag, men bliver ikke korrekt efter backfill'en.
// #5645: `squad` (default senior) = løbets trup. Ungdom kræver rider.squad === trup
// (manglende felt = ikke berettiget). ANY_SQUAD springer trup-leddet over (binding).
export function isEligibleRider(rider, { teamId = null, squad = DEFAULT_SQUAD } = {}) {
  if (!rider) return false;
  if (squad === DEFAULT_SQUAD) {
    if (!isSeniorSquadRider(rider)) return false;
  } else if (squad !== ANY_SQUAD) {
    if (!isYouthSquad(squad) || rider.squad !== squad) return false;
  }
  if (rider.is_retired === true) return false;
  if (teamId != null && rider.team_id !== teamId) return false;
  return true;
}

// Frafiltrér ghost-entries: behold kun entries hvis rytter (a) findes i ridersById og
// (b) er berettiget for entry'ens eget team_id. ridersById = Map<rider_id, riderRow>
// med mindst { id, team_id, squad, is_academy, is_retired }. En entry uden rytter-row
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

export function filterEligibleEntries({ entries = [], ridersById, squad = DEFAULT_SQUAD }) {
  return entries.filter((e) =>
    isEligibleRider(ridersById.get(e.rider_id), { teamId: e.team_id, squad }));
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
