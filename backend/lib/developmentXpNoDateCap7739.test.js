// #7739 (ejer 7/11 paa #6110): under XP-modellen er der intet +1-loft pr. evne pr. dato;
// kun prisen bremser. Tallene er syntetiske (hard rule 17). Testene laaser:
//   · XP on: en evne kan koebe flere point paa samme dato, naar XP'en raekker, og dato-
//     loftets kvittering (gains_deferred_by_date_cap) skrives ikke
//   · XP off: dagens model og kurve B holder stadig maks +1 pr. dato (bit-identiteten
//     mod merge-basen laases af den frosne golden i developmentXpWiring.test.js)
//   · krogpunktet: overgangsvinduet (development_xp_transition_cap_dates) er slukket som
//     standard; sat, giver det maks +1 pr. dato i de foerste datoer fra startdatoen
import test from "node:test";
import assert from "node:assert/strict";

import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { validateDevelopmentXpParams, xpPriceForNextPoint } from "./developmentXp.ts";
import {
  DEVELOPMENT_XP_FLAG_KEY, DEVELOPMENT_XP_FROM_DATE_KEY, DEVELOPMENT_XP_TRANSITION_CAP,
  DEVELOPMENT_XP_TRANSITION_CAP_DATES_KEY, developmentXpDateCap, developmentXpTransitionDatesValue,
  loadDevelopmentXpDateCap,
} from "./developmentXpFlag.ts";
import { XP_TEST_PARAMS, ENGINE_SCENARIOS, engineSeed, runEngine } from "./__fixtures__/developmentXpOffScenarios.js";

const XP = validateDevelopmentXpParams(XP_TEST_PARAMS);
const TICK_DATE = "2026-06-12"; // motor-fixturens dato (NOW i developmentXpOffScenarios.js)
const xpOn = (fromDate = TICK_DATE, extra = []) => ({
  app: [[DEVELOPMENT_XP_FLAG_KEY, "on"], [DEVELOPMENT_XP_FROM_DATE_KEY, fromDate], ...extra],
  params: XP_TEST_PARAMS,
});
const NONE = { app: [], params: undefined };

// Rytter r1 faar en stor gemt bjaelke paa en evne, saa XP'en i sig selv raekker til
// flere point paa én dato (gammel fremgang plus dagens XP).
const ABILITY = "climbing";
function seed({ flags = ENGINE_SCENARIOS.cap.flags, overlay, raced = false }) {
  const state = engineSeed({ flags, raced, overlay, plan: "vo2max" });
  state.rider_derived_abilities[0].ability_progress = { ...state.rider_derived_abilities[0].ability_progress, [ABILITY]: 4 };
  return state;
}
const r1Report = (result) => result.report.riders.find((r) => r.rider_id === "r1");
const r1Level = (state) => state.rider_derived_abilities.find((r) => r.rider_id === "r1")[ABILITY];

test("#7739 forudsaetning: scenariets bjaelke raekker til flere point til prisen", () => {
  const level = engineSeed({ flags: {}, raced: false, overlay: NONE, plan: "vo2max" }).rider_derived_abilities[0][ABILITY];
  const wallet = 4 * xpPriceForNextPoint(level, XP);
  assert.ok(wallet >= xpPriceForNextPoint(level, XP) + xpPriceForNextPoint(level + 1, XP), "mindst to point uden ny XP");
});

test("#7739 motor: XP on koeber flere point paa samme dato, og dato-loftets kvittering skrives ikke", async () => {
  for (const flags of [ENGINE_SCENARIOS.cap.flags, ENGINE_SCENARIOS.noCap.flags]) {
    const state = seed({ flags, overlay: xpOn() });
    const before = r1Level(state);
    const result = await runEngine(state);
    const report = r1Report(result);
    assert.ok(report.gains[ABILITY] >= 2, "flere point paa én dato");
    assert.equal(r1Level(state) - before, report.gains[ABILITY], "gemt evne = rapportens gevinst");
    for (const r of result.report.riders) {
      assert.equal(r.gains_deferred_by_date_cap, undefined, "ingen dato-loft-kvittering under XP");
    }
  }
});

test("#7739 motor: paa en loebsdag skriver XP heller ingen dato-loft-kvittering", async () => {
  // Loebsdagens eget loft pr. tick (#4750, spec §4.3) er uaendret og ligger i tick'et selv.
  const state = seed({ overlay: xpOn(), raced: true });
  const result = await runEngine(state);
  assert.ok(r1Report(result).gains[ABILITY] >= 1);
  for (const r of result.report.riders) assert.equal(r.gains_deferred_by_date_cap, undefined);
});

test("#7739 motor: XP off holder stadig maks +1 pr. dato (dagens model og kurve B uaendret)", async () => {
  const state = seed({ overlay: NONE });
  const before = structuredClone(state.rider_derived_abilities);
  const result = await runEngine(state);
  for (const [i, row] of state.rider_derived_abilities.entries()) {
    for (const k of VISIBLE_ABILITIES) assert.ok(row[k] - before[i][k] <= 1, `${k}: hoejst +1`);
  }
  assert.ok(r1Report(result).gains_deferred_by_date_cap?.[ABILITY] > 0, "klippet point kvitteres som i dag");
});

test("#7739 krog: overgangsvinduet giver maks +1 pr. dato inden for vinduet, uden XP-tab", async () => {
  const inside = seed({ overlay: xpOn(TICK_DATE, [[DEVELOPMENT_XP_TRANSITION_CAP_DATES_KEY, 7]]) });
  const before = r1Level(inside);
  const result = await runEngine(inside);
  const report = r1Report(result);
  assert.equal(report.gains[ABILITY], DEVELOPMENT_XP_TRANSITION_CAP);
  assert.equal(r1Level(inside), before + DEVELOPMENT_XP_TRANSITION_CAP);
  assert.ok(report.gains_deferred_by_date_cap?.[ABILITY] >= 1, "det udskudte kvitteres");
  // Resten bliver paa bjaelken: mindst et helt point mere at koebe naeste dato.
  const bar = inside.rider_derived_abilities[0].ability_progress[ABILITY];
  assert.ok(bar >= 1, "fremgangen gaar ikke tabt");
});

test("#7739 krog: uden for vinduet, med 0 eller uden noeglen er der intet loft", async () => {
  const cases = [
    xpOn("2026-06-01", [[DEVELOPMENT_XP_TRANSITION_CAP_DATES_KEY, 7]]), // dato 12 > 7 datoer
    xpOn(TICK_DATE, [[DEVELOPMENT_XP_TRANSITION_CAP_DATES_KEY, 0]]),
    xpOn(TICK_DATE, [[DEVELOPMENT_XP_TRANSITION_CAP_DATES_KEY, "x"]]),
    xpOn(TICK_DATE),
  ];
  for (const overlay of cases) {
    const result = await runEngine(seed({ overlay }));
    assert.ok(r1Report(result).gains[ABILITY] >= 2, JSON.stringify(overlay.app));
    assert.equal(r1Report(result).gains_deferred_by_date_cap, undefined);
  }
});

test("#7739 krog: vinduet bruger dato-loftets register og kraever derfor dato-loft-kontakten", async () => {
  const state = seed({ flags: ENGINE_SCENARIOS.noCap.flags, overlay: xpOn(TICK_DATE, [[DEVELOPMENT_XP_TRANSITION_CAP_DATES_KEY, 7]]) });
  const result = await runEngine(state);
  assert.ok(r1Report(result).gains[ABILITY] >= 2);
});

// ── Rene funktioner ───────────────────────────────────────────────────────────

test("#7739 developmentXpDateCap: vinduet taeller datoer fra og med startdatoen", () => {
  const cap = (tickDate, transitionDates, fromDate = "2026-11-15") => developmentXpDateCap({ tickDate, fromDate, transitionDates });
  assert.equal(cap("2026-11-15", 7), DEVELOPMENT_XP_TRANSITION_CAP);
  assert.equal(cap("2026-11-21", 7), DEVELOPMENT_XP_TRANSITION_CAP, "7. dato");
  assert.equal(cap("2026-11-22", 7), null, "8. dato");
  assert.equal(cap("2026-11-14", 7), null, "foer startdatoen");
  assert.equal(cap("2026-11-15", 1), DEVELOPMENT_XP_TRANSITION_CAP);
  assert.equal(cap("2026-11-16", 1), null);
  assert.equal(cap("2026-03-29", 2, "2026-03-28"), DEVELOPMENT_XP_TRANSITION_CAP, "sommertid flytter ikke vinduet");
  for (const n of [0, null, undefined, -1, 1.5, NaN]) assert.equal(cap("2026-11-15", n), null, `n=${n}`);
  assert.equal(cap("2026-11-15", 7, null), null, "uden startdato");
  assert.equal(cap("15/11/2026", 7), null, "ugyldig tick-dato");
});

test("#7739 developmentXpTransitionDatesValue: kun hele tal >= 0", () => {
  assert.equal(developmentXpTransitionDatesValue(7), 7);
  assert.equal(developmentXpTransitionDatesValue("7"), 7);
  assert.equal(developmentXpTransitionDatesValue(0), 0);
  for (const v of [-1, 1.5, "x", "", " ", true, {}, [], NaN, Infinity]) assert.equal(developmentXpTransitionDatesValue(v), null, String(v));
});

function fakeDb({ app = {}, failApp = [] } = {}) {
  const reads = [];
  return {
    reads,
    from(table) {
      const q = { key: null };
      const chain = {
        select() { return chain; },
        eq(_col, key) { q.key = key; return chain; },
        async maybeSingle() {
          reads.push({ table, key: q.key });
          if (failApp.includes(q.key)) return { data: null, error: { message: "boom" } };
          return { data: q.key in app ? { value: app[q.key] } : null, error: null };
        },
      };
      return chain;
    },
  };
}
const quiet = () => { const warnings = []; return { warnings, log: { warn: (m) => warnings.push(String(m)) } }; };

test("#7739 loadDevelopmentXpDateCap: standard er intet loft, uden at laese startdatoen", async () => {
  const { warnings, log } = quiet();
  const db = fakeDb({ app: { [DEVELOPMENT_XP_FROM_DATE_KEY]: "2026-11-15" } });
  assert.equal(await loadDevelopmentXpDateCap({ supabase: db, tickDate: "2026-11-15", log }), null);
  assert.deepEqual(db.reads.map((r) => r.key), [DEVELOPMENT_XP_TRANSITION_CAP_DATES_KEY]);
  assert.deepEqual(warnings, []);
});

test("#7739 loadDevelopmentXpDateCap: sat vindue giver loftet; ugyldig = intet loft + advarsel", async () => {
  const app = { [DEVELOPMENT_XP_FROM_DATE_KEY]: "2026-11-15", [DEVELOPMENT_XP_TRANSITION_CAP_DATES_KEY]: 7 };
  assert.equal(await loadDevelopmentXpDateCap({ supabase: fakeDb({ app }), tickDate: "2026-11-18" }), DEVELOPMENT_XP_TRANSITION_CAP);
  assert.equal(await loadDevelopmentXpDateCap({ supabase: fakeDb({ app }), tickDate: "2026-11-22" }), null);
  const { warnings, log } = quiet();
  const bad = fakeDb({ app: { ...app, [DEVELOPMENT_XP_TRANSITION_CAP_DATES_KEY]: -3 } });
  assert.equal(await loadDevelopmentXpDateCap({ supabase: bad, tickDate: "2026-11-18", log }), null);
  assert.ok(warnings.some((w) => w.includes(DEVELOPMENT_XP_TRANSITION_CAP_DATES_KEY)));
});

test("#7739 loadDevelopmentXpDateCap: strict kaster ved fejlet laesning, uden strict er det intet loft", async () => {
  const app = { [DEVELOPMENT_XP_FROM_DATE_KEY]: "2026-11-15", [DEVELOPMENT_XP_TRANSITION_CAP_DATES_KEY]: 7 };
  for (const key of [DEVELOPMENT_XP_TRANSITION_CAP_DATES_KEY, DEVELOPMENT_XP_FROM_DATE_KEY]) {
    await assert.rejects(loadDevelopmentXpDateCap({ supabase: fakeDb({ app, failApp: [key] }), tickDate: "2026-11-15", strict: true }));
    const { warnings, log } = quiet();
    assert.equal(await loadDevelopmentXpDateCap({ supabase: fakeDb({ app, failApp: [key] }), tickDate: "2026-11-15", log }), null);
    assert.ok(warnings.length > 0);
  }
});
