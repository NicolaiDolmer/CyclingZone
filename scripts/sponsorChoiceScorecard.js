#!/usr/bin/env node
// scripts/sponsorChoiceScorecard.js
// #2948 "Sponsorvalg 2.0" — READ-ONLY scorecard der sammenligner den GAMLE
// sponsor-model (3 EV-identiske varianter, alle summerede til renownTarget ved
// fuld deltagelse) mod de 5 NYE arketyper (sponsorOffers.ARCHETYPES) mod den
// ÆGTE prod-population (sæson 1 standings + sæson 2 kalender).
//
// KUN SELECT. Ingen mutationer, ingen writes, ingen migrations, ingen insert/
// update/delete-kald nogen steder i denne fil.
//
// Facit (single source of truth — genbruges direkte, ingen dupliperede tal):
//   backend/lib/sponsorOffers.js      → ARCHETYPES (guaranteedFraction/raceDayShare/clauses)
//   backend/lib/renownEngine.js       → renownTarget (division × resultat-multiplier)
//   backend/lib/economyConstants.js   → SPONSOR_INCOME_BY_DIVISION (via renownTarget)
//   backend/lib/sponsorContractsService.js → loadSeasonStageCounts (S2-kalender-kontekst)
//
// Model — "fuld deltagelse" (som i sponsorOffers-kommentaren: PR ETAPE-enheden
// gør at variabel-pulje/divisor CANCELLER ud ved fuld deltagelse — perRaceDayRate
// × faktiske etaper = raceDayShare × target når faktiske etaper == divisor).
// Derfor er scenarie-totalerne uafhængige af det faktiske S2-etapetal ved fuld
// deltagelse; kalender-sektionen er ren kontekst/diagnostik (bekræfter at S2 er
// seedet, ikke et input til beløbene).
//
// Deltagelses-følsomhed (§8): "variable del" pr. arketype = den del af beløbet
// der skalerer med antal etaper holdet reelt starter i — race-day-poolen
// (raceDayShare × target) og for 'results' også den optjente sejr/podie-bonus
// (som proxy'er styrke over sæsonen, og derfor også er aktivitets-afhængig).
// Garanteret base, signing-bonus (loyal) og sæsonmåls-bonus (ambition) er
// ÉN-GANGS/kontrakt-bundne beløb der IKKE er etape-afhængige → uændrede ved
// lavere deltagelse.
//
// Usage:
//   node scripts/sponsorChoiceScorecard.js
//   node scripts/sponsorChoiceScorecard.js --advisory   (rapportér uden at fælde exit-koden)
//
// #3009: HEADLINE GUARD FAIL fælder exit-koden (samme fejlklasse som
// backend/scripts/moneySupplyScorecard.js + inflationScorecard.js — fundet under
// #3009's backwards-check: scriptet printede "🔴 GUARD FAIL" uden nogensinde at
// sætte en non-zero exit-kode).
//
// Refs #2948, #3009.

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import { renownTarget } from "../backend/lib/renownEngine.js";
import { ARCHETYPES } from "../backend/lib/sponsorOffers.js";
import { loadSeasonStageCounts } from "../backend/lib/sponsorContractsService.js";
import { gateExitCode } from "../backend/scripts/lib/scorecardExitCode.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

// ── Env-load: backend/.env først (hvor SUPABASE_URL/SUPABASE_SERVICE_KEY reelt
// bor i denne repo), derefter rod-.env som fallback. quiet:true → ingen støj
// hvis filerne ikke findes; vi tjekker selv bagefter og rapporterer eksplicit. ─
dotenv.config({ path: path.resolve(SCRIPT_DIR, "../backend/.env"), quiet: true });
dotenv.config({ path: path.resolve(SCRIPT_DIR, "../.env"), quiet: true });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Mangler Supabase-env. Fandt:");
  console.error(`  SUPABASE_URL              : ${SUPABASE_URL ? "sat" : "MANGLER"}`);
  console.error(`  SUPABASE_SERVICE_ROLE_KEY : ${process.env.SUPABASE_SERVICE_ROLE_KEY ? "sat" : "mangler"}`);
  console.error(`  SUPABASE_SERVICE_KEY      : ${process.env.SUPABASE_SERVICE_KEY ? "sat" : "mangler"}`);
  console.error(`  SERVICE_KEY               : ${process.env.SERVICE_KEY ? "sat" : "mangler"}`);
  console.error("Ledte i backend/.env og rod-.env. Sæt SUPABASE_URL + én af de tre key-varianter.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// ────────────────────────────────────────────────────────────────────────────
// Generisk range-pagineret SELECT (PostgREST capper stille ved 1000 rækker —
// se scripts/lint-postgrest-in-cap.mjs). Stabil .order("id") i modify-callback
// er callerens ansvar (håndhævet ved konvention, ikke af helperen selv).
// ────────────────────────────────────────────────────────────────────────────
async function fetchAll(table, select, modify = (q) => q) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await modify(supabase.from(table).select(select)).range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

const fmt = (n) => Math.round(n).toLocaleString("da-DK");
const fmtMio = (n) => (n / 1_000_000).toFixed(2) + " mio";
const fmtPct = (n) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

function percentile(sortedArr, p) {
  if (!sortedArr.length) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.round((p / 100) * (sortedArr.length - 1))));
  return sortedArr[idx];
}

function clauseShare(archetype, type) {
  const c = archetype.clauses.find((cl) => cl.type === type);
  return c ? Number(c.share) || 0 : 0;
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Population — menneskehold (is_ai=false, is_bank=false, is_frozen=false).
//    Forsøger også is_test_account=false (kanonisk "rigtige hold"-filter, se
//    feedback_match_ui_filter_for_capacity_logic); falder tilbage hvis kolonnen
//    ikke findes i denne DB.
// ────────────────────────────────────────────────────────────────────────────
async function loadPopulation() {
  try {
    const rows = await fetchAll(
      "teams",
      "id, division, league_division_id, is_ai, is_bank, is_frozen, is_test_account",
      (q) => q.order("id")
    );
    return {
      teams: rows.filter((t) => !t.is_ai && !t.is_bank && !t.is_frozen && !t.is_test_account),
      usedTestAccountFilter: true,
    };
  } catch (e) {
    if (!/is_test_account/i.test(e.message)) throw e;
    const rows = await fetchAll(
      "teams",
      "id, division, league_division_id, is_ai, is_bank, is_frozen",
      (q) => q.order("id")
    );
    return {
      teams: rows.filter((t) => !t.is_ai && !t.is_bank && !t.is_frozen),
      usedTestAccountFilter: false,
    };
  }
}

async function loadSeasonId(number) {
  const { data, error } = await supabase.from("seasons").select("id, number").eq("number", number).maybeSingle();
  if (error) throw new Error(`seasons(number=${number}): ${error.message}`);
  return data?.id ?? null;
}

async function loadStandings(seasonId) {
  if (!seasonId) return [];
  return fetchAll(
    "season_standings",
    "id, season_id, team_id, division, league_division_id, rank_in_division, total_points",
    (q) => q.eq("season_id", seasonId).order("id")
  );
}

// S1 stage-sejre (rank=1) og podier (rank 2-3), result_type='stage', joined til
// hold via team_id — proxy for "faktisk S2-styrke" (task-spec §5, 'results'-arketype).
async function loadStageBonuses(s1SeasonId) {
  const map = new Map(); // team_id -> { wins, podiums }
  if (!s1SeasonId) return map;
  const rows = await fetchAll(
    "race_results",
    "id, team_id, rank, races!inner(season_id)",
    (q) =>
      q
        .eq("result_type", "stage")
        .lte("rank", 3)
        .not("team_id", "is", null)
        .eq("races.season_id", s1SeasonId)
        .order("id")
  );
  for (const r of rows) {
    const entry = map.get(r.team_id) || { wins: 0, podiums: 0 };
    if (Number(r.rank) === 1) entry.wins += 1;
    else if (Number(r.rank) === 2 || Number(r.rank) === 3) entry.podiums += 1;
    map.set(r.team_id, entry);
  }
  return map;
}

async function loadPendingContracts() {
  return fetchAll("sponsor_contracts", "team_id, length_seasons, status", (q) =>
    q.eq("status", "pending").order("id")
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Renown-target pr. hold for S2 — genbruger renownEngine.renownTarget direkte
// (samme opslags-mønster som sponsorContractsService.loadRenownTargetValue:
// division = holdets AKTUELLE (S2) division; lastSeasonStanding/divisionStandings
// = S1-placeringen i DENS EGEN datidige pulje/tier).
// ────────────────────────────────────────────────────────────────────────────
function buildRenownTargets(teams, s1Standings) {
  const standingByTeam = new Map(s1Standings.map((s) => [s.team_id, s]));
  const out = new Map();
  for (const t of teams) {
    const standing = standingByTeam.get(t.id) || null;
    const divisionStandings = standing ? s1Standings.filter((s) => s.division === standing.division) : [];
    const target = renownTarget({ division: t.division, lastSeasonStanding: standing, divisionStandings });
    out.set(t.id, { target, standing });
  }
  return out;
}

// Pulje-størrelser af S1-PULJEN (league_division_id), ikke tieren — matcher
// sponsorContractsService.evaluateSeasonObjectives's poolSizes-logik. Falder
// tilbage til tier ("division") hvis INGEN standings har en pulje-reference
// (S1 kørt før pulje-kolonnen fandtes). Bruges til BÅDE top-halvdel (#2948,
// legacy-kontrakter) og top-40% (#3192, nye ambition-tilbud) — se
// docs/audits/2026-08-03-sponsor-archetype-ev-3192.md.
function buildTopHalfLookup(s1Standings) {
  const anyPool = s1Standings.some((s) => s.league_division_id != null);
  const groupKey = anyPool ? "league_division_id" : "division";
  const poolSizes = {};
  for (const s of s1Standings) {
    const key = s[groupKey];
    if (key == null) continue;
    poolSizes[key] = (poolSizes[key] || 0) + 1;
  }
  return { poolSizes, groupKey, usedPoolFallback: !anyPool };
}

// fraction: 0.5 = top-halvdel (legacy), 0.4 = top-40% (#3192-arketypen).
function computedTopFraction(standing, topHalfLookup, fraction) {
  if (!standing) return false;
  const key = standing[topHalfLookup.groupKey];
  const poolSize = key != null ? topHalfLookup.poolSizes[key] : null;
  const rank = Number(standing.rank_in_division);
  if (!Number.isFinite(rank) || !(Number(poolSize) > 0)) return false;
  return rank <= Math.ceil(poolSize * fraction);
}

// ────────────────────────────────────────────────────────────────────────────
// Arketype-beløb ved FULD deltagelse, udledt direkte af ARCHETYPES (facit —
// ingen duplikerede tal). Returnerer { full, variable } pr. arketype, hvor
// `variable` er den etape-/aktivitets-afhængige del brugt i §8-følsomheden.
// ────────────────────────────────────────────────────────────────────────────
const ARCH = Object.fromEntries(ARCHETYPES.map((a) => [a.variant, a]));

function computeArchetypeAmounts(target, s1Stats) {
  const safeVariable = target * ARCH.safe.raceDayShare;
  const safe = target * ARCH.safe.guaranteedFraction + safeVariable;

  const loyalSigning = target * clauseShare(ARCH.loyal, "signing");
  const loyalVariable = target * ARCH.loyal.raceDayShare;
  const loyal = target * ARCH.loyal.guaranteedFraction + loyalSigning + loyalVariable;

  const racingVariable = target * ARCH.racing.raceDayShare;
  const racing = target * ARCH.racing.guaranteedFraction + racingVariable;

  const resultsRaceDayVariable = target * ARCH.results.raceDayShare;
  const stageWinShare = clauseShare(ARCH.results, "stage_win");
  const podiumShare = clauseShare(ARCH.results, "podium");
  const capShare = clauseShare(ARCH.results, "results_cap");
  const wins = s1Stats?.wins || 0;
  const podiums = s1Stats?.podiums || 0;
  const rawBonus = wins * stageWinShare * target + podiums * podiumShare * target;
  const cappedBonus = Math.min(rawBonus, capShare * target);
  const resultsVariable = resultsRaceDayVariable + cappedBonus;
  const results = target * ARCH.results.guaranteedFraction + resultsVariable;

  const ambitionVariable = target * ARCH.ambition.raceDayShare;
  const objectiveClause = ARCH.ambition.clauses.find((c) => c.type === "season_objective");
  const objectiveShare = clauseShare(ARCH.ambition, "season_objective");
  // #3192: ambitionens objective er nu "top_40pct" (var "top_half" før rebalancen);
  // s1Stats bærer begge flag så scorecardet virker uanset hvilken der er aktiv.
  const objectiveAchieved = objectiveClause?.objective === "top_40pct" ? s1Stats?.top40 : s1Stats?.topHalf;
  const objectiveBonus = objectiveAchieved ? objectiveShare * target : 0;
  const ambition = target * ARCH.ambition.guaranteedFraction + ambitionVariable + objectiveBonus;

  return {
    safe: { full: safe, variable: safeVariable },
    loyal: { full: loyal, variable: loyalVariable },
    racing: { full: racing, variable: racingVariable },
    results: { full: results, variable: resultsVariable },
    ambition: { full: ambition, variable: ambitionVariable },
  };
}

// Skalér til participationFraction: kun `variable`-delen skaleres; garanti +
// engangsklausuler (signing/season_objective) er uændrede.
function scaleParticipation(amounts, fraction) {
  const out = {};
  for (const [k, v] of Object.entries(amounts)) {
    out[k] = v.full - v.variable * (1 - fraction);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Scenarie-aggregering + rapport
// ────────────────────────────────────────────────────────────────────────────
const MIX_WEIGHTS = { safe: 0.35, loyal: 0.15, racing: 0.2, results: 0.15, ambition: 0.15 };
// #2589/legacy 3-variant-længde → arketype-proxy for eksisterende pending-valg
// (task-spec §6e): 1 sæson='safe', 2 sæson='racing', 3 sæson='loyal'.
const LENGTH_TO_ARCHETYPE_PROXY = { 1: "safe", 2: "racing", 3: "loyal" };

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((s, v) => s + v, 0);
  return {
    total,
    n: sorted.length,
    p10: percentile(sorted, 10),
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
  };
}

function printScenarioRow(label, values, oldTotal, { guarded = false } = {}) {
  const s = summarize(values);
  const delta = oldTotal > 0 ? ((s.total - oldTotal) / oldTotal) * 100 : 0;
  const guardFail = guarded && Math.abs(delta) > 10;
  const guardTag = guarded ? (guardFail ? "  🔴 GUARD FAIL (|Δ|>10%)" : "  ✅ guard ok") : "";
  console.log(
    `  ${label.padEnd(34, " ")} total ${fmtMio(s.total).padStart(10, " ")}  Δ ${fmtPct(delta).padStart(7, " ")} vs gammel  ` +
      `p10=${fmt(s.p10).padStart(9, " ")}  p50=${fmt(s.p50).padStart(9, " ")}  p90=${fmt(s.p90).padStart(9, " ")}${guardTag}`
  );
  return { ...s, delta, guardFail };
}

async function main() {
  const advisory = process.argv.includes("--advisory");
  console.log("=== #2948 Sponsorvalg 2.0 — scorecard (gammel vs ny model, ægte S1/S2-population) ===\n");
  console.log("READ-ONLY: kun SELECT-kald mod Supabase. Ingen writes.\n");

  const [{ teams, usedTestAccountFilter }, s1SeasonId, s2SeasonId] = await Promise.all([
    loadPopulation(),
    loadSeasonId(1),
    loadSeasonId(2),
  ]);

  console.log(
    `Population: ${teams.length} menneskehold (is_ai=false, is_bank=false, is_frozen=false${
      usedTestAccountFilter ? ", is_test_account=false" : " — is_test_account-kolonne ikke fundet, filter sprunget over"
    })`
  );
  if (!teams.length) {
    console.error("Ingen menneskehold fundet — kan ikke bygge scorecard. Stopper.");
    process.exitCode = 1;
    return;
  }
  console.log(`Sæson 1 id: ${s1SeasonId || "IKKE FUNDET"}  ·  Sæson 2 id: ${s2SeasonId || "IKKE FUNDET"}\n`);
  if (!s1SeasonId) {
    console.error("Sæson 1 (seasons.number=1) findes ikke — renownTarget kan ikke beregnes uden S1-standings. Stopper.");
    process.exitCode = 1;
    return;
  }

  const [s1Standings, stageBonusMap, pendingRows] = await Promise.all([
    loadStandings(s1SeasonId),
    loadStageBonuses(s1SeasonId),
    loadPendingContracts(),
  ]);

  // ── S2-kalender-kontekst (diagnostik — se filhoved: cancellerer ud ved fuld
  // deltagelse, indgår derfor IKKE i beløbsberegningen, kun i rapportens kontekst). ──
  console.log("--- S2-kalender-kontekst (etapetal pr. pulje/tier, samme logik som loadSeasonStageCounts) ---");
  if (s2SeasonId) {
    const stageCounts = await loadSeasonStageCounts({ supabase, seasonNumber: 2 });
    const tiers = Object.keys(stageCounts.byTier).sort();
    if (tiers.length) {
      for (const tier of tiers) {
        console.log(`  Tier ${tier}: ~${stageCounts.byTier[tier]} etaper/hold (gennemsnit over puljer)`);
      }
    } else {
      console.log("  Ingen S2-races med league_division_id fundet endnu (kalender ikke seedet) — fallbackDays=" + stageCounts.fallbackDays);
    }
  } else {
    console.log("  Sæson 2 findes ikke i DB — kalender-kontekst sprunget over.");
  }
  console.log();

  const renownByTeam = buildRenownTargets(teams, s1Standings);
  const topHalfLookup = buildTopHalfLookup(s1Standings);
  if (topHalfLookup.usedPoolFallback) {
    console.log("NOTE: ingen S1-standings har league_division_id → 'top halvdel' beregnes pr. TIER (division) som fallback.\n");
  }

  const targets = teams.map((t) => renownByTeam.get(t.id).target);
  const targetSorted = [...targets].sort((a, b) => a - b);
  console.log(
    `renownTarget pr. hold (S2, fuld deltagelse): sum=${fmtMio(targets.reduce((s, v) => s + v, 0))}  ` +
      `p10=${fmt(percentile(targetSorted, 10))}  p50=${fmt(percentile(targetSorted, 50))}  p90=${fmt(percentile(targetSorted, 90))}\n`
  );

  // Pr.-hold arketype-beløb (fuld deltagelse) + s1-stats.
  const perTeam = teams.map((t) => {
    const { target, standing } = renownByTeam.get(t.id);
    const stageStats = stageBonusMap.get(t.id) || { wins: 0, podiums: 0 };
    const topHalf = computedTopFraction(standing, topHalfLookup, 0.5);
    const top40 = computedTopFraction(standing, topHalfLookup, 0.4);
    const amounts = computeArchetypeAmounts(target, { ...stageStats, topHalf, top40 });
    return { team: t, target, amounts };
  });

  const oldValues = perTeam.map((p) => p.target); // gammel model = target × 1,0 ved fuld deltagelse
  const oldTotal = oldValues.reduce((s, v) => s + v, 0);

  console.log("=== Scenarier (fuld deltagelse, medmindre andet er angivet) ===");
  console.log(`  Gammel model (baseline)            total ${fmtMio(oldTotal).padStart(10, " ")}\n`);

  printScenarioRow("(a) Alle vælger safe", perTeam.map((p) => p.amounts.safe.full), oldTotal);
  printScenarioRow("(b) Alle vælger racing", perTeam.map((p) => p.amounts.racing.full), oldTotal);
  printScenarioRow("(c) Alle vælger results", perTeam.map((p) => p.amounts.results.full), oldTotal);

  const mixValues = perTeam.map((p) =>
    Object.entries(MIX_WEIGHTS).reduce((sum, [variant, w]) => sum + w * p.amounts[variant].full, 0)
  );
  const dRow = printScenarioRow("(d) Realistisk mix 35/15/20/15/15", mixValues, oldTotal, { guarded: true });

  // Faktisk fordeling af eksisterende pending-valg (proxy via length_seasons).
  const pendingByTeam = new Map(pendingRows.map((r) => [r.team_id, r]));
  let defaultedCount = 0;
  const actualValues = perTeam.map((p) => {
    const pending = pendingByTeam.get(p.team.id);
    const variant = pending ? LENGTH_TO_ARCHETYPE_PROXY[pending.length_seasons] : null;
    if (!variant) defaultedCount++;
    return p.amounts[variant || "safe"].full;
  });
  const eRow = printScenarioRow("(e) Faktisk pending-fordeling", actualValues, oldTotal, { guarded: true });
  console.log(
    `      (${pendingRows.length} hold med pending-valg fundet i DB; ${defaultedCount} af ${teams.length} hold defaulter til safe uden match)\n`
  );

  // ── Pr.-arketype breakdown i mix-scenariet (d) ──────────────────────────────
  console.log("--- Pr. arketype i mix-scenariet (d) ---");
  for (const [variant, w] of Object.entries(MIX_WEIGHTS)) {
    const sub = perTeam.reduce((s, p) => s + w * p.amounts[variant].full, 0);
    console.log(`  ${variant.padEnd(10, " ")} (${(w * 100).toFixed(0)}% af holdene): ${fmtMio(sub)}  (${((sub / dRow.total) * 100).toFixed(1)}% af mix-total)`);
  }
  console.log();

  // ── §8 Deltagelses-følsomhed: (d) ved 70% deltagelse (variable del × 0,7) ───
  console.log("--- Deltagelses-følsomhed: scenarie (d) ved 70% deltagelse (variable del × 0,7) ---");
  const mix70Values = perTeam.map((p) => {
    const scaled = scaleParticipation(p.amounts, 0.7);
    return Object.entries(MIX_WEIGHTS).reduce((sum, [variant, w]) => sum + w * scaled[variant], 0);
  });
  const d70 = summarize(mix70Values);
  const delta70VsOld = oldTotal > 0 ? ((d70.total - oldTotal) / oldTotal) * 100 : 0;
  const delta70VsFull = dRow.total > 0 ? ((d70.total - dRow.total) / dRow.total) * 100 : 0;
  console.log(
    `  (d)@70%   total ${fmtMio(d70.total).padStart(10, " ")}  Δ ${fmtPct(delta70VsOld).padStart(7, " ")} vs gammel  ` +
      `Δ ${fmtPct(delta70VsFull).padStart(7, " ")} vs (d)@100%  p10=${fmt(d70.p10)}  p50=${fmt(d70.p50)}  p90=${fmt(d70.p90)}\n`
  );

  console.log("=== HEADLINE ===");
  console.log(
    `  (d) mix-scenarie  : ${dRow.guardFail ? "🔴 GUARD FAIL" : "✅ PASS"} (Δ${fmtPct(dRow.delta)} vs gammel, guard = ±10%)`
  );
  console.log(
    `  (e) faktisk pending: ${eRow.guardFail ? "🔴 GUARD FAIL" : "✅ PASS"} (Δ${fmtPct(eRow.delta)} vs gammel, guard = ±10%)`
  );
  console.log(
    `  (d)@70% deltagelse : Δ${fmtPct(delta70VsOld)} vs gammel (informationel — ingen ±10%-guard krævet på dette punkt)\n`
  );

  // #3009: HEADLINE GUARD FAIL skal fælde exit-koden — ellers kan intet CI/
  // automatiseret job se at guarden er rød. --advisory rapporterer uden at fælde.
  process.exitCode = gateExitCode(!dRow.guardFail && !eRow.guardFail, { advisory });
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exitCode = 1;
});
