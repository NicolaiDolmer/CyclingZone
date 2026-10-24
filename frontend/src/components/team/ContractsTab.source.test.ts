// #6855: kilde-assertions mod ContractsTab.tsx (node --test kan ikke importere
// .tsx, samme greb som BetaBadge.test.ts). Låser TASTE-reglerne og at
// sorteringen går gennem URL'en, så den huskes ved navigation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "ContractsTab.tsx"), "utf8");

test("sorteringen læses fra og skrives til URL'en (huskes ved navigation)", () => {
  assert.match(src, /readContractsSort\(searchParams\)/);
  assert.match(src, /setSearchParams\(\(prev\) => writeSortParams\(prev, CONTRACTS_SORT_PARAM, CONTRACTS_DIR_PARAM, next\), \{ replace: true \}\)/);
});

test("holdsiden: fanen og truppens sortering står i URL'en (bugfix: nulstilles ikke ved navigation)", () => {
  const team = readFileSync(join(__dirname, "../../pages/TeamPage.jsx"), "utf8");
  assert.match(team, /useClientRiderFilters\(displayRidersBase, seasonYear, readSquadSort\(searchParams\)\)/);
  assert.match(team, /writeSortParams\(prev, SQUAD_SORT_PARAM, SQUAD_DIR_PARAM, next\)/);
  assert.match(team, /TEAM_TABS\.includes\(tabParams\.get\("tab"\)\)/);
  assert.match(team, /\{ key: "contracts", label: t\("tabs\.contracts"\) \}/);
});

test("tal kommer fra backendens quote, ikke fra en frontend-kopi af løn-formlen", () => {
  assert.match(src, /riders\/extend-contracts\/quote/);
  assert.match(src, /"riders\/extend-contracts"/);
  assert.doesNotMatch(src, /computeContractExtension|computeFrozenSalary|SALARY_RATE/);
});

test("én gold primary i fladen: bundlinjens knap (vinduets bekræft er sin egen flade)", () => {
  const buttons = src.match(/<Button\b[^>]*>/g) ?? [];
  const primaries = buttons.filter((b) => !/variant="/.test(b));
  assert.equal(primaries.length, 2, "bundlinjens 'Forlæng N' + vinduets 'Forlæng'");
  assert.ok(primaries.some((b) => /contracts-extend/.test(b)));
  assert.ok(primaries.some((b) => /contracts-confirm/.test(b)));
});

test("TASTE: hairlines, 5px radius, ingen skygger/gradienter/emoji/unicode-pile", () => {
  assert.doesNotMatch(src, /rounded-(2xl|xl|lg|md)\b/);
  assert.doesNotMatch(src, /shadow-|gradient/);
  assert.doesNotMatch(src, /[←-⇿➔➡]/, "ingen unicode-pile som ikon");
  assert.doesNotMatch(src, /\p{Extended_Pictographic}/u, "ingen emoji");
  assert.doesNotMatch(src, /—/, "ingen em-dash");
});
