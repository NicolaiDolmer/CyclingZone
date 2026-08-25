import test from "node:test";
import assert from "node:assert/strict";
import { raceTimeWindow, raceBindingWindow, raceGameDaySpan, windowsOverlap, findRiderBindingConflicts, loadTeamBindingContext, findManualOverlapConflicts, teamInRacePool, mapRiderBindingDetails, classifyBindingConflicts, resolveBindingConflictDetails, isRiderDayInvariantViolation, isConstraintNotDeferrable } from "./raceBinding.js";

test("raceGameDaySpan: endagsløb → start===end fra game_day", () => {
  assert.deepEqual(raceGameDaySpan([{ game_day: 10, scheduled_at: "2026-07-04T13:00:00Z" }]), { start: 10, end: 10 });
});

test("raceGameDaySpan: etapeløb → første..sidste in-game-dag", () => {
  assert.deepEqual(raceGameDaySpan([{ game_day: 10 }, { game_day: 12 }, { game_day: 11 }]), { start: 10, end: 12 });
});

test("raceGameDaySpan: en række uden game_day → null (skjul mærket, vis ikke skrald)", () => {
  assert.equal(raceGameDaySpan([{ game_day: 10 }, { scheduled_at: "2026-07-04T13:00:00Z" }]), null);
});

test("raceGameDaySpan: tom/null → null", () => {
  assert.equal(raceGameDaySpan([]), null);
  assert.equal(raceGameDaySpan(null), null);
});

// B2 (#4075): monumenter har normal game_day — deres "Race day N"-mærke vises nu som
// alle andre løbs (#3107's sentinel-skjul er fjernet sammen med sentinelen).
test("raceGameDaySpan: monument med normal game_day → vises som alle andre endagsløb (#4075)", () => {
  assert.deepEqual(raceGameDaySpan([{ game_day: 6, scheduled_at: "2026-08-27T13:00:00Z" }]), { start: 6, end: 6 });
});

test("raceTimeWindow: start=tidligste, end=seneste etape", () => {
  const w = raceTimeWindow([
    { scheduled_at: "2026-06-23T10:30:00Z" },
    { scheduled_at: "2026-06-25T13:00:00Z" },
    { scheduled_at: "2026-06-24T13:00:00Z" },
  ]);
  assert.equal(w.start, Date.parse("2026-06-23T10:30:00Z"));
  assert.equal(w.end, Date.parse("2026-06-25T13:00:00Z"));
});

test("raceTimeWindow: tom/ugyldig → null", () => {
  assert.equal(raceTimeWindow([]), null);
  assert.equal(raceTimeWindow(null), null);
});

// raceBindingWindow (#1823): binding er pr. CET-KALENDERDAG, ikke pr. instant. Et
// endagsløb optager hele sin danske dag; et etapeløb optager fra første til sidste
// etapes danske dag. Rod-årsag for prod-dobbeltbookingen: instant-vinduer fik to
// samme-dag-løb (fx Hamburger 22:00 + La Corsa etape 1 23:00) til IKKE at overlappe.
test("raceBindingWindow: endagsløb spænder præcis én CET-dag (instant → hel dag)", () => {
  const w = raceBindingWindow([{ scheduled_at: "2026-06-23T20:00:00Z" }]); // 22:00 CEST
  assert.equal(w.start, w.end, "endagsløb = én dag");
});

test("raceBindingWindow: to løb samme CET-dag overlapper (regression for #1823)", () => {
  const hamburger = raceBindingWindow([{ scheduled_at: "2026-06-23T20:00:00Z" }]); // 22:00 CEST 23/6
  const laCorsa = raceBindingWindow([
    { scheduled_at: "2026-06-23T21:00:00Z" }, // 23:00 CEST etape 1, 23/6
    { scheduled_at: "2026-06-26T13:00:00Z" }, // etape 7, 26/6
  ]);
  assert.equal(windowsOverlap(hamburger, laCorsa), true, "samme-dag-løb bindes (må ikke dobbeltbookes)");
});

test("raceBindingWindow: etapeløb spænder fra første til sidste CET-dag", () => {
  const w = raceBindingWindow([
    { scheduled_at: "2026-06-23T21:00:00Z" },
    { scheduled_at: "2026-06-26T13:00:00Z" },
  ]);
  assert.equal(w.end - w.start, 3, "Jun23→Jun26 = 3 dages span");
});

test("raceBindingWindow: forskellige CET-dage overlapper ikke", () => {
  const jun23 = raceBindingWindow([{ scheduled_at: "2026-06-23T20:00:00Z" }]);
  const jun24 = raceBindingWindow([{ scheduled_at: "2026-06-24T20:00:00Z" }]);
  assert.equal(windowsOverlap(jun23, jun24), false);
});

test("raceBindingWindow: CET-midnatsgrænse (sommer) — 00:30 CEST hører til den danske dag, ikke UTC-dagen før", () => {
  const tidlig24 = raceBindingWindow([{ scheduled_at: "2026-06-23T22:30:00Z" }]); // 00:30 CEST 24/6
  const jun24 = raceBindingWindow([{ scheduled_at: "2026-06-24T12:00:00Z" }]);
  const jun23 = raceBindingWindow([{ scheduled_at: "2026-06-23T12:00:00Z" }]);
  assert.equal(windowsOverlap(tidlig24, jun24), true, "00:30 CEST = samme danske dag som middag 24/6");
  assert.equal(windowsOverlap(tidlig24, jun23), false, "00:30 CEST 24/6 ≠ 23/6");
});

test("raceBindingWindow: DST-robust — vinter-midnatsgrænse (CET=UTC+1)", () => {
  const tidlig16 = raceBindingWindow([{ scheduled_at: "2026-12-15T23:30:00Z" }]); // 00:30 CET 16/12
  const dec16 = raceBindingWindow([{ scheduled_at: "2026-12-16T12:00:00Z" }]);
  const dec15 = raceBindingWindow([{ scheduled_at: "2026-12-15T12:00:00Z" }]);
  assert.equal(windowsOverlap(tidlig16, dec16), true);
  assert.equal(windowsOverlap(tidlig16, dec15), false);
});

test("raceBindingWindow: tom/ugyldig → null", () => {
  assert.equal(raceBindingWindow([]), null);
  assert.equal(raceBindingWindow(null), null);
  assert.equal(raceBindingWindow([{ scheduled_at: "not-a-date" }]), null);
});

// Kalender-rebuild (2026-06-27): binding nøgler på IN-GAME løbsdagen (game_day) når den
// findes. Flere løb komprimeret til samme real-eftermiddag har forskellige game_day → en
// rytter må køre flere af dem (rod-årsag-fixet). Samme game_day → binder stadig.
test("raceBindingWindow: nøgler på game_day når den findes", () => {
  const w = raceBindingWindow([
    { scheduled_at: "2026-06-27T07:00:00Z", game_day: 5 },
    { scheduled_at: "2026-06-27T10:30:00Z", game_day: 9 },
  ]);
  assert.equal(w.start, 5);
  assert.equal(w.end, 9);
});

test("raceBindingWindow: samme real-dag, forskellig game_day overlapper IKKE (rod-årsag-fix)", () => {
  const a = raceBindingWindow([{ scheduled_at: "2026-06-27T07:00:00Z", game_day: 1 }]);
  const b = raceBindingWindow([{ scheduled_at: "2026-06-27T10:30:00Z", game_day: 2 }]);
  assert.equal(windowsOverlap(a, b), false, "forskellige in-game-dage → rytter må køre begge");
});

test("raceBindingWindow: samme game_day binder selv ved forskellige real-tider", () => {
  const a = raceBindingWindow([{ scheduled_at: "2026-06-27T07:00:00Z", game_day: 3 }]);
  const b = raceBindingWindow([{ scheduled_at: "2026-06-28T21:00:00Z", game_day: 3 }]);
  assert.equal(windowsOverlap(a, b), true, "samme in-game-dag → kun ét løb");
});

test("raceBindingWindow: fallback til CET-dag når game_day mangler (legacy rows)", () => {
  const jun23 = raceBindingWindow([{ scheduled_at: "2026-06-23T20:00:00Z" }]);
  const jun24 = raceBindingWindow([{ scheduled_at: "2026-06-24T20:00:00Z" }]);
  assert.equal(windowsOverlap(jun23, jun24), false);
  assert.equal(jun23.start, jun23.end);
});

test("raceBindingWindow: delvist-backfillet løb blander IKKE game_day + CET-ordinaler (CodeRabbit #2)", () => {
  // Ét løb med én række MED game_day + én UDEN → må ALDRIG give et [5, ~20000]-vindue.
  // Hele løbet falder tilbage til CET-dag (begge rækker = 27/6 → ét-dags vindue).
  const w = raceBindingWindow([
    { scheduled_at: "2026-06-27T07:00:00Z", game_day: 5 },
    { scheduled_at: "2026-06-27T10:30:00Z" }, // mangler game_day
  ]);
  assert.equal(w.start, w.end, "ét nøgle-rum → ét-dags vindue, ikke sæson-langt");
  assert.ok(w.end - w.start < 2, `vindue ${w.start}..${w.end} må ikke spænde sæson-langt`);
});

// #4217 (ejer 25/8): binding er HELE spændet fra første til sidste etape. #4173 gjorde
// den til mængden af faktisk kørte løbsdage, og det lod en rytter forlade et etapeløb
// midt i og køre et andet løb i springet (Julien Faure: Giro løbsdag 10-29 OG
// Milano-Riviera løbsdag 14). Springene er ikke hviledage — slot-tælleren løber videre
// for de øvrige løb i puljen, så La Corsa dei Due Mari kører 7 etaper på løbsdag
// 10, 13, 17, 20, 23, 27, 28 over 6 kalenderdage.
test("raceBindingWindow (#4217): days = hele spændet, ikke kun de kørte løbsdage", () => {
  const w = raceBindingWindow([
    { scheduled_at: "2026-08-25T09:00:00Z", game_day: 10 },
    { scheduled_at: "2026-08-25T12:00:00Z", game_day: 8 },
    { scheduled_at: "2026-08-26T09:00:00Z", game_day: 8 }, // dubleret dag-nøgle
    { scheduled_at: "2026-08-26T12:00:00Z", game_day: 13 },
  ]);
  assert.deepEqual(w.days, [8, 9, 10, 11, 12, 13]);
  assert.equal(w.start, 8);
  assert.equal(w.end, 13);
});

test("windowsOverlap (#4217): etapeløb binder OGSÅ springet — intet sidespring undervejs", () => {
  const emirats = raceBindingWindow(
    [8, 9, 10, 12, 13].map((d) => ({ scheduled_at: "2026-08-25T09:00:00Z", game_day: d }))
  );
  const endagsISpringet = raceBindingWindow([{ scheduled_at: "2026-08-28T09:00:00Z", game_day: 11 }]);
  assert.equal(windowsOverlap(emirats, endagsISpringet), true, "dag 11 ligger inde i løbet — bundet");
  const endagsPaaDag12 = raceBindingWindow([{ scheduled_at: "2026-08-29T09:00:00Z", game_day: 12 }]);
  assert.equal(windowsOverlap(emirats, endagsPaaDag12), true, "dag 12 køres faktisk — bundet");
  // Uden for spændet er rytteren fri — bindingen vokser ikke ud over løbet selv.
  const endagsEfter = raceBindingWindow([{ scheduled_at: "2026-08-30T09:00:00Z", game_day: 14 }]);
  assert.equal(windowsOverlap(emirats, endagsEfter), false, "dag 14 er efter løbet — fri");
});

test("windowsOverlap (#4173): spænd-fallback når days mangler (manuelt byggede vinduer)", () => {
  assert.equal(windowsOverlap({ start: 4, end: 8 }, { start: 5, end: 5 }), true);
  const medDays = raceBindingWindow([{ scheduled_at: "2026-08-25T09:00:00Z", game_day: 5 }]);
  // Én side uden days → spænd-semantik (defensivt: gamle payloads/tests må ikke ændre dom).
  assert.equal(windowsOverlap({ start: 4, end: 8 }, medDays), true);
});

test("windowsOverlap: deler tidspunkt → true; adskilte → false", () => {
  const a = { start: 100, end: 200 };
  assert.equal(windowsOverlap(a, { start: 150, end: 300 }), true);  // overlap
  assert.equal(windowsOverlap(a, { start: 200, end: 400 }), true);  // rører ved enden
  assert.equal(windowsOverlap(a, { start: 201, end: 400 }), false); // adskilt
  assert.equal(windowsOverlap(a, null), false);
});

test("findRiderBindingConflicts: rytter i tidsoverlappende løb flagges", () => {
  const thisWindow = { start: 100, end: 200 };
  const otherRaces = [
    { window: { start: 150, end: 250 }, riderIds: ["r1", "r2"] }, // overlapper
    { window: { start: 400, end: 500 }, riderIds: ["r3"] },        // overlapper IKKE
  ];
  const conflicts = findRiderBindingConflicts({ riderIds: ["r1", "r3", "r4"], thisWindow, otherRaces });
  assert.deepEqual(conflicts.sort(), ["r1"]); // r1 bundet; r3 i ikke-overlappende; r4 fri
});

test("findRiderBindingConflicts: intet vindue → ingen konflikter", () => {
  assert.deepEqual(findRiderBindingConflicts({ riderIds: ["r1"], thisWindow: null, otherRaces: [] }), []);
});

// Mock-supabase: svarer pr. tabel; ignorerer filtre (testen verificerer kombinations-
// logikken, ikke query-filtrene). Mønster fra raceFatigue.test.js.
// Loaderen (#1906) henter nu riders til eligibility-krydsning: default returnerer
// alle entry-ryttere som berettigede (team_id=teamId, ej akademi/pensioneret).
// ghostRiderIds gør specifikke ryttere ubrettigede.
// raceSeasonById (#3070): valgfri map race_id→season_id til "races"-opslaget
// loadTeamBindingContext bruger til sæson-filtret. Udeladt (null) → "races"-tabellen
// svarer tomt, ligesom før #3070; season_id bliver undefined på begge sider af
// sammenligningen i loaderen, så eksisterende tests (der ikke sætter season_id på
// hverken race eller entries) er upåvirkede.
// #3114b: raceLeagueDivisionById udvider den eksisterende "races"-sæson-opslagsgren
// (id, season_id → nu + league_division_id). seasonRaces dækker den NYE
// .eq("season_id", ...)-gren (uden .in("id", ...)) som loadPoolLocalCetSpans bruger til
// at bygge det pulje-lokale monument-indeks — separat fra otherRaceIds-opslaget ovenfor.
function makeSupabase({ scheduleByRace = {}, teamEntries = [], withdrawnRaceIds = [], teamId = "team-1", ghostRiderIds = [], raceSeasonById = null, raceLeagueDivisionById = null, seasonRaces = null } = {}) {
  function from(table) {
    const f = {};
    const b = {
      select() { return b; },
      eq(col, val) { f[col] = val; return b; },
      neq(col, val) { f["neq_" + col] = val; return b; },
      in(col, vals) { f["in_" + col] = vals; return b; },
      then(resolve, reject) {
        let data = [];
        if (table === "race_stage_schedule") {
          if (f.race_id) data = scheduleByRace[f.race_id] || [];
          else if (f.in_race_id) data = f.in_race_id.flatMap((id) => scheduleByRace[id] || []);
        } else if (table === "race_entries") {
          // Loaderens baseQuery henter entries med team_id; stamp det så eligibility-
          // krydsningen (entry.team_id vs rider.team_id) matcher som i prod.
          data = teamEntries.map((e) => ({ team_id: teamId, ...e }));
        } else if (table === "riders") {
          // Entry-ryttere: berettigede som default; ghosts markeres off-team (team_id=null).
          const ids = f.in_id || [];
          data = ids.map((id) => ({
            id, team_id: ghostRiderIds.includes(id) ? null : teamId, is_academy: false, is_retired: false,
          }));
        } else if (table === "race_withdrawals") {
          data = withdrawnRaceIds.map((race_id) => ({ race_id }));
        } else if (table === "races") {
          if (f.in_id && raceSeasonById) {
            const ids = f.in_id || [];
            data = ids.map((id) => ({
              id, season_id: raceSeasonById[id] ?? null,
              league_division_id: raceLeagueDivisionById?.[id] ?? null,
            }));
          } else if (f.season_id !== undefined && seasonRaces) {
            data = seasonRaces;
          }
        }
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  return { from };
}

test("loadTeamBindingContext: bygger thisWindow + otherRaces grupperet pr. løb", async () => {
  const supabase = makeSupabase({
    scheduleByRace: {
      "race-this": [{ race_id: "race-this", scheduled_at: "2026-06-23T10:30:00Z" }],
      "race-a": [
        { race_id: "race-a", scheduled_at: "2026-06-23T13:00:00Z" },
        { race_id: "race-a", scheduled_at: "2026-06-24T13:00:00Z" },
      ],
    },
    teamEntries: [
      { race_id: "race-a", rider_id: "r1" },
      { race_id: "race-a", rider_id: "r2" },
    ],
  });
  // Binding-vinduer er CET-dag-ordinaler (#1823), ikke ms.
  const ORD = (d) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  const ctx = await loadTeamBindingContext({ supabase, race: { id: "race-this" }, teamId: "team-1" });
  assert.equal(ctx.thisWindow.start, ORD("2026-06-23")); // 10:30Z = 12:30 CEST 23/6
  assert.equal(ctx.otherRaces.length, 1);
  assert.equal(ctx.otherRaces[0].window.end, ORD("2026-06-24")); // sidste etape 13:00Z = 15:00 CEST 24/6
  assert.deepEqual(ctx.otherRaces[0].riderIds.sort(), ["r1", "r2"]);
});

// Rod A (#1823): et afmeldt løb binder IKKE — dets ryttere er frie til det
// overlappende løb. Tidligere blev afmeldte løbs entries stadig regnet som binding,
// så "afmeld frigør ikke låsen" (testere @friisisch/@zootne, 2026-06-25).
test("loadTeamBindingContext: afmeldt løb udelades fra otherRaces (frigør binding)", async () => {
  const supabase = makeSupabase({
    scheduleByRace: {
      "race-this": [{ race_id: "race-this", scheduled_at: "2026-06-23T10:30:00Z" }],
      "race-a": [{ race_id: "race-a", scheduled_at: "2026-06-23T13:00:00Z" }], // samme dag → overlapper
    },
    teamEntries: [
      { race_id: "race-a", rider_id: "r1" },
      { race_id: "race-a", rider_id: "r2" },
    ],
    withdrawnRaceIds: ["race-a"], // holdet har trukket sig fra race-a
  });
  const ctx = await loadTeamBindingContext({ supabase, race: { id: "race-this" }, teamId: "team-1" });
  assert.deepEqual(ctx.otherRaces, [], "afmeldt race-a binder ikke");
  assert.deepEqual(findRiderBindingConflicts({ riderIds: ["r1", "r2"], thisWindow: ctx.thisWindow, otherRaces: ctx.otherRaces }), [],
    "r1/r2 er frie til race-this efter afmelding af race-a");
});

// #1906/#1823 rod-årsag: en ghost-entry (rytter solgt/fyret efter udtagelse) må IKKE
// phantom-binde. Tidligere læste loadTeamBindingContext rå entries → den ægte rytter
// blev rapporteret bundet → PUT /selection afviste med 409.
test("loadTeamBindingContext: ghost-entries phantom-binder ikke (rod-årsag)", async () => {
  const supabase = makeSupabase({
    scheduleByRace: {
      "race-this": [{ race_id: "race-this", scheduled_at: "2026-06-23T10:30:00Z" }],
      "race-a": [{ race_id: "race-a", scheduled_at: "2026-06-23T13:00:00Z" }], // samme dag → overlapper
    },
    teamEntries: [
      { race_id: "race-a", rider_id: "r1" }, // gyldig
      { race_id: "race-a", rider_id: "ghost" }, // solgt/fyret efter udtagelse
    ],
    ghostRiderIds: ["ghost"],
  });
  const ctx = await loadTeamBindingContext({ supabase, race: { id: "race-this" }, teamId: "team-1" });
  assert.equal(ctx.otherRaces.length, 1);
  assert.deepEqual(ctx.otherRaces[0].riderIds, ["r1"], "kun den gyldige rytter binder; ghost droppet");
  // ghost er fri til race-this (ingen falsk 409).
  assert.deepEqual(
    findRiderBindingConflicts({ riderIds: ["ghost"], thisWindow: ctx.thisWindow, otherRaces: ctx.otherRaces }),
    [], "ghost-rytter er fri til det overlappende løb");
});

// #3070 rod-årsag: game_day er SÆSON-RELATIV og nulstilles hver sæson (S1 og S2
// spænder i prod begge game_day 0..~100000). Uden sæson-filter binder en sæson-1-
// entry på game_day 4 et sæson-2-løb der spænder game_day 0-6, fordi vinduerne
// (nøglet på samme tal-rum) fremstår overlappende. 102/156 ægte hold ramt i prod.
test("loadTeamBindingContext: entry fra en ANDEN sæson binder ikke, selvom game_day overlapper (#3070)", async () => {
  const supabase = makeSupabase({
    scheduleByRace: {
      "race-this": [ // S2-etapeløb, game_day 0-6
        { race_id: "race-this", game_day: 0 },
        { race_id: "race-this", game_day: 6 },
      ],
      "race-s1": [{ race_id: "race-s1", game_day: 4 }], // S1-løb, SAMME game_day, anden sæson
    },
    teamEntries: [{ race_id: "race-s1", rider_id: "r1" }],
    raceSeasonById: { "race-s1": "season-1" },
  });
  const ctx = await loadTeamBindingContext({
    supabase, race: { id: "race-this", season_id: "season-2" }, teamId: "team-1",
  });
  assert.deepEqual(ctx.otherRaces, [], "sæson-1-entryen må ikke dukke op som binding for et sæson-2-løb");
  assert.deepEqual(
    findRiderBindingConflicts({ riderIds: ["r1"], thisWindow: ctx.thisWindow, otherRaces: ctx.otherRaces }),
    [], "r1 skal være fri til at udtages i race-this på tværs af sæsongrænsen"
  );
});

// B2 (#4075): monumenter har normal game_day — de binder via raceBindingWindow som alle
// andre løb; det afledte pulje-lokale monument-vindue (#3114b) er fjernet.
test("loadTeamBindingContext: monument med normal game_day binder direkte via raceBindingWindow (#4075)", async () => {
  const supabase = makeSupabase({
    scheduleByRace: {
      "race-monument": [{ race_id: "race-monument", scheduled_at: "2026-07-29T17:00:00Z", game_day: 4 }],
      "race-a": [
        { race_id: "race-a", scheduled_at: "2026-07-29T08:00:00Z", game_day: 3 },
        { race_id: "race-a", scheduled_at: "2026-07-30T15:00:00Z", game_day: 4 },
      ],
    },
    teamEntries: [{ race_id: "race-a", rider_id: "r1" }],
    raceSeasonById: { "race-a": "s1" },
    seasonRaces: [
      { id: "race-monument", league_division_id: 1 },
      { id: "race-a", league_division_id: 1 },
    ],
  });
  const ctx = await loadTeamBindingContext({
    supabase, race: { id: "race-monument", season_id: "s1", league_division_id: 1 }, teamId: "team-1",
  });
  assert.deepEqual(ctx.thisWindow, { start: 4, end: 4, days: [4] }, "monumentets EGEN game_day, ingen afledning");
  const bound = findRiderBindingConflicts({ riderIds: ["r1"], thisWindow: ctx.thisWindow, otherRaces: ctx.otherRaces });
  assert.deepEqual(bound, ["r1"], "r1 er bundet: race-a har en etape på monumentets løbsdag (gd 4)");
});

test("loadTeamBindingContext: monument på EKSKLUSIV game_day → ingen konflikt med løb på andre løbsdage (#4075)", async () => {
  const supabase = makeSupabase({
    scheduleByRace: {
      "race-monument": [{ race_id: "race-monument", scheduled_at: "2026-07-29T17:00:00Z", game_day: 5 }],
      "race-a": [
        { race_id: "race-a", scheduled_at: "2026-07-29T08:00:00Z", game_day: 3 },
        { race_id: "race-a", scheduled_at: "2026-07-29T15:00:00Z", game_day: 4 },
      ],
    },
    teamEntries: [{ race_id: "race-a", rider_id: "r1" }],
    raceSeasonById: { "race-a": "s1" },
    seasonRaces: [
      { id: "race-monument", league_division_id: 1 },
      { id: "race-a", league_division_id: 1 },
    ],
  });
  const ctx = await loadTeamBindingContext({
    supabase, race: { id: "race-monument", season_id: "s1", league_division_id: 1 }, teamId: "team-1",
  });
  assert.deepEqual(ctx.thisWindow, { start: 5, end: 5, days: [5] });
  assert.deepEqual(findRiderBindingConflicts({ riderIds: ["r1"], thisWindow: ctx.thisWindow, otherRaces: ctx.otherRaces }), [],
    "r1 er FRI: monumentets løbsdag (gd 5) er eksklusiv og race-a slutter gd 4");
});

test("findManualOverlapConflicts: ingen konflikt når vinduer ikke overlapper", () => {
  const entries = [
    { race_id: "A", rider_id: "r1" },
    { race_id: "B", rider_id: "r1" },
  ];
  const windowByRace = new Map([
    ["A", { start: 100, end: 200 }],
    ["B", { start: 300, end: 400 }],
  ]);
  assert.deepEqual(findManualOverlapConflicts({ entries, windowByRace }), []);
});

test("findManualOverlapConflicts: samme rytter i to overlappende løb → drop det senere", () => {
  const entries = [
    { race_id: "A", rider_id: "r1" },
    { race_id: "B", rider_id: "r1" },
  ];
  const windowByRace = new Map([
    ["A", { start: 100, end: 300 }],
    ["B", { start: 200, end: 400 }], // overlapper A
  ]);
  const conflicts = findManualOverlapConflicts({ entries, windowByRace });
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0], { rider_id: "r1", keepRaceId: "A", dropRaceId: "B" });
});

test("findManualOverlapConflicts: forskellige ryttere giver ingen konflikt", () => {
  const entries = [
    { race_id: "A", rider_id: "r1" },
    { race_id: "B", rider_id: "r2" },
  ];
  const windowByRace = new Map([
    ["A", { start: 100, end: 300 }],
    ["B", { start: 200, end: 400 }],
  ]);
  assert.deepEqual(findManualOverlapConflicts({ entries, windowByRace }), []);
});

test("findManualOverlapConflicts: løb uden vindue ignoreres", () => {
  const entries = [
    { race_id: "A", rider_id: "r1" },
    { race_id: "B", rider_id: "r1" },
  ];
  const windowByRace = new Map([["A", { start: 100, end: 300 }]]); // B mangler vindue
  assert.deepEqual(findManualOverlapConflicts({ entries, windowByRace }), []);
});

test("loadTeamBindingContext: ingen andre entries → tom otherRaces", async () => {
  const supabase = makeSupabase({
    scheduleByRace: { "race-this": [{ race_id: "race-this", scheduled_at: "2026-06-23T10:30:00Z" }] },
    teamEntries: [],
  });
  const ctx = await loadTeamBindingContext({ supabase, race: { id: "race-this" }, teamId: "team-1" });
  assert.deepEqual(ctx.otherRaces, []);
});

// Race-hub pulje-binding (#1798-opfølgning): et hold må kun være i feltet for et løb
// i sin EGEN pulje. Komplementerer rytter-bindingen (rytter↔tid) ovenfor med
// hold↔pulje. Pure spejling af autofill-pulje-filteret (raceRunner.js: racePoolId).
test("teamInRacePool: samme pulje → true", () => {
  assert.equal(teamInRacePool({ teamDivisionId: 4, racePoolId: 4 }), true);
});

test("teamInRacePool: anden pulje → false", () => {
  assert.equal(teamInRacePool({ teamDivisionId: 5, racePoolId: 4 }), false);
});

test("teamInRacePool: løb uden pulje (racePoolId null) → true (ingen restriktion, jf. autofill)", () => {
  assert.equal(teamInRacePool({ teamDivisionId: 4, racePoolId: null }), true);
  assert.equal(teamInRacePool({ teamDivisionId: null, racePoolId: null }), true);
});

test("teamInRacePool: hold uden pulje men løb har pulje → false", () => {
  assert.equal(teamInRacePool({ teamDivisionId: null, racePoolId: 4 }), false);
});

// #2265: mapRiderBindingDetails — hvilket løb binder hver rytter (til "optaget i <løbsnavn>").
test("mapRiderBindingDetails: rytter → første overlappende løb; ikke-overlap tæller ikke", () => {
  const details = mapRiderBindingDetails({
    riderIds: ["r1", "r2", "r3"],
    thisWindow: { start: 10, end: 11 },
    otherRaces: [
      { raceId: "race-a", window: { start: 11, end: 12 }, riderIds: ["r1"] },   // overlap
      { raceId: "race-b", window: { start: 20, end: 21 }, riderIds: ["r2"] },   // ingen overlap
      { raceId: "race-c", window: { start: 10, end: 10 }, riderIds: ["r1", "r3"] }, // overlap
    ],
  });
  assert.equal(details.get("r1"), "race-a", "første overlappende løb vinder (deterministisk)");
  assert.equal(details.has("r2"), false, "ikke-overlappende løb binder ikke");
  assert.equal(details.get("r3"), "race-c");
});

test("mapRiderBindingDetails: intet vindue for dette løb → tom map", () => {
  const details = mapRiderBindingDetails({
    riderIds: ["r1"], thisWindow: null,
    otherRaces: [{ raceId: "race-a", window: { start: 1, end: 1 }, riderIds: ["r1"] }],
  });
  assert.equal(details.size, 0);
});

test("mapRiderBindingDetails: kun ønskede riderIds medtages", () => {
  const details = mapRiderBindingDetails({
    riderIds: ["r1"], thisWindow: { start: 5, end: 5 },
    otherRaces: [{ raceId: "race-a", window: { start: 5, end: 6 }, riderIds: ["r1", "ghost"] }],
  });
  assert.deepEqual([...details.keys()], ["r1"]);
});

// #2637: classifyBindingConflicts — omfordeling fra et auto-udtaget endagsløb til et
// manuelt valgt etapeløb. Auto-genereret + ikke-startet løb → løsbar (frigives
// automatisk af kalderen); manuel entry ELLER allerede-startet løb → blocking (navngivet
// fejl til spilleren).
test("classifyBindingConflicts: auto-genereret + ikke-startet løb → resolvable", () => {
  const details = new Map([["r1", "race-a"]]);
  const raceMetaById = new Map([["race-a", { name: "Volta", stages_completed: 0 }]]);
  const autoFilledKeys = new Set(["race-a|r1"]);
  const riderNameById = new Map([["r1", "Rider One"]]);
  const { resolvable, blocking } = classifyBindingConflicts({
    boundRiderIds: ["r1"], details, raceMetaById, autoFilledKeys, riderNameById,
  });
  assert.equal(blocking.length, 0);
  assert.equal(resolvable.length, 1);
  assert.deepEqual(resolvable[0], { rider_id: "r1", rider_name: "Rider One", race_id: "race-a", race_name: "Volta" });
});

test("classifyBindingConflicts: MANUEL entry (ikke auto-genereret) → blocking, navngivet", () => {
  const details = new Map([["r1", "race-a"]]);
  const raceMetaById = new Map([["race-a", { name: "Volta", stages_completed: 0 }]]);
  const autoFilledKeys = new Set(); // ingen auto-filled-markering → manuel entry
  const riderNameById = new Map([["r1", "Rider One"]]);
  const { resolvable, blocking } = classifyBindingConflicts({
    boundRiderIds: ["r1"], details, raceMetaById, autoFilledKeys, riderNameById,
  });
  assert.equal(resolvable.length, 0);
  assert.equal(blocking.length, 1);
  assert.deepEqual(blocking[0], { rider_id: "r1", rider_name: "Rider One", race_id: "race-a", race_name: "Volta" });
});

test("classifyBindingConflicts: auto-genereret men løbet ER startet → blocking (frys respekteres)", () => {
  const details = new Map([["r1", "race-a"]]);
  const raceMetaById = new Map([["race-a", { name: "Volta", stages_completed: 2 }]]);
  const autoFilledKeys = new Set(["race-a|r1"]);
  const { resolvable, blocking } = classifyBindingConflicts({
    boundRiderIds: ["r1"], details, raceMetaById, autoFilledKeys,
  });
  assert.equal(resolvable.length, 0);
  assert.equal(blocking.length, 1);
});

test("classifyBindingConflicts: blandet — nogle løsbare, nogle blocking, klassificeres uafhængigt", () => {
  const details = new Map([["r1", "race-a"], ["r2", "race-b"]]);
  const raceMetaById = new Map([
    ["race-a", { name: "Volta", stages_completed: 0 }],
    ["race-b", { name: "Roubaix", stages_completed: 0 }],
  ]);
  const autoFilledKeys = new Set(["race-a|r1"]); // r2 er manuel i race-b
  const { resolvable, blocking } = classifyBindingConflicts({
    boundRiderIds: ["r1", "r2"], details, raceMetaById, autoFilledKeys,
  });
  assert.deepEqual(resolvable.map((r) => r.rider_id), ["r1"]);
  assert.deepEqual(blocking.map((r) => r.rider_id), ["r2"]);
});

// #3098: resolveBindingConflictDetails — fælles DB-opslag+klassifikation for PUT
// /selection's pre-flight-tjek OG dens replace_race_selection-RPC-fallback (catch-
// blokken, api.js). Rod-årsag: RPC-fallbacken svarede FØR uden rytter/løb-navn (kun
// {error: "selection_rider_bound"}), selvom races.json's navngivne copy
// ("selection_rider_bound_named") allerede findes og bruges af pre-flight-vejen —
// frontend faldt derfor tilbage til den generiske, ikke-navngivne besked.
function makeConflictDetailsSupabase({ races = [], entries = [] } = {}) {
  function from(table) {
    const f = {};
    const b = {
      select() { return b; },
      eq(col, val) { f[col] = val; return b; },
      in(col, vals) { f["in_" + col] = vals; return b; },
      then(resolve, reject) {
        let data = [];
        if (table === "races") {
          const ids = f.in_id || [];
          data = races.filter((r) => ids.includes(r.id));
        } else if (table === "race_entries") {
          const raceIds = f.in_race_id || [];
          const riderIds = f.in_rider_id || [];
          data = entries.filter(
            (e) => e.team_id === f.team_id && raceIds.includes(e.race_id) && riderIds.includes(e.rider_id)
          );
        }
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  return { from };
}

test("resolveBindingConflictDetails: auto-genereret + ikke-startet konfliktløb → resolvable med rytter-/løbsnavn", async () => {
  const supabase = makeConflictDetailsSupabase({
    races: [{ id: "race-a", name: "Volta", stages_completed: 0 }],
    entries: [{ team_id: "team-1", race_id: "race-a", rider_id: "r1", is_auto_filled: true }],
  });
  const { resolvable, blocking } = await resolveBindingConflictDetails({
    supabase, teamId: "team-1", boundRiderIds: ["r1"],
    thisWindow: { start: 5, end: 5 },
    otherRaces: [{ raceId: "race-a", window: { start: 5, end: 6 }, riderIds: ["r1"] }],
    riders: [{ id: "r1", name: "Rider One" }],
  });
  assert.equal(blocking.length, 0);
  assert.deepEqual(resolvable, [{ rider_id: "r1", rider_name: "Rider One", race_id: "race-a", race_name: "Volta" }]);
});

// Dette er den nøjagtige situation fra #3098: TOCTOU-taberen rammer RPC-fallbacken (ikke
// pre-flight), og payloaden skal STADIG bære rytter-/løbsnavn — ikke kun fejlkoden.
test("resolveBindingConflictDetails: manuel entry i et allerede-startet løb → blocking, navngivet (RPC-fallback-scenariet, #3098)", async () => {
  const supabase = makeConflictDetailsSupabase({
    races: [{ id: "race-b", name: "Roubaix", stages_completed: 2 }],
    entries: [], // ingen is_auto_filled-række → manuel entry
  });
  const { resolvable, blocking } = await resolveBindingConflictDetails({
    supabase, teamId: "team-1", boundRiderIds: ["r9"],
    thisWindow: { start: 5, end: 5 },
    otherRaces: [{ raceId: "race-b", window: { start: 5, end: 6 }, riderIds: ["r9"] }],
    riders: [{ id: "r9", name: "Rider Nine" }],
  });
  assert.equal(resolvable.length, 0);
  assert.deepEqual(blocking, [{ rider_id: "r9", rider_name: "Rider Nine", race_id: "race-b", race_name: "Roubaix" }]);
});

test("resolveBindingConflictDetails: ingen bundne ryttere → tomme resolvable/blocking, ingen DB-opslag nødvendigt", async () => {
  const supabase = makeConflictDetailsSupabase();
  const { resolvable, blocking } = await resolveBindingConflictDetails({
    supabase, teamId: "team-1", boundRiderIds: [], thisWindow: { start: 5, end: 5 }, otherRaces: [], riders: [],
  });
  assert.deepEqual(resolvable, []);
  assert.deepEqual(blocking, []);
});

// #3420: DB-backstoppet (no_rider_double_booking, EXCLUDE USING gist) afviser med
// SQLSTATE 23P01 — kaldere af et RÅT race_entries.insert/upsert (raceEntryGenerator.js,
// raceRunner.js, api.js's auto-select + regenerate) bruger dette til at give en
// navngiven fejl i stedet for en opak 500 (#3098-mønsteret).
test("isRiderDayInvariantViolation: genkender Postgres' exclusion_violation (23P01)", () => {
  assert.equal(isRiderDayInvariantViolation({ code: "23P01", message: "conflicting key value" }), true);
});

test("isRiderDayInvariantViolation: genkender fejlbesked via constraint-navn (fallback uden .code)", () => {
  assert.equal(
    isRiderDayInvariantViolation({ message: 'duplicate key value violates exclusion constraint "no_rider_double_booking"' }),
    true
  );
});

test("isRiderDayInvariantViolation: false for andre fejl / null", () => {
  assert.equal(isRiderDayInvariantViolation({ code: "23505", message: "duplicate key value violates unique constraint" }), false);
  assert.equal(isRiderDayInvariantViolation({ message: "connection reset" }), false);
  assert.equal(isRiderDayInvariantViolation(null), false);
  assert.equal(isRiderDayInvariantViolation(undefined), false);
});

// #4163 (prod 24/8): #4155-reparationen genskabte no_rider_double_booking uden
// `deferrable`, så batch-RPC'ens `set constraints ... deferred` fejlede med 42809.
// Beskeden INDEHOLDER constraint-navnet og blev derfor laest som en aegte
// dobbeltbooking — den stik modsatte diagnose. Detektoren skal skelne.
test("isConstraintNotDeferrable: genkender Postgres' 42809 (SET CONSTRAINTS paa ikke-deferrable)", () => {
  assert.equal(
    isConstraintNotDeferrable({ code: "42809", message: 'constraint "no_rider_double_booking" is not deferrable' }),
    true
  );
});

// #4173: invarianten flyttede fra EXCLUDE på race_entries.binding_span (23P01) til
// UNIQUE på race_entry_days (23505) — et SPÆND bandt også de dage et løb holdt pause.
test("isRiderDayInvariantViolation: genkender den nye dag-constraint (23505 + navn)", () => {
  assert.equal(
    isRiderDayInvariantViolation({
      code: "23505",
      message: 'duplicate key value violates unique constraint "no_rider_double_booking_day"',
    }),
    true
  );
});

test("isConstraintNotDeferrable: genkender via besked uden .code", () => {
  assert.equal(
    isConstraintNotDeferrable({ message: 'constraint "no_rider_double_booking" is not deferrable' }),
    true
  );
});

test("isConstraintNotDeferrable: false for aegte dobbeltbooking + andre fejl", () => {
  assert.equal(isConstraintNotDeferrable({ code: "23P01", message: "conflicting key value" }), false);
  assert.equal(isConstraintNotDeferrable({ message: "connection reset" }), false);
  assert.equal(isConstraintNotDeferrable(null), false);
});

// Praecis den forvekslings-faelde bugget bestod af: 42809-beskeden matcher
// isRiderDayInvariantViolation's navne-fallback, saa raekkefoelgen af de to tjek
// er en invariant, ikke en detalje.
test("42809-beskeden matcher OGSAA isRiderDayInvariantViolation — derfor tjekkes not-deferrable FOERST", () => {
  const err = { code: "42809", message: 'constraint "no_rider_double_booking" is not deferrable' };
  assert.equal(isRiderDayInvariantViolation(err), true);
  assert.equal(isConstraintNotDeferrable(err), true);
});

test("isRiderDayInvariantViolation: 23505 fra ANDRE unique-constraints er IKKE et dagbrud", () => {
  // race_entries' egen PK og uq_race_entries_*-rolleslottene (CYCLINGZONE-2D) giver
  // samme SQLSTATE. Et almindeligt dublet-insert må ikke rapporteres som "rytteren er
  // bundet" — så ville generatoren give brugeren en forkert navngiven fejl.
  for (const navn of ["race_entries_pkey", "uq_race_entries_captain", "uq_race_entries_sprint_captain"]) {
    assert.equal(
      isRiderDayInvariantViolation({
        code: "23505",
        message: `duplicate key value violates unique constraint "${navn}"`,
      }),
      false,
      `${navn} må ikke tælle som dagbrud`
    );
  }
});

test("isRiderDayInvariantViolation: navne-fallback dækker begge constraint-navne", () => {
  assert.equal(
    isRiderDayInvariantViolation({ message: 'violates unique constraint "no_rider_double_booking_day"' }),
    true
  );
  assert.equal(
    isRiderDayInvariantViolation({ message: 'violates exclusion constraint "no_rider_double_booking"' }),
    true
  );
});
