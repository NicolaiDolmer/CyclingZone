// #6740 (Friis/knud 16/10): a team removed at the start, or with an injured rider in its
// lineup, must not look like a normal locked squad. Source contract, same style as the
// other racehub source tests: the column has no render harness in node --test.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./RaceColumn.jsx", import.meta.url), "utf8");

test("did_not_start from the server gives its own status and note, after withdrawn", () => {
  assert.match(src, /const didNotStart = locked && !!column\.did_not_start;/);
  const withdrawnAt = src.indexOf('{ kind: "withdrawn"');
  const dnsAt = src.indexOf('{ kind: "didNotStart" }');
  const lockedAt = src.indexOf('{ kind: "locked" }');
  // #6740: en did_not_start-afmelding saetter ogsaa withdrawn; teksten skal sige did not start.
  assert.ok(dnsAt > 0 && withdrawnAt > dnsAt && lockedAt > withdrawnAt, "didNotStart > withdrawn > locked");
  assert.match(src, /data-testid="column-did-not-start"/);
  assert.match(src, /racehub\.column\.didNotStartNote/);
});

test("an injured selected rider is marked and does not count toward the floor", () => {
  assert.match(src, /r\.injured && <InjuredBadge label=\{t\("selection\.injured"\)\} \/>/);
  assert.equal(src.match(/<InjuredBadge /g)?.length, 2, "locked row + editable row");
  assert.match(src, /const fitSelected = selectedIds\.filter\(\(id\) => !ridersById\.get\(id\)\?\.injured\)\.length;/);
  assert.match(src, /selected: fitSelected,/);
});

test("both new strings exist in EN and DA", () => {
  for (const lang of ["en", "da"]) {
    const j = JSON.parse(readFileSync(new URL(`../../../public/locales/${lang}/races.json`, import.meta.url), "utf8"));
    assert.equal(typeof j.racehub.status.didNotStart, "string");
    assert.match(j.racehub.column.didNotStartNote, /\{min\}/);
  }
});

test("#6740 release: panel og sæsonmatrix viser did_not_start, ikke 'du har meldt fra'", () => {
  const panel = readFileSync(new URL("../race/RaceSelectionPanel.jsx", import.meta.url), "utf8");
  const matrix = readFileSync(new URL("./SeasonMatrix.jsx", import.meta.url), "utf8");
  const didNotStartAt = panel.indexOf("if (data.did_not_start) {");
  assert.ok(didNotStartAt > 0 && didNotStartAt < panel.indexOf("if (data.withdrawn) {"), "did_not_start foer withdrawnPanel");
  assert.match(matrix, /didNotStart: didNotStart\.has\(r\.id\)/);
  assert.equal(matrix.match(/racehub\.status\.didNotStart/g)?.length, 2, "desktop + mobil");
  // Hintet (tooltip + popover) siger did not start, aldrig "du har meldt fra".
  assert.equal(matrix.match(/withdrawnHintFor\(race\)/g)?.length, 2);
  // Kolonnen viser ingen afmeld/deltag-igen-knap for et hold der blev fjernet ved start.
  const col = readFileSync(new URL("./RaceColumn.jsx", import.meta.url), "utf8");
  assert.match(col, /\{didNotStart \? <span \/> : \(/);
});
