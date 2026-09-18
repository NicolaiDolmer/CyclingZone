// Guard for docs/NOW.md-sidevogns-reglen (#5093): enhver commit der rører
// docs/NOW.md skal have et docs(...)/chore(...)-conventional-commit-praefiks.
//
// Kør: node --test scripts/check-now-md-sidecar.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { commitTypeOf, isNowMdSidecarCommit, findNowMdSidecarViolations } from "./check-now-md-sidecar.mjs";

test("commitTypeOf udtraekker conventional-commit-typen", () => {
  assert.equal(commitTypeOf("docs(now): dagboelge 18/9 startet"), "docs");
  assert.equal(commitTypeOf("chore(deps): bump foo"), "chore");
  assert.equal(commitTypeOf("feat(auction): tilfoej bud-historik"), "feat");
  assert.equal(commitTypeOf("fix(race-engine): ret timing-bug"), "fix");
  assert.equal(commitTypeOf("wip: lane start"), "wip");
});

test("commitTypeOf returnerer null uden et conventional-commit-praefiks", () => {
  assert.equal(commitTypeOf("Merge branch 'main' into feature/x"), null);
  assert.equal(commitTypeOf(""), null);
  assert.equal(commitTypeOf(undefined), null);
});

test("isNowMdSidecarCommit tillader kun docs/chore", () => {
  assert.equal(isNowMdSidecarCommit("docs(now): close-out"), false);
  assert.equal(isNowMdSidecarCommit("docs(audit): merget PR #123"), false);
  assert.equal(isNowMdSidecarCommit("chore(release): v7.286"), false);
  assert.equal(isNowMdSidecarCommit("feat(auction): tilfoej bud-historik"), true);
  assert.equal(isNowMdSidecarCommit("fix(race-engine): ret timing-bug"), true);
  assert.equal(isNowMdSidecarCommit("Merge branch 'main'"), true);
});

test("findNowMdSidecarViolations ignorerer commits der ikke roerer NOW.md", () => {
  const commits = [
    { sha: "a1", subject: "feat(auction): tilfoej bud-historik", files: ["frontend/src/Auction.jsx"] },
  ];
  assert.deepEqual(findNowMdSidecarViolations(commits), []);
});

test("findNowMdSidecarViolations godkender docs(now)/chore-commits der roerer NOW.md", () => {
  const commits = [
    { sha: "a1", subject: "docs(now): close-out", files: ["docs/NOW.md"] },
    { sha: "a2", subject: "chore(release): v7.286", files: ["docs/NOW.md", "package.json"] },
  ];
  assert.deepEqual(findNowMdSidecarViolations(commits), []);
});

test("findNowMdSidecarViolations flager en feature-commit der roerer NOW.md som sidevogn", () => {
  const commits = [
    { sha: "abc123def", subject: "feat(auction): tilfoej bud-historik", files: ["frontend/src/Auction.jsx", "docs/NOW.md"] },
  ];
  const found = findNowMdSidecarViolations(commits);
  assert.equal(found.length, 1);
  assert.equal(found[0].sha, "abc123def");
  assert.equal(found[0].type, "feat");
});

test("findNowMdSidecarViolations flager en commit uden conventional-commit-praefiks der roerer NOW.md", () => {
  const commits = [{ sha: "b2", subject: "wip: lane start", files: ["docs/NOW.md"] }];
  const found = findNowMdSidecarViolations(commits);
  assert.equal(found.length, 1);
  assert.equal(found[0].type, "wip");
});

test("findNowMdSidecarViolations flager flere overtraedelser i samme kald", () => {
  const commits = [
    { sha: "c1", subject: "fix(bug): x", files: ["docs/NOW.md"] },
    { sha: "c2", subject: "docs(now): close-out", files: ["docs/NOW.md"] },
    { sha: "c3", subject: "refactor(lib): y", files: ["docs/NOW.md", "backend/lib/y.js"] },
  ];
  const found = findNowMdSidecarViolations(commits);
  assert.deepEqual(found.map((f) => f.sha), ["c1", "c3"]);
});
