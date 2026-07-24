import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1537 — Rytterdatabasen: sortér på status + hold, ryttertype i egen kolonne,
// potentiale fjernet fra visning + sortering (doctrine #1138). Kilde-tekst-test
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

test("Potentiale er fjernet fra visning + sortering på rytterdatabasen (#1537/#1138)", () => {
  assert.doesNotMatch(
    src,
    /ScoutablePotentiale/,
    "Potentiale-kolonnen (ScoutablePotentiale) skal være helt ude af rytterdatabasen — doctrine #1138",
  );
  assert.doesNotMatch(
    src,
    /t\("table\.potential"\)/,
    "Potentiale-headeren må ikke længere rendres på rytterdatabasen",
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
