// scripts/wave-freeze.test.mjs
// ============================================================
// Tests for frys-/timeout-beregningen i boelger (#5178). Hver test svarer til
// en konkret fejl fra 11/9-boelgerne, hvor wave.js stoppede LEVENDE spor som
// "frys" (#4845 committede 12 min foer stoppet, #5159 seks minutter foer) og
// efterlod ucommittet arbejde i to worktrees.
// Run: node --test scripts/wave-freeze.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  WAVE_FREEZE,
  classifyStall,
  commitAgeMinutes,
  extractInvestigateVerdict,
  isLightTrack,
  needsGracefulStop,
  planReviewAttempt,
  resolveTrackTimeoutMinutes,
  sortMixedQueue,
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

// ===== Blandet koe (#5220) =====

test("isLightTrack: kun sonnet+TARGETED er let - opus og/eller FULL er tungt", () => {
  assert.equal(isLightTrack({ model: "sonnet", tier: "TARGETED" }), true);
  assert.equal(isLightTrack({ model: "opus", tier: "TARGETED" }), false);
  assert.equal(isLightTrack({ model: "sonnet", tier: "FULL" }), false);
  assert.equal(isLightTrack({ model: "opus", tier: "FULL" }), false);
  assert.equal(isLightTrack(null), false);
  assert.equal(isLightTrack(undefined), false);
});

test("sortMixedQueue: lette spor forrest, stabil inden for hver gruppe", () => {
  const heavy1 = { id: "heavy1", model: "opus", tier: "FULL" };
  const light1 = { id: "light1", model: "sonnet", tier: "TARGETED" };
  const heavy2 = { id: "heavy2", model: "opus", tier: "TARGETED" };
  const light2 = { id: "light2", model: "sonnet", tier: "TARGETED" };
  const sorted = sortMixedQueue([heavy1, light1, heavy2, light2]);
  assert.deepEqual(
    sorted.map((t) => t.id),
    ["light1", "light2", "heavy1", "heavy2"],
    "lette spor forrest, og den indbyrdes raekkefoelge inden for hver gruppe er uaendret (stabil)",
  );
});

test("sortMixedQueue: en koe der allerede kun har lette eller kun tunge spor rykkes ikke rundt", () => {
  const allLight = [{ model: "sonnet", tier: "TARGETED" }, { model: "sonnet", tier: "TARGETED" }];
  assert.deepEqual(sortMixedQueue(allLight), allLight);
  const allHeavy = [{ model: "opus", tier: "FULL" }, { model: "opus", tier: "TARGETED" }];
  assert.deepEqual(sortMixedQueue(allHeavy), allHeavy);
});

test("sortMixedQueue: tom eller ugyldig liste giver et tomt array, ikke en fejl", () => {
  assert.deepEqual(sortMixedQueue([]), []);
  assert.deepEqual(sortMixedQueue(null), []);
  assert.deepEqual(sortMixedQueue(undefined), []);
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
  };
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

test("#5220: wave.js sorterer koeen med den spejlede sortMixedQueue-regel", () => {
  const src = readFileSync(WAVE_JS_PATH, "utf8");
  assert.ok(src.includes("sortMixedQueue"), "wave.js skal bruge en spejlet sortMixedQueue()");
  assert.ok(src.includes("isLightTrack"), "wave.js skal bruge en spejlet isLightTrack()");
  assert.ok(src.includes("'sonnet'") && src.includes("'TARGETED'"), "det lette kriterie skal vaere model sonnet + tier TARGETED");
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
