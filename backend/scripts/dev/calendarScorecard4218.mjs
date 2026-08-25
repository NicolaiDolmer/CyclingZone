#!/usr/bin/env node
// backend/scripts/dev/calendarScorecard4218.mjs
// #4218 — mål den PLANLAGTE S3-kalender mod ALLE reglerne i docs/CALENDAR_RULES.md.
//
// EJER-KRAV 25/8: "før vi skriver til spillerne skal kalenderen testes og godkendes
// selvfølgelig. Tests i forhold til vores regler. Slutter det for tit nedad? Er der nok
// brostensløb. Hvor mange endagsløb er der, osv?"
//
// 100 % READ-ONLY og uden DB: kører den RENE buildTierMaterializationPlan mod
// lib/__fixtures__/racePoolCatalog.prod.json (snapshot af prods race_pool) og genererer
// etape-profilerne ad SAMME seed-vej som skrive-stien (seedRaceFor → generateRaceStageProfiles,
// #3347/#4104). Tallene beskriver derfor det parcours der VILLE blive skrevet — ikke et nyt træk.
//
// De 22 nye katalog-løb (database/2026-08-25-4218-katalog-22-nye-loeb.sql) lægges oveni
// in-memory, så scorecardet kan køres FØR seed'en er applyet i prod.
//
// KØRSEL
//   cd backend && node scripts/dev/calendarScorecard4218.mjs
//   cd backend && node scripts/dev/calendarScorecard4218.mjs --json
//
// Refs #4218 #4217 #4176 #3327 #3328 #3469 #3295 #3326 #3371 #4075 #2276

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildTierMaterializationPlan, TIER_DENSITY } from "../../lib/tierCalendarMaterializer.js";
import { resolveCalendarFrom } from "../../lib/calendarStartDate.js";
import { generateRaceStageProfiles } from "../../lib/raceStageProfileGenerator.js";
import {
  computeTierCoverageStats, detectCoverageViolations,
  TIER_ONE_DAY_SHARE_TARGET, TIER_ONE_DAY_SHARE_MIN, TIER_TERRAIN_FAMILY_MIN,
} from "../../lib/tierCalendarGuarantees.js";
import {
  computeCompositionStats, detectCompositionViolations,
  ACTIVE_TARGET, TIER_COMPOSITION_TOLERANCE_PP, CATEGORY_LABELS,
} from "../../lib/calendarCompositionTargets.js";
import { computeStageOrderStats, detectStageOrderViolations, STAGE_ORDER_TARGETS } from "../../lib/stageOrderMetrics.js";
import { detectEmptyCalendarDays } from "../../lib/calendarDailyCoverage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "..", "..", "lib", "__fixtures__", "racePoolCatalog.prod.json");

// Ejer-beslutning 25/8: fredag 28/8 → søndag 27/9 = 31 kalenderdage, løb hver dag.
const FIRST_RACE_DAY = "2026-08-28";
const LAST_RACE_DAY = "2026-09-27";
const REAL_DAYS = 31;
// `now` injiceres, så scriptet er tidsuafhængigt (27/6-blitz-guarden afviser en
// første løbsdag der ikke er strengt i fremtiden — se raceCalendarLanePackerGtDayCap.test.js).
const NOW = new Date("2026-08-25T12:00:00Z");
const SEASON_UUID = "00000000-0000-0000-0000-000000000003";

// De 22 nye løb fra database/2026-08-25-4218-katalog-22-nye-loeb.sql.
const NYE_LOEB = [
  ["cz4215-pro-alentejo",  "Volta ao Alentejo",            "ProSeries", "stage_race", 4, "sprinters_week",  "3/4 - 6/4"],
  ["cz4215-pro-limousin",  "Tour du Limousin Nouveau",     "ProSeries", "stage_race", 4, "hilly_tour",      "18/8 - 21/8"],
  ["cz4215-pro-lucania",   "Giro della Lucania",           "ProSeries", "stage_race", 5, "summit_tour",     "6/6 - 10/6"],
  ["cz4215-pro-rioja",     "Vuelta a La Rioja Nueva",      "ProSeries", "stage_race", 4, "balanced_week",   "21/4 - 24/4"],
  ["cz4215-pro-silesie",   "Tour de Silésie",              "ProSeries", "stage_race", 3, "mountain_tour",   "12/7 - 14/7"],
  ["cz4215-pro-zeeland",   "Ronde van Zeeland",            "ProSeries", "stage_race", 3, "cobbled_tour",    "8/5 - 10/5"],
  ["cz4215-pro-irpinia",   "Giro dell'Irpinia",            "ProSeries", "stage_race", 5, "hilly_tour",      "1/6 - 5/6"],
  ["cz4215-pro-yonne",     "Tour de l'Yonne",              "ProSeries", "stage_race", 5, "balanced_week",   "14/8 - 18/8"],
  ["cz4215-c1-fourmies",   "Grand Prix de Fourmies Neuf",  "Class1", "single",     1, "flat_sprint",     "13/9"],
  ["cz4215-c1-bretagne",   "Tour de Bretagne Sud",         "Class1", "stage_race", 3, "cobbled_tour",    "28/4 - 30/4"],
  ["cz4215-c1-euganei",    "Coppa dei Colli Euganei",      "Class1", "single",     1, "hilly_classic",   "11/5"],
  ["cz4215-c1-zamora",     "Gran Premio de Zamora",        "Class1", "single",     1, "itt_classic",     "27/6"],
  ["cz4215-c1-drenthe",    "Ronde van Drenthe Nieuw",      "Class1", "single",     1, "cobbled_classic", "15/3"],
  ["cz4215-c1-sibillini",  "Giro dei Monti Sibillini",     "Class1", "stage_race", 4, "hilly_tour",      "2/7 - 5/7"],
  ["cz4215-c1-castelli",   "Trofeo dei Castelli Romani",   "Class1", "single",     1, "hilly_classic",   "6/9"],
  ["cz4215-c1-valladolid", "Gran Premio de Valladolid",    "Class1", "single",     1, "flat_sprint",     "12/6"],
  ["cz4215-c2-vosges",     "Circuit des Vosges",           "Class2", "single",     1, "hilly_classic","23/5"],
  ["cz4215-c2-valdichiana","Trofeo Val di Chiana",         "Class2", "single",     1, "hilly_classic",   "7/3"],
  ["cz4215-c2-segovia",    "Vuelta a Segovia Menor",       "Class2", "stage_race", 3, "hilly_tour",      "16/9 - 18/9"],
  ["cz4215-c2-waasland",   "Omloop van het Waasland",      "Class2", "single",     1, "flat_sprint",     "4/4"],
  ["cz4215-c2-morbihan",   "Grand Prix du Morbihan Mineur","Class2", "single",     1, "puncheur",        "30/8"],
  ["cz4215-c2-perigord",   "Tour du Périgord",             "Class2", "stage_race", 2, "hilly_tour",      "20/6 - 21/6"],
].map(([external_id, name, race_class, race_type, stages, terrain_archetype, date_text]) => ({
  id: external_id, external_id, name, race_class, race_type, stages, terrain_archetype, date_text,
}));

const pct = (n) => `${(n * 100).toFixed(1)} %`;
const ok = (b) => (b ? "OK " : "FEJL");

function main() {
  const asJson = process.argv.includes("--json");
  const { pools, catalog: baseCatalog } = JSON.parse(readFileSync(FIXTURE, "utf8"));

  const eksisterende = new Set(baseCatalog.map((c) => c.name));
  const kollisioner = NYE_LOEB.filter((n) => eksisterende.has(n.name)).map((n) => n.name);
  const catalog = [...baseCatalog, ...NYE_LOEB];

  const from = resolveCalendarFrom({ firstRaceDate: FIRST_RACE_DAY, now: NOW });
  const quotas = Object.fromEntries(Object.entries(TIER_DENSITY).map(([t, d]) => [t, d * REAL_DAYS]));
  const { tierPlans } = buildTierMaterializationPlan({
    pools, catalog, from, realDays: REAL_DAYS, quotas, baseSeed: 1,
  });

  const externalIdByPoolRace = new Map(catalog.map((c) => [c.id, c.external_id ?? null]));
  const archetypeByPoolRace = new Map(catalog.map((c) => [c.id, c.terrain_archetype ?? null]));

  const rapport = { første: FIRST_RACE_DAY, sidste: LAST_RACE_DAY, kalenderdage: REAL_DAYS, kollisioner, tiers: [] };
  const stageDays = [];

  for (const plan of tierPlans) {
    const pool = (plan.pools ?? [])[0] ?? { raceRows: [], stageRows: [] };
    for (const s of pool.stageRows ?? []) {
      stageDays.push({ division: plan.tier, date: String(s.scheduled_at).slice(0, 10) });
    }

    // Samme seed-vej som skrive-stien (#3347/#4104): race_class SKAL med, ellers
    // prissættes monumenterne på terrænbåndet i stedet for klassebåndet.
    const profilesByPoolRaceId = new Map();
    for (const r of pool.raceRows ?? []) {
      profilesByPoolRaceId.set(r.pool_race_id, generateRaceStageProfiles({
        id: r.pool_race_id, name: r.name, race_type: r.race_type, stages: r.stages,
        external_id: externalIdByPoolRace.get(r.pool_race_id) ?? null,
        terrain_archetype: archetypeByPoolRace.get(r.pool_race_id) ?? null,
        race_class: r.race_class ?? null,
        season_id: SEASON_UUID, season_variant: 0,
      }));
    }
    const målbare = (pool.raceRows ?? []).map((r) => ({
      name: r.name,
      race_type: r.race_type,
      terrain_archetype: archetypeByPoolRace.get(r.pool_race_id) ?? null,
      stages: profilesByPoolRaceId.get(r.pool_race_id) ?? [],
    }));

    const coverage = computeTierCoverageStats({ raceRows: pool.raceRows ?? [], profilesByPoolRaceId });
    const coverageViol = detectCoverageViolations({ tier: plan.tier, stats: coverage });
    const composition = computeCompositionStats(målbare);
    const compositionRes = detectCompositionViolations({
      stats: composition, label: `tier ${plan.tier}`,
      tolerancePp: TIER_COMPOSITION_TOLERANCE_PP[plan.tier],
    });
    const compositionViol = compositionRes.violations ?? [];
    const order = computeStageOrderStats(målbare);
    const orderViol = detectStageOrderViolations({ stats: order, label: `tier ${plan.tier}` });

    // "Slutter det for tit nedad?" — finale_type === "descent" på tværs af alle etaper.
    let descent = 0, etaper = 0;
    const finaler = new Map();
    for (const r of målbare) {
      for (const st of r.stages ?? []) {
        etaper += 1;
        const f = st.finale_type ?? "?";
        finaler.set(f, (finaler.get(f) ?? 0) + 1);
        if (f === "descent") descent += 1;
      }
    }

    rapport.tiers.push({
      tier: plan.tier,
      løb: (pool.raceRows ?? []).length,
      etaper,
      løbsdage: new Set((pool.stageRows ?? []).map((s) => s.game_day)).size,
      kalenderdage: new Set((pool.stageRows ?? []).map((s) => String(s.scheduled_at).slice(0, 10))).size,
      planViolations: plan.calendarViolations ?? [],
      maxOverlap: plan.maxOverlap, overlapCap: plan.overlapCap,
      tommeLøbsdage: plan.emptyDays, dageUdenAfgørelse: plan.daysWithoutDecisionCount,
      coverage, coverageViol, composition, compositionViol, order, orderViol,
      descent, descentAndel: etaper ? descent / etaper : 0,
      finaler: Object.fromEntries([...finaler.entries()].sort((a, b) => b[1] - a[1])),
    });
  }

  const dækning = detectEmptyCalendarDays({
    stageDays, from: FIRST_RACE_DAY, to: LAST_RACE_DAY, divisions: tierPlans.map((p) => p.tier),
  });
  rapport.dækning = { ok: dækning.ok, violations: dækning.violations };

  if (asJson) { console.log(JSON.stringify(rapport, null, 2)); return; }

  console.log(`\nS3-KALENDER SCORECARD — ${FIRST_RACE_DAY} til ${LAST_RACE_DAY} (${REAL_DAYS} kalenderdage)`);
  console.log(`Katalog: ${baseCatalog.length} + ${NYE_LOEB.length} nye = ${catalog.length} løb`);
  console.log(`Navnekollisioner: ${kollisioner.length ? kollisioner.join(", ") : "ingen"}\n`);

  console.log(`${ok(dækning.ok)} LØB HVER KALENDERDAG (#4218)`);
  for (const v of dækning.violations) console.log(`     ${v}`);

  for (const t of rapport.tiers) {
    console.log(`\n${"─".repeat(72)}\nDIVISION ${t.tier} — ${t.løb} løb, ${t.etaper} etaper, ${t.løbsdage} løbsdage, ${t.kalenderdage}/${REAL_DAYS} kalenderdage`);

    const share = t.coverage?.oneDayShare ?? 0;
    const målShare = TIER_ONE_DAY_SHARE_TARGET[t.tier], minShare = TIER_ONE_DAY_SHARE_MIN[t.tier];
    console.log(`  ${ok(share >= minShare)} Endagsløb: ${t.coverage?.oneDayRaces ?? "?"} af ${t.løb} = ${pct(share)} (mål ${pct(målShare)}, min ${pct(minShare)})`);

    const fam = t.coverage?.familyCounts ?? {};
    const gulve = TIER_TERRAIN_FAMILY_MIN[t.tier] ?? {};
    const famLinje = Object.keys(gulve).map((f) => {
      const har = fam[f] ?? 0, skal = gulve[f];
      return `${f} ${har}/${skal}${har < skal ? " ✗" : ""}`;
    }).join(" · ");
    console.log(`  ${ok(!Object.keys(gulve).some((f) => (fam[f] ?? 0) < gulve[f]))} Terræn-gulve: ${famLinje}`);

    const c = t.composition?.pct ?? {};
    const komp = Object.keys(ACTIVE_TARGET).filter((k) => ACTIVE_TARGET[k] > 0).map((k) => {
      const har = Number(c[k] ?? 0), mål = ACTIVE_TARGET[k];
      const af = Math.abs(har - mål);
      return `${CATEGORY_LABELS[k] ?? k} ${har.toFixed(0)}/${mål}${af > TIER_COMPOSITION_TOLERANCE_PP[t.tier] ? " ✗" : ""}`;
    }).join(" · ");
    console.log(`  ${ok(t.compositionViol.length === 0)} Komposition (±${TIER_COMPOSITION_TOLERANCE_PP[t.tier]} pp): ${komp}`);

    const finishMountain = t.order?.mountainFinishPct;
    if (Number.isFinite(finishMountain)) {
      console.log(`  ${ok(finishMountain <= STAGE_ORDER_TARGETS.mountain_finish_max_pct)} Etapeløb der slutter på bjerg: ${finishMountain.toFixed(1)} % (maks ${STAGE_ORDER_TARGETS.mountain_finish_max_pct} %) · flad slutning ${(t.order?.flatFinishPct ?? 0).toFixed(1)} % · ITT-slutning ${(t.order?.ittFinishPct ?? 0).toFixed(1)} %`);
    }
    console.log(`  --- Slutter nedad (finale_type=descent): ${t.descent} af ${t.etaper} etaper = ${pct(t.descentAndel)}`);
    console.log(`      finaler: ${Object.entries(t.finaler).map(([k, v]) => `${k} ${v}`).join(" · ")}`);

    console.log(`  ${ok((t.maxOverlap ?? 0) <= (t.overlapCap ?? 99))} Samtidige løb pr. løbsdag: maks ${t.maxOverlap} (cap ${t.overlapCap})`);
    console.log(`  ${ok((t.planViolations?.length ?? 0) === 0)} Plan-invarianter (GT, monument, whitelist, dedup): ${t.planViolations.length} brud`);
    for (const v of t.planViolations.slice(0, 5)) console.log(`     ${v}`);
    for (const v of [...t.coverageViol, ...t.compositionViol, ...t.orderViol].slice(0, 6)) console.log(`     ! ${v}`);
  }

  const alleBrud = rapport.tiers.reduce((n, t) =>
    n + t.planViolations.length + t.coverageViol.length + t.compositionViol.length + t.orderViol.length, 0);
  console.log(`\n${"═".repeat(72)}`);
  console.log(`SAMLET: ${alleBrud} regelbrud · dækning ${dækning.ok ? "OK" : "HULLER"} · ${kollisioner.length} navnekollisioner`);
  console.log(alleBrud === 0 && dækning.ok && !kollisioner.length
    ? "Kalenderen overholder alle gates i docs/CALENDAR_RULES.md.\n"
    : "Se linjerne markeret FEJL / ! ovenfor.\n");
}

main();
