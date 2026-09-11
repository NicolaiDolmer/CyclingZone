// scripts/verify-lock.test.mjs
// ============================================================
// Beviser at scripts/verify-lock.ps1 rent faktisk begraenser samtidighed (#5142).
//
// Testen starter 3 parallelle kommandoer gennem semaforen med -Max 2 og maaler
// hvor mange der var inde SAMTIDIG. Den maaler ikke paa exit-koder alene: en
// semafor der ved en fejl slap alle tre igennem ville stadig give 3 x exit 0.
// Derfor registrerer hver dummy-kommando sin egen tilstedevaerelse i en fil og
// observerer selv hvor mange andre der er inde imens.
//
// Run: node --test scripts/verify-lock.test.mjs
// Kraever pwsh paa PATH (springes over hvis den mangler, fx paa CI-linux).
//
// Refs #5142.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "verify-lock.ps1");
const hasPwsh = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"], { shell: false }).status === 0;

let work;
let slotDir;
let markerDir;
let dummy;

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

test("kommandoens exit-kode gives videre", { skip: !hasPwsh && "pwsh mangler" }, () => {
  const r = spawnSync(
    "pwsh",
    ["-NoProfile", "-File", SCRIPT, "-SlotDir", slotDir, "--", "node", "-e", "process.exit(3)"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 3, "en fejlende verifikation maa ikke maskeres af wrapperen");
});
