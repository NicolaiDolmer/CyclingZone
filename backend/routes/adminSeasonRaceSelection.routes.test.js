// #3014 — kontrakt-tests for POST /admin/seasons/:seasonId/race-selection.
//
// api.js er ikke unit-testbar direkte (kræver live Supabase-client) — samme
// kildetekst-scan-mønster som raceSelectionSeason.routes.test.js/
// raceSelectionBulk.routes.test.js. pool_race_ids og den udledte
// existingRaceIds kan begge dække en hel sæsons kalender (op til 455 løb i S2)
// — denne fil låser fast at alle tre .in()-opslag i routen (race_pool-lookup,
// race_results-count, races-delete) går via chunking (fetchAllRowsChunkedIn
// eller en manuel SUPABASE_IN_CHUNK_SIZE-loop), IKKE en rå
// .in("...", pool_race_ids/existingRaceIds) direkte mod hele listen.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "./api.js"), "utf8");

const MARKER = 'router.post("/admin/seasons/:seasonId/race-selection"';

function handlerBlock(len = 4000) {
  const idx = apiSource.indexOf(MARKER);
  assert.ok(idx !== -1, `${MARKER} skal findes i api.js`);
  return apiSource.slice(idx, idx + len);
}

test("POST /admin/seasons/:seasonId/race-selection er registreret + kræver admin", () => {
  const block = handlerBlock(600);
  assert.match(block, /requireAdmin/, "skal kræve admin");
  assert.match(block, /adminWriteLimiter/, "skal rate-limitere skriv-endpointet");
});

test("#3014: race_pool-opslaget på pool_race_ids går via fetchAllRowsChunkedIn, ikke en rå .in()", () => {
  const block = handlerBlock(1400);
  assert.match(
    block,
    /fetchAllRowsChunkedIn\(pool_race_ids,/,
    "pool_race_ids kan dække en hel sæsons kalender — skal chunkes",
  );
  assert.doesNotMatch(
    block,
    /\.from\("race_pool"\)[\s\S]{0,200}\.in\("id",\s*pool_race_ids\)/,
    "må ikke sende hele pool_race_ids i ét rå .in()-kald",
  );
});

test("#3014: race_results-count og races-delete på existingRaceIds er chunket via SUPABASE_IN_CHUNK_SIZE", () => {
  const block = handlerBlock(4000);
  assert.match(
    block,
    /existingRaceIds\.length; i \+= SUPABASE_IN_CHUNK_SIZE/,
    "existingRaceIds skal itereres i SUPABASE_IN_CHUNK_SIZE-bidder (count OG delete)",
  );
  assert.doesNotMatch(
    block,
    /\.in\("race_id",\s*existingRaceIds\)/,
    "må ikke sende hele existingRaceIds i ét rå .in()-kald til race_results",
  );
  assert.doesNotMatch(
    block,
    /\.delete\(\)\s*\.in\("id",\s*existingRaceIds\)/,
    "må ikke sende hele existingRaceIds i ét rå .in()-kald til races.delete()",
  );
});
