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

test("respekterer raceDaysTarget (~60 løbsdage, indenfor overshoot)", () => {
  const pools = [{ id: 2, tier: 3, label: "D3", realManagerCount: 1 }];
  const [cal] = generateDivisionCalendars({ pools, catalog: makeCatalog(), baseSeed: 1, raceDaysTarget: 60 });
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

test("global de-dup: knapt etape-segment beskærer de sidste puljer OG rapporteres (ikke tavst)", () => {
  // Katalog med KUN 2 ProSeries-etapeløb, men 3 tier-3-puljer der hver kræver
  // stageRaceQuota=8 → segmentet løber tør → mindst én pulje får færre etapeløb
  // end target, og det MÅ stå i return-objektets truncated[].
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
  // Return-værdien er et array af kalendre MED en truncated-property hængt på.
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
  // 3 etapeløb total, 3 puljer × 8 quota = 24 ønskede → massiv mangel.
  assert.ok(seenStage.size <= 3, "kan højst fordele 3 unikke etapeløb");

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
