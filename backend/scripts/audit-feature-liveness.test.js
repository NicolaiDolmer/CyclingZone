import test from "node:test";
import assert from "node:assert/strict";

import { evaluateDetectorARow, isFlagOff } from "./audit-feature-liveness.js";

// #2985: Detector A ("write-but-no-data") skal skelne mellem "featuren er død"
// og "featuren er slukket med vilje" ved at læse app_config LIVE i stedet for
// at stole på en statisk, manuelt vedligeholdt whitelist-entry. Disse tests
// bruger den REELLE eksporterede beslutningsfunktion (ingen reimplementation),
// bare med simuleret (ikke live-mutated) input-data — se PR-body for hvordan
// dette blev verificeret mod prod uden at flippe det rigtige flag.

function row(table_name, row_count = 0) {
  return { table_name, row_count };
}

function paths(table_name, ...files) {
  return new Map([[table_name, new Set(files)]]);
}

test("isFlagOff: fail-safe off for missing/false/off, ikke-off for on/beta/dry_run/true", () => {
  assert.equal(isFlagOff(undefined), true);
  assert.equal(isFlagOff(null), true);
  assert.equal(isFlagOff(false), true);
  assert.equal(isFlagOff("off"), true);

  assert.equal(isFlagOff("on"), false);
  assert.equal(isFlagOff(true), false);
  assert.equal(isFlagOff("beta"), false);
  assert.equal(isFlagOff("dry_run"), false);
});

test("academy_season_intake_runs (#2911): flag off + tom tabel = INTET fund", () => {
  const flags = new Map([["season_academy_intake_enabled", "off"]]);
  const insertPaths = paths("academy_season_intake_runs", "backend/lib/seasonAcademyIntake.js");

  const finding = evaluateDetectorARow(row("academy_season_intake_runs", 0), { insertPaths, flags });
  assert.equal(finding, null, "flag off skal undertrykke fundet — dette var false-positiv'en fra #2985");
});

test("academy_season_intake_runs (#2911): flag MANGLER helt (fail-safe off) + tom tabel = INTET fund", () => {
  const flags = new Map(); // ingen række for season_academy_intake_enabled i app_config
  const insertPaths = paths("academy_season_intake_runs", "backend/lib/seasonAcademyIntake.js");

  const finding = evaluateDetectorARow(row("academy_season_intake_runs", 0), { insertPaths, flags });
  assert.equal(finding, null);
});

test("academy_season_intake_runs (#2911): flag ON + tom tabel = FUND (ægte død feature)", () => {
  const flags = new Map([["season_academy_intake_enabled", "on"]]);
  const insertPaths = paths("academy_season_intake_runs", "backend/lib/seasonAcademyIntake.js");

  const finding = evaluateDetectorARow(row("academy_season_intake_runs", 0), { insertPaths, flags });
  assert.ok(finding, "flag on + stadig 0 rows skal flages — featuren kører nu og burde skrive");
  assert.equal(finding.detector, "A");
  assert.equal(finding.severity, "warning");
  assert.equal(finding.table, "academy_season_intake_runs");
  assert.match(finding.reason, /season_academy_intake_enabled/);
  assert.match(finding.reason, /IKKE off/);
  assert.deepEqual(finding.backend_files, ["backend/lib/seasonAcademyIntake.js"]);
});

test("academy_season_intake_runs (#2911): flag beta + tom tabel = FUND (beta er ikke off)", () => {
  const flags = new Map([["season_academy_intake_enabled", "beta"]]);
  const insertPaths = paths("academy_season_intake_runs", "backend/lib/seasonAcademyIntake.js");

  const finding = evaluateDetectorARow(row("academy_season_intake_runs", 0), { insertPaths, flags });
  assert.ok(finding, "beta betyder featuren kan køre for nogen — tom tabel skal stadig flages");
});

test("email_log (#2725/#2853): flag mangler i app_config (bekræftet prodtilstand) + tom = INTET fund", () => {
  // email_loop_enabled har aldrig haft en række i app_config — emailLoopFlag.js's
  // egen fail-safe tolker det som "off". Denne entry var tidligere en manuel
  // WHITELIST_EMPTY_TABLES-post; flyttet til FLAG_GATED_EMPTY_TABLES 26/7.
  const flags = new Map();
  const insertPaths = paths("email_log", "backend/lib/emailService.js");

  const finding = evaluateDetectorARow(row("email_log", 0), { insertPaths, flags });
  assert.equal(finding, null);
});

test("email_log (#2725/#2853): flag dry_run + tom tabel = FUND (loopet burde nu logge rows)", () => {
  const flags = new Map([["email_loop_enabled", "dry_run"]]);
  const insertPaths = paths("email_log", "backend/lib/emailService.js");

  const finding = evaluateDetectorARow(row("email_log", 0), { insertPaths, flags });
  assert.ok(finding, "dry_run kører sweeps fuldt og logger til email_log — tom er nu mistænkelig");
  assert.match(finding.reason, /email_loop_enabled/);
});

test("ikke-flag-gated tabel: 0 rows + insert path = FUND som hidtil (uændret adfærd)", () => {
  const flags = new Map();
  const insertPaths = paths("some_other_table", "backend/lib/someOtherModule.js");

  const finding = evaluateDetectorARow(row("some_other_table", 0), { insertPaths, flags });
  assert.ok(finding);
  assert.equal(finding.reason, "Tabel har 0 rows men backend har INSERT/UPSERT-paths");
});

test("ikke-flag-gated tabel: 0 rows uden insert path = intet fund (ingen backend-write)", () => {
  const flags = new Map();
  const insertPaths = new Map();

  const finding = evaluateDetectorARow(row("some_other_table", 0), { insertPaths, flags });
  assert.equal(finding, null);
});

test("statisk WHITELIST_EMPTY_TABLES-entry (hall_of_fame) undertrykker stadig uden flag", () => {
  const flags = new Map();
  const insertPaths = paths("hall_of_fame", "backend/lib/seasonTransition.js");

  const finding = evaluateDetectorARow(row("hall_of_fame", 0), { insertPaths, flags });
  assert.equal(finding, null, "eksisterende statisk whitelist-mekanisme må ikke være regressed");
});

test("forward-guard (#2299): whitelistet tabel der nu HAR rows giver en info-level stale-advarsel", () => {
  const flags = new Map();
  const insertPaths = paths("hall_of_fame", "backend/lib/seasonTransition.js");

  const finding = evaluateDetectorARow(row("hall_of_fame", 42), { insertPaths, flags });
  assert.ok(finding);
  assert.equal(finding.severity, "info");
  assert.match(finding.reason, /Stale whitelist-entry/);
});

test("PERMANENT_EMPTY_TABLES-entry (discord_dm_outbox) undertrykker uden flag og uden staleness-check", () => {
  const flags = new Map();
  const insertPaths = paths("discord_dm_outbox", "backend/lib/discordDmOutbox.js");

  assert.equal(evaluateDetectorARow(row("discord_dm_outbox", 0), { insertPaths, flags }), null);
  // Permanent-listen har IKKE forward-guarden — rows er intet finding (by design).
  assert.equal(evaluateDetectorARow(row("discord_dm_outbox", 3), { insertPaths, flags }), null);
});
