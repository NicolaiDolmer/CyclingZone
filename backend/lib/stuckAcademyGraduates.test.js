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

// Alle STUCK_22-fixtures nedenfor bruger som udgangspunkt INGEN grad-række
// (klassificeres "no_graduation_row"), medmindre en graduations-fixture siger
// andet. En fake getMarketState() undgår at røre en "teams"-tabel der ikke
// findes i denne mock — samme injektions-mønster som academyGraduation.test.js
// bruger for resolveGraduation/defaultResolveGraduate.
const marketWithRoomAndFunds = async () => ({ squad_limits: { max: 30 }, future_count: 5, balance: 1000 });
const marketNoRoom = async () => ({ squad_limits: { max: 30 }, future_count: 30, balance: 1000 });
const marketNoFunds = async () => ({ squad_limits: { max: 30 }, future_count: 5, balance: -500 });

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
  const plan = await planRepair({ supabase: makeMock(fixture), now: NOW, getMarketState: marketWithRoomAndFunds });

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
  const plan = await planRepair({ supabase, now: NOW, getMarketState: marketWithRoomAndFunds });
  assert.equal(plan.total_candidates, 2);
  assert.equal(plan.never_offered, 1);
});

// ─── De tre tilstande → de tre handlinger (ejer-beslutning 5/9) ────────────────
// (a) 'sold' uden gennemført salg → release. (b) 'promoted' men is_academy=true
// → fuldfør promoveringen. (c) ingen grad-række → default-kæden (promovér/
// sælg/slip). Dispatchen sker på plan.candidates[].state, ALDRIG på et separat
// "hurtigt" query — se docblokken i repairStuckAcademyGraduates.js.

const R_SOLD = { id: "r-sold-no-sale", team_id: "t1", is_academy: true, is_retired: false, birthdate: bornForSeason3Age(23) };
const R_PROMOTED = { id: "r-promoted-incomplete", team_id: "t2", is_academy: true, is_retired: false, birthdate: bornForSeason3Age(22) };
const R_NEVER = { id: "r-never-graduated", team_id: "t3", is_academy: true, is_retired: false, birthdate: bornForSeason3Age(24) };

function threeStateFixture() {
  return {
    riders: [R_SOLD, R_PROMOTED, R_NEVER],
    graduations: [
      { id: "g-sold", rider_id: "r-sold-no-sale", status: "sold", deadline: "2026-08-01T00:00:00.000Z", created_at: "2026-07-25T00:00:00.000Z" },
      { id: "g-promoted", rider_id: "r-promoted-incomplete", status: "promoted", deadline: "2026-07-01T00:00:00.000Z", created_at: "2026-06-25T00:00:00.000Z" },
    ],
  };
}

test("#4495 planRepair klassificerer de tre tilstande korrekt", async () => {
  const plan = await planRepair({ supabase: makeMock(threeStateFixture()), now: NOW, getMarketState: marketWithRoomAndFunds });
  const byId = Object.fromEntries(plan.candidates.map((c) => [c.rider_id, c]));

  assert.equal(byId["r-sold-no-sale"].state, "sold_no_sale");
  assert.equal(byId["r-sold-no-sale"].action, "release");

  assert.equal(byId["r-promoted-incomplete"].state, "promoted_incomplete");
  assert.equal(byId["r-promoted-incomplete"].action, "promote");

  assert.equal(byId["r-never-graduated"].state, "no_graduation_row");
  assert.equal(byId["r-never-graduated"].action, "promote");
});

test("#4495 planRepair: 'ingen plads' falder til salg (no_graduation_row)", async () => {
  const supabase = makeMock({ riders: [R_NEVER] });
  const plan = await planRepair({ supabase, now: NOW, getMarketState: marketNoRoom });
  assert.equal(plan.candidates[0].state, "no_graduation_row");
  assert.equal(plan.candidates[0].action, "sell");
  assert.equal(plan.candidates[0].has_room, false);
});

test("#4495 planRepair: negativ saldo falder også til salg (no_graduation_row)", async () => {
  const supabase = makeMock({ riders: [R_NEVER] });
  const plan = await planRepair({ supabase, now: NOW, getMarketState: marketNoFunds });
  assert.equal(plan.candidates[0].action, "sell");
  assert.equal(plan.candidates[0].can_afford, false);
});

test("#4495 planRepair: promoted_incomplete UDEN plads kræver manuel gennemgang (ingen automatisk slip)", async () => {
  const supabase = makeMock({
    riders: [R_PROMOTED],
    graduations: [{ id: "g-promoted", rider_id: "r-promoted-incomplete", status: "promoted", deadline: "2026-07-01T00:00:00.000Z", created_at: "2026-06-25T00:00:00.000Z" }],
  });
  const plan = await planRepair({ supabase, now: NOW, getMarketState: marketNoRoom });
  assert.equal(plan.candidates[0].action, "manual_review");
});

test("#4495 applyRepair dispatcher til release/promote/resolveNever efter STATE, ikke handling alene", async () => {
  const fixture = threeStateFixture();
  const plan = await planRepair({ supabase: makeMock(fixture), now: NOW, getMarketState: marketWithRoomAndFunds });

  const releaseCalls = [];
  const promoteCalls = [];
  const resolveNeverCalls = [];
  const outcome = await applyRepair({
    supabase: makeMock(fixture),
    plan,
    seasonNumber: 3,
    now: NOW,
    release: async (_supabase, args) => { releaseCalls.push(args); return { released: true, riderId: args.riderId }; },
    promote: async (_supabase, args) => { promoteCalls.push(args); return { completed: true, riderId: args.riderId, salary: 1000 }; },
    resolveNever: async (_supabase, args) => { resolveNeverCalls.push(args); return { riderId: args.riderId, action: "promoted", salary: 900 }; },
  });

  assert.deepEqual(releaseCalls.map((c) => c.riderId), ["r-sold-no-sale"]);
  assert.deepEqual(promoteCalls.map((c) => c.riderId), ["r-promoted-incomplete"]);
  assert.deepEqual(resolveNeverCalls.map((c) => c.riderId), ["r-never-graduated"]);
  assert.equal(outcome.released, 1);
  assert.equal(outcome.promoted, 2, "1 fra completeStuckPromotion + 1 fra resolveNeverGraduated's promoted-udfald");
  assert.equal(outcome.sold, 0);
  assert.equal(outcome.skipped, 0);
});

test("#4495 applyRepair: manual_review-kandidater rører ALDRIG en af de tre funktioner", async () => {
  const supabase = makeMock({
    riders: [R_PROMOTED],
    graduations: [{ id: "g-promoted", rider_id: "r-promoted-incomplete", status: "promoted", deadline: "2026-07-01T00:00:00.000Z", created_at: "2026-06-25T00:00:00.000Z" }],
  });
  const plan = await planRepair({ supabase, now: NOW, getMarketState: marketNoRoom });
  assert.equal(plan.candidates[0].action, "manual_review");

  let touched = false;
  const outcome = await applyRepair({
    supabase,
    plan,
    seasonNumber: 3,
    now: NOW,
    release: async () => { touched = true; },
    promote: async () => { touched = true; },
    resolveNever: async () => { touched = true; },
  });
  assert.equal(touched, false, "manual_review-kandidater må aldrig udløse en skrivning");
  assert.equal(outcome.skipped, 1);
  assert.equal(outcome.results[0].reason, plan.candidates[0].reason);
});

test("#4495 applyRepair frigiver PRÆCIS dry-run'ens sold_no_sale-kandidat og intet andet", async () => {
  const fixture = { riders: [R_SOLD, YOUNG_21], graduations: [{ id: "g-sold", rider_id: "r-sold-no-sale", status: "sold", deadline: "2026-08-01T00:00:00.000Z", created_at: "2026-07-25T00:00:00.000Z" }] };
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

  assert.deepEqual(calls.map((c) => c.riderId), ["r-sold-no-sale"]);
  assert.deepEqual(calls.map((c) => c.teamId), ["t1"]);
  assert.equal(outcome.released, 1);
  assert.equal(outcome.skipped, 0);
});

test("#4495 applyRepair tæller en rytter der imens er kommet videre som skipped (sold_no_sale)", async () => {
  const fixture = { riders: [R_SOLD], graduations: [{ id: "g-sold", rider_id: "r-sold-no-sale", status: "sold", deadline: "2026-08-01T00:00:00.000Z", created_at: "2026-07-25T00:00:00.000Z" }] };
  const plan = await planRepair({ supabase: makeMock(fixture), now: NOW });
  const outcome = await applyRepair({
    supabase: makeMock(fixture),
    plan,
    now: NOW,
    release: async () => ({ released: false, riderId: "r-sold-no-sale", reason: "already_resolved" }),
  });
  assert.equal(outcome.released, 0);
  assert.equal(outcome.skipped, 1);
  assert.equal(outcome.results[0].reason, "already_resolved");
});

test("#4495 planRepair: en overskredet PENDING grad-række klassificeres pending_overdue → manuel gennemgang (sweepet bør have håndteret den)", async () => {
  const deadline = new Date(NOW.getTime() - (STUCK_GRADUATE_GRACE_HOURS + 1) * 3_600_000).toISOString();
  const supabase = makeMock({
    riders: [STUCK_22],
    graduations: [{ id: "g-overdue", rider_id: "r-stuck", status: "pending", deadline, created_at: "2026-08-20T00:00:00.000Z" }],
  });
  const plan = await planRepair({ supabase, now: NOW });
  assert.equal(plan.candidates[0].state, "pending_overdue");
  assert.equal(plan.candidates[0].action, "manual_review");
});

// "Ingen bud"-stien (auctionFinalization.js's no-bid-gren → releaseUnsoldGraduate)
// er UÆNDRET af dette script — dækket separat i auctionFinalization.test.js.
// Dette script kalder kun releaseUnsoldGraduate for sold_no_sale-tilstanden,
// præcis som før #4495-udvidelsen 5/9.
