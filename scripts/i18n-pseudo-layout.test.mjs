import test from "node:test";
import assert from "node:assert/strict";

import {
  diffFindings,
  findingKey,
  navHeadroom,
  normalizeText,
  renderFindingsTable,
  sortFindings,
  summarize,
} from "./i18n-pseudo-layout.lib.mjs";

const f = (kind, path, severity = "high", extra = {}) => ({ kind, path, severity, text: "t", detail: "d", ...extra });

test("normalizeText fjerner pseudo-pynt og padding", () => {
  assert.equal(normalizeText("[Dashboard xx·••]"), "dashboard");
  assert.equal(normalizeText("[Set a target xxxxxx xx·••]"), "set a target");
  assert.equal(normalizeText("Plain text"), "plain text");
});

test("findingKey er kind + struktur-sti", () => {
  assert.equal(findingKey(f("ellipsis", "div:1>a:2")), "ellipsis|div:1>a:2");
});

test("diffFindings deler i nye og eksisterende paa kind+sti", () => {
  const baseline = [f("ellipsis", "a"), f("clipped-hard", "b")];
  const pseudo = [f("ellipsis", "a"), f("clipped-hard", "c"), f("wrap-control", "b")];
  const { isNew, existing } = diffFindings(baseline, pseudo);
  assert.deepEqual(existing.map(findingKey), ["ellipsis|a"]);
  assert.deepEqual(isNew.map(findingKey), ["clipped-hard|c", "wrap-control|b"]);
});

test("sortFindings: alvor foerst, derefter type og sti", () => {
  const sorted = sortFindings([f("ellipsis", "z", "low"), f("page-overflow", "html", "high"), f("wrap-control", "a", "medium")]);
  assert.deepEqual(sorted.map((x) => x.severity), ["high", "medium", "low"]);
});

test("summarize taeller pr. alvor og type", () => {
  const s = summarize([f("ellipsis", "a", "low"), f("ellipsis", "b", "low"), f("page-overflow", "html")]);
  assert.equal(s.total, 3);
  assert.deepEqual(s.bySeverity, { low: 2, high: 1 });
  assert.deepEqual(s.byKind, { ellipsis: 2, "page-overflow": 1 });
});

test("navHeadroom er indre bredde minus tekstbredde", () => {
  assert.equal(navHeadroom({ labelBox: 71, textWidth: 55 }), 16);
  assert.equal(navHeadroom({ labelBox: 50, textWidth: 60 }), -10);
});

test("renderFindingsTable: tom liste, escape af pipe og afkortning", () => {
  assert.match(renderFindingsTable([]), /Ingen nye fund/);
  const table = renderFindingsTable([f("ellipsis", "a", "low", { text: "a|b" })]);
  assert.match(table, /a\\\|b/);
  const many = Array.from({ length: 15 }, (_, i) => f("ellipsis", `p${i}`, "low"));
  assert.match(renderFindingsTable(many, 5), /og 10 flere/);
});
