import { test } from "node:test";
import assert from "node:assert/strict";
import { statColor, statTextColor, statStyle } from "./statColor.js";

// Re-ankret 2026-06-19 til CZ-evne-skalaen (#1529): samme #855-farver, flyttede ankre.
test("statColor — anker-værdier (evne-re-ankret)", () => {
  assert.equal(statColor(42), "#33fc96"); // grøn
  assert.equal(statColor(55), "#fde447"); // gul
  assert.equal(statColor(74), "#fd3263"); // pink/rød
});

test("statColor — knæk-punkter rammer deres eksakte hex", () => {
  assert.equal(statColor(33), "#aeb1c0"); // grå stigende
  assert.equal(statColor(64), "#fdc032"); // guld
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
  assert.equal(statColor("42"), "#33fc96");
});

test("statColor — interpolerer monotont mellem knæk (orange i guld→pink)", () => {
  // 69 ligger mellem guld (64) og pink (74) → orange-agtig: høj R, faldende G.
  const c69 = statColor(69);
  const r = parseInt(c69.slice(1, 3), 16);
  const g = parseInt(c69.slice(3, 5), 16);
  assert.ok(r > 240, `forventede høj rød, fik ${c69}`);
  assert.ok(g > 50 && g < 192, `forventede mellem-grøn (orange), fik ${c69}`);
});

test("statTextColor — mørk tekst på lyse badges, hvid på mørke", () => {
  assert.equal(statTextColor(55), "#101014"); // gul → mørk tekst
  assert.equal(statTextColor(42), "#101014"); // grøn → mørk tekst
  assert.equal(statTextColor(74), "#f5f5fa"); // pink → hvid tekst
  assert.equal(statTextColor(99), "#f5f5fa"); // dyb rød → hvid tekst
});

test("statStyle — returnerer baggrund + kontrast-tekst", () => {
  assert.deepEqual(statStyle(42), { backgroundColor: "#33fc96", color: "#101014" });
  assert.deepEqual(statStyle(74), { backgroundColor: "#fd3263", color: "#f5f5fa" });
});
