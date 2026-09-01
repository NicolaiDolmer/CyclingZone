// #915/#3575/#4377 · Tests for getBoardRenegotiationLock — guard mod
// gen-forhandling af en allerede-signeret bestyrelsesplan.
//
// Dækker eksplicit bypass-vektorerne fra undersøgelsen:
//   (1) første signering (intet board / pending) må altid passere
//   (2) sæsonstart (race_days_completed = 0) må passere for 1yr-planer
//   (3) flerårig plan (3yr/5yr) er FØRST gen-underskrivbar når den er udløbet
//       (negotiation_status flippet til "pending") — uanset sæson-fremdrift.
//       Ejer-valg 1/9 lukker re-roll-hullet hvor en aktiv, ikke-udløbet
//       flerårsplan kunne gen-underskrives tidligt i en NY sæson og dermed
//       nulstille seasons_completed/cumulative_*_wins/plan_start_season_number.
//   (4) fornyelse af udløbet (pending) plan må passere — også for 3yr/5yr
//   (5) 1yr-planer er UÆNDREDE: kun same-sæson race-day-progress/vindue låser dem
//   + tærskel-grænser (49% vs 50%) og slutfase-vinduet (sidste 5 race-days) for 1yr.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  getBoardRenegotiationLock,
  REQUEST_WINDOW_BLOCK_RACE_DAYS_LEFT,
  RENEGOTIATION_SEASON_PROGRESS_LOCK_PCT,
} from "./boardRequests.js";

const season = (completed, total = 100) => ({
  race_days_completed: completed,
  race_days_total: total,
});
const completedPlan = (extra = {}) => ({
  plan_type: "1yr",
  negotiation_status: "completed",
  ...extra,
});

test("ingen plan → ikke låst (første signering)", () => {
  assert.equal(getBoardRenegotiationLock({ board: null, activeSeason: season(90) }).locked, false);
});

test("pending plan → ikke låst (fornyelse af udløbet plan, selv sent på sæsonen)", () => {
  const board = completedPlan({ negotiation_status: "pending" });
  assert.equal(getBoardRenegotiationLock({ board, activeSeason: season(95) }).locked, false);
});

test("sæsonstart (0 race-days kørt) → ikke låst", () => {
  assert.equal(getBoardRenegotiationLock({ board: completedPlan(), activeSeason: season(0) }).locked, false);
});

test("tidligt på sæsonen (under 50%) → ikke låst", () => {
  const r = getBoardRenegotiationLock({ board: completedPlan(), activeSeason: season(49) });
  assert.equal(r.locked, false);
});

test("præcis ved 50% sæson-progress → låst (PROGRESS)", () => {
  const r = getBoardRenegotiationLock({ board: completedPlan(), activeSeason: season(50) });
  assert.equal(r.locked, true);
  assert.equal(r.code, "BOARD_RENEGOTIATION_LOCKED_PROGRESS");
  // #678 Track 3: { code, params }-kontrakt til frontend resolveApiError.
  assert.equal(r.errorCode, "board_renegotiation_locked_progress");
  assert.deepEqual(r.errorParams, { percent: RENEGOTIATION_SEASON_PROGRESS_LOCK_PCT });
});

test("slutfase (≤5 race-days tilbage) → låst (WINDOW)", () => {
  const completed = 100 - REQUEST_WINDOW_BLOCK_RACE_DAYS_LEFT; // raceDaysLeft = 5
  const r = getBoardRenegotiationLock({ board: completedPlan(), activeSeason: season(completed) });
  assert.equal(r.locked, true);
  assert.equal(r.code, "BOARD_RENEGOTIATION_LOCKED_WINDOW");
  // #678 Track 3: { code, params }-kontrakt til frontend resolveApiError.
  assert.equal(r.errorCode, "board_renegotiation_locked_window");
  assert.deepEqual(r.errorParams, { raceDays: REQUEST_WINDOW_BLOCK_RACE_DAYS_LEFT });
});

test("flerårig plan mid-plan (sæson 2+) låses uafhængigt af season_id", () => {
  // Vector 3: en 5yr-plan signeret i en tidligere sæson (season_id ≠ aktiv) må
  // IKKE kunne gen-forhandles midt i en senere sæson. Guarden ser kun på
  // negotiation_status + plan_type, så season_id-mismatch redder ikke exploiten.
  const board = completedPlan({
    plan_type: "5yr",
    season_id: "00000000-0000-0000-0000-000000000001",
    plan_start_season_number: 1,
    plan_end_season_number: 5,
  });
  const r = getBoardRenegotiationLock({ board, activeSeason: { ...season(60), id: "different-season-id", number: 2 } });
  assert.equal(r.locked, true);
  assert.equal(r.code, "BOARD_RENEGOTIATION_LOCKED_PLAN_ACTIVE");
});

// ── #3575/#4377 · Ejer-valg 1/9: flerårsplan FØRST gen-underskrivbar ved udløb ──

for (const planType of ["3yr", "5yr"]) {
  test(`(a) aktiv ${planType}-plan kan IKKE gen-underskrives tidligt i en NY sæson (re-roll-exploitet)`, () => {
    // Den nøjagtige exploit-vektor fra #3575/#4377: planen er fortsat "completed"
    // (ikke udløbet endnu, kun 1 af fx 5 sæsoner kørt), men den AKTUELLE sæson er
    // lige startet (lav race_days_completed) — den gamle guard læste kun dette
    // tal og returnerede locked:false, selvom planen reelt havde flere sæsoner
    // tilbage af sin periode.
    const board = completedPlan({
      plan_type: planType,
      plan_start_season_number: 1,
      plan_end_season_number: planType === "5yr" ? 5 : 3,
      seasons_completed: 1,
    });
    const r = getBoardRenegotiationLock({ board, activeSeason: season(2, 27) }); // sæson 2, kun 2 løbsdage kørt
    assert.equal(r.locked, true);
    assert.equal(r.code, "BOARD_RENEGOTIATION_LOCKED_PLAN_ACTIVE");
    assert.equal(r.errorCode, "board_renegotiation_locked_plan_active");
    assert.deepEqual(r.errorParams, { planType });
  });

  test(`(a) aktiv ${planType}-plan er også låst ved sæsonstart (0 race-days kørt) — sæsonstart-undtagelsen gælder KUN 1yr`, () => {
    const board = completedPlan({ plan_type: planType });
    const r = getBoardRenegotiationLock({ board, activeSeason: season(0) });
    assert.equal(r.locked, true);
    assert.equal(r.code, "BOARD_RENEGOTIATION_LOCKED_PLAN_ACTIVE");
  });

  test(`(a) aktiv ${planType}-plan er låst uanset activeSeason (også null/manglende sæson)`, () => {
    const board = completedPlan({ plan_type: planType });
    assert.equal(getBoardRenegotiationLock({ board, activeSeason: null }).locked, true);
  });

  test(`(b) udløbet (pending) ${planType}-plan KAN gen-underskrives, selv tidligt i en ny sæson`, () => {
    const board = completedPlan({ plan_type: planType, negotiation_status: "pending" });
    const r = getBoardRenegotiationLock({ board, activeSeason: season(2, 27) });
    assert.equal(r.locked, false);
  });
}

test("(c) 1yr-plan er UÆNDRET af flerårs-låsen: sæsonstart passerer fortsat", () => {
  const r = getBoardRenegotiationLock({ board: completedPlan({ plan_type: "1yr" }), activeSeason: season(0) });
  assert.equal(r.locked, false);
});

test("(c) 1yr-plan er UÆNDRET af flerårs-låsen: same-sæson progress/vindue-reglerne gælder stadig", () => {
  const early = getBoardRenegotiationLock({ board: completedPlan({ plan_type: "1yr" }), activeSeason: season(2, 27) });
  assert.equal(early.locked, false);

  const late = getBoardRenegotiationLock({ board: completedPlan({ plan_type: "1yr" }), activeSeason: season(50) });
  assert.equal(late.locked, true);
  assert.equal(late.code, "BOARD_RENEGOTIATION_LOCKED_PROGRESS");
});

test("(d) et afvist forsøg (locked:true) mutér ikke det inputtede board-objekt", () => {
  // getBoardRenegotiationLock er en ren funktion — selve gate-beslutningen rører
  // aldrig board-rækkens tællere. Den faktiske garanti for at et AFVIST /board/sign-
  // kald ikke nulstiller seasons_completed/cumulative_*_wins ligger i at api.js
  // returnerer 409 FØR upsertData bygges (verificeret af kilde-scan-testen nedenfor) —
  // denne test låser blot at guarden selv er sideeffektfri.
  const board = completedPlan({
    plan_type: "5yr",
    seasons_completed: 3,
    cumulative_stage_wins: 7,
    cumulative_gc_wins: 2,
    plan_start_season_number: 1,
  });
  const snapshot = JSON.parse(JSON.stringify(board));
  const r = getBoardRenegotiationLock({ board, activeSeason: season(2, 27) });
  assert.equal(r.locked, true);
  assert.deepEqual(board, snapshot);
});

test("manglende/0 race_days_total → ikke låst (fail-open, ingen falsk blokering)", () => {
  assert.equal(getBoardRenegotiationLock({ board: completedPlan(), activeSeason: { race_days_total: 0, race_days_completed: 0 } }).locked, false);
  assert.equal(getBoardRenegotiationLock({ board: completedPlan(), activeSeason: null }).locked, false);
});

test("tærskel-konstant matcher forventet 50%", () => {
  assert.equal(RENEGOTIATION_SEASON_PROGRESS_LOCK_PCT, 50);
});

// #2512 · Regression: race_days_total/race_days_completed er nu distinkte
// kalender-løbsdage (~27-28 i en typisk sæson), IKKE SUM(stages) på tværs af
// divisioner (der tidligere gav fx 524 mod 60 — permanent WINDOW-lås, uanset
// faktiske løbsdage tilbage). Med den korrekte, lille enhed skal låsen
// reagere proportionalt med reelle løbsdage tilbage, ikke være evigt aktiv.
test("#2512: realistisk sæson-skala (~27 kalenderdage) — ikke låst tidligt med mange dage tilbage", () => {
  const r = getBoardRenegotiationLock({ board: completedPlan(), activeSeason: season(5, 27) }); // 22 dage tilbage, 18.5%
  assert.equal(r.locked, false);
});

test("#2512: realistisk sæson-skala — WINDOW-låst når ≤5 kalenderdage reelt er tilbage", () => {
  const r = getBoardRenegotiationLock({ board: completedPlan(), activeSeason: season(22, 27) }); // 5 dage tilbage
  assert.equal(r.locked, true);
  assert.equal(r.code, "BOARD_RENEGOTIATION_LOCKED_WINDOW");
});

test("#2512: gammel bug-signatur (524 completed / 60 total) ville have låst permanent — dokumenteret som IKKE længere den enhed vi bruger", () => {
  // Denne test dokumenterer selve enheds-bugget: hvis nogen nogensinde igen
  // fodrer funktionen med den gamle SUM(stages)-skala, låser den permanent,
  // fordi raceDaysLeft bliver negativ. Fixet ligger i at seasonRaceDays.js nu
  // SKRIVER begge felter i den lille, korrekte enhed — ikke i denne funktion.
  const r = getBoardRenegotiationLock({ board: completedPlan(), activeSeason: season(524, 60) });
  assert.equal(r.locked, true); // uundgåeligt for guarden selv — kilden er nu fixet i seasonRaceDays.js
});

// #4377 · DOKUMENTATION, ikke en fix: verificerer #4377's antagelse
// ("genforhandlings-låsen ændrer mål, ikke historik") mod #915-låsen — og
// antagelsen holder IKKE. Låsen ser kun på negotiation_status + sæson-progress
// (race_days_completed/total) for den IGANGVÆRENDE sæson. Den ved intet om
// hvor langt planen selv er nået (seasons_completed vs. planDuration), så en
// ALLEREDE SIGNERET, stadig-igangværende flerårsplan (fx sæson 2 af en 5yr-
// plan) kan gen-signeres tidligt i en ny sæson — /board/sign (api.js) nulstiller
// da ubetinget seasons_completed, cumulative_stage_wins/cumulative_gc_wins og
// plan_start_season_number for HELE planen, selvom planen ikke er udløbet.
// #3575 bekræfter at UI'et eksplicit lover en "reset" ved genforhandling, så
// dette kan være tilsigtet — men det modsiger #4377's antagelse om at kun mål
// (ikke historik) ændres. Ejer-beslutning krævet før dette ændres; ikke rettet
// i #4377 (se PR-body).
test("#4377 · en igangværende (ikke-udløbet) flerårsplan er IKKE låst tidligt i en NY sæson — genforhandling kan nulstille cumulative-historik", () => {
  const board = completedPlan({
    plan_type: "5yr",
    seasons_completed: 1, // planen er kun 1/5 sæsoner inde — langt fra udløb
    cumulative_stage_wins: 3,
    cumulative_gc_wins: 1,
  });
  const r = getBoardRenegotiationLock({ board, activeSeason: season(0) });
  assert.equal(
    r.locked, false,
    "låsen kender ikke plan-fremdrift (seasons_completed) — kun sæsonens egen race-day-progress"
  );
});

// ── (d) kilde-scan: signLock skal håndhæves FØR counter-reset i /board/sign ──
//
// Garanterer at et AFVIST forsøg (signLock.locked) aldrig når frem til
// upsertData-blokken der nulstiller seasons_completed/cumulative_*_wins/
// plan_start_season_number — uden at kræve en live DB/supertest-harness
// (samme kilde-scan-mønster som boardBankGuard.routes.test.js).

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

test("(d) /board/sign afviser (return) på signLock.locked FØR upsertData bygges", () => {
  const signIdx = apiSource.indexOf('router.post("/board/sign"');
  assert.ok(signIdx !== -1, "POST /board/sign skal findes");

  const signLockCallIdx = apiSource.indexOf("getBoardRenegotiationLock({ board: existingBoard, activeSeason })", signIdx);
  assert.ok(signLockCallIdx !== -1, "/board/sign skal kalde getBoardRenegotiationLock med existingBoard");

  const returnIdx = apiSource.indexOf("if (signLock.locked)", signLockCallIdx);
  assert.ok(returnIdx !== -1, "/board/sign skal tjekke signLock.locked");

  const upsertIdx = apiSource.indexOf("seasons_completed: 0,", signLockCallIdx);
  assert.ok(upsertIdx !== -1, "/board/sign skal nulstille seasons_completed i upsertData");

  // Guarden (og dens return) skal stå FØR counter-reset-blokken i kildeteksten —
  // ellers kunne et afvist forsøg stadig nå frem til upsert'en.
  assert.ok(returnIdx < upsertIdx, "signLock.locked-guarden skal stå FØR upsertData's counter-reset");
});

test("(d) /board/renew afviser (return) på renewLock.locked FØR negotiation_status sættes til pending", () => {
  const renewIdx = apiSource.indexOf('router.post("/board/renew"');
  assert.ok(renewIdx !== -1, "POST /board/renew skal findes");

  const renewLockCallIdx = apiSource.indexOf("getBoardRenegotiationLock({ board: existingBoard, activeSeason })", renewIdx);
  assert.ok(renewLockCallIdx !== -1, "/board/renew skal kalde getBoardRenegotiationLock med existingBoard");

  const returnIdx = apiSource.indexOf("if (renewLock.locked)", renewLockCallIdx);
  assert.ok(returnIdx !== -1, "/board/renew skal tjekke renewLock.locked");

  const updateIdx = apiSource.indexOf('negotiation_status: "pending"', renewLockCallIdx);
  assert.ok(updateIdx !== -1, "/board/renew skal sætte negotiation_status til pending");

  assert.ok(returnIdx < updateIdx, "renewLock.locked-guarden skal stå FØR negotiation_status-updaten");
});

// #4553 CodeRabbit-fund (PR-review): /board/renew returnerede kun error+code,
// ikke errorCode/errorParams — resolveApiError() (frontend) læser KUN
// errorCode/errorParams, så uden dem faldt EN-spillere tilbage til den danske
// `error`-råtekst. Samme { code, params }-kontrakt som /board/sign allerede
// bruger for denne guard skal gælde begge steder.
test("(d) /board/renew returnerer errorCode + errorParams (ikke kun error/code) på renewLock.locked", () => {
  const renewIdx = apiSource.indexOf('router.post("/board/renew"');
  assert.ok(renewIdx !== -1, "POST /board/renew skal findes");

  const returnIdx = apiSource.indexOf("if (renewLock.locked)", renewIdx);
  assert.ok(returnIdx !== -1, "/board/renew skal tjekke renewLock.locked");

  // Næste ~700 tegn efter selve if-blokken dækker res.status(409).json({...})
  // inkl. kommentarblokken der forklarer errorCode/errorParams-feltene.
  const responseBlock = apiSource.slice(returnIdx, returnIdx + 700);
  assert.match(responseBlock, /errorCode:\s*renewLock\.errorCode/, "/board/renew skal returnere renewLock.errorCode");
  assert.match(responseBlock, /errorParams:\s*renewLock\.errorParams/, "/board/renew skal returnere renewLock.errorParams");
});
