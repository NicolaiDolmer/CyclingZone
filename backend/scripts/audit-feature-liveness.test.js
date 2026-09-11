import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateDetectorARow,
  evaluateDetectorBEndpoint,
  evaluateDetectorCApplied,
  evaluateDetectorEEvent,
  isFlagOff,
} from "./audit-feature-liveness.js";

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

test("wage_daily_runs (#2840): mode season_upfront (offValues) + tom tabel = INTET fund", () => {
  // wage_deduction_mode er en MODE-nøgle: "season_upfront" er dens off-tilstand,
  // ikke literal "off" — offValues-mekanismen skal undertrykke fundet.
  const flags = new Map([["wage_deduction_mode", "season_upfront"]]);
  const insertPaths = paths("wage_daily_runs", "backend/lib/wageDeductionSweep.js");

  const finding = evaluateDetectorARow(row("wage_daily_runs", 0), { insertPaths, flags });
  assert.equal(finding, null, "season_upfront er off-tilstanden — tom tabel er forventet indtil flip");
});

test("wage_daily_runs (#2840): mode daily + tom tabel = FUND (sweepen burde skrive)", () => {
  const flags = new Map([["wage_deduction_mode", "daily"]]);
  const insertPaths = paths("wage_daily_runs", "backend/lib/wageDeductionSweep.js");

  const finding = evaluateDetectorARow(row("wage_daily_runs", 0), { insertPaths, flags });
  assert.ok(finding, "daily + 0 rows skal flages — sweepen koerer nu og burde skrive");
  assert.equal(finding.detector, "A");
  assert.match(finding.reason, /wage_deduction_mode/);
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

// #4754: feature_liveness_table_counts() falder tilbage til et
// pg_class.reltuples-ESTIMAT (row.estimated=true) når et per-tabel
// lock_timeout rammer — se database/2026-09-04-4754-feature-liveness-count-
// lock-timeout.sql. Et estimeret 0-tal er ikke troværdigt nok til at flage
// som "død feature" (reltuples kan være stale lige efter tabellens
// allerførste rows), så Detector A skal springe estimerede 0-rækker over.
test("#4754: estimeret (lock-timeout-fallback) 0 rows springes over — ikke nok evidens", () => {
  const flags = new Map();
  const insertPaths = paths("some_other_table", "backend/lib/someOtherModule.js");

  const finding = evaluateDetectorARow(
    { table_name: "some_other_table", row_count: 0, estimated: true },
    { insertPaths, flags }
  );
  assert.equal(finding, null, "et estimeret 0-tal må ikke udløse en write-but-no-data-flag");
});

test("#4754: ikke-estimeret (exact) 0 rows flager som hidtil — regressionsguard for fallback-ændringen", () => {
  const flags = new Map();
  const insertPaths = paths("some_other_table", "backend/lib/someOtherModule.js");

  const finding = evaluateDetectorARow(
    { table_name: "some_other_table", row_count: 0, estimated: false },
    { insertPaths, flags }
  );
  assert.ok(finding, "exact 0-tal (estimated=false/undefined) skal stadig flages som før");
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

// ---------------------------------------------------------------------------
// #3069: de fund der holdt `audit` rød i 14 af 14 kørsler fra 7/9. Hver test
// herunder er "rød → grøn"-guarden for præcis én whitelist-entry: uden entryen
// var fundet der, og med den er det væk — OG et NYT, uwhitelistet fund af samme
// klasse flages stadig, så gaten ikke er blevet blind.
// ---------------------------------------------------------------------------

test("#3069 Detector A: DM-moderationstabeller er permanent-suppresset — også når de får rows", () => {
  const flags = new Map();
  for (const table of ["dm_blocks", "dm_reports", "dm_conversation_hides"]) {
    const insertPaths = paths(table, "backend/lib/directMessages.js");
    assert.equal(
      evaluateDetectorARow(row(table, 0), { insertPaths, flags }),
      null,
      `${table}: sjælden opt-in-handling i en levende feature må ikke holde gaten rød`
    );
    // Permanent-listen har ingen forward-guard: den første blokering/anmeldelse
    // må ikke gøre auditen rød igen.
    assert.equal(evaluateDetectorARow(row(table, 1), { insertPaths, flags }), null);
  }
});

test("#3069 Detector A: forum_category_mutes er permanent-suppresset — også når den får rows", () => {
  const flags = new Map();
  const insertPaths = paths("forum_category_mutes", "backend/lib/forum.js");

  assert.equal(evaluateDetectorARow(row("forum_category_mutes", 0), { insertPaths, flags }), null);
  assert.equal(evaluateDetectorARow(row("forum_category_mutes", 4), { insertPaths, flags }), null);
});

test("#3069 Detector B: whitelistet resend-webhook er intet fund, men et nyt orphan flages", () => {
  const callTokens = [];

  assert.equal(
    evaluateDetectorBEndpoint({ method: "POST", path: "/email/resend-webhook" }, callTokens),
    null,
    "ekstern Svix-signeret webhook — en frontend-kalder ville være en fejl, ikke et fix"
  );

  const fresh = evaluateDetectorBEndpoint({ method: "POST", path: "/email/brand-new-hook" }, callTokens);
  assert.ok(fresh, "et uwhitelistet endpoint uden kalder skal stadig flages");
  assert.equal(fresh.detector, "B");
  assert.equal(fresh.path, "/email/brand-new-hook");
});

test("#3069 Detector B: et endpoint med frontend-kalder er intet fund (matcher uændret)", () => {
  const callTokens = [["email", "brand-new-hook"]];

  assert.equal(
    evaluateDetectorBEndpoint({ method: "POST", path: "/email/brand-new-hook" }, callTokens),
    null
  );
});

test("#3069 Detector C: den flyttede 4482-migration er intet fund, men ægte drift flages", () => {
  const committed = new Set(["database/2026-09-01-noget-andet.sql"]);

  assert.equal(
    evaluateDetectorCApplied("database/2026-08-31-expire-stale-bonus-offers-4482.sql", committed),
    null,
    "filen blev flyttet til database/manual/ som R100-rename — samme SQL, ingen drift"
  );

  const drift = evaluateDetectorCApplied("database/2026-09-09-ukendt-migration.sql", committed);
  assert.ok(drift, "en applied migration vi IKKE har verificeret skal stadig flages");
  assert.equal(drift.detector, "C");
  assert.equal(drift.severity, "warning");
});

test("#3069 Detector C: forward-guard — whitelistet fil der er tilbage i database/ er stale", () => {
  const committed = new Set(["database/2026-08-31-expire-stale-bonus-offers-4482.sql"]);

  const stale = evaluateDetectorCApplied(
    "database/2026-08-31-expire-stale-bonus-offers-4482.sql",
    committed
  );
  assert.ok(stale, "suppressionen er unødvendig når filen ligger i database/ igen");
  assert.equal(stale.severity, "info");
  assert.match(stale.reason, /Stale whitelist-entry/);
  assert.match(stale.reason, /WHITELIST_APPLIED_WITHOUT_REPO_FILE/);
});

test("#3069 Detector C: en committed fil uden whitelist-entry er intet fund i applied-retningen", () => {
  const committed = new Set(["database/2026-09-01-noget-andet.sql"]);

  assert.equal(evaluateDetectorCApplied("database/2026-09-01-noget-andet.sql", committed), null);
});

test("#3069 Detector E: de fire whitelistede events er intet fund ved 0 impressions", () => {
  for (const eventName of [
    "feature_hall_of_fame_opened",
    "feature_board_meeting_opened",
    "board_meeting_signed",
    "feature_board_consequences_panel_viewed",
  ]) {
    assert.equal(
      evaluateDetectorEEvent(eventName, undefined),
      null,
      `${eventName}: bekræftet intentional zero — må ikke holde gaten rød`
    );
    assert.equal(evaluateDetectorEEvent(eventName, { event_name: eventName, event_count: 0 }), null);
  }
});

test("#3069 Detector E: forward-guard — whitelistet event med impressions er stale", () => {
  const stale = evaluateDetectorEEvent("feature_board_meeting_opened", {
    event_name: "feature_board_meeting_opened",
    event_count: 12,
  });
  assert.ok(stale, "entryen skal selv-rydde når årsmødet er åbnet efter S3→S4");
  assert.equal(stale.severity, "info");
  assert.match(stale.reason, /Stale whitelist-entry/);
});

test("#3069 Detector E: et uwhitelistet event med 0 impressions flages stadig", () => {
  const finding = evaluateDetectorEEvent("feature_noget_helt_nyt", undefined);
  assert.ok(finding);
  assert.equal(finding.detector, "E");
  assert.equal(finding.severity, "warning");
  assert.match(finding.reason, /0 impressions/);
});
