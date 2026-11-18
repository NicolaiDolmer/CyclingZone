import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPatchNotesUnread, buildNavDotFlags, resolveNavDot, loadPatchNotesMeta, pickPatchNotesMarker,
} from "./patchNotesUnread.js";

test("isPatchNotesUnread er true ved første besøg (ingen lastSeen)", () => {
  // #3811: modsat computeNewDays — spilleren fra issuet har aldrig åbnet siden.
  assert.equal(isPatchNotesUnread("2026-08-15", null), true);
  assert.equal(isPatchNotesUnread("2026-08-15", undefined), true);
});

test("isPatchNotesUnread er true når nyeste dato er efter lastSeen", () => {
  assert.equal(isPatchNotesUnread("2026-08-15", "2026-08-10"), true);
});

test("isPatchNotesUnread er false når lastSeen er samme dato eller nyere", () => {
  assert.equal(isPatchNotesUnread("2026-08-15", "2026-08-15"), false);
  assert.equal(isPatchNotesUnread("2026-08-10", "2026-08-15"), false);
});

test("isPatchNotesUnread er false uden en kendt nyeste dato", () => {
  assert.equal(isPatchNotesUnread(null, null), false);
  assert.equal(isPatchNotesUnread(undefined, "2026-08-10"), false);
});

test("buildNavDotFlags mapper kun /patch-notes", () => {
  assert.deepEqual(buildNavDotFlags({ patchNotesUnread: true }), { "/patch-notes": true });
  assert.deepEqual(buildNavDotFlags(), { "/patch-notes": false });
});

test("resolveNavDot er false for items uden dot: true, uanset kortet", () => {
  const flags = buildNavDotFlags({ patchNotesUnread: true });
  assert.equal(resolveNavDot({ to: "/patch-notes" }, flags), false);
  assert.equal(resolveNavDot({ to: "/team", dot: true }, flags), false);
});

test("resolveNavDot slår ulæst-flaget op for et item med dot: true", () => {
  const flags = buildNavDotFlags({ patchNotesUnread: true });
  assert.equal(resolveNavDot({ to: "/patch-notes", dot: true }, flags), true);
});

test("loadPatchNotesMeta parser {version, date} og kaster ved fejl", async () => {
  const ok = () => Promise.resolve({
    ok: true, json: () => Promise.resolve({ version: "7.133", date: "2026-08-15" }),
  });
  const meta = await loadPatchNotesMeta("/patch-notes-meta.json", ok);
  assert.deepEqual(meta, { version: "7.133", date: "2026-08-15" });

  const httpError = () => Promise.resolve({ ok: false, status: 500, statusText: "err" });
  await assert.rejects(() => loadPatchNotesMeta("/patch-notes-meta.json", httpError));

  const badShape = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  await assert.rejects(() => loadPatchNotesMeta("/patch-notes-meta.json", badShape));
});

// ── #8049: seenKey (dato + løbenummer) bag patch_notes_v2_8049 ───────────────

test("#8049: en markør uden klokkeslæt sammenlignes kun på dato (samme adfærd som før)", () => {
  assert.equal(isPatchNotesUnread("2026-11-16T00:03", "2026-11-16"), false);
  assert.equal(isPatchNotesUnread("2026-11-17T00:01", "2026-11-16"), true);
});

test("#8049: en note senere samme dag giver en prik, når markøren har løbenummer", () => {
  assert.equal(isPatchNotesUnread("2026-11-16T00:03", "2026-11-16T00:02"), true);
  assert.equal(isPatchNotesUnread("2026-11-16T00:03", "2026-11-16T00:03"), false);
  // Slukket kontakt: datoen mod en nyere markør er ikke ulæst.
  assert.equal(isPatchNotesUnread("2026-11-16", "2026-11-16T00:03"), false);
});

test("#8049: menuens prik bruger kun seenKey, når kontakten er tændt for viewer'en", () => {
  const meta = { version: "7.453", date: "2026-11-16", seenKey: "2026-11-16T00:03" };
  assert.equal(pickPatchNotesMarker(meta, "off"), "2026-11-16");
  assert.equal(pickPatchNotesMarker(meta, undefined), "2026-11-16");
  assert.equal(pickPatchNotesMarker(meta, "beta"), "2026-11-16T00:03");
  assert.equal(pickPatchNotesMarker(meta, "on"), "2026-11-16T00:03");
  assert.equal(pickPatchNotesMarker({ date: "2026-11-16" }, "on"), "2026-11-16");
  assert.equal(pickPatchNotesMarker({ date: "2026-11-16", seenKey: "2026-11-15T00:01" }, "on"), "2026-11-16");
  assert.equal(pickPatchNotesMarker(null, "on"), null);
});
