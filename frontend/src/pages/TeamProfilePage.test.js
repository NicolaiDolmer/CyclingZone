import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1529 — TeamProfilePage queryer Supabase DIREKTE (2 riders-selects: nuværende
// trup + ventende incoming). Evnerne hentes via join (ABILITY_SELECT fra
// lib/abilities.js → rider_derived_abilities(...)) og flades op på rytter-objektet
// med flattenAbilities, så rider.climbing osv. virker i render + sortRidersForTable.
// Testen holder os ærlige hvis nogen genindfører de gamle PCM stat_*-kolonner eller
// taber join'et (→ tomme evne-celler / "—" i hele evne-blokken).

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "TeamProfilePage.jsx"), "utf8");

test("TeamProfilePage henter evnerne via rider_derived_abilities-join (#1529)", () => {
  assert.match(
    source,
    /\$\{ABILITY_SELECT\}/,
    "begge riders-selects skal embedde ABILITY_SELECT (rider_derived_abilities(...))",
  );
  // Begge direkte riders-selects skal bruge join'et — ikke kun den ene.
  const abilitySelectCount = (source.match(/\$\{ABILITY_SELECT\}/g) || []).length;
  assert.equal(
    abilitySelectCount,
    2,
    "både nuværende-trup- og incoming-select skal embedde ABILITY_SELECT",
  );
});

test("TeamProfilePage flader evnerne op på rytter-objektet (#1529)", () => {
  assert.match(
    source,
    /flattenAbilities/,
    "fetchede ryttere skal mappes gennem flattenAbilities, så rider.climbing osv. virker i render/sort",
  );
});

test("TeamProfilePage importerer den delte evne-config (#1529)", () => {
  assert.match(
    source,
    /from "\.\.\/lib\/abilities"/,
    "ABILITY_STATS/ABILITY_SELECT/flattenAbilities skal komme fra lib/abilities",
  );
});

test("TeamProfilePage refererer IKKE længere de gamle PCM stat_*-kolonner (#1529)", () => {
  assert.doesNotMatch(
    source,
    /\bstat_(fl|bj|kb|bk|tt|prl|bro|sp|acc|ned|udh|mod|res|ftr)\b/,
    "de 14 PCM stat_*-kolonner er erstattet af de 15 CZ-evner — ingen må overleve i visnings-koden",
  );
});

// #2601 — "club"-fanen (read-only Staff + Facilities for ETHVERT hold) skal wires
// ind i TABS + tab-listen + rendres via TeamClubTab, samme mønster som transfers/
// palmares/results.
test("TeamProfilePage har 'club' i TABS og rendrer TeamClubTab med teamId (#2601)", () => {
  assert.match(source, /const TABS = \[[^\]]*"club"[^\]]*\]/, "TABS skal inkludere 'club'");
  assert.match(source, /import TeamClubTab from "\.\.\/components\/TeamClubTab"/);
  assert.match(source, /activeTab === "club" && \(\s*<TeamClubTab teamId=\{id\} \/>/);
  assert.match(source, /key: "club", label: t\("profile\.tabClub"\)/);
});
