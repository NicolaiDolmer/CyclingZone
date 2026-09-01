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
import { arg as devArg } from "./lib/devCalendarArgs.mjs";
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
import {
  computeFinaleStats, mergeFinaleStats, detectFinaleViolations,
  TERRAIN_FINALE_BANDS, OVERALL_FINALE_BAND, FINALE_CLASSES, CLASS_LABELS, MIN_SAMPLE,
} from "../../lib/stageFinaleMetrics.js";
import { detectEmptyCalendarDays } from "../../lib/calendarDailyCoverage.js";
import { augmentWithS3Additions } from "./lib/s3OfflineCalendarPlan.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "..", "..", "lib", "__fixtures__", "racePoolCatalog.prod.json");

// #4215: scriptet er en GATE, ikke kun en rapport. Parametre kan overstyres, så samme
// kode kan køre i CI (mod en fast fixture-dato), i sæsonskifte-preflighten (mod den
// kalender der er ved at blive skrevet) og i hånden.
//   --first-day=YYYY-MM-DD   første løbsdag  (default: ejer-beslutningen for S3)
//   --days=N                 antal kalenderdage
//   --now=YYYY-MM-DD         hvad scriptet skal regne som "i dag"
//   --json                   maskinlæsbar rapport i stedet for tabellen
// EXIT-KODE: 0 = alle gates grønne, 1 = mindst ét brud. Det er dét CI hænger på.
// #4239: delt med de oevrige kalender-dev-scripts, saa der kun er een arg-parser at rette.
const arg = (name, fallback) => devArg(process.argv.slice(2), name, fallback);

// Ejer-beslutning 25/8: fredag 28/8 → søndag 27/9 = 31 kalenderdage, løb hver dag.
const FIRST_RACE_DAY = arg("first-day", "2026-08-28");
const REAL_DAYS = Number(arg("days", "31"));
const LAST_RACE_DAY = new Date(
  Date.parse(`${FIRST_RACE_DAY}T00:00:00Z`) + (REAL_DAYS - 1) * 86_400_000
).toISOString().slice(0, 10);
// `now` injiceres, så scriptet er tidsuafhængigt (27/6-blitz-guarden afviser en
// første løbsdag der ikke er strengt i fremtiden — se raceCalendarLanePackerGtDayCap.test.js).
// Uden det ville CI begynde at fejle på selve dagen den hardkodede dato passeres.
const NOW = new Date(`${arg("now", "2026-08-25")}T12:00:00Z`);
const SEASON_UUID = "00000000-0000-0000-0000-000000000003";

// De 22 nye løb fra database/2026-08-25-4218-katalog-22-nye-loeb.sql.
// #4123: flyttet til scripts/dev/lib/s3OfflineCalendarPlan.mjs, så CI-invariant-testene
// og dette scorecard deler ÉN definition i stedet for to kopier der kan drifte fra
// hinanden. Samme 22 rækker, uændrede — se den fil for baggrunden.

const pct = (n) => `${(n * 100).toFixed(1)} %`;
const ok = (b) => (b ? "OK " : "FEJL");

function main() {
  const asJson = process.argv.includes("--json");
  const { pools, catalog: baseCatalog } = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const { catalog, kollisioner } = augmentWithS3Additions(baseCatalog);

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

    // "Slutter det for tit nedad?" — nu et BÅND pr. terræntype + samlet (#4272), ikke
    // kun en descent-optælling. `finaleViol` er GATEN (bånd + stikprøve-tillæg, se
    // stageFinaleMetrics.js); `finaleRaw` er de samme bånd UDEN tillæg, rapporteret så
    // en strukturel skævhed er synlig selv når stikprøve-tillægget bærer den igennem.
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
    const finale = computeFinaleStats(målbare);
    const finaleViol = detectFinaleViolations({ stats: finale, label: `tier ${plan.tier}`, strict: false });
    const finaleRaw = detectFinaleViolations({ stats: finale, label: `tier ${plan.tier}`, strict: true });

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
      finale, finaleViol, finaleRaw,
      descent, descentAndel: etaper ? descent / etaper : 0,
      finaler: Object.fromEntries([...finaler.entries()].sort((a, b) => b[1] - a[1])),
    });
  }

  const dækning = detectEmptyCalendarDays({
    stageDays, from: FIRST_RACE_DAY, to: LAST_RACE_DAY, divisions: tierPlans.map((p) => p.tier),
  });
  rapport.dækning = { ok: dækning.ok, violations: dækning.violations };

  // Samme dom i begge udgaver — ellers ville --json altid exit'e 0 og gøre gaten
  // usynligt grøn for enhver der bruger den maskinlæsbare sti.
  // Sæson-aggregatet gates mod de RÅ bånd (n = 20-90 pr. terræntype, stor nok til at
  // båndet er meningsfuldt); pr. division gates mod bånd + stikprøve-tillæg. Se
  // stageFinaleMetrics.js for hvorfor der er to lag.
  rapport.sæsonFinale = mergeFinaleStats(rapport.tiers.map((t) => t.finale));
  rapport.sæsonFinaleViol = detectFinaleViolations({ stats: rapport.sæsonFinale, label: "sæson", strict: true });

  const bruddene = rapport.tiers.reduce((n, t) =>
    n + t.planViolations.length + t.coverageViol.length + t.compositionViol.length + t.orderViol.length
      + t.finaleViol.length, 0) + rapport.sæsonFinaleViol.length;
  if (asJson) {
    console.log(JSON.stringify({ ...rapport, regelbrud: bruddene, ok: bruddene === 0 && dækning.ok && !kollisioner.length }, null, 2));
    return bruddene === 0 && dækning.ok && kollisioner.length === 0;
  }

  console.log(`\nS3-KALENDER SCORECARD — ${FIRST_RACE_DAY} til ${LAST_RACE_DAY} (${REAL_DAYS} kalenderdage)`);
  console.log(`Katalog: ${baseCatalog.length} + ${catalog.length - baseCatalog.length} nye = ${catalog.length} løb`);
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
    console.log(`  ${ok(t.finaleViol.length === 0)} Finale-bånd pr. terræn (#4272) — slutter nedad i alt: ${t.descent} af ${t.etaper} = ${pct(t.descentAndel)}`);
    for (const p of Object.keys(TERRAIN_FINALE_BANDS)) {
      const slot = t.finale.byProfile?.[p];
      if (!slot?.total) continue;
      const bands = TERRAIN_FINALE_BANDS[p];
      const celler = FINALE_CLASSES
        .filter((c) => bands[c] || slot.pct[c] > 0)
        .map((c) => {
          const [lo, hi] = bands[c] ?? [0, 0];
          const got = slot.pct[c];
          return `${CLASS_LABELS[c]} ${got.toFixed(0)}%${got < lo || got > hi ? `✗[${lo}-${hi}]` : ""}`;
        });
      const lille = slot.total < MIN_SAMPLE ? " (n<min, kun rapport)" : "";
      console.log(`      ${p.padEnd(14)} n=${String(slot.total).padStart(3)}  ${celler.join(" · ")}${lille}`);
    }
    const o = t.finale.overall;
    console.log(`      ${"SAMLET".padEnd(14)} n=${String(t.finale.total).padStart(3)}  ` +
      Object.entries(OVERALL_FINALE_BAND).map(([c, [lo, hi]]) => {
        const got = o.pct[c];
        return `${CLASS_LABELS[c]} ${got.toFixed(1)}%${got < lo || got > hi ? `✗[${lo}-${hi}]` : ""}`;
      }).join(" · ") + ` · ${CLASS_LABELS.tt} ${o.pct.tt.toFixed(1)}%`);
    // ✗ = uden for det RÅ bånd. Står linjen samtidig som OK, bæres afvigelsen af
    // stikprøve-tillægget (lille n) — den er rapporteret, ikke skjult.
    if (t.finaleRaw.length && !t.finaleViol.length) {
      console.log(`      (${t.finaleRaw.length} afvigelse(r) fra det rå bånd bæres af stikprøve-tillægget — se ✗)`);
    }

    console.log(`  ${ok((t.maxOverlap ?? 0) <= (t.overlapCap ?? 99))} Samtidige løb pr. løbsdag: maks ${t.maxOverlap} (cap ${t.overlapCap})`);
    console.log(`  ${ok((t.planViolations?.length ?? 0) === 0)} Plan-invarianter (GT, monument, whitelist, dedup): ${t.planViolations.length} brud`);
    for (const v of t.planViolations.slice(0, 5)) console.log(`     ${v}`);
    for (const v of [...t.coverageViol, ...t.compositionViol, ...t.orderViol, ...t.finaleViol].slice(0, 8)) console.log(`     ! ${v}`);
  }

  const alleBrud = rapport.tiers.reduce((n, t) =>
    n + t.planViolations.length + t.coverageViol.length + t.compositionViol.length + t.orderViol.length
      + t.finaleViol.length, 0) + rapport.sæsonFinaleViol.length;
  console.log(`\n${"═".repeat(72)}`);
  console.log(`${ok(rapport.sæsonFinaleViol.length === 0)} SÆSON-AGGREGAT, finale-bånd uden stikprøve-tillæg (${rapport.sæsonFinale.total} etaper)`);
  for (const v of rapport.sæsonFinaleViol) console.log(`     ! ${v}`);
  console.log(`SAMLET: ${alleBrud} regelbrud · dækning ${dækning.ok ? "OK" : "HULLER"} · ${kollisioner.length} navnekollisioner`);
  console.log(alleBrud === 0 && dækning.ok && !kollisioner.length
    ? "Kalenderen overholder alle gates i docs/CALENDAR_RULES.md.\n"
    : "Se linjerne markeret FEJL / ! ovenfor.\n");
  return alleBrud === 0 && dækning.ok && kollisioner.length === 0;
}

// #4215: exit 1 ved brud. UDEN den er scriptet kun en rapport nogen skal huske at
// læse — og præcis dét var problemet: reglerne fandtes, men intet stoppede en kalender
// der brød dem (#4155 brød TIER_OVERLAP_CAP i alle fire divisioner uopdaget).
const groent = main();
if (!groent) process.exitCode = 1;
