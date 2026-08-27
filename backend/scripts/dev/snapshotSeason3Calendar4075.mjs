#!/usr/bin/env node
// backend/scripts/dev/snapshotSeason3Calendar4075.mjs
// Kalender-sessionen 21/8 (#4075 + monument-model B2 + GT-variation): read-only
// JSON-snapshot af HELE S3-kalenderen (races + race_stage_schedule +
// race_stage_profiles) FØR dagens målrettede UPDATE'er. Skrives til
// docs/snapshots/4075/. Ren SELECT — muterer intet.
//
// KØRSEL: cd backend && infisical run --env=prod -- node scripts/dev/snapshotSeason3Calendar4075.mjs

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { fetchAllRows, fetchAllRowsChunkedIn } from "../../lib/supabasePagination.js";
import { repoRoot } from "../lib/repoRoot.mjs";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE_URL/SUPABASE_SERVICE_KEY (kør via infisical run --env=prod)");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const { data: seasons, error: sErr } = await supabase.from("seasons").select("id, number, status, race_days_total").eq("number", 3);
if (sErr) throw sErr;
const season = seasons?.[0];
if (!season) { console.error("Fandt ingen sæson 3"); process.exit(1); }
console.log(`Sæson 3: ${season.id} (status ${season.status}, race_days_total ${season.race_days_total})`);

const races = await fetchAllRows(() => supabase.from("races").select("*").eq("season_id", season.id).order("id"));
const raceIds = races.map((r) => r.id);
const schedule = await fetchAllRowsChunkedIn(raceIds, (chunk) => supabase.from("race_stage_schedule").select("*").in("race_id", chunk).order("race_id").order("stage_number"));
const profiles = await fetchAllRowsChunkedIn(raceIds, (chunk) => supabase.from("race_stage_profiles").select("*").in("race_id", chunk).order("race_id").order("stage_number"));

// #4274: ankret på git-toplevel, ikke __dirname — se scripts/lib/repoRoot.mjs.
const outDir = join(repoRoot(), "docs", "snapshots", "4075");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const outFile = join(outDir, `pre-session-snapshot-season3-${stamp}.json`);
writeFileSync(outFile, JSON.stringify({ taken_at: new Date().toISOString(), season, counts: { races: races.length, schedule: schedule.length, profiles: profiles.length }, races, race_stage_schedule: schedule, race_stage_profiles: profiles }, null, 1));
console.log(`Snapshot: ${outFile}`);
console.log(`races=${races.length} schedule=${schedule.length} profiles=${profiles.length}`);
