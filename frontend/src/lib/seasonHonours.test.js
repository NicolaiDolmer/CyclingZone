import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeHonours,
  topOf,
  isMissingFunctionError,
} from "./seasonHonours.js";

// #2863 — sæsonens bedste ryttere: flest point og flest sejre.
//
// Datasættet nedenfor er de faktiske tal fra prod sæson 1 (read-only 26/7, 27
// af 28 løbsdage afviklet). Det er valgt netop fordi det indeholder de to
// tilfælde der er nemme at bygge forkert:
//   1. Flest point var en AI-ejet rytter (Cooper Doyle, 8.844).
//   2. Flest sejre var DELT på 28 mellem Adamczyk og Whitfield.

const S1_WINS = [
  { rider_id: "r-adamczyk", firstname: "Jakub", lastname: "Adamczyk", nationality_code: "PL", team_id: "t-lego", team_name: "LEGO-Vestas Cycling Team", is_ai: false, points: "4595", wins: "28" },
  { rider_id: "r-whitfield-g", firstname: "George", lastname: "Whitfield", nationality_code: "AU", team_id: "t-easyon", team_name: "Team Easy-On", is_ai: false, points: "3861", wins: "28" },
  { rider_id: "r-segers", firstname: "Ruben", lastname: "Segers", nationality_code: "NL", team_id: "t-brennan", team_name: "Team Brennan", is_ai: false, points: "1279", wins: "22" },
  { rider_id: "r-whitfield-r", firstname: "Ryan", lastname: "Whitfield", nationality_code: "NZ", team_id: "t-borregaard", team_name: "Borregaard Racing", is_ai: false, points: "1145", wins: "20" },
  { rider_id: "r-doyle", firstname: "Cooper", lastname: "Doyle", nationality_code: "CA", team_id: "t-ai-threshold", team_name: "AI Threshold Squad", is_ai: true, points: "8844", wins: "19" },
];

const S1_POINTS = [
  { rider_id: "r-doyle", firstname: "Cooper", lastname: "Doyle", nationality_code: "CA", team_id: "t-ai-threshold", team_name: "AI Threshold Squad", is_ai: true, points: "8844", wins: "19" },
  { rider_id: "r-lehmann", firstname: "Florian", lastname: "Lehmann", nationality_code: "CH", team_id: "t-ai-cima", team_name: "AI Cima Continental", is_ai: true, points: "5023", wins: "5" },
  { rider_id: "r-adamczyk", firstname: "Jakub", lastname: "Adamczyk", nationality_code: "PL", team_id: "t-lego", team_name: "LEGO-Vestas Cycling Team", is_ai: false, points: "4595", wins: "28" },
  { rider_id: "r-nystrom", firstname: "Viktor", lastname: "Nyström", nationality_code: "DK", team_id: "t-ai-tarmac", team_name: "AI Tarmac Squad", is_ai: true, points: "4315", wins: "9" },
  { rider_id: "r-visser", firstname: "Daan", lastname: "Visser", nationality_code: "BE", team_id: "t-suconia", team_name: "Suconia STNS Cycling Team", is_ai: false, points: "4084", wins: "18" },
];

const S1 = { points: S1_POINTS, wins: S1_WINS };

test("#2863 bigint-som-streng bliver til tal, ikke til tekst der sorterer forkert", () => {
  const { wins } = normalizeHonours(S1);
  assert.equal(wins[0].points, 4595);
  assert.equal(wins[0].wins, 28);
  assert.equal(typeof wins[0].points, "number");
  // Den fælde vi undgår: som tekst ville "9" > "28" og listen se omvendt ud.
  assert.ok(wins[2].wins > wins[4].wins);
  // Og en sum af to strenge ville blive sammensat i stedet for lagt sammen.
  assert.equal(wins[0].points + wins[1].points, 8456);
});

test("#2863 rank er 1-baseret og følger serverens rækkefølge", () => {
  const { points } = normalizeHonours(S1);
  assert.deepEqual(points.map((e) => e.rank), [1, 2, 3, 4, 5]);
  assert.equal(points[0].name, "Cooper Doyle");
});

test("#2863 en tom eller fejlagtig payload giver to tomme lister, ikke et crash", () => {
  for (const raw of [null, undefined, {}, { points: null }, "nonsense", 42]) {
    const out = normalizeHonours(raw);
    assert.deepEqual(out, { points: [], wins: [] }, `payload: ${JSON.stringify(raw)}`);
  }
});

test("#2863 nr. 1 på point findes, også når rytteren er AI-ejet", () => {
  const { points } = normalizeHonours(S1);
  const { leader, runnersUp, shared } = topOf(points, "points");
  assert.equal(leader.name, "Cooper Doyle");
  assert.equal(leader.points, 8844);
  // Ingen is_ai-udelukkelse: en rytter er en rytter, samme valg som
  // stage-king-kortet på samme side. UI'et markerer det med AI-badget i stedet.
  assert.equal(leader.isAi, true);
  assert.equal(runnersUp.length, 4);
  assert.equal(shared, false);
});

test("#2863 nr. 1 på sejre afgøres af point ved lige antal", () => {
  const { wins } = normalizeHonours(S1);
  const { leader, runnersUp, shared } = topOf(wins, "wins");
  // Adamczyk og Whitfield har begge 28. Point afgør, og det skal siges højt.
  assert.equal(leader.name, "Jakub Adamczyk");
  assert.equal(leader.wins, 28);
  assert.equal(shared, true, "delt topplacering skal kunne forklares i UI'et");
  assert.equal(runnersUp[0].name, "George Whitfield");
  assert.equal(runnersUp[0].wins, 28);
});

test("#2863 shared er falsk når toppen står alene", () => {
  const { wins } = normalizeHonours({ wins: S1_WINS.slice(1) });
  const { leader, shared } = topOf(wins, "wins");
  assert.equal(leader.name, "George Whitfield");
  assert.equal(shared, false);
});

test("#2863 tom liste giver ingen leader i stedet for at kaste", () => {
  assert.deepEqual(topOf([], "points"), { leader: null, runnersUp: [], shared: false });
  assert.deepEqual(topOf(undefined, "wins"), { leader: null, runnersUp: [], shared: false });
});

test("#2863 rytter uden hold falder ikke ud, den vises bare uden holdnavn", () => {
  const { points } = normalizeHonours({
    points: [{ rider_id: "r-free", firstname: "Free", lastname: "Agent", points: 10, wins: 1, team_id: null, team_name: null, is_ai: null }],
  });
  assert.equal(points[0].name, "Free Agent");
  assert.equal(points[0].teamName, null);
  assert.equal(points[0].isAi, false, "is_ai=null må ikke blive sandt");
});

test("#2863 manglende RPC genkendes, så blokken kan udelades indtil migrationen er kørt", () => {
  assert.equal(isMissingFunctionError({ code: "PGRST202" }), true);
  assert.equal(isMissingFunctionError({ code: "42883" }), true);
  assert.equal(
    isMissingFunctionError({ message: "Could not find the function public.get_season_honours(p_season_id)" }),
    true,
  );
  assert.equal(isMissingFunctionError(null), false);
});

test("#2863 en ÆGTE fejl må ikke forveksles med en manglende funktion", () => {
  // Timeout, netværk og RLS skal ende i fejl-tilstanden, ikke i tavshed.
  assert.equal(isMissingFunctionError({ code: "57014", message: "canceling statement due to statement timeout" }), false);
  assert.equal(isMissingFunctionError({ message: "Failed to fetch" }), false);
  assert.equal(isMissingFunctionError({ code: "42501", message: "permission denied for function get_season_honours" }), false);
});
