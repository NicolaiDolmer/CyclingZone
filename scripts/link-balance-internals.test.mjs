// Tests for scripts/link-balance-internals.ps1 + scripts/lib/balance-internals.ps1 (#7587 punkt 7).
//
// 3/11 havde 9 worktrees egne lokale kopier af balance-internals/, som ville
// vaere gaaet tabt ved oprydning. Nu er mappen en junction til den delte
// OneDrive-mappe, og oprydningen naegter at fjerne et worktree med en rigtig
// balance-internals/ hvis filer ikke findes i den delte mappe.
//
// SAFETY: alt sker i en frisk mappe under os.tmpdir(). Den "delte mappe" er en
// sandkasse-mappe givet med -SharedRoot / -BalanceSharedRoot; den rigtige
// OneDrive og repoet roeres aldrig. Windows only (junctions, pwsh).
// Run: node --test scripts/link-balance-internals.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "link-balance-internals.ps1");
const lib = path.join(here, "lib", "balance-internals.ps1");
const junctionsLib = path.join(here, "close-out-cleanup-junctions.ps1");
const isWindows = process.platform === "win32";
const skip = isWindows ? false : "kraever Windows + pwsh";

let sandbox;
let n = 0;

before(() => {
  if (!isWindows) return;
  const tmpRoot = fs.realpathSync(os.tmpdir());
  sandbox = fs.mkdtempSync(path.join(tmpRoot, "cz-7587-bi-"));
  assert.ok(sandbox.startsWith(tmpRoot), "sandbox skal ligge under TEMP");
});

after(() => {
  if (!sandbox) return;
  // Links foerst (kun linket fjernes), saa rmSync aldrig foelger dem.
  const ps = "Get-ChildItem -LiteralPath $env:SB -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { $_.LinkType } | ForEach-Object { [IO.Directory]::Delete($_.FullName, $false) }";
  spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", ps], { env: { ...process.env, SB: sandbox } });
  fs.rmSync(sandbox, { recursive: true, force: true });
});

// Et falsk linked worktree (.git er en fil) og en delt mappe, frisk pr. test.
function fixture() {
  n += 1;
  const root = path.join(sandbox, `case-${n}`);
  const wt = path.join(root, "wt");
  const shared = path.join(root, "OneDrive", "CyclingZone-context", "balance-internals");
  fs.mkdirSync(wt, { recursive: true });
  fs.mkdirSync(shared, { recursive: true });
  fs.writeFileSync(path.join(wt, ".git"), "gitdir: C:/dev/CyclingZone/.git/worktrees/wt\n");
  return { root, wt, shared, bi: path.join(wt, "balance-internals") };
}

function runCli(wt, shared, extra = []) {
  const r = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", cli, "-WorktreeRoot", wt, "-SharedRoot", shared, ...extra], { encoding: "utf8" });
  assert.equal(r.error, undefined, `pwsh kunne ikke startes: ${r.error}`);
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

function isJunctionTo(link, target) {
  const st = fs.lstatSync(link);
  if (!st.isSymbolicLink()) return false;
  return path.resolve(fs.readlinkSync(link)).toLowerCase().replace(/\\+$/, "") === path.resolve(target).toLowerCase();
}

test("manglende balance-internals bliver en junction til den delte mappe (idempotent)", { skip }, () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.shared, "delt.md"), "delt\n");
  const first = runCli(f.wt, f.shared);
  assert.equal(first.code, 0, first.out);
  assert.ok(isJunctionTo(f.bi, f.shared), "balance-internals skal vaere en junction til den delte mappe");
  assert.equal(fs.readFileSync(path.join(f.bi, "delt.md"), "utf8"), "delt\n");
  const again = runCli(f.wt, f.shared);
  assert.equal(again.code, 0, again.out);
  assert.match(again.out, /allerede paa plads/);
});

test("en lokal mappe flyttes ind uden overskrivning og erstattes af junctionen", { skip }, () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.shared, "same.md"), "samme\n");
  fs.mkdirSync(path.join(f.bi, "6912"), { recursive: true });
  fs.writeFileSync(path.join(f.bi, "same.md"), "samme\n");
  fs.writeFileSync(path.join(f.bi, "6912", "foer-efter.md"), "privat maaling\n");
  const r = runCli(f.wt, f.shared);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /lokal mappe flyttet ind og linket/);
  assert.ok(isJunctionTo(f.bi, f.shared));
  assert.equal(fs.readFileSync(path.join(f.shared, "6912", "foer-efter.md"), "utf8"), "privat maaling\n", "den unikke fil skal ligge i den delte mappe");
  assert.equal(fs.readFileSync(path.join(f.shared, "same.md"), "utf8"), "samme\n");
});

test("konflikt (samme navn, andet indhold): intet flyttes, intet slettes, exit 1", { skip }, () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.shared, "x.md"), "delt version\n");
  fs.mkdirSync(f.bi);
  fs.writeFileSync(path.join(f.bi, "x.md"), "lokal version\n");
  fs.writeFileSync(path.join(f.bi, "kun-lokal.md"), "lokal\n");
  const r = runCli(f.wt, f.shared);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /andet indhold end den delte mappe \(x\.md\) - mappen er ikke roert/);
  assert.ok(!fs.lstatSync(f.bi).isSymbolicLink(), "mappen skal stadig vaere en rigtig mappe");
  assert.equal(fs.readFileSync(path.join(f.bi, "x.md"), "utf8"), "lokal version\n");
  assert.equal(fs.readFileSync(path.join(f.shared, "x.md"), "utf8"), "delt version\n");
  assert.ok(!fs.existsSync(path.join(f.shared, "kun-lokal.md")), "intet flyttes ved konflikt");
});

test("-DryRun roerer intet", { skip }, () => {
  const f = fixture();
  fs.mkdirSync(f.bi);
  fs.writeFileSync(path.join(f.bi, "a.md"), "a\n");
  const r = runCli(f.wt, f.shared, ["-DryRun"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ville blive flyttet/);
  assert.ok(!fs.lstatSync(f.bi).isSymbolicLink());
  assert.ok(!fs.existsSync(path.join(f.shared, "a.md")));
});

test("hovedcheckoutet (.git er en mappe) springes over - det linkes af link-onedrive-context.ps1", { skip }, () => {
  const f = fixture();
  fs.rmSync(path.join(f.wt, ".git"));
  fs.mkdirSync(path.join(f.wt, ".git"));
  const r = runCli(f.wt, f.shared);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /\[skip\]/);
  assert.ok(!fs.existsSync(f.bi));
});

function removeJunctions(wt, shared) {
  const ps = [
    "$ErrorActionPreference='Stop'",
    `. '${junctionsLib.replace(/'/g, "''")}'`,
    "$r = Remove-WorktreeJunctions -WorktreePath $env:WT -BalanceSharedRoot $env:SHARED",
    "$r | ConvertTo-Json -Compress",
  ].join("; ");
  const r = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", env: { ...process.env, WT: wt, SHARED: shared } });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
}

test("oprydning: en rigtig balance-internals med filer der ikke findes i den delte mappe BEHOLDER worktreet", { skip }, () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.wt, "node_modules-target"));
  fs.symlinkSync(path.join(f.wt, "node_modules-target"), path.join(f.wt, "node_modules"), "junction");
  fs.mkdirSync(f.bi);
  fs.writeFileSync(path.join(f.bi, "unik.md"), "kun her\n");
  const r = removeJunctions(f.wt, f.shared);
  assert.equal(r.Ok, false);
  assert.match(r.Errors.join("\n"), /worktree BEHOLDT: balance-internals har 1 fil\(er\) der ikke findes i den delte mappe \(unik\.md\)/);
  assert.ok(fs.lstatSync(path.join(f.wt, "node_modules")).isSymbolicLink(), "intet link maa roeres, naar worktreet beholdes");
  assert.ok(fs.existsSync(path.join(f.bi, "unik.md")));
});

test("oprydning: samme fil med andet indhold i den delte mappe taeller ogsaa som ikke-fundet", { skip }, () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.shared, "x.md"), "delt\n");
  fs.mkdirSync(f.bi);
  fs.writeFileSync(path.join(f.bi, "x.md"), "lokal\n");
  assert.equal(removeJunctions(f.wt, f.shared).Ok, false);
});

test("oprydning: en rigtig mappe hvis filer alle findes i den delte mappe, og et link, maa fjernes", { skip }, () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.shared, "x.md"), "samme\n");
  fs.mkdirSync(f.bi);
  fs.writeFileSync(path.join(f.bi, "x.md"), "samme\n");
  assert.equal(removeJunctions(f.wt, f.shared).Ok, true);

  const g = fixture();
  fs.writeFileSync(path.join(g.shared, "delt.md"), "delt\n");
  fs.symlinkSync(g.shared, g.bi, "junction");
  const r = removeJunctions(g.wt, g.shared);
  assert.equal(r.Ok, true, JSON.stringify(r));
  assert.ok(!fs.existsSync(g.bi), "junctionen fjernes som link");
  assert.equal(fs.readFileSync(path.join(g.shared, "delt.md"), "utf8"), "delt\n", "den delte mappe maa aldrig toemmes");
});

test("oprydning: uden kendt delt mappe kan lokale filer ikke verificeres - fail-closed", { skip }, () => {
  const f = fixture();
  fs.mkdirSync(f.bi);
  fs.writeFileSync(path.join(f.bi, "a.md"), "a\n");
  const r = removeJunctions(f.wt, path.join(f.root, "findes-ikke"));
  assert.equal(r.Ok, false);
  assert.match(r.Errors.join("\n"), /den delte mappe kan ikke findes/);
});

test("koblingen: setup-worktree.ps1 linker, oprydningen tjekker foer et link roeres, fase 0 kalder CLI'en", () => {
  const setup = fs.readFileSync(path.join(here, "setup-worktree.ps1"), "utf8");
  assert.match(setup, /\nSet-BalanceInternals\r?\n/, "setup-worktree.ps1 (og dermed new-worktree.ps1) skal koere balance-internals-trinnet");
  assert.match(setup, /lib\\balance-internals\.ps1/);
  const junctions = fs.readFileSync(junctionsLib, "utf8");
  const fn = junctions.slice(junctions.indexOf("function Remove-WorktreeJunctions"));
  assert.ok(fn.indexOf("Test-BalanceInternalsRemovable") > 0 && fn.indexOf("Test-BalanceInternalsRemovable") < fn.indexOf("Get-WorktreeLinks -WorktreePath"),
    "balance-internals-tjekket skal ske FOER noget link fjernes");
  const libSrc = fs.readFileSync(lib, "utf8");
  assert.doesNotMatch(libSrc, /^param\(/m,"lib'en dot-sources og maa ikke have en top-level param-blok (overskriver kalderens $DryRun)");
  assert.doesNotMatch(libSrc, /Remove-Item[^\n]*-Recurse[^\n]*\$state\.Target/, "maalet for et link maa aldrig slettes rekursivt");
  // Codex-review: to samtidige setups maa ikke overskrive hinandens fil i den delte mappe.
  assert.ok(libSrc.includes("[IO.File]::Copy($src, $dest, $false)"), "flytningen skal oprette uden overskrivning");
  assert.doesNotMatch(libSrc, /Copy-Item/, "Copy-Item overskriver et eksisterende maal");
  const wave = fs.readFileSync(path.join(here, "..", ".claude", "workflows", "wave.js"), "utf8");
  assert.ok(wave.includes("scripts\\\\link-balance-internals.ps1 -WorktreeRoot <sporets worktree>"));
});
