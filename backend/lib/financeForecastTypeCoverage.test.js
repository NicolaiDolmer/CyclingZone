// Forward-guard #3332 (samme mønster som #1464/#2957's financeTypeConstraintGuard.test.js):
// enhver finance_transactions.type koden RENT FAKTISK skriver skal være eksplicit
// klassificeret i FINANCE_FORECAST_TYPE_COVERAGE (backend/lib/financeForecast.js) —
// enten { modeled: true, field } (indgår i projected_net) eller { modeled: false,
// reason } (bevidst udeladt, med begrundelse). Testen fejler hvis en NY type dukker
// op uklassificeret, så en fremtidig 5. udgifts-/indtægtsstrøm ikke kan glide stille
// forbi prognosen sådan som upkeep/facilitets-/stab-/akademi-strømmene gjorde før
// #3236/#3251 (postmortem .claude/learnings/2026-08-03-forecast-missing-expense-side.md,
// "Læring": "Når en motor får en ny sæson-start-udgiftsstrøm, er der INTET automatisk
// der tvinger dens forward-looking forecast-søskende til at følge med").
//
// Genbruger SAMME kilde-scanner som financeTypeConstraintGuard.test.js
// (scripts/lint-finance-types.mjs, #2957) — directory-walk i stedet for en
// hårdkodet filliste, så en ny finance-skrivende fil dækkes automatisk.
//
// #2957-blind-spot (dokumenteret i scripts/lint-finance-types.mjs's header): typen
// 'loan_repayment' skrives kun via den bespoke SQL-RPC repay_loan_atomic
// (database/2026-07-1{0,1}-repay-loan-atomic*.sql) og fanges IKKE af JS-kilde-
// scanneren. Bekræftet levende i prod (read-only SELECT mod ghwvkxzhsbbltzfnuhhz,
// 2026-08-04: 174 rækker) — tilføjet manuelt til det scannede sæt her.

import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { collectScanFiles, extractCodeWrittenTypes } from "../../scripts/lint-finance-types.mjs";
import { computeFinanceForecast, FINANCE_FORECAST_TYPE_COVERAGE } from "./financeForecast.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, "..");

// Kendt blind-spot i JS-kilde-scanneren (SQL-RPC-skrevet type) — se kommentar ovenfor.
const SQL_ONLY_KNOWN_TYPES = ["loan_repayment"];

test("kode-skrevne finance_transactions.type-literaler kan udtrækkes (sanity, samme scanner som #1464-guarden)", () => {
  const codeTypes = extractCodeWrittenTypes(collectScanFiles(backendRoot));
  assert.ok(
    codeTypes.size >= 20,
    `forventede mange kode-skrevne finance-typer, fandt kun ${codeTypes.size} — anker-regex sandsynligvis brudt`,
  );
});

test("HVER kode-skrevet finance_transactions.type er eksplicit klassificeret i FINANCE_FORECAST_TYPE_COVERAGE (#3332 forward-guard)", () => {
  const codeTypes = extractCodeWrittenTypes(collectScanFiles(backendRoot));
  const allTypes = new Set([...codeTypes.keys(), ...SQL_ONLY_KNOWN_TYPES]);

  const unclassified = [...allTypes]
    .filter((type) => !(type in FINANCE_FORECAST_TYPE_COVERAGE))
    .sort();

  assert.deepEqual(
    unclassified,
    [],
    unclassified.length === 0
      ? ""
      : "Finance-type(r) skrevet i backend-koden UDEN klassifikation i " +
          "FINANCE_FORECAST_TYPE_COVERAGE (backend/lib/financeForecast.js) — #3332-" +
          "bug-klassen (prognosen kan tavst udelade en ny udgifts-/indtægtsstrøm, " +
          "ligesom upkeep/facilitets-/stab-/akademi-strømmene gjorde før #3236).\n" +
          `Manglende: ${unclassified.join(", ")}\n` +
          "Fix: tilføj hver type til FINANCE_FORECAST_TYPE_COVERAGE i financeForecast.js — " +
          "enten { modeled: true, field } hvis den kan forudsiges deterministisk (fold " +
          "beregningen ind i projected_net + nævn den i help.json's forecastCalculation, " +
          "en+da), eller { modeled: false, reason } hvis den bevidst udelades (og nævn " +
          "kategorien i help.json's 'ikke medregnet'-liste, en+da, jf. #3332 punkt 4: " +
          "'ingen tavs udeladelse').",
  );
});

test("HVER 'modeled: true'-klassifikation peger på et felt der rent faktisk findes i computeFinanceForecast()'s output", () => {
  // Minimal repræsentativt input der aktiverer alle 7 modellerede strømme, så
  // feltnavnene i FINANCE_FORECAST_TYPE_COVERAGE ikke bare er dekorative strenge.
  const result = computeFinanceForecast({
    team: { id: "coverage-team", division: 2, balance: 500_000 },
    riders: [{ salary: 10_000, prize_earnings_bonus: 5_000 }],
    activeLoans: [],
    totalDebt: 0,
    debtCeiling: 900_000,
    currentSeasonNumber: 2,
    facilityTracks: [{ tier: 1 }],
    activeStaffSalaries: [{ salary: 20_000 }],
    academyRiderCount: 2,
    facilitiesEnabled: true,
  });

  for (const [type, meta] of Object.entries(FINANCE_FORECAST_TYPE_COVERAGE)) {
    if (!meta.modeled) continue;
    assert.ok(
      Object.prototype.hasOwnProperty.call(result, meta.field),
      `FINANCE_FORECAST_TYPE_COVERAGE['${type}'].field ('${meta.field}') findes ikke i computeFinanceForecast()'s output`,
    );
    assert.notEqual(
      result[meta.field],
      undefined,
      `'${type}' → '${meta.field}' er undefined i output med et input der burde aktivere strømmen`,
    );
  }
});

test("HVER 'modeled: false'-klassifikation har en ikke-tom begrundelse (reason), ikke bare et flag", () => {
  for (const [type, meta] of Object.entries(FINANCE_FORECAST_TYPE_COVERAGE)) {
    if (meta.modeled) continue;
    assert.equal(typeof meta.reason, "string", `'${type}' mangler en reason-streng`);
    assert.ok(meta.reason.trim().length > 0, `'${type}' har en tom reason`);
  }
});
