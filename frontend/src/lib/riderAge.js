// Fælles alders-helpers for ryttere. U23/U25-badge-tieren OG U25-filteret afledes
// RENT fra `birthdate` (single source of truth), så alderen ikke kan divergere.
// Det lagrede `riders.is_u25`-flag er statisk (DEFAULT FALSE, re-deriveres aldrig)
// og bruges IKKE længere som badge- eller filter-kilde (#109/#2073) — kun birthdate.
//
// Badge-beslutning (#837, ejer 31. maj): vis kun den yngste gældende —
//   alder < 23 → "u23"
//   alder 23–24 → "u25"
//   alder ≥ 25 → ingen alders-badge (aldrig begge på samme rytter).

// Sæson-alder = referenceåret − fødselsår (cykelsport-konvention: alderen en
// rytter FYLDER i sæsonens kalenderår, uafhængigt af fødselsdag). Referenceåret
// er sæsonens år (fx `seasons.start_date`s år) — IKKE dags dato. Det gør U23/U25-
// gaten sæson-drevet i stedet for wall-clock-drevet (#2032/#109/#2073): en rytter
// skifter alders-tier ved sæsonskift, ikke midt i en sæson på sin fødselsdag.
// Returnerer null ved manglende fødselsdato eller ugyldigt referenceår.
export function ageForSeason(birthdate, seasonYear) {
  if (!birthdate || !Number.isFinite(seasonYear)) return null;
  const birthYear = new Date(birthdate).getFullYear();
  if (!Number.isFinite(birthYear)) return null;
  return seasonYear - birthYear;
}

// Alder i hele år baseret på fødselsår (samme formel som rytter-filtrene).
// Wall-clock-varianten: referenceår = `now`s kalenderår. Nye kald bør bruge
// `ageForSeason(birthdate, seasonYear)` direkte hvor sæson-året kendes.
export function getRiderAge(birthdate, now = new Date()) {
  return ageForSeason(birthdate, now.getFullYear());
}

// U23-grænse som ÉN kilde til sandhed (#42): en rytter er U23 ved alder < 23
// (dvs. ≤22 år) — præcis samme grænse som u23-badge nedenfor. Bruges af
// rytter-filtrene (useRiderFilters) så filter + badge aldrig divergerer; en
// 23-årig bærer u25-badge og må derfor ikke matche U23. Returnerer false ved
// manglende fødselsdato (kan ikke bekræftes som U23). `now` defaulter til dags
// dato (wall-clock); kaldere med sæson-kontekst kan give et fast referenceår
// (fx `new Date(Date.UTC(seasonYear, 0, 1))`) så gaten følger sæsonen.
export function isU23(birthdate, now = new Date()) {
  const age = getRiderAge(birthdate, now);
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
// ind i badges-arrayet: badges={[ageBadgeKey(rider), ...]}.
export function ageBadgeKey(rider, now = new Date()) {
  const age = getRiderAge(rider?.birthdate, now);
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
const RETIREMENT_WINDOW_START_AGE = 36;
const RETIREMENT_NOTICE_SEASONS = 1;
export const RETIREMENT_WARNING_AGE = RETIREMENT_WINDOW_START_AGE - RETIREMENT_NOTICE_SEASONS; // 35

// True når rytteren er gammel nok til at pensionsrisikoen bør vises til en
// potentiel køber (alder ≥ RETIREMENT_WARNING_AGE). Bruger samme wall-clock
// alders-konvention som getRiderAge (matcher den øvrige auktions-UI, der også
// viser rå kalenderårs-alder, ikke sæson-alder).
export function isRetirementRisk(birthdate, now = new Date()) {
  const age = getRiderAge(birthdate, now);
  return age != null && age >= RETIREMENT_WARNING_AGE;
}

// Badge-nøgle til RiderBadges (uafhængig af ageBadgeKey — en rytter kan aldrig
// ramme begge, men de er separate klassifikationer og bør ikke deles ind i ét
// gensidigt udelukkende felt). Returnerer null ved manglende fødselsdato.
export function retirementRiskBadgeKey(rider, now = new Date()) {
  return isRetirementRisk(rider?.birthdate, now) ? "retireRisk" : null;
}
