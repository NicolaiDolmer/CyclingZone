// #8797 — læsninger der ramte PostgREST' 1.000-rækkeloft.
//
// Der er ingen supertest-harness til api.js (jf. apiWithdrawalVisibility.routes.test.js),
// så ruternes WIRING låses med kilde-scanning, og selve læse-formen (samme helper,
// samme kæde) eksekveres mod den fælles fake, som afkorter ved 1.000 rækker uden
// .range() præcis som prod. Hver test har flere end 1.000 rækker.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFakeSupabase } from "./testUtils/fakeSupabase.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { fetchAllPaged } from "./dbChunk.js";
import { loadEligibleEntries } from "./raceEntriesLoader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");
const runnerSource = readFileSync(resolve(__dirname, "raceRunner.js"), "utf8");

function routeBlock(marker, len = 16000) {
  const start = apiSource.indexOf(marker);
  assert.ok(start !== -1, `${marker} skal findes i api.js`);
  return apiSource.slice(start, start + len);
}

// Ét hold med 1.300 entries fordelt på 260 løb (5 ryttere pr. løb).
function teamEntries(teamId = "team-1", races = 260, perRace = 5) {
  const rows = [];
  for (let r = 0; r < races; r++) {
    for (let k = 0; k < perRace; k++) {
      rows.push({
        race_id: `race-${String(r).padStart(4, "0")}`,
        rider_id: `rider-${String(k).padStart(3, "0")}`,
        team_id: teamId, race_role: null, is_auto_filled: false,
      });
    }
  }
  return rows;
}

test("kontrol: den fælles fake afkorter en naiv læsning ved 1.000, som prod", async () => {
  const supabase = createFakeSupabase({ race_entries: teamEntries() });
  // pagination-safe: bevidst naiv læsning — testen beviser at fake'en afkorter.
  const { data } = await supabase.from("race_entries").select("race_id").eq("team_id", "team-1");
  assert.equal(data.length, 1000);
});

test("/races/distribution: eksterne bindings henter ALLE holdets entries (paged loadEligibleEntries)", async () => {
  const block = routeBlock('router.get("/races/distribution"', 30000);
  assert.match(block, /paged: true, \/\/ #8797/);
  assert.match(block, /\.eq\("team_id", req\.team\.id\)\s*\.order\("race_id"\)\.order\("rider_id"\)/);

  const entries = teamEntries();
  const riders = [...new Set(entries.map((e) => e.rider_id))].map((id) => ({ id, team_id: "team-1", squad: "senior", is_academy: false, is_retired: false }));
  const supabase = createFakeSupabase({ race_entries: entries, riders });
  const { data, error } = await loadEligibleEntries({
    supabase, paged: true, // pagination-safe: paged: true → fetchAllPaged i loaderen
    baseQuery: () => supabase.from("race_entries").select("race_id, rider_id, team_id, is_auto_filled").eq("team_id", "team-1")
      .order("race_id").order("rider_id"),
  });
  assert.equal(error, null);
  assert.equal(data.length, 1300);
});

test("/races/strategy/preview: holdets entries via fetchAllRows", async () => {
  const block = routeBlock('router.post("/races/strategy/preview"');
  assert.match(block, /fetchAllRows\(\(\) => supabase\.from\("race_entries"\)\.select\("race_id, rider_id, race_role, is_auto_filled"\)\.eq\("team_id", req\.team\.id\)\s*\.order\("race_id"\)\.order\("rider_id"\)\)/);

  const supabase = createFakeSupabase({ race_entries: teamEntries() });
  const rows = await fetchAllRows(() => supabase.from("race_entries").select("race_id, rider_id, race_role, is_auto_filled").eq("team_id", "team-1")
    .order("race_id").order("rider_id"));
  assert.equal(rows.length, 1300);
});

test("/races/distribution/browse: startlister og ryttere chunkes + pagineres", async () => {
  const block = routeBlock('router.get("/races/distribution/browse"');
  assert.match(block, /fetchAllRowsChunkedIn\(visibleIds, \(chunk\) => supabase\s*\.from\("race_entries"\)\.select\("race_id, team_id, rider_id"\)\.in\("race_id", chunk\)\.order\("race_id"\)\.order\("rider_id"\)\)/);
  assert.match(block, /fetchAllRowsChunkedIn\(ids, \(chunk\) => supabase\.from\("riders"\)/);

  // 6 synlige løb × 220 ryttere = 1.320 startliste-rækker.
  const rows = [];
  for (let r = 0; r < 6; r++) for (let k = 0; k < 220; k++) rows.push({ race_id: `race-${r}`, team_id: `t${k % 20}`, rider_id: `rider-${String(k).padStart(3, "0")}` });
  const supabase = createFakeSupabase({ race_entries: rows });
  const visibleIds = ["race-0", "race-1", "race-2", "race-3", "race-4", "race-5"];
  const got = await fetchAllRowsChunkedIn(visibleIds, (chunk) => supabase
    .from("race_entries").select("race_id, team_id, rider_id").in("race_id", chunk).order("race_id").order("rider_id"));
  assert.equal(got.length, 1320);
});

test("/board/status: request-log og tilfredshedshændelser via fetchAllPaged", async () => {
  const block = routeBlock('router.get("/board/status"', 8000);
  assert.match(block, /fetchAllPaged\(\(\) => supabase\.from\("board_request_log"\)/);
  assert.match(block, /fetchAllPaged\(\(\) => supabase\.from\("board_satisfaction_events"\)/);

  const events = Array.from({ length: 1400 }, (_, i) => ({ id: `e${String(i).padStart(5, "0")}`, board_id: `b${i % 3}`, created_at: `2026-01-01T00:${String(i % 60).padStart(2, "0")}:00Z` }));
  const supabase = createFakeSupabase({ board_satisfaction_events: events });
  const { data, error } = await fetchAllPaged(() => supabase.from("board_satisfaction_events").select("id, board_id, created_at")
    .in("board_id", ["b0", "b1", "b2"])
    .order("created_at", { ascending: false }).order("id", { ascending: false }));
  assert.equal(error, null);
  assert.equal(data.length, 1400);
  assert.equal(new Set(data.map((e) => e.id)).size, 1400);
});

test("GET /auctions og GET /races: fetchAllPaged med unik andennøgle", async () => {
  const auctions = routeBlock('router.get("/auctions", requireAuth', 1600);
  assert.match(auctions, /await fetchAllPaged\(\(\) => supabase\s*\.from\("auctions"\)/);
  assert.match(auctions, /\.order\("calculated_end", \{ ascending: true \}\)\.order\("id"\)\);/);
  const races = routeBlock('router.get("/races", requireAuth', 2400);
  assert.match(races, /withSeniorSquadScope\(\(senior\) => fetchAllPaged\(\(\) => \{/);
  assert.match(races, /\.order\("name", \{ ascending: true \}\)\.order\("id"\);/);

  const rows = Array.from({ length: 1200 }, (_, i) => ({ id: `a${String(i).padStart(5, "0")}`, status: "completed", calculated_end: `2026-0${1 + (i % 9)}-01` }));
  const supabase = createFakeSupabase({ auctions: rows });
  const { data } = await fetchAllPaged(() => supabase.from("auctions").select("id").eq("status", "completed")
    .order("calculated_end", { ascending: true }).order("id"));
  assert.equal(data.length, 1200);
});

test("/races/selection/season: holdets entries i bidder får unik orderBy", () => {
  assert.match(apiSource, /inColumn: "race_id", ids: raceIds, extra: \(q\) => q\.eq\("team_id", teamId\), orderBy: \["race_id", "rider_id"\], \/\/ #8797/);
});

test("raceRunner.selectInChunks: en bid der rammer loftet hentes igen pagineret (motorens kald under loftet uændret)", () => {
  const start = runnerSource.indexOf("async function selectInChunks(");
  assert.ok(start !== -1);
  const fn = runnerSource.slice(start, start + 1200);
  // Første kald er det samme som før (ingen .order/.range) — under loftet er input bit-identisk.
  assert.match(fn, /const build = \(\) => \{ let q = supabase\.from\(table\)\.select\(columns\)\.in\(inColumn, ids\.slice\(i, i \+ IN_CHUNK_SIZE\)\); return extra \? extra\(q\) : q; \};/);
  assert.match(fn, /let \{ data, error \} = await build\(\);/);
  // Kun ved præcis loftet pagineres bidden.
  assert.match(fn, /if \(\(data \|\| \[\]\)\.length >= 1000\) \{\s*try \{ data = await fetchAllRows\(\(\) => build\(\)\.order\(inColumn\)\); \}/);
});
