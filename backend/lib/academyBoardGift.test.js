// #5844 — "A thank-you from the board": modtagerfilter, nationsvægtning,
// kuld-plan (5 U23 + 5 junior, talent-garanti), idempotens (claim-først) og
// adskillelse fra den ugentlige hentning (academy_intake_ticks røres aldrig).
import test from "node:test";
import assert from "node:assert/strict";

import {
  BOARD_GIFT_BATCH,
  BOARD_GIFT_COHORTS,
  BOARD_GIFT_EXPIRY_DAYS,
  BOARD_GIFT_NOTIFICATION,
  BOARD_GIFT_SOURCE,
  BOARD_GIFT_TOTAL,
  buildTeamNationalityWeights,
  intakeOfferExpiryDaysFor,
  isBoardGiftRecipient,
  planBoardGift,
  planTeamGift,
  runBoardThankYouGift,
  summarizeBoardGiftRun,
  teamGiftRng,
} from "./academyBoardGift.js";
import { signingFeeForSource } from "./academyIntakeSource.js";
import { drawPotentialeAtLeast, generateAcademyCandidates, POTENTIALE_TIERS } from "./academyGenerator.js";
import { makeRng } from "./fictionalRiderGenerator.js";
import { ageForReferenceYear } from "./riderSeasonAge.js";

const HUMAN = {
  is_ai: false, is_bank: false, is_frozen: false, is_test_account: false,
  retired_at: null, parked_at: null, league_division_id: 3,
};

// ── Regler ──────────────────────────────────────────────────────────────────

test("konstanter: 5 U23 + 5 junior, 14 dages frist, fee 0 kun for gaven", () => {
  assert.equal(BOARD_GIFT_TOTAL, 10);
  assert.deepEqual(BOARD_GIFT_COHORTS.map((c) => [c.squad, c.count]), [["u23", 5], ["junior", 5]]);
  assert.equal(BOARD_GIFT_EXPIRY_DAYS, 14);
  assert.equal(intakeOfferExpiryDaysFor(BOARD_GIFT_SOURCE), 14);
  assert.equal(intakeOfferExpiryDaysFor("intake"), 7);
  assert.equal(intakeOfferExpiryDaysFor(undefined), 7);
  assert.equal(signingFeeForSource(BOARD_GIFT_SOURCE, 1234), 0);
  assert.equal(signingFeeForSource("intake", 1234), 1234);
});

test("modtagerfilter: kun aktive menneskehold i en pulje", () => {
  assert.equal(isBoardGiftRecipient(HUMAN), true);
  assert.equal(isBoardGiftRecipient({ ...HUMAN, is_ai: true }), false);
  assert.equal(isBoardGiftRecipient({ ...HUMAN, is_bank: true }), false);
  assert.equal(isBoardGiftRecipient({ ...HUMAN, is_frozen: true }), false);
  assert.equal(isBoardGiftRecipient({ ...HUMAN, is_test_account: true }), false);
  assert.equal(isBoardGiftRecipient({ ...HUMAN, retired_at: "2026-09-01" }), false);
  assert.equal(isBoardGiftRecipient({ ...HUMAN, parked_at: "2026-09-27" }), false);
  assert.equal(isBoardGiftRecipient({ ...HUMAN, league_division_id: null }), false);
  assert.equal(isBoardGiftRecipient(null), false);
});

// ── Nationsvægtning ─────────────────────────────────────────────────────────

test("nationsprofil: top-3 nationer får 70 % af vægten, resten normal fordeling", () => {
  const codes = [...Array(10).fill("DK"), ...Array(5).fill("NO"), ...Array(3).fill("BE"), "FR", "IT"];
  const r = buildTeamNationalityWeights(codes);
  assert.deepEqual(r.topNations.map((n) => n.code), ["DK", "NO", "BE"]);
  const total = r.weights.reduce((s, w) => s + w.weight, 0);
  const top = r.weights.filter((w) => ["DK", "NO", "BE"].includes(w.value)).reduce((s, w) => s + w.weight, 0);
  // Top-3 = 70 % + deres egen andel af de 30 % normal fordeling.
  assert.ok(top / total > 0.7 && top / total < 0.8, `top-andel ${top / total}`);
  const dk = r.weights.find((w) => w.value === "DK").weight;
  const no = r.weights.find((w) => w.value === "NO").weight;
  assert.ok(dk > no, "den største nation vægter tungest");
});

test("nationsprofil: for få ryttere → null (normal fordeling)", () => {
  assert.equal(buildTeamNationalityWeights(["DK", "DK", "NO", null]), null);
  assert.equal(buildTeamNationalityWeights([]), null);
});

test("nationsvægtning slår igennem i det genererede kuld", () => {
  const nat = buildTeamNationalityWeights(Array(20).fill("DK"));
  let dk = 0;
  const N = 400;
  const cands = generateAcademyCandidates({
    rng: makeRng(7), referenceYear: 2029, existingNames: new Set(), countOverride: N,
    nationalityWeights: nat.weights,
  });
  for (const c of cands) if (c.rider.nationality_code === "DK") dk++;
  assert.ok(dk / N > 0.6, `DK-andel ${dk / N}`);
});

// ── Generator-udvidelserne ──────────────────────────────────────────────────

test("generator: ageBand giver kun aldre i båndet (sæsonalder)", () => {
  for (const band of [{ min: 19, max: 21 }, { min: 16, max: 18 }]) {
    const cands = generateAcademyCandidates({
      rng: makeRng(3), referenceYear: 2029, existingNames: new Set(), countOverride: 200, ageBand: band,
    });
    for (const c of cands) {
      const age = ageForReferenceYear(c.rider.birthdate, 2029);
      assert.ok(age >= band.min && age <= band.max, `alder ${age} uden for ${band.min}-${band.max}`);
    }
  }
});

test("generator: uden de nye parametre er output bit-identisk (rng-rækkefølgen uændret)", () => {
  const a = generateAcademyCandidates({ rng: makeRng(99), referenceYear: 2029, existingNames: new Set(), countOverride: 5 });
  const b = generateAcademyCandidates({
    rng: makeRng(99), referenceYear: 2029, existingNames: new Set(), countOverride: 5,
    ageBand: null, nationalityWeights: null, topTalentIndex: null,
  });
  assert.deepEqual(a.map((c) => c.rider), b.map((c) => c.rider));
});

test("drawPotentialeAtLeast: altid ≥ gulvet og altid et gyldigt trin", () => {
  const rng = makeRng(11);
  for (let i = 0; i < 500; i++) {
    const p = drawPotentialeAtLeast(rng, 3);
    assert.ok(p >= 3 && POTENTIALE_TIERS.includes(p));
  }
});

// ── Kuld-plan ───────────────────────────────────────────────────────────────

test("planTeamGift: to delkuld á 5, præcis ét talent-indeks", () => {
  for (let seed = 0; seed < 30; seed++) {
    const plan = planTeamGift({ rng: makeRng(seed) });
    assert.deepEqual(plan.map((p) => [p.squad, p.countOverride]), [["u23", 5], ["junior", 5]]);
    const forced = plan.filter((p) => p.generatorOptions.topTalentIndex != null);
    assert.equal(forced.length, 1);
    const idx = forced[0].generatorOptions.topTalentIndex;
    assert.ok(idx >= 0 && idx < 5);
  }
});

function snapshotData(teams, { claimed = [] } = {}) {
  return {
    season: { id: "s4", number: 4 },
    referenceYear: 2029,
    recipients: teams.map((t) => ({ id: t.id, ...HUMAN })),
    profiles: new Map(teams.map((t) => [t.id, { nations: t.nations ?? [], junior: t.junior ?? 0, u23: t.u23 ?? 0 }])),
    claimed: new Set(claimed),
    existingNames: new Set(),
  };
}

test("planBoardGift: 10 tilbud pr. hold, 5 U23-alder + 5 junior-alder, mindst ét talent i toppen", () => {
  const teams = Array.from({ length: 25 }, (_, i) => ({ id: `team-${i}`, nations: Array(8).fill(i % 2 ? "DK" : "IT") }));
  const run = planBoardGift(snapshotData(teams));
  assert.equal(run.teams.length, 25);
  for (const t of run.teams) {
    assert.equal(t.status, "planned");
    assert.equal(t.offers.length, 10);
    assert.equal(t.offers.filter((o) => o.squad === "u23").length, 5);
    assert.equal(t.offers.filter((o) => o.squad === "junior").length, 5);
    assert.ok(t.offers.some((o) => o.potentiale >= run.topTalentMin), `hold ${t.teamId} mangler et talent`);
  }
  const summary = summarizeBoardGiftRun(run);
  assert.equal(summary.offers, 250);
  assert.equal(summary.teamsWithTopTalent, 25);
});

test("planBoardGift: deterministisk pr. (seed, hold, batch)", () => {
  const teams = [{ id: "a" }, { id: "b" }];
  const one = planBoardGift(snapshotData(teams));
  const two = planBoardGift(snapshotData(teams));
  assert.deepEqual(one.teams.map((t) => t.offers), two.teams.map((t) => t.offers));
  const other = planBoardGift(snapshotData(teams), { seed: 1 });
  assert.notDeepEqual(one.teams.map((t) => t.offers), other.teams.map((t) => t.offers));
});

test("planBoardGift: claimet hold springes over (idempotens)", () => {
  const run = planBoardGift(snapshotData([{ id: "a" }, { id: "b" }], { claimed: ["a"] }));
  assert.equal(run.teams.find((t) => t.teamId === "a").status, "skipped_already_claimed");
  assert.equal(run.teams.find((t) => t.teamId === "a").offers.length, 0);
  assert.equal(run.teams.find((t) => t.teamId === "b").offers.length, 10);
});

test("planBoardGift: ledige pladser rapporteres, men tilbud gives uanset (må overstige)", () => {
  const run = planBoardGift(snapshotData([{ id: "full", u23: 12, junior: 10 }]));
  const t = run.teams[0];
  assert.deepEqual(t.freeSlots, { u23: 0, junior: 0 });
  assert.equal(t.offers.length, 10);
  assert.equal(summarizeBoardGiftRun(run).teamsNoSlotAtAll, 1);
});

test("teamGiftRng: forskellige hold får forskellige strømme", () => {
  assert.notEqual(teamGiftRng(5844, "a")(), teamGiftRng(5844, "b")());
});

// ── Apply-stien mod en mock-DB ──────────────────────────────────────────────

function makeApplyDb({ teams, claimed = [], riders = [] }) {
  const state = {
    claims: new Set(claimed),
    touched: new Set(),
    deletedClaims: [],
    giftRows: new Map(),
  };
  const chain = (table) => {
    state.touched.add(table);
    const q = { _table: table, _filters: {}, _op: "select" };
    const api = {
      select() { return api; },
      eq(c, v) { q._filters[c] = v; return api; },
      is() { return api; },
      not() { return api; },
      in() { return api; },
      order() { return api; },
      range(from) {
        if (table === "teams") return Promise.resolve({ data: from === 0 ? teams : [], error: null });
        if (table === "riders") return Promise.resolve({ data: from === 0 ? riders : [], error: null });
        return Promise.resolve({ data: [], error: null });
      },
      maybeSingle() {
        if (table === "seasons") return Promise.resolve({ data: { id: "s4", number: 4, start_date: "2026-09-28" }, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      upsert(row) {
        q._op = "upsert";
        q._row = row;
        return api;
      },
      delete() { q._op = "delete"; return api; },
      then(resolve, reject) {
        let res;
        if (table === "academy_gift_claims" && q._op === "upsert") {
          const key = q._row.team_id;
          if (state.claims.has(key)) res = { data: [], error: null };
          else { state.claims.add(key); res = { data: [{ team_id: key }], error: null }; }
        } else if (table === "academy_gift_claims" && q._op === "delete") {
          state.claims.delete(q._filters.team_id);
          state.deletedClaims.push(q._filters.team_id);
          res = { error: null };
        } else if (table === "academy_gift_claims") {
          res = { data: [...state.claims].map((team_id) => ({ team_id })), error: null };
        } else if (table === "academy_intake") {
          res = { count: state.giftRows.get(q._filters.team_id) ?? 0, error: null };
        } else {
          res = { data: [], error: null };
        }
        return Promise.resolve(res).then(resolve, reject);
      },
    };
    return api;
  };
  return { supabase: { from: chain }, state };
}

test("apply: claim-først, source board_gift, derive + indbakke-besked; academy_intake_ticks røres ALDRIG", async () => {
  const teams = [{ id: "t1", ...HUMAN }, { id: "t2", ...HUMAN }];
  const { supabase, state } = makeApplyDb({ teams });
  const seedCalls = [];
  const notes = [];
  const derived = [];
  const run = await runBoardThankYouGift(supabase, {
    dryRun: false,
    seedCohortFn: async (_sb, args) => {
      seedCalls.push(args);
      return Array.from({ length: args.countOverride }, (_, i) => `${args.teamId}-${args.generatorOptions.ageBand.min}-${i}`);
    },
    deriveRiders: async (_sb, ids) => { derived.push(...ids); },
    notify: async (n) => { notes.push(n); },
  });
  assert.equal(run.teams.filter((t) => t.status === "applied").length, 2);
  assert.equal(seedCalls.length, 4, "to delkuld pr. hold");
  assert.ok(seedCalls.every((c) => c.source === BOARD_GIFT_SOURCE));
  assert.equal(derived.length, 20);
  assert.equal(notes.length, 2);
  assert.equal(notes[0].type, BOARD_GIFT_NOTIFICATION.type);
  assert.equal(notes[0].metadata.titleCode, "notif.academyBoardGift.title");
  assert.ok(!state.touched.has("academy_intake_ticks"), "den ugentlige hentnings claim-tabel må ikke røres");
  assert.deepEqual([...state.claims].sort(), ["t1", "t2"]);
});

test("apply: anden kørsel giver ingenting (idempotent)", async () => {
  const teams = [{ id: "t1", ...HUMAN }];
  const { supabase } = makeApplyDb({ teams, claimed: ["t1"] });
  let seeded = 0;
  const run = await runBoardThankYouGift(supabase, {
    dryRun: false,
    seedCohortFn: async () => { seeded++; return []; },
    deriveRiders: async () => {},
    notify: async () => { throw new Error("må ikke kaldes"); },
  });
  assert.equal(seeded, 0);
  assert.equal(run.teams[0].status, "skipped_already_claimed");
});

test("apply: fejl før noget er skrevet → claim frigives, så en genkørsel kan prøve igen", async () => {
  const teams = [{ id: "t1", ...HUMAN }];
  const { supabase, state } = makeApplyDb({ teams });
  const run = await runBoardThankYouGift(supabase, {
    dryRun: false,
    seedCohortFn: async () => { throw new Error("boom"); },
    deriveRiders: async () => {},
    notify: async () => {},
  });
  assert.equal(run.teams[0].status, "failed_released");
  assert.deepEqual(state.deletedClaims, ["t1"]);
  assert.equal(state.claims.has("t1"), false);
});

test("apply: fejl efter delvis skrivning → claim bevares (aldrig dobbelt-kuld)", async () => {
  const teams = [{ id: "t1", ...HUMAN }];
  const { supabase, state } = makeApplyDb({ teams });
  state.giftRows.set("t1", 5);
  let n = 0;
  const run = await runBoardThankYouGift(supabase, {
    dryRun: false,
    seedCohortFn: async () => { n++; if (n === 2) throw new Error("boom"); return ["x"]; },
    deriveRiders: async () => {},
    notify: async () => {},
  });
  assert.equal(run.teams[0].status, "failed_partial");
  assert.equal(state.claims.has("t1"), true);
});

test("dry-run skriver intet (ingen claim, ingen seed)", async () => {
  const teams = [{ id: "t1", ...HUMAN }];
  const { supabase, state } = makeApplyDb({ teams });
  const run = await runBoardThankYouGift(supabase, {
    dryRun: true,
    seedCohortFn: async () => { throw new Error("må ikke kaldes"); },
  });
  assert.equal(run.dryRun, true);
  assert.equal(run.teams[0].offers.length, 10);
  assert.equal(state.claims.size, 0);
  assert.equal(run.batch, BOARD_GIFT_BATCH);
});
