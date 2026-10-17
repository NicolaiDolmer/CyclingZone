import test from "node:test";
import assert from "node:assert/strict";

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  afterStatus,
  bottomNavIssues,
  computeBuildStamp,
  diffFindings,
  findingKey,
  isBuildCurrent,
  lineCountFromRects,
  measureLayout,
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

// ── #6816 punkt 2: linjetaelling paa tekstnodernes rektangler ───────────────

const rect = (top, bottom, left = 0, width = 40) => ({ top, bottom, left, right: left + width, width, height: bottom - top });

test("lineCountFromRects: rektangler paa samme linje er én linje", () => {
  assert.equal(lineCountFromRects([rect(0, 20, 0), rect(0, 20, 50), rect(2, 18, 100)]), 1);
});

test("lineCountFromRects: hver lodret forskudt gruppe er en ny linje", () => {
  assert.equal(lineCountFromRects([rect(0, 20), rect(20, 40), rect(40, 60)]), 3);
  assert.equal(lineCountFromRects([rect(20, 40, 0), rect(0, 20, 0)]), 2);
});

test("lineCountFromRects: tomme/nul-brede rektangler (efterladt mellemrum) taeller ikke", () => {
  assert.equal(lineCountFromRects([rect(0, 20), rect(20, 40, 0, 0), rect(40, 60, 0, 0.4)]), 1);
  assert.equal(lineCountFromRects([]), 0);
});

test("lineCountFromRects: en lavere inline-boks midt paa linjen skaber ikke en ny linje", () => {
  assert.equal(lineCountFromRects([rect(0, 20, 0), rect(6, 16, 50), rect(0, 20, 100)]), 1);
});

test("measureLayout indeholder lineCountFromRects ordret (browser-kopien maa ikke drive)", () => {
  const squash = (s) => s.replace(/\s+/g, "");
  assert.ok(squash(measureLayout.toString()).includes(squash(lineCountFromRects.toString())));
});

// ── #6816 punkt 1: efter-status og bundnavigation ───────────────────────────

const navRow = (extra = {}) => ({ label: "Tab", labelBox: 70, textWidth: 50, lines: 1, ellipsis: false, clipped: false, ...extra });

test("bottomNavIssues: kun faner med klip, ellipse, ombrydning eller negativ headroom", () => {
  const rows = [
    navRow({ label: "ok" }),
    navRow({ label: "klip", clipped: true }),
    navRow({ label: "ellipse", ellipsis: true }),
    navRow({ label: "to-linjer", lines: 2 }),
    navRow({ label: "for-bred", textWidth: 80 }),
    navRow({ label: "lige-paa", textWidth: 70 }),
  ];
  assert.deepEqual(bottomNavIssues(rows).map((r) => r.label), ["klip", "ellipse", "to-linjer", "for-bred"]);
  assert.deepEqual(bottomNavIssues(undefined), []);
});

test("afterStatus: rettet kun naar efter-koerslen er ok, har maalt og intet er tilbage", () => {
  assert.equal(afterStatus({ ok: true, measured: true, remaining: 0 }), "fixed");
  assert.equal(afterStatus({ ok: true, measured: true, remaining: 2 }), "rest");
});

test("afterStatus: fejlet eller umaalt efter-koersel er ukendt, aldrig rettet", () => {
  assert.equal(afterStatus({ ok: false, measured: true, remaining: 0 }), "unknown");
  assert.equal(afterStatus({ ok: true, measured: false, remaining: 0 }), "unknown");
  assert.equal(afterStatus({ measured: false, remaining: 0 }), "unknown");
});

test("afterStatus + bottomNavIssues: en klippet fane i efter-koerslen giver rest", () => {
  const after = [navRow(), navRow({ label: "Leaderboard", clipped: true })];
  const issues = bottomNavIssues(after);
  assert.equal(afterStatus({ ok: true, measured: after.length > 0, remaining: issues.length }), "rest");
  assert.equal(afterStatus({ ok: true, measured: false, remaining: bottomNavIssues([]).length }), "unknown");
});

// ── #6816 punkt 3: byg-maerke ───────────────────────────────────────────────

test("computeBuildStamp: HEAD + hash af lokale aendringer + base", () => {
  const clean = computeBuildStamp({ head: "abc123\n", status: "", diff: "", base: "http://127.0.0.1:4173" });
  assert.equal(clean, "abc123|clean|http://127.0.0.1:4173");
  const dirty = computeBuildStamp({ head: "abc123", status: " M frontend/src/a.jsx", diff: "diff --git a b", base: "http://127.0.0.1:4173" });
  assert.match(dirty, /^abc123\|[0-9a-f]{12}\|http:\/\/127\.0\.0\.1:4173$/);
  assert.notEqual(dirty, clean);
});

test("computeBuildStamp: andet indhold i diff eller anden port giver andet maerke", () => {
  const a = computeBuildStamp({ head: "h", diff: "x", base: "b1" });
  assert.notEqual(a, computeBuildStamp({ head: "h", diff: "y", base: "b1" }));
  assert.notEqual(a, computeBuildStamp({ head: "h", diff: "x", base: "b2" }));
  assert.notEqual(a, computeBuildStamp({ head: "h2", diff: "x", base: "b1" }));
  assert.equal(a, computeBuildStamp({ head: "h", diff: "x", base: "b1" }));
});

test("computeBuildStamp: uden HEAD er der intet maerke, og saa kan dist aldrig vaere aktuel", () => {
  assert.equal(computeBuildStamp({ head: "", base: "b" }), null);
  assert.equal(computeBuildStamp({ base: "b" }), null);
  assert.equal(isBuildCurrent("noget", null), false);
});

test("isBuildCurrent: kun et praecist match er aktuelt", () => {
  const stamp = computeBuildStamp({ head: "abc", base: "b" });
  assert.equal(isBuildCurrent(`${stamp}\n`, stamp), true);
  assert.equal(isBuildCurrent(stamp, stamp), true);
  assert.equal(isBuildCurrent(null, stamp), false);
  assert.equal(isBuildCurrent("", stamp), false);
  assert.equal(isBuildCurrent(computeBuildStamp({ head: "old", base: "b" }), stamp), false);
});

// ── #6816 punkt 2, i en rigtig browser ──────────────────────────────────────
// Kraever Chromium fra frontend/node_modules (Playwright). Findes den ikke
// (fx et CI-job uden frontend-installation), springes disse over; de rene
// tests ovenfor koerer altid.

let chromiumLaunch = null;
try {
  const req = createRequire(fileURLToPath(new URL("../frontend/package.json", import.meta.url)));
  const { chromium } = req("@playwright/test");
  const probe = await chromium.launch();
  await probe.close();
  chromiumLaunch = () => chromium.launch();
} catch {
  chromiumLaunch = null;
}

const FIXTURE = `<!doctype html><html><body style="margin:0;font:16px/20px Arial,sans-serif">
<main>
  <button class="fixedh" style="height:80px;width:300px">Save</button>
  <button class="wrapped" style="width:90px">A rather long button label here</button>
  <button class="iconcol" style="display:flex;flex-direction:column;align-items:center;width:200px"><svg width="40" height="40"></svg><span>Label</span></button>
  <button class="srcopy" style="width:300px">Go<span style="position:absolute;width:1px;height:1px;overflow:hidden">screen reader only extra words that would wrap</span></button>
</main>
<nav style="position:fixed;left:0;bottom:0;width:200px;display:flex">
  <a href="#" style="display:block;width:100px;padding:4px;box-sizing:border-box"><span>Short</span></a>
  <a href="#" style="display:block;width:100px;padding:4px;box-sizing:border-box"><span>Very long label text</span></a>
</nav></body></html>`;

test("measureLayout i Chromium: linjer = tekstens linjer, ikke kontrollens hoejde", { skip: !chromiumLaunch && "Chromium ikke tilgaengelig" }, async () => {
  const browser = await chromiumLaunch();
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 300 } });
    await page.setContent(FIXTURE);
    const result = await page.evaluate(measureLayout, { maxFindings: 100 });
    const wraps = result.findings.filter((f) => f.kind === "wrap-control");
    const byClass = (c) => wraps.find((f) => f.path.endsWith(`.${c}`));

    assert.equal(byClass("fixedh"), undefined, "fast hoejde 80px er ikke flere linjer");
    assert.equal(byClass("iconcol"), undefined, "ikon over teksten er ikke en ombrydning");
    assert.equal(byClass("srcopy"), undefined, "sr-only tekst taeller ikke");
    assert.ok(byClass("wrapped"), "reel ombrydning findes");
    assert.ok(byClass("wrapped").lines >= 2);

    assert.equal(result.bottomNav.length, 2);
    const [short, long] = result.bottomNav;
    assert.equal(short.lines, 1);
    assert.ok(long.lines >= 2, `lang label skal ombrydes, fik ${long.lines}`);
    assert.deepEqual(bottomNavIssues(result.bottomNav).map((r) => r.label), ["Very long label text"]);
    assert.ok(long.rect && long.rect.w === 100 && long.rect.h > 0, "fanen har en rect til kortet");
  } finally {
    await browser.close();
  }
});
