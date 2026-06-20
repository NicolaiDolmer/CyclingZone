import test from "node:test";
import assert from "node:assert/strict";
import { copenhagenDateString, copenhagenHour, copenhagenMidnightUTC } from "./copenhagenTime.js";

test("UTC-aften om sommeren ruller til ny dansk dato (CEST, +2)", () => {
  // 2026-06-11T22:30Z = 2026-06-12 00:30 CEST
  assert.equal(copenhagenDateString(new Date("2026-06-11T22:30:00Z")), "2026-06-12");
  assert.equal(copenhagenHour(new Date("2026-06-11T22:30:00Z")), 0);
});

test("vinter (CET, +1)", () => {
  // 2026-01-15T23:30Z = 2026-01-16 00:30 CET
  assert.equal(copenhagenDateString(new Date("2026-01-15T23:30:00Z")), "2026-01-16");
});

test("midt på dagen", () => {
  assert.equal(copenhagenDateString(new Date("2026-06-11T10:00:00Z")), "2026-06-11");
  assert.equal(copenhagenHour(new Date("2026-06-11T10:00:00Z")), 12);
});

test("default-argument er nu", () => {
  assert.match(copenhagenDateString(), /^\d{4}-\d{2}-\d{2}$/);
  const h = copenhagenHour();
  assert.ok(h >= 0 && h <= 23);
});

// ── copenhagenMidnightUTC (FIX 2: loop-guard dag-grænse) ──────────────────────
test("copenhagenMidnightUTC: CEST (sommer, +2) → 00:00 dansk = 22:00Z dagen før", () => {
  // 2026-06-21 14:00Z = 16:00 CEST. Seneste danske midnat = 2026-06-21 00:00 CEST = 2026-06-20 22:00Z.
  const mid = copenhagenMidnightUTC(new Date("2026-06-21T14:00:00Z"));
  assert.equal(mid.toISOString(), "2026-06-20T22:00:00.000Z");
});

test("copenhagenMidnightUTC: CET (vinter, +1) → 00:00 dansk = 23:00Z dagen før", () => {
  // 2026-01-15 12:00Z = 13:00 CET. Seneste danske midnat = 2026-01-15 00:00 CET = 2026-01-14 23:00Z.
  const mid = copenhagenMidnightUTC(new Date("2026-01-15T12:00:00Z"));
  assert.equal(mid.toISOString(), "2026-01-14T23:00:00.000Z");
});

test("copenhagenMidnightUTC: PRÆCIS på dansk midnats-kant (CEST) ruller IKKE 24h forkert", () => {
  // 2026-06-20 22:00:00Z = PRÆCIS 2026-06-21 00:00:00 CEST → samme danske dato, midnat = 22:00Z.
  const atMidnight = copenhagenMidnightUTC(new Date("2026-06-20T22:00:00Z"));
  assert.equal(atMidnight.toISOString(), "2026-06-20T22:00:00.000Z");
  // Ét sekund FØR midnat = stadig 2026-06-20 dansk → midnat = 2026-06-19 22:00Z.
  const justBefore = copenhagenMidnightUTC(new Date("2026-06-20T21:59:59Z"));
  assert.equal(justBefore.toISOString(), "2026-06-19T22:00:00.000Z");
  // De to instant'er må aldrig kollapse til samme dag (kanten skal være skarp).
  assert.notEqual(atMidnight.toISOString(), justBefore.toISOString());
});

test("copenhagenMidnightUTC: kant ved CET-vinterdøgnskifte (23:00Z = midnat)", () => {
  // 2026-01-14 23:00:00Z = PRÆCIS 2026-01-15 00:00 CET.
  const atMidnight = copenhagenMidnightUTC(new Date("2026-01-14T23:00:00Z"));
  assert.equal(atMidnight.toISOString(), "2026-01-14T23:00:00.000Z");
  const justBefore = copenhagenMidnightUTC(new Date("2026-01-14T22:59:59Z"));
  assert.equal(justBefore.toISOString(), "2026-01-13T23:00:00.000Z");
});

test("copenhagenMidnightUTC: returneret instant ER selv på den danske kalenderdato kl 00", () => {
  // Round-trip-invariant: datostrengen for midnats-instantet == datostrengen for now.
  for (const iso of ["2026-06-21T14:00:00Z", "2026-01-15T12:00:00Z", "2026-03-29T05:00:00Z"]) {
    const now = new Date(iso);
    const mid = copenhagenMidnightUTC(now);
    assert.equal(copenhagenDateString(mid), copenhagenDateString(now), `dato-konsistens for ${iso}`);
    assert.equal(copenhagenHour(mid), 0, `midnat skal være time 0 for ${iso}`);
  }
});
