// Guard for docs/NOW.md-sidevogns-reglen (#5093, ejer-valg 18/9: A): en PR
// der roerer docs/NOW.md skal fejle, medmindre PR-titlen starter med
// "docs(now)" eller "docs(close-out)".
//
// Koer: node --test scripts/check-now-md-sidecar.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { NOW_MD, isAllowedCloseOutTitle, isDependabotActor, evaluateNowMdSidecar } from "./check-now-md-sidecar.mjs";

test("isAllowedCloseOutTitle godkender docs(now) og docs(close-out), case-insensitivt", () => {
  assert.equal(isAllowedCloseOutTitle("docs(now): dagboelge 18/9 close-out"), true);
  assert.equal(isAllowedCloseOutTitle("DOCS(NOW): close-out"), true);
  assert.equal(isAllowedCloseOutTitle("docs(close-out): session slut"), true);
  assert.equal(isAllowedCloseOutTitle("Docs(Close-Out): x"), true);
});

test("isAllowedCloseOutTitle afviser andre praefikser og scopes", () => {
  assert.equal(isAllowedCloseOutTitle("feat(auction): tilfoej bud-historik"), false);
  assert.equal(isAllowedCloseOutTitle("chore(now): opdatering"), false);
  assert.equal(isAllowedCloseOutTitle("docs(now-audit): x"), false);
  assert.equal(isAllowedCloseOutTitle("docs: now.md opdateret"), false);
  assert.equal(isAllowedCloseOutTitle(""), false);
  assert.equal(isAllowedCloseOutTitle(undefined), false);
  assert.equal(isAllowedCloseOutTitle(null), false);
});

test("isAllowedCloseOutTitle ignorerer leading/trailing whitespace", () => {
  assert.equal(isAllowedCloseOutTitle("  docs(now): x  "), true);
});

test("isDependabotActor genkender dependabot[bot], case-insensitivt", () => {
  assert.equal(isDependabotActor("dependabot[bot]"), true);
  assert.equal(isDependabotActor("Dependabot[bot]"), true);
  assert.equal(isDependabotActor("NicolaiDolmer"), false);
  assert.equal(isDependabotActor(undefined), false);
  assert.equal(isDependabotActor(""), false);
});

test("evaluateNowMdSidecar: NOW.md ikke roert -> ok, uanset titel", () => {
  const result = evaluateNowMdSidecar({
    changedFiles: ["frontend/src/Auction.jsx"],
    prTitle: "feat(auction): tilfoej bud-historik",
  });
  assert.equal(result.verdict, "ok");
});

test("evaluateNowMdSidecar: dependabot-PR der roerer NOW.md -> ok (undtaget)", () => {
  const result = evaluateNowMdSidecar({
    changedFiles: [NOW_MD, "package.json"],
    prTitle: "chore(deps): bump foo from 1.0.0 to 1.0.1",
    actor: "dependabot[bot]",
  });
  assert.equal(result.verdict, "ok");
});

test("evaluateNowMdSidecar: NOW.md roert + close-out-titel -> ok", () => {
  const result = evaluateNowMdSidecar({
    changedFiles: [NOW_MD],
    prTitle: "docs(now): dagboelge 18/9 close-out",
  });
  assert.equal(result.verdict, "ok");
});

test("evaluateNowMdSidecar: NOW.md roert + docs(close-out)-titel -> ok", () => {
  const result = evaluateNowMdSidecar({
    changedFiles: [NOW_MD, "docs/MASTERPLAN.md"],
    prTitle: "docs(close-out): session slut",
  });
  assert.equal(result.verdict, "ok");
});

test("evaluateNowMdSidecar: NOW.md roert + almindelig feature-titel -> fail", () => {
  const result = evaluateNowMdSidecar({
    changedFiles: ["frontend/src/Auction.jsx", NOW_MD],
    prTitle: "feat(auction): tilfoej bud-historik",
  });
  assert.equal(result.verdict, "fail");
  assert.match(result.message, /docs\(now\)/);
  assert.match(result.message, /#5093/);
});

test("evaluateNowMdSidecar: NOW.md roert + PR-titel ukendt -> warn (lokalt tjek)", () => {
  const result = evaluateNowMdSidecar({
    changedFiles: [NOW_MD],
    prTitle: undefined,
  });
  assert.equal(result.verdict, "warn");
});

test("evaluateNowMdSidecar: NOW.md roert + tom streng som titel -> fail (kendt, men ugyldig)", () => {
  const result = evaluateNowMdSidecar({
    changedFiles: [NOW_MD],
    prTitle: "",
  });
  assert.equal(result.verdict, "fail");
});

test("evaluateNowMdSidecar: manglende actor behandles som ikke-dependabot", () => {
  const result = evaluateNowMdSidecar({
    changedFiles: [NOW_MD],
    prTitle: "docs(now): close-out",
  });
  assert.equal(result.verdict, "ok");
});
