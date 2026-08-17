import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPatchNotesUnread, buildNavDotFlags, resolveNavDot, loadPatchNotesMeta,
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
