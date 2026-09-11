// #5133 forward-guard: detektionen og vagten skal vælge de SAMME ryttere.
//
// BAGGRUNDEN. En akademirytter faldt ud af graduerings-flowet 23/8 og stod
// stille i næsten fem uger. Rod-årsagen kunne ikke fastslås, men undersøgelsen
// afdækkede ÉN reel divergens mellem de to prædikater:
//
//   detectGraduates (academyGraduation.js):        is_academy, is_retired
//   findStuckAcademyGraduates (vagten):            is_academy, is_retired, team_id NOT NULL
//
// `academy_graduation.team_id` er NOT NULL i skemaet, så en akademi-fri-agent
// (team_id NULL — invariant D's klasse, #2257) ville få sin insert afvist,
// detectGraduates ville kaste, og HELE resten af batchen mistede lydløst sit
// override-vindue. To prædikater der beskriver "samme rytter" og alligevel
// divergerer er præcis den fejlklasse #4495 allerede betalte for, og derfor
// ejer stuckAcademyGraduates.js prædikatet for vagten + reparations-scriptet.
//
// Denne test låser den tredje konsument — sæson-transitionens detektion — til
// samme adfærd. Den tester BEGGE lag:
//   1. Query-laget: nøjagtig samme filtre sendes til PostgREST.
//   2. Udfalds-laget: samme rytter-population ind → samme ryttere ud.
// Lag 2 alene ville ikke fange en divergens der først viser sig i prod-data;
// lag 1 alene ville ikke fange en divergens i aldersformlen.

import test from "node:test";
import assert from "node:assert/strict";

import { detectGraduates } from "./academyGraduation.js";
import { findStuckAcademyGraduates } from "./stuckAcademyGraduates.js";

const SEASON = { id: "s3", number: 3 };
const NOW = new Date("2026-09-11T08:00:00.000Z");
// ageForSeason(birthdate, 3) = 2026 + 2 − fødselsår.
const bornForSeason3Age = (age) => `${2028 - age}-10-25`;

// Én population, begge prædikater. Hver række bærer ALLE kolonner begge sider
// filtrerer på, så mocken kan håndhæve filtrene ærligt.
const POPULATION = [
  { id: "r-20", team_id: "t1", ai_team_id: null, firstname: "Too", lastname: "Young", is_academy: true, is_retired: false, birthdate: bornForSeason3Age(20) },
  { id: "r-21", team_id: "t1", ai_team_id: null, firstname: "Last", lastname: "Year", is_academy: true, is_retired: false, birthdate: bornForSeason3Age(21) },
  { id: "r-22", team_id: "t1", ai_team_id: null, firstname: "Aged", lastname: "Out", is_academy: true, is_retired: false, birthdate: bornForSeason3Age(22) },
  { id: "r-23", team_id: "t2", ai_team_id: "ai1", firstname: "Long", lastname: "Overdue", is_academy: true, is_retired: false, birthdate: bornForSeason3Age(23) },
  { id: "r-stranded", team_id: null, ai_team_id: null, firstname: "Stranded", lastname: "Agent", is_academy: true, is_retired: false, birthdate: bornForSeason3Age(24) },
  { id: "r-retired", team_id: "t1", ai_team_id: null, firstname: "Hung", lastname: "Up", is_academy: true, is_retired: true, birthdate: bornForSeason3Age(25) },
  { id: "r-senior", team_id: "t1", ai_team_id: null, firstname: "Real", lastname: "Pro", is_academy: false, is_retired: false, birthdate: bornForSeason3Age(28) },
];

function makeMock() {
  const rec = { riderFilters: [], inserts: [] };
  const supabase = {
    from(table) {
      if (table === "riders") {
        const filters = [];
        const b = {
          select() { return b; },
          eq(col, val) { filters.push(["eq", col, val]); return b; },
          not(col, op, val) { if (op === "is") filters.push(["not-is", col, val]); return b; },
          order() { return b; },
          range(from, to) {
            rec.riderFilters.push([...filters].sort());
            const out = POPULATION.filter((r) => filters.every(([op, c, v]) =>
              op === "eq" ? (r[c] ?? false) === v : (r[c] ?? null) !== v
            )).slice(from, to + 1);
            return Promise.resolve({ data: out, error: null });
          },
        };
        return b;
      }
      if (table === "auctions") {
        const b = { select() { return b; }, in() { return b; }, order() { return b; }, range() { return Promise.resolve({ data: [], error: null }); } };
        return b;
      }
      if (table === "academy_graduation") {
        const b = {
          select() { return b; },
          eq() { return b; },
          in() { return b; },
          order() { return b; },
          range() { return Promise.resolve({ data: [], error: null }); },
          insert(row) { rec.inserts.push(row); return Promise.resolve({ error: null }); },
        };
        return b;
      }
      throw new Error(`uventet tabel: ${table}`);
    },
  };
  return { supabase, rec };
}

test("#5133 lag 1: detektionen og vagten sender NØJAGTIG samme rytter-filtre", async () => {
  const detect = makeMock();
  await detectGraduates(detect.supabase, { seasonId: SEASON.id, seasonNumber: SEASON.number, now: NOW, notify: async () => {} });

  const guard = makeMock();
  await findStuckAcademyGraduates(guard.supabase, { now: NOW, seasonNumber: SEASON.number });

  assert.equal(detect.rec.riderFilters.length, 1, "detektionen laver ét rytter-query");
  assert.equal(guard.rec.riderFilters.length, 1, "vagten laver ét rytter-query");
  assert.deepEqual(
    detect.rec.riderFilters[0],
    guard.rec.riderFilters[0],
    "detectGraduates og findStuckAcademyGraduates skal filtrere riders ens — divergerer de, kan en rytter falde ud af flowet uden at nogen af dem ser det",
  );
});

test("#5133 lag 2: samme population ind → samme ryttere ud", async () => {
  const detect = makeMock();
  await detectGraduates(detect.supabase, { seasonId: SEASON.id, seasonNumber: SEASON.number, now: NOW, notify: async () => {} });
  const detected = detect.rec.inserts.map((r) => r.rider_id).sort();

  const guard = makeMock();
  const { stuck } = await findStuckAcademyGraduates(guard.supabase, { now: NOW, seasonNumber: SEASON.number });
  const flagged = stuck.map((s) => s.riderId).sort();

  assert.deepEqual(detected, ["r-22", "r-23"], "22 og 23 er vokset ud; 20/21 er ikke, og fri-agent/pensioneret/senior hører ikke til her");
  assert.deepEqual(detected, flagged);
});

test("#5133: akademi-fri-agenten (team_id NULL) rører ingen af de to stier", async () => {
  const detect = makeMock();
  await detectGraduates(detect.supabase, { seasonId: SEASON.id, seasonNumber: SEASON.number, now: NOW, notify: async () => {} });
  assert.equal(
    detect.rec.inserts.some((r) => r.rider_id === "r-stranded"), false,
    "academy_graduation.team_id er NOT NULL — en insert her ville kaste og afbryde resten af batchen",
  );

  const guard = makeMock();
  const { stuck } = await findStuckAcademyGraduates(guard.supabase, { now: NOW, seasonNumber: SEASON.number });
  assert.equal(stuck.some((s) => s.riderId === "r-stranded"), false);
});
