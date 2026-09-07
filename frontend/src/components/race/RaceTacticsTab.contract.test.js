// Kilde-struktur-guards for Taktik-fanen (#4613, variant A) — samme mønster som
// RaceSelectionPanel.autoSelect.test.js: repoet kører node --test uden jsdom, så
// komponent-kontrakter pinnes på kilden.
//
// Hvad der pinnes, og hvorfor det er værd at pinne:
//   1. Trinnene kommer fra serverens valid_efforts, ALDRIG en lokal femtrins-
//      liste — ellers ville et UI deployet før flag-flippet tilbyde valg
//      backenden afviser med 400 (stage_roles_invalid_effort).
//   2. Endagsløb har ingen etape-vælger, og kolonnen hedder "løbsdag".
//   3. Præcis ÉN guld-knap i fanen (TASTE P3): "Gem etape N". "Kopiér til
//      etape N" er sekundær.
//   4. Rollen kan redigeres i kolonnen (#4980), men gælder resten af løbet —
//      aldrig pr. etape, aldrig på en låst etape, og aldrig i et <select>.
//   5. Et gem rammer BEGGE endpoints for den åbne etape (#4613's hele pointe:
//      intention og ordrer hører til samme dag og samme knap).
//   6. En låst etape kan åbnes, men aldrig gemmes.
//   7. Fladen viser ingen tal ud over etapenumre og rute-match (fog of war).
//      Rute-match (#4992) er 0-100 og bevidst tilladt: det er PRÆCIS det tal
//      Hold-fanen og holdudtagelsen allerede viser for spillerens egne ryttere,
//      ikke et nyt kig ind i motoren.
//   8. Rute-match-kolonnen (#4992) står mellem ROLE og INTENTION, følger den
//      åbne etape, og er fanens ENESTE sorterbare kolonne.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "RaceTacticsTab.jsx"), "utf8");

test("trinnene kommer fra serverens valid_efforts, ikke fra en hardkodet liste", () => {
  assert.match(source, /orderedEfforts\(roles\?\.valid_efforts\)/);
  // Ingen lokal opremsning af de fem værdier i selve fladen.
  assert.doesNotMatch(source, /"grupetto"/);
  assert.doesNotMatch(source, /"all_out"/);
});

test("endagsløb: ingen etape-vælger, og kolonnen hedder løbsdag", () => {
  assert.match(source, /const isOneDay = stageCount <= 1;/);
  assert.match(source, /isOneDay \? \(\s*<span/);
  assert.match(source, /intention\.colIntentionRaceDay/);
  assert.match(source, /intention\.saveRaceDay/);
});

test("præcis én guld-knap: Gem er primary, Kopiér er secondary", () => {
  const primaries = source.match(/variant="primary"/g) || [];
  assert.equal(primaries.length, 1, "fanen må have præcis én guld-primær knap");
  assert.match(source, /variant="secondary"[\s\S]{0,200}intention\.copyToStage/);
  assert.match(source, /variant="primary"[\s\S]{0,300}intention\.save/);
});

// #4980: rollen kan nu redigeres i kolonnen (ejer-godkendt spillerønske), men
// stadig ALDRIG pr. etape: et valg skrives på alle ulåste etaper via
// applyRoleForRest, og vælgeren er den samme knap-liste som intentionen bruger
// (aldrig et <select>, som resten af fladen heller ikke har).
test("rollen redigeres for resten af løbet, aldrig pr. etape og aldrig i et <select>", () => {
  assert.doesNotMatch(source, /race_role: e\.target\.value/);
  assert.doesNotMatch(source, /<select/);
  // Kolonnen viser den EFFEKTIVE rolle (override → basis-rolle), ikke
  // race_entries-rollen alene.
  assert.match(source, /tacticsOrders\.roleLabel\.\$\{roleKey\(role\)\}/);
  assert.match(source, /const roleFor = \(rider\) =>/);
  // Skrivningen rammer editableStages (de ULÅSTE etaper), aldrig kun activeStage.
  assert.match(source, /applyRoleForRest\(\{ matrix: m, riderId, role, stages: editableStages \}\)/);
  // Rollerne kommer fra den delte liste, ikke fra en lokal opremsning i fladen.
  assert.match(source, /SELECTABLE_ROLES\.map/);
});

// #4980: en låst etape og en udgået rytter er ren visning — serveren afviser
// dem alligevel (stage_roles_stage_locked / stage_roles_rider_abandoned).
test("rolle-vælgeren vises ikke på låst etape eller for en udgået rytter", () => {
  assert.match(source, /const canEdit = !stageLocked && !rider\.abandoned && editableStages\.length > 0;/);
  assert.match(source, /\{canEdit && \(/);
});

// #4979: profilen for den åbne etape, over kortet — én ad gangen, og den følger
// etape-vælgeren.
test("etapeprofilen ligger over kortet og følger den åbne etape", () => {
  assert.match(source, /<RaceStageProfileRow/);
  assert.match(source, /profile=\{profileByStage\[activeStage\]\}/);
  // Rækken står FØR fanens kort i træet.
  const rowAt = source.indexOf("<RaceStageProfileRow");
  const cardAt = source.indexOf('data-testid="race-tactics-tab"');
  assert.ok(rowAt > 0 && cardAt > rowAt, "profil-rækken skal renderes over taktik-kortet");
});

test("ét gem rammer begge endpoints for den åbne etape", () => {
  assert.match(source, /diffToOverrides\(\{ matrix: draftMatrix, riders \}\)/);
  assert.match(source, /\/api\/races\/\$\{raceId\}\/stage-roles/);
  assert.match(source, /saveTacticsCard\(\{ raceId, stage: activeStage, order \}\)/);
  // Ordrerne gemmes EFTER intentionen, så en afvist intention (400) ikke
  // efterlader en halvt gemt dag.
  const rolesAt = source.indexOf("/stage-roles`");
  const ordersAt = source.indexOf("saveTacticsCard({ raceId");
  assert.ok(rolesAt > 0 && ordersAt > rolesAt, "intentionen skal gemmes før ordrerne");
});

test("en låst etape kan åbnes, men aldrig gemmes", () => {
  assert.match(source, /if \(stageLocked\) return;/);
  assert.match(source, /const dirty = !stageLocked &&/);
  // Vælgerens knapper er IKKE disabled på låste etaper — man skal kunne se
  // tilbage på hvad man sendte dem ud med.
  assert.doesNotMatch(source, /disabled=\{locked \|\| saving\}/);
});

// ── #4992: rute-match pr. etape ──────────────────────────────────────────────

test("rute-match-kolonnen står mellem ROLE og INTENTION (ejerens skitse)", () => {
  const roleAt = source.indexOf("{renderRoleCell(rider)}");
  const fitAt = source.indexOf("{renderRouteMatchCell(rider)}");
  const intentionAt = source.indexOf("{renderIntentionCell(rider)}");
  assert.ok(roleAt > 0 && fitAt > roleAt && intentionAt > fitAt, "kolonne-rækkefølge: rolle → rute-match → intention");
  // Header-rækkefølgen skal matche celle-rækkefølgen.
  const roleThAt = source.indexOf('t("intention.colRole")');
  const fitThAt = source.indexOf("{routeMatchColumn}");
  const intentionThAt = source.indexOf("{intentionColumn}");
  assert.ok(roleThAt < fitThAt && fitThAt < intentionThAt, "header-rækkefølgen skal matche cellerne");
});

test("rute-match følger den ÅBNE etape og kommer fra serverens stage_fit", () => {
  assert.match(source, /stageRouteMatch\(rider, activeStage\)/);
  // Ingen lokal genberegning af egnethed i fladen: tallet slås OP i den delte
  // helper, som bare læser serverens stage_fit.
  assert.doesNotMatch(source, /rider\.abilities|climbing|demand_vector\[/);
});

test("kolonnen er sorterbar, og listen står i holdets rækkefølge indtil man klikker", () => {
  assert.match(source, /<table data-sortable/);
  assert.match(source, /<SortableTh\s+sortKey="routeMatch"/);
  assert.match(source, /routeMatchComparator\(activeStage, routeSortDir\)/);
  // Opt-in: uden en valgt retning bruges `riders` uændret.
  assert.match(source, /routeSortDir \? \[\.\.\.riders\]\.sort\(routeMatchComparator\(activeStage, routeSortDir\)\) : riders/);
  // Sorteringen gælder BEGGE flader — ellers viser mobil en anden rækkefølge
  // end desktop for de samme data.
  assert.equal((source.match(/visibleRiders\.map\(/g) || []).length, 2, "både tabellen og mobil-listen tegner den sorterede liste");
});

test("colSpan for den udfoldede vælger følger antallet af kolonner", () => {
  // En kolonne mere = en kolonne mere at spænde over; ellers efterlader
  // vælger-rækken et hul i hairline-gitteret.
  assert.match(source, /colSpan=\{showOrders \? 5 : 4\}/);
});

test("mobil viser kun tallet — ingen bar, ingen vandret scroll", () => {
  assert.match(source, /renderRouteMatchCell\(rider, \{ numberOnly: true \}\)/);
  assert.match(source, /if \(numberOnly\) \{/);
  assert.match(source, /return <FitBar score=\{score\} \/>;/);
});

test("fog of war: ingen tal, procenter eller loft-signaler i fladens tekst", () => {
  assert.doesNotMatch(source, /%/);
  assert.doesNotMatch(source, /WORK_COST|MULT|multiplier/i);
});
