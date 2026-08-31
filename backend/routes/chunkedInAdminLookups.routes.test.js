// #3014 — kontrakt-tests for tre yderligere .in()-kaldesteder fundet i den
// eksplicitte sweep af backend/routes/api.js: alle tre tillader id-lister der
// kan nærme sig PostgRESTs ~16 KB URL-længde-cap (~430 UUID'er, jf.
// SUPABASE_IN_CHUNK_SIZE-kommentaren i supabasePagination.js) — POST
// /scouting/estimates og GET /admin/growth/nps/attribution clamper begge til
// max 500 id'er (500 UUID'er ≈ 18,5 KB, over cap'en).
//
// api.js er ikke unit-testbar direkte (kræver live Supabase-client) — samme
// kildetekst-scan-mønster som raceSelectionSeason.routes.test.js. Denne fil
// låser fast at alle tre nu går via fetchAllRowsChunkedIn i stedet for en rå
// .in() mod hele id-listen.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "./api.js"), "utf8");

function handlerBlock(marker, len = 2500) {
  const idx = apiSource.indexOf(marker);
  assert.ok(idx !== -1, `${marker} skal findes i api.js`);
  return apiSource.slice(idx, idx + len);
}

test("#3014: POST /scouting/estimates henter riders + rider_derived_abilities via fetchAllRowsChunkedIn (max 500 ids)", () => {
  const block = handlerBlock('router.post("/scouting/estimates"');
  assert.match(block, /ids\.length > 500/, "500-loftet skal stadig stå (uændret adfærd)");
  assert.match(
    block,
    /fetchAllRowsChunkedIn\(ids,[\s\S]{0,120}"riders"\)/,
    "riders-opslaget skal gå via fetchAllRowsChunkedIn",
  );
  assert.match(
    block,
    /fetchAllRowsChunkedIn\(ids,[\s\S]{0,160}"rider_derived_abilities"\)/,
    "rider_derived_abilities-opslaget skal gå via fetchAllRowsChunkedIn",
  );
});

test("#3014: GET /admin/attribution slår teams op via fetchAllRowsChunkedIn (limit clamper til 500)", () => {
  const block = handlerBlock('router.get("/admin/attribution"');
  assert.match(block, /Math\.min\(Math\.max\([\s\S]{0,40}, 500\)/, "limit skal stadig clampe til 500");
  assert.match(
    block,
    /fetchAllRowsChunkedIn\(userIds,[\s\S]{0,120}"teams"\)/,
    "teams-opslaget skal gå via fetchAllRowsChunkedIn",
  );
});

test("#3014: GET /admin/growth/nps slår teams op via fetchAllRowsChunkedIn (limit clamper til 500)", () => {
  const block = handlerBlock('router.get("/admin/growth/nps"');
  assert.match(block, /Math\.min\(Math\.max\([\s\S]{0,40}, 500\)/, "limit skal stadig clampe til 500");
  assert.match(
    block,
    /fetchAllRowsChunkedIn\(userIds,[\s\S]{0,120}"teams"\)/,
    "teams-opslaget skal gå via fetchAllRowsChunkedIn",
  );
});
