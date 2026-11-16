// #8049: filerne den nye patch notes-side henter. Størrelsen er selve løftet på issuet
// ("åbning henter under 80 KB patch note-data"), så den låses her og vokser ikke stille.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { PATCHES } from "../src/data/patchNotes.js";
import { buildPatchNotesV2Files, buildLangFiles, buildSeenKeys, latestSeenKeyOf, RECENT_WEEKS } from "./patch-notes-v2.ts";

const RECENT_GZIP_BUDGET = 40 * 1024;

test("åbning henter kun recent, under 40 KB pakket pr. sprog", () => {
  const files = buildPatchNotesV2Files(PATCHES);
  for (const lang of ["en", "da"]) {
    const source = files[`patch-notes-data/recent.${lang}.json`];
    assert.ok(source, `recent.${lang}`);
    const gz = gzipSync(source).length;
    assert.ok(gz < RECENT_GZIP_BUDGET, `recent.${lang}.json er ${gz} bytes pakket (budget ${RECENT_GZIP_BUDGET})`);
  }
});

test("recent dækker de seneste 6 uger; index har resten; månederne har alt", () => {
  const files = buildLangFiles(PATCHES, "en");
  const recent = files["recent.en.json"];
  const index = files["index.en.json"];
  const players = PATCHES.flatMap((p) => p.changes.filter((c) => c.audience === "player"));
  assert.equal(recent.items.length + index.items.length, players.length);
  const recentKeys = new Set(recent.items.map((i) => i.k));
  assert.ok(index.items.every((i) => !recentKeys.has(i.k)));
  assert.ok(recent.items.every((i) => i.d >= recent.recentStart));
  assert.ok(index.items.every((i) => i.d < recent.recentStart));
  assert.equal(RECENT_WEEKS, 6);
  const monthTotal = recent.months.reduce((s, m) => s + m.n, 0);
  assert.equal(monthTotal, players.length);
  for (const { m, n } of recent.months) assert.equal(files[`${m}.en.json`].items.length, n, m);
});

test("punkterne bærer ingen interne noter og ingen ukendte felter", () => {
  const { items } = buildLangFiles(PATCHES, "da")["recent.da.json"];
  const allowed = new Set(["k", "v", "d", "s", "a", "c", "r", "f", "ti", "b", "fb", "img", "hl", "rp"]);
  for (const it of items) {
    for (const key of Object.keys(it)) assert.ok(allowed.has(key), `${it.k}: ${key}`);
    assert.ok(it.a, `${it.k} mangler område`);
  }
});

test("seenKey = dato + løbenummer inden for dagen, stigende med versionen", () => {
  const keys = buildSeenKeys([
    { version: "7.10", date: "2026-11-16" },
    { version: "7.9", date: "2026-11-16" },
    { version: "7.8", date: "2026-11-15" },
  ]);
  assert.equal(keys.get("7.9"), "2026-11-16T00:01");
  assert.equal(keys.get("7.10"), "2026-11-16T00:02");
  assert.equal(keys.get("7.8"), "2026-11-15T00:01");
  assert.equal(latestSeenKeyOf([{ version: "7.10", date: "2026-11-16" }, { version: "7.9", date: "2026-11-16" }]), "2026-11-16T00:02");
  // Passer i serverens markør-mønster (backend/lib/seenMarkers6515.js).
  assert.match(latestSeenKeyOf(PATCHES), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});
