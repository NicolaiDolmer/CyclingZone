// #6740 (Friis/knud 16/10): a team removed at the start, or with an injured rider in its
// lineup, must not look like a normal locked squad. Source contract, same style as the
// other racehub source tests: the column has no render harness in node --test.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./RaceColumn.jsx", import.meta.url), "utf8");

test("did_not_start from the server gives its own status and note, after withdrawn", () => {
  assert.match(src, /const didNotStart = !column\.withdrawn && locked && !!column\.did_not_start;/);
  const withdrawnAt = src.indexOf('{ kind: "withdrawn"');
  const dnsAt = src.indexOf('{ kind: "didNotStart" }');
  const lockedAt = src.indexOf('{ kind: "locked" }');
  assert.ok(withdrawnAt > 0 && dnsAt > withdrawnAt && lockedAt > dnsAt, "withdrawn > didNotStart > locked");
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
