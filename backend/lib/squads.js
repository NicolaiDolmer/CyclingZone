// backend/lib/squads.js
// SSOT for TRUPPER (#4619, slice 1 af epic #2492). Bevidst DEPENDENCY-LET:
// importerer KUN riderSeasonAge.js, som selv er dependency-fri. Det er hele
// pointen — enhver konsument (lib, script, migration-hjælper, sim) skal kunne
// importere trup-reglerne uden at trække DB, fs eller notifikationer med, så
// ingen får en "god grund" til at kopiere aldersgrænserne. Præcis samme lektie
// som #3071/#3081 kostede på selve aldersformlen: en duplikat med en pæn
// begrundelse er stadig en duplikat.
//
// Aldersformlen bor ÉT sted: riderSeasonAge.js (`ageForSeason`,
// `ageForReferenceYear`, `LAUNCH_REFERENCE_YEAR`). Denne fil oversætter en
// SÆSONALDER til en trup — den regner aldrig selv en alder ud af en birthdate,
// og den må ALDRIG gøre det i SQL (spec §3.2).
//
// Regelkilde: docs/YOUTH_RULES.md §2.1 (trup-aldre), §2.2 (flyt + det tvungne
// valg rykker fra 22 til 23), §2.4 (loft pr. trup erstatter den flade 8-cap),
// og docs/superpowers/specs/2026-09-15-u23-kalender-og-trup-datamodel-design.md
// §3.2 + §10.6.
//
// #5517 (A2) tilføjer én import mere: racePoolCatalog.js, som selv er helt
// import-fri. Den bærer dommen "kolonnen squad findes ikke i databasen" (#5330),
// og liga-/løbs-scopet nederst i denne fil skal fælde nøjagtig samme dom — én
// kopi af den, ikke to.

import { ageForSeason, ageForReferenceYear } from "./riderSeasonAge.js";
import { isMissingSquadColumnError } from "./racePoolCatalog.js";

/** Trup-værdierne, ordnet fra yngst til ældst. Spejler CHECK-constrainten på
 *  `riders.squad` (database/2026-09-15-4619-riders-squad.sql). */
export const SQUADS = Object.freeze(["junior", "u23", "senior"]);

/** Default-truppen — kolonnens DEFAULT og den værdi enhver ukendt rytter får. */
export const DEFAULT_SQUAD = "senior";

/**
 * Øvre sæsonalder pr. ungdomstrup (ejer 2/9, YOUTH_RULES §2.1):
 *   Junior team  sæsonalder 16-18 — bliver han 19, skal han ud
 *   U23 team     sæsonalder 19-22 — bliver han 23, skal han ud
 *   Senior team  ingen øvre grænse
 * Grænserne er STRUKTURregler (ikke balance-følsomme tal) og står derfor ordret
 * både her og i YOUTH_RULES §2.1, hard rule 17.
 */
export const SQUAD_MAX_AGE = Object.freeze({ junior: 18, u23: 22, senior: null });

/**
 * Loft pr. trup — SIM-STARTPUNKT, ikke et endeligt balance-tal.
 *
 * U23 = 12: EJER-VALGT 15/9 2026 (spec §10.6, svar A): "U23 = 12 pladser som
 * SIM-STARTPUNKT (migration + dry-run-diff bygges på det), kalibreres efter S4's
 * første økonomidata sammen med facilitetstrinnene (D-032)."
 * Junior = 10: forslaget i YOUTH_RULES §2.4 / issue #4619, samme kalibrerings-
 * forbehold. Begge tal er GRUNDloftet: D-032 (ejer 10/9) siger samme grundloft
 * pr. trup for ALLE klubber, ekstra pladser købes som facilitetstrin med stigende
 * drift — aldrig af division, aldrig af resultater. Facilitetstrinnene findes
 * ikke endnu; når de gør, lægges de oven på disse tal, de erstatter dem ikke.
 *
 * Senior har bevidst INGEN værdi her: seniortruppens 30-cap kommer fra holdets
 * division (`squad_limits.max` via marketUtils.getTeamMarketState) og er uændret
 * (GAME_INVARIANTS.md). At lægge et tal for senior ind her ville skabe kopi nr.
 * to af den cap.
 */
export const SQUAD_CAPS = Object.freeze({ u23: 12, junior: 10 });

/**
 * Gyldig trup-værdi?
 * @param {unknown} squad
 * @returns {boolean}
 */
export function isSquad(squad) {
  return typeof squad === "string" && SQUADS.includes(squad);
}

/**
 * Er truppen en UNGDOMStrup (dvs. under akademi-paraplyen)?
 *
 * Dette er præcis det prædikat den gamle `riders.is_academy` bar: `is_academy`
 * bliver stående som afledt kolonne (`squad <> 'senior'`) i overgangsperioden,
 * fordi 35+ kaldsteder og RLS-funktionen `is_offered_intake_rider()` læser den
 * (spec §3.2). Skriv ALTID begge felter konsistent når squad sættes.
 *
 * @param {unknown} squad
 * @returns {boolean}
 */
export function isYouthSquad(squad) {
  return isSquad(squad) && squad !== "senior";
}

/**
 * Rytter-patch for "denne rytter lander i SENIORTRUPPEN" — begge trup-felter.
 *
 * Bruges af hver eneste sti der i dag flipper `is_academy: false` for at tage en
 * ungdomsrytter UD af akademiet: auktions-vinderen (#932), den garanterede
 * bank-handel (#932/#4495), ungdomsauktionens senior-placering (#2701), det
 * direkte transfersalg (#3650), byttehandlen (#2797) og beta-reset'ets
 * frigivelse til fri agent (#2264). De skrev tidligere KUN `is_academy`, og
 * efter backfill'en ville en solgt U23-rytter derfor blive liggende med
 * `squad = 'u23'`: `effectiveSquad()` læser `squad` FØRST og ville fortsat
 * kalde ham U23, og `countSquadMembers` tæller direkte på kolonnen, så han
 * optog en U23-plads på sit nye holds loft uden at være akademirytter.
 *
 * Den er bevidst en FUNKTION og ikke en frossen konstant: alle kaldsteder
 * spreder den ind i et større update-objekt, og en delt objekt-reference der
 * spredes ind i seks patches er præcis den slags fælde der ikke fejler i test.
 *
 * @returns {{squad:string, is_academy:boolean}}
 */
export function seniorSquadPatch() {
  return { squad: DEFAULT_SQUAD, is_academy: false };
}

/**
 * Truppen en rytter hører til ud fra sin SÆSONALDER (ikke wall-clock alder).
 *
 * junior ≤ 18 · u23 19-22 · senior ≥ 23.
 *
 * @param {number|null|undefined} seasonAge  sæsonalder fra riderSeasonAge.js
 * @returns {"junior"|"u23"|"senior"|null}  null ved manglende/ugyldig alder
 *          (aldrig et gæt — kalderen afgør selv hvad en ukendt fødselsdato skal
 *          betyde; backfill'en lader den blive i 'senior')
 */
export function squadForSeasonAge(seasonAge) {
  if (!Number.isFinite(seasonAge)) return null;
  if (seasonAge <= SQUAD_MAX_AGE.junior) return "junior";
  if (seasonAge <= SQUAD_MAX_AGE.u23) return "u23";
  return "senior";
}

/**
 * Truppen ud fra fødselsdato + sæsonnummer. Tynd delegering til SSOT'en, så
 * kalderen slipper for at kombinere to imports (og dermed slipper for fristelsen
 * til at skrive `year - birthYear` selv).
 *
 * @param {string|null|undefined} birthdate  "YYYY-MM-DD"
 * @param {number|null|undefined} seasonNumber  1-baseret sæsonnummer
 * @returns {"junior"|"u23"|"senior"|null}
 */
export function squadForSeason(birthdate, seasonNumber) {
  return squadForSeasonAge(ageForSeason(birthdate, seasonNumber));
}

/**
 * Truppen ud fra fødselsdato + kalenderår (referenceår). Samme delegering som
 * ageForReferenceYear — scripts og snapshots arbejder i årstal, ikke i
 * sæsonnumre.
 *
 * @param {string|null|undefined} birthdate  "YYYY-MM-DD"
 * @param {number|null|undefined} referenceYear
 * @returns {"junior"|"u23"|"senior"|null}
 */
export function squadForReferenceYear(birthdate, referenceYear) {
  return squadForSeasonAge(ageForReferenceYear(birthdate, referenceYear));
}

/**
 * Ungdomstruppen en AKADEMIRYTTER hører til ud fra sin sæsonalder.
 *
 * Forskellen fra squadForSeasonAge: en akademirytter der er fyldt 23 er IKKE
 * senior endnu — han er en U23-rytter der er vokset ud af sin trup og skal
 * igennem Graduation Day. Præcis backfill-reglen i spec §3.2 ("is_academy = true
 * OG sæsonalder ≤ 18 → junior; 19-22 → u23; ≥ 23 → u23 + pending graduation").
 *
 * @param {number|null|undefined} seasonAge
 * @returns {"junior"|"u23"|null}
 */
export function academySquadForSeasonAge(seasonAge) {
  const squad = squadForSeasonAge(seasonAge);
  if (squad === null) return null;
  return squad === "senior" ? "u23" : squad;
}

/**
 * Rytterens trup, robust i OVERGANGSPERIODEN mellem migration og backfill.
 *
 * Migrationen giver ALLE ryttere `squad = 'senior'` (kolonnens DEFAULT), og
 * backfill'en køres først efter ejer-go på dry-run-tallene. I det vindue er
 * `is_academy` stadig den kolonne der bærer sandheden. Enhver læsende sti skal
 * derfor spørge her og ikke direkte på `squad` — ellers holder graduerings-
 * detektionen og cap-tællingen op med at finde nogen som helst, tavst, indtil
 * backfill'en er kørt.
 *
 * Rækkefølgen er bevidst: en eksplicit ungdomstrup på rækken vinder altid; først
 * derefter falder vi tilbage på is_academy + alder.
 *
 * @param {{squad?:string, is_academy?:boolean}|null|undefined} rider
 * @param {number|null|undefined} seasonAge
 * @returns {"junior"|"u23"|"senior"|null}
 */
export function effectiveSquad(rider, seasonAge) {
  if (isYouthSquad(rider?.squad)) return rider.squad;
  if (rider?.is_academy === true) return academySquadForSeasonAge(seasonAge);
  if (isSquad(rider?.squad)) return rider.squad;
  return rider?.is_academy === false ? DEFAULT_SQUAD : null;
}

// ── Seniortruppens ÉNE prædikat (#4619, spec §5.1) ───────────────────────────
//
// Før denne slice spurgte hver eneste senior-læser selv: `.eq("is_academy", false)`
// i SQL, eller `rider.is_academy === true → ud` i JS. 12+ kaldsteder, hver med sin
// egen kopi: seniortrup-tællingen, senior-løbenes udtagelse, markedets cap-tal,
// kontrakt-udløb, de tre vagter, sæson-varslet og Discord-sweepet. Præcis den slags
// spredning der i #1307/#1308 lod 264 akademiryttere blive auto-udtaget til
// seniorløb, fordi ét af stederne manglede filteret. Herfra findes prædikatet ÉT
// sted, i to former (SQL + JS), og `seniorSquadFilterGuard.test.js` fælder enhver
// ny håndskrevet kopi.
//
// HVORFOR BEGGE KOLONNER, IKKE BARE `squad = 'senior'` [kritisk]
// Migrationen (database/2026-09-15-4619-riders-squad.sql) gav ALLE ryttere
// `squad = 'senior'` via kolonnens DEFAULT, og backfill'en er ejer-gated og IKKE
// kørt. I det vindue er `is_academy` fortsat den kolonne der bærer sandheden: en
// stor del af bestanden står som akademiryttere MED `squad = 'senior'`. Et naivt
// skifte til `.eq("squad", "senior")` alene ville derfor lukke hele den gruppe ind
// i seniortruppen, seniorløbene og markedet — en live-regression i samme klasse som
// #1307/#1308, bare den anden vej.
//
// Kravet til prædikatet er derfor DOBBELT:
//   1. I DAG (før backfill): bit-identisk med `is_academy = false`. Opfyldt fordi
//      `squad`-leddet er sandt for hver eneste række indtil backfill'en kører.
//   2. EFTER backfill: korrekt. En ungdomsrytter har da `squad <> 'senior'` OG
//      `is_academy = true`, og fanges af begge led.
// Spec §3.2 holder bevidst `is_academy` som afledt kolonne (`squad <> 'senior'`)
// netop for at gøre den dobbelte betingelse gyldig i hele overgangsperioden. Når
// backfill'en er kørt og verificeret, kan `is_academy`-leddet fjernes HER — ét sted.

/**
 * Kolonner en query SKAL projicere for at `isSeniorSquadRider` kan svare rigtigt.
 * Glemmer en kalder `squad`, falder prædikatet tavst tilbage på `is_academy`
 * alene — hvilket er korrekt i dag, men forkert efter backfill. Brug listen.
 * @type {readonly string[]}
 */
export const SENIOR_SQUAD_COLUMNS = Object.freeze(["squad", "is_academy"]);

/**
 * JS-siden: hører rækken til SENIORTRUPPEN?
 *
 * Bevidst formuleret som "ikke ungdom" og ikke som `squad === 'senior'`: rækker
 * hentet af ældre kaldsteder kan mangle `squad` i projektionen, og en manglende
 * kolonne må aldrig kunne gøre en helt almindelig seniorrytter usynlig (det ville
 * tømme startfelter). Mangler `squad`, bærer `is_academy` afgørelsen alene —
 * nøjagtig dagens adfærd. Er `squad` med, kan den kun gøre prædikatet STRENGERE.
 *
 * @param {{squad?:string, is_academy?:boolean}|null|undefined} rider
 * @returns {boolean}
 */
export function isSeniorSquadRider(rider) {
  if (!rider) return false;
  if (isYouthSquad(rider.squad)) return false;
  return rider.is_academy !== true;
}

/**
 * SQL-siden: begræns en supabase-query til seniortruppens rækker.
 *
 * Kæd den ind i stedet for `.eq("is_academy", false)`. Idempotent at kæde oven på
 * en eksisterende query; kalderen sætter selv team-afgrænsning, pensionerings-
 * filter og øvrige led.
 *
 * @template T
 * @param {T} query  supabase/PostgREST query-builder
 * @returns {T}
 */
export function applySeniorSquadFilter(query) {
  return query.eq("squad", DEFAULT_SQUAD).eq("is_academy", false);
}

/**
 * Pladsloftet for en trup, eller `null` hvis truppen ikke har et eget loft
 * (senior styres af divisionens `squad_limits.max`).
 *
 * @param {string} squad
 * @returns {number|null}
 */
export function capForSquad(squad) {
  if (!isSquad(squad)) return null;
  return Object.prototype.hasOwnProperty.call(SQUAD_CAPS, squad) ? SQUAD_CAPS[squad] : null;
}

/**
 * Er truppen fuld hvis vi lægger `adding` ryttere til en nuværende bestand på
 * `currentCount`? En trup UDEN eget loft (senior) er aldrig "fuld" efter denne
 * funktion — den cap håndhæves et andet sted og må ikke duplikeres her.
 *
 * @param {{squad:string, currentCount:number, adding?:number}} args
 * @returns {boolean}
 */
export function wouldExceedSquadCap({ squad, currentCount, adding = 1 } = {}) {
  const cap = capForSquad(squad);
  if (cap === null) return false;
  return Number(currentCount ?? 0) + Number(adding) > cap;
}

// ── Graduering: de TO overgange (YOUTH_RULES §2.1 + §2.2) ────────────────────
//
// Tidligere fandtes ÉN overgang: akademi → senior ved sæsonalder 22
// (`GRADUATION.GRADUATE_AGE`). Med tre trupper er der to:
//
//   junior → u23   ved sæsonalder 19  (han er vokset ud af junior ved 18)
//   u23    → senior ved sæsonalder 23  (han er vokset ud af U23 ved 22)
//
// Bevidst REGELÆNDRING, ikke en bug-fix: YOUTH_RULES §2.2 "Det tvungne valg
// flytter fra 22 til 23" og §7 modsigelse 6. En 22-årig er stadig U23 (samme
// grænse som UCIs egen U23-kategori og `isU23ForSeason`).
export const SQUAD_TRANSITIONS = Object.freeze([
  Object.freeze({ from: "junior", to: "u23", atSeasonAge: SQUAD_MAX_AGE.junior + 1 }),
  Object.freeze({ from: "u23", to: "senior", atSeasonAge: SQUAD_MAX_AGE.u23 + 1 }),
]);

/**
 * Er rytteren vokset UD af sin trup i den givne sæson?
 *
 * Ét prædikat begge overgange deler, så sæson-transitionen, det løbende sweep og
 * en evt. vagt ikke kan blive uenige om hvem der skal flyttes (samme
 * "prædikatet låses sammen"-disciplin som academyGraduationPredicate.test.js).
 *
 * @param {{squad?:string|null, seasonAge?:number|null}} [args]
 * @returns {boolean}  false ved ukendt alder eller ukendt trup (aldrig et gæt)
 */
export function hasOutgrownSquad({ squad, seasonAge } = {}) {
  if (!isYouthSquad(squad) || !Number.isFinite(seasonAge)) return false;
  return seasonAge > SQUAD_MAX_AGE[squad];
}

/**
 * Overgangen en rytter skal igennem, eller `null` hvis han ikke er vokset ud.
 * Returnerer altid ÉT trin op — en 25-årig i junior-truppen (kun muligt via en
 * fejl eller et manuelt flyt) sendes til u23, ikke direkte til senior, så
 * default-kæden og Graduation Day behandler ham som en almindelig overgang.
 *
 * @param {{squad?:string|null, seasonAge?:number|null}} [args]
 * @returns {{from:string, to:string, atSeasonAge:number}|null}
 */
export function transitionForRider({ squad, seasonAge } = {}) {
  if (!hasOutgrownSquad({ squad, seasonAge })) return null;
  return SQUAD_TRANSITIONS.find((t) => t.from === squad) ?? null;
}

// ── Puljer og løb: seniorernes ÉNE scope (#5517, A2, spec §3.2 slice 2) ──────
//
// Efter A2 bærer `league_divisions` og `races` en `squad`-kolonne (TEXT NOT NULL
// DEFAULT 'senior', CHECK IN ('senior','u23','junior');
// database/2026-09-24-5517-squad-leagues-races-teams.sql). Ungdomspuljer og
// ungdomsløb bor i SAMME tabeller som seniorernes, og hver eneste læser der i dag
// lister "alle puljer" eller "alle sæsonens løb" til kalenderen, planlæggeren,
// udtagelsen, resultat-modulerne, AI-generatoren eller kalender-materializeren er
// en SENIORlæser. Uden scopet ville de i det øjeblik ungdomspuljerne seedes
// (C1 + ejer-go, ikke denne slice) fx vise U23-puljer i seniorkalenderens
// divisions-træ, oprette AI-hold i U23-puljer eller måle U23-aksen med, når en
// seniorpulje aktiveres midt i sæsonen.
//
// Scopet findes ÉT sted — withSeniorSquadScope — og squadSeniorReaders.test.js
// fælder enhver ny liste-læser der ikke går gennem det.
//
// FORSKELLEN TIL applySeniorSquadFilter (riders) [vigtig]
// Rytter-prædikatet kræver BÅDE squad og is_academy, fordi riders.squad-backfill'en
// er ejer-gated og ikke kørt. Puljer og løb har hverken is_academy eller en
// backfill: ALLE eksisterende rækker er 'senior' via kolonnens DEFAULT, og en
// ungdomsrække kan kun opstå ved en eksplicit seed. `squad = 'senior'` er derfor
// bit-identisk i dag OG korrekt efter seed — ét led er nok.
//
// KOLONNEN KAN MANGLE (auto-migrate-vinduet)
// auto-migrate.yml venter bevidst 3 minutter på deployet FØR den applier SQL'en,
// så den nye kode kører et øjeblik mod et skema uden `squad`. Postgres svarer da
// 42703 (undefined_column). Findes kolonnen ikke, kan ingen ungdomsrække findes, og
// samme læsning uden scope er per definition ren senior. Kun 42703 tæller — samme
// dom som race_pool-scopet (#5330, isMissingSquadColumnError): en PGRST204 /
// schema-cache-fejl beviser ikke at kolonnen mangler, og dér fejler vi lukket.
// Fallback'et caches ikke: næste kald prøver scopet igen.

/** Tabellerne hvis rækker har en trup og derfor et senior-scope (#5517). */
export const SQUAD_SCOPED_RELATIONS = Object.freeze(["league_divisions", "races"]);

/** Kolonnen scopet filtrerer på. */
export const SQUAD_COLUMN = "squad";

/**
 * JS-siden: er en pulje- eller løbsrække en SENIORrække?
 *
 * Manglende felt = senior (rækker hentet med en projektion uden `squad`, fixtures,
 * eller et skema fra før A2). Kun en eksplicit ungdomstrup gør rækken til ikke-senior,
 * så prædikatet aldrig kan tømme et seniorudvalg bare fordi en kolonne mangler.
 *
 * @param {{squad?:string|null}|null|undefined} row
 * @returns {boolean}
 */
export function isSeniorSquadRow(row) {
  if (row == null) return false;
  const squad = row[SQUAD_COLUMN];
  return squad == null || squad === DEFAULT_SQUAD;
}

/**
 * Filtrér en række-liste til seniorrækkerne. Tolerant over for null/undefined.
 * @template T
 * @param {T[]|null|undefined} rows
 * @returns {T[]}
 */
export function onlySeniorSquadRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter(isSeniorSquadRow);
}

/**
 * SQL-siden: begræns en `league_divisions`- eller `races`-query til seniorrækkerne.
 * Kæd den på builderen lige efter `.select(...)`. Brug den ikke direkte i en
 * læser — gå gennem withSeniorSquadScope, som også dækker auto-migrate-vinduet.
 *
 * @template T
 * @param {T} query  supabase/PostgREST query-builder
 * @returns {T}
 */
export function scopeToSeniorSquad(query) {
  return query.eq(SQUAD_COLUMN, DEFAULT_SQUAD);
}

const unscopedSquadQuery = (query) => query;

/**
 * Kør en liste-læsning af `league_divisions` eller `races` afgrænset til seniorerne.
 *
 * `run(senior)` bygger og kører læsningen og skal pakke builderen ind i `senior(...)`:
 *
 *   withSeniorSquadScope((senior) =>
 *     senior(supabase.from("league_divisions").select("id, tier")).order("tier"))
 *
 * `run` kaldes med scopet først. Svarer databasen 42703 på `squad` (kolonnen er
 * ikke migreret endnu), kaldes `run` én gang til med et identitets-scope. Begge
 * fejl-former håndteres: en returneret `{ data, error }` (almindelig builder) og en
 * kastet fejl (fetchAllRows/fetchAllRowsChunkedIn). Alt andet returneres/kastes
 * uændret, så kaldstedets egen fejlhåndtering virker som før.
 *
 * `run` SKAL bygge en frisk builder ved hvert kald (en PostgREST-builder er one-shot).
 *
 * @template R
 * @param {(senior: (query:any) => any) => (R|PromiseLike<R>)} run
 * @returns {Promise<R>}
 */
export async function withSeniorSquadScope(run) {
  if (typeof run !== "function") {
    throw new TypeError("withSeniorSquadScope: run must be a function that builds a fresh query");
  }
  let result;
  try {
    result = await run(scopeToSeniorSquad);
  } catch (err) {
    if (!isMissingSquadColumnError(err)) throw err;
    return run(unscopedSquadQuery);
  }
  if (result?.error && isMissingSquadColumnError(result.error)) return run(unscopedSquadQuery);
  return result;
}
