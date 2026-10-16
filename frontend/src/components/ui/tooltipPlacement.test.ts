import { test } from "node:test";
import assert from "node:assert/strict";
import { EDGE, MAX_WIDTH, placeTooltip, tooltipMaxWidth } from "./tooltipPlacement.ts";

test("tooltipMaxWidth: max-w-xs paa brede skaerme, skaermen minus to kanter paa smalle", () => {
  assert.equal(tooltipMaxWidth(1440), MAX_WIDTH);
  assert.equal(tooltipMaxWidth(320), 320 - EDGE * 2);
});

const phone = { width: 375, height: 812 };
const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height });

test("#6728: boblen ved hoejre skaermkant flyttes ind, saa den ender EDGE px fra kanten", () => {
  // "Bunch sprint"-maerket ligger yderst til hoejre paa loebssiden
  const p = placeTooltip(rect(300, 400, 60, 22), "top", { width: 320, height: 48 }, phone);
  assert.equal(p.left + 320, phone.width - EDGE);
});

test("boblen ved venstre kant holdes EDGE px inde", () => {
  const p = placeTooltip(rect(0, 400, 40, 22), "bottom", { width: 200, height: 40 }, phone);
  assert.equal(p.left, EDGE);
  assert.equal(p.top, 400 + 22 + 8);
});

test("maks-bredden er skaermen minus to kanter paa en smal skaerm", () => {
  const p = placeTooltip(rect(100, 400, 40, 22), "top", { width: 400, height: 40 }, { width: 300, height: 600 });
  assert.equal(p.maxWidth, 300 - EDGE * 2);
  assert.equal(p.left, EDGE);
});

test("ankeret scrollet ud af skaermen: boblen skjules i stedet for at svaeve", () => {
  assert.equal(placeTooltip(rect(100, -60, 40, 22), "top", { width: 100, height: 30 }, phone).hidden, true);
  assert.equal(placeTooltip(rect(100, 900, 40, 22), "bottom", { width: 100, height: 30 }, phone).hidden, true);
  assert.equal(placeTooltip(rect(100, 400, 40, 22), "top", { width: 100, height: 30 }, phone).hidden, false);
});

test("plads nok: boblen centreres over ankeret", () => {
  const p = placeTooltip(rect(150, 400, 60, 22), "top", { width: 100, height: 30 }, phone);
  assert.equal(p.left, 150 + 30 - 50);
  assert.equal(p.top, 400 - 8 - 30);
});
