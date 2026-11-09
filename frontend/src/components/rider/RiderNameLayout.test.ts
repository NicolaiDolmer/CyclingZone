// #7879 · Rytternavn: hover-ikonet til venstre, mærker lige til højre på samme linje.
// Kilde-kontrakt (samme stil som TalentMark.test.ts): layoutet må ikke glide tilbage.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8");
const link = read("../RiderLink.jsx");
const cell = read("RiderNameCell.jsx");
const icon = read("RiderNameIcon.tsx");

test("hover-ikonet renderes foer navnet i RiderLink", () => {
  assert.ok(link.indexOf("{overlay.icon}") !== -1);
  assert.ok(link.indexOf("{overlay.icon}") < link.indexOf("{children}", link.indexOf("{overlay.icon}") - 1));
  assert.ok(!link.includes("{children}{overlay.icon}"));
});

test("ikonets afstand er til hoejre for ikonet, ikke til venstre", () => {
  assert.match(icon, /\bme-1\.5\b/);
  assert.ok(!/\bms-1\b/.test(icon));
});

test("navn og maerker staar i én gruppe, og navnet forkortes med ellipsis", () => {
  const group = cell.indexOf("inline-flex items-center gap-1.5 min-w-0 max-w-full");
  assert.ok(group !== -1);
  const after = cell.slice(group);
  assert.ok(after.indexOf("<RiderLink") < after.indexOf("<RiderChampionJersey"));
  assert.ok(after.indexOf("<RiderChampionJersey") < after.indexOf("<RiderTalentMark"));
  assert.match(cell, /truncate/);
});
