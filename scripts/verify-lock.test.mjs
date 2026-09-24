// scripts/verify-lock.test.mjs
// ============================================================
// Beviser at scripts/verify-lock.ps1 rent faktisk begraenser samtidighed (#5142)
// og at en wrapper aldrig kan laase semaforen med sine egne slot-filer (#5566).
//
// De foerste tests starter 3 parallelle kommandoer gennem semaforen med -Max 2
// og maaler hvor mange der var inde SAMTIDIG. De maaler ikke paa exit-koder
// alene: en semafor der ved en fejl slap alle tre igennem ville stadig give
// 3 x exit 0. Derfor registrerer hver dummy-kommando sin egen tilstedevaerelse
// i en fil og observerer selv hvor mange andre der er inde imens.
//
// #5566-testene daekker slot-oprydningen: en laeser der holder slot-filer aabne
// uden FileShare.Delete (kun Windows, hvor det blokerer en sletning), PID-genbrug
// via starttid, slot-filer i det gamle format, og retry/udskudt sletning via en
// testsoem (CZ_VERIFY_LOCK_TEST_FAIL_DELETES) saa logikken ogsaa koerer paa Linux.
// Alle tests bruger en temp-slotmappe, aldrig den delte .claude/run/verify-slots.
//
// Run: node --test scripts/verify-lock.test.mjs
// Kraever pwsh paa PATH (springes over hvis den mangler).
//
// Refs #5142, #5566.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync, mkdirSync, existsSync, unlinkSync, utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "verify-lock.ps1");
const hasPwsh = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"], { shell: false }).status === 0;
const isWindows = process.platform === "win32";

// Wrapperen skriver denne tekst paa stderr naar en egen slot-fil ikke kunne
// slettes og er lagt i ko til et senere forsoeg.
const DEFERRED = "sletning udskudt";

// Ingen arvet testsoem eller slot-mappe fra kalderens miljoe.
const baseEnv = { ...process.env };
delete baseEnv.CZ_VERIFY_LOCK_TEST_FAIL_DELETES;
delete baseEnv.CZ_VERIFY_SLOT_DIR;

let work;
let slotDir;
let markerDir;
let dummy;
let holdScript;
let listScript;
let openHelper;

before(() => {
  work = mkdtempSync(join(tmpdir(), "verify-lock-test-"));
  slotDir = join(work, "slots");
  markerDir = join(work, "markers");
  mkdirSync(slotDir, { recursive: true });
  mkdirSync(markerDir, { recursive: true });

  // Dummy-kommando: markér at jeg koerer, hold slottet i ~1,2 s mens jeg
  // observerer hvor mange andre der er inde, ryd op, og skriv mit maksimum.
  dummy = join(work, "dummy.mjs");
  writeFileSync(
    dummy,
    [
      'import { writeFileSync, unlinkSync, readdirSync } from "node:fs";',
      'import { join } from "node:path";',
      "const [id, dir] = process.argv.slice(2);",
      'const me = join(dir, `run-${id}`);',
      'writeFileSync(me, "1");',
      "let max = 0;",
      "const until = Date.now() + 1200;",
      "while (Date.now() < until) {",
      '  const n = readdirSync(dir).filter((f) => f.startsWith("run-")).length;',
      "  if (n > max) max = n;",
      "}",
      "unlinkSync(me);",
      'writeFileSync(join(dir, `max-${id}`), String(max));',
      "",
    ].join("\n"),
    "utf8",
  );

  // Holder-kommando: markér at slottet er taget, hold det til stop-filen findes
  // (+500 ms, saa laeser-hjaelperen er lukket foer wrapperen rydder op).
  holdScript = join(work, "hold.mjs");
  writeFileSync(
    holdScript,
    [
      'import { writeFileSync, existsSync } from "node:fs";',
      "const [marker, stop] = process.argv.slice(2);",
      'writeFileSync(marker, "1");',
      "const cap = setTimeout(() => process.exit(0), 90000);",
      "const poll = setInterval(() => {",
      "  if (!existsSync(stop)) return;",
      "  clearInterval(poll);",
      "  clearTimeout(cap);",
      "  setTimeout(() => process.exit(0), 500);",
      "}, 50);",
      "",
    ].join("\n"),
    "utf8",
  );

  // List-kommando: skriv navn + indhold af alle slot-filer mens slottet holdes.
  listScript = join(work, "list.mjs");
  writeFileSync(
    listScript,
    [
      'import { writeFileSync, readdirSync, readFileSync } from "node:fs";',
      'import { join } from "node:path";',
      "const [dir, out] = process.argv.slice(2);",
      "const seen = readdirSync(dir)",
      '  .filter((f) => f.startsWith("slot-") && f.endsWith(".json"))',
      "  .sort()",
      '  .map((name) => ({ name, content: readFileSync(join(dir, name), "utf8") }));',
      "writeFileSync(out, JSON.stringify(seen));",
      "",
    ].join("\n"),
    "utf8",
  );

  // Laeser-hjaelper (Windows): aabner hver slot-fil med FileShare.Read UDEN
  // Delete, som Get-Content i en aeldre wrapper, og holder den aaben til
  // stop-filen findes. Saalaenge kan ejeren ikke slette filen.
  openHelper = join(work, "hold-open.ps1");
  writeFileSync(
    openHelper,
    [
      "param([string]$Dir, [string]$Stop, [string]$Ready)",
      "$held = @{}",
      "Set-Content -LiteralPath $Ready -Value '1'",
      "$until = (Get-Date).AddSeconds(90)",
      "while (-not (Test-Path -LiteralPath $Stop) -and (Get-Date) -lt $until) {",
      "  foreach ($f in [System.IO.Directory]::GetFiles($Dir, 'slot-*.json')) {",
      "    if (-not $held.ContainsKey($f)) {",
      "      try { $held[$f] = [System.IO.File]::Open($f, 'Open', 'Read', 'Read') } catch { $null = $_ }",
      "    }",
      "  }",
      "  [System.Threading.Thread]::Sleep(1)",
      "}",
      "foreach ($h in $held.Values) { $h.Dispose() }",
      "",
    ].join("\n"),
    "utf8",
  );
});

after(() => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
});

function runThroughLock(id) {
  return new Promise((resolve) => {
    const child = spawn(
      "pwsh",
      [
        "-NoProfile", "-File", SCRIPT,
        "-Max", "2",
        "-Timeout", "120",
        "-SlotDir", slotDir,
        "-Label", `test-${id}`,
        "--", "node", dummy, String(id), markerDir,
      ],
      { stdio: "ignore" },
    );
    child.on("close", (code) => resolve(code));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs, stepMs = 50) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (predicate()) return true;
    await sleep(stepMs);
  }
  return predicate();
}

async function withTimeout(promise, ms, what) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} blev ikke faerdig inden for ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, limit]);
  } finally {
    clearTimeout(timer);
  }
}

function freshDir(name) {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function slotFiles(dir) {
  return readdirSync(dir).filter((f) => f.startsWith("slot-") && f.endsWith(".json"));
}

// PID-delen af slot-<stamp>-<pid>-<guid8>.json.
function namePid(name) {
  const m = /^slot-[^-]+-(\d+)-[^-]+\.json$/.exec(name);
  return m ? Number(m[1]) : NaN;
}

// En fremmed slot-fil med et tidligt tidsstempel, saa den sorterer foerst.
function writeFakeSlot(dir, payload) {
  const name = `slot-20000101T000000000-${payload.pid}-0badf00d.json`;
  writeFileSync(join(dir, name), JSON.stringify(payload), "utf8");
  return name;
}

// Saetter en slot-fils mtime ~60 s tilbage, altsaa aeldre end
// $UnreadableGraceSec (10 s) i verify-lock.ps1. Uden dette er den nyskrevne
// fake-fil under 10 s gammel naar wrapperen laeser den, saa den taeller som
// levende via "ung + ulaeselig = kandidat under skrivning" - ogsaa hvis
// Read-SlotInfo slet ikke kunne parse den. Testen ville saa bestaa selv med en
// parser der altid kaster (diff-tjek 24/9, #5566). Aeldre gemmer den kun
// invarianten den skal daekke: et levende slot laest korrekt via PID+startedAt.
function ageSlotFile(dir, name) {
  const past = new Date(Date.now() - 60_000);
  utimesSync(join(dir, name), past, past);
}

function lockSync(dir, flags, command, extraEnv = {}) {
  return spawnSync(
    "pwsh",
    ["-NoProfile", "-File", SCRIPT, ...flags, "-SlotDir", dir, "--", ...command],
    { encoding: "utf8", env: { ...baseEnv, ...extraEnv } },
  );
}

function startLock(dir, flags, command, extraEnv = {}) {
  const child = spawn(
    "pwsh",
    ["-NoProfile", "-File", SCRIPT, ...flags, "-SlotDir", dir, "--", ...command],
    { env: { ...baseEnv, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] },
  );
  const run = { child, stdout: "", stderr: "" };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d) => { run.stdout += d; });
  child.stderr.on("data", (d) => { run.stderr += d; });
  run.done = new Promise((resolve) => child.on("close", (code) => resolve(code)));
  return run;
}

test("maks 2 kommandoer koerer samtidig naar 3 startes med -Max 2", { skip: !hasPwsh && "pwsh mangler" }, async () => {
  const codes = await Promise.all([0, 1, 2].map((i) => runThroughLock(i)));
  assert.deepEqual(codes, [0, 0, 0], "alle tre kommandoer skal koere og lykkes");

  const observed = readdirSync(markerDir)
    .filter((f) => f.startsWith("max-"))
    .map((f) => Number(readFileSync(join(markerDir, f), "utf8").trim()));

  assert.equal(observed.length, 3, "alle tre dummy-kommandoer skal have skrevet et maksimum");
  const peak = Math.max(...observed);
  assert.ok(peak <= 2, `semaforen slap ${peak} igennem samtidig (loft: 2)`);
  assert.ok(peak >= 1, "mindst én kommando skal have set sig selv");
});

test("slots frigives igen bagefter", { skip: !hasPwsh && "pwsh mangler" }, () => {
  const left = readdirSync(slotDir).filter((f) => f.startsWith("slot-"));
  assert.deepEqual(left, [], `slot-filer blev efterladt: ${left.join(", ")}`);
});

test("ingen kommando -> exit 2, ikke stille succes", { skip: !hasPwsh && "pwsh mangler" }, () => {
  const r = spawnSync("pwsh", ["-NoProfile", "-File", SCRIPT, "-SlotDir", slotDir], { encoding: "utf8" });
  assert.equal(r.status, 2);
});

// FUND 2 (diff-tjek 24/9, #5566): Read-SlotInfo bruger System.Text.Json, som
// ikke findes i Windows PowerShell 5.1. Uden et versionsgitter ville en 5.1-
// vaert ramme catch-all'en i Get-LiveSlots for ETHVER slot-fil og slette
// levende slots aeldre end $UnreadableGraceSec. Testen laeser kildekoden i
// stedet for at koere under 5.1 (som ikke findes i CI-miljoeet).
test("scriptet kraever PowerShell 7+, saa Windows PowerShell 5.1 aldrig kan naa Read-SlotInfo", () => {
  const lines = readFileSync(SCRIPT, "utf8").split(/\r?\n/);
  const requiresLine = lines.find((l) => l.trim().toLowerCase().startsWith("#requires"));
  assert.ok(requiresLine, "scriptet mangler et #Requires-direktiv");
  assert.match(requiresLine, /-Version\s+7/i, `#Requires skal laase til version 7+: ${requiresLine}`);

  const requiresIdx = lines.indexOf(requiresLine);
  const firstCodeIdx = lines.findIndex((l) => {
    const t = l.trim();
    return t !== "" && !t.startsWith("#");
  });
  assert.ok(
    firstCodeIdx === -1 || requiresIdx < firstCodeIdx,
    "#Requires skal staa foer al kode, ellers haandhaever PowerShell den ikke",
  );
});

test("kommandoens exit-kode gives videre", { skip: !hasPwsh && "pwsh mangler" }, () => {
  const r = spawnSync(
    "pwsh",
    ["-NoProfile", "-File", SCRIPT, "-SlotDir", slotDir, "--", "node", "-e", "process.exit(3)"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 3, "en fejlende verifikation maa ikke maskeres af wrapperen");
});

// #5566 (boelge B 23/9): en wrapper tabte rangeringen, og dens ene sletteforsoeg
// ramte en anden proces der laeste filen. Filen blev liggende med wrapperens
// LEVENDE PID og blokerede baade wrapperen selv og andre laner.
test(
  "en laeser uden FileShare.Delete kan ikke laase semaforen med en ventende wrappers egne filer (#5566)",
  { skip: (!hasPwsh && "pwsh mangler") || (!isWindows && "kun Windows: her blokerer en aaben fil sletning") },
  async () => {
    const dir = freshDir("share");
    const stop = join(work, "share-stop");
    const ready = join(work, "share-ready");
    const holderRunning = join(work, "share-holder-running");
    const helper = spawn("pwsh", ["-NoProfile", "-File", openHelper, dir, stop, ready], { stdio: "ignore" });
    const runs = [];
    try {
      assert.ok(await waitFor(() => existsSync(ready), 30000), "laeser-hjaelperen startede ikke");

      const holder = startLock(dir, ["-Max", "1", "-Timeout", "60", "-Label", "holder"], ["node", holdScript, holderRunning, stop]);
      runs.push(holder);
      assert.ok(await waitFor(() => existsSync(holderRunning), 30000), `holderen fik ikke slot: ${holder.stderr}`);

      const waiter = startLock(dir, ["-Max", "1", "-Timeout", "30", "-Label", "waiter"], ["node", "-e", "process.exit(0)"]);
      runs.push(waiter);
      // Den ventende wrapper taber hver runde mens holderen koerer; hjaelperen
      // holder dens kandidat aaben, saa sletningen skal fejle mindst een gang.
      const deferred = await waitFor(() => waiter.stderr.includes(DEFERRED), 20000);
      writeFileSync(stop, "1");

      const codes = await withTimeout(Promise.all([holder.done, waiter.done]), 90000, "holder + waiter");
      assert.deepEqual(codes, [0, 0], `begge wrappere skal faa slot og lykkes. waiter stderr: ${waiter.stderr}`);
      assert.deepEqual(slotFiles(dir), [], "ingen slot-filer maa efterlades");
      assert.ok(deferred, `testen skal have ramt en blokeret sletning. waiter stderr: ${waiter.stderr}`);

      const third = lockSync(dir, ["-Max", "1", "-Timeout", "3"], ["node", "-e", "process.exit(0)"]);
      assert.equal(third.status, 0, `et tredje kald skal faa slot straks: ${third.stderr}`);
      assert.ok(!third.stdout.includes("venter paa slot"), "det tredje kald maa ikke vente");
    } finally {
      if (!existsSync(stop)) writeFileSync(stop, "1");
      for (const r of runs) r.child.kill();
      helper.kill();
    }
  },
);

test("et slot med levende PID men forkert starttid er PID-genbrug og ryddes (#5566)", { skip: !hasPwsh && "pwsh mangler" }, () => {
  const dir = freshDir("reuse");
  const name = writeFakeSlot(dir, {
    pid: process.pid,
    startedAt: "2001-01-01T00:00:00.0000000Z",
    acquiredAt: new Date().toISOString(),
    label: "genbrugt pid",
  });
  const r = lockSync(dir, ["-Max", "1", "-Timeout", "5"], ["node", "-e", "process.exit(0)"]);
  assert.equal(r.status, 0, `wrapperen skal faa slot: ${r.stderr}`);
  assert.ok(!r.stdout.includes("venter paa slot"), "et genbrugt PID maa ikke optage et slot");
  assert.ok(!existsSync(join(dir, name)), "slot-filen med forkert starttid skal ryddes");
  assert.deepEqual(slotFiles(dir), []);
});

test("sub-sekund-drift i starttiden goer ikke et levende slot doedt (#5533-laeringen)", { skip: !hasPwsh && "pwsh mangler" }, () => {
  const dir = freshDir("drift");
  const measured = spawnSync(
    "pwsh",
    ["-NoProfile", "-Command", `(Get-Process -Id ${process.pid}).StartTime.ToUniversalTime().AddMilliseconds(400).ToString('o')`],
    { encoding: "utf8" },
  );
  assert.equal(measured.status, 0, measured.stderr);
  const name = writeFakeSlot(dir, {
    pid: process.pid,
    startedAt: measured.stdout.trim(),
    acquiredAt: new Date().toISOString(),
    label: "levende med drift",
  });
  ageSlotFile(dir, name);
  const r = lockSync(dir, ["-Max", "1", "-Timeout", "2"], ["node", "-e", "process.exit(0)"]);
  assert.equal(r.status, 75, `slottet er levende, saa -Max 1 skal give koe-timeout: ${r.stderr}`);
  assert.ok(existsSync(join(dir, name)), "et levende slot maa ikke ryddes");
});

test("slot i gammelt format (kun pid/acquiredAt/label) med levende PID taeller stadig som optaget", { skip: !hasPwsh && "pwsh mangler" }, () => {
  const dir = freshDir("legacy");
  const name = writeFakeSlot(dir, { pid: process.pid, acquiredAt: new Date().toISOString(), label: "gammelt format" });
  ageSlotFile(dir, name);
  const r = lockSync(dir, ["-Max", "1", "-Timeout", "2"], ["node", "-e", "process.exit(0)"]);
  assert.equal(r.status, 75, `et levende slot i gammelt format skal stadig optage slottet: ${r.stderr}`);
  assert.ok(existsSync(join(dir, name)), "et levende slot i gammelt format maa ikke ryddes");
});

// Paa Linux blokerer en aaben fil aldrig en sletning, saa retry- og
// udskudt-sletning-logikken testes via testsoemmen: de foerste 13 sletninger
// fejler. Forloeb med -Max 1 og en fremmed levende blokering:
//   runde 1: taber, kandidaten kan ikke slettes (6 forsoeg) -> udskudt
//   (testen fjerner blokeringen)
//   runde 2: udskudt fil proeves (1 forsoeg, fejler), ny kandidat vinder fordi
//   den egne efterladte fil ikke taeller; sidste forsoeg foer koersel (6) fejler
//   koersel: kommandoen ser BEGGE egne filer
//   finally: begge slettes.
test("udskudt sletning: egen efterladt kandidat taeller ikke mod en selv og ryddes til sidst (#5566)", { skip: !hasPwsh && "pwsh mangler" }, async () => {
  const dir = freshDir("seam");
  const seenFile = join(work, "seam-seen.json");
  const blocker = writeFakeSlot(dir, { pid: process.pid, acquiredAt: new Date().toISOString(), label: "blokering" });
  const run = startLock(
    dir,
    ["-Max", "1", "-Timeout", "30", "-Label", "seam"],
    ["node", listScript, dir, seenFile],
    { CZ_VERIFY_LOCK_TEST_FAIL_DELETES: "13" },
  );
  try {
    const deferred = await waitFor(() => run.stderr.includes(DEFERRED), 20000);
    unlinkSync(join(dir, blocker));
    const code = await withTimeout(run.done, 60000, "wrapperen");
    assert.equal(code, 0, `wrapperen skal faa slot trods sin egen efterladte fil: ${run.stderr}`);
    assert.ok(deferred, `den fejlede sletning skal udskydes, ikke sluges: ${run.stderr}`);

    const seen = JSON.parse(readFileSync(seenFile, "utf8"));
    assert.equal(seen.length, 2, `kommandoen skal koere mens den egne efterladte fil stadig findes: ${JSON.stringify(seen)}`);
    const pids = new Set(seen.map((s) => namePid(s.name)));
    assert.equal(pids.size, 1, "begge filer skal tilhoere wrapperen selv");
    assert.ok(!pids.has(process.pid), "blokeringen skal vaere vaek");
    for (const s of seen) {
      const payload = JSON.parse(s.content);
      assert.equal(payload.pid, namePid(s.name), "pid i indholdet skal matche navnet");
      assert.equal(typeof payload.startedAt, "string", "nye slot-filer skal have processens starttid");
      assert.ok(Number.isFinite(Date.parse(payload.startedAt)), `starttiden skal vaere en dato: ${payload.startedAt}`);
    }

    assert.deepEqual(slotFiles(dir), [], "finally skal rydde alle egne slot-filer");
  } finally {
    run.child.kill();
  }
});
