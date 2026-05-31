import { test } from "node:test";
import assert from "node:assert/strict";
import { statColor, statTextColor, statStyle } from "./statColor.js";

test("statColor — anker-værdier matcher PCM eksakt", () => {
  assert.equal(statColor(71), "#33fc96"); // grøn
  assert.equal(statColor(77), "#fde447"); // gul
  assert.equal(statColor(84), "#fd3263"); // pink/rød
});

test("statColor — knæk-punkter rammer deres eksakte hex", () => {
  assert.equal(statColor(68), "#ced1d2"); // PCM grå
  assert.equal(statColor(80), "#fdc032"); // PCM guld
  assert.equal(statColor(99), "#a8082f"); // dybeste rød
});

test("statColor — klamper uden for 0–99", () => {
  assert.equal(statColor(-5), "#565969");
  assert.equal(statColor(0), "#565969");
  assert.equal(statColor(120), "#a8082f");
});

test("statColor — ugyldigt input falder til floor-farve", () => {
  assert.equal(statColor(null), "#565969");
  assert.equal(statColor(undefined), "#565969");
  assert.equal(statColor(NaN), "#565969");
  assert.equal(statColor("ikke-tal"), "#565969");
});

test("statColor — accepterer numerisk streng", () => {
  assert.equal(statColor("71"), "#33fc96");
});

test("statColor — interpolerer monotont mellem knæk (orange i guld→pink)", () => {
  // 82 ligger mellem guld (80) og pink (84) → orange-agtig: høj R, faldende G, stigende B
  const c82 = statColor(82);
  const r = parseInt(c82.slice(1, 3), 16);
  const g = parseInt(c82.slice(3, 5), 16);
  assert.ok(r > 240, `forventede høj rød, fik ${c82}`);
  assert.ok(g > 50 && g < 192, `forventede mellem-grøn (orange), fik ${c82}`);
});

test("statTextColor — mørk tekst på lyse badges, hvid på mørke", () => {
  assert.equal(statTextColor(77), "#101014"); // gul → mørk tekst
  assert.equal(statTextColor(71), "#101014"); // grøn → mørk tekst
  assert.equal(statTextColor(84), "#f5f5fa"); // pink → hvid tekst
  assert.equal(statTextColor(99), "#f5f5fa"); // dyb rød → hvid tekst
});

test("statStyle — returnerer baggrund + kontrast-tekst", () => {
  assert.deepEqual(statStyle(71), { backgroundColor: "#33fc96", color: "#101014" });
  assert.deepEqual(statStyle(84), { backgroundColor: "#fd3263", color: "#f5f5fa" });
});
