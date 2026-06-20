import { test } from "node:test";
import assert from "node:assert/strict";
import { PATCHES } from "../data/patchNotes.js";
import { flattenChanges } from "./patchNotes.js";

const CATS = new Set(["new", "improved", "fixed"]);
const AUD = new Set(["player", "internal"]);
const LEAK_RE = /(\bSELECT \b|\bINSERT \b|\bGRANT \b|service_role|\.sql\b|scripts\/|\bRLS\b|\.github\/)/i;
const RECENT_CUTOFF = "2026-05-21";

function cmp(a, b) {
  const A = a.split(".").map(Number), B = b.split(".").map(Number);
  for (let i = 0; i < Math.max(A.length, B.length); i++) { const d = (A[i] || 0) - (B[i] || 0); if (d) return d; }
  return 0;
}

test("hver change har gyldig category, audience og ≥1 sprog-body", () => {
  for (const c of flattenChanges(PATCHES)) {
    assert.ok(CATS.has(c.category), `dårlig category ${c.category} i ${c.version}`);
    assert.ok(AUD.has(c.audience), `dårlig audience ${c.audience} i ${c.version}`);
    assert.ok((c.en && c.en.body) || (c.da && c.da.body), `intet sprog-body i ${c.version}`);
  }
});

test("ingen player-body lækker interne signaler", () => {
  for (const c of flattenChanges(PATCHES)) {
    if (c.audience !== "player") continue;
    for (const lang of ["en", "da"]) {
      const body = c[lang]?.body || "";
      assert.ok(!LEAK_RE.test(body), `intern lækage i player ${c.version}/${lang}: ${body.slice(0, 70)}`);
    }
  }
});

test("versioner er unikke og strengt faldende", () => {
  const vs = PATCHES.map((p) => p.version);
  assert.equal(new Set(vs).size, vs.length, "dublet-versioner");
  for (let i = 1; i < vs.length; i++) assert.ok(cmp(vs[i - 1], vs[i]) > 0, `ikke faldende: ${vs[i - 1]} før ${vs[i]}`);
});

test("seneste player-entries har overskrift pr. tilstedeværende sprog", () => {
  for (const c of flattenChanges(PATCHES)) {
    if (c.audience !== "player" || c.date < RECENT_CUTOFF) continue;
    for (const lang of ["en", "da"]) {
      if (c[lang]?.body) assert.ok(c[lang].title?.trim(), `seneste ${c.version}/${lang} mangler overskrift`);
    }
  }
});
