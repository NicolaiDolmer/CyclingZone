import test from "node:test";
import assert from "node:assert/strict";
import {
  getRiderAge, ageBadgeKey, isU23, isU25, ageForSeason, seasonReferenceYear,
  isRetirementRisk, retirementRiskBadgeKey, RETIREMENT_WARNING_AGE, LAUNCH_REFERENCE_YEAR,
  seasonNumberFromReferenceYear, isContractExpiringAtTransition, contractExpiringBadgeKey,
} from "./riderAge.js";

// #3071: sæson 1 (launch-året) = LAUNCH_REFERENCE_YEAR selv, så de fleste ældre
// tests (skrevet før sæson-migreringen) stadig kan bruge et fast "NOW"-lignende
// referenceår uden at ændre deres forventede tal.
const S1 = seasonReferenceYear(1); // 2026
const S2 = seasonReferenceYear(2); // 2027

test("seasonReferenceYear — LAUNCH_REFERENCE_YEAR + (seasonNumber-1), matcher backend-formlen", () => {
  assert.equal(LAUNCH_REFERENCE_YEAR, 2026);
  assert.equal(seasonReferenceYear(1), 2026);
  assert.equal(seasonReferenceYear(2), 2027);
  assert.equal(seasonReferenceYear(6), 2031);
});

test("seasonReferenceYear — null ved ugyldigt sæsonnummer", () => {
  assert.equal(seasonReferenceYear(null), null);
  assert.equal(seasonReferenceYear(undefined), null);
  assert.equal(seasonReferenceYear(NaN), null);
});

// ── #3071 rodårsag-bevis ──────────────────────────────────────────────────────
// Reported af thelamba i #general 27/7: "Rider aging didn't happen [...] I had
// a rider retire because he turned 40 (was 39 in season 1), but everyone else
// are same age it seems." Backend ældede korrekt (ageForSeason i
// riderProgressionEngine.js); frontend brugte wall-clock og forblev på sæson 1's
// alder. Denne test beviser buggen: en rytter født 1996 SKAL vises som 31 år i
// sæson 2 (2027-basis), ikke 30 (2026-basis, hvor S1 og wall-clock tilfældigvis
// gav samme tal). Fejlede på `main` FØR migreringen til sæson-år (getRiderAge
// tog dengang en wall-clock `now`-parameter, ikke et sæson-referenceår).
test("#3071 — getRiderAge følger SÆSON-året, ikke launch-årets fastfrosne alder", () => {
  const birthdate = "1996-03-10";
  assert.equal(getRiderAge(birthdate, S1), 30, "sæson 1: 2026 - 1996 = 30");
  assert.equal(getRiderAge(birthdate, S2), 31, "sæson 2: 2027 - 1996 = 31 — IKKE stadig 30");
});

test("#3071 — U23/U25-badge følger sæsonskiftet (en 22-årig i S1 kan være 23 i S2)", () => {
  // Født 2004: 22 år i S1 (2026, u23-badge) → 23 år i S2 (2027, u25-badge).
  // Under wall-clock-buggen forblev badget "u23" for evigt efter launch.
  const rider = { birthdate: "2004-01-01" };
  assert.equal(ageBadgeKey(rider, S1), "u23");
  assert.equal(ageBadgeKey(rider, S2), "u25");
});

test("#3071 — pensionsrisiko-badget matcher backends pensions-alder på tværs af sæsoner", () => {
  // Født 1991: 35 år (RETIREMENT_WARNING_AGE) først i S1 — samme rytter er 36
  // (windowStartAge) i S2. Begge sæsoner skal give risiko-badge; wall-clock-
  // buggen ville stadig vise "34 år, ingen risiko" i S2 i en langsommere
  // real-verden-kalender end spillets sæsonoptælling.
  const rider = { birthdate: "1991-01-01" };
  assert.equal(getRiderAge(rider.birthdate, S1), 35);
  assert.equal(getRiderAge(rider.birthdate, S2), 36);
  assert.equal(retirementRiskBadgeKey(rider, S1), "retireRisk");
  assert.equal(retirementRiskBadgeKey(rider, S2), "retireRisk");
});

// ── getRiderAge/ageForSeason — kernekontrakt ─────────────────────────────────
test("getRiderAge — alder = referenceår minus fødselsår, null ved manglende fødselsdato/sæson-år", () => {
  assert.equal(getRiderAge("2000-01-01", S1), 26);
  assert.equal(getRiderAge("2004-12-31", S1), 22);
  assert.equal(getRiderAge(null, S1), null);
  assert.equal(getRiderAge(undefined, S1), null);
});

// #3071: ingen wall-clock-fallback tilbage — mangler kalderen sæson-året,
// returnerer helperen null i stedet for at gætte med dags dato.
test("getRiderAge — null når intet sæson-år er kendt (en manglende alder er bedre end en forkert)", () => {
  assert.equal(getRiderAge("2000-01-01", null), null);
  assert.equal(getRiderAge("2000-01-01", undefined), null);
  assert.equal(getRiderAge("2000-01-01", NaN), null);
});

test("ageBadgeKey — <23 → u23 (yngste gældende)", () => {
  assert.equal(ageBadgeKey({ birthdate: "2004-06-01" }, S1), "u23"); // 22
  assert.equal(ageBadgeKey({ birthdate: "2010-01-01" }, S1), "u23"); // 16
});

test("ageBadgeKey — 23–24 → u25", () => {
  assert.equal(ageBadgeKey({ birthdate: "2003-01-01" }, S1), "u25"); // 23
  assert.equal(ageBadgeKey({ birthdate: "2002-01-01" }, S1), "u25"); // 24
});

test("ageBadgeKey — ≥25 → ingen alders-badge", () => {
  assert.equal(ageBadgeKey({ birthdate: "2001-01-01" }, S1), null); // 25
  assert.equal(ageBadgeKey({ birthdate: "1990-01-01" }, S1), null); // 36
});

test("ageBadgeKey — robust ved manglende rytter/fødselsdato/sæson-år", () => {
  assert.equal(ageBadgeKey(null, S1), null);
  assert.equal(ageBadgeKey({}, S1), null);
  assert.equal(ageBadgeKey({ birthdate: null }, S1), null);
  assert.equal(ageBadgeKey({ birthdate: "2004-06-01" }, null), null);
});

// #42: U23-filter-grænsen SKAL matche u23-badge (alder < 23). En 23-årig bærer
// u25-badge og må derfor ikke matche U23 — det var bug'en (filter brugte ≤23).
test("isU23 — alder < 23 (≤22 år) er U23", () => {
  assert.equal(isU23("2004-06-01", S1), true);  // 22
  assert.equal(isU23("2010-01-01", S1), true);  // 16
});

test("isU23 — boundary: præcis 23 år er IKKE U23 (bærer u25-badge)", () => {
  assert.equal(isU23("2003-01-01", S1), false); // 23 → ikke U23
  assert.equal(ageBadgeKey({ birthdate: "2003-01-01" }, S1), "u25"); // men u25
  assert.equal(isU23("2002-01-01", S1), false); // 24 → ikke U23
});

test("isU23 — robust ved manglende fødselsdato/sæson-år", () => {
  assert.equal(isU23(null, S1), false);
  assert.equal(isU23(undefined, S1), false);
  assert.equal(isU23("2004-06-01", null), false);
});

// #2032/#109/#2073: sæson-drevet alder = referenceåret − fødselsår (cykelsport-
// konvention: alderen rytteren fylder i sæsonens kalenderår), IKKE wall-clock.
test("ageForSeason — referenceår − fødselsår", () => {
  assert.equal(ageForSeason("2000-01-01", 2026), 26);
  assert.equal(ageForSeason("2010-06-15", 2026), 16);
  // Sæson-drevet: samme rytter i en senere sæson er ældre uafhængigt af dags dato.
  assert.equal(ageForSeason("2010-06-15", 2030), 20);
});

test("ageForSeason — null ved manglende fødselsdato eller ugyldigt referenceår", () => {
  assert.equal(ageForSeason(null, 2026), null);
  assert.equal(ageForSeason(undefined, 2026), null);
  assert.equal(ageForSeason("2000-01-01", null), null);
  assert.equal(ageForSeason("2000-01-01", undefined), null);
  assert.equal(ageForSeason("2000-01-01", NaN), null);
});

test("getRiderAge delegerer til ageForSeason med det givne sæson-referenceår", () => {
  assert.equal(getRiderAge("2004-12-31", S1), ageForSeason("2004-12-31", 2026));
  assert.equal(getRiderAge("2004-12-31", S1), 22);
});

// #109/#2073: U25 sæson-afledt — < 25 år ved referenceåret ⇔ født > referenceår-25.
test("isU25 — sæson-alder < 25 er U25", () => {
  assert.equal(isU25("2010-06-15", 2026), true); // 16
  assert.equal(isU25("2005-06-15", 2026), true); // 21
  assert.equal(isU25("2002-01-01", 2026), true); // 24
});

test("isU25 — boundary: præcis 25 år er IKKE U25", () => {
  // 25-årig: født referenceår-25. birthYear = 2001 = 2026-25 → IKKE > 2026-25.
  assert.equal(isU25("2001-01-01", 2026), false); // 25
  assert.equal(isU25("2001-12-31", 2026), false); // stadig fødselsår 2001 → 25
  assert.equal(isU25("2000-06-15", 2026), false); // 26
});

test("isU25 — sæson-drevet: samme rytter kan falde ud af U25 ved sæsonskift", () => {
  // Født 2002 → U25 i 2026 (24), men IKKE i 2027 (25). Følger sæsonen, ikke fødselsdag.
  assert.equal(isU25("2002-06-15", 2026), true);  // 24
  assert.equal(isU25("2002-06-15", 2027), false); // 25
});

test("isU25 — robust ved manglende fødselsdato/ugyldigt referenceår", () => {
  assert.equal(isU25(null, 2026), false);
  assert.equal(isU25(undefined, 2026), false);
  assert.equal(isU25("2010-06-15", null), false);
  assert.equal(isU25("2010-06-15", NaN), false);
});

// #2943: pensions-risiko-varsel til køberen — grænsen er windowStartAge (36,
// SSOT backend/lib/riderProgression.js PROGRESSION_CONFIG.retirement) minus ét
// sæson-varsel (noticeSeasons=1) = 35. Bekræfter selve konstanten, ikke bare
// et hardkodet tal, så testen brister hvis nogen ændrer duplikatet uden at
// opdatere kommentaren/SSOT-referencen.
test("RETIREMENT_WARNING_AGE — afledt af windowStartAge(36) − noticeSeasons(1)", () => {
  assert.equal(RETIREMENT_WARNING_AGE, 35);
});

test("isRetirementRisk — boundary: 34 er IKKE risiko, 35 ER risiko", () => {
  assert.equal(isRetirementRisk("1992-01-01", S1), false); // 34
  assert.equal(isRetirementRisk("1991-01-01", S1), true);  // 35
});

test("isRetirementRisk — sand hele pensions-vinduet ud (36-40) og derover", () => {
  assert.equal(isRetirementRisk("1990-01-01", S1), true); // 36 (windowStartAge)
  assert.equal(isRetirementRisk("1986-01-01", S1), true); // 40 (guaranteedAge)
  assert.equal(isRetirementRisk("1980-01-01", S1), true); // 46
});

test("isRetirementRisk — robust ved manglende fødselsdato/sæson-år", () => {
  assert.equal(isRetirementRisk(null, S1), false);
  assert.equal(isRetirementRisk(undefined, S1), false);
  assert.equal(isRetirementRisk("1991-01-01", null), false);
});

test("retirementRiskBadgeKey — 'retireRisk' fra 35 år, ellers null", () => {
  assert.equal(retirementRiskBadgeKey({ birthdate: "1991-01-01" }, S1), "retireRisk"); // 35
  assert.equal(retirementRiskBadgeKey({ birthdate: "1992-01-01" }, S1), null);         // 34
});

test("retirementRiskBadgeKey — robust ved manglende rytter/fødselsdato/sæson-år", () => {
  assert.equal(retirementRiskBadgeKey(null, S1), null);
  assert.equal(retirementRiskBadgeKey({}, S1), null);
  assert.equal(retirementRiskBadgeKey({ birthdate: null }, S1), null);
});

// Aldrig overlap med u23/u25-badget — de to klassifikationer er gensidigt
// udelukkende i praksis (ung vs. gammel), men koden bør ikke selv antage det.
test("retirementRiskBadgeKey og ageBadgeKey er aldrig samtidig sat", () => {
  const oldRider = { birthdate: "1985-01-01" }; // 41
  assert.equal(ageBadgeKey(oldRider, S1), null);
  assert.equal(retirementRiskBadgeKey(oldRider, S1), "retireRisk");
  const youngRider = { birthdate: "2010-01-01" }; // 16
  assert.equal(ageBadgeKey(youngRider, S1), "u23");
  assert.equal(retirementRiskBadgeKey(youngRider, S1), null);
});

// ── #3097: seasonNumberFromReferenceYear (inverse af seasonReferenceYear) ────

test("seasonNumberFromReferenceYear — nøjagtig inverse af seasonReferenceYear", () => {
  assert.equal(seasonNumberFromReferenceYear(seasonReferenceYear(1)), 1);
  assert.equal(seasonNumberFromReferenceYear(seasonReferenceYear(2)), 2);
  assert.equal(seasonNumberFromReferenceYear(seasonReferenceYear(6)), 6);
  assert.equal(seasonNumberFromReferenceYear(S1), 1);
  assert.equal(seasonNumberFromReferenceYear(S2), 2);
});

test("seasonNumberFromReferenceYear — null ved manglende/ugyldigt år", () => {
  assert.equal(seasonNumberFromReferenceYear(null), null);
  assert.equal(seasonNumberFromReferenceYear(undefined), null);
  assert.equal(seasonNumberFromReferenceYear(NaN), null);
});

// ── #3097: isContractExpiringAtTransition / contractExpiringBadgeKey ────────
// Frontend-spejl af backend/lib/squadRiskGuard.js's isContractExpiringAtTransition
// — samme "<=" (ikke "="), samme null-for-fri-agent-kontrakt.

test("isContractExpiringAtTransition — contract_end_season <= aktiv sæson → true (matcher backend's <=)", () => {
  assert.equal(isContractExpiringAtTransition(1, 1), true);
  assert.equal(isContractExpiringAtTransition(1, 2), true, "selv-helende <= fanger en overset tidligere sæson");
  assert.equal(isContractExpiringAtTransition(2, 1), false, "udløber FØRST næste sæson — ikke endnu");
  assert.equal(isContractExpiringAtTransition(null, 1), false, "ingen kontrakt (fri agent/akademi) → ikke 'udløbende'");
});

test("isContractExpiringAtTransition — robust ved ugyldigt/manglende sæson-nummer", () => {
  assert.equal(isContractExpiringAtTransition(1, null), false);
  assert.equal(isContractExpiringAtTransition(1, undefined), false);
  assert.equal(isContractExpiringAtTransition(1, NaN), false);
});

test("contractExpiringBadgeKey — 'contractExpiring' når kontrakten udløber ved næste transition, ellers null", () => {
  assert.equal(contractExpiringBadgeKey({ contract_end_season: 1 }, 1), "contractExpiring");
  assert.equal(contractExpiringBadgeKey({ contract_end_season: 3 }, 1), null);
  assert.equal(contractExpiringBadgeKey({ contract_end_season: null }, 1), null);
  assert.equal(contractExpiringBadgeKey(null, 1), null);
});
