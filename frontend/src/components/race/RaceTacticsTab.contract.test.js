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
  // #7332: pr. etape (enkeltstart skjuler grupetto/protect), stadig fra serverens valid_efforts.
  assert.match(source, /effortsForStage\(roles\?\.valid_efforts, stageProfileType\)/);
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
  // Uden beta-flaget rammer skrivningen editableStages (de ULÅSTE etaper).
  // #6095 (beta): "etape N og løbet ud" = ulåste etaper >= den åbne; "kun etape N"
  // = kun den åbne. Aldrig en etape FØR den åbne.
  assert.match(source, /applyRoleForRest\(\{ matrix: m, riderId, role, stages \}\)/);
  assert.match(source, /roleScopeChoice === "stage" \? \[activeStage\] : editableStages\.filter\(\(sn\) => sn >= activeStage\)/);
  assert.match(source, /: editableStages;/);
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
  // #7332: kladden normaliseres (grupetto/protect -> save paa en enkeltstart) foer diffen.
  assert.match(source, /diffToOverrides\(\{ matrix: withIndividualTimeTrialEfforts\(\{ matrix: draftMatrix, profileByStage \}\), riders \}\)/);
  assert.match(source, /\/api\/races\/\$\{raceId\}\/stage-roles/);
  // #6647: ordren gemmes med intentionens indsats, ikke rollens "normal".
  assert.match(source, /saveTacticsCard\(\{ raceId, stage: activeStage, order: withIntentionEfforts\(order, /);
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

// #6095: gemmet sender kun de ændrede etaper + deres version, og en konflikt
// henter den nyeste udgave i stedet for at overskrive den.
test("#6095 gem skriver kun ændrede etaper og respekterer konflikter", () => {
  assert.match(source, /const stages = changedStages\(draftMatrix, initialMatrix\)\.filter\(\(sn\) => editableStages\.includes\(sn\)\);/);
  assert.match(source, /body: JSON\.stringify\(\{ overrides, stages, base_versions: baseVersions \}\)/);
  assert.match(source, /if \(body\.error === "stage_roles_conflict"\) await load\(\);/);
  // Et ordre-gem uden intentions-ændringer må ikke røre intentionen.
  assert.match(source, /if \(stages\.length\) \{/);
});

test("#6095 etape-valget i rollevælgeren findes kun bag serverens flag", () => {
  assert.match(source, /const scopeChoice = roles\.role_scope_choice === true && !isOneDay;/);
  assert.match(source, /racePage\.tactics\.roleScopeRest/);
  assert.match(source, /racePage\.tactics\.roleScopeStageOnly/);
});

// #5945: et hold under startgulvet, som ikke kan fyldes op, stiller ikke op. Serveren
// siger det (stage-roles start_outlook); fanen viser banneret i stedet for en taktik-matrix
// for ryttere der aldrig starter, og genbruger udtagelsens egen sætning.
test("#5945 start_outlook.starts === false giver banner i stedet for matrix", () => {
  assert.match(source, /roles\.enabled && roles\.start_outlook\?\.starts === false/);
  assert.match(source, /data-testid="tactics-not-starting"/);
  assert.match(source, /t\("selection\.willNotStart", \{ min: roles\.start_outlook\.min \}\)/);
  // Banneret returnerer FØR rytter-matrixen, så ingen deltager-markering rendres.
  const bannerAt = source.indexOf("tactics-not-starting");
  const matrixAt = source.indexOf("stageIntentionCounts({ matrix: draftMatrix");
  const flagOffAt = source.indexOf("Flag OFF, eller holdet har ingen ryttere");
  assert.ok(bannerAt > 0 && flagOffAt > 0 && bannerAt < flagOffAt, "banneret ligger foer de normale grene");
  assert.ok(matrixAt > 0);
});

// #6746: trinnet "protect" hedder efter rollen. Alle seks roller er daekket: ledere
// (ogsaa den delte kaptajn, som aldrig arbejder) foelger angrebene, fri rolle koerer
// offensivt, resten (hjaelper, jaeger) arbejder. Ingen af dem falder tilbage til det
// gamle "arbejd eller angrib".
test("#6746 protect-trinnet er rollebevidst for alle roller", () => {
  const map = source.match(/const PROTECT_VARIANT = \{([^}]*)\}/)?.[1] ?? "";
  for (const role of ["captain", "co_captain", "sprint_captain"]) {
    assert.match(map, new RegExp(`${role}: "follow"`), `${role} skal foelge angrebene`);
  }
  assert.match(map, /free_role: "free"/);
  assert.doesNotMatch(map, /helper|hunter/, "hjaelper og jaeger er default (work)");
  assert.match(source, /PROTECT_VARIANT\[role\] \|\| "work"/);
  assert.match(source, /effort === "protect" \? protectText\(t, role, "step"\)/);
});

// ── #7334: rute-match følger med, når etapeplanen erstatter den gamle tabel ──

test("etapeplanen får rute-match, sortering og mobiltal fra samme kilde som den gamle tabel", () => {
  const boardAt = source.indexOf("<StagePlanBoard");
  const boardEnd = source.indexOf("renderCell: renderRouteMatchCell", boardAt) + 40;
  const call = source.slice(boardAt, boardEnd);
  assert.match(call, /routeMatch=\{\{/);
  assert.match(call, /renderCell: renderRouteMatchCell/);
  assert.match(call, /onSort: toggleRouteSort/);
  assert.match(call, /sortDir: routeSortDir/);
  // Planen tegner den samme sorterede liste (visibleRiders), ikke en egen rækkefølge.
  assert.match(call, /riders=\{visibleRiders\}/);
});

test("etapeplanens tabel og mobilkort tegner rute-match", () => {
  const board = readFileSync(join(__dirname, "StagePlanBoard.tsx"), "utf8");
  assert.match(board, /<SortableTh\s+sortKey="routeMatch"/);
  assert.match(board, /routeMatch\.renderCell\(rider\)/);
  assert.match(board, /routeMatch\.renderCell\(rider, \{ numberOnly: true \}\)/);
  assert.match(board, /colSpan=\{routeMatch \? 4 : 3\}/);
});

test("#7332 enkeltstart: tre trin, gamle valg vises som save, kopi og gem skriver aldrig grupetto/protect", () => {
  // Vaelgeren faar etapens trin (begge layouts), aldrig serverens raa liste.
  assert.equal((source.match(/steps=\{steps\}/g) || []).length, 2);
  assert.match(source, /const steps = effortsForStage\(roles\?\.valid_efforts, stageProfileType\);/);
  // Aaben etape: visningen gaar gennem effortForStage; laast etape viser det der blev sendt.
  assert.match(source, /: effortForStage\(intentionFor\(\{ matrix: draftMatrix, stageNumber: activeStage, riderId: rider\.rider_id \}\), stageProfileType\)\);/);
  // Kopi kender maal-etapens profil; ordren gemmes med den normaliserede indsats.
  assert.match(source, /copyStageIntentions\(\{ matrix: m, fromStage: activeStage, toStage: nextStage, riders, fromProfileType: profileTypeOfStage\(activeStage\), toProfileType: profileTypeOfStage\(nextStage\) \}\)/);
  assert.match(source, /withIntentionEfforts\(order, \(riderId\) => effortForStage\(intentionFor\(/);
});
