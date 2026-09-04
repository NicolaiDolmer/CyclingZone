import test from "node:test";
import assert from "node:assert/strict";

import { runOwnershipInvariantWatch } from "./ownershipInvariantWatch.js";

// In-memory mock af de tre tabeller modulet rører (alle READ-ONLY):
//   auctions:       select(...).in("status",[...]).order().range()
//   riders:         select(...).in("id",[...]).order().range()
//   academy_intake: select(...).eq("status","offered").order().range()
//                   (findStaleOfferedIntake's egen riders-select("id, team_id")
//                    genbruger samme riders-mock)
//   races/race_entries: CYCLINGZONE-48 — invariant E's andet kriterie kalder
//                   getRidersInActiveStageRace, som IKKE pagineres (ingen
//                   .order().range()) men awaites direkte. Derfor er de to
//                   buildere thenable. Default er TOMME lister = "ingen kører
//                   et aktivt etapeløb", hvilket bevarer alle eksisterende
//                   forventninger uændret.
//   seasons/academy_graduation: #4495 — invariant G's prædikat
//                   (stuckAcademyGraduates.findStuckAcademyGraduates) slår den
//                   aktive sæson op (sæson-diskret alder) og filtrerer ryttere
//                   med et åbent/nyligt override-vindue fra. Default-sæsonen
//                   holder de eksisterende fixtures uændrede: ingen af dem har
//                   birthdate, så ageForSeason giver null og ingen bliver flagget.
function makeMock({ auctions = [], riders = [], intake = [], races = [], raceEntries = [], auctionsError = null, teams = [], teamBoardMembers = [], activeSeason = { number: 3 }, graduations = [] } = {}) {
  return {
    from(table) {
      if (table === "seasons") {
        // Eneste query: select("number").eq("status","active").order().limit(1).maybeSingle()
        const b = {
          select() { return b; },
          eq() { return b; },
          order() { return b; },
          limit() { return b; },
          maybeSingle() { return Promise.resolve({ data: activeSeason, error: null }); },
        };
        return b;
      }
      if (table === "academy_graduation") {
        let inIds = null;
        const eqFilters = [];
        const b = {
          select() { return b; },
          in(_col, ids) { inIds = ids; return b; },
          eq(col, val) { eqFilters.push([col, val]); return b; },
          order() { return b; },
          range(from, to) {
            let out = graduations.filter((g) => (inIds ? inIds.includes(g.rider_id) : true));
            out = out.filter((g) => eqFilters.every(([c, v]) => g[c] === v));
            out = out.slice(from, to + 1);
            return Promise.resolve({ data: out, error: null });
          },
        };
        return b;
      }
      if (table === "auctions") {
        const filters = [];
        const b = {
          select() { return b; },
          eq(col, val) { filters.push(["eq", col, val]); return b; },
          in(col, vals) { filters.push(["in", col, vals]); return b; },
          is(col, val) { filters.push(["is", col, val]); return b; },
          order() { return b; },
          range(from, to) {
            if (auctionsError) return Promise.resolve({ data: null, error: auctionsError });
            let out = auctions.filter((r) =>
              filters.every(([op, c, v]) => {
                if (op === "eq") return r[c] === v;
                if (op === "in") return v.includes(r[c]);
                if (op === "is") return (r[c] ?? null) === v;
                return true;
              })
            );
            out = out.slice(from, to + 1);
            return Promise.resolve({ data: out, error: null });
          },
        };
        return b;
      }
      if (table === "riders") {
        // #2257: invariant D's stranded-query bruger eq/is-filtre (ingen .in),
        // #3330: invariant E's pending-query bruger .not("pending_team_id","is",null)
        // (ingen .in), mens A/B's ownership-opslag bruger .in("id", ...) — mocken
        // understøtter alle, samme filter-semantik som auctions-mocken ovenfor.
        let inIds = null;
        const filters = [];
        const b = {
          select() { return b; },
          in(_col, ids) { inIds = ids; return b; },
          eq(col, val) { filters.push(["eq", col, val]); return b; },
          is(col, val) { filters.push(["is", col, val]); return b; },
          not(col, op, val) { if (op === "is") filters.push(["not-is", col, val]); return b; },
          order() { return b; },
          range(from, to) {
            let out = riders.filter((r) => (inIds ? inIds.includes(r.id) : true));
            out = out.filter((r) =>
              filters.every(([op, c, v]) => {
                if (op === "eq") return (r[c] ?? false) === v;
                if (op === "is") return (r[c] ?? null) === v;
                if (op === "not-is") return (r[c] ?? null) !== v;
                return true;
              })
            );
            out = out.slice(from, to + 1);
            return Promise.resolve({ data: out, error: null });
          },
        };
        return b;
      }
      if (table === "academy_intake") {
        const eqFilters = [];
        const b = {
          select() { return b; },
          eq(col, val) { eqFilters.push([col, val]); return b; },
          order() { return b; },
          range(from, to) {
            let out = intake.filter((r) => eqFilters.every(([c, v]) => r[c] === v));
            out = out.slice(from, to + 1);
            return Promise.resolve({
              data: out.map((r) => ({ id: r.id, team_id: r.team_id, rider_id: r.rider_id })),
              error: null,
            });
          },
        };
        return b;
      }
      if (table === "races") {
        const filters = [];
        const b = {
          select() { return b; },
          eq(col, val) { filters.push(["eq", col, val]); return b; },
          neq(col, val) { filters.push(["neq", col, val]); return b; },
          gt(col, val) { filters.push(["gt", col, val]); return b; },
          then(resolve, reject) {
            const out = races.filter((r) =>
              filters.every(([op, c, v]) => {
                if (op === "eq") return r[c] === v;
                if (op === "neq") return r[c] !== v;
                if (op === "gt") return (r[c] ?? 0) > v;
                return true;
              })
            );
            return Promise.resolve({ data: out.map((r) => ({ id: r.id })), error: null }).then(resolve, reject);
          },
        };
        return b;
      }
      if (table === "race_entries") {
        const inFilters = [];
        const b = {
          select() { return b; },
          in(col, vals) { inFilters.push([col, vals]); return b; },
          then(resolve, reject) {
            const out = raceEntries.filter((e) => inFilters.every(([c, v]) => v.includes(e[c])));
            return Promise.resolve({ data: out.map((e) => ({ rider_id: e.rider_id })), error: null }).then(resolve, reject);
          },
        };
        return b;
      }
      if (table === "teams") {
        // Invariant F (#4664): .eq(is_ai) .eq(is_bank) .eq(is_frozen) .eq(is_test_account)
        // .not(season_1_identity_basis, "is", null) .order() .range()
        const eqFilters = [];
        const notNullCols = [];
        const b = {
          select() { return b; },
          eq(col, val) { eqFilters.push([col, val]); return b; },
          not(col, op, val) { if (op === "is" && val === null) notNullCols.push(col); return b; },
          order() { return b; },
          range(from, to) {
            let out = teams.filter((r) => eqFilters.every(([c, v]) => (r[c] ?? false) === v));
            out = out.filter((r) => notNullCols.every((c) => r[c] != null));
            out = out.slice(from, to + 1);
            return Promise.resolve({ data: out, error: null });
          },
        };
        return b;
      }
      if (table === "team_board_members") {
        const inFilters = [];
        const b = {
          select() { return b; },
          in(col, vals) { inFilters.push([col, vals]); return b; },
          order() { return b; },
          range(from, to) {
            let out = teamBoardMembers.filter((r) => inFilters.every(([c, v]) => v.includes(r[c])));
            out = out.slice(from, to + 1);
            return Promise.resolve({ data: out.map((r) => ({ team_id: r.team_id })), error: null });
          },
        };
        return b;
      }
      throw new Error(`uventet tabel: ${table}`);
    },
  };
}

test("#2647 clean fixture — ingen brud, ingen capture, alerted=false", async () => {
  const auctions = [
    { id: "auc-1", rider_id: "r-1", is_youth: true, seller_team_id: null, status: "active" },
    { id: "auc-2", rider_id: "r-2", is_youth: false, seller_team_id: "team-X", status: "active" },
  ];
  const riders = [
    { id: "r-1", team_id: null, pending_team_id: null }, // fri ungdomsrytter — legitimt
    { id: "r-2", team_id: null, pending_team_id: null },
  ];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions, riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
  });
  assert.equal(calls.length, 0);
  assert.equal(result.alerted, false);
  assert.deepEqual(result.findings, { youthOwned: 0, sellerlessOwned: 0, staleIntake: 0, strandedAcademy: 0, stalePendingTransfer: 0, teamsMissingBoardMembers: 0, stuckAcademyGraduates: 0 });
  assert.equal(result.checked, 2);
});

test("#2647 invariant A — hold-ejet rytter (team_id) på aktiv ungdomsauktion alarmerer med fast fingerprint", async () => {
  const auctions = [
    { id: "auc-1", rider_id: "r-1", is_youth: true, seller_team_id: null, status: "active" },
    { id: "auc-2", rider_id: "r-2", is_youth: true, seller_team_id: null, status: "extended" },
  ];
  const riders = [
    { id: "r-1", team_id: "team-A", pending_team_id: null },
    // pending_team_id tæller også som ejet (invariant A). #3330: updated_at
    // sat FRISK (1t gammel) så denne legitime parkering ikke også trigger'er
    // invariant E (stale pending transfer) — de to invarianter er uafhængige.
    { id: "r-2", team_id: null, pending_team_id: "team-B", updated_at: "2026-07-03T10:00:00Z" },
  ];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions, riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
    now: new Date("2026-07-03T11:00:00Z"),
    sleepFn: async () => {}, // CYCLINGZONE-4M: settle stubbet — fixturen ændrer sig ikke
  });
  assert.equal(calls.length, 1, "kun ÉN capture uanset antal findings");
  assert.deepEqual(calls[0].ctx.fingerprint, ["owned-rider-on-youth-auction"]);
  assert.deepEqual(calls[0].ctx.tags, { cron: "ownership-invariant-watch" });
  assert.equal(calls[0].ctx.extra.count, 2);
  assert.equal(calls[0].ctx.extra.sample.length, 2);
  assert.equal(result.findings.youthOwned, 2);
  assert.equal(result.alerted, true);
});

test("#2647 invariant A — FRI rytter (team_id null) på aktiv ungdomsauktion alarmerer IKKE", async () => {
  const auctions = [
    { id: "auc-1", rider_id: "r-1", is_youth: true, seller_team_id: null, status: "active" },
  ];
  const riders = [{ id: "r-1", team_id: null, pending_team_id: null }];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions, riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
  });
  assert.equal(calls.length, 0);
  assert.equal(result.findings.youthOwned, 0);
  assert.equal(result.alerted, false);
});

test("#2647 invariant B — hold-ejet rytter på sælgerløs, ikke-ungdoms, AKTIV auktion alarmerer med fast fingerprint", async () => {
  const auctions = [
    { id: "auc-1", rider_id: "r-1", is_youth: false, seller_team_id: null, status: "active" },
  ];
  const riders = [{ id: "r-1", team_id: "team-A", pending_team_id: null }];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions, riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
    sleepFn: async () => {}, // CYCLINGZONE-4M
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].ctx.fingerprint, ["owned-rider-on-sellerless-auction"]);
  assert.equal(calls[0].ctx.extra.count, 1);
  assert.equal(result.findings.sellerlessOwned, 1);
  assert.equal(result.alerted, true);
});

test("#2647 invariant B — status-scoping: COMPLETED/CANCELLED sælgerløs hold-ejet auktion alarmerer IKKE (auctionFinalization nulstiller seller_team_id ved completion)", async () => {
  const auctions = [
    { id: "auc-1", rider_id: "r-1", is_youth: false, seller_team_id: null, status: "completed" },
    { id: "auc-2", rider_id: "r-2", is_youth: false, seller_team_id: null, status: "cancelled" },
  ];
  const riders = [
    { id: "r-1", team_id: "team-A", pending_team_id: null },
    { id: "r-2", team_id: "team-B", pending_team_id: null },
  ];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions, riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
  });
  assert.equal(calls.length, 0, "uden status-scoping ville dette false-positive på HVER completed sale");
  assert.equal(result.findings.sellerlessOwned, 0);
  assert.equal(result.checked, 0, "completed/cancelled rækker hentes slet ikke — fetchActiveAuctions scoper i selve queryen");
  assert.equal(result.alerted, false);
});

test("#2647 invariant B — completed YOUTH-auktion med hold-ejet rytter alarmerer heller IKKE (samme status-scoping)", async () => {
  const auctions = [
    { id: "auc-1", rider_id: "r-1", is_youth: true, seller_team_id: null, status: "completed" },
  ];
  const riders = [{ id: "r-1", team_id: "team-A", pending_team_id: null }];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions, riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
  });
  assert.equal(calls.length, 0);
  assert.equal(result.findings.youthOwned, 0);
});

test("#2647 invariant C — stale offered academy_intake for ejet rytter alarmerer med fast fingerprint (genbrug af findStaleOfferedIntake)", async () => {
  const intake = [
    { id: "i-1", team_id: "team-A", rider_id: "r-1", status: "offered" }, // ejet af team-A → stale
    { id: "i-2", team_id: "team-A", rider_id: "r-2", status: "offered" }, // fri rytter → ikke stale
  ];
  const riders = [
    { id: "r-1", team_id: "team-A", pending_team_id: null },
    { id: "r-2", team_id: null, pending_team_id: null },
  ];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions: [], riders, intake }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].ctx.fingerprint, ["stale-offered-intake-owned-rider"]);
  assert.equal(calls[0].ctx.extra.count, 1);
  assert.equal(calls[0].ctx.extra.sample[0].intakeId, "i-1");
  assert.equal(result.findings.staleIntake, 1);
  assert.equal(result.alerted, true);
});

test("#2647 invariant C — ingen stale intake → alerted=false, captureExceptionFn ikke kaldt", async () => {
  const intake = [{ id: "i-1", team_id: "team-A", rider_id: "r-1", status: "offered" }];
  const riders = [{ id: "r-1", team_id: null, pending_team_id: null }]; // fri — legitimt åbent tilbud
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions: [], riders, intake }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
  });
  assert.equal(calls.length, 0);
  assert.equal(result.findings.staleIntake, 0);
  assert.equal(result.alerted, false);
});

test("#2647 alle tre invarianter brudt samtidig → tre separate captures, hver med sit eget faste fingerprint", async () => {
  const auctions = [
    { id: "auc-1", rider_id: "r-1", is_youth: true, seller_team_id: null, status: "active" },
    { id: "auc-2", rider_id: "r-2", is_youth: false, seller_team_id: null, status: "extended" },
  ];
  const riders = [
    { id: "r-1", team_id: "team-A", pending_team_id: null },
    { id: "r-2", team_id: "team-B", pending_team_id: null },
    { id: "r-3", team_id: "team-C", pending_team_id: null },
  ];
  const intake = [{ id: "i-1", team_id: "team-X", rider_id: "r-3", status: "offered" }];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions, riders, intake }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
    sleepFn: async () => {}, // CYCLINGZONE-4M
  });
  assert.equal(calls.length, 3);
  const fingerprints = calls.map((c) => c.ctx.fingerprint[0]).sort();
  assert.deepEqual(fingerprints, [
    "owned-rider-on-sellerless-auction",
    "owned-rider-on-youth-auction",
    "stale-offered-intake-owned-rider",
  ]);
  assert.equal(result.alerted, true);
});

test("#2647 query-fejl på auctions kaster (så trackedTick/monitorCron kan se DB-fejlen)", async () => {
  const supabase = makeMock({ auctionsError: { message: "permission denied for table auctions", code: "42501" } });
  await assert.rejects(() =>
    runOwnershipInvariantWatch({ supabase, captureExceptionFn: () => {} })
  );
});

test("#2647 kræver supabase-klient", async () => {
  await assert.rejects(
    () => runOwnershipInvariantWatch({ supabase: null, captureExceptionFn: () => {} }),
    /Supabase client required/
  );
});

// ─── #2257 · invariant D: strandet akademi-fri-agent ─────────────────────────

test("#2257 strandet akademi-fri-agent (is_academy, alt tilhørsforhold NULL) → capture med fast fingerprint", async () => {
  const riders = [
    // Strandet: is_academy uden team/ai-team/pending — skal fanges.
    { id: "r-stranded", firstname: "Blake", lastname: "Reid", is_academy: true, is_retired: false, team_id: null, ai_team_id: null, pending_team_id: null },
    // Frit AI-akademi-prospekt (ai_team_id sat) — LEGITIM tilstand, må ikke flagges.
    { id: "r-ai-prospect", is_academy: true, is_retired: false, team_id: null, ai_team_id: "ai-1", pending_team_id: null },
    // Almindelig akademirytter på menneskehold — legitim.
    { id: "r-academy-owned", is_academy: true, is_retired: false, team_id: "team-A", ai_team_id: null, pending_team_id: null },
    // Pensioneret strandet — ignoreres (ude af spillet).
    { id: "r-retired", is_academy: true, is_retired: true, team_id: null, ai_team_id: null, pending_team_id: null },
  ];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
  });
  assert.equal(result.findings.strandedAcademy, 1, "kun den reelt strandede rytter tælles");
  assert.equal(result.alerted, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].ctx.fingerprint, ["stranded-academy-free-agent"]);
  assert.equal(calls[0].ctx.extra.count, 1);
  assert.equal(calls[0].ctx.extra.sample[0].id, "r-stranded");
});

test("#2257 ren base (ingen strandede) → strandedAcademy=0, ingen capture", async () => {
  const riders = [
    { id: "r-ai-prospect", is_academy: true, is_retired: false, team_id: null, ai_team_id: "ai-1", pending_team_id: null },
    { id: "r-free-senior", is_academy: false, is_retired: false, team_id: null, ai_team_id: null, pending_team_id: null },
  ];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
  });
  assert.equal(result.findings.strandedAcademy, 0);
  assert.equal(calls.length, 0);
  assert.equal(result.alerted, false);
});

// ─── #3330 · invariant E: stale pending_team_id-parkering ────────────────────

test("#3330 syntetisk rytter med GAMMEL pending_team_id (>48t) → invariant-brud med fast fingerprint", async () => {
  // Vasco Fernandes-scenariet: pending_team_id sat, updated_at 40+ dage gammel.
  const riders = [
    {
      id: "r-vasco", firstname: "Vasco", lastname: "Fernandes",
      team_id: "team-seller", pending_team_id: "team-buyer",
      updated_at: "2026-06-22T13:48:45Z",
    },
  ];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
    now: new Date("2026-08-04T12:00:00Z"),
  });
  assert.equal(result.findings.stalePendingTransfer, 1);
  assert.equal(result.alerted, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].ctx.fingerprint, ["stale-pending-team-id-transfer"]);
  assert.equal(calls[0].ctx.extra.count, 1);
  assert.equal(calls[0].ctx.extra.sample[0].riderId, "r-vasco");
  assert.equal(calls[0].ctx.extra.sample[0].pendingTeamId, "team-buyer");
});

test("#3330 FRISK pending_team_id (< 48t) → INGEN invariant-brud (legitim igangværende deferral, #1995)", async () => {
  const riders = [
    {
      id: "r-mid-race", team_id: "team-seller", pending_team_id: "team-buyer",
      updated_at: "2026-08-04T06:00:00Z", // 6t gammel
    },
  ];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
    now: new Date("2026-08-04T12:00:00Z"),
  });
  assert.equal(result.findings.stalePendingTransfer, 0);
  assert.equal(calls.length, 0);
  assert.equal(result.alerted, false);
});

test("#3330 PRÆCIS på 48t-grænsen tæller IKKE med (strengt > tærsklen, ikke >=)", async () => {
  const riders = [
    { id: "r-exact", team_id: "team-seller", pending_team_id: "team-buyer", updated_at: "2026-08-02T12:00:00Z" },
  ];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ riders }),
    captureExceptionFn: () => {},
    now: new Date("2026-08-04T12:00:00Z"),
  });
  assert.equal(result.findings.stalePendingTransfer, 0);
});

test("#3330 pending_team_id NULL → ingen kandidat overhovedet (query-filteret server-side)", async () => {
  const riders = [{ id: "r-free", team_id: "team-a", pending_team_id: null, updated_at: "2020-01-01T00:00:00Z" }];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ riders }),
    captureExceptionFn: () => {},
  });
  assert.equal(result.findings.stalePendingTransfer, 0);
});

test("#3330 pending_team_id sat men updated_at MANGLER (NULL) → fail-closed, tæller som stale", async () => {
  const riders = [{ id: "r-unknown-age", team_id: "team-seller", pending_team_id: "team-buyer", updated_at: null }];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ riders }),
    captureExceptionFn: () => {},
  });
  assert.equal(result.findings.stalePendingTransfer, 1, "ukendt alder er IKKE bevis for friskhed — fail-closed");
});

test("#3330 pendingTransferStaleHours-override styrer tærsklen (test-injektion)", async () => {
  const riders = [
    { id: "r-2h-old", team_id: "team-seller", pending_team_id: "team-buyer", updated_at: "2026-08-04T10:00:00Z" },
  ];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ riders }),
    captureExceptionFn: () => {},
    now: new Date("2026-08-04T12:00:00Z"), // 2t gammel
    pendingTransferStaleHours: 1, // strammere tærskel end default 48t
  });
  assert.equal(result.findings.stalePendingTransfer, 1, "med en 1t-tærskel er en 2t-gammel parkering stale");
});

// ─── CYCLINGZONE-48 · invariant E's ANDET kriterie: stadig i aktivt etapeløb ──
// Rod-årsag 8/8: 48t-tærsklen antog at et fleretape-løb altid var afviklet
// inden for 2 døgn. Prod modbeviste det (4-etape-løb, 55t+ realtid, 3/4 etaper
// kørt) → vagten alarmerede dagligt på en HELT lovlig, igangværende deferral.
// Invariant E kræver nu BEGGE dele: gammel parkering OG intet aktivt løb.

test("CYCLINGZONE-48 gammel parkering MEN rytteren er stadig i aktivt etapeløb → INTET brud", async () => {
  const riders = [
    {
      id: "r-long-stage-race", team_id: "team-seller", pending_team_id: "team-buyer",
      updated_at: "2026-08-06T21:52:35Z", // 55t gammel — over 48t-tærsklen
    },
  ];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
    now: new Date("2026-08-09T05:00:00Z"),
    // Prod-scenariet: rytteren kører stadig "O Gran Camiño Menor" (3/4 etaper).
    getRidersInActiveStageRaceFn: async () => ["r-long-stage-race"],
  });
  assert.equal(result.findings.stalePendingTransfer, 0, "lovlig igangværende deferral må ALDRIG alarmere, uanset alder");
  assert.equal(calls.length, 0);
  assert.equal(result.alerted, false);
});

test("CYCLINGZONE-48 gammel parkering OG løbet er ovre → brud (Vasco-klassen fanges uændret)", async () => {
  const riders = [
    {
      id: "r-vasco", team_id: "team-seller", pending_team_id: "team-buyer",
      updated_at: "2026-06-22T13:48:45Z",
    },
  ];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
    now: new Date("2026-08-04T12:00:00Z"),
    getRidersInActiveStageRaceFn: async () => [], // intet aktivt løb
  });
  assert.equal(result.findings.stalePendingTransfer, 1, "heal-sweepen burde have repareret denne — backstoppet skal stadig fyre");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].ctx.fingerprint, ["stale-pending-team-id-transfer"]);
});

test("CYCLINGZONE-48 blandet: én i løb + én uden løb → kun den uden løb tælles", async () => {
  const riders = [
    { id: "r-racing", team_id: "t1", pending_team_id: "t2", updated_at: "2026-06-01T00:00:00Z" },
    { id: "r-stranded", team_id: "t3", pending_team_id: "t4", updated_at: "2026-06-01T00:00:00Z" },
  ];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
    now: new Date("2026-08-04T12:00:00Z"),
    getRidersInActiveStageRaceFn: async () => ["r-racing"],
  });
  assert.equal(result.findings.stalePendingTransfer, 1);
  assert.equal(calls[0].ctx.extra.sample.length, 1);
  assert.equal(calls[0].ctx.extra.sample[0].riderId, "r-stranded");
});

test("CYCLINGZONE-48 ingen alders-kandidater → race-opslaget kaldes SLET IKKE (ingen ekstra queries pr. tick)", async () => {
  const riders = [
    { id: "r-fresh", team_id: "t1", pending_team_id: "t2", updated_at: "2026-08-04T10:00:00Z" }, // 2t gammel
  ];
  let lookupCalls = 0;
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ riders }),
    captureExceptionFn: () => {},
    now: new Date("2026-08-04T12:00:00Z"),
    getRidersInActiveStageRaceFn: async () => { lookupCalls += 1; return []; },
  });
  assert.equal(result.findings.stalePendingTransfer, 0);
  assert.equal(lookupCalls, 0, "vagten kører dagligt — den normale 0-kandidat-tick må ikke koste to ekstra queries");
});

test("CYCLINGZONE-48 ÆGTE diskriminator (ingen DI-stub) mod races/race_entries — aktivt etapeløb dæmper alarmen", async () => {
  // Ingen getRidersInActiveStageRaceFn-injektion her: dette kører den RIGTIGE
  // getRidersInActiveStageRace mod mock-tabellerne, så query-formen (race_type/
  // status/stages_completed + entry-opslag) er dækket, ikke kun kald-kontrakten.
  const riders = [
    { id: "r-in-race", team_id: "t1", pending_team_id: "t2", updated_at: "2026-06-01T00:00:00Z" },
    { id: "r-no-race", team_id: "t3", pending_team_id: "t4", updated_at: "2026-06-01T00:00:00Z" },
  ];
  const races = [
    // Aktivt: stage_race, ikke completed, mindst én etape kørt.
    { id: "race-active", race_type: "stage_race", status: "scheduled", stages_completed: 3 },
    // Afsluttet — må IKKE dæmpe.
    { id: "race-done", race_type: "stage_race", status: "completed", stages_completed: 4 },
    // Endagsløb — må IKKE dæmpe.
    { id: "race-oneday", race_type: "one_day", status: "scheduled", stages_completed: 1 },
  ];
  const raceEntries = [
    { race_id: "race-active", rider_id: "r-in-race" },
    { race_id: "race-done", rider_id: "r-no-race" },
    { race_id: "race-oneday", rider_id: "r-no-race" },
  ];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ riders, races, raceEntries }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
    now: new Date("2026-08-04T12:00:00Z"),
  });
  assert.equal(result.findings.stalePendingTransfer, 1);
  assert.equal(calls[0].ctx.extra.sample[0].riderId, "r-no-race",
    "kun rytteren uden aktivt etapeløb er et brud — afsluttet løb og endagsløb dæmper ikke");
});

test("#3330 flere stale pending-parkeringer → ÉN capture med alle i sample, ikke én pr. rytter", async () => {
  const riders = [
    { id: "r-a", team_id: "t1", pending_team_id: "t2", updated_at: "2026-06-01T00:00:00Z" },
    { id: "r-b", team_id: "t3", pending_team_id: "t4", updated_at: "2026-06-15T00:00:00Z" },
  ];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
    now: new Date("2026-08-04T12:00:00Z"),
  });
  assert.equal(result.findings.stalePendingTransfer, 2);
  assert.equal(calls.length, 1, "ét Sentry-issue uanset antal findings (CYCLINGZONE-31-lektien)");
  assert.equal(calls[0].ctx.extra.count, 2);
  assert.equal(calls[0].ctx.extra.sample.length, 2);
});

// ─── CYCLINGZONE-4M: TOCTOU mod auctionFinalizations hale ────────────────────
// auctionFinalization skriver riders.team_id FØR den lukker auktionen (der er
// clearFutureRaceEntries + ownership-event + debit + Discord-DM'er imellem), så
// "aktiv ungdomsauktion + hold-ejet rytter" er transient SAND ved hver eneste
// gennemførte ungdomsauktion. Vagten læser auktioner og ryttere i to separate
// queries og ramte præcis det vindue 22/8 kl. 14:00:26 (auktion 7ac6f845).
// Fixturerne herunder muterer INDE i sleepFn — det er netop det der sker i prod
// mens vagten venter.

test("CYCLINGZONE-4M finaliserings-hale: auktionen lukkes under settle → INGEN alarm", async () => {
  const auctions = [{ id: "auc-1", rider_id: "r-1", is_youth: true, seller_team_id: null, status: "active" }];
  const riders = [{ id: "r-1", team_id: "team-A", pending_team_id: null }];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions, riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
    // closeAuction lander mens vi venter — præcis prod-forløbet.
    sleepFn: async () => { auctions[0].status = "completed"; },
  });
  assert.equal(calls.length, 0, "en finaliserings-hale må ALDRIG alarmere");
  assert.equal(result.findings.youthOwned, 0);
  assert.equal(result.alerted, false);
});

test("CYCLINGZONE-4M ejerskabet forsvinder under settle (auktion stadig åben) → INGEN alarm", async () => {
  const auctions = [{ id: "auc-1", rider_id: "r-1", is_youth: true, seller_team_id: null, status: "active" }];
  const riders = [{ id: "r-1", team_id: "team-A", pending_team_id: null }];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions, riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
    sleepFn: async () => { riders[0].team_id = null; },
  });
  assert.equal(calls.length, 0, "begge ben skal holde ved genlæsningen");
  assert.equal(result.findings.youthOwned, 0);
});

test("CYCLINGZONE-4M ÆGTE brud er persistent og overlever settle → alarmerer uændret", async () => {
  const auctions = [
    { id: "auc-1", rider_id: "r-1", is_youth: true, seller_team_id: null, status: "active" },
    { id: "auc-2", rider_id: "r-2", is_youth: false, seller_team_id: null, status: "extended" },
  ];
  const riders = [
    { id: "r-1", team_id: "team-A", pending_team_id: null },
    { id: "r-2", team_id: "team-B", pending_team_id: null },
  ];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions, riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
    sleepFn: async () => {}, // intet ændrer sig — tilstanden er reelt brudt
  });
  assert.equal(result.findings.youthOwned, 1);
  assert.equal(result.findings.sellerlessOwned, 1);
  assert.equal(calls.length, 2, "detektionen af ægte brud er uændret");
  assert.equal(result.alerted, true);
});

test("CYCLINGZONE-4M blandet: den ene auktion lukkes, den anden består → kun den bestående alarmerer", async () => {
  const auctions = [
    { id: "auc-hale", rider_id: "r-1", is_youth: true, seller_team_id: null, status: "active" },
    { id: "auc-aegte", rider_id: "r-2", is_youth: true, seller_team_id: null, status: "active" },
  ];
  const riders = [
    { id: "r-1", team_id: "team-A", pending_team_id: null },
    { id: "r-2", team_id: "team-B", pending_team_id: null },
  ];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions, riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
    sleepFn: async () => { auctions[0].status = "completed"; },
  });
  assert.equal(result.findings.youthOwned, 1);
  assert.equal(calls[0].ctx.extra.sample.length, 1);
  assert.equal(calls[0].ctx.extra.sample[0].auctionId, "auc-aegte");
});

test("CYCLINGZONE-4M ren tick: settle ventes ALDRIG når der intet fund er (0-fund-tick er gratis)", async () => {
  const auctions = [{ id: "auc-1", rider_id: "r-1", is_youth: true, seller_team_id: null, status: "active" }];
  const riders = [{ id: "r-1", team_id: null, pending_team_id: null }];
  let slept = 0;
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions, riders }),
    captureExceptionFn: () => {},
    sleepFn: async () => { slept += 1; },
  });
  assert.equal(slept, 0, "den daglige 0-fund-tick må ikke koste ventetid");
  assert.equal(result.alerted, false);
});

test("CYCLINGZONE-4M samplet viser ejerskabet EFTER genlæsningen, ikke det forældede", async () => {
  const auctions = [{ id: "auc-1", rider_id: "r-1", is_youth: true, seller_team_id: null, status: "active" }];
  const riders = [{ id: "r-1", team_id: "team-GAMMEL", pending_team_id: null }];
  const calls = [];
  await runOwnershipInvariantWatch({
    supabase: makeMock({ auctions, riders }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
    sleepFn: async () => { riders[0].team_id = "team-NY"; },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ctx.extra.sample[0].teamId, "team-NY");
});

// ─── Invariant F (#4664): menneskehold uden bestyrelsesmedlemmer ────────────

test("#4664 alarmerer på et menneskehold uden nogen bestyrelsesmedlemmer", async () => {
  const teams = [
    { id: "team-1", name: "Boardless FC", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, season_1_identity_basis: { rider_count: 12 }, team_dna_key: "fransk_klatrer" },
  ];
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ teams, teamBoardMembers: [] }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
  });
  assert.equal(result.findings.teamsMissingBoardMembers, 1);
  assert.equal(result.alerted, true);
  const f4664Call = calls.find((c) => c.ctx.fingerprint?.[0] === "human-team-without-board-members");
  assert.ok(f4664Call, "invariant F skal capture med sit eget faste fingerprint");
  assert.equal(f4664Call.ctx.extra.sample[0].name, "Boardless FC");
});

test("#4664 alarmerer på et hold med kun 3 af 5 medlemmer (delvis brud tæller også)", async () => {
  const teams = [
    { id: "team-1", name: "Half Board FC", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, season_1_identity_basis: { rider_count: 12 }, team_dna_key: null },
  ];
  const teamBoardMembers = [
    { team_id: "team-1", archetype_key: "gc_elsker" },
    { team_id: "team-1", archetype_key: "sponsoraten" },
    { team_id: "team-1", archetype_key: "traditionalisten" },
  ];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ teams, teamBoardMembers }),
    captureExceptionFn: () => {},
  });
  assert.equal(result.findings.teamsMissingBoardMembers, 1);
});

test("#4664 ingen alarm når holdet har alle 5 medlemmer", async () => {
  const teams = [
    { id: "team-1", name: "Full Board FC", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, season_1_identity_basis: { rider_count: 12 }, team_dna_key: "fransk_klatrer" },
  ];
  const teamBoardMembers = Array.from({ length: 5 }, (_, i) => ({ team_id: "team-1", archetype_key: `arch-${i}` }));
  const calls = [];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ teams, teamBoardMembers }),
    captureExceptionFn: (err, ctx) => calls.push({ err, ctx }),
  });
  assert.equal(result.findings.teamsMissingBoardMembers, 0);
  assert.equal(result.alerted, false);
  assert.equal(calls.length, 0);
});

test("#4664 springer AI-, bank-, frosne og test-hold over, samt hold uden identity_basis endnu", async () => {
  const teams = [
    { id: "ai-1", name: "AI Team", is_ai: true, is_bank: false, is_frozen: false, is_test_account: false, season_1_identity_basis: { rider_count: 12 } },
    { id: "bank-1", name: "Bank", is_ai: false, is_bank: true, is_frozen: false, is_test_account: false, season_1_identity_basis: { rider_count: 12 } },
    { id: "frozen-1", name: "Frozen FC", is_ai: false, is_bank: false, is_frozen: true, is_test_account: false, season_1_identity_basis: { rider_count: 12 } },
    { id: "test-1", name: "TestHoldet", is_ai: false, is_bank: false, is_frozen: false, is_test_account: true, season_1_identity_basis: { rider_count: 12 } },
    { id: "brand-new-1", name: "Brand New FC", is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, season_1_identity_basis: null },
  ];
  const result = await runOwnershipInvariantWatch({
    supabase: makeMock({ teams, teamBoardMembers: [] }),
    captureExceptionFn: () => {},
  });
  assert.equal(result.findings.teamsMissingBoardMembers, 0, "ingen af de fem skal tælle med");
});
