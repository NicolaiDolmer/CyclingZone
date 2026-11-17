// Statisk vagt for pixel-baselines i laast Linux-container (#8348).
//
// Snapshots (toHaveScreenshot) er kun reproducerbare naar de laves og
// sammenlignes i PRAECIS samme miljoe. Det miljoe er et Playwright-image pinnet
// paa digest, brugt to steder: e2e-shard i playwright-smoke.yml (sammenligner)
// og update-snapshots.yml (fornyer via labelen "opdater snapshots"). Driver de
// to fra hinanden, eller fra @playwright/test-versionen, bliver baselines
// stille forkerte eller CI fejler paa browser-download. Den klasse fanges her,
// i sekunder, foer suiten koerer.
//
// Koerer i `npm test` (node --test) og i e2e-shard's guard-step.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(E2E_DIR, "../..");
const REPO_ROOT = path.resolve(FRONTEND_DIR, "..");
const WORKFLOWS = path.join(REPO_ROOT, ".github", "workflows");

// CRLF normaliseres: Windows-checkouts med core.autocrlf har CRLF i workflows.
const read = (p: string): string => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const smoke = read(path.join(WORKFLOWS, "playwright-smoke.yml"));
const update = read(path.join(WORKFLOWS, "update-snapshots.yml"));
const config = read(path.join(FRONTEND_DIR, "playwright.config.js"));
const lock = JSON.parse(read(path.join(FRONTEND_DIR, "package-lock.json"))) as {
  packages: Record<string, { version?: string } | undefined>;
};

const IMAGE_LINE = /^\s*image:\s*(mcr\.microsoft\.com\/playwright:\S+)\s*$/gm;
const PINNED_IMAGE = /^mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble@sha256:[0-9a-f]{64}$/;
const projectNames: string[] = [...config.matchAll(/^\s*name:\s*"([a-z-]+)",\s*$/gm)].map((m) => m[1] ?? "");

function imagesIn(source: string): string[] {
  return [...source.matchAll(IMAGE_LINE)].map((m) => m[1] ?? "");
}

test("playwright.config.js definerer de tre projekter (#536)", () => {
  assert.deepEqual([...projectNames].sort(), ["desktop-chromium", "mobile-chromium", "mobile-webkit"]);
});

// Headless Chromium paa Linux runder tegnbredder til hele pixels med fuld
// font-hinting; uden flaget broed en matrix-linse over to linjer kun i
// containeren, og baselines blev tegnet med andre bredder end paa rigtige
// enheder. Hvert chromium-projekt skal starte med hinting slaaet fra.
test("chromium-projekterne starter uden font-hinting (Linux-bredder = rigtige enheder)", () => {
  assert.match(config, /export const CHROMIUM_LAUNCH_ARGS = \[[^\]]*"--font-render-hinting=none"[^\]]*\];/);
  const blocks = config.split(/^\s*name:\s*"/m).slice(1);
  const chromiumBlocks = blocks.filter((block) => block.startsWith("desktop-chromium") || block.startsWith("mobile-chromium"));
  assert.equal(chromiumBlocks.length, 2, "forventede to chromium-projekter");
  for (const block of chromiumBlocks) {
    const body = block.slice(0, block.indexOf("\n  },"));
    assert.match(body, /launchOptions:\s*\{\s*args:\s*CHROMIUM_LAUNCH_ARGS\s*\}/, `${body.split('"')[0]} mangler launchOptions.args = CHROMIUM_LAUNCH_ARGS`);
  }
});

test("begge workflows bruger eet og samme Playwright-image, pinnet paa digest", () => {
  const smokeImages = imagesIn(smoke);
  const updateImages = imagesIn(update);
  assert.equal(smokeImages.length, 1, "playwright-smoke.yml skal have praecis eet Playwright-image (e2e-shard)");
  assert.equal(updateImages.length, 1, "update-snapshots.yml skal have praecis eet Playwright-image (generate)");
  assert.equal(updateImages[0], smokeImages[0], "baselines laves og sammenlignes i forskellige images");
  assert.match(smokeImages[0], PINNED_IMAGE, "imaget skal vaere vX.Y.Z-noble@sha256:<digest> (laast, samme hver gang)");
});

test("image-versionen matcher @playwright/test i frontend/package-lock.json", () => {
  const imageVersion = (imagesIn(smoke)[0] ?? "").match(PINNED_IMAGE)?.[1];
  assert.ok(imageVersion, "playwright-smoke.yml mangler et pinnet Playwright-image");
  const installed = lock.packages["node_modules/@playwright/test"]?.version;
  assert.ok(installed, "@playwright/test mangler i package-lock.json");
  assert.equal(
    imageVersion,
    installed,
    `Bump tag+digest i begge workflows til v${installed} og forny snapshots med labelen "opdater snapshots".`,
  );
});

test("snapshot-sammenligning er slaaet til i begge workflows og kun i containeren", () => {
  for (const [name, source] of [["playwright-smoke.yml", smoke], ["update-snapshots.yml", update]]) {
    assert.match(source, /^\s*PW_SNAPSHOT_BASELINE: linux-container\s*$/m, `${name} mangler PW_SNAPSHOT_BASELINE`);
  }
  assert.doesNotMatch(smoke, /^\s*runs-on:\s*windows/m, "e2e maa ikke koere paa windows (baselines er Linux)");
  assert.match(config, /SNAPSHOT_BASELINE_ENV = "PW_SNAPSHOT_BASELINE"/);
  assert.match(config, /SNAPSHOT_BASELINE_VALUE = "linux-container"/);
  assert.match(config, /ignoreSnapshots: !COMPARE_SNAPSHOTS,/);
});

test("label-workflowet fornyer alle tre projekter og kun same-repo-PR'er", () => {
  const matrix = update.match(/^\s*project:\s*\[([^\]]+)\]\s*$/m);
  assert.ok(matrix, "update-snapshots.yml mangler project-matrixen");
  assert.deepEqual((matrix[1] ?? "").split(",").map((s) => s.trim()).sort(), [...projectNames].sort());
  const forkGuards = update.match(/github\.event\.pull_request\.head\.repo\.full_name == github\.repository/g) ?? [];
  assert.ok(forkGuards.length >= 2, "baade generate og commit skal udelukke fork-PR'er");
});

// I containeren er git-brugeren root, men checkout-mappen ejes af runneren.
// Uden safe.directory fejler hvert git-kald efter checkout med "dubious
// ownership" (base-fetch, git ls-files herunder, rent-trae-vagten).
function jobSteps(source: string, jobKey: string): string {
  const start = source.indexOf(`\n  ${jobKey}:\n`);
  assert.ok(start > 0, `mangler jobbet ${jobKey}`);
  const next = source.slice(start + 1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

test("container-jobbene markerer checkout'en som safe.directory foer foerste git-kald", () => {
  const trust = 'git config --global --add safe.directory "$GITHUB_WORKSPACE"';
  for (const [name, job] of [
    ["playwright-smoke.yml e2e-shard", jobSteps(smoke, "e2e-shard")],
    ["update-snapshots.yml generate", jobSteps(update, "generate")],
  ] as const) {
    const code = job.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
    const checkout = code.indexOf("actions/checkout@");
    const trustAt = code.indexOf(trust);
    assert.ok(checkout > 0, `${name}: ingen checkout`);
    assert.ok(trustAt > checkout, `${name}: safe.directory skal saettes efter checkout`);
    const firstGit = code.slice(checkout).search(/(^|[\s;&|(!])git\s(?!config --global --add safe\.directory)/m);
    assert.ok(firstGit < 0 || checkout + firstGit >= trustAt, `${name}: git kaldes foer safe.directory er sat`);
  }
});

test("rent-trae-vagten skelner en aegte diff (exit 1) fra en git-fejl", () => {
  const guard = jobSteps(smoke, "e2e-shard").split("Verify e2e left the working tree clean")[1] ?? "";
  assert.match(guard, /git diff --exit-code --stat \|\| rc=\$\?/);
  assert.match(guard, /if \[ "\$rc" -eq 1 \]; then\n\s*echo "::error::e2e-suiten ændrede committede filer/);
  assert.match(guard, /elif \[ "\$rc" -ne 0 \]; then/);
});

// Sikkerhedsfund paa #8348: jobbet med push-tokenet maa aldrig skrive ind i
// et PR-styret arbejdstrae (et symlink dér kan foere en kopi ind i .git/config
// og koere et PR-leveret hook med tokenet). Kun git-plumbing, hooks slaaet fra.
test("commit-jobbet bygger commit'et med git-plumbing uden arbejdstrae og uden hooks", () => {
  const start = update.indexOf("\n  commit:\n");
  assert.ok(start > 0, "update-snapshots.yml mangler commit-jobbet");
  const job = update.slice(start);
  const code = job
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
  assert.doesNotMatch(code, /actions\/checkout/, "commit-jobbet maa ikke tjekke PR'ens trae ud");
  assert.doesNotMatch(code, /(^|[\s;&|(])(cp|mv|install|rsync|tar|unzip)\s/m, "commit-jobbet maa ikke kopiere filer ind i et trae");
  assert.match(code, /GIT_CONFIG_GLOBAL: \/dev\/null/);
  assert.match(code, /GIT_CONFIG_SYSTEM: \/dev\/null/);
  assert.match(code, /g\(\) \{ git -c core\.hooksPath=\/dev\/null -c core\.fsmonitor=false "\$@"; \}/);
  assert.match(code, /g hash-object -w -- /);
  assert.match(code, /g update-index --add --cacheinfo "100644,/);
  assert.match(code, /g commit-tree /);
  // Hvert git-kald ud over g()-definitionen skal gaa gennem g().
  const rawGit = code.split("\n").filter((line) => /(^|[\s;&|($])git\s/.test(line) && !line.includes("g() { git -c core.hooksPath"));
  assert.deepEqual(rawGit, [], "git kaldt uden om g() (hooks/fsmonitor ikke slaaet fra)");
  assert.doesNotMatch(code, /\bg (commit|add)\s/, "kun commit-tree, aldrig porcelain commit/add");
  assert.doesNotMatch(code, /push[^\n]*(--force|\s-f\s|\+)/, "pushet maa aldrig vaere force");
});

function trackedSnapshots(): string[] | null {
  try {
    return execFileSync("git", ["ls-files", "--", "tests/e2e"], { cwd: FRONTEND_DIR, encoding: "utf8" })
      .split("\n")
      .filter((f) => /-snapshots\//.test(f));
  } catch {
    return null;
  }
}

test("alle committede baselines er Linux-container-billeder, komplette pr. projekt", (t) => {
  const files = trackedSnapshots();
  if (files === null) {
    t.skip("git ikke tilgaengelig");
    return;
  }
  const foreign = files.filter((f) => !f.endsWith("-linux.png"));
  assert.deepEqual(foreign, [], "kun *-linux.png fra containeren; forny med labelen \"opdater snapshots\"");
  assert.ok(files.length > 0, "ingen baselines committet; saet labelen \"opdater snapshots\" paa PR'en");

  const projectAlt = projectNames.join("|");
  const shape = new RegExp(`^(.+)-(${projectAlt})-linux\\.png$`);
  const byName = new Map<string, Set<string>>();
  for (const file of files) {
    const m = file.match(shape);
    assert.ok(m, `ukendt projekt i ${file}`);
    const name = m[1] ?? "";
    const set = byName.get(name) ?? new Set<string>();
    set.add(m[2] ?? "");
    byName.set(name, set);
  }
  for (const [name, projects] of byName) {
    assert.equal(projects.size, projectNames.length, `${name} mangler for: ${projectNames.filter((p) => !projects.has(p)).join(", ")}`);
  }
});
