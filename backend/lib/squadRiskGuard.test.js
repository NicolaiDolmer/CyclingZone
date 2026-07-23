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
import { MIN_RIDERS_FOR_RACE } from "./marketUtils.js";
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

// ─── #2748 Hovedtest — værste tænkelige kombination kan IKKE bringe et hold ────
//    under MIN_RIDERS_FOR_RACE (8). Verificeret read-only mod prod (Supabase MCP,
//    project ghwvkxzhsbbltzfnuhhz) 23/7 — se PR-beskrivelsen for den fulde tabel.
//    Tightest observerede menneskehold: "Guinness Cycling Team" (10 ryttere, 2 i
//    kombineret risiko → 8 tilbage, PRÆCIST på grænsen, ingen margin).

test("#2748 Hovedtest: det tætteste VERIFICEREDE hold (10 ryttere, 2 kombineret risiko) lander PRÆCIST på MIN_RIDERS_FOR_RACE, ikke under", () => {
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

  const worstCaseRemaining = riders.length - atRisk;
  assert.equal(worstCaseRemaining, MIN_RIDERS_FOR_RACE, "grænsetilfældet ramt PRÆCIST — 0 margin, men IKKE under");
  assert.ok(worstCaseRemaining >= MIN_RIDERS_FOR_RACE, "MÅ IKKE komme under løbs-minimummet");
});

test("#2748 Hovedtest: aggregeret worst-case over de tætteste VERIFICEREDE hold (menneske + AI) holder alle >= 8", () => {
  // Snapshot fra read-only SQL mod prod 23/7 (project ghwvkxzhsbbltzfnuhhz):
  // MIN(current_count - kombineret_risiko) = 8 for BÅDE menneske- og AI-hold,
  // 0 hold under 8 blandt 150 menneskehold + 223 AI-hold. Denne test låser den
  // observerede grænse fast som en regressions-guard: falder tallet nogensinde
  // under MIN_RIDERS_FOR_RACE i en fremtidig re-verifikation, skal testen fejle.
  const tightestObserved = [
    { name: "Guinness Cycling Team (menneske)", current: 10, combinedRisk: 2 },
    { name: "The wild ducks (menneske)", current: 12, combinedRisk: 3 },
    { name: "AI-hold (mindste observerede)", current: 9, combinedRisk: 1 },
  ];
  for (const t of tightestObserved) {
    const remaining = t.current - t.combinedRisk;
    assert.ok(
      remaining >= MIN_RIDERS_FOR_RACE,
      `${t.name}: ${t.current} - ${t.combinedRisk} = ${remaining} skal være >= ${MIN_RIDERS_FOR_RACE}`
    );
  }
});

test("retirement-vinduets konstanter er stadig 36/40 (regressions-guard — hvis ejeren ændrer dem, skal denne fil + PR-tabellen genverificeres)", () => {
  assert.equal(PROGRESSION_CONFIG.retirement.windowStartAge, 36);
  assert.equal(PROGRESSION_CONFIG.retirement.guaranteedAge, 40);
});
