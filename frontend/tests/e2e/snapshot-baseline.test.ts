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

const read = (p: string): string => fs.readFileSync(p, "utf8");
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
