// Kalender-invarianter der overlevede layout-skiftet i #4236.
//
// Reglerne her blev foer testet gennem layoutStream, som er fjernet. De gjaldt aldrig
// stream i sig selv - de gaelder KALENDEREN - saa de er skrevet om til at maale udfaldet
// mod den committede prod-katalog-fixture i stedet for mod en implementering.
//
// Erstatter fra raceCalendarLanePacker.test.js:
//   "stream - GT-real-day-adskillelse (#3472 v3)"
//   "stream - GT-rygraden fase-ankres, forbliver non-overlap, ingen tabte events"
//   "stream - monumenter fase-ankres til deres fraction-slot"
//   "#3470 - GT-hviledage: en hviledag taeller IKKE med i overlap"

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildTierMaterializationPlan } from "./tierCalendarMaterializer.js";
import { resolveCalendarFrom } from "./calendarStartDate.js";
import { GRAND_TOUR_MIN_STAGES, GRAND_TOUR_REST_DAYS } from "./grandTourRestDays.js";
import { MAX_GT_STAGES_PER_DAY, MAX_GT_SPAN_DAYS } from "./raceCalendarLanePacker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "__fixtures__", "racePoolCatalog.prod.json");
const FIRST_RACE_DAY = "2026-08-28";
const NOW = new Date("2026-08-25T12:00:00Z");

function d1() {
  const { pools, catalog } = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const from = resolveCalendarFrom({ firstRaceDate: FIRST_RACE_DAY, now: NOW });
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog, from, baseSeed: 1 });
  const plan = tierPlans.find((p) => p.tier === 1);
  const pool = plan.pools[0];
  const meta = new Map((pool.raceRows ?? []).map((r) => [r.pool_race_id, r]));
  const byRace = new Map();
  for (const s of pool.stageRows ?? []) {
    if (!byRace.has(s.pool_race_id)) byRace.set(s.pool_race_id, []);
    byRace.get(s.pool_race_id).push(s);
  }
  const dato = (row) => String(row.scheduled_at).slice(0, 10);
  return { plan, pool, meta, byRace, dato };
}

test("to Grand Tours deler ALDRIG en kalenderdato, og der er mindst een dag imellem", () => {
  const { meta, byRace, dato } = d1();
  const gts = [...byRace.entries()]
    .filter(([id]) => (meta.get(id)?.stages ?? 1) >= GRAND_TOUR_MIN_STAGES)
    .map(([id, ss]) => {
      const datoer = [...new Set(ss.map(dato))].sort();
      return { navn: meta.get(id).name, fra: datoer[0], til: datoer[datoer.length - 1], antal: datoer.length };
    })
    .sort((a, b) => a.fra.localeCompare(b.fra));

  assert.ok(gts.length >= 2, "fixturen skal have mindst to GT'er, ellers tester vi ingenting");
  for (let i = 1; i < gts.length; i++) {
    const dage = (Date.parse(gts[i].fra) - Date.parse(gts[i - 1].til)) / 86_400_000;
    assert.ok(
      dage >= 2,
      `${gts[i - 1].navn} slutter ${gts[i - 1].til} og ${gts[i].navn} starter ${gts[i].fra} — der skal være mindst én fri dag imellem`
    );
  }
});

test("en Grand Tour køres i højst MAX_GT_SPAN_DAYS kalenderdatoer og med højst MAX_GT_STAGES_PER_DAY etaper pr. dato", () => {
  const { meta, byRace, dato } = d1();
  for (const [id, ss] of byRace) {
    if ((meta.get(id)?.stages ?? 1) < GRAND_TOUR_MIN_STAGES) continue;
    const perDato = new Map();
    for (const s of ss) perDato.set(dato(s), (perDato.get(dato(s)) ?? 0) + 1);
    assert.ok(
      perDato.size <= MAX_GT_SPAN_DAYS,
      `${meta.get(id).name} spænder ${perDato.size} datoer, loft ${MAX_GT_SPAN_DAYS}`
    );
    for (const [d, n] of perDato) {
      assert.ok(n <= MAX_GT_STAGES_PER_DAY, `${meta.get(id).name} har ${n} etaper på ${d}, loft ${MAX_GT_STAGES_PER_DAY}`);
    }
  }
});

test("en hviledag optager løbsdagen, men fylder ikke en plads", () => {
  // GT'en har ingen etape paa hviledagen, saa den taeller ikke i overlappet og spaerrer
  // ikke en af dagens pladser. Rytteren er alligevel bundet, fordi spaend-bindingen
  // (#4217) daekker hele min..max af GT'ens loebsdage. Kontrollen her er derfor:
  // spaendet er etaper + 2, de to manglende loebsdage har ingen GT-etape, og de er
  // ikke tomme - et andet loeb bruger dem.
  const { meta, byRace, pool } = d1();
  const loebPaaLoebsdag = new Map();
  for (const s of pool.stageRows ?? []) {
    if (!loebPaaLoebsdag.has(s.game_day)) loebPaaLoebsdag.set(s.game_day, new Set());
    loebPaaLoebsdag.get(s.game_day).add(s.pool_race_id);
  }

  let set = 0;
  for (const [id, ss] of byRace) {
    const stages = meta.get(id)?.stages ?? 1;
    if (stages < GRAND_TOUR_MIN_STAGES) continue;
    set += 1;
    const gd = [...new Set(ss.map((s) => s.game_day))].sort((a, b) => a - b);
    const spaend = gd[gd.length - 1] - gd[0] + 1;
    assert.equal(spaend, stages + GRAND_TOUR_REST_DAYS, `${meta.get(id).name}: spænd ${spaend}, forventet ${stages + GRAND_TOUR_REST_DAYS}`);

    const egne = new Set(gd);
    for (let g = gd[0]; g <= gd[gd.length - 1]; g++) {
      if (egne.has(g)) continue;                                    // GT'en kører her
      assert.ok(!loebPaaLoebsdag.get(g)?.has(id), "GT'en må ikke have en etape på sin egen hviledag");
      assert.ok((loebPaaLoebsdag.get(g)?.size ?? 0) >= 1, `løbsdag ${g} er tom — hviledagen må ikke efterlade en tom løbsdag`);
    }
  }
  assert.ok(set >= 1, "fixturen skal have mindst én GT");
});

test("intet løb forsvinder ud af kalenderen", () => {
  const { plan, pool, meta, byRace } = d1();
  assert.deepEqual(plan.unplaced ?? [], [], "etapeløb må ikke tabes");
  assert.deepEqual(plan.leftoverSingles ?? [], [], "endagsløb må ikke tabes");
  for (const [id, r] of meta) {
    const ss = byRace.get(id) ?? [];
    assert.equal(ss.length, r.stages ?? 1, `${r.name}: ${ss.length} etaper skrevet, ${r.stages ?? 1} forventet`);
    const numre = ss.map((s) => s.stage_number).sort((a, b) => a - b);
    assert.deepEqual(numre, numre.map((_, i) => i + 1), `${r.name}: etapenumre skal være 1..N uden huller`);
  }
});

test("monumenterne ligger spredt over sæsonen, ikke i klynge", () => {
  const { meta, byRace, dato } = d1();
  const mon = [...byRace.entries()]
    .filter(([id]) => meta.get(id)?.race_class === "Monuments")
    .map(([id, ss]) => ({ navn: meta.get(id).name, d: dato(ss[0]) }))
    .sort((a, b) => a.d.localeCompare(b.d));

  assert.ok(mon.length >= 3, "fixturen skal have mindst tre monumenter");
  for (let i = 1; i < mon.length; i++) {
    const dage = (Date.parse(mon[i].d) - Date.parse(mon[i - 1].d)) / 86_400_000;
    assert.ok(dage >= 2, `${mon[i - 1].navn} (${mon[i - 1].d}) og ${mon[i].navn} (${mon[i].d}) ligger for tæt`);
  }
  const spredning = (Date.parse(mon[mon.length - 1].d) - Date.parse(mon[0].d)) / 86_400_000;
  assert.ok(spredning >= 14, `monumenterne spænder kun ${spredning} dage — de skal fordeles over sæsonen`);
});

test("#3546 H: et ikke-GT etapeløb strækkes aldrig ud over etaper + 3 kalenderdage", () => {
  // Reglen blev foer haandhaevet af spanMoveOk inde i layoutStream. Kontiguiteten giver
  // den nu gratis - et loebs etaper ligger paa loebsdage i traek, saa spaendet i datoer er
  // bundet af hvor mange loebsdage en dato baerer. Men "gratis" er ikke "garanteret", saa
  // den maales her mod hele kataloget i stedet for at forsvinde med den kode der bar den.
  const { pools, catalog } = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const from = resolveCalendarFrom({ firstRaceDate: FIRST_RACE_DAY, now: NOW });
  const { tierPlans } = buildTierMaterializationPlan({ pools, catalog, from, baseSeed: 1 });

  const brud = [];
  for (const plan of tierPlans) {
    for (const pool of plan.pools ?? []) {
      const meta = new Map((pool.raceRows ?? []).map((r) => [r.pool_race_id, r]));
      const byRace = new Map();
      for (const s of pool.stageRows ?? []) {
        if (!byRace.has(s.pool_race_id)) byRace.set(s.pool_race_id, []);
        byRace.get(s.pool_race_id).push(s);
      }
      for (const [id, ss] of byRace) {
        const L = meta.get(id)?.stages ?? 1;
        if (L < 2 || L >= GRAND_TOUR_MIN_STAGES) continue;
        const datoer = new Set(ss.map((s) => String(s.scheduled_at).slice(0, 10))).size;
        if (datoer > L + 3) brud.push(`tier ${plan.tier}: ${meta.get(id).name} — ${L} etaper over ${datoer} datoer`);
      }
    }
  }
  assert.deepEqual(brud, [], `${brud.length} etapeløb strækkes for langt:\n  ${brud.slice(0, 6).join("\n  ")}`);
});
