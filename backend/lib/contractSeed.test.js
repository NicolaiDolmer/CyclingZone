import test from "node:test";
import assert from "node:assert/strict";
import { SALARY_RATE_PRODUCTION } from "./economyConstants.js";

import {
  CONTRACT,
  computeFrozenSalary,
  pickContractLength,
  pickStarterContractLength,
  computeContractEndSeason,
  contractOnAcquirePatch,
  computeReleaseBuyoutFee,
  computeContractExtension,
  maxAllowedContractEndSeason,
  contractExtensionCapInfo,
  runContractSeed,
} from "./contractSeed.js";
import { makeRng } from "./fictionalRiderGenerator.js";

test("computeFrozenSalary = current_production_value × den globale sats (#3989)", () => {
  // GREATEST(1, ROUND(COALESCE(current_production_value, 1000) × SALARY_RATE_PRODUCTION))
  const at = (cpv) => Math.max(1, Math.round(cpv * SALARY_RATE_PRODUCTION));
  assert.equal(computeFrozenSalary({ current_production_value: 1_000_000 }), at(1_000_000));
  assert.equal(computeFrozenSalary({ current_production_value: 50_000 }), at(50_000));
  // NULL/0 current_production_value → fallback 1000
  assert.equal(computeFrozenSalary({ current_production_value: null }), at(1000));
  // bundgrænse 1
  assert.equal(computeFrozenSalary({ current_production_value: 1 }), 1);
});

test("#3989 · lønnen er division-blind og monotont voksende i leverance", () => {
  // Kernen i ejer-beslutningen 20/8: samme rytter koster det samme uanset hold.
  // En `division` der smugles ind i argument-objektet må ikke kunne flytte tallet.
  const base = computeFrozenSalary({ current_production_value: 250_000 });
  for (const division of [1, 2, 3, 4, null, undefined, 99]) {
    assert.equal(
      computeFrozenSalary({ current_production_value: 250_000, division }), base,
      `division ${division} flyttede lønnen — løn må KUN skalere med rytterens kvalitet`,
    );
  }
  const ladder = [1_000, 10_000, 100_000, 1_000_000].map((cpv) => computeFrozenSalary({ current_production_value: cpv }));
  for (let i = 1; i < ladder.length; i++) {
    assert.ok(ladder[i] > ladder[i - 1], `bedre leverance skal ALTID koste mere: ${JSON.stringify(ladder)}`);
  }
});

test("pickContractLength giver 1-3, ~1/3 fordeling, deterministisk pr. seed", () => {
  const rng = makeRng(2026);
  const counts = { 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < 3000; i++) counts[pickContractLength(rng)]++;
  for (const len of [1, 2, 3]) {
    assert.ok(counts[len] >= 850 && counts[len] <= 1150, `len ${len}: ${counts[len]} udenfor ~1/3`);
  }
  // determinisme: samme seed → samme første træk
  assert.equal(pickContractLength(makeRng(7)), pickContractLength(makeRng(7)));
});

test("#3037: pickStarterContractLength giver 2-3, ~1/2 fordeling, aldrig 1", () => {
  const rng = makeRng(2026);
  const counts = { 2: 0, 3: 0 };
  for (let i = 0; i < 3000; i++) {
    const len = pickStarterContractLength(rng);
    assert.ok(len === 2 || len === 3, `len ${len} udenfor 2-3 (starter-kontrakter må aldrig få length 1)`);
    counts[len]++;
  }
  for (const len of [2, 3]) {
    assert.ok(counts[len] >= 1350 && counts[len] <= 1650, `len ${len}: ${counts[len]} udenfor ~1/2`);
  }
  // determinisme: samme seed → samme første træk
  assert.equal(pickStarterContractLength(makeRng(7)), pickStarterContractLength(makeRng(7)));
});

test("#3037: pickStarterContractLength → contract_end_season altid > startSeason (overlever den sæson holdet allokeres i)", () => {
  const rng = makeRng(2026);
  for (const startSeason of [1, 2, 5]) {
    for (let i = 0; i < 500; i++) {
      const length = pickStarterContractLength(rng);
      const end = computeContractEndSeason(startSeason, length);
      assert.ok(end > startSeason, `startSeason ${startSeason}, length ${length} → end ${end} skulle være > startSeason`);
    }
  }
});

test("computeContractEndSeason = start + length - 1", () => {
  assert.equal(computeContractEndSeason(1, 2), 2); // relaunch founder: aktiv sæson 1+2
  assert.equal(computeContractEndSeason(1, 1), 1);
  assert.equal(computeContractEndSeason(3, 3), 5);
});

test("CONTRACT-konstanter", () => {
  assert.equal(CONTRACT.FOUNDER_LENGTH, 2);
  assert.equal(CONTRACT.DEFAULT_ACQUIRE_LENGTH, 2);
  assert.equal(CONTRACT.SALARY_RATE, 0.067);
});

// ── contractOnAcquirePatch ──────────────────────────────────────────────────
// Create-if-missing / inherit-if-present: kontraktløse ryttere får standard-
// kontrakt; ryttere med kontrakt (salary != null) arver uændret ({}).

test("contractOnAcquirePatch: rytter MED kontrakt → {} (arves uændret, regenereres ALDRIG)", () => {
  // salary != null OG contract_end_season != null → tom patch uanset base_value/length
  assert.deepEqual(
    contractOnAcquirePatch({ salary: 42_000, base_value: 1_000_000, contract_length: 3, contract_end_season: 9 }, 5),
    {}
  );
  // salary 0 er en gyldig (gratis) kontrakt → arves også uændret (kræver stadig contract_end_season != null)
  assert.deepEqual(contractOnAcquirePatch({ salary: 0, base_value: 1_000_000, contract_end_season: 9 }, 5), {});
});

// #2894/#2902 forward-guard: FØR fixet krævede guarden kun salary != null, hvilket
// blindede patchen for ryttere hvor starterSquadAllocator satte team_id men aldrig
// kontrakt-felterne (salary blev separat backfillet af #2746, contract_length/
// contract_end_season forblev NULL — 1.326 ryttere/138 hold, verificeret 25/7).
// Guarden kræver nu OGSÅ contract_end_season != null, så et fremtidigt
// erhvervelses-kald (auktion/transfer/swap/lån) på sådan en rytter healer den.
test("contractOnAcquirePatch: salary sat MEN contract_end_season NULL → heales (ikke længere blindet, #2902)", () => {
  const patch = contractOnAcquirePatch(
    { salary: 42_000, current_production_value: 1_000_000, contract_length: null, contract_end_season: null },
    1,
    { division: 1 },
  );
  assert.equal(patch.contract_length, 2);
  // Genberegnet fra current_production_value, ikke det gamle 42_000.
  assert.equal(patch.salary, Math.round(1_000_000 * SALARY_RATE_PRODUCTION));
  assert.equal(patch.contract_end_season, 2); // 1 + 2 - 1
});

// #3620 forward-guard: "kolonnen blev ikke SELECT'et" (undefined) må ALDRIG
// behandles som "rytteren har ingen kontrakt" (null). Det var præcis den
// forveksling der lod academyTransfer.js promote() regenerere hver eneste
// kontrakt fra det øjeblik #2902 tilføjede contract_end_season til guarden —
// 20 ryttere i prod fik længde 3 → 2 og udløbet rykket frem.
test("contractOnAcquirePatch: #3620 — salary sat + contract_end_season IKKE hentet → kaster (gætter ikke)", () => {
  assert.throws(
    () => contractOnAcquirePatch({ salary: 42_000, current_production_value: 1_000_000 }, 2),
    /contract_end_season/,
  );
});

test("contractOnAcquirePatch: #3620 — eksplicit NULL end-sæson kaster IKKE (det er en ægte tilstand, ikke en manglende kolonne)", () => {
  const patch = contractOnAcquirePatch(
    { salary: 42_000, current_production_value: 1_000_000, contract_end_season: null },
    2,
  );
  assert.equal(patch.contract_end_season, 3); // 2 + 2 - 1 → heales som før (#2902)
});

test("contractOnAcquirePatch: kontraktløs rytter → standard-kontrakt (length 2, frossen salary, korrekt end)", () => {
  const patch = contractOnAcquirePatch({ salary: null, current_production_value: 1_000_000 }, 1, { division: 1 });
  assert.equal(patch.contract_length, 2);
  assert.equal(patch.salary, Math.round(1_000_000 * SALARY_RATE_PRODUCTION));
  assert.equal(patch.contract_end_season, 2); // 1 + 2 - 1
});

test("contractOnAcquirePatch: undefined salary behandles som kontraktløs (free agent)", () => {
  // #3989: satsen er global, så en free agent uden erhvervende hold prissættes ens.
  const patch = contractOnAcquirePatch({ current_production_value: 50_000 }, 3);
  assert.equal(patch.contract_length, 2);
  assert.equal(patch.salary, Math.round(50_000 * SALARY_RATE_PRODUCTION));
  assert.equal(patch.contract_end_season, 4); // 3 + 2 - 1
});

test("contractOnAcquirePatch: kontraktløs + NULL current_production_value → fallback 1000 × satsen", () => {
  const patch = contractOnAcquirePatch({ salary: null, current_production_value: null }, 1);
  assert.equal(patch.salary, Math.max(1, Math.round(1000 * SALARY_RATE_PRODUCTION)));
  assert.equal(patch.contract_length, 2);
  assert.equal(patch.contract_end_season, 2);
});

// ── computeReleaseBuyoutFee (#1719) ─────────────────────────────────────────
// Buyout-gebyr (ejer-besluttet): round(salary * max(1, contract_end_season -
// current_season + 1) * 0.5). Manageren betaler en halv sæson-løn pr.
// resterende sæson på kontrakten (mindst 1 sæson, så gebyret aldrig bliver 0
// for en udløbet/samme-sæson-kontrakt med løn).

test("computeReleaseBuyoutFee: 0.5 * salary * resterende sæsoner (mindst 1)", () => {
  // 3 resterende sæsoner (end=5, current=3 → 5-3+1=3): 100k * 3 * 0.5 = 150k
  assert.equal(computeReleaseBuyoutFee({ salary: 100_000, contractEndSeason: 5, currentSeason: 3 }), 150_000);
  // 1 resterende (end=3, current=3 → 1): 100k * 1 * 0.5 = 50k
  assert.equal(computeReleaseBuyoutFee({ salary: 100_000, contractEndSeason: 3, currentSeason: 3 }), 50_000);
  // 2 resterende (end=4, current=3 → 2): 80k * 2 * 0.5 = 80k
  assert.equal(computeReleaseBuyoutFee({ salary: 80_000, contractEndSeason: 4, currentSeason: 3 }), 80_000);
});

test("computeReleaseBuyoutFee: udløbet/forbi kontrakt → gulv på 1 sæson (max(1, ...))", () => {
  // end < current → resterende ville være <=0, men max(1,...) gør den til 1 sæson.
  assert.equal(computeReleaseBuyoutFee({ salary: 60_000, contractEndSeason: 2, currentSeason: 4 }), 30_000);
  // end == current-1 (lige udløbet): 60k * 1 * 0.5 = 30k
  assert.equal(computeReleaseBuyoutFee({ salary: 60_000, contractEndSeason: 3, currentSeason: 4 }), 30_000);
});

test("computeReleaseBuyoutFee: NULL/manglende felter → robust (0-salary → 0 gebyr)", () => {
  assert.equal(computeReleaseBuyoutFee({ salary: 0, contractEndSeason: 5, currentSeason: 1 }), 0);
  assert.equal(computeReleaseBuyoutFee({ salary: null, contractEndSeason: null, currentSeason: 1 }), 0);
  // manglende contract_end_season → behandles som 1 resterende sæson (gulvet)
  assert.equal(computeReleaseBuyoutFee({ salary: 40_000, contractEndSeason: null, currentSeason: 2 }), 20_000);
});

test("computeReleaseBuyoutFee: rundes til nærmeste heltal", () => {
  // 33_333 * 1 * 0.5 = 16_666.5 → round → 16_667
  assert.equal(computeReleaseBuyoutFee({ salary: 33_333, contractEndSeason: 1, currentSeason: 1 }), 16_667);
});

// ── computeContractExtension (#1720) ────────────────────────────────────────
// Forlæng kontrakten 1 sæson + genforhandl lønnen fra rytterens aktuelle
// markedsværdi (samme SALARY_RATE-formel som signering). contract_end_season
// +1, contract_length +1 (eller min 1 hvis NULL).

test("computeContractExtension: ny løn fra current_production_value, end+1, length+1", () => {
  const next = computeContractExtension({
    current_production_value: 1_000_000,
    division: 1,
    contract_end_season: 4,
    contract_length: 2,
  });
  assert.equal(next.salary, Math.round(1_000_000 * SALARY_RATE_PRODUCTION)); // = computeFrozenSalary
  assert.equal(next.contract_end_season, 5); // 4 + 1
  assert.equal(next.contract_length, 3); // 2 + 1
});

test("computeContractExtension: lønnen er den globale sats, uanset division (#3989)", () => {
  const next = computeContractExtension({
    current_production_value: 50_000,
    contract_end_season: 2,
    contract_length: 1,
  });
  assert.equal(next.salary, Math.round(50_000 * SALARY_RATE_PRODUCTION));
  assert.equal(next.contract_end_season, 3);
  assert.equal(next.contract_length, 2);
});

test("computeContractExtension: NULL contract-felter → end baseres på currentSeason, length=1", () => {
  // Kontraktløs/NULL end: forlængelsen forankres i currentSeason så den nye
  // udløbssæson altid ligger i fremtiden (currentSeason + 1).
  const next = computeContractExtension({
    current_production_value: 200_000,
    division: 4,
    contract_end_season: null,
    contract_length: null,
    currentSeason: 3,
  });
  assert.equal(next.salary, Math.round(200_000 * SALARY_RATE_PRODUCTION));
  assert.equal(next.contract_end_season, 4); // currentSeason(3) + 1
  assert.equal(next.contract_length, 1);
});

test("computeContractExtension: udløbet kontrakt forlænges fra currentSeason, ikke fortid", () => {
  // end(2) < currentSeason(5): forlæng fra current, ikke fra fortidens end.
  const next = computeContractExtension({
    current_production_value: 100_000,
    contract_end_season: 2,
    contract_length: 2,
    currentSeason: 5,
  });
  assert.equal(next.contract_end_season, 6); // max(end, currentSeason) + 1 = 5 + 1
  assert.equal(next.contract_length, 3);
});

// #2424: prod-log viste 5× 23514 riders_contract_length_check-violations fra
// gentagne extend-contract-kald på ryttere allerede på MAX_LENGTH(3).
// contract_length må ALDRIG overskride constraintets loft, uanset hvor mange
// gange forlængelsen kaldes.
test("computeContractExtension: allerede på MAX_LENGTH(3) → clampes, crasher IKKE riders_contract_length_check", () => {
  const next = computeContractExtension({
    current_production_value: 100_000,
    contract_end_season: 4,
    contract_length: 3,
    currentSeason: 4,
  });
  assert.equal(next.contract_length, 3); // clamped, ikke 4
  assert.equal(next.contract_end_season, 5); // end-sæson rykker stadig frem
});

// ── maxAllowedContractEndSeason + gentagne forlængelser (#3143) ─────────────
// Hidtil intet loft på antal forlængelser pr. rytter: kun contract_length blev
// clampet (1-3), men contract_end_season kunne flyttes ubegrænset langt frem
// via gentagne kald. Loftet er maxAllowedContractEndSeason (#7138: current + 1, gulv S6).

test("maxAllowedContractEndSeason (#7138): indeværende sæson + 1, aldrig under S6", () => {
  assert.equal(CONTRACT.MAX_EXTENSION_SEASONS_AHEAD, 1);
  assert.equal(CONTRACT.MIN_EXTENSION_END_SEASON, 6);
  // Ejer 25/10: i aftenens S4-afslutning må kontrakter gå til slut S6 (S5 + S6).
  assert.equal(maxAllowedContractEndSeason(4), 6);
  // "I S5 en kontrakt i S5 og S6, udløber mellem S6 og S7."
  assert.equal(maxAllowedContractEndSeason(5), 6);
  assert.equal(maxAllowedContractEndSeason(6), 7);
  assert.equal(maxAllowedContractEndSeason(10), 11);
  // NULL/manglende currentSeason → gulvet.
  assert.equal(maxAllowedContractEndSeason(null), 6);
  assert.equal(maxAllowedContractEndSeason(undefined), 6);
});

test("computeContractExtension: en enkelt forlængelse inden for loftet er tilladt", () => {
  const currentSeason = 6;
  const next = computeContractExtension({
    current_production_value: 200_000,
    contract_end_season: 6, // udløber i indeværende sæson
    contract_length: 1,
    currentSeason,
  });
  assert.equal(next.contract_end_season, 7); // 6 + 1 = 7 ≤ 6 + 1
  assert.ok(next.contract_end_season <= maxAllowedContractEndSeason(currentSeason));
});

test("computeContractExtension: en forlængelse der ville overskride loftet beregnes stadig (afvisning sker i routen, ikke helperen)", () => {
  const currentSeason = 6;
  // Rytteren står allerede på loftet (end = 7) — endnu et kald ville flytte den
  // forbi loftet, hvilket routen skal afvise.
  const next = computeContractExtension({
    current_production_value: 200_000,
    contract_end_season: 7,
    contract_length: 2,
    currentSeason,
  });
  assert.equal(next.contract_end_season, 8); // > maxAllowedContractEndSeason(6) = 7
  assert.ok(next.contract_end_season > maxAllowedContractEndSeason(currentSeason));
});

test("gentagne forlængelser kan aldrig flytte contract_end_season forbi loftet, hvis loftet håndhæves pr. kald", () => {
  for (const currentSeason of [4, 5, 8]) {
    const maxEnd = maxAllowedContractEndSeason(currentSeason);
    let rider = { current_production_value: 100_000, contract_end_season: null, contract_length: null };
    for (let attempt = 0; attempt < 10; attempt++) {
      const next = computeContractExtension({ ...rider, currentSeason });
      if (next.contract_end_season > maxEnd) continue; // routen afviser
      rider = { ...rider, contract_end_season: next.contract_end_season, contract_length: next.contract_length };
    }
    assert.equal(rider.contract_end_season, maxEnd, `S${currentSeason}: konvergerer til loftet, ikke forbi det`);
  }
});

// ── contractExtensionCapInfo (#3186, #7138) ─────────────────────────────────
// Tælleren følger det faktiske loft: maxExtensions = loft - indeværende sæson.

test("contractExtensionCapInfo: S4-afslutningen (gulv S6) giver 2 forlængelser til en rytter der udløber nu", () => {
  const info = contractExtensionCapInfo(4, 4);
  assert.equal(info.maxSeason, 6);
  assert.equal(info.maxExtensions, 2);
  assert.equal(info.usedExtensions, 0);
  assert.equal(info.remainingExtensions, 2);
});

test("contractExtensionCapInfo: fra S5 er der højst 1 forlængelse", () => {
  assert.deepEqual(contractExtensionCapInfo(5, 5), { maxSeason: 6, maxExtensions: 1, usedExtensions: 0, remainingExtensions: 1 });
  assert.deepEqual(contractExtensionCapInfo(null, 7), { maxSeason: 8, maxExtensions: 1, usedExtensions: 0, remainingExtensions: 1 });
  assert.deepEqual(contractExtensionCapInfo(8, 7), { maxSeason: 8, maxExtensions: 1, usedExtensions: 1, remainingExtensions: 0 });
});

test("contractExtensionCapInfo: usedExtensions clampes til [0, maxExtensions] selv forbi loftet", () => {
  const info = contractExtensionCapInfo(999, 7);
  assert.equal(info.remainingExtensions, 0);
  assert.equal(info.usedExtensions, info.maxExtensions);
});

test("contractExtensionCapInfo: NULL/manglende currentSeason → gulvet (samme mønster som maxAllowedContractEndSeason)", () => {
  const info = contractExtensionCapInfo(null, null);
  assert.equal(info.maxSeason, 6);
  assert.equal(info.usedExtensions, 0);
});

// ── runContractSeed wrapper-tests ──────────────────────────────────────────────
// Supabase-mock spejler starterSquadAllocator.test.js: range() returnerer hele
// listen (fetchAllRows kalder .range() for paginering). update-calls optages.

function makeContractSupabase({ owned, teams = [], activeSeasonNumber = 1 }) {
  const updates = [];
  const supabase = {
    from(table) {
      if (table === "seasons") {
        const api = {
          select() { return api; },
          eq() { return api; },
          maybeSingle() { return Promise.resolve({ data: { number: activeSeasonNumber }, error: null }); },
        };
        return api;
      }
      if (table === "teams") {
        const api = {
          select() { return api; },
          order() { return api; },
          range() { return Promise.resolve({ data: teams, error: null }); },
        };
        return api;
      }
      // riders table
      const api = {
        select() { return api; },
        not() { return api; },
        order() { return api; },
        range() { return Promise.resolve({ data: owned, error: null }); },
        update(patch) {
          return {
            eq(_col, id) {
              updates.push({ id, patch });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
      return api;
    },
    _updates: updates,
  };
  return supabase;
}

test("runContractSeed: founders → 2 sæsoner, andre ejede → 1-3, free agents urørt", async () => {
  const owned = [
    { id: "r1", team_id: "founder1", current_production_value: 1_000_000 },
    { id: "r2", team_id: "founder1", current_production_value: 200_000 },
    { id: "r3", team_id: "ai1",      current_production_value: 500_000 },
  ];
  const teams = [
    { id: "founder1", division: 1 },
    { id: "ai1", division: 3 },
  ];
  const supabase = makeContractSupabase({ owned, teams, activeSeasonNumber: 1 });

  const res = await runContractSeed(supabase, {
    dryRun: false,
    seed: 2026,
    getManagerTeams: async () => [{ id: "founder1" }],
  });

  assert.equal(res.dryRun, false);
  assert.equal(res.seeded, 3);
  assert.equal(res.founders, 1);
  assert.equal(res.startSeason, 1);

  const byId = Object.fromEntries(supabase._updates.map((u) => [u.id, u.patch]));

  // Founder r1: length=2, end=2, salary = 1_000_000 × satsen
  assert.equal(byId.r1.contract_length, 2);
  assert.equal(byId.r1.contract_end_season, 2);
  assert.equal(byId.r1.salary, Math.round(1_000_000 * SALARY_RATE_PRODUCTION));

  // Founder r2: length=2, end=2, salary = 200_000 × satsen
  assert.equal(byId.r2.contract_length, 2);
  assert.equal(byId.r2.contract_end_season, 2);
  assert.equal(byId.r2.salary, Math.round(200_000 * SALARY_RATE_PRODUCTION));

  // Non-founder r3: length 1-3, end = 1 + length - 1, salary = 500_000 × satsen
  assert.ok(byId.r3.contract_length >= 1 && byId.r3.contract_length <= 3,
    `r3 length=${byId.r3.contract_length} ude af 1-3`);
  assert.equal(byId.r3.contract_end_season, byId.r3.contract_length); // = 1 + length - 1
  assert.equal(byId.r3.salary, Math.round(500_000 * SALARY_RATE_PRODUCTION));
});

test("runContractSeed (dryRun): ingen writes, kun preview-count", async () => {
  const owned = [
    { id: "r1", team_id: "founder1", current_production_value: 800_000 },
  ];
  const teams = [{ id: "founder1", division: 1 }];
  const supabase = makeContractSupabase({ owned, teams, activeSeasonNumber: 1 });

  const res = await runContractSeed(supabase, {
    dryRun: true,
    seed: 2026,
    getManagerTeams: async () => [{ id: "founder1" }],
  });

  assert.equal(res.dryRun, true);
  assert.equal(res.toSeed, 1);
  assert.equal(supabase._updates.length, 0, "dryRun må ikke skrive");
});

test("runContractSeed: ingen ejede ryttere → seeded=0", async () => {
  const supabase = makeContractSupabase({ owned: [], activeSeasonNumber: 1 });
  const res = await runContractSeed(supabase, {
    dryRun: false,
    seed: 2026,
    getManagerTeams: async () => [],
  });
  assert.equal(res.seeded, 0);
  assert.equal(supabase._updates.length, 0);
});

test("runContractSeed: kaster uden supabase-client", async () => {
  await assert.rejects(
    () => runContractSeed(null, { getManagerTeams: async () => [] }),
    /Supabase client required/,
  );
});
