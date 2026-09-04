// Unit-tests for terrainTypeIcons.ts (#4748 #4487). Koer med: node --test (i frontend/)
/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";

import { PROFILE_TYPE_KEYS } from "./stageProfileConfig.js";
import {
  TERRAIN_TYPE_ICON_NAME,
  terrainTypeIconName,
  missingTerrainIconCoverage,
} from "./terrainTypeIcons.ts";

test("alle PROFILE_TYPE_KEYS har et ikon-navn i tabellen (forward-guard)", () => {
  assert.deepEqual(missingTerrainIconCoverage(), []);
  for (const key of PROFILE_TYPE_KEYS) {
    assert.equal(typeof TERRAIN_TYPE_ICON_NAME[key], "string", `mangler ikon for "${key}"`);
  }
});

test("rolling deler IKKE laengere ikon med flat (#4748 — ejer-citat 3/9)", () => {
  assert.notEqual(TERRAIN_TYPE_ICON_NAME.rolling, TERRAIN_TYPE_ICON_NAME.flat);
  assert.equal(TERRAIN_TYPE_ICON_NAME.rolling, "RollingIcon");
  assert.equal(TERRAIN_TYPE_ICON_NAME.flat, "RoadIcon");
});

test("mountain og high_mountain DELER fortsat ikon (kun labelen adskiller dem)", () => {
  assert.equal(TERRAIN_TYPE_ICON_NAME.mountain, TERRAIN_TYPE_ICON_NAME.high_mountain);
});

test("itt og itt_hilly deler ikon; ttt har sit eget (adskilt fra enkeltstart, #1953)", () => {
  assert.equal(TERRAIN_TYPE_ICON_NAME.itt, TERRAIN_TYPE_ICON_NAME.itt_hilly);
  assert.notEqual(TERRAIN_TYPE_ICON_NAME.ttt, TERRAIN_TYPE_ICON_NAME.itt);
});

test("terrainTypeIconName: ukendt/manglende falder tilbage til RoadIcon", () => {
  assert.equal(terrainTypeIconName("nonsense"), "RoadIcon");
  assert.equal(terrainTypeIconName(null), "RoadIcon");
  assert.equal(terrainTypeIconName(undefined), "RoadIcon");
  assert.equal(terrainTypeIconName(""), "RoadIcon");
});

test("terrainTypeIconName: kendte profile_type-strenge matcher tabellen", () => {
  for (const key of PROFILE_TYPE_KEYS) {
    assert.equal(terrainTypeIconName(key), TERRAIN_TYPE_ICON_NAME[key]);
  }
});
