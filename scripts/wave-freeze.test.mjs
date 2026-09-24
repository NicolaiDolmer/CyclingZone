// scripts/wave-freeze.test.mjs
// ============================================================
// Tests for frys-/timeout-beregningen i boelger (#5178). Hver test svarer til
// en konkret fejl fra 11/9-boelgerne, hvor wave.js stoppede LEVENDE spor som
// "frys" (#4845 committede 12 min foer stoppet, #5159 seks minutter foer) og
// efterlod ucommittet arbejde i to worktrees.
// Run: node --test scripts/wave-freeze.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  WAVE_FREEZE,
  applySchemaEvidenceRule,
  classifyStall,
  commitAgeMinutes,
  extractInvestigateVerdict,
  needsGracefulStop,
  planIdleLane,
  planReviewAttempt,
  releasesOwnership,
  resolveTrackTimeoutMinutes,
  sortHeavyFirst,
  tailIdleLaneMinutes,
  trackWeight,
  wipCommitMessage,
} from "./wave-freeze.mjs";

const MODULE_PATH = fileURLToPath(new URL("./wave-freeze.mjs", import.meta.url));
const WAVE_JS_PATH = fileURLToPath(new URL("../.claude/workflows/wave.js", import.meta.url));

// ===== Konstanterne (issuets punkt 1 og 3) =====

test("spor-timeout er 120 min med haardt loft 180", () => {
  assert.equal(WAVE_FREEZE.TRACK_TIMEOUT_MINUTES, 120);
  assert.equal(WAVE_FREEZE.TRACK_HARD_CAP_MINUTES, 180);
});

test("stall-graensen er 45 min og reviewer har sit eget 30-min-vindue", () => {
  assert.equal(WAVE_FREEZE.BRANCH_STALL_MINUTES, 45);
  assert.equal(WAVE_FREEZE.REVIEW_TIMEOUT_MINUTES, 30);
});

test("#5220: undersoegelsesspor har et fast 60-min-vindue, prik-graensen er 15 min", () => {
  assert.equal(WAVE_FREEZE.INVESTIGATE_TIMEOUT_MINUTES, 60);
  assert.equal(WAVE_FREEZE.POKE_MINUTES, 15);
  assert.ok(
    WAVE_FREEZE.POKE_MINUTES < WAVE_FREEZE.BRANCH_STALL_MINUTES,
    "prikken skal ligge et godt stykke under frys-graensen, ellers er den bare et frys med et andet navn",
  );
});

test("resolveTrackTimeoutMinutes: default 120, klemmes af det haarde loft", () => {
  assert.equal(resolveTrackTimeoutMinutes(undefined), 120);
  assert.equal(resolveTrackTimeoutMinutes(0), 120);
  assert.equal(resolveTrackTimeoutMinutes("ikke et tal"), 120);
  assert.equal(resolveTrackTimeoutMinutes(90), 90);
  assert.equal(resolveTrackTimeoutMinutes(600), 180, "haardt loft 180");
  assert.equal(resolveTrackTimeoutMinutes(1), 10, "under-graense saa et spor ikke faar 1 min");
});

// ===== commitAgeMinutes =====

test("commitAgeMinutes regner sekunder om til minutter", () => {
  assert.equal(commitAgeMinutes(1_757_800_000, 1_757_802_000), 2000 / 60);
});

test("commitAgeMinutes giver null naar branchen ikke kan maales", () => {
  assert.equal(commitAgeMinutes(null, 1_757_802_000), null);
  assert.equal(commitAgeMinutes("", 1_757_802_000), null);
  assert.equal(commitAgeMinutes(1_757_800_000, undefined), null);
  assert.equal(commitAgeMinutes(0, 1_757_802_000), null, "ingen commits paa branchen");
});

test("commitAgeMinutes klemmer skaeve ure til 0 i stedet for negativ alder", () => {
  assert.equal(commitAgeMinutes(1_757_802_000, 1_757_800_000), 0);
});

// ===== Kernereglen: aldrig frys paa en levende branch =====

test("ACCEPT #1: en lane med commit under 45 min siden meldes ALDRIG som frys", () => {
  for (const age of [0, 1, 6, 12, 30, 44, 44.9]) {
    const d = classifyStall({ probeOk: true, lastCommitAgeMinutes: age, elapsedMinutes: 120 });
    assert.notEqual(d.verdict, "frozen", `alder ${age} min blev fejlagtigt doemt som frys`);
    assert.equal(d.stopsWave, false);
  }
});

test("de to konkrete spor fra 11/9 ville have faaet forlaenget vinduet", () => {
  // #4845: commit 12 min foer stoppet. #5159: seks minutter foer.
  for (const age of [12, 6]) {
    const d = classifyStall({ probeOk: true, lastCommitAgeMinutes: age, elapsedMinutes: 60 });
    assert.equal(d.verdict, "extend");
    assert.equal(d.reason, "branch-active");
    assert.ok(d.extendMinutes > 0);
  }
});

test("branch staaende stille i 45 min eller mere er et frys der stopper boelgen", () => {
  for (const age of [45, 46, 90, 300]) {
    const d = classifyStall({ probeOk: true, lastCommitAgeMinutes: age, elapsedMinutes: 120 });
    assert.equal(d.verdict, "frozen");
    assert.equal(d.reason, "branch-stall");
    assert.equal(d.stopsWave, true);
    assert.equal(d.extendMinutes, 0);
  }
});

test("kan branchen ikke maales, doemmes konservativt som frys", () => {
  const cases = [
    { probeOk: false, lastCommitAgeMinutes: 3, elapsedMinutes: 120 },
    { probeOk: true, lastCommitAgeMinutes: null, elapsedMinutes: 120 },
    { probeOk: true, lastCommitAgeMinutes: "n/a", elapsedMinutes: 120 },
  ];
  for (const c of cases) {
    const d = classifyStall(c);
    assert.equal(d.verdict, "frozen");
    assert.equal(d.reason, "probe-failed");
    assert.equal(d.stopsWave, true);
  }
  assert.equal(classifyStall(undefined).verdict, "frozen");
});

// ===== Forlaengelsen =====

test("forlaengelsen raekker praecis til branchen ville blive 45 min gammel", () => {
  const d = classifyStall({ probeOk: true, lastCommitAgeMinutes: 20, elapsedMinutes: 120 });
  assert.equal(d.extendMinutes, 25);
});

test("forlaengelsen har en bund saa der ikke probes i et vaek lige under graensen", () => {
  const d = classifyStall({ probeOk: true, lastCommitAgeMinutes: 44, elapsedMinutes: 120 });
  assert.equal(d.extendMinutes, WAVE_FREEZE.MIN_EXTENSION_MINUTES);
});

test("forlaengelsen kan aldrig loefte sporet over det haarde loft", () => {
  const d = classifyStall({ probeOk: true, lastCommitAgeMinutes: 5, elapsedMinutes: 170 });
  assert.equal(d.verdict, "extend");
  assert.equal(d.extendMinutes, 10, "180 - 170 = 10 min tilbage, ikke de oenskede 40");
});

test("haardt loft naaet med levende branch er IKKE et frys - boelgen koerer videre", () => {
  const d = classifyStall({ probeOk: true, lastCommitAgeMinutes: 3, elapsedMinutes: 180 });
  assert.equal(d.verdict, "hard-cap");
  assert.equal(d.reason, "hard-cap-reached");
  assert.equal(d.stopsWave, false, "et stort spor er ikke et frossent spor");
  assert.equal(d.extendMinutes, 0);
});

test("stall slaar hard-cap: en doed branch paa 180 min er stadig et frys", () => {
  const d = classifyStall({ probeOk: true, lastCommitAgeMinutes: 60, elapsedMinutes: 200 });
  assert.equal(d.verdict, "frozen");
  assert.equal(d.stopsWave, true);
});

test("stall- og hard-cap-graenser kan overstyres (bruges af CLI'ens flag)", () => {
  const d = classifyStall({
    probeOk: true,
    lastCommitAgeMinutes: 20,
    elapsedMinutes: 30,
    stallMinutes: 15,
    hardCapMinutes: 60,
  });
  assert.equal(d.verdict, "frozen", "20 min > overstyret stall paa 15");
});

// ===== Reviewer (issuets punkt 3) =====

test("ACCEPT #2: reviewer der ikke svarer inden 30 min gen-spawnes praecis EEN gang", () => {
  const first = planReviewAttempt(1);
  assert.equal(first.timeoutMinutes, 30);
  assert.equal(first.respawn, true);
  assert.equal(first.final, false);

  const second = planReviewAttempt(2);
  assert.equal(second.timeoutMinutes, 30);
  assert.equal(second.respawn, false, "ikke et gen-spawn nummer to");
  assert.equal(second.final, true);

  assert.equal(planReviewAttempt(3).respawn, false);
  assert.equal(planReviewAttempt(0).attempt, 1, "0 og under behandles som foerste forsoeg");
});

// ===== Graceful stop (issuets punkt 4) =====

test("ACCEPT #3: dirty eller upushet worktree udloeser den graceful stop-agent", () => {
  assert.equal(needsGracefulStop({ probeOk: true, dirty: true, unpushed: 0 }), true);
  assert.equal(needsGracefulStop({ probeOk: true, dirty: false, unpushed: 2 }), true);
});

test("et rent og pushet worktree behoever ingen stop-agent", () => {
  assert.equal(needsGracefulStop({ probeOk: true, dirty: false, unpushed: 0 }), false);
});

test("umaaleligt antal upushede commits er IKKE nul - branchen kan mangle upstream", () => {
  // `git rev-list --count @{u}..HEAD` fejler netop naar branchen aldrig er
  // pushet, og dér ligger HVER commit kun lokalt. -1/NaN/manglende felt maa
  // aldrig laeses som "alt er i hus".
  for (const unpushed of [-1, NaN, undefined, null, "n/a"]) {
    assert.equal(
      needsGracefulStop({ probeOk: true, dirty: false, unpushed }),
      true,
      `unpushed=${String(unpushed)} blev fejlagtigt laest som nul upushede commits`,
    );
  }
});

test("ukendt tilstand koerer stop-agenten - et dirty worktree er dyrere", () => {
  assert.equal(needsGracefulStop({ probeOk: false, dirty: false, unpushed: 0 }), true);
  assert.equal(needsGracefulStop(undefined), true);
});

test("hard-cap koerer ALDRIG stop-agenten - lane-agenten arbejder stadig i worktreet", () => {
  // En boelge-timeout afbryder ikke agenten. Ved hard-cap lever branchen pr.
  // definition, saa to agenter ville slaas om index.lock i samme worktree.
  assert.equal(needsGracefulStop({ verdict: "hard-cap", probeOk: true, dirty: true, unpushed: 4 }), false);
  assert.equal(needsGracefulStop({ verdict: "hard-cap", probeOk: false, dirty: true, unpushed: 4 }), false);
  // Frys og doed agent redder derimod arbejdet som foer.
  assert.equal(needsGracefulStop({ verdict: "frozen", probeOk: true, dirty: true, unpushed: 0 }), true);
  assert.equal(needsGracefulStop({ verdict: "doed", probeOk: false }), true);
});

test("WIP-commit-beskeden er den ordret aftalte fra #5178", () => {
  assert.equal(wipCommitMessage(5159), "wip(#5159): boelge-timeout, ucommittet arbejde gemt");
});

// ===== Tungeste spor foerst (#5562, erstatter #5220's blandede koe) =====

test("trackWeight: FULL vejer 2, opus 1, lette spor 0 - ugyldigt spor 0", () => {
  assert.equal(trackWeight({ model: "opus", tier: "FULL" }), 3);
  assert.equal(trackWeight({ model: "sonnet", tier: "FULL" }), 2);
  assert.equal(trackWeight({ model: "opus", tier: "TARGETED" }), 1);
  assert.equal(trackWeight({ model: "sonnet", tier: "TARGETED" }), 0);
  assert.equal(trackWeight(null), 0);
  assert.equal(trackWeight(undefined), 0);
});

test("sortHeavyFirst: tungeste forrest, stabil inden for samme vaegt", () => {
  const light1 = { id: "light1", model: "sonnet", tier: "TARGETED" };
  const opus1 = { id: "opus1", model: "opus", tier: "TARGETED" };
  const full = { id: "full", model: "opus", tier: "FULL" };
  const light2 = { id: "light2", model: "sonnet", tier: "TARGETED" };
  const opus2 = { id: "opus2", model: "opus", tier: "TARGETED" };
  const sonnetFull = { id: "sonnetFull", model: "sonnet", tier: "FULL" };
  const sorted = sortHeavyFirst([light1, opus1, full, light2, opus2, sonnetFull]);
  assert.deepEqual(
    sorted.map((t) => t.id),
    ["full", "sonnetFull", "opus1", "opus2", "light1", "light2"],
    "faldende vaegt; orkestratorens raekkefoelge er tie-breaker inden for samme vaegt",
  );
});

test("sortHeavyFirst: boelge A 23/9 - det tunge spor starter foerst, ikke sidst", () => {
  // Den gamle blandede koe lagde det tunge spor bagerst, saa det koerte alene i halen.
  const queue = [
    ...Array.from({ length: 11 }, (_, i) => ({ id: `let-${i}`, model: "sonnet", tier: "TARGETED" })),
    { id: "tungt", model: "opus", tier: "FULL" },
  ];
  assert.equal(sortHeavyFirst(queue)[0].id, "tungt");
});

test("sortHeavyFirst: en koe med ens vaegt rykkes ikke rundt, og input muteres ikke", () => {
  const allLight = [{ id: 1, model: "sonnet", tier: "TARGETED" }, { id: 2, model: "sonnet", tier: "TARGETED" }];
  assert.deepEqual(sortHeavyFirst(allLight), allLight);
  const input = [{ id: "a", model: "sonnet", tier: "TARGETED" }, { id: "b", model: "opus", tier: "FULL" }];
  const before = input.map((t) => t.id);
  sortHeavyFirst(input);
  assert.deepEqual(input.map((t) => t.id), before);
});

test("sortHeavyFirst: tom eller ugyldig liste giver et tomt array, ikke en fejl", () => {
  assert.deepEqual(sortHeavyFirst([]), []);
  assert.deepEqual(sortHeavyFirst(null), []);
  assert.deepEqual(sortHeavyFirst(undefined), []);
});

// ===== Rullende optag (#5562) =====

test("planIdleLane: frys vinder over alt andet", () => {
  assert.equal(planIdleLane({ queued: 3, activeLanes: 2, stoppedByFreeze: true, intakeEmpty: false }), "exit");
});

test("planIdleLane: et spor i koen tages", () => {
  assert.equal(planIdleLane({ queued: 1, activeLanes: 0, stoppedByFreeze: false, intakeEmpty: true }), "take");
  assert.equal(planIdleLane({ queued: 1, activeLanes: 0, stoppedByFreeze: false, intakeEmpty: true, intakeEnabled: false }), "take");
});

test("planIdleLane: tom koe uden optag (rollingIntake=false eller intake doed) lukker lanen", () => {
  assert.equal(planIdleLane({ queued: 0, activeLanes: 3, stoppedByFreeze: false, intakeEmpty: false, intakeEnabled: false }), "exit");
});

test("planIdleLane: tom koe -> intake, saa laenge intake ikke lige har givet intet", () => {
  assert.equal(planIdleLane({ queued: 0, activeLanes: 2, stoppedByFreeze: false, intakeEmpty: false }), "intake");
  assert.equal(planIdleLane({ queued: 0, activeLanes: 0, stoppedByFreeze: false, intakeEmpty: false }), "intake", "et sidste optag foer boelgen slutter");
});

test("planIdleLane: intake gav intet og andre laner koerer -> vent; ellers exit", () => {
  assert.equal(planIdleLane({ queued: 0, activeLanes: 1, stoppedByFreeze: false, intakeEmpty: true }), "wait");
  assert.equal(planIdleLane({ queued: 0, activeLanes: 0, stoppedByFreeze: false, intakeEmpty: true }), "exit");
});

test("planIdleLane: manglende eller ugyldig tilstand giver aldrig 'take' paa en tom koe", () => {
  assert.equal(planIdleLane(undefined), "intake");
  assert.equal(planIdleLane({ queued: "n/a", intakeEmpty: true }), "exit");
});

test("releasesOwnership: kun beviseligt faerdige spor frigiver ejerskab", () => {
  for (const s of ["bygget", "rettet", "undersoegt", "undersoegt-ufuldstaendig"]) {
    assert.equal(releasesOwnership(s), true, s);
  }
  // En timeout afbryder ikke agenten - den kan stadig skrive i worktreet.
  for (const s of ["timeout", "investigate-timeout", "frys", "doed", "fejl", "rettelse-mangler", undefined, null, ""]) {
    assert.equal(releasesOwnership(s), false, String(s));
  }
});

test("INTAKE_POLL_MINUTES er 10 og intake-loftet ligger over poll-intervallet", () => {
  assert.equal(WAVE_FREEZE.INTAKE_POLL_MINUTES, 10);
  assert.ok(WAVE_FREEZE.INTAKE_TIMEOUT_MINUTES > WAVE_FREEZE.INTAKE_POLL_MINUTES);
});

// ===== Reviewerens skema-bevisregel (#5567) =====

const blocking = (extra) => ({ severity: "blokerende", file: "backend/x.js", what: "kolonnen fixture_col mangler i tabellen", ...extra });

test("applySchemaEvidenceRule: et data-fund uden bevis nedgraderes, og dommen bliver BEMAERKNINGER", () => {
  const review = { verdict: "BLOKERENDE", summary: "s", findings: [blocking({ category: "data-skema", evidence: "laeste diffen" })] };
  const { review: out, downgraded } = applySchemaEvidenceRule(review);
  assert.equal(downgraded.length, 1);
  assert.equal(out.findings[0].severity, "bemaerkning");
  assert.equal(out.findings[0].note, "nedgraderet: mangler skema-/prod-opslag (#5567)");
  assert.equal(out.verdict, "BEMAERKNINGER", "ingen blokerende fund tilbage -> ret-trinnet springes over");
  assert.equal(review.findings[0].severity, "blokerende", "input muteres ikke");
});

test("applySchemaEvidenceRule: fund UDEN category med skema-ord nedgraderes ogsaa", () => {
  for (const what of ["column x is missing", "mangler NOT NULL", "constraint brydes", "migrationen dropper data", "RLS mangler", "foreign key peger forkert", "enum-vaerdien findes ikke"]) {
    const { downgraded } = applySchemaEvidenceRule({ verdict: "BLOKERENDE", findings: [{ severity: "blokerende", what }] });
    assert.equal(downgraded.length, 1, what);
  }
});

test("applySchemaEvidenceRule: henvisning til schema-snapshot.json eller en SELECT bevarer fundet", () => {
  for (const evidence of [
    "database/schema-snapshot.json: relations.fixture_table.columns har ikke fixture_col",
    "Supabase MCP: select column_name from information_schema.columns where table_name = 'fixture_table'",
  ]) {
    const review = { verdict: "BLOKERENDE", findings: [blocking({ category: "data-skema", evidence })] };
    const { review: out, downgraded } = applySchemaEvidenceRule(review);
    assert.equal(downgraded.length, 0, evidence);
    assert.equal(out.verdict, "BLOKERENDE");
    assert.equal(out.findings[0].severity, "blokerende");
  }
});

test("applySchemaEvidenceRule: et UI-fund (category andet) roeres ikke", () => {
  const review = { verdict: "BLOKERENDE", findings: [{ severity: "blokerende", category: "andet", what: "tabellen flyder ud paa mobil" }] };
  const { review: out, downgraded } = applySchemaEvidenceRule(review);
  assert.equal(downgraded.length, 0);
  assert.equal(out, review);
});

test("applySchemaEvidenceRule: en blandet liste nedgraderer kun data-fundet og beholder BLOKERENDE", () => {
  const review = {
    verdict: "BLOKERENDE",
    findings: [
      blocking({ category: "data-skema", evidence: "" }),
      { severity: "blokerende", category: "forbudte-filer", what: "docs/NOW.md er roert" },
      { severity: "bemaerkning", category: "andet", what: "navngivning" },
    ],
  };
  const { review: out, downgraded } = applySchemaEvidenceRule(review);
  assert.equal(downgraded.length, 1);
  assert.deepEqual(out.findings.map((f) => f.severity), ["bemaerkning", "blokerende", "bemaerkning"]);
  assert.equal(out.verdict, "BLOKERENDE", "et andet blokerende fund staar tilbage");
});

test("applySchemaEvidenceRule: BLOKERENDE uden findings-liste og ugyldigt input er uaendret", () => {
  const bare = { verdict: "BLOKERENDE", summary: "ingen liste" };
  assert.equal(applySchemaEvidenceRule(bare).review, bare);
  assert.deepEqual(applySchemaEvidenceRule(bare).downgraded, []);
  assert.equal(applySchemaEvidenceRule(null).review, null);
});

// ===== Hale-tomgang (#5562) =====

test("tailIdleLaneMinutes: profil som boelge A 23/9 - eet tungt spor alene til sidst", () => {
  // 4 laner, 197 min. Det tunge spor starter i minut 139 og slutter i 192;
  // de tre andre laner bliver faerdige i minut 141, 154 og 160.
  const intervals = [
    { lane: 0, start: 80, end: 141 },
    { lane: 1, start: 95, end: 154 },
    { lane: 2, start: 110, end: 160 },
    { lane: 3, start: 139, end: 192 },
  ];
  const r = tailIdleLaneMinutes({ intervals, lanes: 4, endMinute: 197 });
  assert.equal(r.tailStartMinute, 139);
  // (197-139)*4 = 232 lane-minutter, heraf 2+15+21+53 = 91 optaget.
  assert.equal(r.idleLaneMinutes, 141);
  assert.equal(r.capacityPct, 17.9, "141 / (4 x 197) = 17,9 %");
});

test("tailIdleLaneMinutes: en boelge uden hale giver 0", () => {
  const intervals = [
    { lane: 0, start: 0, end: 30 }, { lane: 1, start: 0, end: 30 }, { lane: 2, start: 0, end: 30 }, { lane: 3, start: 0, end: 30 },
    { lane: 0, start: 30, end: 60 }, { lane: 1, start: 30, end: 60 }, { lane: 2, start: 30, end: 60 }, { lane: 3, start: 30, end: 60 },
  ];
  assert.deepEqual(tailIdleLaneMinutes({ intervals, lanes: 4, endMinute: 60 }), { tailStartMinute: 30, idleLaneMinutes: 0, capacityPct: 0 });
});

test("tailIdleLaneMinutes: en lukket lane (timeout) taeller som optaget til boelgens slut", () => {
  const intervals = [
    { lane: 0, start: 0, end: 20, closed: true },
    { lane: 1, start: 10, end: 40 },
  ];
  const r = tailIdleLaneMinutes({ intervals, lanes: 2, endMinute: 50 });
  // Halen starter i minut 10: lane 0 er optaget 10-50 (40), lane 1 10-40 (30).
  assert.equal(r.idleLaneMinutes, 2 * 40 - 40 - 30);
});

test("tailIdleLaneMinutes: tom maaling giver nul og ingen division med nul", () => {
  assert.deepEqual(tailIdleLaneMinutes({ intervals: [], lanes: 4, endMinute: 30 }), { tailStartMinute: 30, idleLaneMinutes: 0, capacityPct: 0 });
  assert.deepEqual(tailIdleLaneMinutes(undefined), { tailStartMinute: 0, idleLaneMinutes: 0, capacityPct: 0 });
  assert.equal(tailIdleLaneMinutes({ intervals: [{ start: 0, end: 5 }], lanes: 4, endMinute: 0 }).capacityPct, 0);
});

// ===== extractInvestigateVerdict (#5220, CodeRabbit-fund) =====

test("extractInvestigateVerdict genkender begge tvungne domme", () => {
  assert.equal(extractInvestigateVerdict("Undersoegt grundigt.\n\nbekraeftet + fix-plan: gør X."), "bekraeftet");
  assert.equal(extractInvestigateVerdict("Kunne ikke reproducere.\n\nafvist + bevis-test: se test-output."), "afvist");
});

test("extractInvestigateVerdict er case-insensitiv", () => {
  assert.equal(extractInvestigateVerdict("BEKRAEFTET + FIX-PLAN"), "bekraeftet");
});

test("extractInvestigateVerdict giver null naar ingen af de to fraser findes - ALDRIG en gaettet dom", () => {
  assert.equal(extractInvestigateVerdict("ved ikke, maaske er der et problem"), null);
  assert.equal(extractInvestigateVerdict(""), null);
  assert.equal(extractInvestigateVerdict(null), null);
  assert.equal(extractInvestigateVerdict(undefined), null);
});

test("extractInvestigateVerdict giver null ved modstridende svar (begge fraser til stede)", () => {
  assert.equal(extractInvestigateVerdict("bekraeftet + fix-plan men ogsaa afvist + bevis-test"), null);
});

// ===== CLI'en som probe-agenten kalder =====

test("CLI'en returnerer en JSON-dom paa stdout", () => {
  const out = execFileSync(
    process.execPath,
    [
      MODULE_PATH,
      "--last-commit-epoch",
      "1757800000",
      "--now-epoch",
      "1757800600", // 10 min senere
      "--elapsed-minutes",
      "120",
      "--dirty",
      "--unpushed",
      "3",
    ],
    { encoding: "utf8" },
  );
  const d = JSON.parse(out);
  assert.equal(d.verdict, "extend");
  assert.equal(d.reason, "branch-active");
  assert.equal(d.lastCommitAgeMinutes, 10);
  assert.equal(d.dirty, true);
  assert.equal(d.unpushed, 3);
  assert.equal(d.gracefulStop, true);
  assert.equal(d.extendMinutes, 35);
});

test("CLI'en melder frys naar branchen har staaet stille", () => {
  const out = execFileSync(
    process.execPath,
    [MODULE_PATH, "--last-commit-epoch", "1757800000", "--now-epoch", "1757804000", "--elapsed-minutes", "120"],
    { encoding: "utf8" },
  );
  const d = JSON.parse(out);
  assert.equal(d.verdict, "frozen");
  assert.equal(d.reason, "branch-stall");
  assert.equal(d.stopsWave, true);
});

test("CLI'en uden --unpushed melder ukendt (-1), ikke nul", () => {
  const out = execFileSync(
    process.execPath,
    [MODULE_PATH, "--last-commit-epoch", "1757800000", "--now-epoch", "1757800600", "--elapsed-minutes", "120"],
    { encoding: "utf8" },
  );
  const d = JSON.parse(out);
  assert.equal(d.unpushed, -1);
  assert.equal(d.gracefulStop, true, "ukendt push-status skal udloese en redning");
});

test("CLI'en melder frys naar branchen slet ikke kunne maales", () => {
  const out = execFileSync(process.execPath, [MODULE_PATH, "--elapsed-minutes", "120"], { encoding: "utf8" });
  const d = JSON.parse(out);
  assert.equal(d.verdict, "frozen");
  assert.equal(d.reason, "probe-failed");
  assert.equal(d.gracefulStop, true, "ukendt tilstand -> red arbejdet");
});

// ===== Drift-vagt mod wave.js =====
// wave.js kan ikke importere dette modul (workflow-scripts har ingen Node-API-
// adgang), saa konstanterne staar to steder. Uden denne vagt ville de drifte
// fra hinanden i stilhed - praecis den fejlklasse #5178 handler om.

test("wave.js spejler konstanterne fra dette modul", () => {
  const src = readFileSync(WAVE_JS_PATH, "utf8");
  const mirrored = {
    TRACK_TIMEOUT_MINUTES: WAVE_FREEZE.TRACK_TIMEOUT_MINUTES,
    TRACK_HARD_CAP_MINUTES: WAVE_FREEZE.TRACK_HARD_CAP_MINUTES,
    TRACK_MIN_TIMEOUT_MINUTES: WAVE_FREEZE.TRACK_MIN_TIMEOUT_MINUTES,
    BRANCH_STALL_MINUTES: WAVE_FREEZE.BRANCH_STALL_MINUTES,
    MIN_EXTENSION_MINUTES: WAVE_FREEZE.MIN_EXTENSION_MINUTES,
    REVIEW_TIMEOUT_MINUTES: WAVE_FREEZE.REVIEW_TIMEOUT_MINUTES,
    REVIEW_MAX_ATTEMPTS: WAVE_FREEZE.REVIEW_MAX_ATTEMPTS,
    PROBE_TIMEOUT_MINUTES: WAVE_FREEZE.PROBE_TIMEOUT_MINUTES,
    STOP_TIMEOUT_MINUTES: WAVE_FREEZE.STOP_TIMEOUT_MINUTES,
    INVESTIGATE_TIMEOUT_MINUTES: WAVE_FREEZE.INVESTIGATE_TIMEOUT_MINUTES,
    POKE_MINUTES: WAVE_FREEZE.POKE_MINUTES,
    INTAKE_POLL_MINUTES: WAVE_FREEZE.INTAKE_POLL_MINUTES,
    INTAKE_TIMEOUT_MINUTES: WAVE_FREEZE.INTAKE_TIMEOUT_MINUTES,
  };
  assert.deepEqual(
    Object.keys(WAVE_FREEZE).sort(),
    Object.keys(mirrored).sort(),
    "en ny konstant i modulet skal ogsaa ind i denne drift-vagt (og i wave.js)",
  );
  for (const [key, value] of Object.entries(mirrored)) {
    const m = src.match(new RegExp(`^\\s*${key}:\\s*(\\d+)\\s*,`, "m"));
    assert.ok(m, `wave.js mangler den spejlede konstant ${key}`);
    assert.equal(
      Number(m[1]),
      value,
      `wave.js har ${key}=${m[1]}, modulet har ${value} - de skal vaere ens (se kommentaren i wave-freeze.mjs)`,
    );
  }
});

// assert.ok med egen besked frem for assert.match: en fejlet match dumper hele
// wave.js (20 kB) i testoutputtet og gemmer den egentlige besked.
test("wave.js peger paa dette modul som kilde og bruger stadig LF", () => {
  const src = readFileSync(WAVE_JS_PATH, "utf8");
  assert.ok(src.includes("scripts/wave-freeze.mjs"), "wave.js skal pege paa kilden til frys-reglen");
  assert.ok(!src.includes("\r"), "wave.js skal have LF - Claude Desktop afviser CR som kontroltegn (#5142)");
});

test("wave.js klemmer probens forlaengelse mod det haarde loft", () => {
  // CodeRabbit 13/9: paa den betroede sti kom extendMinutes direkte fra
  // probe-agenten uden at blive holdt op mod loftet. Loftet er orkestratorens.
  const src = readFileSync(WAVE_JS_PATH, "utf8");
  assert.ok(
    src.includes("TRACK_HARD_CAP_MINUTES - elapsedMinutes"),
    "wave.js skal klemme enhver forlaengelse mod den resterende tid under loftet",
  );
});

test("wave.js bogfoerer probens tid, saa det haarde loft ikke kan overskrides", () => {
  // CodeRabbit 13/9: elapsedMinutes voksede kun med ventevinduerne, ikke med
  // probernes egen tid, saa et spor kunne ligge ~1 time over det "absolutte"
  // loft. Workflow-scripts har ingen Date.now(), saa loesningen er at bogfoere
  // probens OEVRE graense - aldrig et for lavt tal.
  const src = readFileSync(WAVE_JS_PATH, "utf8");
  assert.ok(
    src.includes("elapsedMinutes += WAVE_FREEZE.PROBE_TIMEOUT_MINUTES"),
    "wave.js skal laegge probens oevre tidsforbrug til elapsedMinutes",
  );
  // Kun KODE-linjer: headeren omtaler bevidst Date.now() som noget der mangler.
  const code = src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
  assert.ok(!/\bDate\.now\(\)/.test(code), "Date.now() kaster i workflow-scripts - maa aldrig kaldes i wave.js");
  assert.ok(!/\bMath\.random\(\)/.test(code), "Math.random() kaster i workflow-scripts");
});

test("#5562: wave.js sorterer koeen tungeste foerst - den blandede koe fra #5220 er vaek", () => {
  const src = readFileSync(WAVE_JS_PATH, "utf8");
  assert.ok(src.includes("const tracks = sortHeavyFirst(rawTracks.map(normalizeTrack))"), "startkoeen skal sorteres med sortHeavyFirst()");
  assert.ok(src.includes("queue.push(...sorted)") && src.includes("sortHeavyFirst(intake.ready)"), "optagne spor skal ogsaa sorteres tungeste foerst");
  assert.ok(!src.includes("sortMixedQueue") && !src.includes("isLightTrack"), "den gamle blandede koe maa ikke staa i wave.js");
});

test("#5562: semaforen er uaendret - verify-lock -Max 2, verifyMax: 2 og maks EET FULL-spor", () => {
  // Tungeste foerst er kun sikkert fordi disse tre haandhaeves uafhaengigt af koeen.
  const src = readFileSync(WAVE_JS_PATH, "utf8");
  assert.ok(src.includes('verify-lock.ps1" -Max 2 -Timeout 1800'), "lane- og ret-prompterne skal wrappe tunge kommandoer i verify-lock.ps1 -Max 2");
  assert.equal((src.match(/verifyMax: 2,/g) || []).length, 2, "baade dry-run- og slut-rapporten skal melde verifyMax: 2");
  assert.ok(
    src.includes("const fullTiers = tracks.filter((t) => t.tier === 'FULL')") && src.includes("if (fullTiers.length > 1) {"),
    "wave.js skal afvise mere end EET FULL-spor",
  );
});

// Normaliseret funktionstekst: uden kommentarer, semikolon og whitespace, og
// med ' og " behandlet ens. Saa fejler vagten kun paa en reel aendring.
function extractFunction(src, name) {
  const start = src.search(new RegExp(`\\bfunction ${name}\\(`));
  if (start < 0) return null;
  let i = src.indexOf("(", start);
  let depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")" && --depth === 0) break;
  }
  i = src.indexOf("{", i);
  depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
}
function normalizeFunction(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/.*$/gm, "")
    .replace(/;/g, "")
    .replace(/\s+/g, "")
    .replace(/"/g, "'");
}

test("#5562/#5567: de spejlede funktioner er identiske i wave.js og modulet", () => {
  const waveSrc = readFileSync(WAVE_JS_PATH, "utf8");
  const moduleSrc = readFileSync(MODULE_PATH, "utf8");
  for (const name of ["trackWeight", "sortHeavyFirst", "planIdleLane", "releasesOwnership", "applySchemaEvidenceRule", "tailIdleLaneMinutes"]) {
    const inWave = extractFunction(waveSrc, name);
    const inModule = extractFunction(moduleSrc, name);
    assert.ok(inWave, `wave.js mangler den spejlede funktion ${name}()`);
    assert.ok(inModule, `wave-freeze.mjs mangler ${name}()`);
    assert.ok(
      normalizeFunction(inWave) === normalizeFunction(inModule),
      `${name}() er rettet det ene sted men ikke det andet - hold wave.js og scripts/wave-freeze.mjs identiske`,
    );
  }
});

test("drift-vagten opdager en aendring i en spejlet funktion", () => {
  const a = "function f(x) {\n  // kommentar\n  return x === 'a';\n}";
  assert.equal(normalizeFunction(a), normalizeFunction('function f(x) { return x === "a" }'));
  assert.notEqual(normalizeFunction(a), normalizeFunction("function f(x) { return x === 'b' }"));
  assert.equal(extractFunction("const y = 1\nfunction g({ a }) { if (a) { return 1 } return 2 }\nfoo()", "g"), "function g({ a }) { if (a) { return 1 } return 2 }");
});

test("#5562: rullende optag bruger WAVE-SETUP-praefikset og deler trin 2-3b med fase 0", () => {
  const src = readFileSync(WAVE_JS_PATH, "utf8");
  assert.ok(src.includes("'WAVE-SETUP: intake til rullende optag (#5562)'"), "intake-agenten skal have WAVE-SETUP-praefikset, saa guard-agent-spawn.sh lader den passere");
  assert.equal((src.match(/\.\.\.trackSetupSteps\(\)/g) || []).length, 2, "fase 0 og intake skal begge bruge trackSetupSteps()");
  assert.ok(/label, phase: 'Laner', model: 'sonnet', schema: INTAKE_SCHEMA/.test(src), "intake-agenten koerer paa sonnet med INTAKE_SCHEMA");
  assert.ok(src.includes("const laneCount = lanes"), "alle laner starter, ogsaa naar koeen er kortere");
  assert.ok(src.includes("planIdleLane({") && src.includes("releasesOwnership(row.status)"), "lane-poolen skal bruge de spejlede planIdleLane() og releasesOwnership()");
  assert.ok(src.includes("cleanupPrompt(allTracks,"), "oprydningen skal have ALLE boelgens branches, ogsaa de optagne");
  assert.ok(src.includes("'koeet men aldrig optaget'"), "spor der stod i koe ved release skal rapporteres som unstarted");
  assert.ok(src.includes("input.rollingIntake !== false"), "args.rollingIntake: false slaar optaget fra; default er til");
});

test("#5567: reviewer koerer paa opus, og skema-bevisreglen haandhaeves i koden", () => {
  const src = readFileSync(WAVE_JS_PATH, "utf8");
  const reviewCall = src.slice(src.indexOf("agent(reviewPrompt(track, attempt), {"), src.indexOf("schema: REVIEW_SCHEMA,"));
  assert.ok(reviewCall.includes("model: 'opus'"), "reviewer-agenten skal koere paa opus, sat eksplicit");
  assert.ok(src.includes("const evidence = applySchemaEvidenceRule(review)"), "reviewerens dom skal gennem applySchemaEvidenceRule() foer ret-trinnet");
  assert.ok(src.includes("row.reviewDowngraded"), "nedgraderinger skal staa i sporets raekke");
  assert.ok(src.includes("enum: ['data-skema', 'scope', 'forbudte-filer', 'secrets', 'verifikation', 'andet']"), "REVIEW_SCHEMA skal have category-enum");
  assert.ok(src.includes("database/schema-snapshot.json (relations.<tabel>.columns)"), "reviewPrompt skal kraeve skema-opslag (punkt 9)");
  assert.ok(/label: `frys-probe #\$\{track\.issue\}`,\s*phase: 'Laner',\s*model: 'sonnet'/.test(src), "proben forbliver sonnet");
});

test("#5507: reviewPrompt faar script-output + issuets seneste kommentarer og har bevis-, kaldesteds- og maalepunkts-tjek", () => {
  const src = readFileSync(WAVE_JS_PATH, "utf8");
  const prompt = extractFunction(src, "reviewPrompt");
  assert.ok(prompt, "wave.js mangler reviewPrompt()");
  assert.ok(prompt.includes("scripts\\\\check-pr-claims.mjs\" --pr <PR-nummer>"), "revieweren skal koere paastands-tjekket som input");
  assert.ok(prompt.includes("scripts\\\\check-flag-liveness.mjs"), "revieweren skal koere kontakt-vagten som input");
  assert.ok(prompt.includes("--comments"), "revieweren skal laese issuets seneste kommentarer");
  assert.ok(/'10\. BEVIS \(#5507\)/.test(prompt), "punkt 10: bevis for hvert verificeret-[x]");
  assert.ok(/'11\. NY KONTAKT \(#5507\)/.test(prompt) && prompt.includes("ALLE kaldesteder"), "punkt 11: list alle kaldesteder for en ny kontakt");
  assert.ok(/'12\. MAALEPUNKT \(#5507\)/.test(prompt) && prompt.includes("allerede var groent"), "punkt 12: maalepunkt uaendret eller allerede groent");
  for (const script of ["check-pr-claims.mjs", "check-flag-liveness.mjs"]) {
    assert.ok(existsSync(fileURLToPath(new URL(`./${script}`, import.meta.url))), `reviewPrompt peger paa scripts/${script}, som skal findes`);
  }
});

test("#5562: hale-tomgang maales med et minut-ur der ryddes foer return", () => {
  const src = readFileSync(WAVE_JS_PATH, "utf8");
  assert.ok(src.includes("clock.timer = setTimeout(tick, 60 * 1000)"), "minut-uret er et selv-genplanlagt setTimeout");
  assert.ok(/finally \{\s*laneEndMinute = clock\.minute\s*stopMinuteClock\(\)/.test(src), "uret skal stoppes i finally, saa det ikke holder scriptet i live");
  assert.ok(src.includes("log(`Hale-tomgang: ${tailIdle.idleLaneMinutes} lane-minutter (${tailIdle.capacityPct} % af kapacitet)`)"), "loggen skal have hale-tomgangs-linjen");
  assert.ok(/\n\s*tailIdle,\n/.test(src), "returobjektet skal have tailIdle");
});

test("#5220: wave.js har en investigate-gren med det spejlede faste vindue", () => {
  const src = readFileSync(WAVE_JS_PATH, "utf8");
  assert.ok(src.includes("'investigate'"), "wave.js skal kende sporets kind: 'investigate'");
  assert.ok(
    src.includes("INVESTIGATE_TIMEOUT_MINUTES"),
    "investigate-grenen skal bruge den spejlede WAVE_FREEZE.INVESTIGATE_TIMEOUT_MINUTES, ikke et haardkodet tal",
  );
});

test("#5220 (CodeRabbit-fund): wave.js validerer investigate-dommen i stedet for at acceptere ethvert svar", () => {
  const src = readFileSync(WAVE_JS_PATH, "utf8");
  assert.ok(
    src.includes("extractInvestigateVerdict"),
    "runInvestigateTrack skal bruge den spejlede extractInvestigateVerdict() - ikke acceptere et vilkaarligt svar som gyldig dom",
  );
});

test("wave.js har ikke laengere den gamle 60-minutters frys-model", () => {
  const src = readFileSync(WAVE_JS_PATH, "utf8");
  assert.ok(!src.includes("per-spor-timeout 60 min"), "den gamle 60-min-tekst staar stadig i wave.js");
  assert.ok(!/\bTRACK_TIMEOUT_MS\s*=\s*60\b/.test(src), "wave.js har stadig den haardkodede 60-min-timeout");
  assert.ok(/probe/i.test(src), "wave.js skal maale branchen via en probe-agent");
  assert.ok(
    src.includes("branch-aktivitet") || src.includes("branch-stall"),
    "wave.js skal beskrive frys som maalt paa branch-aktivitet",
  );
});
