import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1537 — Rytterdatabasen: sortér på status + hold, ryttertype i egen kolonne,
// #5292 adds viewer-masked scouting back; raw potential stays hidden and unsortable.
// Kilde-tekst-test
// (samme mønster som RidersPage.statBar/pendingTeam) holder strukturen ærlig
// hvis nogen ruller en af kolonnerne tilbage.
//
// #2849 bølge 2: tabellen migrerede fra den delte <SortTh sortKey=...>-komponent
// til ui/DataTable's kolonne-config (sortKey som objekt-property, ikke JSX-prop).
// Assertions opdateret til det nye mønster — den sorterbare adfærd er uændret.

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "RidersPage.jsx"), "utf8");

test("Hold-kolonnen er sortérbar (#1537)", () => {
  assert.match(
    src,
    /sortKey: "team_id"/,
    "Hold-kolonnen skal have sortKey: \"team_id\" i DataTable-config'en — var en død header før #1537",
  );
});

test("Status-kolonnen er sortérbar (#1537)", () => {
  assert.match(
    src,
    /sortKey: "is_u25"/,
    "Status-kolonnen skal have sortKey: \"is_u25\" (alders-tier) per #1537",
  );
});

test("Ryttertype har sin egen sortérbare kolonne (#1537)", () => {
  assert.match(
    src,
    /sortKey: "primary_type"/,
    "Ryttertype skal stå i sin egen kolonne med sortKey: \"primary_type\", ikke blandet med Status",
  );
  assert.match(
    src,
    /t\("table\.type"\)/,
    "Type-headeren skal bruge riders:table.type-nøglen",
  );
});

test("scouting reuses masked estimates without enabling raw potential sorting (#5292/#1138)", () => {
  assert.match(
    src,
    /<ScoutablePotentiale rider=\{r\} scouting=\{scouting\} showScout/,
    "Rider database must reuse the auction scouting component",
  );
  assert.doesNotMatch(
    src,
    /sortKey:\s*["'](?:potentiale?|_scoutMid)["']/,
    "Scouting must not introduce sorting on hidden potential or page-local estimates",
  );
});

test("CZ-evner vises stadig via ABILITY_STATS, ingen PCM stat_*-kolonner (#1529)", () => {
  assert.match(
    src,
    /ABILITY_STATS as STATS/,
    "stat-kolonnerne skal komme fra den delte ABILITY_STATS (CZ-evner), ikke PCM",
  );
  assert.doesNotMatch(
    src,
    /\bstat_(fl|bj|kb|bk|tt|prl|bro|sp|acc|ned|udh|mod|res|ftr)\b/,
    "de gamle PCM stat_*-felter må ikke optræde i visningen",
  );
});
