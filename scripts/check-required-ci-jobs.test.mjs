// scripts/check-required-ci-jobs.test.mjs
// ============================================================
// Tests for required-check forward-guarden (#4330).
// Run: node --test scripts/check-required-ci-jobs.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJobs, parseTriggers, findBrokenContexts, findMergeGroupGaps, loadWorkflows } from "./check-required-ci-jobs.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

test("parseJobs laeser job-noegler som check-navne", () => {
  const yaml = `name: CI
on:
  pull_request:

jobs:
  backend-tests:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
  static-guards:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`;
  assert.deepEqual(
    parseJobs(yaml).map((j) => j.checkName),
    ["backend-tests", "static-guards"],
  );
});

test("parseJobs bruger name:-override som check-navn", () => {
  const yaml = `jobs:
  scan:
    name: gitleaks
    runs-on: ubuntu-latest
`;
  const jobs = parseJobs(yaml);
  assert.equal(jobs[0].key, "scan");
  assert.equal(jobs[0].checkName, "gitleaks");
});

test("parseJobs markerer matrix-jobs og dynamiske navne", () => {
  const yaml = `jobs:
  analyze:
    name: Analyze (\${{ matrix.language }})
    strategy:
      matrix:
        language: [javascript]
`;
  const jobs = parseJobs(yaml);
  assert.equal(jobs[0].hasStrategy, true);
  assert.equal(jobs[0].dynamicName, true);
});

test("parseJobs stopper ved naeste top-level noegle", () => {
  const yaml = `jobs:
  a:
    runs-on: ubuntu-latest
concurrency:
  group: x
`;
  assert.deepEqual(
    parseJobs(yaml).map((j) => j.key),
    ["a"],
  );
});

test("findBrokenContexts er tom naar alle navne opløses", () => {
  const workflows = [{ file: "ci.yml", jobs: parseJobs("jobs:\n  getuser-guard:\n    runs-on: ubuntu-latest\n") }];
  assert.deepEqual(findBrokenContexts(["getuser-guard"], workflows), []);
});

test("findBrokenContexts fanger et slettet required job (konsolideringsfaelden)", () => {
  // Praecis #4330-faelden: ni guards samlet i eet job, ni check-navne vaek.
  const workflows = [{ file: "ci.yml", jobs: parseJobs("jobs:\n  static-guards:\n    runs-on: ubuntu-latest\n") }];
  const broken = findBrokenContexts(["getuser-guard"], workflows);
  assert.equal(broken.length, 1);
  assert.equal(broken[0].context, "getuser-guard");
  assert.match(broken[0].reason, /intet job/);
});

test("findBrokenContexts fanger en name:-omdoebning og peger paa den", () => {
  const workflows = [
    { file: "ci.yml", jobs: parseJobs("jobs:\n  getuser-guard:\n    name: getUser guard\n    runs-on: ubuntu-latest\n") },
  ];
  const broken = findBrokenContexts(["getuser-guard"], workflows);
  assert.equal(broken.length, 1);
  assert.match(broken[0].reason, /getUser guard/);
});

test("findBrokenContexts fanger at et required job er blevet en matrix", () => {
  const workflows = [
    { file: "ci.yml", jobs: parseJobs("jobs:\n  getuser-guard:\n    strategy:\n      matrix:\n        n: [1, 2]\n") },
  ];
  const broken = findBrokenContexts(["getuser-guard"], workflows);
  assert.equal(broken.length, 1);
  assert.match(broken[0].reason, /matrix/);
});

test("parseTriggers laeser blok-formen og skelner pull_request fra _target", () => {
  const yaml = `name: CI
on:
  push:
    branches:
      - main
  pull_request:
  merge_group:

jobs:
  a:
    runs-on: ubuntu-latest
`;
  assert.deepEqual(parseTriggers(yaml).sort(), ["merge_group", "pull_request", "push"]);

  const targetOnly = `on:
  pull_request_target:
    types: [opened]
`;
  assert.deepEqual(parseTriggers(targetOnly), ["pull_request_target"]);
  assert.ok(!parseTriggers(targetOnly).includes("pull_request"));
});

test("parseTriggers laeser inline-formen", () => {
  assert.deepEqual(parseTriggers("on: [push, pull_request]\n").sort(), ["pull_request", "push"]);
  assert.deepEqual(parseTriggers("on: pull_request\n"), ["pull_request"]);
});

test("findBrokenContexts fanger et required job i en workflow uden pull_request-trigger", () => {
  // Fejlklassen: jobbet findes og hedder det rigtige, men workflowet koerer
  // kun paa push/schedule. Checket rapporterer aldrig paa en PR.
  const workflows = [
    {
      file: "nightly.yml",
      jobs: parseJobs("jobs:\n  getuser-guard:\n    runs-on: ubuntu-latest\n"),
      triggers: ["push", "schedule"],
    },
  ];
  const broken = findBrokenContexts(["getuser-guard"], workflows);
  assert.equal(broken.length, 1);
  assert.match(broken[0].reason, /pull_request/);
});

test("findBrokenContexts accepterer at kun EEN af flere producenter koerer paa PR", () => {
  // perf-gate-moenstret: lighthouse-ci.yml er paths-filtreret, stubben daekker
  // resten under samme job-navn. Begge skal ikke kraeves.
  const workflows = [
    { file: "a.yml", jobs: parseJobs("jobs:\n  perf-gate:\n    runs-on: ubuntu-latest\n"), triggers: ["push"] },
    { file: "b.yml", jobs: parseJobs("jobs:\n  perf-gate:\n    runs-on: ubuntu-latest\n"), triggers: ["pull_request"] },
  ];
  assert.deepEqual(findBrokenContexts(["perf-gate"], workflows), []);
});

test("findMergeGroupGaps er advisory og peger paa workflows uden merge_group", () => {
  const workflows = [
    { file: "a.yml", jobs: parseJobs("jobs:\n  gitleaks:\n    runs-on: ubuntu-latest\n"), triggers: ["pull_request"] },
    {
      file: "b.yml",
      jobs: parseJobs("jobs:\n  backend-tests:\n    runs-on: ubuntu-latest\n"),
      triggers: ["pull_request", "merge_group"],
    },
  ];
  const gaps = findMergeGroupGaps(["gitleaks", "backend-tests"], workflows);
  assert.deepEqual(
    gaps.map((g) => g.context),
    ["gitleaks"],
  );
});

test("kontrakt-filen opløses mod repoets faktiske workflows", () => {
  // BEMAERK: dette er IKKE en drift-test mod GitHub. Begge sider af
  // sammenligningen stammer fra den committede JSON — testen beviser kun at
  // navnene i kontrakt-filen stadig produceres af et job der koerer paa
  // pull_request. At kontrakt-filen SELV matcher main's branch protection er
  // et manuelt tjek:
  //   node scripts/check-required-ci-jobs.mjs --verify-against-github
  // Se _comment + capturedAt i scripts/ci-required-checks.json.
  const contract = JSON.parse(readFileSync(join(ROOT, "scripts", "ci-required-checks.json"), "utf8"));
  assert.ok(contract.contexts.length > 0, "kontrakt-filen skal liste mindst eet required check");
  assert.match(contract.capturedAt ?? "", /^\d{4}-\d{2}-\d{2}$/, "capturedAt skal vise hvornaar spejlet sidst blev hentet");
  assert.deepEqual(findBrokenContexts(contract.contexts, loadWorkflows()), []);
});

test("required-ci-jobs-guarden koerer i et job der selv er required", () => {
  // Selve pointen med #4330-rettelsen: en guard er kun en gate hvis et roedt
  // resultat kan BLOKERE en merge. auto-merge.yml venter paa
  // `gh pr checks --required`, saa et ikke-required job stopper ingenting.
  const contract = JSON.parse(readFileSync(join(ROOT, "scripts", "ci-required-checks.json"), "utf8"));
  const workflows = loadWorkflows();

  const hosts = workflows
    .filter((w) => /check-required-ci-jobs\.mjs/.test(readFileSync(join(ROOT, w.file), "utf8")))
    .flatMap((w) => jobsRunningGuard(join(ROOT, w.file)));

  assert.ok(hosts.length > 0, "guarden skal koeres af mindst eet job");
  for (const host of hosts) {
    assert.ok(
      contract.contexts.includes(host),
      `jobbet "${host}" koerer required-ci-jobs-guarden, men er ikke et required check — et roedt resultat ville ikke blokere merge`,
    );
  }
});

/**
 * Finder job-noeglerne i en workflow-fil hvis step-blok kalder
 * check-required-ci-jobs.mjs. Samme flade regex-idiom som selve guarden.
 *
 * @param {string} path absolut sti til workflow-fil
 * @returns {string[]} job-noegler
 */
function jobsRunningGuard(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const hits = new Set();
  let inJobs = false;
  let current = null;

  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    if (/^[A-Za-z_]/.test(line)) {
      inJobs = false;
      continue;
    }
    const jobKey = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (jobKey) {
      current = jobKey[1];
      continue;
    }
    if (current && /run:.*check-required-ci-jobs\.mjs/.test(line)) hits.add(current);
  }

  return [...hits];
}
