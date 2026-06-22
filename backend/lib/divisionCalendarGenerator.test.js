import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateDivisionCalendars,
  poolHasCalendar,
  DEFAULT_TIER_RACE_CLASSES,
} from "./divisionCalendarGenerator.js";

// Minimal syntetisk race_pool-katalog der dækker de relevante klasser.
function makeCatalog() {
  const rows = [];
  let n = 0;
  const add = (race_class, race_type, stages, count) => {
    for (let i = 0; i < count; i++) {
      rows.push({ id: `r${n++}`, name: `${race_class}-${String(i).padStart(2, "0")}`, race_class, race_type, stages });
    }
  };
  add("Monuments", "single", 1, 6);
  add("OtherWorldTourA", "stage_race", 7, 4);
  add("ProSeries", "single", 1, 40);
  add("ProSeries", "stage_race", 5, 8);
  add("Class1", "single", 1, 30);
  add("Class1", "stage_race", 4, 6);
  add("Class2", "single", 1, 30);
  add("Class2", "stage_race", 3, 6);
  return rows;
}

// Realistisk katalog der efterligner prod: ~49 etapeløb + ~72 endagsløb fordelt på
// alle klasser. Bruges af jævnheds-testene (#1714) for at fange den sultende
// "fyld-tidlige-puljer-helt-først"-fejl mod et katalog tæt på virkeligheden.
function makeProdLikeCatalog() {
  const rows = [];
  let n = 0;
  const add = (race_class, race_type, stages, count) => {
    for (let i = 0; i < count; i++) {
      rows.push({ id: `p${n++}`, name: `${race_class}-${race_type}-${String(i).padStart(2, "0")}`, race_class, race_type, stages });
    }
  };
  // Etapeløb (~49 total): WT-grand-tours + WT-A/B/C + ProSeries + Class1/2.
  add("TourFrance", "stage_race", 21, 1);
  add("GiroVuelta", "stage_race", 21, 2);
  add("OtherWorldTourA", "stage_race", 7, 6);
  add("OtherWorldTourB", "stage_race", 6, 6);
  add("OtherWorldTourC", "stage_race", 5, 6);
  add("ProSeries", "stage_race", 5, 12);
  add("Class1", "stage_race", 4, 8);
  add("Class2", "stage_race", 3, 8);
  // Endagsløb (~72 total).
  add("Monuments", "single", 1, 5);
  add("OtherWorldTourA", "single", 1, 8);
  add("OtherWorldTourB", "single", 1, 8);
  add("OtherWorldTourC", "single", 1, 8);
  add("ProSeries", "single", 1, 18);
  add("Class1", "single", 1, 13);
  add("Class2", "single", 1, 12);
  return rows;
}

// 7 live puljer: 1×tier1, 2×tier2, 4×tier3 (matcher den verificerede prod-form).
function prodLikePools() {
  return [
    { id: 1, tier: 1, label: "Division 1", realManagerCount: 0 },
    { id: 2, tier: 2, label: "Division 2 — A", realManagerCount: 0 },
    { id: 3, tier: 2, label: "Division 2 — B", realManagerCount: 0 },
    { id: 4, tier: 3, label: "Division 3 — A", realManagerCount: 2 },
    { id: 5, tier: 3, label: "Division 3 — B", realManagerCount: 1 },
    { id: 6, tier: 3, label: "Division 3 — C", realManagerCount: 1 },
    { id: 7, tier: 3, label: "Division 3 — D", realManagerCount: 1 },
  ];
}

test("poolHasCalendar: tier 1/2 altid; tier 3/4 kun med >=1 ægte manager", () => {
  assert.equal(poolHasCalendar(1, 0), true);
  assert.equal(poolHasCalendar(2, 0), true);
  assert.equal(poolHasCalendar(3, 0), false);
  assert.equal(poolHasCalendar(3, 1), true);
  assert.equal(poolHasCalendar(4, 0), false);
  assert.equal(poolHasCalendar(4, 2), true);
});

test("genererer kun kalendre for live puljer (tom div-4 → ingen kalender)", () => {
  const pools = [
    { id: 1, tier: 1, label: "Division 1", realManagerCount: 0 },
    { id: 2, tier: 3, label: "Division 3 — A", realManagerCount: 3 },
    { id: 3, tier: 3, label: "Division 3 — B", realManagerCount: 0 },
    { id: 4, tier: 4, label: "Division 4 — A", realManagerCount: 0 },
  ];
  const cals = generateDivisionCalendars({ pools, catalog: makeCatalog(), baseSeed: 2026 });
  const ids = cals.map((c) => c.leagueDivisionId).sort((a, b) => a - b);
  // div1 (tier 1, altid) + div3-A (har manager). div3-B + div4-A udeladt (tomme).
  assert.deepEqual(ids, [1, 2]);
});

test("tier-klasser respekteres (tier 3 = ProSeries/Class1, ingen Monuments/WT)", () => {
  const pools = [{ id: 2, tier: 3, label: "D3", realManagerCount: 1 }];
  const [cal] = generateDivisionCalendars({ pools, catalog: makeCatalog(), baseSeed: 7 });
  assert.ok(cal.races.length > 0, "skal vælge løb");
  for (const r of cal.races) {
    assert.ok(DEFAULT_TIER_RACE_CLASSES[3].includes(r.race_class), `uventet klasse ${r.race_class} i tier 3`);
  }
});

test("tier 4 kører Class 1/2 (de nye løbstyper)", () => {
  const pools = [{ id: 8, tier: 4, label: "D4", realManagerCount: 1 }];
  const [cal] = generateDivisionCalendars({ pools, catalog: makeCatalog(), baseSeed: 3 });
  assert.ok(cal.races.length > 0);
  for (const r of cal.races) {
    assert.ok(["Class1", "Class2"].includes(r.race_class), `tier 4 skal kun køre Class 1/2, fik ${r.race_class}`);
  }
});

test("deterministisk pr. (seed, pulje)", () => {
  const pools = [{ id: 2, tier: 3, label: "D3", realManagerCount: 1 }];
  const a = generateDivisionCalendars({ pools, catalog: makeCatalog(), baseSeed: 42 });
  const b = generateDivisionCalendars({ pools, catalog: makeCatalog(), baseSeed: 42 });
  assert.deepEqual(a[0].races.map((r) => r.id), b[0].races.map((r) => r.id));
});

test("forskellige puljer får forskellige kalendre (seed varierer pr. pulje)", () => {
  const pools = [
    { id: 10, tier: 3, label: "A", realManagerCount: 1 },
    { id: 11, tier: 3, label: "B", realManagerCount: 1 },
  ];
  const cals = generateDivisionCalendars({ pools, catalog: makeCatalog(), baseSeed: 5 });
  const a = cals[0].races.map((r) => r.id).join(",");
  const b = cals[1].races.map((r) => r.id).join(",");
  assert.notEqual(a, b, "to puljer bør ikke få identisk kalender");
});

test("respekterer raceDaysTarget (~60 løbsdage, indenfor overshoot) når katalog er rigeligt", () => {
  // Enkelt-pulje med rigeligt katalog → fyldes op mod target.
  const pools = [{ id: 2, tier: 3, label: "D3", realManagerCount: 1 }];
  const [cal] = generateDivisionCalendars({ pools, catalog: makeProdLikeCatalog(), baseSeed: 1, raceDaysTarget: 60 });
  assert.ok(cal.totalRaceDays >= 50 && cal.totalRaceDays <= 65, `totalRaceDays=${cal.totalRaceDays} udenfor forventet bånd`);
});

// ── #1714: global de-dup på tværs af puljer ─────────────────────────────────────
test("global de-dup: intet pool_race_id går igen på tværs af de genererede puljer", () => {
  // 7 puljer på tværs af alle tiers, alle live. Med ét delt katalog ville flere
  // puljer ellers vælge samme løb (fx samme etapeløb i delte klasser).
  const pools = [
    { id: 1, tier: 1, label: "T1", realManagerCount: 0 },
    { id: 2, tier: 2, label: "T2", realManagerCount: 0 },
    { id: 3, tier: 3, label: "T3-A", realManagerCount: 1 },
    { id: 4, tier: 3, label: "T3-B", realManagerCount: 1 },
    { id: 5, tier: 4, label: "T4-A", realManagerCount: 1 },
    { id: 6, tier: 4, label: "T4-B", realManagerCount: 1 },
    { id: 7, tier: 4, label: "T4-C", realManagerCount: 1 },
  ];
  const cals = generateDivisionCalendars({ pools, catalog: makeCatalog(), baseSeed: 99 });
  const seen = new Set();
  for (const cal of cals) {
    for (const r of cal.races) {
      assert.ok(!seen.has(r.id), `pool_race_id ${r.id} gik igen på tværs af puljer (pulje ${cal.leagueDivisionId})`);
      seen.add(r.id);
    }
  }
});

// ── #1714: JÆVN fordeling på tværs af puljer i samme klasse-segment ──────────────
test("jævn fordeling: INGEN live pulje ender med 0 løb (prod-lignende katalog + 7 puljer)", () => {
  const cals = generateDivisionCalendars({
    pools: prodLikePools(),
    catalog: makeProdLikeCatalog(),
    baseSeed: 2026,
  });
  assert.equal(cals.length, 7, "alle 7 live puljer skal få en kalender");
  for (const cal of cals) {
    assert.ok(cal.races.length > 0, `pulje ${cal.leagueDivisionId} (tier ${cal.tier}) endte med 0 løb`);
  }
});

test("jævn fordeling: puljer i samme segment får nogenlunde lige mange løb (ikke 28 vs 9)", () => {
  const cals = generateDivisionCalendars({
    pools: prodLikePools(),
    catalog: makeProdLikeCatalog(),
    baseSeed: 2026,
  });
  const byId = new Map(cals.map((c) => [c.leagueDivisionId, c]));

  // De 2 tier-2-puljer deler segment; de 4 tier-3-puljer deler segment.
  const tier2Counts = [2, 3].map((id) => byId.get(id).races.length);
  const tier3Counts = [4, 5, 6, 7].map((id) => byId.get(id).races.length);

  const spread = (arr) => Math.max(...arr) - Math.min(...arr);
  // Round-robin: spredningen inden for et segment må højst være nogle få løb
  // (knappe etapeløb deles ujævnt med ±1 → vælg en lille, men ikke-nul tolerance).
  assert.ok(spread(tier2Counts) <= 3, `tier-2-spredning for stor: ${tier2Counts.join("/")}`);
  assert.ok(spread(tier3Counts) <= 3, `tier-3-spredning for stor: ${tier3Counts.join("/")}`);

  // Etapeløb skal også deles jævnt (round-robin fase A).
  const tier3Stage = [4, 5, 6, 7].map(
    (id) => byId.get(id).races.filter((r) => r.race_type === "stage_race").length,
  );
  assert.ok(spread(tier3Stage) <= 1, `tier-3-etapeløb ikke jævnt fordelt: ${tier3Stage.join("/")}`);
});

test("jævn fordeling: global unikhed bevaret med prod-lignende katalog + 7 puljer", () => {
  const cals = generateDivisionCalendars({
    pools: prodLikePools(),
    catalog: makeProdLikeCatalog(),
    baseSeed: 2026,
  });
  const seen = new Set();
  for (const cal of cals) {
    for (const r of cal.races) {
      assert.ok(!seen.has(r.id), `pool_race_id ${r.id} gik igen (pulje ${cal.leagueDivisionId})`);
      seen.add(r.id);
    }
  }
});

test("jævn fordeling: determinisme (samme input → samme output to gange)", () => {
  const a = generateDivisionCalendars({ pools: prodLikePools(), catalog: makeProdLikeCatalog(), baseSeed: 2026 });
  const b = generateDivisionCalendars({ pools: prodLikePools(), catalog: makeProdLikeCatalog(), baseSeed: 2026 });
  assert.deepEqual(
    a.map((c) => [c.leagueDivisionId, c.races.map((r) => r.id)]),
    b.map((c) => [c.leagueDivisionId, c.races.map((r) => r.id)]),
  );
  assert.deepEqual(a.truncated, b.truncated);
});

test("global de-dup: knapt etape-segment beskærer puljerne JÆVNT OG rapporteres (ikke tavst)", () => {
  // Katalog med KUN 2 ProSeries-etapeløb + 1 Class1-etapeløb (3 total), men 3
  // tier-3-puljer der hver kræver stageRaceQuota=8 → segmentet løber tør →
  // etapeløbene deles round-robin (1 hver), og ALLE puljer rapporteres som beskåret.
  const scarce = [];
  let n = 0;
  const add = (race_class, race_type, stages, count) => {
    for (let i = 0; i < count; i++) {
      scarce.push({ id: `s${n++}`, name: `${race_class}-${String(i).padStart(2, "0")}`, race_class, race_type, stages });
    }
  };
  add("ProSeries", "stage_race", 5, 2); // KUN 2 etapeløb i delt klasse
  add("Class1", "stage_race", 4, 1);    // 1 ekstra (tier 3 har også Class1)
  add("ProSeries", "single", 1, 60);    // rigeligt fyld
  add("Class1", "single", 1, 60);

  const pools = [
    { id: 1, tier: 3, label: "A", realManagerCount: 1 },
    { id: 2, tier: 3, label: "B", realManagerCount: 1 },
    { id: 3, tier: 3, label: "C", realManagerCount: 1 },
  ];
  const cals = generateDivisionCalendars({ pools, catalog: scarce, baseSeed: 7, stageRaceQuota: 8 });
  const truncated = cals.truncated;

  // De-dup holder stadig: ingen etapeløb deles.
  const seenStage = new Set();
  for (const cal of cals) {
    for (const r of cal.races.filter((x) => x.race_type === "stage_race")) {
      assert.ok(!seenStage.has(r.id), `etapeløb ${r.id} delt på tværs af puljer`);
      seenStage.add(r.id);
    }
  }
  assert.ok(seenStage.size <= 3, "kan højst fordele 3 unikke etapeløb");

  // JÆVNT: hver pulje fik nogenlunde lige mange etapeløb (3 løb / 3 puljer = 1 hver).
  const stagePerPool = cals.map(
    (c) => c.races.filter((r) => r.race_type === "stage_race").length,
  );
  assert.ok(Math.max(...stagePerPool) - Math.min(...stagePerPool) <= 1, `etapeløb ikke jævnt: ${stagePerPool.join("/")}`);

  // Ingen pulje sulter trods knaphed (endags-fyld redder dem).
  for (const cal of cals) {
    assert.ok(cal.races.length > 0, `pulje ${cal.leagueDivisionId} endte med 0 løb`);
  }

  // KRITISK: beskæring rapporteres eksplicit, ikke tavst.
  assert.ok(Array.isArray(truncated), "return-objektet skal have et truncated-array");
  assert.ok(truncated.length > 0, "mindst én pulje skal være rapporteret som beskåret");
  for (const t of truncated) {
    assert.ok(t.leagueDivisionId != null, "truncated-entry har leagueDivisionId");
    assert.ok(typeof t.stageRacesShort === "number" && t.stageRacesShort > 0, "truncated-entry rapporterer hvor mange etapeløb der mangler");
  }
});

test("global de-dup: determinisme bevaret (samme input+seed → samme output)", () => {
  const pools = [
    { id: 1, tier: 2, label: "T2", realManagerCount: 0 },
    { id: 2, tier: 3, label: "T3-A", realManagerCount: 1 },
    { id: 3, tier: 3, label: "T3-B", realManagerCount: 1 },
    { id: 4, tier: 4, label: "T4", realManagerCount: 1 },
  ];
  const calsA = generateDivisionCalendars({ pools, catalog: makeCatalog(), baseSeed: 314 });
  const calsB = generateDivisionCalendars({ pools, catalog: makeCatalog(), baseSeed: 314 });
  assert.deepEqual(
    calsA.map((c) => [c.leagueDivisionId, c.races.map((r) => r.id)]),
    calsB.map((c) => [c.leagueDivisionId, c.races.map((r) => r.id)]),
  );
  // truncated-rapporten skal også være deterministisk.
  assert.deepEqual(calsA.truncated, calsB.truncated);
});

test("output bevarer input-puljernes rækkefølge (ikke udvælgelses-rækkefølge)", () => {
  const pools = prodLikePools();
  const cals = generateDivisionCalendars({ pools, catalog: makeProdLikeCatalog(), baseSeed: 2026 });
  assert.deepEqual(
    cals.map((c) => c.leagueDivisionId),
    pools.map((p) => p.id),
  );
});
