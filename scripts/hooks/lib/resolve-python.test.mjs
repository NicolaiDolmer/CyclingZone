import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

// #5426 (opfoelgning paa #5326): secret_sanitize_detail i resolve-python.sh
// maskerede kun tegnkoersler paa 25+ tegn. En AWS access key-ID er kun 20
// tegn (AKIA + 16 tegn) og ville slippe igennem uredacted, hvis en fremtidig
// traceback i scan-secrets.py kom til at ekko raa input i sin stderr.
//
// Disse tests dækker KUN hvad funktionen PRINTER — scan-secrets.py's egen
// BLOKERINGS-logik (hvad der stopper en commit/edit) er ikke rørt.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
// CodeRabbit (denne PR): `git --exec-path` peger paa Gits EGNE git-core-
// programmer, ikke paa bash — kun Git for Windows' medbragte layout har en
// forudsigelig `bin/bash.exe` relativt til den sti. Paa Unix bruges derfor
// bare `bash` fra PATH; git-exec-path-udledningen er kun noedvendig paa
// Windows, hvor Git Bash ellers ikke noedvendigvis ligger paa PATH.
const bash = (() => {
  if (process.platform !== "win32") return "bash";
  const execPath = spawnSync("git", ["--exec-path"], { encoding: "utf8" }).stdout.trim();
  const gitRoot = resolve(execPath, "../../..");
  return join(gitRoot, "bin", "bash.exe");
})();

// Kører secret_sanitize_detail() fra resolve-python.sh på en midlertidig
// "scanner stderr"-fixtur og returnerer resultatet. Stien til fixturen gives
// som RELATIV sti fra repo-roden (cwd), så absolutte Windows-stier med
// backslash aldrig skal ind i en bash -c-streng.
function sanitize(content) {
  // CodeRabbit (denne PR): .codex.local er gitignored og derfor IKKE
  // garanteret at findes i et frisk checkout — mkdtempSync opretter ikke
  // manglende foraeldre-mapper.
  mkdirSync(join(root, ".codex.local"), { recursive: true });
  const dir = mkdtempSync(join(root, ".codex.local/secret-sanitize-"));
  try {
    writeFileSync(join(dir, "stderr.txt"), content, "utf8");
    const relDir = dir.slice(root.length + 1).replace(/\\/g, "/");
    const relFile = `${relDir}/stderr.txt`;
    return spawnSync(
      bash,
      ["-c", 'source "$1" && secret_sanitize_detail "$2"', "bash", "scripts/hooks/lib/resolve-python.sh", relFile],
      { cwd: root, encoding: "utf8" }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("secret_sanitize_detail redacts a 20-char AWS-access-key-shaped token (#5426)", () => {
  // Samlet ved runtime, ikke et komplet moenster i selve filen (samme teknik
  // som test-secret-runtime.mjs's FIXTURE_DO_NOT_USE-fixtur).
  const fixture = "AKIA" + "0".repeat(16);
  const result = sanitize(`boom: leaked ${fixture} in traceback`);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes(fixture), "et 20-tegns AWS-key-formet token maa ikke overleve redaction");
  assert.match(result.stdout, /REDACTED/);
});

test("secret_sanitize_detail redacts a generic 20-char token below the old 25-char floor (#5426)", () => {
  const token = "Ab3".repeat(7); // 21 tegn, intet kendt praefiks
  const result = sanitize(`boom: leaked ${token} tail`);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes(token), "et 21-tegns token maa maskeres under den saenkede taerskel");
  assert.match(result.stdout, /REDACTED-LONG-TOKEN/);
});

test("secret_sanitize_detail still redacts a long >=25-char token (#5326 regression)", () => {
  const token = "A".repeat(20) + "b".repeat(20) + "1234567890";
  const result = sanitize(`leaked ${token}`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /REDACTED-LONG-TOKEN/);
  assert.ok(!result.stdout.includes(token));
});

test("secret_sanitize_detail leaves short benign text untouched", () => {
  const line = "boom: simple scanner crash, exit=19";
  const result = sanitize(line);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trimEnd(), line);
});

test("secret_sanitize_detail reports the placeholder when stderr is empty", () => {
  const result = sanitize("");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "(scanner wrote nothing to stderr)");
});
