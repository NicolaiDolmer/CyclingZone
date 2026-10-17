// #6751 · Kontrakten for generalprøve-orkestreringen: read-only, fast rækkefølge,
// prod kun bag --prod og infisical, og en offentlig oversigt uden tal fra output.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  FORBIDDEN_FLAGS,
  PROD_WRAPPER,
  REPO_ROOT,
  assertReadOnlyStep,
  buildPlan,
  commandFor,
  judgeStep,
  overallExit,
  parseArgs,
  renderSummary,
  selectSteps,
} from "./seasonTransitionRehearsal.mjs";

test("hele planen er read-only og har unikke trin-id'er", () => {
  const plan = buildPlan({ fromSeason: 4 });
  assert.ok(plan.length >= 10);
  for (const step of plan) assert.equal(assertReadOnlyStep(step), true);
  assert.equal(new Set(plan.map((s) => s.id)).size, plan.length);
});

test("hvert trin peger på et script der findes i repoet", () => {
  for (const step of buildPlan({ fromSeason: 4 })) {
    const script = step.cmd.find((p) => /\.(m?js|ps1)$/.test(p));
    assert.ok(script, `trin ${step.id} har intet script`);
    assert.ok(existsSync(join(step.cwd, script)), `${step.id}: ${script} findes ikke under ${step.cwd}`);
  }
});

test("offline-trin kører før prod-trin", () => {
  const kinds = buildPlan({ fromSeason: 4 }).map((s) => s.kind);
  const lastOffline = kinds.lastIndexOf("offline");
  const firstProd = kinds.indexOf("prod");
  assert.ok(lastOffline < firstProd);
});

test("sæsonnumre følger --from", () => {
  const plan = buildPlan({ fromSeason: 7 });
  const preflight = plan.find((s) => s.id === "preflight");
  assert.deepEqual(preflight.cmd.slice(-4), ["-FromSeasonNumber", "7", "-ToSeasonNumber", "8"]);
  const promo = plan.find((s) => s.id === "promotion-pending");
  assert.deepEqual(promo.cmd.slice(-2), ["--season", "8"]);
});

test("et skrive-flag afvises, også med =værdi og store bogstaver", () => {
  for (const flag of FORBIDDEN_FLAGS) {
    const step = { id: "x", kind: "prod", cmd: ["node", "s.js", flag] };
    assert.throws(() => assertReadOnlyStep(step), /ikke read-only/);
  }
  assert.throws(
    () => assertReadOnlyStep({ id: "x", kind: "prod", cmd: ["node", "s.js", "--OWNER-GO=5864-production"] }),
    /ikke read-only/,
  );
  assert.throws(() => assertReadOnlyStep({ id: "x", kind: "staging", cmd: ["node"] }), /ukendt kind/);
});

test("prod-trin pakkes i infisical prod-wrapperen, offline-trin gør ikke", () => {
  const plan = buildPlan({ fromSeason: 4 });
  const prod = plan.find((s) => s.kind === "prod");
  const offline = plan.find((s) => s.kind === "offline");
  assert.deepEqual(commandFor(prod).slice(0, PROD_WRAPPER.length), [...PROD_WRAPPER]);
  assert.ok(!commandFor(offline).includes("infisical"));
});

test("uden --prod springes alle prod-trin over", () => {
  const steps = selectSteps(buildPlan({ fromSeason: 4 }), { prod: false, only: null });
  for (const s of steps) assert.equal(Boolean(s.skip), s.kind === "prod");
  const withProd = selectSteps(buildPlan({ fromSeason: 4 }), { prod: true, only: null });
  assert.ok(withProd.every((s) => !s.skip));
});

test("--only filtrerer og et ukendt id er en fejl", () => {
  const plan = buildPlan({ fromSeason: 4 });
  const steps = selectSteps(plan, { prod: true, only: ["parking", "preflight"] });
  assert.deepEqual(steps.map((s) => s.id), ["preflight", "parking"]);
  assert.throws(() => selectSteps(plan, { prod: true, only: ["findes-ikke"] }), /Ukendte trin/);
});

test("parseArgs: flag, defaults og validering", () => {
  assert.deepEqual(parseArgs([]), { prod: false, list: false, only: null, fromSeason: 4, issue: "6751" });
  const o = parseArgs(["--prod", "--only=a,b", "--from=5", "--issue=7000"]);
  assert.equal(o.prod, true);
  assert.deepEqual(o.only, ["a", "b"]);
  assert.equal(o.fromSeason, 5);
  assert.equal(o.issue, "7000");
  assert.throws(() => parseArgs(["--apply"]), /Ukendt argument/);
  assert.throws(() => parseArgs(["--from=0"]), /positivt heltal/);
  assert.throws(() => parseArgs(["--issue=../x"]), /issue-nummer/);
});

test("dommere: preflight, løbsdag, oprykning og transitionsplan", () => {
  const plan = buildPlan({ fromSeason: 4 });
  const by = (id) => plan.find((s) => s.id === id);
  assert.equal(judgeStep(by("preflight"), { exitCode: 0, output: "[ok] a\n[GO] klar" }), "green");
  assert.equal(judgeStep(by("preflight"), { exitCode: 0, output: "[warn] #2840\n[GO]" }), "yellow");
  assert.equal(judgeStep(by("preflight"), { exitCode: 0, output: "[NO-GO] x" }), "red");
  assert.equal(judgeStep(by("loadtest-race-day"), { exitCode: 1, output: "## season-last-day: FAIL" }), "red");
  assert.equal(judgeStep(by("loadtest-race-day"), { exitCode: 0, output: "## normal: PASS" }), "green");
  assert.equal(
    judgeStep(by("promotion-pending"), { exitCode: 0, output: "rykkes op 3 · AFVENTER 2\nrykkes op 1 · AFVENTER 0" }),
    "yellow",
  );
  assert.equal(judgeStep(by("promotion-pending"), { exitCode: 0, output: "AFVENTER 0\nAFVENTER 0" }), "green");
  assert.equal(judgeStep(by("transition-plan"), { exitCode: 0, output: "→ cron vil IKKE fyre endnu" }), "yellow");
  assert.equal(judgeStep(by("contract-expiry"), { exitCode: 0, output: "" }), "ran");
  assert.equal(judgeStep(by("contract-expiry"), { exitCode: 2, output: "" }), "red");
});

test("oversigten indeholder ingen output-tal og exit følger røde trin", () => {
  const results = [
    { id: "a", area: "A", status: "green", exitCode: 0 },
    { id: "b", area: "B", status: "skipped", note: "kræver --prod", exitCode: null },
  ];
  const md = renderSummary(results, { fromSeason: 4, startedAt: "2026-10-17T00:00:00.000Z" });
  assert.match(md, /S4 -> S5/);
  assert.match(md, /sprunget over \(kræver --prod\)/);
  assert.match(md, /Ingen røde trin/);
  assert.equal(overallExit(results), 0);
  assert.equal(overallExit([...results, { id: "c", area: "C", status: "red", exitCode: 1 }]), 1);
});

test("privat log lander under balance-internals, som er gitignoreret", () => {
  const ignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");
  assert.match(ignore, /^balance-internals\/\s*$/m);
});
