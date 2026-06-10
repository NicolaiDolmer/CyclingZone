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

test("unknown goal type falls back to stored label", () => {
  assert.equal(getBoardGoalLabel(tEn, { type: "no_outstanding_debt", label: "Ingen udestaende gaeld ved saesonslut" }),
    "Ingen udestaende gaeld ved saesonslut");
  assert.equal(getBoardGoalLabel(tEn, null), "");
});

test("min_national_riders interpolates target + country name", () => {
  const label = getBoardGoalLabel(tEn, { type: "min_national_riders", target: 4, nationality_code: "DK" });
  assert.ok(label.includes("4"), label);
  assert.ok(!label.includes("{target}"), label);
});
