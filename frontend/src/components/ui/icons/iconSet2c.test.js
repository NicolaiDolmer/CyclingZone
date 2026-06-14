import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.jsx"), "utf8");

const NEW_2C = [
  // generelle
  "SettingsIcon", "BellIcon", "ChevronUpIcon", "ChevronLeftIcon", "PlusIcon", "MinusIcon",
  "FilterIcon", "SortIcon", "CalendarIcon", "TeamIcon", "UserIcon", "EditIcon", "TrashIcon",
  "ExternalLinkIcon", "EyeIcon", "LockIcon", "DownloadIcon", "UploadIcon", "ClockIcon",
  "StarIcon", "HeartIcon", "MenuIcon", "ArrowUpIcon", "ArrowDownIcon", "CoinIcon",
  // cykel-specifikke
  "TagIcon", "JerseyIcon", "MountainIcon", "SprintIcon", "TimeTrialIcon", "BikeIcon",
  "RoadIcon", "PodiumIcon", "StopwatchIcon", "FlagIcon",
];

test("alle 35 Plan 2c-ikoner er defineret som named exports", () => {
  for (const name of NEW_2C) {
    assert.match(src, new RegExp(`export function ${name}\\(`), `mangler ${name}`);
  }
});

test("ingen ikon overrider hus-spec (IconBase ejer stroke/fill/viewBox centralt)", () => {
  assert.ok(!/stroke-width|strokeWidth/.test(src), "ikoner maa ikke override stroke");
  assert.ok(!/\bfill="(?!none)/.test(src), "ikoner maa ikke saette egen fill");
  assert.ok(!/viewBox=/.test(src), "kun IconBase saetter viewBox");
});

test("det samlede saet er komplet (>= 44 ikoner: 9 eksisterende + 35 nye)", () => {
  const count = (src.match(/export function \w+Icon\(/g) ?? []).length;
  assert.ok(count >= 44, `forventede >= 44 ikoner, fandt ${count}`);
});
