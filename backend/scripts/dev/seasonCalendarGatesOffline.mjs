#!/usr/bin/env node
// backend/scripts/dev/seasonCalendarGatesOffline.mjs
// #6367: buildSeasonCalendar's tørkørsel, men 100 % OFFLINE mod den committede katalog-
// fixture (lib/__fixtures__/racePoolCatalog.prod.json, genopfrisket fra prod 14/10).
//
// HVORFOR. buildSeasonCalendar.js læser prod (kun SELECT) og kræver credentials. For at
// kunne rette generatoren mod de låste kalenderregler (CALENDAR_RULES §1d, §5, §6, §6b og
// S5-benchmark-gaten §7c) skal hver ændring kunne måles på sekunder, uden credentials og
// uden netværk. Scriptet kører PRÆCIS samme kæde som tørkørslen: materializeTierCalendars
// (dryRun, mod en hukommelses-supabase bygget af fixturen) → gatePlan → scoreCalendarPlan
// → scorecardGateGroups → S5-benchmark-gaten (plan.s5Benchmark). Det dømmer de samme gates
// og sorterer dem i de samme klasser som buildSeasonCalendar:
//
//   HÅRD (ingen override)   placerings-gates (applyBlocking), blokerende (blocking),
//                           S5-benchmark-gaten, pulje-strukturen (1/2/4/4)
//   OVERRIDE-BAR            K-B sæson-aggregat (--allow-composition-drift),
//                           §6b uniforme mål (--allow-uniform-target-drift)
//   KUN RAPPORT for S5      §7b finale-bånd (erstattet af benchmark-gatens del 3)
//
// Det der IKKE er med: §2c skrive-/erstatnings-gaten og #5592-planlægningsvinduet (de
// læser sæson-rækken og forrige sæsons sidste etape i prod), og prods præcise
// realManagerCount pr. pulje ud over fixturens. Exit 1 hvis en hård eller override-bar
// gate er rød — "grøn uden override" er netop at begge grupper er tomme.
//
// KØRSEL (fra backend/):
//   node scripts/dev/seasonCalendarGatesOffline.mjs --season 5 --first-day 2026-10-28 --last-day 2026-11-28
//   ... --uniform-tilt            (§6b-tilten, som buildSeasonCalendar's flag)
//   ... --race-day-target N|off   (§1d; default sæsonens eget mål)
//   ... --scorecard               (print hele scorecardet, som tørkørslen)
//   ... --base-seed N             (default 1, som materializeren)
//
// Refs #6367

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { materializeTierCalendars } from "../../lib/tierCalendarMaterializer.js";
import { gatePlan } from "../../lib/seasonCalendarGate.js";
import { scoreCalendarPlan, formatScorecard, scorecardGateGroups } from "../../lib/calendarScorecardReport.js";
import { SEASON_RACE_DAY_TARGET, detectRaceDayEqualityViolations } from "../../lib/calendarRaceDayTargets.js";
import { resolveSeasonWindow } from "../../lib/calendarStartDate.js";
import { seasonUuid, quotasForRaceDays, detectSeniorPoolStructureViolations } from "../buildSeasonCalendar.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "..", "..", "lib", "__fixtures__", "racePoolCatalog.prod.json");

/**
 * Hukommelses-supabase over fixturen: kun de læsninger materializeTierCalendars laver i
 * dryRun (select/eq/in/is/or/order/range/maybeSingle). Skrivning findes ikke - et forsøg
 * kaster, så scriptet aldrig kan foregive en apply.
 * @param {Record<string, any[]>} state
 */
export function makeFixtureSupabase(state) {
  /** @param {string} table */
  function from(table) {
    const rows = () => state[table] ?? [];
    /** @type {any[]} */
    const filters = [];
    /** @param {any} row @param {string} cond */
    const matchOrCond = (row, cond) => {
      const [col, op, ...rest] = String(cond).split(".");
      const raw = rest.join(".");
      if (op === "is") return (row[col] ?? null) === (raw === "null" ? null : raw);
      if (op === "eq") return row[col] === raw;
      throw new Error(`fixture-supabase: uunderstøttet .or()-operator "${op}"`);
    };
    /** @param {any} row */
    const matches = (row) => filters.every((f) =>
      f.t === "eq" ? row[f.c] === f.v : f.t === "in" ? f.v.includes(row[f.c])
        : f.t === "is" ? (row[f.c] ?? null) === f.v
          : f.t === "or" ? f.conds.some((/** @type {string} */ c) => matchOrCond(row, c)) : true);
    /** @type {any} */
    let selectOpts = null;
    const refuse = () => { throw new Error(`fixture-supabase: ${table} er read-only (offline tørkørsel)`); };
    /** @type {any} */
    const builder = {
      select(/** @type {any} */ _c, /** @type {any} */ opts) { selectOpts = opts || null; return builder; },
      eq(/** @type {string} */ c, /** @type {any} */ v) { filters.push({ t: "eq", c, v }); return builder; },
      in(/** @type {string} */ c, /** @type {any[]} */ v) { filters.push({ t: "in", c, v }); return builder; },
      is(/** @type {string} */ c, /** @type {any} */ v) { filters.push({ t: "is", c, v }); return builder; },
      or(/** @type {string} */ expr) { filters.push({ t: "or", conds: String(expr).split(",") }); return builder; },
      order() { return builder; },
      limit() { return builder; },
      range(/** @type {number} */ a, /** @type {number} */ b) { return Promise.resolve({ data: rows().filter(matches).slice(a, b + 1), error: null }); },
      maybeSingle() { return Promise.resolve({ data: rows().filter(matches)[0] ?? null, error: null }); },
      insert: refuse, update: refuse, delete: refuse, upsert: refuse,
      then(/** @type {any} */ res, /** @type {any} */ rej) {
        if (selectOpts?.head) return Promise.resolve({ count: rows().filter(matches).length, data: null, error: null }).then(res, rej);
        return Promise.resolve({ data: rows().filter(matches), error: null }).then(res, rej);
      },
    };
    return builder;
  }
  return { from };
}

/** Fixturen → tabellerne materializeren læser. Ægte managers syntetiseres pr. pulje. */
export function fixtureTables(fixture) {
  const teams = [];
  for (const p of fixture.pools) {
    for (let i = 0; i < (p.realManagerCount ?? 0); i++) {
      teams.push({ id: `t-${p.id}-${i}`, league_division_id: p.id, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false });
    }
  }
  return {
    league_divisions: fixture.pools.map((p) => ({ id: p.id, tier: p.tier, pool_index: p.pool_index ?? p.id, label: p.label, retired_at: p.retired_at ?? null, squad: null })),
    teams,
    race_pool: fixture.catalog.map((c) => ({ ...c, retired_at: null, squad: null })),
    races: [],
    seasons: [],
  };
}

/**
 * Hele tørkørslen offline. Returnerer gate-grupperne + scorecardet.
 * @param {{ seasonNumber: number, firstDay: string, lastDay?: string|null, raceDays?: number|null,
 *   uniformTilt?: boolean, raceDayTarget?: number|null|undefined, baseSeed?: number, fixture?: any,
 *   seasonId?: string|null }} opts
 *   seasonId  kun robusthedsmålingen (--draws): et andet parcours-træk (seed-nøglen indeholder
 *             season_id) for samme løbsudvalg. Default = sæsonens rigtige id.
 */
export async function runOfflineSeasonGates({
  seasonNumber, firstDay, lastDay = null, raceDays = null, uniformTilt = false, raceDayTarget = undefined, baseSeed = 1, fixture = null,
  seasonId = null,
}) {
  const fx = fixture ?? JSON.parse(readFileSync(FIXTURE, "utf8"));
  const supabase = makeFixtureSupabase(fixtureTables(fx));
  const window = resolveSeasonWindow({
    firstRaceDay: firstDay, seasonNumber,
    ...(raceDays != null ? { raceDays } : {}),
    ...(lastDay != null ? { lastRaceDay: lastDay } : {}),
  });
  const realDays = window.raceDays;
  const quotas = quotasForRaceDays(realDays);
  const target = raceDayTarget === undefined ? (SEASON_RACE_DAY_TARGET[seasonNumber] ?? null) : raceDayTarget;
  const from = new Date(Date.parse(`${firstDay}T00:00:00Z`) - 86_400_000);
  const plan = await materializeTierCalendars({
    supabase, seasonId: seasonId ?? seasonUuid(seasonNumber), seasonNumber, seasonStartDate: firstDay, from, dryRun: true,
    baseSeed, realDays, quotas, useUniformTierTilt: uniformTilt, raceDayTarget: target,
    seasonTransitionAt: null, seasonLastRaceDay: window.lastRaceDay, squad: "senior",
  });
  const { blocking, compositionDrift, tierCompositionDrift, report } = gatePlan(plan, {
    allowTierCompositionDrift: false, raceDayEqualityBlocking: false,
  });
  for (const v of detectSeniorPoolStructureViolations({ planTiers: plan.planTiers ?? [], seasonNumber })) blocking.push(`pulje-struktur — ${v}`);
  const profilesByTier = new Map((plan.planTiers ?? []).map((t) => [t.tier, t.profilesByPoolRaceId ?? new Map()]));
  const rapport = scoreCalendarPlan({
    tierPlans: plan.planTiers ?? [], profilesByTier, archetypeByPoolRace: plan.archetypeByPoolRace ?? new Map(),
    firstRaceDay: firstDay, realDays,
  });
  const groups = scorecardGateGroups(rapport);
  blocking.push(...groups.blocking);
  const applyBlocking = [...(groups.applyBlocking ?? [])];
  const s5 = plan.s5Benchmark ?? { applies: false, blocking: [], lines: [] };
  if (s5.applies) applyBlocking.push(...s5.blocking);
  const axisByTier = Object.fromEntries((plan.planTiers ?? []).map((t) => [t.tier, t.raceDayAxisLength ?? t.timelineLength ?? 0]));
  const raceDayEquality = detectRaceDayEqualityViolations({ axisByTier, target });
  return {
    plan, report, rapport, window, realDays, quotas, raceDayTarget: target, axisByTier, raceDayEquality, s5,
    hard: [...applyBlocking, ...blocking],
    overridable: [...compositionDrift, ...groups.uniformDrift],
    tierCompositionDrift,
    reportOnly: s5.applies ? groups.finaleDrift : [],
    finaleDrift: groups.finaleDrift,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  const argOf = (/** @type {string} */ f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const seasonNumber = Number(argOf("--season") ?? 5);
  const firstDay = argOf("--first-day");
  if (!firstDay || !/^\d{4}-\d{2}-\d{2}$/.test(firstDay)) { console.error("--first-day YYYY-MM-DD kræves"); process.exit(2); }
  const rdt = argOf("--race-day-target");
  const raceDayTarget = rdt == null ? undefined : (String(rdt).toLowerCase() === "off" || rdt === "0" ? null : Number(rdt));
  const r = await runOfflineSeasonGates({
    seasonNumber, firstDay, lastDay: argOf("--last-day"), raceDays: argOf("--race-days") ? Number(argOf("--race-days")) : null,
    uniformTilt: argv.includes("--uniform-tilt"), raceDayTarget, baseSeed: argOf("--base-seed") ? Number(argOf("--base-seed")) : 1,
  });
  console.log(`=== Sæson ${seasonNumber} OFFLINE tørkørsel (fixture, intet skrevet) — ${firstDay} → ${r.window.lastRaceDay} · ${r.realDays} løbsdatoer ===`);
  console.log(`  profil-model: ${r.plan.profileModel} · §6b-tilt: ${argv.includes("--uniform-tilt") ? "TIL" : "FRA"} · §1d-mål: ${r.raceDayTarget ?? "FRA"}`);
  console.log(`  løbsdage pr. division: ${Object.entries(r.axisByTier).map(([t, n]) => `D${t} ${n}`).join(" · ")}`);
  if (argv.includes("--scorecard")) {
    for (const line of formatScorecard(r.rapport, { heading: `SÆSON ${seasonNumber} — KALENDER-SCORECARD (offline)` })) console.log(line);
    for (const line of r.s5.lines ?? []) console.log(line);
  }
  console.log(`\nK-B sæson: ${r.report.rows.map((x) => `${x.label} ${x.actual.toFixed(1)}/${x.target}${x.pass ? "" : "✗"}`).join(" · ")}`);
  const show = (/** @type {string} */ title, /** @type {string[]} */ list) => {
    console.log(`\n${list.length ? "❌" : "✅"} ${title} (${list.length})`);
    for (const x of list) console.log(`   · ${x}`);
  };
  show("HÅRDE gates (ingen override)", r.hard);
  show("OVERRIDE-BARE gates (K-B sæson, §6b)", r.overridable);
  if (r.reportOnly.length) console.log(`\n-- §7b finale-bånd for S5: ${r.reportOnly.length} linjer, kun rapport (§7c)`);
  process.exitCode = r.hard.length || r.overridable.length ? 1 : 0;
}
