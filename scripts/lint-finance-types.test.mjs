// scripts/lint-finance-types.test.mjs
// ============================================================
// Tests for the finance-type forward-guard (#2957).
//
// Run:  node --test scripts/lint-finance-types.test.mjs
//
// Coverage:
//   1. loadCheckAllowedTypes() parses the real database/*.sql corpus sanely.
//   2. extractTypesFromSource() finds each of the four write-sink anchors and does
//      NOT false-positive on lookalike `type:` fields (notifications, warnings,
//      season events) that are documented false-positive risks.
//   3. collectScanFiles()/extractCodeWrittenTypes() run clean end-to-end against the
//      real backend tree (zero missing types today).
//   4. Negative control (#2957 accept criterion): a synthetic, never-shipped type
//      literal IS flagged as missing when checked against the real CHECK set — i.e.
//      the guard actually bites. Printed so the failure shape is visible in CI logs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadCheckAllowedTypes,
  extractTypesFromSource,
  collectScanFiles,
  extractCodeWrittenTypes,
  AUDIT_ENUM_COLUMNS,
  loadNamedCheckValues,
  extractConstantValues,
  extractLiteralEnumValues,
  collectAuditEnumDrift,
} from "./lint-finance-types.mjs";

// --- loadCheckAllowedTypes() -------------------------------------------------

test("CHECK-listen parses fra database/*.sql", () => {
  const { values, source } = loadCheckAllowedTypes();
  assert.ok(source, "fandt ingen finance_transactions.type CHECK-definition");
  assert.ok(
    values.size >= 15,
    `forventede mange tilladte finance-typer, fandt kun ${values.size} — parser sandsynligvis brudt`
  );
  for (const must of [
    "sponsor",
    "salary",
    "prize",
    "upkeep",
    "forced_debt_sale",
    "sponsor_race_day",
    "sponsor_signing_bonus",
    "sponsor_result_bonus",
    "sponsor_objective_bonus",
  ]) {
    assert.ok(values.has(must), `forventede '${must}' i den autoritative CHECK (${source})`);
  }
});

// --- extractTypesFromSource() — the four anchors -----------------------------

test("anker A: incrementBalanceWithAudit(...) payload.type", () => {
  const src = `
    await incrementBalanceWithAudit(client, {
      teamId,
      delta: amount,
      payload: {
        type: "sponsor",
        amount,
      },
    });
  `;
  const found = extractTypesFromSource(src, "fixture.js");
  assert.ok(found.has("sponsor"));
});

test("anker B: creditTeam/debitTeam(...) 3. positionsargument", () => {
  const src = `
    await debitTeam(team.id, facilityUpkeepCharged, "facility_upkeep", null, seasonId, client, {});
    await creditTeam(
      team.id,
      parachuteAmount,
      "parachute",
      null,
      seasonId,
      client,
      {}
    );
  `;
  const found = extractTypesFromSource(src, "fixture.js");
  assert.ok(found.has("facility_upkeep"));
  assert.ok(found.has("parachute"));
});

test("anker C: direkte .from(\"finance_transactions\").insert({ type })", () => {
  const src = `
    await client.from("finance_transactions").insert({
      team_id: teamId,
      type: "admin_adjustment",
      amount: 100,
    });
  `;
  const found = extractTypesFromSource(src, "fixture.js");
  assert.ok(found.has("admin_adjustment"));
});

test("anker D: rpc(..., { p_finance_payload: { type } }) direkte", () => {
  const src = `
    const { data } = await supabase.rpc("finalize_academy_acquisition", {
      p_team_id: teamId,
      p_finance_payload: {
        type: "academy_signing",
        amount: -fee,
      },
    });
  `;
  const found = extractTypesFromSource(src, "fixture.js");
  assert.ok(found.has("academy_signing"));
});

test("balanceRpc.js's egen p_finance_payload: payload (ingen '{') tælles IKKE dobbelt via anker D", () => {
  const src = `
    export async function incrementBalanceWithAudit(client, { teamId, delta, payload }) {
      const { data, error } = await client.rpc("increment_balance_with_audit", {
        p_team_id: teamId,
        p_delta: delta,
        p_finance_payload: payload,
      });
    }
  `;
  const found = extractTypesFromSource(src, "fixture.js");
  assert.equal(found.size, 0, "wrapper-forwarding-linjen skal ikke give et falsk fund");
});

// --- False-positive guards: lookalike `type:` fields that are NOT finance rows --

test("false-positiv-vagt: warnings/report-rows med type: er ikke finance_transactions", () => {
  const src = `
    warnings.push({
      race_id: race.id,
      type: "no_prize_results",
      message: "Ingen præmie-rækker.",
    });
  `;
  const found = extractTypesFromSource(src, "fixture.js");
  assert.equal(found.size, 0, "et løst 'type:' uden finance-anker må ikke tælles");
});

test("false-positiv-vagt: notifySeasonEvent({type}) er ikke finance_transactions", () => {
  const src = `notifySeasonEvent({ type: "season_started", seasonNumber: n }).catch(() => {});`;
  const found = extractTypesFromSource(src, "fixture.js");
  assert.equal(found.size, 0, "notifikations-'type' uden finance-anker må ikke tælles");
});

// --- End-to-end mod den ægte backend-træ -------------------------------------

test("collectScanFiles() finder filer i lib/routes/scripts, ekskluderer *.test.js", () => {
  const files = collectScanFiles();
  assert.ok(files.length > 50, `forventede mange filer, fandt kun ${files.length}`);
  assert.ok(files.every((f) => !/\.test\.(js|mjs)$/.test(f)), "test-filer skal være ekskluderet");
  // De filer #2948 viste den GAMLE guards hardkodede FINANCE_SOURCE_FILES-liste
  // manglede skal nu automatisk være dækket af directory-walk'et (ingen allowlist).
  const rel = files.map((f) => f.replace(/\\/g, "/"));
  for (const must of [
    "backend/lib/sponsorRaceDayIncome.js",
    "backend/lib/sponsorContractsService.js",
    "backend/lib/transferExecution.js",
    "backend/lib/scoutAssignmentService.js",
  ]) {
    assert.ok(rel.some((f) => f.endsWith(must)), `forventede at finde ${must} via directory-walk`);
  }
});

test("HVER kode-skrevet finance_transactions.type har en CHECK-constraint-værdi i dag", () => {
  const { values: allowed, source } = loadCheckAllowedTypes();
  const codeTypes = extractCodeWrittenTypes(collectScanFiles());
  assert.ok(codeTypes.size >= 10, `forventede mange kode-skrevne finance-typer, fandt ${codeTypes.size}`);

  const missing = [...codeTypes.keys()].filter((t) => !allowed.has(t));
  assert.deepEqual(
    missing,
    [],
    missing.length === 0
      ? ""
      : `Finance-type(r) uden CHECK-dækning (${source}): ${missing.join(", ")}`
  );
});

// --- Negativ kontrol (#2957 accept: "Scriptet fejler på en syntetisk manglende
// type") ------------------------------------------------------------------------
//
// Beviser at guarden rent faktisk BIDER: en helt opdigtet, aldrig-shippet type
// bliver fanget som "kode-skrevet men ikke i CHECK'et" når den køres gennem den
// SAMME ekstraktions- + sammenligningslogik som CI'en bruger. Ingen ægte fil
// røres — fixturen er en in-memory streng.
test("negativ kontrol: en fiktiv finance-type flages som manglende i CHECK'et", () => {
  const FAKE_TYPE = "totally_fake_type_never_shipped_negative_control";
  const src = `
    await incrementBalanceWithAudit(client, {
      teamId,
      delta: amount,
      payload: {
        type: "${FAKE_TYPE}",
        amount,
      },
    });
  `;

  const codeTypes = extractTypesFromSource(src, "fixture.js");
  assert.ok(codeTypes.has(FAKE_TYPE), "ekstraktionen fandt ikke den fiktive type — fixturen er forkert");

  const { values: allowed } = loadCheckAllowedTypes();
  assert.ok(
    !allowed.has(FAKE_TYPE),
    "den fiktive type findes uventet allerede i CHECK'et — vælg en anden fiktiv streng"
  );

  const missing = [...codeTypes.keys()].filter((t) => !allowed.has(t));
  console.log(
    `[negativ kontrol] guarden ville fejle CI med: '${FAKE_TYPE}' skrevet i fixture.js:5 (incrementBalanceWithAudit), ikke i CHECK'et.`
  );
  assert.deepEqual(missing, [FAKE_TYPE]);
});

// ============================================================================
// #1464-udvidelse: audit-enum-kolonnerne actor_type + related_entity_type.
//
// `type` var kun én af tre CHECK-begrænsede enum-kolonner på finance_transactions.
// FINANCE_ACTOR_TYPE og FINANCE_RELATED_ENTITY i backend/lib/economyConstants.js
// påstod i en kommentar at de "MUST matche database CHECK constraints" uden at
// noget håndhævede det. Testene herunder håndhæver det.
// ============================================================================

test("loadNamedCheckValues() parser begge audit-enum-constraints fra database/*.sql", () => {
  const actor = loadNamedCheckValues("finance_transactions_actor_type_check");
  assert.ok(actor.source, "fandt ingen finance_transactions_actor_type_check-definition");
  assert.deepEqual(
    [...actor.values].sort(),
    ["admin", "api", "cron", "migration", "system"],
    "actor_type-CHECK'et matcher ikke live-skemaet (verificeret mod prod 2026-08-31)",
  );

  const related = loadNamedCheckValues("finance_transactions_related_entity_type_check");
  assert.ok(related.source, "fandt ingen finance_transactions_related_entity_type_check-definition");
  assert.deepEqual(
    [...related.values].sort(),
    ["auction", "loan", "manual", "race", "season", "swap", "transfer"],
    "related_entity_type-CHECK'et matcher ikke live-skemaet (verificeret mod prod 2026-08-31)",
  );
});

test("extractConstantValues() læser de frosne konstant-objekter i economyConstants.js", () => {
  const actor = extractConstantValues("FINANCE_ACTOR_TYPE");
  assert.ok(actor.size >= 5, `forventede mindst 5 FINANCE_ACTOR_TYPE-værdier, fandt ${actor.size}`);
  assert.equal(actor.get("cron"), "CRON");

  const related = extractConstantValues("FINANCE_RELATED_ENTITY");
  assert.ok(related.size >= 7, `forventede mindst 7 FINANCE_RELATED_ENTITY-værdier, fandt ${related.size}`);
  assert.equal(related.get("auction"), "AUCTION");
});

test("extractLiteralEnumValues() fanger rå literaler der springer konstanten over", () => {
  const dir = mkdtempSync(join(tmpdir(), "cz-enum-lit-"));
  const file = join(dir, "fixture.js");
  writeFileSync(
    file,
    [
      'await incrementBalanceWithAudit(client, { teamId, delta, payload: {',
      '  type: "salary",',
      '  actorType: "cron",',
      '  related_entity_type: "loan",',
      "} });",
    ].join("\n"),
    "utf8",
  );

  const actorLiterals = extractLiteralEnumValues([file], ["actor_type", "actorType"]);
  assert.deepEqual([...actorLiterals.keys()], ["cron"]);

  const relatedLiterals = extractLiteralEnumValues([file], ["related_entity_type", "relatedEntityType"]);
  assert.deepEqual([...relatedLiterals.keys()], ["loan"]);

  // `type:` må IKKE lække ind i audit-enum-discovery (den har sin egen guard).
  assert.ok(!actorLiterals.has("salary"), "type-literalen må ikke tælles som actor_type");
});

test("HVER kode-skrevet audit-enum-værdi har en CHECK-constraint-værdi i dag (#1464 forward-guard)", () => {
  const reports = collectAuditEnumDrift();
  assert.equal(reports.length, AUDIT_ENUM_COLUMNS.length);

  for (const report of reports) {
    assert.ok(
      report.source,
      `fandt ingen CHECK-definition for ${report.constraint} — parser sandsynligvis brudt`,
    );
    // Sanity: falder discovery til ~0 er parseren (ikke koden) brudt.
    assert.ok(
      report.codeValues.size >= 5,
      `forventede mange kode-skrevne ${report.column}-værdier, fandt kun ${report.codeValues.size}`,
    );
    assert.deepEqual(
      report.missing.map((x) => x.value),
      [],
      `finance_transactions.${report.column}-værdi(er) brugt i backend-koden uden CHECK-dækning `
        + `(database/${report.source}): `
        + report.missing.map((x) => `'${x.value}' i ${x.locations.join(", ")}`).join("; "),
    );
  }
});

test("negativ kontrol: en fiktiv audit-enum-værdi flages som manglende i CHECK'et", () => {
  const FAKE_ACTOR = "scout_bot_never_shipped_negative_control";
  const dir = mkdtempSync(join(tmpdir(), "cz-enum-neg-"));
  const constantsFile = join(dir, "economyConstants.js");
  writeFileSync(
    constantsFile,
    [
      "export const FINANCE_ACTOR_TYPE = Object.freeze({",
      '  CRON: "cron",',
      `  SCOUT_BOT: "${FAKE_ACTOR}",`,
      "});",
    ].join("\n"),
    "utf8",
  );

  const codeValues = extractConstantValues("FINANCE_ACTOR_TYPE", constantsFile);
  assert.ok(codeValues.has(FAKE_ACTOR), "fixturen blev ikke læst — testen tester ingenting");

  const { values: allowed } = loadNamedCheckValues("finance_transactions_actor_type_check");
  assert.ok(!allowed.has(FAKE_ACTOR), "den fiktive actor findes uventet i CHECK'et — vælg en anden");

  const missing = [...codeValues.keys()].filter((v) => !allowed.has(v));
  console.log(
    `[negativ kontrol] guarden ville fejle CI med: finance_transactions.actor_type = '${FAKE_ACTOR}' uden CHECK-dækning.`,
  );
  assert.deepEqual(missing, [FAKE_ACTOR]);
});
