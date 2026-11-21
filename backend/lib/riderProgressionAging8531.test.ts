// #8531 (#6110, ejervalg model E 21/11): talfilens aldring i procent-form godkendes af
// XP-validatoren og når sæsonskiftet, og løbsbremsen kan kalibreres fra talfilens aldring.
// Alle tal her er syntetiske; de rigtige står kun i den private talfil (hard rule 17).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { validateDevelopmentXpParams } from "./developmentXp.ts";
import type { DevelopmentXpParams } from "./developmentXp.ts";
import { AGING_V2_CONFIG, agingBrake, developRiderSeasonV2, xpAgingConfig } from "./riderProgression.js";
import { validateXpAgingBrake, validateXpAgingPercent } from "./riderWear6110.js";
import { loadXpAgingCfg } from "./riderProgressionEngine.js";
import { DEVELOPMENT_XP_FLAG_KEY, DEVELOPMENT_XP_FROM_DATE_KEY, DEVELOPMENT_XP_PARAMS_KEY } from "./developmentXpFlag.ts";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { RIDER_TYPE_KEYS } from "./riderTypes.js";

const RAW = Object.freeze({
  price: { base: 10, exponent: 2 },
  potentialXp: [{ at: 1, value: 10 }, { at: 3, value: 30 }, { at: 6, value: 90 }],
  ageShare: {
    physical: [{ at: 28, value: 1 }, { at: 32, value: 0.5 }, { at: 36, value: 0.1 }],
    mental: [{ at: 32, value: 1 }, { at: 36, value: 0.5 }, { at: 40, value: 0.2 }],
  },
  offFocusShare: 0.1,
  raceOffFocusShare: 0.2,
  typeShare: { signatur: 1, sekundaer: 0.8, haandvaerk: 0.5, andenRolle: 0.3, svaghed: 0.1 },
});
const GROWTH = Object.freeze({ base: 10, growth: 0.05 });
const TOP = Object.freeze({ base: 10, exponent: 2, top: 140 });
const PCT_AGING = Object.freeze({
  physical: [{ at: 30, value: 0 }, { at: 34, value: 0.04 }, { at: 40, value: 0.1 }],
  mental: [{ at: 32, value: 0 }, { at: 36, value: 0.01 }, { at: 40, value: 0.04 }],
});
const STEP_AGING = Object.freeze({
  plateauThroughAge: 27,
  declineByYearsPastPlateau: [{ maxYears: 4, drop: 1 }, { maxYears: 99, drop: 2 }],
  late: { fromAge: 33, drop: 0.5 },
});
// Opdigtet kalibrering, bevidst langt fra dagens bremse, så forskellen kan ses.
const BRAKE = Object.freeze({ brakeLoadDays: 40, hardTrainingDayWeight: 0.25 });

const v = (patch: Record<string, unknown>) => validateDevelopmentXpParams({ ...RAW, ...patch });
const json = (x: unknown) => JSON.parse(JSON.stringify(x));

// ── Frossen golden (#7587): regnet af MERGE-BASENS kode (ea5b25e10, før #8531) ─────────────
// Samme generator kørt i en separat checkout af basen. Talfiler uden de nye felter og
// kontakten slukket skal give præcis de samme digests med den nye kode.
const BASE_DIGESTS = Object.freeze({
  off: "e2e52d5047a543ea732c642ffe16b9be1f1f9174aa689e5c1910753c961c6e95",
  stepForm: "7035c607d0dfc10717dee9c3a9d60c28e09f06b7e346b88e9fd0162abd50475b",
  percentForm: "f6de5cac7c7d9977ac30ecac170559914b240f41850c2c63c4057975a7304029",
  xpParams: "83dfac99a17d3c8130ec34d49341b86a1e837e00e80c233d38a295b84f4a7381",
  agingCfgs: "cd82313838790eb4f874dcba4ad4cdad34fa80b851f94199045449fc82cbe843",
});

const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");

function agingGoldenDigest(cfg: unknown): string {
  const loads = [null, { raceDays: 0, hardDays: 0 }, { raceDays: 17, hardDays: 9 }, { raceDays: 55, hardDays: 30 }, { raceDays: 130, hardDays: 0 }];
  const out: unknown[] = [];
  for (const type of RIDER_TYPE_KEYS as readonly string[]) {
    for (let age = 24; age <= 42; age++) {
      loads.forEach((load, li) => {
        const abilities = Object.fromEntries((VISIBLE_ABILITIES as readonly string[]).map((k, i) => [k, 20 + ((i * 13 + age * 7 + li * 5) % 79)]));
        const r = developRiderSeasonV2({ id: `g-${type}-${age}`, primary_type: type, potentiale: 3, age }, abilities, 4 + li, cfg ? { load, cfg } : { load });
        out.push([type, age, li, r.next, r.aging.totalDrop, r.retirement.retire]);
      });
    }
  }
  return sha(out);
}

// Talfiler uden de nye felter (ingen procent-form, ingen bremse), gyldige og ugyldige.
const TALFILER: Record<string, unknown>[] = [
  RAW,
  { ...RAW, price: TOP, aging: STEP_AGING },
  { ...RAW, price: TOP, aging: { plateauThroughAge: 28, declineByYearsPastPlateau: [{ maxYears: 99, drop: 1 }] } },
  { ...RAW, price: GROWTH },
  { ...RAW, price: GROWTH, aging: STEP_AGING },
  { ...RAW, price: TOP },
  { ...RAW, aging: STEP_AGING },
  { ...RAW, price: TOP, aging: { ...STEP_AGING, extra: 1 } },
  { ...RAW, price: TOP, aging: { plateauThroughAge: 28, declineByYearsPastPlateau: [{ maxYears: 99, drop: 0 }] } },
  { ...RAW, price: TOP, aging: null },
  { ...RAW, price: TOP, aging: 5 },
  { ...RAW, distance: { h: 8 }, fatigue: { above: 70, share: 0.9 } },
];

test("#8531 golden: kontakten slukket (dagens aldring) er bit-identisk med merge-basen", () => {
  assert.equal(agingGoldenDigest(null), BASE_DIGESTS.off);
});

test("#8531 golden: talfilens trin- og procent-aldring uden bremse-felter er bit-identiske med merge-basen", () => {
  assert.equal(agingGoldenDigest(xpAgingConfig({ aging: STEP_AGING })), BASE_DIGESTS.stepForm);
  assert.equal(agingGoldenDigest(xpAgingConfig({ aging: PCT_AGING })), BASE_DIGESTS.percentForm);
});

test("#8531 golden: talfiler uden de nye felter valideres og giver aldrings-cfg præcis som i merge-basen", () => {
  const params = TALFILER.map((t) => validateDevelopmentXpParams(t));
  assert.equal(sha(params), BASE_DIGESTS.xpParams);
  assert.equal(sha(params.map((p) => (p ? xpAgingConfig(p) : "invalid"))), BASE_DIGESTS.agingCfgs);
});

// ── (1) Procent-formen i XP-talfilen ──────────────────────────────────────────────────────

test("#8531: en talfil med aldring i procent-form godkendes, og aldringen er sæsonskiftets egen validering", () => {
  const p = v({ price: GROWTH, aging: PCT_AGING }) as DevelopmentXpParams;
  assert.ok(p, "procent-talfilen afvises ikke længere");
  assert.deepEqual(json(p.aging), json(validateXpAgingPercent(PCT_AGING)));
  assert.ok(Object.isFrozen(p.aging));
  // Kandidat B's pakke-regel er uændret: med eksponent-pris følges top og aldring ad.
  assert.ok(v({ price: TOP, aging: PCT_AGING }), "top + procent-aldring");
  assert.equal(v({ aging: PCT_AGING }), null, "eksponent-pris uden top + aldring afvises stadig");
});

test("#8531: en ugyldig procent-aldring afviser hele talfilen (fail-safe)", () => {
  const bad: Record<string, unknown> = {
    "fald før plateauet": { ...PCT_AGING, physical: [{ at: 25, value: 0.1 }, { at: 40, value: 0.2 }] },
    "kun én kurve": { physical: PCT_AGING.physical },
    "mental over fysisk": { physical: PCT_AGING.mental, mental: PCT_AGING.physical },
    "stavefejl": { ...PCT_AGING, physicall: PCT_AGING.physical },
    "blandet med trin-form": { ...PCT_AGING, plateauThroughAge: 28 },
    "sats over skinnen": { ...PCT_AGING, physical: [{ at: 30, value: 0 }, { at: 40, value: 0.5 }] },
  };
  for (const [name, aging] of Object.entries(bad)) assert.equal(v({ price: GROWTH, aging }), null, name);
});

test("#8531: procent-talfilen når sæsonskiftet gennem den rigtige læser (kontakt on på startdatoen)", async () => {
  const START = "2026-11-20";
  const priv = { [DEVELOPMENT_XP_PARAMS_KEY]: { ...RAW, price: GROWTH, aging: { ...PCT_AGING, ...BRAKE } } };
  const db = (flag: string) => ({
    from(table: string) {
      let key: string | null = null;
      const chain = {
        select() { return chain; },
        eq(_c: string, k: string) { key = k; return chain; },
        async maybeSingle() {
          if (table === "seasons") return { data: null, error: null };
          const src: Record<string, unknown> = table === "app_config"
            ? { [DEVELOPMENT_XP_FLAG_KEY]: flag, [DEVELOPMENT_XP_FROM_DATE_KEY]: START }
            : priv;
          return { data: key !== null && key in src ? { value: src[key] } : null, error: null };
        },
      };
      return chain;
    },
  });
  // 20/11 kl. 00:30 dansk tid.
  const now = new Date("2026-11-19T23:30:00Z");
  const cfg = await loadXpAgingCfg({ supabase: db("on"), now }) as Record<string, unknown> | null;
  assert.ok(cfg && cfg.percent, "sæsonskiftet ælder efter procent-formen");
  assert.equal(cfg.brakeLoadDays, BRAKE.brakeLoadDays);
  assert.equal(cfg.hardTrainingDayWeight, BRAKE.hardTrainingDayWeight);
  assert.equal(await loadXpAgingCfg({ supabase: db("off"), now }), null, "kontakt off = dagens aldring");
});

// ── (2) Løbsbremsen fra talfilen ─────────────────────────────────────────────────────────

test("#8531: bremse-felterne valideres; udeladt = intet, ugyldigt = null", () => {
  assert.deepEqual(json(validateXpAgingBrake({})), {});
  assert.deepEqual(json(validateXpAgingBrake(BRAKE)), BRAKE);
  assert.deepEqual(json(validateXpAgingBrake({ brakeLoadDays: 40 })), { brakeLoadDays: 40 });
  assert.deepEqual(json(validateXpAgingBrake({ hardTrainingDayWeight: 0 })), { hardTrainingDayWeight: 0 }, "hårde dage må tælle nul");
  const bad: Record<string, Record<string, unknown>> = {
    "dage nul": { brakeLoadDays: 0 },
    "dage negativ": { brakeLoadDays: -5 },
    "dage over et år": { brakeLoadDays: 366 },
    "dage tekst": { brakeLoadDays: "40" },
    "dage uendelig": { brakeLoadDays: Infinity },
    "vægt negativ": { hardTrainingDayWeight: -0.1 },
    "vægt over en løbsdag": { hardTrainingDayWeight: 1.5 },
    "vægt null": { hardTrainingDayWeight: null },
  };
  for (const [name, raw] of Object.entries(bad)) assert.equal(validateXpAgingBrake(raw), null, name);
  assert.equal(validateXpAgingBrake(null), null);
});

test("#8531: begge aldrings-former bærer bremsen; et ugyldigt felt afviser hele talfilen", () => {
  const pct = v({ price: GROWTH, aging: { ...PCT_AGING, ...BRAKE } }) as DevelopmentXpParams;
  const step = v({ price: TOP, aging: { ...STEP_AGING, ...BRAKE } }) as DevelopmentXpParams;
  assert.ok(pct && step);
  for (const p of [pct, step]) {
    const a = p.aging as Record<string, unknown>;
    assert.equal(a.brakeLoadDays, BRAKE.brakeLoadDays);
    assert.equal(a.hardTrainingDayWeight, BRAKE.hardTrainingDayWeight);
  }
  for (const aging of [{ ...PCT_AGING, brakeLoadDays: 0 }, { ...STEP_AGING, hardTrainingDayWeight: 2 }, { ...STEP_AGING, brakeLoad: 40 }]) {
    assert.equal(v({ price: "plateauThroughAge" in aging ? TOP : GROWTH, aging }), null, JSON.stringify(Object.keys(aging)));
  }
});

test("#8531: sæsonskiftets cfg bruger talfilens bremse; kun de satte felter erstatter dagens", () => {
  const pctCfg = xpAgingConfig(v({ price: GROWTH, aging: { ...PCT_AGING, ...BRAKE } })) as Record<string, unknown>;
  const stepCfg = xpAgingConfig(v({ price: TOP, aging: { ...STEP_AGING, ...BRAKE } })) as Record<string, unknown>;
  for (const cfg of [pctCfg, stepCfg]) {
    assert.equal(cfg.brakeLoadDays, BRAKE.brakeLoadDays);
    assert.equal(cfg.hardTrainingDayWeight, BRAKE.hardTrainingDayWeight);
    assert.equal(cfg.offTypeDeclineFactor, AGING_V2_CONFIG.offTypeDeclineFactor, "typefaktoren er dagens");
  }
  // cfg.percent er kun kurverne, som før.
  assert.deepEqual(Object.keys(pctCfg.percent as object).sort(), ["mental", "physical"]);
  // Kun dagene sat: vægten for hårde dage er dagens.
  const onlyDays = xpAgingConfig({ aging: { ...PCT_AGING, brakeLoadDays: 40 } }) as Record<string, unknown>;
  assert.equal(onlyDays.brakeLoadDays, 40);
  assert.equal(onlyDays.hardTrainingDayWeight, AGING_V2_CONFIG.hardTrainingDayWeight);
  // Uden felterne er bremsen dagens.
  const noBrake = xpAgingConfig({ aging: PCT_AGING }) as Record<string, unknown>;
  assert.equal(noBrake.brakeLoadDays, AGING_V2_CONFIG.brakeLoadDays);
  assert.equal(noBrake.hardTrainingDayWeight, AGING_V2_CONFIG.hardTrainingDayWeight);
  // Ugyldige felter direkte i cfg-læseren kaster (sæsonskiftet venter hellere end at ælde forkert).
  assert.throws(() => xpAgingConfig({ aging: { ...STEP_AGING, brakeLoadDays: -1 } }), /invalid aging brake/);
  assert.throws(() => xpAgingConfig({ aging: { ...PCT_AGING, brakeLoadDays: -1 } }), /invalid percent aging/);
});

test("#8531: den kalibrerede bremse virker i sæsonskiftet: fuld bremse ved talfilens dage, delvis før", () => {
  const cfg = xpAgingConfig({ aging: { ...PCT_AGING, ...BRAKE } });
  const today = xpAgingConfig({ aging: PCT_AGING });
  assert.equal(agingBrake({ raceDays: BRAKE.brakeLoadDays, hardDays: 0 }, cfg), 0);
  assert.ok(agingBrake({ raceDays: BRAKE.brakeLoadDays, hardDays: 0 }, today) > 0, "med dagens bremse bremser samme dage kun delvist");
  // Hårde dage tæller med talfilens vægt.
  const hard = BRAKE.brakeLoadDays / BRAKE.hardTrainingDayWeight;
  assert.equal(agingBrake({ raceDays: 0, hardDays: hard }, cfg), 0);
  const abilities = Object.fromEntries((VISIBLE_ABILITIES as readonly string[]).map((k, i) => [k, 40 + ((i * 11) % 50)]));
  const rider = { id: "brake-8531", primary_type: "rouleur", potentiale: 3, age: 37 };
  const load = { raceDays: BRAKE.brakeLoadDays, hardDays: 0 };
  assert.deepEqual(developRiderSeasonV2(rider, abilities, 7, { load, cfg }).next, abilities, "talfilens fulde bremse = intet fald");
  assert.ok(developRiderSeasonV2(rider, abilities, 7, { load, cfg: today }).aging.rawTotal > 0, "dagens bremse lader noget falde");
  // Trin-formen: samme bremse virker på trinnenes fald.
  const stepCfg = xpAgingConfig({ aging: { ...STEP_AGING, ...BRAKE } });
  assert.equal(developRiderSeasonV2(rider, abilities, 7, { load, cfg: stepCfg }).aging.totalDrop, 0);
});
