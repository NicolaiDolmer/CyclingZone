// backend/lib/s5BenchmarkGateFiles.test.js
// #6367: benchmark-gaten koerer paa ALLE backend-skrivestier (admin generate-calendar,
// seasonTransition auto_calendar, relaunch, reconcilePoolCalendarOnActivation). Railway
// bygger med rootDirectory /backend, saa en gate-fil uden for backend/ findes ikke i prod:
// loadS5Benchmark() kaster ENOENT, og ingen S5-kalender kan skrives via backenden.
// Testen fejler, hvis en af gatens filer ligger (eller peger) uden for backend/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_BENCHMARK_PATH, DEFAULT_MOTOR_STUB_PATH, loadS5Benchmark, loadMotorGapFile,
} from "./s5BenchmarkGate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(__dirname, "..");

function insideBackend(p) {
  const rel = relative(BACKEND_ROOT, p);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

for (const [name, path] of [["DEFAULT_BENCHMARK_PATH", DEFAULT_BENCHMARK_PATH], ["DEFAULT_MOTOR_STUB_PATH", DEFAULT_MOTOR_STUB_PATH]]) {
  test(`#6367: ${name} ligger under backend/ (Railway bygger kun backend/)`, () => {
    assert.ok(insideBackend(path), `${name} = ${path} ligger uden for ${BACKEND_ROOT}; filen findes ikke i prod`);
    assert.ok(existsSync(path), `${name} = ${path} findes ikke`);
  });
}

test("#6367: gatens default-filer kan laeses uden argumenter", () => {
  const rows = loadS5Benchmark();
  assert.equal(rows.length, 315, "benchmarken er de 315 GT-etaper 2021-2025");
  assert.ok(loadMotorGapFile(DEFAULT_MOTOR_STUB_PATH));
});

test("#6367: gate-modulerne laeser ingen fil via en sti der forlader backend/", () => {
  // Fanger en ny konstant med et andet navn end de to ovenfor, fx join(__dirname, "..", "..", "docs", ...).
  for (const file of ["s5BenchmarkGate.js", "tierCalendarMaterializer.js"]) {
    const src = readFileSync(join(__dirname, file), "utf8");
    assert.doesNotMatch(src, /join\(\s*__dirname\s*,\s*["']\.\.["']\s*,\s*["']\.\.["']/, `${file}: join(__dirname, "..", "..", ...) peger uden for backend/`);
    assert.doesNotMatch(src, /["']\.\.\/\.\.\/(docs|scripts|database)\//, `${file}: en "../../"-sti peger uden for backend/`);
  }
});
