// #2530 — Talentspejder-facilitetsspor LIVE (EFFECT_LIVE_BY_TRACK.scouting=true).
// Beviser den FULDE kæde på tværs af de tre moduler UI'et binder sammen:
//   facilityService.purchaseFacilityUpgrade (køb tier)
//     → staffCandidates.generateStaffCandidates (kandidater bounded af KØBT tier)
//       → facilityService.hireStaff (ansæt)
//         → scoutAssignmentService.getScoutState (Scouting-central læser den
//           HYREDE spejder, ikke DEFAULT_SCOUT — kapacitet/præcisions-gulv følger
//           hans overall, jf. scoutEngine.js).
// Mock-mønster spejler facilityService.test.js + scoutAssignmentService.test.js
// (in-memory state, delt på tværs af de to services så én hire ses af begge).
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost";
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "test-service-key";

const { purchaseFacilityUpgrade, hireStaff } = await import("./facilityService.js");
const { generateStaffCandidates } = await import("./staffCandidates.js");
const { getScoutState, startMission } = await import("./scoutAssignmentService.js");
const { scoutCapacity, minHalfWidthByScoutRating } = await import("./scoutEngine.js");

const ENABLED = { facilitiesEnabled: true };

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// Kombineret in-memory-mock: dækker tabellerne begge services rammer
// (teams, team_facilities, team_staff, staff_derived_abilities, scout_assignments),
// med ÉT delt state-objekt så en hire skrevet af facilityService læses tilbage
// af scoutAssignmentService i samme test.
function createChainSupabase({ team }) {
  const state = {
    team: clone(team),
    facilities: [],
    staff: [],
    abilities: [],
    assignments: [],
    finance_transactions: [],
  };

  return {
    state,
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      state.team.balance = (state.team.balance ?? 0) + params.p_delta;
      state.finance_transactions.push({ team_id: params.p_team_id, ...params.p_finance_payload });
      return Promise.resolve({ data: state.team.balance, error: null });
    },
    from(table) {
      if (table === "teams") {
        return {
          select(columns) {
            assert.equal(columns, "balance");
            return {
              eq(column, value) {
                assert.equal(column, "id");
                assert.equal(value, state.team.id);
                return { single: () => Promise.resolve({ data: { balance: state.team.balance }, error: null }) };
              },
            };
          },
        };
      }

      if (table === "team_facilities") {
        return {
          select(columns) {
            assert.equal(columns, "tier");
            const filters = {};
            const chain = {
              eq(column, value) { filters[column] = value; return chain; },
              maybeSingle() {
                const row = state.facilities.find(
                  (f) => f.team_id === filters.team_id && f.track === filters.track
                ) || null;
                return Promise.resolve({ data: row ? { tier: row.tier } : null, error: null });
              },
            };
            return chain;
          },
          upsert(payload, options) {
            assert.deepEqual(options, { onConflict: "team_id,track" });
            const idx = state.facilities.findIndex(
              (f) => f.team_id === payload.team_id && f.track === payload.track
            );
            if (idx >= 0) state.facilities[idx] = { ...state.facilities[idx], ...payload };
            else state.facilities.push(clone(payload));
            return Promise.resolve({ error: null });
          },
        };
      }

      if (table === "team_staff") {
        return {
          select() {
            const filters = {};
            const chain = {
              eq(column, value) { filters[column] = value; return chain; },
              maybeSingle() {
                const row = state.staff.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v)) || null;
                return Promise.resolve({ data: row ? clone(row) : null, error: null });
              },
            };
            return chain;
          },
          insert(payload) {
            const row = { id: `staff-${state.staff.length + 1}`, ...clone(payload) };
            state.staff.push(row);
            return {
              error: null,
              then(resolve) { return resolve({ error: null }); },
              select() { return { single: () => Promise.resolve({ data: { id: row.id }, error: null }) }; },
            };
          },
        };
      }

      if (table === "staff_derived_abilities") {
        return {
          select() {
            const filters = {};
            const chain = {
              eq(column, value) { filters[column] = value; return chain; },
              maybeSingle() {
                const row = state.abilities.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v)) || null;
                return Promise.resolve({ data: row ? clone(row) : null, error: null });
              },
            };
            return chain;
          },
          upsert(payload, options) {
            assert.deepEqual(options, { onConflict: "staff_id" });
            const idx = state.abilities.findIndex((a) => a.staff_id === payload.staff_id);
            if (idx >= 0) state.abilities[idx] = { ...state.abilities[idx], ...payload };
            else state.abilities.push(clone(payload));
            return Promise.resolve({ error: null });
          },
        };
      }

      if (table === "scout_assignments") {
        return {
          select() {
            const filters = {};
            let limitN = null;
            const chain = {
              eq(column, value) { filters[column] = value; return chain; },
              order() { return chain; },
              limit(n) { limitN = n; return chain; },
              then(resolve) {
                let rows = state.assignments.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
                if (limitN != null) rows = rows.slice(0, limitN);
                return Promise.resolve({ data: clone(rows), error: null }).then(resolve);
              },
            };
            return chain;
          },
          // #2580: startMission/startTargetAssignment kalder .insert(...).select("id").single() —
          // nødvendig for regressionstesten der starter en mission FØR facilitetskøb/hire.
          insert(payload) {
            const row = { id: `assign-${state.assignments.length + 1}`, status: "active", ...clone(payload) };
            state.assignments.push(row);
            return { select() { return { single: () => Promise.resolve({ data: { id: row.id }, error: null }) }; } };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("#2530: scouting-facilitet LIVE — købt tier bounder hire-tier, hyret chefscout erstatter DEFAULT_SCOUT", async () => {
  const supabase = createChainSupabase({ team: { id: "team-1", balance: 1_000_000 } });

  // 1) Byg scouting-faciliteten op til tier 5, ét trin ad gangen (som Klub-UI'en gør).
  for (let i = 0; i < 5; i++) {
    const result = await purchaseFacilityUpgrade(
      { teamId: "team-1", track: "scouting", seasonId: "season-1", seasonNumber: 1 },
      supabase,
      ENABLED
    );
    assert.equal(result.ok, true, `tier-opgradering ${i + 1} skal lykkes`);
  }
  assert.equal(supabase.state.facilities[0].tier, 5);

  // 2) Kandidater for role=scouting bounder nu op til den KØBTE tier (5) — ikke tier 0.
  const candidates = generateStaffCandidates({ teamId: "team-1", seasonNumber: 1, role: "scouting", facilityTier: 5 });
  assert.ok(candidates.every((c) => c.tier >= 1 && c.tier <= 5));
  // Determinisk seed for (team-1, season 1, scouting): højeste kandidat-tier er 3.
  const candidate = candidates.reduce((best, c) => (c.tier > best.tier ? c : best), candidates[0]);

  // 3) Ansæt via facilityService.hireStaff — samme sti StaffPanel/API'et bruger.
  const hireResult = await hireStaff(
    { teamId: "team-1", role: "scouting", candidateName: candidate.name, seasonId: "season-1", seasonNumber: 1 },
    supabase,
    ENABLED
  );
  assert.equal(hireResult.ok, true);
  assert.equal(supabase.state.staff.length, 1);
  assert.equal(supabase.state.staff[0].status, "active");
  assert.equal(supabase.state.abilities.length, 1);

  // 4) scoutAssignmentService.getScoutState() (Scouting-central-siden) skal nu
  //    returnere den HYREDE spejder — ikke DEFAULT_SCOUT — med kapacitet og
  //    præcisions-gulv der følger hans faktiske overall.
  const scoutState = await getScoutState("team-1", supabase);
  assert.equal(scoutState.scout.isDefault, false, "hyret spejder må ikke rapporteres som DEFAULT_SCOUT");
  assert.equal(scoutState.scout.name, candidate.name);
  assert.equal(scoutState.scout.overall, supabase.state.abilities[0].overall);
  assert.equal(scoutState.capacity, scoutCapacity(scoutState.scout));
  // Præcisions-gulvet (halvbredde) er nu drevet af den ægte spejders overall, ikke
  // DEFAULT_SCOUT's faste 40 — eksplicit sammenhæng med scoutEngine's SSOT-formel.
  assert.equal(
    minHalfWidthByScoutRating(scoutState.scout.overall),
    minHalfWidthByScoutRating(supabase.state.abilities[0].overall)
  );
});

test("#2530: topspejder (overall>=80) fra en tier-5-facilitet giver kapacitet 2 gennem HELE kæden", async () => {
  const supabase = createChainSupabase({ team: { id: "team-2", balance: 1_000_000 } });

  for (let i = 0; i < 5; i++) {
    await purchaseFacilityUpgrade(
      { teamId: "team-2", track: "scouting", seasonId: "season-1", seasonNumber: 1 },
      supabase,
      ENABLED
    );
  }
  assert.equal(supabase.state.facilities[0].tier, 5);

  // Determinisk seed for (team-2, season 1, scouting): topkandidaten er tier 5 / overall 86.
  const candidates = generateStaffCandidates({ teamId: "team-2", seasonNumber: 1, role: "scouting", facilityTier: 5 });
  const topCandidate = candidates.reduce((best, c) => (c.overall > best.overall ? c : best), candidates[0]);
  assert.equal(topCandidate.tier, 5);
  assert.ok(topCandidate.overall >= 80, `test-fixturen forudsætter en overall>=80-kandidat, fik ${topCandidate.overall}`);

  const hireResult = await hireStaff(
    { teamId: "team-2", role: "scouting", candidateName: topCandidate.name, seasonId: "season-1", seasonNumber: 1 },
    supabase,
    ENABLED
  );
  assert.equal(hireResult.ok, true);

  const scoutState = await getScoutState("team-2", supabase);
  assert.equal(scoutState.scout.overall, topCandidate.overall);
  assert.equal(scoutState.capacity, 2, "overall>=80 skal give kapacitet 2 (spec beslutning 2, scoutEngine.js)");
});

test("#2530: uden hyret spejder (kun facilitets-tier købt) falder getScoutState stadig tilbage til DEFAULT_SCOUT", async () => {
  const supabase = createChainSupabase({ team: { id: "team-3", balance: 1_000_000 } });
  await purchaseFacilityUpgrade(
    { teamId: "team-3", track: "scouting", seasonId: "season-1", seasonNumber: 1 },
    supabase,
    ENABLED
  );
  const scoutState = await getScoutState("team-3", supabase);
  assert.equal(scoutState.scout.isDefault, true);
  assert.equal(scoutState.scout.overall, 40);
  assert.equal(scoutState.capacity, 1);
});

// #2580: Discord-regression ("6000 CZ$ i sinken") — en mission startet FØR
// facilitetskøb/hire skal overleve UÆNDRET (samme id, status='active', travel_cost
// intakt) gennem hele køb+hire-kæden, og capacity skal afspejle den FAKTISKE
// hyrede spejders overall (kapacitet 2 kræver overall≥80 — spec beslutning 2 i
// scoutEngine.js — IKKE blot en købt facilitets-tier). Låser den empirisk
// verificerede (prod-DB, 17/7) adfærd: intet kode-sti sletter/annullerer
// scout_assignments ved facilitetskøb eller hire.
test("#2580: mission startet FØR facilitetsopgradering + hire overlever uændret, og kapacitet følger hyret spejders overall (ikke facilitets-tier)", async () => {
  const supabase = createChainSupabase({ team: { id: "team-4", balance: 1_000_000 } });

  // 1) Start en mission MENS holdet stadig kun har DEFAULT_SCOUT (kapacitet 1).
  const missionResult = await startMission(
    { teamId: "team-4", criteria: { scope: "u23" }, seasonId: "season-1" },
    supabase
  );
  assert.equal(missionResult.ok, true);
  const originalAssignmentId = missionResult.assignment.id;
  assert.equal(supabase.state.assignments.length, 1);

  // 2) Byg faciliteten til tier 1 (regression-repro: "jeg byggede niveau 1").
  const upgrade = await purchaseFacilityUpgrade(
    { teamId: "team-4", track: "scouting", seasonId: "season-1", seasonNumber: 1 },
    supabase,
    ENABLED
  );
  assert.equal(upgrade.ok, true);
  assert.equal(supabase.state.facilities[0].tier, 1);

  // 3) Ansæt en tier-1-kandidat (bounded af den købte tier — validateHire).
  const candidates = generateStaffCandidates({ teamId: "team-4", seasonNumber: 1, role: "scouting", facilityTier: 1 });
  assert.ok(candidates.every((c) => c.tier === 1), "tier-1-facilitet skal kun tilbyde tier-1-kandidater");
  const hireResult = await hireStaff(
    { teamId: "team-4", role: "scouting", candidateName: candidates[0].name, seasonId: "season-1", seasonNumber: 1 },
    supabase,
    ENABLED
  );
  assert.equal(hireResult.ok, true);

  // 4) Missionen fra FØR opgraderingen skal stadig være der, uændret.
  assert.equal(supabase.state.assignments.length, 1, "opgradering/hire må ALDRIG slette/tilføje scout_assignments-rækker");
  const survivingAssignment = supabase.state.assignments[0];
  assert.equal(survivingAssignment.id, originalAssignmentId);
  assert.equal(survivingAssignment.status, "active", "missionen må ikke blive annulleret af facilitetskøb/hire");
  assert.equal(survivingAssignment.travel_cost, 6000, "den betalte indsats skal være intakt, ingen skjult refusion/nulstilling");

  const scoutState = await getScoutState("team-4", supabase);
  assert.equal(scoutState.active.length, 1);
  assert.equal(scoutState.active[0].id, originalAssignmentId);

  // 5) Tier-1-hire har overall << 80 (TIER_OVERALL_BAND[1] = 28..44) → kapacitet
  //    forbliver 1. Dette er IKKE en bug: facilitets-tier alene giver aldrig
  //    kapacitet 2, kun en hyret spejders overall≥80 gør (kræver reelt tier 4-5).
  assert.equal(scoutState.capacity, 1, "tier-1-hire kan aldrig nå overall≥80 (TIER_OVERALL_BAND[1] max 44)");
  assert.equal(scoutState.capacity, scoutCapacity(scoutState.scout));

  // 6) Guarden afviser derfor korrekt en 2. mission (kapacitet stadig 1, IKKE
  //    fordi den gamle mission blev slettet/glemt).
  const secondMission = await startMission(
    { teamId: "team-4", criteria: { scope: "country", value: "dk" }, seasonId: "season-1" },
    supabase
  );
  assert.equal(secondMission.ok, false);
  assert.equal(secondMission.error, "capacity");
});
