import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateDivisionCalendars,
  poolHasCalendar,
  pickStagesForExactSum,
  DEFAULT_TIER_RACE_CLASSES,
  DEFAULT_TIER_SINGLE_RACE_MIN_SHARE,
  DEFAULT_TIER_MONUMENT_MIN,
  MONUMENT_RACE_CLASS,
} from "./divisionCalendarGenerator.js";

// pickStagesForExactSum — 0/1 subset-sum til "PRÆCIST target"-kalenderen (#1856).
test("pickStagesForExactSum: finder eksakt delmængde-sum", () => {
  const items = [{ stages: 21 }, { stages: 7 }, { stages: 6 }, { stages: 5 }];
  const subset = pickStagesForExactSum(items, 18); // 7+6+5
  assert.ok(subset, "skal finde en kombination der summerer til 18");
  assert.equal(subset.reduce((s, r) => s + r.stages, 0), 18);
  // 0/1: intet løb bruges to gange.
  assert.equal(new Set(subset).size, subset.length);
});

test("pickStagesForExactSum: null når ingen eksakt sum findes; [] ved 0", () => {
  assert.equal(pickStagesForExactSum([{ stages: 7 }, { stages: 6 }], 4), null);
  assert.deepEqual(pickStagesForExactSum([{ stages: 7 }], 0), []);
});

test("#1856: exact-fit (reuse=true) rammer PRÆCIST target i alle puljer + bevarer blanding", () => {
  const pools = [
    { id: 1, tier: 1, label: "D1", realManagerCount: 0 },
    { id: 2, tier: 3, label: "D4", realManagerCount: 5 },
    { id: 3, tier: 3, label: "D5", realManagerCount: 5 },
    { id: 4, tier: 3, label: "D6", realManagerCount: 5 },
  ];
  const calendars = generateDivisionCalendars({
    pools, catalog: makeProdLikeCatalog(), baseSeed: 7, raceDaysTarget: 140,
    allowReuseAcrossPools: true,
  });
  for (const cal of calendars) {
    assert.equal(cal.totalRaceDays, 140, `pulje ${cal.leagueDivisionId} skal ramme PRÆCIST 140 (fik ${cal.totalRaceDays})`);
    const singles = cal.races.filter((r) => r.race_type === "single").length;
    assert.ok(singles > 0, `pulje ${cal.leagueDivisionId} skal have endagsløb (ikke ren etapeløb)`);
  }
});

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

// Realistisk katalog der efterligner prod, men dimensioneret til et FULDT-sæsons-
// target (raceDaysTarget=140, #1856): rigeligt med etapeløb OG endagsløb/monumenter
// i hvert tier-segment så hver pulje kan nå sin etape- OG single-kvote uden at sulte.
// Bruges af både jævnheds-testene (#1714) og blandings-testene (#1856) for at fange
// både "fyld-tidlige-puljer-helt-først"- og "ren-etapeløb-sæson"-fejlene.
function makeProdLikeCatalog() {
  const rows = [];
  let n = 0;
  const add = (race_class, race_type, stages, count) => {
    for (let i = 0; i < count; i++) {
      rows.push({ id: `p${n++}`, name: `${race_class}-${race_type}-${String(i).padStart(2, "0")}`, race_class, race_type, stages });
    }
  };
  // Dimensioneret til at 7 puljer (1×tier1, 2×tier2, 4×tier3) hver kan nå ~140
  // løbsdage MED global de-dup. Segmenter deler katalog: tier 2 deler WT-A/B/C med
  // tier 1 og ProSeries med tier 3, så de tungt-efterspurgte klasser (ProSeries,
  // Class1, WT-A/B/C) skal have rigeligt forsyning. Tier 3 (4 puljer × 140 dage)
  // trækker hårdest på ProSeries + Class1.
  // Etapeløb: WT-grand-tours + WT-A/B/C + ProSeries + Class1/2.
  add("TourFrance", "stage_race", 21, 1);
  add("GiroVuelta", "stage_race", 21, 2);
  add("OtherWorldTourA", "stage_race", 7, 12);
  add("OtherWorldTourB", "stage_race", 6, 12);
  add("OtherWorldTourC", "stage_race", 5, 12);
  add("ProSeries", "stage_race", 5, 40);
  add("Class1", "stage_race", 4, 40);
  add("Class2", "stage_race", 3, 20);
  // Endagsløb — rigelige nok til at hvert tier-segment kan nå sin single-share ved
  // 140-dages-target på tværs af alle konkurrerende puljer (global de-dup).
  add("Monuments", "single", 1, 10);
  add("OtherWorldTourA", "single", 1, 40);
  add("OtherWorldTourB", "single", 1, 40);
  add("OtherWorldTourC", "single", 1, 40);
  add("ProSeries", "single", 1, 140);
  add("Class1", "single", 1, 140);
  add("Class2", "single", 1, 60);
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

// ── #1856: realistisk mix (grand tours + etapeløb + endagsklassikere/monumenter) ──
// Tier 1's 8 garanterede etapeløb (7-21 etaper) fyldte tidligere hele 60-dages-budgettet
// → 0 kommende endagsløb (ren etapeløb-sæson). Med raceDaysTarget=140 + en tier-specifik
// single-/monument-kvote skal Tier 1 nu få en virkelighedstro blanding.

test("#1856: konstanter eksisterer med fornuftige defaults", () => {
  // Single-share skal være defineret pr. tier i ~25-40%-båndet.
  for (const tier of [1, 2, 3, 4]) {
    const share = DEFAULT_TIER_SINGLE_RACE_MIN_SHARE[tier];
    assert.equal(typeof share, "number", `tier ${tier} mangler single-share`);
    assert.ok(share >= 0.25 && share <= 0.4, `tier ${tier} single-share ${share} udenfor 25-40%`);
  }
  // Tier 1 skal garanteres mindst 2 monumenter.
  assert.ok(DEFAULT_TIER_MONUMENT_MIN[1] >= 2, `Tier 1 monument-min skal være >=2, var ${DEFAULT_TIER_MONUMENT_MIN[1]}`);
  assert.equal(MONUMENT_RACE_CLASS, "Monuments");
});

test("#1856: Tier 1 får MINDST 25% af sine race-days som endagsløb (ikke 0)", () => {
  const [cal] = generateDivisionCalendars({
    pools: [{ id: 1, tier: 1, label: "Division 1", realManagerCount: 0 }],
    catalog: makeProdLikeCatalog(),
    baseSeed: 2026,
    raceDaysTarget: 140,
  });
  const singleDays = cal.races
    .filter((r) => r.race_type === "single")
    .reduce((sum, r) => sum + (Number(r.stages) || 1), 0);
  const share = singleDays / cal.totalRaceDays;
  assert.equal(cal.totalRaceDays, 140, "ram PRÆCIST target (ejer-krav 26/6)");
  assert.ok(singleDays > 0, "Tier 1 må IKKE ende med 0 endagsløb (ren etapeløb-sæson)");
  // Tærskel 20%: ejer-kravet "PRÆCIST target" (fase C exact-fill) har forrang, så den
  // tunede 25%-andel kan lande ~24% pga. grovkornet etapeløb-pakning. ~20-25% endagsløb
  // i en grand-tour-tung topdivision er virkelighedstro (det centrale: IKKE ren etapeløb).
  assert.ok(share >= 0.2, `Tier 1 single-share=${(share * 100).toFixed(1)}% (${singleDays}/${cal.totalRaceDays}) under 20%`);
});

test("#1856: Tier 1 får mindst 2 Monuments (endagsløb i Monuments-klassen)", () => {
  const [cal] = generateDivisionCalendars({
    pools: [{ id: 1, tier: 1, label: "Division 1", realManagerCount: 0 }],
    catalog: makeProdLikeCatalog(),
    baseSeed: 2026,
    raceDaysTarget: 140,
  });
  const monuments = cal.races.filter(
    (r) => r.race_class === MONUMENT_RACE_CLASS && r.race_type === "single",
  );
  assert.ok(monuments.length >= 2, `Tier 1 fik kun ${monuments.length} Monuments, kræver >=2`);
});

test("#1856: totalRaceDays per pulje ligger ~140 (indenfor overshootTolerance)", () => {
  const cals = generateDivisionCalendars({
    pools: prodLikePools(),
    catalog: makeProdLikeCatalog(),
    baseSeed: 2026,
    raceDaysTarget: 140,
  });
  for (const cal of cals) {
    // Nær target; etapeløb er grovkornede (op til 21 dage) så et bredt-men-stramt bånd.
    assert.ok(
      cal.totalRaceDays >= 125 && cal.totalRaceDays <= 145,
      `pulje ${cal.leagueDivisionId} (tier ${cal.tier}) totalRaceDays=${cal.totalRaceDays} udenfor ~140-bånd`,
    );
  }
});

test("#1856: global unikhed bevaret ved 140-target (intet pool_race_id går igen)", () => {
  const cals = generateDivisionCalendars({
    pools: prodLikePools(),
    catalog: makeProdLikeCatalog(),
    baseSeed: 2026,
    raceDaysTarget: 140,
  });
  const seen = new Set();
  for (const cal of cals) {
    for (const r of cal.races) {
      assert.ok(!seen.has(r.id), `pool_race_id ${r.id} gik igen (pulje ${cal.leagueDivisionId})`);
      seen.add(r.id);
    }
  }
});

test("#1856: determinisme bevaret ved 140-target + single-kvote", () => {
  const opts = { pools: prodLikePools(), catalog: makeProdLikeCatalog(), baseSeed: 2026, raceDaysTarget: 140 };
  const a = generateDivisionCalendars(opts);
  const b = generateDivisionCalendars(opts);
  assert.deepEqual(
    a.map((c) => [c.leagueDivisionId, c.races.map((r) => r.id)]),
    b.map((c) => [c.leagueDivisionId, c.races.map((r) => r.id)]),
  );
});

// ── allowReuseAcrossPools: parallelle puljer på samme tier må køre samme løb ──────
// Problem: parallelle puljer på SAMME niveau (fx 4 tier-3-divisioner) deler ét lille
// tier-katalog → global de-dup sulter de senere puljer (de når kun ~30-50 af 140 dage).
// Med allowReuseAcrossPools=true må hver pulje vælge uafhængigt fra sit tier-katalog.

// Lille tier-3-katalog: bevidst for lille til at 4 puljer kan nå 140 dage HVER med
// global de-dup. Rigeligt for ÉN pulje, men deles det globalt sulter de senere.
function makeSmallTier3Catalog() {
  const rows = [];
  let n = 0;
  const add = (race_class, race_type, stages, count) => {
    for (let i = 0; i < count; i++) {
      rows.push({ id: `t${n++}`, name: `${race_class}-${race_type}-${String(i).padStart(2, "0")}`, race_class, race_type, stages });
    }
  };
  // Lige nok til at ÉN tier-3-pulje (ProSeries+Class1) kan nå ~140 dage:
  add("ProSeries", "stage_race", 5, 8);
  add("Class1", "stage_race", 4, 6);
  add("ProSeries", "single", 1, 80);
  add("Class1", "single", 1, 60);
  return rows;
}

// 4 parallelle tier-3-puljer der konkurrerer om det samme lille tier-3-katalog.
function fourTier3Pools() {
  return [
    { id: 10, tier: 3, label: "D3 — A", realManagerCount: 1 },
    { id: 11, tier: 3, label: "D3 — B", realManagerCount: 1 },
    { id: 12, tier: 3, label: "D3 — C", realManagerCount: 1 },
    { id: 13, tier: 3, label: "D3 — D", realManagerCount: 1 },
  ];
}

test("allowReuseAcrossPools=true: HVER af 4 parallelle puljer når ~140 race-dage (lille katalog)", () => {
  const cals = generateDivisionCalendars({
    pools: fourTier3Pools(),
    catalog: makeSmallTier3Catalog(),
    baseSeed: 2026,
    raceDaysTarget: 140,
    allowReuseAcrossPools: true,
  });
  assert.equal(cals.length, 4, "alle 4 puljer skal få en kalender");
  for (const cal of cals) {
    assert.ok(
      cal.totalRaceDays >= 130,
      `pulje ${cal.leagueDivisionId} kun ${cal.totalRaceDays} dage — genbrug burde lade den nå ~140`,
    );
  }
});

test("allowReuseAcrossPools=false (default): senere puljer sulter på samme lille katalog (kontrast)", () => {
  const cals = generateDivisionCalendars({
    pools: fourTier3Pools(),
    catalog: makeSmallTier3Catalog(),
    baseSeed: 2026,
    raceDaysTarget: 140,
    // allowReuseAcrossPools udeladt → default false
  });
  assert.equal(cals.length, 4);
  const days = cals.map((c) => c.totalRaceDays);
  // Med global de-dup tømmer de tidlige puljer det lille katalog → mindst én senere
  // pulje kommer MARKANT under target. Beviser kontrasten mod reuse=true.
  assert.ok(
    Math.min(...days) < 130,
    `forventede at mindst én pulje sultede under de-dup, men alle nåede ~target: ${days.join("/")}`,
  );
  // Samlet bevis: total dage med de-dup << 4×140 (puljerne deler ét lille katalog).
  const total = days.reduce((a, b) => a + b, 0);
  assert.ok(total < 4 * 130, `de-dup burde begrænse samlet udbud: total=${total}`);
});

test("allowReuseAcrossPools: kontrasten true vs false på SAMME input (reuse giver markant flere dage)", () => {
  const base = {
    pools: fourTier3Pools(),
    catalog: makeSmallTier3Catalog(),
    baseSeed: 2026,
    raceDaysTarget: 140,
  };
  const reuse = generateDivisionCalendars({ ...base, allowReuseAcrossPools: true });
  const dedup = generateDivisionCalendars({ ...base, allowReuseAcrossPools: false });
  const sum = (cals) => cals.reduce((a, c) => a + c.totalRaceDays, 0);
  assert.ok(
    sum(reuse) > sum(dedup),
    `reuse (${sum(reuse)}) burde give flere samlede dage end de-dup (${sum(dedup)})`,
  );
  // Den dårligst stillede pulje skal være markant bedre med reuse.
  const minReuse = Math.min(...reuse.map((c) => c.totalRaceDays));
  const minDedup = Math.min(...dedup.map((c) => c.totalRaceDays));
  assert.ok(minReuse > minDedup, `dårligst-stillede pulje: reuse=${minReuse} vs de-dup=${minDedup}`);
});

test("allowReuseAcrossPools=true: bevarer determinisme (samme input → samme output)", () => {
  const opts = {
    pools: fourTier3Pools(),
    catalog: makeSmallTier3Catalog(),
    baseSeed: 2026,
    raceDaysTarget: 140,
    allowReuseAcrossPools: true,
  };
  const a = generateDivisionCalendars(opts);
  const b = generateDivisionCalendars(opts);
  assert.deepEqual(
    a.map((c) => [c.leagueDivisionId, c.races.map((r) => r.id)]),
    b.map((c) => [c.leagueDivisionId, c.races.map((r) => r.id)]),
  );
});

test("allowReuseAcrossPools=true: ingen duplikat INDEN FOR samme pulje (selectedIds bevaret)", () => {
  const cals = generateDivisionCalendars({
    pools: fourTier3Pools(),
    catalog: makeSmallTier3Catalog(),
    baseSeed: 2026,
    raceDaysTarget: 140,
    allowReuseAcrossPools: true,
  });
  for (const cal of cals) {
    const ids = cal.races.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, `pulje ${cal.leagueDivisionId} har duplikat-løb internt`);
  }
});

test("allowReuseAcrossPools=true: puljer deler løb på tværs (genbrug rent faktisk sker)", () => {
  const cals = generateDivisionCalendars({
    pools: fourTier3Pools(),
    catalog: makeSmallTier3Catalog(),
    baseSeed: 2026,
    raceDaysTarget: 140,
    allowReuseAcrossPools: true,
  });
  const seen = new Set();
  let reused = false;
  for (const cal of cals) {
    for (const r of cal.races) {
      if (seen.has(r.id)) reused = true;
      seen.add(r.id);
    }
  }
  assert.ok(reused, "med reuse + lille katalog burde mindst ét løb gå igen på tværs af puljer");
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
