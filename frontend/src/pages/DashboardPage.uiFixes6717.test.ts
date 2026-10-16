// #6717: kildevagter for ejerens valg 1A-3A paa dashboardet (16/10).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "DashboardPage.jsx"), "utf8");

test("bestyrelsens maal: navn ombrydes og afskaeres aldrig, 2 kolonner ogsaa paa mobil", () => {
  const start = src.indexOf("score_breakdown?.categories");
  const block = src.slice(start - 400, start + 1600);
  assert.match(block, /grid grid-cols-2 gap-3/);
  assert.doesNotMatch(block, /sm:grid-cols-4/);
  const label = block.slice(block.indexOf("resolveCategoryLabel") - 200, block.indexOf("resolveCategoryLabel"));
  assert.doesNotMatch(label, /truncate|line-clamp/);
  assert.match(block, /<StatusBadge state="won" emphasis/);
});

test("divisionsstillingen viser ikke laengere ↓N / +N (bevaegelses-signaler fjernet)", () => {
  assert.doesNotMatch(src, /rankMovement|pointsDelta|computeDivisionMovement|lastRaceDayPoints|getRaceDayPoints/);
  assert.equal(existsSync(join(here, "../lib/dashboardMovementSignals.js")), false);
});

test("'I gang' paa kommende loeb er spillets status-maerke, ikke en rund guld-pille", () => {
  const i = src.indexOf('t("dashboard:cards.races.live")');
  const around = src.slice(i - 300, i);
  assert.match(around, /<StatusBadge state="info" emphasis>/);
  assert.doesNotMatch(around, /rounded-full/);
});
