import test from "node:test";
import assert from "node:assert/strict";

import {
  findStuckAcademyGraduates,
  fetchActiveSeasonNumber,
  STUCK_GRADUATE_GRACE_HOURS,
} from "./stuckAcademyGraduates.js";
import { planRepair, applyRepair } from "../scripts/repairStuckAcademyGraduates.js";

// ─── Mock-supabase ─────────────────────────────────────────────────────────────
// Fire tabeller, alle READ-ONLY:
//   seasons:            select("number").eq("status","active").order().limit(1).maybeSingle()
//   riders:             select(...).eq().eq().not().order().range()
//   auctions:           select("rider_id").in("rider_id",[…]).in("status",[…]).order().range()
//   academy_graduation: select(...).in("rider_id",[…]).order().range()
//
// Hard rule 16: ingen vægur-tid — `now` injiceres i hver test.

function makeMock({ activeSeason = { number: 3 }, riders = [], auctions = [], graduations = [] } = {}) {
  return {
    from(table) {
      if (table === "seasons") {
        const b = {
          select() { return b; },
          eq() { return b; },
          order() { return b; },
          limit() { return b; },
          maybeSingle() { return Promise.resolve({ data: activeSeason, error: null }); },
        };
        return b;
      }
      if (table === "riders") {
        const filters = [];
        const b = {
          select() { return b; },
          eq(col, val) { filters.push(["eq", col, val]); return b; },
          not(col, op, val) { if (op === "is") filters.push(["not-is", col, val]); return b; },
          order() { return b; },
          range(from, to) {
            const out = riders.filter((r) => filters.every(([op, c, v]) => {
              if (op === "eq") return (r[c] ?? false) === v;
              if (op === "not-is") return (r[c] ?? null) !== v;
              return true;
            })).slice(from, to + 1);
            return Promise.resolve({ data: out, error: null });
          },
        };
        return b;
      }
      if (table === "auctions") {
        const inFilters = [];
        const b = {
          select() { return b; },
          in(col, vals) { inFilters.push([col, vals]); return b; },
          order() { return b; },
          range(from, to) {
            const out = auctions
              .filter((a) => inFilters.every(([c, v]) => v.includes(a[c])))
              .slice(from, to + 1);
            return Promise.resolve({ data: out, error: null });
          },
        };
        return b;
      }
      if (table === "academy_graduation") {
        const inFilters = [];
        const b = {
          select() { return b; },
          in(col, vals) { inFilters.push([col, vals]); return b; },
          order() { return b; },
          range(from, to) {
            const out = graduations
              .filter((g) => inFilters.every(([c, v]) => v.includes(g[c])))
              .slice(from, to + 1);
            return Promise.resolve({ data: out, error: null });
          },
        };
        return b;
      }
      throw new Error(`uventet tabel: ${table}`);
    },
  };
}

const NOW = new Date("2026-09-05T08:00:00.000Z");
// ageForSeason(birthdate, 3) = 2026 + 2 − fødselsår.
const bornForSeason3Age = (age) => `${2028 - age}-04-11`;

const STUCK_22 = { id: "r-stuck", team_id: "t1", is_academy: true, is_retired: false, birthdate: bornForSeason3Age(22) };
const YOUNG_21 = { id: "r-young", team_id: "t1", is_academy: true, is_retired: false, birthdate: bornForSeason3Age(21) };

test("#4495 fanger akademirytter over graduerings-alderen uden aktiv auktion", async () => {
  const supabase = makeMock({ riders: [STUCK_22, YOUNG_21] });
  const { seasonNumber, checked, stuck } = await findStuckAcademyGraduates(supabase, { now: NOW });
  assert.equal(seasonNumber, 3);
  assert.equal(checked, 2);
  assert.equal(stuck.length, 1);
  assert.equal(stuck[0].riderId, "r-stuck");
  assert.equal(stuck[0].age, 22);
  assert.deepEqual(stuck[0].graduationStatuses, []);
});

test("#4495 en rytter UNDER graduerings-alderen er aldrig et fund", async () => {
  const supabase = makeMock({ riders: [YOUNG_21] });
  const { stuck } = await findStuckAcademyGraduates(supabase, { now: NOW });
  assert.deepEqual(stuck, []);
});

test("#4495 en igangværende graduate-auktion er den dokumenterede mellemtilstand, ikke et brud", async () => {
  const supabase = makeMock({
    riders: [STUCK_22],
    auctions: [{ rider_id: "r-stuck", status: "active" }],
  });
  const { stuck } = await findStuckAcademyGraduates(supabase, { now: NOW });
  assert.deepEqual(stuck, []);
});

test("#4495 en lukket auktion beskytter ikke længere — det er præcis den fastlåste tilstand", async () => {
  const supabase = makeMock({
    riders: [STUCK_22],
    auctions: [{ rider_id: "r-stuck", status: "completed" }],
    graduations: [{ id: "g1", rider_id: "r-stuck", status: "sold", deadline: "2026-08-01T00:00:00.000Z", created_at: "2026-07-25T00:00:00.000Z" }],
  });
  const { stuck } = await findStuckAcademyGraduates(supabase, { now: NOW });
  assert.equal(stuck.length, 1);
  assert.deepEqual(stuck[0].graduationStatuses, ["sold"]);
});

test("#4495 et ÅBENT override-vindue alarmerer ikke (manageren har stadig sit valg)", async () => {
  const supabase = makeMock({
    riders: [STUCK_22],
    graduations: [{ id: "g1", rider_id: "r-stuck", status: "pending", deadline: "2026-09-10T00:00:00.000Z", created_at: "2026-09-03T00:00:00.000Z" }],
  });
  const { stuck } = await findStuckAcademyGraduates(supabase, { now: NOW });
  assert.deepEqual(stuck, []);
});

test("#4495 et NETOP udløbet override-vindue alarmerer ikke inden for grace (sweepet har ikke kørt endnu)", async () => {
  const deadline = new Date(NOW.getTime() - 3 * 3_600_000).toISOString();
  const supabase = makeMock({
    riders: [STUCK_22],
    graduations: [{ id: "g1", rider_id: "r-stuck", status: "pending", deadline, created_at: "2026-08-29T00:00:00.000Z" }],
  });
  const { stuck } = await findStuckAcademyGraduates(supabase, { now: NOW });
  assert.deepEqual(stuck, []);
});

test("#4495 et LÆNGE udløbet override-vindue er et brud (sweepet er gået i stå — #4484-klassen)", async () => {
  const deadline = new Date(NOW.getTime() - (STUCK_GRADUATE_GRACE_HOURS + 1) * 3_600_000).toISOString();
  const supabase = makeMock({
    riders: [STUCK_22],
    graduations: [{ id: "g1", rider_id: "r-stuck", status: "pending", deadline, created_at: "2026-08-20T00:00:00.000Z" }],
  });
  const { stuck } = await findStuckAcademyGraduates(supabase, { now: NOW });
  assert.equal(stuck.length, 1);
  assert.equal(stuck[0].pendingGraduationId, "g1");
});

test("#4495 en holdløs akademirytter hører til invariant D (#2257), ikke her", async () => {
  const supabase = makeMock({ riders: [{ ...STUCK_22, team_id: null }] });
  const { stuck } = await findStuckAcademyGraduates(supabase, { now: NOW });
  assert.deepEqual(stuck, []);
});

test("#4495 uden aktiv sæson gættes der ikke — 0 fund", async () => {
  const supabase = makeMock({ activeSeason: null, riders: [STUCK_22] });
  const res = await findStuckAcademyGraduates(supabase, { now: NOW });
  assert.equal(res.seasonNumber, null);
  assert.deepEqual(res.stuck, []);
});

test("#4495 fetchActiveSeasonNumber returnerer sæsonnummeret", async () => {
  assert.equal(await fetchActiveSeasonNumber(makeMock({ activeSeason: { number: 7 } })), 7);
  assert.equal(await fetchActiveSeasonNumber(makeMock({ activeSeason: null })), null);
});

// ─── Reparations-scriptet ──────────────────────────────────────────────────────
// Læringen 3/9: en dry-run der viser ANDRE rækker end den efterfølgende apply er
// den værste fejlklasse i et reparations-script. Derfor er der ét prædikat, og
// disse tests låser fast at scriptet ikke har sit eget.

test("#4495 planRepair bruger SAMME prædikat som vagten", async () => {
  const fixture = {
    riders: [
      STUCK_22,
      YOUNG_21,
      { id: "r-on-auction", team_id: "t2", is_academy: true, is_retired: false, birthdate: bornForSeason3Age(23) },
      { id: "r-in-window", team_id: "t2", is_academy: true, is_retired: false, birthdate: bornForSeason3Age(22) },
    ],
    auctions: [{ rider_id: "r-on-auction", status: "extended" }],
    graduations: [{ id: "g-open", rider_id: "r-in-window", status: "pending", deadline: "2026-09-11T00:00:00.000Z", created_at: "2026-09-04T00:00:00.000Z" }],
  };
  const watchIds = (await findStuckAcademyGraduates(makeMock(fixture), { now: NOW })).stuck.map((r) => r.riderId);
  const plan = await planRepair({ supabase: makeMock(fixture), now: NOW });

  assert.deepEqual(plan.candidates.map((c) => c.rider_id), watchIds);
  assert.equal(plan.total_candidates, 1);
  assert.equal(plan.season_number, 3);
  assert.deepEqual(plan.by_team, [{ team_id: "t1", riders: 1 }]);
});

test("#4495 planRepair tæller ryttere der aldrig fik et override-vindue (ejer-beslutning)", async () => {
  const supabase = makeMock({
    riders: [STUCK_22, { id: "r-sold", team_id: "t3", is_academy: true, is_retired: false, birthdate: bornForSeason3Age(22) }],
    graduations: [{ id: "g-sold", rider_id: "r-sold", status: "sold", deadline: "2026-08-01T00:00:00.000Z", created_at: "2026-07-25T00:00:00.000Z" }],
  });
  const plan = await planRepair({ supabase, now: NOW });
  assert.equal(plan.total_candidates, 2);
  assert.equal(plan.never_offered, 1);
});

test("#4495 applyRepair frigiver PRÆCIS dry-run'ens kandidater og intet andet", async () => {
  const fixture = { riders: [STUCK_22, YOUNG_21] };
  const plan = await planRepair({ supabase: makeMock(fixture), now: NOW });

  const calls = [];
  const outcome = await applyRepair({
    supabase: makeMock(fixture),
    plan,
    now: NOW,
    release: async (_supabase, args) => {
      calls.push(args);
      return { released: true, riderId: args.riderId };
    },
  });

  assert.deepEqual(calls.map((c) => c.riderId), ["r-stuck"]);
  assert.deepEqual(calls.map((c) => c.teamId), ["t1"]);
  assert.equal(outcome.released, 1);
  assert.equal(outcome.skipped, 0);
});

test("#4495 applyRepair tæller en rytter der imens er kommet videre som skipped", async () => {
  const plan = await planRepair({ supabase: makeMock({ riders: [STUCK_22] }), now: NOW });
  const outcome = await applyRepair({
    supabase: makeMock({ riders: [STUCK_22] }),
    plan,
    now: NOW,
    release: async () => ({ released: false, riderId: "r-stuck", reason: "already_resolved" }),
  });
  assert.equal(outcome.released, 0);
  assert.equal(outcome.skipped, 1);
  assert.equal(outcome.results[0].reason, "already_resolved");
});
