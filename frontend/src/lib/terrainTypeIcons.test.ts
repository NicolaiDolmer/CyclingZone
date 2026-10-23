// Unit-tests for terrainTypeIcons.ts (#6683). Koer med: node --test (i frontend/)
/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PROFILE_TYPE_KEYS } from "./stageProfileConfig.js";
import {
  TERRAIN_GLYPHS,
  TERRAIN_TYPE_GLYPH,
  terrainGlyph,
  terrainDisplayType,
  terrainColorVar,
  missingTerrainIconCoverage,
} from "./terrainTypeIcons.ts";

// classic er ikke en rutetype: den vises som kuperet (ejer 15/10).
const ALIASES = new Set(["classic"]);
const OWN_ICON_TYPES = PROFILE_TYPE_KEYS.filter((k) => !ALIASES.has(k));
// Tidskoersel deler farve (blaa); ellers har hver type sin egen.
const SHARED_COLOR_TYPES = ["itt", "itt_hilly", "ttt"];

test("alle PROFILE_TYPE_KEYS har et ikon (forward-guard)", () => {
  assert.deepEqual(missingTerrainIconCoverage(), []);
  for (const key of PROFILE_TYPE_KEYS) {
    assert.ok(terrainGlyph(key), `mangler ikon for "${key}"`);
  }
});

test("hver type har sit EGET ikon: ingen to typer deler figur (classic undtaget)", () => {
  const seen = new Map<string, string>();
  for (const key of OWN_ICON_TYPES) {
    assert.equal(TERRAIN_TYPE_GLYPH[key], key, `${key} skal pege paa sit eget ikon`);
    const sig = JSON.stringify(TERRAIN_GLYPHS[key].shapes);
    assert.equal(seen.get(sig), undefined, `${key} deler figur med ${seen.get(sig)}`);
    seen.set(sig, key);
  }
  assert.equal(seen.size, 11);
});

test("hver type har sin egen farve, undtagen de tre tidskoerslerne", () => {
  const byColor = new Map<string, string[]>();
  for (const key of OWN_ICON_TYPES) {
    const color = TERRAIN_GLYPHS[key].color;
    byColor.set(color, [...(byColor.get(color) ?? []), key]);
  }
  for (const [color, types] of byColor) {
    if (types.length > 1) assert.deepEqual([...types].sort(), [...SHARED_COLOR_TYPES].sort(), `farven ${color} deles af ${types}`);
  }
  assert.equal(byColor.size, 9);
});

test("classic er ikke en rutetype: vises som kuperet", () => {
  assert.equal(terrainDisplayType("classic"), "hilly");
  assert.equal(terrainGlyph("classic"), TERRAIN_GLYPHS.hilly);
});

test("rolling er ikke flad, og bjergtyperne er hver sin", () => {
  assert.notDeepEqual(TERRAIN_GLYPHS.rolling.shapes, TERRAIN_GLYPHS.flat.shapes);
  const mountains = ["hilly", "medium_mountain", "mountain", "high_mountain"].map((k) => JSON.stringify(TERRAIN_GLYPHS[k].shapes));
  assert.equal(new Set(mountains).size, 4);
});

test("ukendt/manglende profile_type giver intet ikon (hellere intet end et forkert)", () => {
  for (const bad of ["nonsense", "", null, undefined]) {
    assert.equal(terrainGlyph(bad), null);
    assert.equal(terrainDisplayType(bad), null);
  }
});

test("farven er et token, aldrig raa hex, og tokenet findes i baade lyst og moerkt tema", () => {
  const css = readFileSync(new URL("../index.css", import.meta.url), "utf8").split("\r\n").join("\n");
  const light = css.slice(css.indexOf(":root {\n  color-scheme: light;"), css.indexOf('[data-theme="dark"] {'));
  const dark = css.slice(css.indexOf('[data-theme="dark"] {\n  color-scheme: dark;'));
  for (const def of Object.values(TERRAIN_GLYPHS)) {
    const v = terrainColorVar(def);
    assert.match(v, /^var\(--terrain-[a-z-]+\)$/);
    const token = v.slice(4, -1);
    assert.ok(light.includes(`${token}:`), `${token} mangler i lyst tema`);
    assert.ok(dark.includes(`${token}:`), `${token} mangler i moerkt tema`);
  }
});

test("ikonerne er rene figurer paa 24-grid: ingen flise/ring om hele ikonet", () => {
  for (const [key, def] of Object.entries(TERRAIN_GLYPHS)) {
    assert.ok(def.shapes.length > 0, key);
    for (const s of def.shapes) {
      if (s.t === "circle") assert.ok(s.cx - s.r >= 0 && s.cx + s.r <= 24 && s.r < 8, `${key}: cirkel uden for grid/ring`);
      if (s.t === "rect") assert.ok(s.x + s.w <= 24 && s.w < 12, `${key}: firkant uden for grid/flise`);
    }
  }
});
