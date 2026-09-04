#!/usr/bin/env node
// i18n terrain-coverage guard — Refs #2896.
//
// #2896 postmortem: backend/lib/raceCalendar.js's CALENDAR_TERRAIN_BUCKETS renamed
// "flat" → "sprint" (#2605, cobbles-split), but frontend/public/locales/{en,da}/
// planner.json's `terrain` object kept the OLD "flat" key and never gained
// "sprint" — BOTH languages missing the SAME key symmetrically, so
// i18n-check-keys.mjs (which only diffs en against da) stayed green while
// players saw the raw "terrain.sprint" key for the single most common race
// terrain (145 of 455 season-2 races, verified via prod SELECT 2026-07-25).
//
// Root cause is structural, not a one-off typo: any i18n key built DYNAMICALLY
// (`t(\`terrain.${x}\`)`) is invisible to key-coverage checks that only diff
// locale files against each other. The only real guard is comparing against
// the SOURCE OF TRUTH that produces the dynamic value — the bucket/archetype
// constants themselves.
//
// A second, LIVE instance of the same bug class turned up in the same audit:
// #2769 (2026-07-21) added a new `itt_classic` single-race archetype to
// ARCHETYPE_PROFILES (raceStageProfileGenerator.js) without a matching
// frontend/public/locales/{en,da}/rider.json `profile.results.terrain.itt_classic`
// key — completed races ("Mascate Classic", "Gran Premio de Castilla") already
// show the raw key on the rider Results tab.
//
// This script checks these classes against their generator source of truth:
//   1. CALENDAR_TERRAIN_BUCKETS (raceCalendar.js)
//        ⊆ planner.json `terrain` keys (en + da)
//   2. ARCHETYPE_PROFILES kind:"single" keys (raceStageProfileGenerator.js)
//        ⊆ rider.json `profile.results.terrain` keys (en + da)
//   3. PROFILE_TYPE_KEYS (frontend stageProfileConfig.js — #4748/#4487)
//        ⊆ races.json `detail.profileType` keys (en + da) — the visible label
//        ⊆ terrainTypeIcons.ts `TERRAIN_TYPE_ICON_NAME` keys — the glyph
//      A profile_type missing either would render a raw i18n key or fall back
//      silently to the wrong icon (RoadIcon) — this class is exactly #2896's
//      failure mode again, just on the new terrain-glyph table.
//
// Brug:
//   node scripts/i18n-check-terrain-coverage.mjs
//
// CI: .github/workflows/i18n-check.yml

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CALENDAR_TERRAIN_BUCKETS } from "../backend/lib/raceCalendar.js";
import { ARCHETYPE_PROFILES } from "../backend/lib/raceStageProfileGenerator.js";
import { PROFILE_TYPE_KEYS } from "../frontend/src/lib/stageProfileConfig.js";
import { TERRAIN_TYPE_ICON_NAME } from "../frontend/src/lib/terrainTypeIcons.ts";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const LOCALES_DIR = join(ROOT, "frontend", "public", "locales");
const LNGS = ["en", "da"];

function loadJSON(lng, ns) {
  return JSON.parse(readFileSync(join(LOCALES_DIR, lng, `${ns}.json`), "utf8"));
}

function valueAtPath(obj, dotPath) {
  return dotPath.split(".").reduce((acc, p) => (acc == null ? acc : acc[p]), obj);
}

// Ren funktion (ingen fs) — for hver `value` i `values`: findes en nøgle
// `value` under `keyPath` i `localeDataByLng[lng]`, for hvert sprog? Returnerer
// kun de værdier der MANGLER i mindst ét sprog, sammen med hvilke sprog.
export function findMissingTerrainKeys(values, localeDataByLng, keyPath) {
  const missing = [];
  for (const value of values) {
    const missingIn = [];
    for (const lng of Object.keys(localeDataByLng)) {
      const bucket = valueAtPath(localeDataByLng[lng], keyPath);
      const hasKey = bucket != null && typeof bucket === "object" && Object.prototype.hasOwnProperty.call(bucket, value);
      if (!hasKey) missingIn.push(lng);
    }
    if (missingIn.length > 0) missing.push({ value, missingIn });
  }
  return missing;
}

// kind:"single" = endagsløbs-arketyper (race_type='single' i race_pool). "stage"
// (tour/week) arketyper renderer aldrig gennem rider.json's profile.results.terrain
// (RiderResultsTab viser "{n} stages" for etapeløb i stedet, se komponentens
// isStageRace-branch) og er derfor bevidst UDENFOR dette tjek.
export function singleRaceArchetypes(archetypeProfiles) {
  return Object.entries(archetypeProfiles)
    .filter(([, cfg]) => cfg.kind === "single")
    .map(([key]) => key);
}

// #4748/#4487: profile_type-keys uden en glyf-navn i TERRAIN_TYPE_ICON_NAME.
// Ren funktion (samme moenster som findMissingTerrainKeys) saa den kan testes
// uden fs.
export function findMissingIconCoverage(values, iconNameByKey) {
  return values.filter((value) => !(value in iconNameByKey));
}

function main() {
  const plannerByLng = Object.fromEntries(LNGS.map((lng) => [lng, loadJSON(lng, "planner")]));
  const riderByLng = Object.fromEntries(LNGS.map((lng) => [lng, loadJSON(lng, "rider")]));
  const racesByLng = Object.fromEntries(LNGS.map((lng) => [lng, loadJSON(lng, "races")]));

  const calendarMissing = findMissingTerrainKeys(CALENDAR_TERRAIN_BUCKETS, plannerByLng, "terrain")
    .map((m) => ({ ...m, ns: "planner.json", keyPath: "terrain", source: "CALENDAR_TERRAIN_BUCKETS (backend/lib/raceCalendar.js)" }));

  const archetypeValues = singleRaceArchetypes(ARCHETYPE_PROFILES);
  const archetypeMissing = findMissingTerrainKeys(archetypeValues, riderByLng, "profile.results.terrain")
    .map((m) => ({ ...m, ns: "rider.json", keyPath: "profile.results.terrain", source: "ARCHETYPE_PROFILES kind:\"single\" (backend/lib/raceStageProfileGenerator.js)" }));

  const profileLabelMissing = findMissingTerrainKeys(PROFILE_TYPE_KEYS, racesByLng, "detail.profileType")
    .map((m) => ({ ...m, ns: "races.json", keyPath: "detail.profileType", source: "PROFILE_TYPE_KEYS (frontend/src/lib/stageProfileConfig.js)" }));

  const allMissing = [...calendarMissing, ...archetypeMissing, ...profileLabelMissing];

  const iconMissing = findMissingIconCoverage(PROFILE_TYPE_KEYS, TERRAIN_TYPE_ICON_NAME);

  if (allMissing.length === 0 && iconMissing.length === 0) {
    console.log(
      `✓ i18n terrain-coverage OK — ${CALENDAR_TERRAIN_BUCKETS.length} calendar bucket(s) + ${archetypeValues.length} single-race archetype(s) + ${PROFILE_TYPE_KEYS.length} profile type(s) (label + glyf) × ${LNGS.length} language(s)`
    );
    process.exit(0);
  }

  console.error(`✗ i18n terrain-coverage FAILED — ${allMissing.length + iconMissing.length} problem(s):\n`);
  for (const { value, missingIn, ns, keyPath, source } of allMissing) {
    console.error(`  • "${value}" (from ${source}) missing at frontend/public/locales/{${missingIn.join(",")}}/${ns} → ${keyPath}.${value}`);
  }
  for (const value of iconMissing) {
    console.error(`  • "${value}" (from PROFILE_TYPE_KEYS) has no glyf in frontend/src/lib/terrainTypeIcons.ts's TERRAIN_TYPE_ICON_NAME`);
  }
  console.error(`\nFix: add the missing key(s)/glyf under frontend/public/locales/{en,da}/<namespace>.json or terrainTypeIcons.ts.`);
  console.error(`Why this matters: these keys are built DYNAMICALLY (t(\`...\${value}\`)) — a key missing in`);
  console.error(`BOTH languages is invisible to i18n-check-keys.mjs's en-vs-da symmetry check (Refs #2896).`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
