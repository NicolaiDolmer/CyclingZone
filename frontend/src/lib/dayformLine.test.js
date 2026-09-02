// #4598 (ejer-design 2/9) — dayformLine.js unit-tests.
import test from "node:test";
import assert from "node:assert/strict";
import { dayformLineMoment, dayformLineI18nKey, DAYFORM_LINE_VARIANT_COUNT, DAYFORM_BAND_KEYS } from "./dayformLine.js";

function moment(overrides = {}) {
  return { stage_number: 1, moment_key: "dayform_line", params: { riderId: "r1", band: 0 }, significance: 30, rider_ids: ["r1"], team_ids: ["t1"], ...overrides };
}

// ── dayformLineMoment ────────────────────────────────────────────────────────

test("dayformLineMoment: finder rytterens moment for DENNE etape og returnerer clampet band", () => {
  const moments = [
    moment({ stage_number: 1, params: { riderId: "r1", band: 3 }, rider_ids: ["r1"] }),
    moment({ stage_number: 2, params: { riderId: "r1", band: -2 }, rider_ids: ["r1"] }),
  ];
  assert.deepEqual(dayformLineMoment(moments, "r1", 1), { band: 3 });
  assert.deepEqual(dayformLineMoment(moments, "r1", 2), { band: -2 });
});

test("dayformLineMoment: manglende riderId/stageNumber/moments → null (ærlig degradering)", () => {
  const moments = [moment()];
  assert.equal(dayformLineMoment(moments, null, 1), null);
  assert.equal(dayformLineMoment(moments, "r1", null), null, "stageNumber=null (samlet-fanen) viser ALDRIG en dayform-linje");
  assert.equal(dayformLineMoment(null, "r1", 1), null);
  assert.equal(dayformLineMoment([], "r1", 1), null);
});

test("dayformLineMoment: ingen dayform_line-moment for rytteren/etapen → null (fx gammelt løb uden components)", () => {
  const moments = [moment({ rider_ids: ["other"] })];
  assert.equal(dayformLineMoment(moments, "r1", 1), null);
});

test("dayformLineMoment: andre moment_keys (fx tag_jour_sans) ignoreres", () => {
  const moments = [moment({ moment_key: "tag_jour_sans" })];
  assert.equal(dayformLineMoment(moments, "r1", 1), null);
});

test("dayformLineMoment: band 0 fyrer korrekt (ikke forvekslet med 'intet moment')", () => {
  const moments = [moment({ params: { riderId: "r1", band: 0 } })];
  assert.deepEqual(dayformLineMoment(moments, "r1", 1), { band: 0 });
});

test("dayformLineMoment: ugyldigt/manglende params.band → null", () => {
  assert.equal(dayformLineMoment([moment({ params: { riderId: "r1" } })], "r1", 1), null);
  assert.equal(dayformLineMoment([moment({ params: { riderId: "r1", band: "not-a-number" } })], "r1", 1), null);
});

test("dayformLineMoment: clamper defensivt til [-5, 5] selv ved ugyldig backend-data", () => {
  assert.deepEqual(dayformLineMoment([moment({ params: { riderId: "r1", band: 99 } })], "r1", 1), { band: 5 });
  assert.deepEqual(dayformLineMoment([moment({ params: { riderId: "r1", band: -99 } })], "r1", 1), { band: -5 });
});

// ── dayformLineI18nKey ───────────────────────────────────────────────────────

test("dayformLineI18nKey: bygger en gyldig nøgle for hvert af de 11 trin", () => {
  for (let band = -5; band <= 5; band++) {
    const key = dayformLineI18nKey({ raceId: "race-1", stageNumber: 1, riderId: "r1", band });
    assert.equal(typeof key, "string");
    assert.ok(key.startsWith("detail.dayformLine."));
    const bandKey = DAYFORM_BAND_KEYS[String(band)];
    assert.ok(key.includes(`.${bandKey}.`), `nøglen for trin ${band} skal indeholde ${bandKey}, fik ${key}`);
  }
});

test("dayformLineI18nKey: ugyldigt band → null", () => {
  assert.equal(dayformLineI18nKey({ raceId: "race-1", stageNumber: 1, riderId: "r1", band: 6 }), null);
  assert.equal(dayformLineI18nKey({ raceId: "race-1", stageNumber: 1, riderId: "r1", band: null }), null);
});

test("dayformLineI18nKey: deterministisk — samme (race, stage, rider, band) giver ALTID samme nøgle", () => {
  const args = { raceId: "race-1", stageNumber: 3, riderId: "rider-42", band: 2 };
  const a = dayformLineI18nKey(args);
  const b = dayformLineI18nKey(args);
  assert.equal(a, b);
});

test("dayformLineI18nKey: forskellig rytter/etape/løb kan give forskellig variant-index (varians, ikke monotoni-krav)", () => {
  const base = { raceId: "race-1", stageNumber: 1, band: 1 };
  const keys = new Set();
  for (let i = 0; i < 30; i++) {
    keys.add(dayformLineI18nKey({ ...base, riderId: `rider-${i}` }));
  }
  // Ikke ALLE 30 ryttere skal ramme samme variant-indeks (ville indikere en
  // triviel/konstant hash) — med kun DAYFORM_LINE_VARIANT_COUNT=4 mulige
  // suffikser bekræfter mere end 1 unik nøgle at hash-modulo rent faktisk varierer.
  assert.ok(keys.size > 1, `forventede varians på tværs af ryttere, fik kun ${keys.size} unik(ke) nøgle(r)`);
});

test("dayformLineI18nKey: indeks er altid inden for [0, DAYFORM_LINE_VARIANT_COUNT)", () => {
  for (let i = 0; i < 200; i++) {
    const key = dayformLineI18nKey({ raceId: `r${i}`, stageNumber: i % 5, riderId: `rider-${i}`, band: (i % 11) - 5 });
    const idx = Number(key.split(".").pop());
    assert.ok(idx >= 0 && idx < DAYFORM_LINE_VARIANT_COUNT, `indeks ${idx} uden for [0, ${DAYFORM_LINE_VARIANT_COUNT})`);
  }
});

test("integration: dayformLineMoment + dayformLineI18nKey producerer en brugbar nøgle end-to-end", () => {
  const moments = [moment({ params: { riderId: "r1", band: -4 } })];
  const found = dayformLineMoment(moments, "r1", 1);
  assert.ok(found);
  const key = dayformLineI18nKey({ raceId: "race-9", stageNumber: 1, riderId: "r1", band: found.band });
  assert.equal(key, `detail.dayformLine.band_m4.${key.split(".").pop()}`);
});
