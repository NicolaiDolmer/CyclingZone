// #8592 DO-8 · Frossen golden: kontakten off = bit-identisk motor (#7587).
//
// Generatoren bruger KUN harnesset fra #7982 (trainNowSameResult7982.harness.js), så samme fil
// kan kopieres ind i en kopi af merge-basen og køres dér. Fixturen
// (trainingDayOverride8592.golden.json) er genereret i merge-basen og genereres ALDRIG med den
// nye kode. Testen kører den nye kode med kontakten off og sammenligner fingeraftrykkene.
//
// Hvert scenarie har en dato-række i den nye tabel og kontakten off; de fem første har programceller,
// de fire "uden_program" har ingen (#8819). Fingeraftrykket er hele tilstanden efter kørslen (kun hash).
// uden_program_regel har en række med beats_fatigue_rule (DO-10), som basen ikke kender.
//
//   Generér i basen:  node lib/trainingDayOverride8592.golden.mjs > <fil>
import { pathToFileURL } from "node:url";
import {
  DATE1, TEAM, createFake, press, rider, seedState, stateDigest, sweep,
} from "./trainNowSameResult7982.harness.js";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const SESSIONS = ["sprint", "tempo", "threshold", "vo2max", "endurance"];

function programRow(riderId, { planKind = null, lockSlot, rotation } = {}) {
  const entry = { session: "tempo", intensity: "normal", slots: [...SESSIONS], ...(lockSlot !== undefined ? { lockSlot } : {}) };
  return {
    id: `week-${riderId}`, team_id: TEAM, rider_id: riderId, plan_kind: planKind,
    days: Object.fromEntries(WEEKDAYS.map((day) => [day, entry])),
    ...(rotation ? { rotation } : {}),
  };
}

function overrideRows(riderIds) {
  return riderIds.map((riderId, i) => ({
    id: `override-${i}`, team_id: TEAM, rider_id: riderId, override_date: DATE1,
    session: i % 2 === 0 ? "rest" : "endurance", created_at: "2026-11-08T10:00:00Z", updated_at: "2026-11-08T10:00:00Z",
  }));
}

const ROTATION = { v: 1, rev: 1, passes: [{ session: "sprint" }, { session: "threshold" }, { session: "endurance" }], anchor: { rev: 1, index: 0 } };

export const GOLDEN_SCENARIOS = {
  celler: { seed: { count: 4 }, rows: () => [programRow(rider(0)), programRow(rider(1))], overrides: [0, 1, 2] },
  celler_etape: { seed: { count: 4, entered: [0, 1], stageRun: true }, rows: () => [programRow(rider(0)), programRow(rider(1))], overrides: [0, 1] },
  ugeblok: {
    seed: { count: 2, flags: { training_week_priority: "on" } },
    rows: () => [programRow(rider(0), { planKind: "week", lockSlot: 4 })], overrides: [0],
  },
  rotation: {
    seed: { count: 2, flags: { training_rotation: "on" } },
    rows: () => [programRow(rider(0), { planKind: "rotation", rotation: ROTATION }), programRow(rider(1))], overrides: [0, 1],
  },
  tryk: { seed: { count: 4 }, rows: () => [programRow(rider(0)), programRow(rider(2))], overrides: [0, 2], press: true },
  // #8819 (ejer 26/11: virker også uden program): hold uden programfelter, med valg i tabellen og
  // kontakten off. Motoren læser nu kontakten for alle hold; tilstanden skal være som i basen.
  uden_program: { seed: { count: 4 }, rows: () => [], overrides: [0, 1, 2] },
  uden_program_etape: { seed: { count: 4, entered: [0, 1], stageRun: true }, rows: () => [], overrides: [0, 1] },
  uden_program_regel: { seed: { count: 4, fatigueRules: true, tired: [0, 2] }, rows: () => [], overrides: [0, 2], beatsRule: true },
  uden_program_tryk: { seed: { count: 4 }, rows: () => [], overrides: [0, 3], press: true },
};

export async function goldenFingerprint(name) {
  const scenario = GOLDEN_SCENARIOS[name];
  const state = seedState({ ...scenario.seed, flags: { training_day_override_8592: "off", ...(scenario.seed.flags ?? {}) } });
  state.training_week_plans.push(...scenario.rows(state));
  state.training_day_overrides = overrideRows(scenario.overrides.map((n) => rider(n)))
    .map((row) => (scenario.beatsRule ? { ...row, beats_fatigue_rule: true } : row));
  const fake = createFake(state);
  const outcome = scenario.press ? await press(state, fake).then((r) => [{ status: r.status ?? null }], () => [{ status: "kast" }])
    : await sweep(state, fake);
  return stateDigest({ ...state, golden_outcome: JSON.parse(JSON.stringify(outcome)) });
}

export async function goldenFingerprints() {
  const out = {};
  for (const name of Object.keys(GOLDEN_SCENARIOS)) out[name] = await goldenFingerprint(name);
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.stdout.write(`${JSON.stringify(await goldenFingerprints(), null, 1)}\n`);
}
