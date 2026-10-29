import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_WINDOW, computeRepairPlan, summarizePlan, planHash, rewindAbilities,
  mainAbilityForFocus, isTickInWindow, buildTeamApplySql, parseArgs,
} from "./7316-repair-main-ability.mjs";
import { VISIBLE_ABILITIES } from "../backend/lib/abilityDerivation.js";
import { buildCapsForRider } from "../backend/lib/riderProgression.js";
import { ageForSeason } from "../backend/lib/riderSeasonAge.js";

const SEASON = "00000000-0000-0000-0000-000000000005";
const MANAGER = "11111111-1111-4111-8111-111111111111";
const AI = "22222222-2222-4222-8222-222222222222";
const R1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const R2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const R3 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";

function abilities(over = {}) {
  const a = {};
  for (const k of VISIBLE_ABILITIES) a[k] = 40;
  return { ...a, ...over };
}

function rider(id, over = {}) {
  return {
    id, firstname: "Test", lastname: id.slice(-1), birthdate: "2004-03-01", potentiale: 4,
    primary_type: "climber", secondary_type: null, is_academy: false, is_retired: false, team_id: MANAGER, ...over,
  };
}

function derived(id, abs, over = {}) {
  const r = rider(id);
  const caps = buildCapsForRider(abs, { ...r, age: ageForSeason(r.birthdate, 5) }, r.primary_type, r.secondary_type);
  return { rider_id: id, ...abs, ability_caps: caps, ability_progress: {}, ...over };
}

function tick(riderId, over = {}) {
  return {
    rider_id: riderId, season_id: SEASON, game_day: -7, tick_date: "2026-10-26", team_id: MANAGER,
    created_at: "2026-10-27T06:45:25.004Z", focus: "vo2max_climb", intensity: "hard", race_day: false,
    progress_before: { climbing: 0.2 }, progress_after: { climbing: 0.2, tempo: 0.5 },
    gains: {}, gains_detail: {}, condition_before_date: { form: 55, fatigue: 10 }, ...over,
  };
}

function baseInput(over = {}) {
  const abs = abilities({ climbing: 55 });
  return {
    ticks: [tick(R1), tick(R1, { game_day: -6, created_at: "2026-10-27T06:45:26.000Z" })],
    ridersById: new Map([[R1, rider(R1)]]),
    derivedById: new Map([[R1, derived(R1, abs)]]),
    teamsById: new Map([
      [MANAGER, { id: MANAGER, user_id: "u1", is_ai: false, is_bank: false, is_test_account: false }],
      [AI, { id: AI, user_id: null, is_ai: true, is_bank: false, is_test_account: false }],
    ]),
    seasonNumberById: new Map([[SEASON, 5]]),
    staffByTeam: new Map(),
    applied: new Set(),
    window: DEFAULT_WINDOW,
    ...over,
  };
}

test("hovedevne = foerste fokus-evne", () => {
  assert.equal(mainAbilityForFocus("vo2max_punch"), "punch");
  assert.equal(mainAbilityForFocus("threshold"), "time_trial");
  assert.equal(mainAbilityForFocus("attack_repeats"), "aggression");
  assert.equal(mainAbilityForFocus("nope"), null);
});

test("ramt tick paa managerhold giver positiv kredit paa baren", () => {
  const plan = computeRepairPlan(baseInput());
  assert.equal(plan.entries.length, 1);
  const [e] = plan.entries;
  assert.equal(e.ability, "climbing");
  assert.equal(e.ticks, 2);
  assert.ok(e.credit > 0);
  assert.match(plan.hash, /^[0-9a-f]{16}$/);
});

test("idempotens: samme input to gange = samme plan og hash", () => {
  const a = computeRepairPlan(baseInput());
  const b = computeRepairPlan(baseInput());
  assert.deepEqual(a, b);
  assert.equal(planHash(a.entries), a.hash);
});

test("idempotens: efter apply (ledger + bar) krediteres intet igen", () => {
  const first = computeRepairPlan(baseInput());
  const [e] = first.entries;
  const input = baseInput();
  const d = input.derivedById.get(R1);
  input.derivedById.set(R1, { ...d, ability_progress: { climbing: e.credit } });
  input.applied = new Set([`${R1}:climbing`]);
  const second = computeRepairPlan(input);
  assert.equal(second.entries.length, 0);
  assert.equal(second.skips.already_applied_pair, 1);
});

test("ingen kredit over det haarde loft", () => {
  const probe = derived(R1, abilities({ climbing: 55 }));
  const cap = probe.ability_caps.climbing;
  // Rytteren staar 0,3 under loftet nu: kreditten maa hoejst fylde det hul.
  const abs = abilities({ climbing: Math.floor(cap) - 1 });
  const input = baseInput({
    derivedById: new Map([[R1, derived(R1, abs, { ability_progress: { climbing: 0.7 } })]]),
  });
  const plan = computeRepairPlan(input);
  for (const e of plan.entries) {
    const d = input.derivedById.get(e.riderId);
    assert.ok(d[e.ability] + d.ability_progress[e.ability] + e.credit <= d.ability_caps[e.ability] + 1e-9);
  }
  // Paa loftet ved tick-tidspunktet: intet at kreditere.
  const atCap = abilities({ climbing: 99 });
  const capped = computeRepairPlan(baseInput({
    derivedById: new Map([[R1, derived(R1, atCap, { ability_caps: { ...probe.ability_caps, climbing: 60 } })]]),
  }));
  assert.equal(capped.entries.length, 0);
  assert.ok(capped.skips.at_hard_cap >= 1);
});

test("ingen kredit til AI-hold", () => {
  const plan = computeRepairPlan(baseInput({
    ticks: [tick(R1, { team_id: AI })],
  }));
  assert.equal(plan.entries.length, 0);
  assert.equal(plan.skips.not_manager_team, 1);
});

test("flagets tidsvindue respekteres", () => {
  assert.equal(isTickInWindow("2026-10-25T19:30:00Z"), false); // S4-aftenen foer taendingen
  assert.equal(isTickInWindow(DEFAULT_WINDOW.from), true);
  assert.equal(isTickInWindow(DEFAULT_WINDOW.to), false);
  assert.equal(isTickInWindow("2026-10-29T19:00:00Z"), false); // efter slukningen
  const plan = computeRepairPlan(baseInput({
    ticks: [
      tick(R1, { created_at: "2026-10-25T19:30:00Z", tick_date: "2026-10-25" }),
      tick(R1, { created_at: "2026-10-29T19:00:00Z", tick_date: "2026-10-29" }),
    ],
  }));
  assert.equal(plan.entries.length, 0);
  assert.equal(plan.windowTicks, 0);
});

test("hvile, loebsdag og bevaeget hovedevne frasorteres", () => {
  const plan = computeRepairPlan(baseInput({
    ticks: [
      tick(R1, { intensity: "rest" }),
      tick(R1, { intensity: "race", race_day: true, game_day: -6 }),
      tick(R1, { game_day: -5, progress_after: { climbing: 0.4 } }),
    ],
  }));
  assert.equal(plan.entries.length, 0);
  assert.equal(plan.skips.not_training_day, 2);
  assert.equal(plan.skips.main_ability_moved, 1);
});

test("tilbagespoling traekker senere gevinster fra", () => {
  const t1 = tick(R1, { created_at: "2026-10-27T06:00:00Z" });
  const t2 = tick(R1, { created_at: "2026-10-28T19:00:00Z", gains: { tempo: 1 } });
  const at = rewindAbilities({ climbing: 55, tempo: 42 }, [t2, t1]);
  assert.equal(at.get(t2).tempo, 41);
  assert.equal(at.get(t1).tempo, 41);
  assert.equal(at.get(t1).climbing, 55);
});

test("opsummering: fordeling af ekstra hele point", () => {
  const input = baseInput({
    ticks: [tick(R1), tick(R2), tick(R3)],
    ridersById: new Map([[R1, rider(R1)], [R2, rider(R2)], [R3, rider(R3)]]),
    derivedById: new Map([
      [R1, derived(R1, abilities({ climbing: 55 }), { ability_progress: { climbing: 0.999 } })],
      [R2, derived(R2, abilities({ climbing: 55 }))],
      [R3, derived(R3, abilities({ climbing: 55 }), { ability_progress: { climbing: 0.1 } })],
    ]),
  });
  const s = summarizePlan(computeRepairPlan(input));
  assert.equal(s.riders, 3);
  assert.equal(s.distribution[0] + s.distribution[1] + s.distribution[2] + s.distribution["3+"], 3);
  assert.ok(s.distribution[1] >= 1); // baren paa 0,999 vipper over
});

test("apply-SQL: én transaktion pr. hold, ledger-vaern og live-klip", () => {
  const plan = computeRepairPlan(baseInput());
  const sql = buildTeamApplySql({ teamId: MANAGER, entries: plan.entries, hash: plan.hash });
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.backup_7316_repair_ledger/);
  assert.match(sql, /ON CONFLICT \(rider_id, ability\) DO NOTHING/);
  assert.match(sql, /LEAST\(99, COALESCE\(\(r\.ability_caps->>'climbing'\)::numeric, 99\)\)/);
  assert.doesNotMatch(sql, /\bBEGIN\b|\bCOMMIT\b/); // psql -1 ejer transaktionen
  assert.throws(() => buildTeamApplySql({ teamId: AI, entries: plan.entries, hash: plan.hash }), /another team/);
  assert.throws(() => buildTeamApplySql({ teamId: MANAGER, entries: [{ ...plan.entries[0], ability: "x; drop" }], hash: plan.hash }), /invalid ability/);
});

test("CLI: dry-run er default, apply kraever eksplicit flag", () => {
  assert.equal(parseArgs([]).apply, false);
  assert.equal(parseArgs(["--apply", "--confirm-token=abc"]).confirmToken, "abc");
  assert.throws(() => parseArgs(["--force"]), /unknown argument/);
});
