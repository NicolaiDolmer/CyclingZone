import { test } from "node:test";
import assert from "node:assert/strict";
import { statColor, statTextColor, statStyle, statPlateStyle } from "./statColor.js";

// Re-ankret 2026-07-25 (#2890): to skalaer, hver fittet på ægte percentiler
// (execute_sql mod prod, samme metode som RATING_O_ELITE/O_MIN i riderRating.js).
// "ability" (rå enkelt-evne, default) — median 12 · p75 21 · p90 32 · p97 53 · p99,5 67.
test("statColor — ability-skala rammer sine anker-hex (default scale)", () => {
  assert.equal(statColor(21), "#33fc96"); // grøn (p75)
  assert.equal(statColor(32), "#fde447"); // gul (p90)
  assert.equal(statColor(53), "#fdc032"); // guld (p97)
  assert.equal(statColor(67), "#e2900f"); // apex/rav (p99,5)
});

test("statColor — ability-skala knæk-punkter rammer deres eksakte hex", () => {
  assert.equal(statColor(0), "#565969");
  assert.equal(statColor(6), "#6f7285");
  assert.equal(statColor(12), "#aeb1c0"); // population-median
  assert.equal(statColor(99), "#8a4b06"); // dybeste bronze
});

// "rating" (normaliseret 1-99 riderOverallRating) — median 21 · p75 30 · p90 37 ·
// p97 76 · p99,5 92. Samme rå tal betyder IKKE det samme som ability-skalaen (#2890).
test("statColor — rating-skala har egne ankre (anden fordeling end ability)", () => {
  assert.equal(statColor(30, { scale: "rating" }), "#33fc96"); // grøn (p75)
  assert.equal(statColor(37, { scale: "rating" }), "#fde447"); // gul (p90)
  assert.equal(statColor(76, { scale: "rating" }), "#fdc032"); // guld (p97)
  assert.equal(statColor(92, { scale: "rating" }), "#e2900f"); // apex/rav (p99,5)
  assert.equal(statColor(99, { scale: "rating" }), "#8a4b06");
});

test("statColor — samme værdi, forskellig skala, forskellig farve", () => {
  // 32 er "gul" (p90) på ability-skalaen, men stadig under grønt (p75=30) på rating-skalaen
  assert.equal(statColor(32), "#fde447");
  assert.notEqual(statColor(32, { scale: "rating" }), "#fde447");
});

test("statColor — ukendt scale falder tilbage til ability", () => {
  assert.equal(statColor(21, { scale: "bogus" }), statColor(21));
});

test("statColor — klamper uden for 0–99", () => {
  assert.equal(statColor(-5), "#565969");
  assert.equal(statColor(0), "#565969");
  assert.equal(statColor(120), "#8a4b06");
});

test("statColor — ugyldigt input falder til floor-farve", () => {
  assert.equal(statColor(null), "#565969");
  assert.equal(statColor(undefined), "#565969");
  assert.equal(statColor(NaN), "#565969");
  assert.equal(statColor("ikke-tal"), "#565969");
});

test("statColor — accepterer numerisk streng", () => {
  assert.equal(statColor("21"), "#33fc96");
});

test("statColor — interpolerer monotont mellem knæk (orange i guld→apex)", () => {
  // 60 ligger mellem guld (53) og apex (67) på ability-skalaen → orange-agtig.
  const c60 = statColor(60);
  const r = parseInt(c60.slice(1, 3), 16);
  const g = parseInt(c60.slice(3, 5), 16);
  assert.ok(r > 220, `forventede høj rød, fik ${c60}`);
  assert.ok(g > 100 && g < 192, `forventede mellem-grøn (orange), fik ${c60}`);
});

test("statTextColor — mørk tekst på lyse badges, hvid på mørke", () => {
  assert.equal(statTextColor(32), "#101014"); // gul → mørk tekst
  assert.equal(statTextColor(21), "#101014"); // grøn → mørk tekst
  assert.equal(statTextColor(99), "#f5f5fa"); // dybeste bronze → hvid tekst
});

test("statStyle — returnerer baggrund + kontrast-tekst", () => {
  assert.deepEqual(statStyle(21), { backgroundColor: "#33fc96", color: "#101014" });
  assert.deepEqual(statStyle(67), { backgroundColor: "#e2900f", color: "#101014" });
});

test("statPlateStyle — default scale er 'rating' (bruges altid til normaliseret overall)", () => {
  const plate = statPlateStyle(30); // p75 på rating-skalaen
  assert.equal(plate.color, "#33fc96");
  assert.equal(plate.backgroundColor, "#33fc9629");
  // Samme rå tal på ability-skalaen ville IKKE ramme grøn (p75=21 der)
  assert.notEqual(statPlateStyle(30, { scale: "ability" }).color, plate.color);
});
