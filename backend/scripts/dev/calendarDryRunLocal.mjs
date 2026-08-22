#!/usr/bin/env node
// #4103 — LOKAL kalender-dry-run. Koerer den RENE buildTierMaterializationPlan mod den
// committede katalog-fixture (lib/__fixtures__/racePoolCatalog.prod.json) med PRAECIS
// samme parametre som scripts/dev/regenSeason3Calendar.mjs' dry-run:
//   buildTierMaterializationPlan({ pools, catalog, from, baseSeed: 1 })
//
// Formaal: enhver aendring i pakkeren/generatoren kan evalueres mod det AEGTE katalog
// UDEN prod-credentials - af mig, af ejeren og af CI. Det var den manglende evne der
// gjorde #3546's Giro-forsoeg og denne sessions GT-arbejde saa dyrt at verificere.
//
// 100 % offline. Laeser ingen database, skriver ingenting.
//
//   node scripts/dev/calendarDryRunLocal.mjs            # dagsform pr. tier
//   node scripts/dev/calendarDryRunLocal.mjs --tier=1   # kun D1, med dag-for-dag
//   node scripts/dev/calendarDryRunLocal.mjs --json     # maskinlaesbart (til CI-diff)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildTierMaterializationPlan } from "../../lib/tierCalendarMaterializer.js";
import { resolveCalendarFrom } from "../../lib/calendarStartDate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "..", "..", "lib", "__fixtures__", "racePoolCatalog.prod.json");
const FIRST_RACE_DAY = "2026-08-25"; // #3467 bufferdag: samme anker som regenSeason3Calendar.mjs

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const tierArg = argv.find((a) => a.startsWith("--tier="));
const onlyTier = tierArg ? Number(tierArg.split("=")[1]) : null;

const { pools, catalog } = JSON.parse(readFileSync(FIXTURE, "utf8"));
const from = resolveCalendarFrom({ firstRaceDate: FIRST_RACE_DAY });
const { tierPlans } = buildTierMaterializationPlan({ pools, catalog, from, baseSeed: 1 });

const GT_MIN_STAGES = 15;

function analyseTier(plan) {
  // Een pulje er repraesentativ: alle puljer i en tier deler kalender (#2276).
  const pool = (plan.pools ?? [])[0] ?? { raceRows: [], stageRows: [] };
  const byPoolRace = new Map((pool.raceRows ?? []).map((r) => [r.pool_race_id, r]));
  const dagAf = (iso) => String(iso).slice(0, 10);

  const byDay = new Map();   // dato -> { ialt, gt: Map(navn -> antal) }
  const gtDage = new Map();  // gt-navn -> Set(dato)
  for (const s of pool.stageRows ?? []) {
    const r = byPoolRace.get(s.pool_race_id);
    const isGt = r && r.race_type === "stage_race" && (r.stages ?? 0) >= GT_MIN_STAGES;
    const d = dagAf(s.scheduled_at);
    if (!byDay.has(d)) byDay.set(d, { ialt: 0, gt: new Map() });
    const e = byDay.get(d);
    e.ialt += 1;
    if (isGt) {
      e.gt.set(r.name, (e.gt.get(r.name) ?? 0) + 1);
      if (!gtDage.has(r.name)) gtDage.set(r.name, new Set());
      gtDage.get(r.name).add(d);
    }
  }

  const dage = [...byDay.keys()].sort();
  const perDag = dage.map((d) => {
    const e = byDay.get(d);
    let n = 0; for (const c of e.gt.values()) n += c;
    return { dag: d, ialt: e.ialt, gt: n, gts: [...e.gt.keys()] };
  });

  return {
    tier: plan.tier,
    dage: dage.length,
    etaper: perDag.reduce((n, x) => n + x.ialt, 0),
    loeb: (pool.raceRows ?? []).length,
    maksGtPaaEnDag: Math.max(0, ...perDag.map((x) => x.gt)),
    dageMed5PlusGt: perDag.filter((x) => x.gt >= 5).map((x) => x.dag),
    delteGtDage: perDag.filter((x) => x.gts.length > 1).map((x) => ({ dag: x.dag, gts: x.gts })),
    gtVinduer: [...gtDage.entries()].map(([navn, set]) => ({
      navn,
      stages: byPoolRace.get([...byPoolRace.values()].find((r) => r.name === navn)?.pool_race_id)?.stages
        ?? [...byPoolRace.values()].find((r) => r.name === navn)?.stages,
      dage: set.size,
    })),
    perDag,
  };
}

const rapport = tierPlans
  .filter((p) => onlyTier == null || p.tier === onlyTier)
  .map(analyseTier);

if (asJson) {
  console.log(JSON.stringify(rapport, null, 2));
} else {
  console.log(`Kalender-dry-run (lokal fixture) — foerste loebsdag ${FIRST_RACE_DAY}\n`);
  for (const r of rapport) {
    console.log(`── Division ${r.tier} ── ${r.loeb} loeb, ${r.etaper} etaper over ${r.dage} dage`);
    console.log(`   maks GT-etaper paa een dag : ${r.maksGtPaaEnDag}`);
    console.log(`   dage med 5+ GT-etaper      : ${r.dageMed5PlusGt.length ? r.dageMed5PlusGt.join(", ") : "ingen"}`);
    console.log(`   delte GT-dage (invariant)  : ${r.delteGtDage.length ? JSON.stringify(r.delteGtDage) : "ingen"}`);
    for (const g of r.gtVinduer) console.log(`   GT: ${g.navn} — ${g.stages} etaper over ${g.dage} dage`);
    if (onlyTier != null) {
      console.log(`   dag | etaper | heraf GT`);
      for (const x of r.perDag) console.log(`   ${String(x.dag).padStart(3)} | ${String(x.ialt).padStart(6)} | ${String(x.gt).padStart(8)}`);
    }
    console.log("");
  }
}
