import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import i18next from "i18next";
import ICU from "i18next-icu";

import { getBoardGoalLabel } from "./boardGoalLabel.js";

// Loader den ÆGTE board.json gennem en ægte i18next-icu-instans (samme mønster
// som boardCopy.test.js), så testen fanger ICU-parse-fejl, manglende nøgler og
// param-mismatch præcis som production-renderen ville. #1233 forward-guard.
function loadJson(rel) {
  const path = fileURLToPath(new URL(rel, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8"));
}

const boardEn = loadJson("../../public/locales/en/board.json");
const boardDa = loadJson("../../public/locales/da/board.json");

let tEn;
let tDa;

before(async () => {
  const instance = i18next.createInstance();
  await instance.use(ICU).init({
    lng: "en",
    fallbackLng: "en",
    ns: ["board"],
    defaultNS: "board",
    resources: { en: { board: boardEn }, da: { board: boardDa } },
    interpolation: { escapeValue: false },
  });
  tEn = instance.getFixedT("en");
  tDa = instance.getFixedT("da");
});

// #1233 · top_n_finish skal vise det konkrete tal i begge sprog — også for
// ALLEREDE gemte planer hvor DB-labelen er dansk råtekst.
test("top_n_finish resolves with concrete number in EN and DA", () => {
  const goal = { type: "top_n_finish", target: 7, label: "Top 7 i divisionen" };
  assert.equal(getBoardGoalLabel(tEn, goal), "Top 7 in the division");
  assert.equal(getBoardGoalLabel(tDa, goal), "Top 7 i divisionen");
});

test("top_n_finish plan-end variant (multi-year) resolves in EN and DA", () => {
  const goal = { type: "top_n_finish", target: 4, label: "Top 4 i divisionen ved planens afslutning" };
  assert.equal(getBoardGoalLabel(tEn, goal), "Top 4 in the division at the end of the plan");
  assert.equal(getBoardGoalLabel(tDa, goal), "Top 4 i divisionen ved planens afslutning");
});

// Regression for screenshot-bugen: ingen mål-label må indeholde et fritstående
// "n"/"N" som uudfyldt placeholder ("Top n finish").
test("no goal label renders a standalone n placeholder", () => {
  const goals = [
    { type: "top_n_finish", target: 3, label: "Top 3 i divisionen" },
    { type: "top_n_finish", target: 9, label: "Top 9 i divisionen ved planens afslutning" },
    { type: "signature_rider", target: 2 },
    { type: "min_national_riders", target: 4, nationality_code: "DK", label: "Min. 4 ryttere fra DK" },
  ];
  for (const t of [tEn, tDa]) {
    for (const goal of goals) {
      const label = getBoardGoalLabel(t, goal);
      assert.ok(label.length > 0, `tom label for ${goal.type}`);
      assert.ok(!/\bn\b/i.test(label), `literal "n" i label: "${label}"`);
    }
  }
});

// Den statiske empty-state-copy var den faktiske kilde til ejerens screenshot
// ("Resultater, etapesejre, top-N-finish, ..."): jargon med N må ikke vende tilbage.
test("emptyState KPI copy has no top-N jargon (EN+DA)", () => {
  for (const bundle of [boardEn, boardDa]) {
    const text = bundle.emptyState.kpis.results.text;
    assert.ok(!/\bN\b/i.test(text), `fritstående N i KPI-copy: "${text}"`);
    assert.ok(!/top.?n.?finish/i.test(text), `top-N-finish-jargon i KPI-copy: "${text}"`);
  }
});

test("null + truly unknown goal type fall back gracefully", () => {
  assert.equal(getBoardGoalLabel(tEn, null), "");
  // En type uden type-resolver OG uden label_key falder tilbage til lagret label.
  assert.equal(getBoardGoalLabel(tEn, { type: "totally_made_up", label: "Rå dansk label" }),
    "Rå dansk label");
});

// #1750 · Alle øvrige mål-typer skal nu vises på ENGELSK i EN-mode (før lækkede
// de dansk råtekst fra DB-labelen). Dansk-mode skal stadig vise dansk.
test("all board goal types resolve to English in EN (no DA leak)", () => {
  const cases = [
    [{ type: "stage_wins", target: 1, label: "Mindst 1 etapesejr" }, "At least 1 stage win", "Mindst 1 etapesejr"],
    [{ type: "stage_wins", target: 3, label: "Mindst 3 etapesejrer" }, "At least 3 stage wins", "Mindst 3 etapesejre"],
    [{ type: "stage_wins", target: 4, cumulative: true, label: "Mindst 4 etapesejre over planperioden" },
      "At least 4 stage wins over the plan period", "Mindst 4 etapesejre over planperioden"],
    [{ type: "gc_wins", target: 1, label: "Mindst 1 samlet sejr" }, "At least 1 overall win", "Mindst 1 samlet sejr"],
    [{ type: "gc_wins", target: 2, label: "Mindst 2 samlede sejre" }, "At least 2 overall wins", "Mindst 2 samlede sejre"],
    [{ type: "min_u25_riders", target: 4, label: "Min. 4 U25-ryttere pa holdet" },
      "Min. 4 U25 riders on the team", "Min. 4 U25-ryttere på holdet"],
    [{ type: "min_riders", target: 7, label: "Hold pa min. 7 ryttere" },
      "Keep at least 7 riders", "Hold på min. 7 ryttere"],
    [{ type: "sponsor_growth", target: 10, label: "Sponsor-indkomst vokset med 10%" },
      "Sponsor income up 10%", "Sponsor-indkomst vokset med 10%"],
    [{ type: "sponsor_growth", target: 30, label: "Sponsor-indkomst vokset med 30% over planperioden" },
      "Sponsor income up 30% over the plan period", "Sponsor-indkomst vokset med 30% over planperioden"],
    [{ type: "no_outstanding_debt", target: 0, label: "Ingen udestaende gaeld ved saesonslut" },
      "No outstanding debt at season end", "Ingen udestående gæld ved sæsonslut"],
    [{ type: "relative_rank", target: 3, label: "Slut foran mindst 3 andre managers i divisionen" },
      "Finish ahead of at least 3 other managers in the division", "Slut foran mindst 3 andre managers i divisionen"],
    [{ type: "u25_development_delta", target: 8, label: "Gennemsnitlig U25-udvikling >= 8 points/sæson" },
      "Average U25 stat gain >= 8 stat points/season", "Gennemsnitlig U25-stat-gevinst >= 8 stat-points/sæson"],
    [{ type: "jersey_wins", target: 2, label: "Mindst 2 etapeloeb-troejer" },
      "At least 2 stage-race jerseys (points/mountains/young)", "Mindst 2 etapeløb-trøjer (point/bjerg/young)"],
    [{ type: "profitable_transfers", target: 500000, label: "Netto transfer-balance >= 500K over planperioden" },
      "Net transfer balance >= 500K over the plan period", "Netto transfer-balance >= 500K over planperioden"],
    [{ type: "domestic_dominance", target: 2, label: "Mindst 2 sejre i hjemlandsloeb pr. saeson" },
      "At least 2 wins in home races per season", "Mindst 2 sejre i hjemlandsløb pr. sæson"],
  ];
  for (const [goal, expectedEn, expectedDa] of cases) {
    assert.equal(getBoardGoalLabel(tEn, goal), expectedEn, `EN for ${goal.type}`);
    assert.equal(getBoardGoalLabel(tDa, goal), expectedDa, `DA for ${goal.type}`);
  }
});

// #1238 · monument_podium med race_scope "classics" honorerer hele
// klassiker-kategorien (egne keys i begge sprog).
test("monument_podium classics scope resolves to classics copy in EN+DA", () => {
  const goal = { type: "monument_podium", target: 1, race_scope: "classics",
    label: "Top-3 i mindst 1 klassiker-loeb (inkl. Monuments)" };
  assert.equal(getBoardGoalLabel(tEn, goal), "Top 3 in at least 1 classic race (incl. Monuments)");
  assert.equal(getBoardGoalLabel(tDa, goal), "Top-3 i mindst 1 klassiker-løb (inkl. Monuments)");
});

// Regression for #1750: ingen EN-mål må indeholde åbenlys dansk råtekst.
test("no EN board goal label leaks Danish-only words", () => {
  const danishMarkers = /\b(ryttere|holdet|divisionen|sæson|saeson|gæld|gaeld|etapesejr|samlet|samlede|vokset|foran|planperioden)\b/i;
  const goals = [
    { type: "stage_wins", target: 2, label: "x" },
    { type: "gc_wins", target: 1, label: "x" },
    { type: "min_u25_riders", target: 4, label: "x" },
    { type: "min_riders", target: 7, label: "x" },
    { type: "sponsor_growth", target: 10, label: "x" },
    { type: "no_outstanding_debt", target: 0, label: "x" },
    { type: "relative_rank", target: 3, label: "x" },
    { type: "u25_development_delta", target: 8, label: "x" },
  ];
  for (const goal of goals) {
    const label = getBoardGoalLabel(tEn, goal);
    assert.ok(!danishMarkers.test(label), `dansk lækage i EN-label "${label}" (${goal.type})`);
  }
});

test("min_national_riders interpolates target + country name", () => {
  const label = getBoardGoalLabel(tEn, { type: "min_national_riders", target: 4, nationality_code: "DK" });
  assert.ok(label.includes("4"), label);
  assert.ok(!label.includes("{target}"), label);
});
