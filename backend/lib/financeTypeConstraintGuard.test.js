// Forward-guard mod #1465-bug-klassen: en ny finance_transactions.type-værdi brugt
// i backend-koden, men UDEN en tilsvarende værdi i CHECK-constraintet i database/*.sql.
//
// #1465 (twin af #1463 'upkeep'-bug'en): koden krediterer 'forced_debt_sale' via
// creditTeam(...) i economyEngine, men typen blev aldrig tilføjet til
// finance_transactions_type_check → en ægte prod-INSERT fejler med check_violation
// (23514) midt i payroll-cron'en. Unit-testene kører mod en mock-supabase uden ægte
// CHECK, så de var grønne mens prod ville crashe. Audit: docs/audits/2026-06-19-enum-fk-drift-audit.md
// (Anbefaling 2 = denne tests kerne-leverance).
//
// #2957-REFACTOR (2026-07-26): denne fil implementerede tidligere sin EGEN kopi af
// parse+ekstraktions-logikken, ankret på en HÅRDKODET FINANCE_SOURCE_FILES-liste (8
// filer). Den liste blev aldrig udvidet da sponsorRaceDayIncome.js,
// sponsorContractsService.js, transferExecution.js og scoutAssignmentService.js
// begyndte at skrive finance_transactions-rækker — hvilket er PRÆCIS den bug-klasse
// denne test selv findes for at forhindre (#2948: 'sponsor_race_day' manglede i
// CHECK'et, opdaget manuelt 25/7). Se
// .claude/learnings/2026-07-25-finance-type-check-latent-sponsor-race-day.md.
//
// Fix: genbrug scripts/lint-finance-types.mjs (#2957) som ENESTE implementering — den
// scanner backend/{lib,routes,scripts} via directory-walk i stedet for en navngivet
// liste, så en ny finance-skrivende fil dækkes automatisk uden en allowlist at glemme.
// Denne fil er nu en tynd wrapper der kører SAMME logik som CI-guard-jobbet
// (finance-type-guard i .github/workflows/ci.yml), så driften fanges også i den lokale
// `npm test`-pre-flight (CLAUDE.md-rutinen), ikke kun i sit eget CI-job.
//
// INVARIANT (det vi tester): MÆNGDEN af finance_transactions.type-string-literaler som
// backend-koden faktisk skriver ⊆ MÆNGDEN af værdier som finance_transactions_type_check
// CHECK'et tillader. (Subset, ikke lighed: CHECK'et MÅ gerne tillade ekstra værdier som
// ingen kode-sti skriver endnu, fx 'starting_budget' der seedes via SQL.)

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  loadCheckAllowedTypes,
  collectScanFiles,
  extractCodeWrittenTypes,
  collectAuditEnumDrift,
  extractLiteralEnumValues,
  AUDIT_ENUM_COLUMNS,
} from "../../scripts/lint-finance-types.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, "..");

test("CHECK-listen for finance_transactions.type kan parses fra database/*.sql", () => {
  const { values, source } = loadCheckAllowedTypes();
  assert.ok(source, "fandt ingen finance_transactions.type CHECK-definition i database/*.sql");
  // Sanity: den autoritative liste skal have et betydeligt antal værdier. Falder
  // dette til ~0 er parseren (ikke skemaet) brudt — fang det eksplicit.
  assert.ok(
    values.size >= 15,
    `forventede mange tilladte finance-typer i ${source}, fandt kun ${values.size} — parser sandsynligvis brudt`,
  );
  // Anker-værdier der MÅ findes (de blev tilføjet af #1463/#1465 og er kerne-payouts).
  for (const must of ["sponsor", "salary", "prize", "upkeep", "forced_debt_sale"]) {
    assert.ok(values.has(must), `forventede '${must}' i den autoritative CHECK (${source})`);
  }
});

test("kode-skrevne finance_transactions.type-literaler kan udtrækkes fra backend (directory-walk, ingen allowlist)", () => {
  const files = collectScanFiles(backendRoot);
  const codeTypes = extractCodeWrittenTypes(files);
  // Sanity: vi skal finde et meningsfuldt antal write-sinks. Falder dette til ~0 er
  // anker-regex'erne (ikke koden) brudt.
  assert.ok(
    codeTypes.size >= 10,
    `forventede mange kode-skrevne finance-typer, fandt kun ${codeTypes.size} — anker-regex sandsynligvis brudt`,
  );
  // #1465-anker: 'forced_debt_sale' SKAL fanges som kode-skrevet (ellers tester vi
  // ikke den bug-klasse vi blev bygget til).
  assert.ok(
    codeTypes.has("forced_debt_sale"),
    "forventede at fange 'forced_debt_sale' som kode-skrevet finance-type (economyEngine creditTeam) — anker-regex brudt",
  );
  // #2948-anker: 'sponsor_race_day' (sponsorRaceDayIncome.js) SKAL nu fanges — det er
  // netop den fil den GAMLE hardkodede FINANCE_SOURCE_FILES-liste aldrig inkluderede.
  assert.ok(
    codeTypes.has("sponsor_race_day"),
    "forventede at fange 'sponsor_race_day' (sponsorRaceDayIncome.js, #2948) — directory-walk brudt",
  );
});

test("HVER kode-skrevet finance_transactions.type har en CHECK-constraint-værdi (#1464/#1465/#2948 forward-guard)", () => {
  const { values: allowed, source } = loadCheckAllowedTypes();
  const codeTypes = extractCodeWrittenTypes(collectScanFiles(backendRoot));

  const missing = [];
  for (const [type, locations] of codeTypes) {
    if (!allowed.has(type)) {
      missing.push({ type, locations });
    }
  }

  assert.deepEqual(
    missing.map((x) => x.type),
    [],
    missing.length === 0
      ? ""
      : "Finance-type(r) brugt i backend-koden UDEN en tilsvarende CHECK-constraint-værdi " +
          `(#1465/#2948-bug-klassen — en ægte prod-INSERT ville fejle med check_violation 23514).\n` +
          `Autoritativ CHECK parset fra: database/${source}\n` +
          `Manglende:\n` +
          missing
            .map((x) => `  - '${x.type}'  skrevet i: ${x.locations.join(", ")}`)
            .join("\n") +
          `\nFix: tilføj værdien til finance_transactions_type_check i en NY database/*.sql-migration ` +
          `(additiv DROP IF EXISTS + re-ADD, jf. database/2026-06-19-finance-forced-debt-sale-type.sql). ` +
          `Ejeren applier migrationen (auto-applies ved merge).`,
  );
});

// ────────────────────────────────────────────────────────────────────────────
// #1464-udvidelse (2026-08-31): `type` var kun ÉN af tre CHECK-begrænsede
// enum-kolonner på finance_transactions. De samme write-sinks sætter også
// `actor_type` og `related_entity_type`, hvis værdier kommer fra de frosne
// konstant-objekter FINANCE_ACTOR_TYPE / FINANCE_RELATED_ENTITY i
// backend/lib/economyConstants.js. Den fils egen kommentar påstod allerede at de
// "MUST matche database CHECK constraints" — men INTET håndhævede påstanden, så en
// ny nøgle i et af objekterne ville slippe grøn gennem CI og først fejle med
// check_violation (23514) på første ægte prod-INSERT. Samme bug-klasse som
// #1463/#1465/#2948, bare i nabokolonnen. Målt mod live-skemaet 2026-08-31:
// actor_type = 5 tilladte værdier, related_entity_type = 7, ingen drift i dag.
//
// rider_ownership_events (#3582) er med af samme grund: RIDER_OWNERSHIP_REASON i
// backend/lib/riderOwnershipAudit.js er endnu et frosset konstant-objekt (10 værdier)
// der skal matche rider_ownership_events_reason_check, plus tabellens egne actor_type-
// og related_entity_type-CHECKs.
// ────────────────────────────────────────────────────────────────────────────
test("HVER kode-skrevet audit-enum-værdi har en CHECK-constraint-værdi (#1464 forward-guard)", () => {
  const reports = collectAuditEnumDrift(collectScanFiles(backendRoot));
  assert.equal(
    reports.length,
    AUDIT_ENUM_COLUMNS.length,
    "collectAuditEnumDrift() rapporterede ikke for alle registrerede audit-enum-kolonner",
  );

  for (const report of reports) {
    assert.ok(
      report.source,
      `fandt ingen ${report.constraint}-definition i database/*.sql — parser sandsynligvis brudt`,
    );
    // Sanity: falder discovery under kolonnens gulv er parseren (ikke koden) brudt.
    assert.ok(
      report.codeValues.size >= report.minCodeValues,
      `forventede mindst ${report.minCodeValues} kode-skrevne ${report.table}.${report.column}-værdier, ` +
        `fandt kun ${report.codeValues.size} — konstant-/literal-parseren er sandsynligvis brudt`,
    );

    assert.deepEqual(
      report.missing.map((x) => x.value),
      [],
      report.missing.length === 0
        ? ""
        : `${report.table}.${report.column}-værdi(er) brugt i backend-koden UDEN en ` +
            `tilsvarende CHECK-constraint-værdi (en ægte prod-INSERT ville fejle med ` +
            `check_violation 23514).\n` +
            `Autoritativ CHECK parset fra: database/${report.source}\n` +
            `Manglende:\n` +
            report.missing
              .map((x) => `  - '${x.value}'  skrevet i: ${x.locations.join(", ")}`)
              .join("\n") +
            `\nFix: tilføj værdien til ${report.constraint} i en NY database/*.sql-migration ` +
            `(additiv DROP IF EXISTS + re-ADD, jf. database/2026-05-09-audit-log-foundation.sql). ` +
            `Ejeren applier migrationen (auto-applies ved merge).`,
    );
  }
});

// Negativ kontrol i DENNE suite også (den kører i `npm test --prefix backend`, altså i
// den lokale pre-flight): beviser at forward-guarden faktisk bider, ikke bare at den
// er grøn. Fixturen er en midlertidig fil med en opdigtet actor i en ægte
// write-sink-form; konstant-objekterne læses fra de rigtige filer.
test("negativ kontrol: collectAuditEnumDrift() flager en fiktiv audit-enum-værdi", () => {
  const FAKE_ACTOR = "scout_bot_never_shipped_negative_control";
  const dir = mkdtempSync(join(tmpdir(), "cz-enum-neg-backend-"));
  const file = join(dir, "fixture.js");
  writeFileSync(
    file,
    [
      "await incrementBalanceWithAudit(client, { teamId, delta, payload: {",
      '  type: "salary",',
      `  actor_type: "${FAKE_ACTOR}",`,
      "} });",
    ].join("\n"),
    "utf8",
  );

  const reports = collectAuditEnumDrift([file]);
  const financeActor = reports.find(
    report => report.table === "finance_transactions" && report.column === "actor_type",
  );
  assert.ok(financeActor, "ingen rapport for finance_transactions.actor_type");
  assert.ok(
    !financeActor.allowed.has(FAKE_ACTOR),
    "den fiktive actor findes uventet i CHECK'et — vælg en anden fiktiv streng",
  );
  assert.deepEqual(financeActor.missing.map(x => x.value), [FAKE_ACTOR]);

  // Kontrol-gruppe: de øvrige kolonner er stadig rene, så fundet stammer fra fixturen
  // og ikke fra en generelt brudt sammenligning.
  for (const other of reports.filter(report => report !== financeActor)) {
    assert.deepEqual(
      other.missing.map(x => x.value),
      [],
      `${other.table}.${other.column} skulle være ren`,
    );
  }
});

// Måltabel-attribution (review-fund på PR #4458): rå-literal-discovery må ikke tilskrive
// en rider_ownership_events-literal til finance_transactions' CHECK. De to tabellers
// CHECKs er identiske i dag, så fejlen ville være usynlig indtil de skiller sig.
test("audit-enum-literaler måles mod deres EGEN tabels CHECK (#4458-review)", () => {
  const dir = mkdtempSync(join(tmpdir(), "cz-enum-attr-backend-"));
  const file = join(dir, "fixture.js");
  writeFileSync(
    file,
    [
      "await recordRiderOwnershipEvent(supabase, {",
      "  riderId: rider.id,",
      '  actorType: "api",',
      "});",
    ].join("\n"),
    "utf8",
  );

  const keys = ["actor_type", "actorType"];
  assert.equal(
    extractLiteralEnumValues([file], keys, "finance_transactions").size,
    0,
    "en ownership-literal må ALDRIG måles mod finance_transactions' CHECK",
  );
  assert.deepEqual(
    [...extractLiteralEnumValues([file], keys, "rider_ownership_events").keys()],
    ["api"],
  );
});
