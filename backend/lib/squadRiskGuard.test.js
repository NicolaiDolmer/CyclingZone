import test from "node:test";
import assert from "node:assert/strict";

import {
  ageForSeason,
  countAtRiskRiders,
  fetchAtRiskCount,
  isContractExpiringAtTransition,
  isGuaranteedRetirementAtTransition,
  isRetirementRiskAtTransition,
  isRiderAtRisk,
} from "./squadRiskGuard.js";
import { getSquadRiskViolation, MIN_RIDERS_FOR_RACE } from "./marketUtils.js";
import { PROGRESSION_CONFIG } from "./riderProgression.js";

// #2748 · Kombineret squad-risiko (kontraktudløb #2744 + pensionsrisiko #1137).
// LAUNCH_REFERENCE_YEAR = 2026 (samme som riderProgressionEngine.js).

test("ageForSeason spejler riderProgressionEngine.ageForSeason (samme formel)", () => {
  assert.equal(ageForSeason("2005-03-01", 1), 2026 - 2005); // 21
  assert.equal(ageForSeason("2005-03-01", 2), 2027 - 2005); // 22
  assert.equal(ageForSeason(null, 2), null);
  assert.equal(ageForSeason("2005-03-01", NaN), null);
});

// ─── isContractExpiringAtTransition ────────────────────────────────────────────

test("kontrakt-udløb: contract_end_season <= aktiv sæson → true (matcher #2744-release-fasens `<=`)", () => {
  assert.equal(isContractExpiringAtTransition({ contract_end_season: 1 }, 1), true);
  assert.equal(isContractExpiringAtTransition({ contract_end_season: 1 }, 2), true, "selv-helende <= fanger en overset tidligere sæson");
  assert.equal(isContractExpiringAtTransition({ contract_end_season: 2 }, 1), false, "udløber FØRST næste sæson — ikke endnu");
  assert.equal(isContractExpiringAtTransition({ contract_end_season: null }, 1), false, "ingen kontrakt (fri agent) → ikke 'udløbende'");
});

// ─── isRetirementRiskAtTransition / isGuaranteedRetirementAtTransition ────────

test("pensionsrisiko beregnes ved NÆSTE sæson (activeSeasonNumber+1) — samme alder retirementDecision() rent faktisk bruger", () => {
  // Aktiv sæson = 1 (S1→S2-transitionen der kommer). Rytter født 1990 er 36 år
  // ved sæson 2 (2026+1-1990=... nej: ageForSeason(1990,2)=2027-1990=37). Vælg
  // fødselsår så alder ved sæson 2 rammer PRÆCIST 36 (vinduets start).
  const birthYearForAge36AtSeason2 = 2027 - 36; // 1991
  const rider36 = { birthdate: `${birthYearForAge36AtSeason2}-06-01` };
  assert.equal(isRetirementRiskAtTransition(rider36, 1), true, "alder 36 ved næste sæson er PRÆCIST vinduets start (windowStartAge)");

  const birthYearForAge35 = 2027 - 35;
  const rider35 = { birthdate: `${birthYearForAge35}-06-01` };
  assert.equal(isRetirementRiskAtTransition(rider35, 1), false, "35 år ved næste sæson er stadig UNDER vinduet");

  const birthYearForAge40 = 2027 - 40;
  const rider40 = { birthdate: `${birthYearForAge40}-06-01` };
  assert.equal(isRetirementRiskAtTransition(rider40, 1), true);
  assert.equal(isGuaranteedRetirementAtTransition(rider40, 1), true, "alder >= guaranteedAge (40) → GARANTERET, ikke kun risiko");

  assert.equal(isGuaranteedRetirementAtTransition(rider36, 1), false, "36 år er i vinduet men IKKE garanteret (kun 40+ er garanteret)");
});

test("ugyldigt/manglende activeSeasonNumber → false (fail-closed, ingen falsk positiv risiko)", () => {
  assert.equal(isRetirementRiskAtTransition({ birthdate: "1980-01-01" }, NaN), false);
  assert.equal(isRetirementRiskAtTransition({ birthdate: "1980-01-01" }, undefined), false);
});

// ─── isRiderAtRisk / countAtRiskRiders (union, ikke sum) ──────────────────────

test("isRiderAtRisk: ELLER-semantik — kontraktudløb ELLER pensionsrisiko udløser risiko", () => {
  const expiringOnly = { contract_end_season: 1, birthdate: "2000-01-01" };
  const retireOnly = { contract_end_season: null, birthdate: `${2027 - 37}-01-01` };
  const both = { contract_end_season: 1, birthdate: `${2027 - 37}-01-01` };
  const neither = { contract_end_season: 3, birthdate: "2000-01-01" };

  assert.equal(isRiderAtRisk(expiringOnly, 1), true);
  assert.equal(isRiderAtRisk(retireOnly, 1), true);
  assert.equal(isRiderAtRisk(both, 1), true);
  assert.equal(isRiderAtRisk(neither, 1), false);
});

test("countAtRiskRiders: en rytter der rammer BEGGE mekanikker tælles kun ÉN gang (han kan kun forlade holdet én gang)", () => {
  const riders = [
    { id: "r1", contract_end_season: 1, birthdate: `${2027 - 37}-01-01` }, // begge
    { id: "r2", contract_end_season: 1, birthdate: "2000-01-01" },        // kun udløb
    { id: "r3", contract_end_season: null, birthdate: `${2027 - 40}-01-01` }, // kun pension (garanteret)
    { id: "r4", contract_end_season: 3, birthdate: "2000-01-01" },        // ingen risiko
  ];
  assert.equal(countAtRiskRiders(riders, 1), 3, "r1 tælles én gang selvom han rammer begge; r4 tæller slet ikke");
  assert.equal(countAtRiskRiders([], 1), 0);
  assert.equal(countAtRiskRiders(null, 1), 0, "tolerant over for manglende input");
});

// ─── fetchAtRiskCount — DB-fetch + excludeRiderIds ────────────────────────────

function makeMockSupabase(rows) {
  return {
    from(table) {
      assert.equal(table, "riders");
      const b = {
        select() { return b; },
        eq() { return b; },
        then(resolve) { resolve({ data: rows, error: null }); },
      };
      return b;
    },
  };
}

test("fetchAtRiskCount: ekskluderer angivne rytter-id'er (undgår dobbelt-tælling af rytteren DENNE handel allerede flytter)", async () => {
  const rows = [
    { id: "r1", contract_end_season: 1, birthdate: "2000-01-01", is_retired: false },
    { id: "r2", contract_end_season: null, birthdate: `${2027 - 40}-01-01`, is_retired: false },
  ];
  const supabase = makeMockSupabase(rows);

  const countAll = await fetchAtRiskCount(supabase, "team-1", 1);
  assert.equal(countAll, 2);

  const countExcluded = await fetchAtRiskCount(supabase, "team-1", 1, { excludeRiderIds: ["r1"] });
  assert.equal(countExcluded, 1, "r1 (allerede 'outgoing' i den aktuelle handel) må ikke tælles som EKSTRA risiko");
});

test("fetchAtRiskCount: allerede-pensionerede ryttere (is_retired=true) tæller ikke med", async () => {
  const rows = [
    { id: "r1", contract_end_season: null, birthdate: `${2027 - 40}-01-01`, is_retired: true },
  ];
  const supabase = makeMockSupabase(rows);
  const count = await fetchAtRiskCount(supabase, "team-1", 1);
  assert.equal(count, 0, "en allerede pensioneret rytter er allerede 'væk' fra fremtidig planlægning, ikke en NY risiko");
});

// #2748 coordinator-review-fund 23/7: en rytter med pending_team_id sat til et
// ANDET hold tælles allerede som "outgoing" i getTeamMarketState.future_count
// (BASE-tallet getSquadRiskViolation trækker at_risk_count fra) — at tælle ham
// MED her igen ville fratrække ham to gange for samme afgang.
test("fetchAtRiskCount: ryttere der allerede er 'pending-out' til et ANDET hold tæller IKKE med (undgår dobbelt-fradrag mod future_count)", async () => {
  const rows = [
    // r1: kontrakt-risiko, men allerede på vej til et andet hold — future_count
    // har allerede fratrukket ham via outgoingCount, må ikke tælles her igen.
    { id: "r1", contract_end_season: 1, birthdate: "2000-01-01", is_retired: false, pending_team_id: "other-team" },
    // r2: samme kontrakt-risiko, men INGEN pending — en ægte, utalt risiko.
    { id: "r2", contract_end_season: 1, birthdate: "2000-01-01", is_retired: false, pending_team_id: null },
  ];
  const supabase = makeMockSupabase(rows);
  const count = await fetchAtRiskCount(supabase, "team-1", 1);
  assert.equal(count, 1, "kun r2 tæller — r1 er allerede nettet ud via future_count/outgoingCount");
});

test("fetchAtRiskCount: pending_team_id sat til DETTE hold selv (pending-IND, ikke ud) tæller stadig med hvis rytteren er i risiko", async () => {
  const rows = [
    { id: "r1", contract_end_season: 1, birthdate: "2000-01-01", is_retired: false, pending_team_id: "team-1" },
  ];
  const supabase = makeMockSupabase(rows);
  const count = await fetchAtRiskCount(supabase, "team-1", 1);
  assert.equal(count, 1, "pending_team_id === teamId betyder 'på vej IND', ikke ud — ingen dobbelt-fradrags-risiko her");
});

// ─── #2748 Hovedtest — værste tænkelige kombination kan IKKE bringe et hold ────
//    under MIN_RIDERS_FOR_RACE (8). Verificeret read-only mod prod (Supabase MCP,
//    project ghwvkxzhsbbltzfnuhhz) 23/7 — se PR-beskrivelsen for den fulde tabel.
//    Tightest observerede menneskehold: "Guinness Cycling Team" (10 ryttere, 2 i
//    kombineret risiko → 8 tilbage, PRÆCIST på grænsen, ingen margin).

// coordinator-review 23/7 (finding 5): begge tests herunder kører nu FAKTISKE
// produktionsfunktioner (countAtRiskRiders + getSquadRiskViolation) over
// konkrete rytter-fixtures/team-states — ikke hardkodede arrays med manuel
// aritmetik ved siden af koden. `activeSeasonNumber = 1` matcher S1→S2.

test("#2748 Hovedtest: Guinness Cycling Team (10 ryttere, 2 kombineret risiko) — den FAKTISKE spærre blokerer et salg oveni", () => {
  const activeSeasonNumber = 1;
  // 10 ejede senior-ryttere: 2 rammer risikoen (én via alder, matcher det verificerede
  // mønster hvor den ENESTE menneske-kontraktudløber (contract_end_season=1) OGSÅ var
  // 37 år — overlap, se PR-beskrivelsen), 8 er neutrale.
  const riders = [
    { id: "risk-1", contract_end_season: 1, birthdate: `${2027 - 37}-01-01` },
    { id: "risk-2", contract_end_season: null, birthdate: `${2027 - 38}-01-01` },
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `safe-${i}`, contract_end_season: 3, birthdate: "1998-01-01",
    })),
  ];
  assert.equal(riders.length, 10);

  const atRisk = countAtRiskRiders(riders, activeSeasonNumber);
  assert.equal(atRisk, 2);

  // Ren passiv-mekanik-check (ingen ny handel): 10 - 2 = 8, PRÆCIST på grænsen,
  // ikke under — mekanikkerne ALENE bringer aldrig holdet under 8.
  const worstCaseRemaining = riders.length - atRisk;
  assert.equal(worstCaseRemaining, MIN_RIDERS_FOR_RACE, "grænsetilfældet ramt PRÆCIST — 0 margin, men IKKE under");

  // Den FAKTISKE spærre (getSquadRiskViolation): manageren forsøger at sælge ÉN
  // rytter OVENI den naturlige afgang → 10 - 2 (risiko) - 1 (dette salg) = 7 < 8.
  // Dette ER cellen der afgør om et /riders/:id/release- eller transfer-kald
  // blokeres i produktion (transferExecution.js/routes/api.js).
  const issue = getSquadRiskViolation(
    { future_count: riders.length, at_risk_count: atRisk },
    { outgoingCount: 1 }
  );
  assert.ok(issue, "salget SKAL blokeres af den faktiske spærre — 10-2-1=7 < MIN_RIDERS_FOR_RACE");
  assert.equal(issue.projected, 7);
  assert.equal(issue.minRiders, MIN_RIDERS_FOR_RACE);
});

test("#2748 Hovedtest: et hold med 15 ryttere/2 kombineret risiko KAN sælge én ekstra — den FAKTISKE spærre tillader det", () => {
  const activeSeasonNumber = 1;
  const riders = [
    { id: "risk-1", contract_end_season: 1, birthdate: "2000-01-01" },
    { id: "risk-2", contract_end_season: null, birthdate: `${2027 - 40}-01-01` },
    ...Array.from({ length: 13 }, (_, i) => ({
      id: `safe-${i}`, contract_end_season: 3, birthdate: "1998-01-01",
    })),
  ];
  assert.equal(riders.length, 15);

  const atRisk = countAtRiskRiders(riders, activeSeasonNumber);
  assert.equal(atRisk, 2);

  // 15 - 2 (risiko) - 1 (salget) = 12 >= 8 → getSquadRiskViolation tillader handlen.
  const issue = getSquadRiskViolation(
    { future_count: riders.length, at_risk_count: atRisk },
    { outgoingCount: 1 }
  );
  assert.equal(issue, null, "15-2-1=12 >= MIN_RIDERS_FOR_RACE → salget skal tillades, ikke blokeres");
});

test("#2748 Hovedtest: aggregeret worst-case over de tætteste VERIFICEREDE hold (menneske + AI) — passiv mekanik ALENE holder alle >= 8", () => {
  // Snapshot fra read-only SQL mod prod 23/7 (project ghwvkxzhsbbltzfnuhhz):
  // MIN(current_count - kombineret_risiko) = 8 for BÅDE menneske- og AI-hold,
  // 0 hold under 8 blandt 150 menneskehold + 223 AI-hold. Bemærk: dette dækker KUN
  // de to PASSIVE mekanikker uden nogen ny manager-handel oveni (outgoingCount=0)
  // — den faktiske spærre mod en NY handel er dækket af de to tests ovenfor.
  const tightestObserved = [
    { name: "Guinness Cycling Team (menneske)", current: 10, combinedRisk: 2 },
    { name: "The wild ducks (menneske)", current: 12, combinedRisk: 3 },
    { name: "AI-hold (mindste observerede)", current: 9, combinedRisk: 1 },
  ];
  for (const t of tightestObserved) {
    const issue = getSquadRiskViolation(
      { future_count: t.current, at_risk_count: t.combinedRisk },
      { outgoingCount: 0 }
    );
    assert.equal(
      issue, null,
      `${t.name}: ${t.current} - ${t.combinedRisk} skal være >= ${MIN_RIDERS_FOR_RACE} uden nogen ny handel oveni`
    );
  }
});

test("retirement-vinduets konstanter er stadig 36/40 (regressions-guard — hvis ejeren ændrer dem, skal denne fil + PR-tabellen genverificeres)", () => {
  assert.equal(PROGRESSION_CONFIG.retirement.windowStartAge, 36);
  assert.equal(PROGRESSION_CONFIG.retirement.guaranteedAge, 40);
});
