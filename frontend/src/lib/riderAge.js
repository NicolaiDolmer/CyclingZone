// Fælles alders-helpers for ryttere. U23/U25-badge-tieren OG U25-filteret afledes
// RENT fra `birthdate` (single source of truth), så alderen ikke kan divergere.
// Det lagrede `riders.is_u25`-flag er statisk (DEFAULT FALSE, re-deriveres aldrig)
// og bruges IKKE længere som badge- eller filter-kilde (#109/#2073) — kun birthdate.
//
// Badge-beslutning (#837, ejer 31. maj): vis kun den yngste gældende —
//   alder < 23 → "u23"
//   alder 23–24 → "u25"
//   alder ≥ 25 → ingen alders-badge (aldrig begge på samme rytter).

// #3071: FRYSET SÆSON-ALDER-BUG. Frontend brugte wall-clock (`now.getFullYear()`)
// som alders-reference, mens backend (riderProgressionEngine.js:46) altid har
// brugt sæsonens år. De to formler gav samme tal i sæson 1 (launch-året) og
// divergerede usynligt derefter — en spiller opdagede det ved S1→S2-skiftet
// (ryttere ældedes i evner/værdi/pension, men ikke i UI'ets alders-tal/badges).
// LAUNCH_REFERENCE_YEAR ligger nu ÉT sted i frontenden (denne fil) — matcher
// backend/lib/riderProgressionEngine.js's konstant af samme navn. Al alders-
// beregning skal gå via `ageForSeason`/`seasonReferenceYear` med et eksplicit
// sæson-år — ALDRIG `new Date().getFullYear()`. Mangler en kalder sæson-året
// (fx en komponent der endnu ikke har hentet aktiv sæson), er kontrakten at
// give `null`/`undefined` videre: helperne herunder returnerer da `null` i
// stedet for at gætte med dags dato — en manglende alder er bedre end en forkert.
export const LAUNCH_REFERENCE_YEAR = 2026;

// #4455: fødselsåret læses ud af strengen, ikke af `new Date(bd).getFullYear()`.
// Dato-kun-strenge ("YYYY-MM-DD") parses som UTC-midnat, mens `getFullYear()`
// læser LOKAL tid — så vest for UTC ruller 1. januar et år tilbage og rytteren
// står et år for gammel. Backend kører i UTC og ejeren i Europe/Copenhagen, hvor
// det aldrig kunne ses, men DENNE fil kører i SPILLERENS browser: en manager i
// Amerika så en anden alder end backend regnede med på de 9 ryttere født 1/1.
// Præcis divergens-klassen #3071 kostede, blot i tidszone i stedet for wall-clock.
// Spejler backend/lib/riderSeasonAge.js's birthYearFrom() — ændres den ene, SKAL
// den anden med.
const DATE_ONLY = /^(\d{4})-\d{2}-\d{2}$/;

export function birthYearFrom(birthdate) {
  if (!birthdate) return null;
  const dateOnly = typeof birthdate === "string" ? DATE_ONLY.exec(birthdate.trim()) : null;
  if (dateOnly) return Number(dateOnly[1]);
  const year = new Date(birthdate).getFullYear();
  return Number.isFinite(year) ? year : null;
}

// seasonNumber → referenceår, SAMME formel som backend's ageForSeason
// (riderProgressionEngine.js:46: LAUNCH_REFERENCE_YEAR + (seasonNumber-1)).
// Bruges af useActiveSeasonYear (hooks/useActiveSeasonYear.js) til at omsætte
// den hentede `seasons.number` til det referenceår rytter-alder-helperne tager.
export function seasonReferenceYear(seasonNumber) {
  if (!Number.isFinite(seasonNumber)) return null;
  return LAUNCH_REFERENCE_YEAR + (seasonNumber - 1);
}

// #3097: inverse of seasonReferenceYear — season NUMBER from a season YEAR
// already resolved via useActiveSeasonYear. Exact by construction (the two
// formulas are inverses of each other), so pages that only fetched the
// reference year (for age display) can still recover the season NUMBER they
// need for contract-expiry comparisons (contract_end_season is a season
// number, not a year) without a second network round-trip. Returns null for
// a missing/invalid year (same null-over-guess contract as the rest of this file).
export function seasonNumberFromReferenceYear(seasonYear) {
  if (!Number.isFinite(seasonYear)) return null;
  return seasonYear - LAUNCH_REFERENCE_YEAR + 1;
}

// Sæson-alder = referenceåret − fødselsår (cykelsport-konvention: alderen en
// rytter FYLDER i sæsonens kalenderår, uafhængigt af fødselsdag). Referenceåret
// er sæsonens år (`seasonReferenceYear(seasonNumber)`) — IKKE dags dato. Det gør
// U23/U25-gaten sæson-drevet i stedet for wall-clock-drevet (#2032/#109/#2073/
// #3071): en rytter skifter alders-tier ved sæsonskift, ikke midt i en sæson på
// sin fødselsdag, og bliver ikke permanent hængende på launch-årets alder.
// Returnerer null ved manglende fødselsdato eller ugyldigt referenceår.
export function ageForSeason(birthdate, seasonYear) {
  if (!birthdate || !Number.isFinite(seasonYear)) return null;
  const birthYear = birthYearFrom(birthdate);
  if (birthYear === null) return null;
  return seasonYear - birthYear;
}

// Alder i hele år baseret på fødselsår og et EKSPLICIT sæson-referenceår (fra
// useActiveSeasonYear/seasonReferenceYear) — ren delegering til ageForSeason.
// #3071: der er IKKE længere en wall-clock-fallback. Kaldere uden kendt
// sæson-år skal give `null`/`undefined` videre og selv vise "—", ikke et
// gættet (og potentielt forkert) tal.
export function getRiderAge(birthdate, seasonYear) {
  return ageForSeason(birthdate, seasonYear);
}

// U23-grænse som ÉN kilde til sandhed (#42): en rytter er U23 ved alder < 23
// (dvs. ≤22 år) — præcis samme grænse som u23-badge nedenfor. Bruges af
// rytter-filtrene (useRiderFilters) så filter + badge aldrig divergerer; en
// 23-årig bærer u25-badge og må derfor ikke matche U23. Returnerer false ved
// manglende fødselsdato eller manglende sæson-år (kan ikke bekræftes som U23).
export function isU23(birthdate, seasonYear) {
  const age = getRiderAge(birthdate, seasonYear);
  return age != null && age < 23;
}

// U25-status afledt SÆSON-korrekt fra fødselsdato (#109/#2073): en rytter er U25
// når sæson-alderen (referenceåret − fødselsår) er < 25, dvs. født efter
// `seasonYear - 25` — præcis samme konvention som backend-generatoren
// (`birthYear > referenceYear - 25`) og import_riders.py. Erstatter det lagrede
// `is_u25`-flag som badge-/filter-kilde, så U25 ikke fryser ved oprettelse men
// følger sæsonen. Returnerer false ved manglende fødselsdato/ugyldigt referenceår.
export function isU25(birthdate, seasonYear) {
  const age = ageForSeason(birthdate, seasonYear);
  return age != null && age < 25;
}

// Returnér badge-nøglen for rytterens alders-tier, eller null. Nøglen er en
// gyldig RiderBadges-key ("u23"/"u25"), så kaldersiden kan sætte den direkte
// ind i badges-arrayet: badges={[ageBadgeKey(rider, seasonYear), ...]}.
export function ageBadgeKey(rider, seasonYear) {
  const age = getRiderAge(rider?.birthdate, seasonYear);
  if (age == null) return null;
  if (age < 23) return "u23";
  if (age < 25) return "u25";
  return null;
}

// #2943: pensions-risiko-badge på auktions-/budfladen + rytterprofilen. SSOT for
// selve pensions-vinduet er `backend/lib/riderProgression.js`
// PROGRESSION_CONFIG.retirement = { windowStartAge: 36, guaranteedAge: 40,
// noticeSeasons: 1 } — dupliceret her efter samme mønster som
// `backend/lib/squadRiskGuard.js` (ageForSeason/LAUNCH_REFERENCE_YEAR), for at
// undgå at frontend importerer et backend-modul. Varslet vises ÉT sæson-varsel
// (noticeSeasons=1) FØR selve vinduet — altså alder ≥ windowStartAge − 1 = 35,
// jf. #2943's egen ordlyd ("byde på 35+ ryttere") og #2700 (windowStartAge=36).
export const RETIREMENT_WINDOW_START_AGE = 36;
export const RETIREMENT_GUARANTEED_AGE = 40;
const RETIREMENT_NOTICE_SEASONS = 1;
export const RETIREMENT_WARNING_AGE = RETIREMENT_WINDOW_START_AGE - RETIREMENT_NOTICE_SEASONS; // 35

// True når rytteren er gammel nok til at pensionsrisikoen bør vises til en
// potentiel køber (alder ≥ RETIREMENT_WARNING_AGE). #3071: sæson-alder (samme
// referenceår-kontrakt som getRiderAge ovenfor), IKKE længere wall-clock — ellers
// matcher badget ikke den alder backend faktisk pensionerer rytteren ved.
export function isRetirementRisk(birthdate, seasonYear) {
  const age = getRiderAge(birthdate, seasonYear);
  return age != null && age >= RETIREMENT_WARNING_AGE;
}

// Badge-nøgle til RiderBadges (uafhængig af ageBadgeKey — en rytter kan aldrig
// ramme begge, men de er separate klassifikationer og bør ikke deles ind i ét
// gensidigt udelukkende felt). Returnerer null ved manglende fødselsdato/sæson-år.
export function retirementRiskBadgeKey(rider, seasonYear) {
  return isRetirementRisk(rider?.birthdate, seasonYear) ? "retireRisk" : null;
}

// #2700: bud-bekræftelses-advarsel (auktion/autobud/transfer) — samme SSOT-
// tærskler som badget ovenfor, men to-niveau i stedet for ét, fordi ejerens
// egen accept-kriterie (#2700-kommentar 22/7) kræver at teksten skelner
// mellem RISIKO (alder 35-39, seeded sandsynlighed) og SIKKER pension (alder
// ≥ guaranteedAge=40 — retirementDecision() i backend/lib/riderProgression.js
// returnerer altid retire:true derfra). Returnerer null under advarsels-
// alderen, ellers "risk" | "certain" til modal-copy-nøglen
// auctions:modal.retirementWarning.<tier>.
export function retirementBidWarningTier(birthdate, seasonYear) {
  const age = getRiderAge(birthdate, seasonYear);
  if (age == null || age < RETIREMENT_WARNING_AGE) return null;
  return age >= RETIREMENT_GUARANTEED_AGE ? "certain" : "risk";
}

// #3097: kontrakt-udløb-ved-næste-transition — SAMME regel som backend's
// squadRiskGuard.isContractExpiringAtTransition (contract_end_season <= den
// AKTIVE sæson, "<=" ikke "=", selv-helende for en oversprunget sæson). Dette
// er den ene af de to mekanikker squad-risk-spærren (#2748) tæller som
// "i risiko" — den anden er isRetirementRisk ovenfor. activeSeasonNumber er
// sæson-NUMMERET (ikke referenceåret ageForSeason bruger); se
// seasonNumberFromReferenceYear for at udlede det af useActiveSeasonYear's værdi.
export function isContractExpiringAtTransition(contractEndSeason, activeSeasonNumber) {
  if (contractEndSeason == null || !Number.isFinite(activeSeasonNumber)) return false;
  return Number(contractEndSeason) <= activeSeasonNumber;
}

// Badge-nøgle til RiderBadges, samme mønster som retirementRiskBadgeKey.
// Returnerer null ved manglende kontrakt (fri agent/akademi) eller manglende
// sæson-nummer.
export function contractExpiringBadgeKey(rider, activeSeasonNumber) {
  return isContractExpiringAtTransition(rider?.contract_end_season, activeSeasonNumber) ? "contractExpiring" : null;
}
