// #6110: tests for XP-modellens dagsvariation (spec §5.2, ejervalg 7/11). Tallene og
// nøglen her er syntetiske; de rigtige ligger kun i private_config (hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";

import { developmentXpDayVariation, validateXpVariation } from "./developmentXpVariation.ts";
import type { XpVariation } from "./developmentXpVariation.ts";
import { validateDevelopmentXpParams } from "./developmentXp.ts";

const KEY = "synthetic-test-key-not-a-secret-0123456789";
const OTHER_KEY = "another-synthetic-test-key-9876543210-abc";
const SPAN = 0.5;

const make = (raw: Record<string, unknown>): XpVariation => {
  const v = validateXpVariation(raw);
  assert.ok(v, "gyldig variation");
  return v;
};
const withMemory = make({ key: KEY, span: SPAN, memory: 0.8 });
const dayByDay = make({ key: KEY, span: SPAN, memory: 0 });

// En sæsons datoer (syntetisk længde) fra en fast start, som dansk dato.
function dates(start: string, n: number): string[] {
  const t0 = Date.parse(`${start}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(t0 + i * 86_400_000).toISOString().slice(0, 10));
}
const SEASON = dates("2026-11-15", 120);
const RIDERS = Array.from({ length: 200 }, (_, i) => `rider-${i}`);
const series = (v: XpVariation, riderId: string, ds: string[]) => ds.map((dateStr) => developmentXpDayVariation({ riderId, dateStr }, v));
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

test("validering: udeladt = ingen variation, sat og ugyldig = ugyldige params", () => {
  assert.equal(validateXpVariation(undefined), undefined);
  const bad = [
    null, 7, "x", [], {},
    { key: KEY, span: SPAN },
    { span: SPAN, memory: 0.5 },
    { key: "too-short", span: SPAN, memory: 0.5 },
    { key: 12345, span: SPAN, memory: 0.5 },
    { key: KEY, span: 0, memory: 0.5 },
    { key: KEY, span: 1, memory: 0.5 },
    { key: KEY, span: -0.2, memory: 0.5 },
    { key: KEY, span: Number.NaN, memory: 0.5 },
    { key: KEY, span: SPAN, memory: 1 },
    { key: KEY, span: SPAN, memory: -0.1 },
    { key: KEY, span: SPAN, memory: Number.POSITIVE_INFINITY },
  ];
  for (const raw of bad) assert.equal(validateXpVariation(raw), null, JSON.stringify(raw));
  const ok = make({ key: KEY, span: SPAN, memory: 0 });
  assert.ok(Object.isFrozen(ok));
  assert.deepEqual(Object.keys(ok).sort(), ["memory", "span"]);
});

test("validering i XP-params: uden felt ingen variation, ugyldigt felt gør params ugyldige", () => {
  const base = {
    price: { base: 10, exponent: 2 },
    potentialXp: [{ at: 1, value: 10 }, { at: 6, value: 90 }],
    ageShare: { physical: [{ at: 28, value: 1 }, { at: 34, value: 0.3 }], mental: [{ at: 32, value: 1 }, { at: 38, value: 0.3 }] },
    offFocusShare: 0.1,
    raceOffFocusShare: 0.2,
    typeShare: { signatur: 1, sekundaer: 0.8, haandvaerk: 0.5, andenRolle: 0.3, svaghed: 0.1 },
  };
  const plain = validateDevelopmentXpParams(base);
  assert.ok(plain);
  assert.ok(!("variation" in plain), "uden felt: samme form som før");
  assert.equal(validateDevelopmentXpParams({ ...base, variation: { key: KEY, span: 2, memory: 0.5 } }), null);
  assert.equal(validateDevelopmentXpParams({ ...base, variation: null }), null);
  const varied = validateDevelopmentXpParams({ ...base, variation: { key: KEY, span: SPAN, memory: 0.5 } });
  assert.ok(varied?.variation);
  assert.equal(developmentXpDayVariation({ riderId: "r", dateStr: "2026-11-15" }, varied.variation),
    developmentXpDayVariation({ riderId: "r", dateStr: "2026-11-15" }, make({ key: KEY, span: SPAN, memory: 0.5 })));
});

test("nøglen slipper aldrig ud: ikke i JSON, ikke i inspect, ikke i fejlbeskeden", () => {
  const params = validateDevelopmentXpParams({
    price: { base: 10, exponent: 2 },
    potentialXp: [{ at: 1, value: 10 }, { at: 6, value: 90 }],
    ageShare: { physical: [{ at: 28, value: 1 }], mental: [{ at: 32, value: 1 }] },
    offFocusShare: 0.1,
    raceOffFocusShare: 0.2,
    typeShare: { signatur: 1, sekundaer: 0.8, haandvaerk: 0.5, andenRolle: 0.3, svaghed: 0.1 },
    variation: { key: KEY, span: SPAN, memory: 0.5 },
  });
  assert.ok(params);
  assert.ok(!JSON.stringify(params).includes(KEY));
  assert.ok(!inspect(params, { depth: null, showHidden: true }).includes(KEY));
  assert.ok(!String(Object.values(params.variation ?? {})).includes(KEY));
  // En kopi uden registreret nøgle er en programfejl: den stopper, uden at nævne nøglen.
  const copy = { ...params.variation } as XpVariation;
  assert.throws(() => developmentXpDayVariation({ riderId: "r", dateStr: "2026-11-15" }, copy), (err: Error) => {
    assert.match(err.message, /development-xp/);
    assert.ok(!err.message.includes(KEY));
    return true;
  });
});

test("uden variation er faktoren præcis 1; ukendt rytter eller dato er neutral", () => {
  assert.equal(developmentXpDayVariation({ riderId: "r", dateStr: "2026-11-15" }, undefined), 1);
  assert.equal(developmentXpDayVariation({ riderId: "r", dateStr: "2026-11-15" }, null), 1);
  for (const dateStr of [null, "", "2026-02-30", "15/11/2026", "2026-11-15T00:00:00Z", 20261115]) {
    assert.equal(developmentXpDayVariation({ riderId: "r", dateStr }, withMemory), 1, String(dateStr));
  }
  for (const riderId of [null, undefined, ""]) assert.equal(developmentXpDayVariation({ riderId, dateStr: "2026-11-15" }, withMemory), 1);
});

test("deterministisk pr. (rytter, dato), inden for bredden, og afhængig af nøglen", () => {
  const a = series(withMemory, "rider-1", SEASON);
  assert.deepEqual(series(withMemory, "rider-1", SEASON), a, "samme input giver samme tal");
  for (const x of a) assert.ok(x >= 1 - SPAN && x <= 1 + SPAN && x > 0, String(x));
  // En dato regnes alene: rækkefølgen af kald flytter intet.
  assert.equal(developmentXpDayVariation({ riderId: "rider-1", dateStr: SEASON[50] }, withMemory), a[50]);
  assert.notDeepEqual(series(withMemory, "rider-2", SEASON), a, "en anden rytter har sin egen serie");
  const otherKey = make({ key: OTHER_KEY, span: SPAN, memory: 0.8 });
  const b = series(otherKey, "rider-1", SEASON);
  // Uden nøglen kan serien ikke regnes efter: en anden nøgle giver en serie uden sammenhæng.
  const diffs = a.filter((x, i) => Math.abs(x - b[i]) > 1e-9).length;
  assert.ok(diffs > SEASON.length * 0.95, `${diffs}`);
  // Den er heller ikke den offentlige serie med nøglen som rytter.
  assert.notDeepEqual(series(withMemory, KEY, SEASON), a);
});

test("neutral over en sæson: middel ca. 1 over mange ryttere, med og uden hukommelse", () => {
  for (const v of [withMemory, dayByDay]) {
    const all = RIDERS.flatMap((r) => series(v, r, SEASON));
    const m = mean(all);
    assert.ok(Math.abs(m - 1) < 0.01, `middel ${m}`);
    // Hver halvdel af udfaldene ligger på hver sin side af 1: ingen skjult skævhed.
    const above = all.filter((x) => x > 1).length / all.length;
    assert.ok(Math.abs(above - 0.5) < 0.02, `andel over 1: ${above}`);
  }
  // Én rytter over mange sæsoner nærmer sig også 1.
  const long = series(withMemory, "rider-long", dates("2026-11-15", 2000));
  assert.ok(Math.abs(mean(long) - 1) < 0.08, `lang serie ${mean(long)}`);
});

test("hukommelse giver gode og dårlige perioder; uden hukommelse er dagene uafhængige", () => {
  const lag1 = (v: XpVariation) => {
    let num = 0;
    let den = 0;
    for (const r of RIDERS.slice(0, 60)) {
      const s = series(v, r, SEASON).map((x) => x - 1);
      for (let i = 1; i < s.length; i++) num += s[i] * s[i - 1];
      for (const x of s) den += x * x;
    }
    return num / den;
  };
  const withM = lag1(withMemory);
  const without = lag1(dayByDay);
  assert.ok(withM > 0.6, `hukommelse: ${withM}`);
  assert.ok(Math.abs(without) < 0.05, `dag for dag: ${without}`);
  // Spredningen pr. dag er omtrent den samme: hukommelsen flytter fordelingen i tid, ikke bredden.
  const sd = (v: XpVariation) => Math.sqrt(mean(RIDERS.slice(0, 60).flatMap((r) => series(v, r, SEASON)).map((x) => (x - 1) ** 2)));
  assert.ok(Math.abs(sd(withMemory) - sd(dayByDay)) < 0.03, `${sd(withMemory)} mod ${sd(dayByDay)}`);
});

test("højeste tilladte hukommelse bevarer perioderne; en hukommelse uden for vinduet afvises (Codex-fund)", () => {
  // Over grænsen ville fortidens frie træk dominere og fjerne perioderne i stedet for at forlænge dem.
  assert.equal(validateXpVariation({ key: KEY, span: SPAN, memory: 0.998 }), null);
  assert.equal(validateXpVariation({ key: KEY, span: SPAN, memory: 0.9999 }), null);
  const edge = make({ key: KEY, span: SPAN, memory: 0.997 });
  let num = 0;
  let den = 0;
  for (const r of RIDERS.slice(0, 30)) {
    const s = series(edge, r, SEASON.slice(0, 20)).map((x) => x - 1);
    for (let i = 1; i < s.length; i++) num += s[i] * s[i - 1];
    for (const x of s.slice(1)) den += x * x;
  }
  assert.ok(num / den > 0.95, `sammenhæng ved grænsen: ${num / den}`);
});

test("høj hukommelse holder sig inden for bredden og er stadig neutral", () => {
  const sticky = make({ key: KEY, span: SPAN, memory: 0.99 });
  // Med høj hukommelse ligner en rytters datoer hinanden, så neutraliteten måles på tværs af ryttere.
  const all = RIDERS.flatMap((r) => series(sticky, r, SEASON.slice(0, 3)));
  for (const x of all) assert.ok(x >= 1 - SPAN && x <= 1 + SPAN);
  assert.ok(Math.abs(mean(all) - 1) < 0.06, `${mean(all)}`);
});
