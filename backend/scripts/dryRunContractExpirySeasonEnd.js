// #1150 · READ-ONLY dry-run: hvad ville ske ved NÆSTE sæsonskifte hvis kontrakt-
// udløb kørte i dag (genforhandling med frigivelse, ejer-valg 3/8).
//
// Formål: vise PRÆCIS hvor mange ryttere der udløber, fordelt menneske/AI, og
// hvor mange hold der ville miste hvor stor en andel af truppen — DEN oplevelse
// #1150-opgaven kræver bliver "designet, ikke opdaget". Kører ALDRIG writes —
// ren SELECT + de samme rene klassifikations-funktioner som selve motoren
// bruger (isContractExpiringAtTransition, MIN_RIDERS_FOR_RACE,
// DIVISION_SQUAD_LIMITS), så tallene her ALDRIG kan drive fra release-fasens
// egen definition.
//
//   node scripts/dryRunContractExpirySeasonEnd.js
//
// (ingen --live-variant — dette script skriver aldrig noget, uanset flag.)

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";
import { applyHumanTeamFilter } from "../lib/humanTeamFilter.js";
import { isContractExpiringAtTransition } from "../lib/squadRiskGuard.js";
import { MIN_RIDERS_FOR_RACE } from "../lib/marketUtils.js";
import { DIVISION_SQUAD_LIMITS } from "../lib/boardConstants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function fetchActiveSeasonNumber(supabase) {
  const { data, error } = await supabase
    .from("seasons").select("number").eq("status", "active")
    .order("number", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`season lookup: ${error.message}`);
  return data?.number ?? 1;
}

async function fetchRealTeams(supabase) {
  const rows = await fetchAllRows(() =>
    supabase.from("teams")
      .select("id, name, is_ai, is_bank, is_frozen, is_test_account, division")
      .eq("is_bank", false).eq("is_test_account", false).eq("is_frozen", false)
      .order("id")
  );
  return rows;
}

async function fetchSquadRows(supabase, teamIds) {
  if (!teamIds.length) return [];
  return fetchAllRowsChunkedIn(teamIds, (chunk) =>
    supabase.from("riders")
      .select("id, team_id, contract_end_season")
      .in("team_id", chunk)
      .eq("is_academy", false)
      .eq("is_retired", false)
      .order("id")
  );
}

function summarize(teams, ridersByTeam, activeSeasonNumber) {
  const rows = teams.map((t) => {
    const riders = ridersByTeam.get(t.id) || [];
    const currentActive = riders.length;
    const expiring = riders.filter((r) => isContractExpiringAtTransition(r, activeSeasonNumber));
    const projectedNoAction = currentActive - expiring.length;
    const divMin = DIVISION_SQUAD_LIMITS[t.division]?.min ?? MIN_RIDERS_FOR_RACE;
    return {
      teamId: t.id,
      name: t.name,
      isAi: t.is_ai === true,
      division: t.division,
      currentActive,
      expiringCount: expiring.length,
      projectedNoAction,
      lossShare: currentActive > 0 ? expiring.length / currentActive : 0,
      belowRaceMinNoAction: projectedNoAction < MIN_RIDERS_FOR_RACE,
      belowDivisionMinNoAction: projectedNoAction < divMin,
      divisionMin: divMin,
    };
  });
  return rows;
}

async function main() {
  dotenv.config({ path: join(__dirname, "../.env"), quiet: true });
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("FEJL: Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  console.log("=== #1150 · Kontraktudløb ved sæsonskifte — DRY-RUN (read-only, ingen writes) ===");
  const activeSeasonNumber = await fetchActiveSeasonNumber(supabase);
  console.log(`Aktiv sæson: ${activeSeasonNumber} (kandidater: contract_end_season <= ${activeSeasonNumber})\n`);

  const teams = await fetchRealTeams(supabase);
  const squadRows = await fetchSquadRows(supabase, teams.map((t) => t.id));
  const ridersByTeam = new Map();
  for (const r of squadRows) {
    if (!ridersByTeam.has(r.team_id)) ridersByTeam.set(r.team_id, []);
    ridersByTeam.get(r.team_id).push(r);
  }

  const rows = summarize(teams, ridersByTeam, activeSeasonNumber);
  const affected = rows.filter((r) => r.expiringCount > 0);
  const human = affected.filter((r) => !r.isAi);
  const ai = affected.filter((r) => r.isAi);

  const totalExpiring = affected.reduce((n, r) => n + r.expiringCount, 0);
  const totalExpiringHuman = human.reduce((n, r) => n + r.expiringCount, 0);
  const totalExpiringAi = ai.reduce((n, r) => n + r.expiringCount, 0);

  console.log("── Samlet ──");
  console.log(`Ryttere med udløbet/udløbende kontrakt (contract_end_season <= ${activeSeasonNumber}): ${totalExpiring}`);
  console.log(`  Heraf på menneskehold: ${totalExpiringHuman} (${human.length} hold berørt af i alt ${rows.filter((r) => !r.isAi).length})`);
  console.log(`  Heraf på AI-hold:      ${totalExpiringAi} (${ai.length} hold berørt af i alt ${rows.filter((r) => r.isAi).length})`);

  console.log("\n── Hvis INGEN handler (worst case — ingen genforhandling, ingen AI-auto-fornyelse) ──");
  const belowRace = affected.filter((r) => r.belowRaceMinNoAction);
  const belowDiv = affected.filter((r) => r.belowDivisionMinNoAction);
  console.log(`Hold under MIN_RIDERS_FOR_RACE (${MIN_RIDERS_FOR_RACE}): ${belowRace.length} (${belowRace.filter((r) => !r.isAi).length} menneske / ${belowRace.filter((r) => r.isAi).length} AI)`);
  console.log(`Hold under EGEN divisions min-krav: ${belowDiv.length} (${belowDiv.filter((r) => !r.isAi).length} menneske / ${belowDiv.filter((r) => r.isAi).length} AI)`);

  console.log("\n── Efter denne PR's AI-auto-fornyelse (renewExpiringAiContracts kører FØR release) ──");
  console.log(`AI-hold gutning forhindret for alle ${ai.length} berørte AI-hold — deres ${totalExpiringAi} udløbende ryttere fornys automatisk, 0 tilbage til release-fasen.`);
  console.log(`Menneskehold er UÆNDREDE her (frivillig handling, ejer-valg 3/8) — de ${human.length} hold nedenfor er dem der reelt skal handle FØR sæsonskiftet.`);

  console.log("\n── Top 20 mest udsatte MENNESKEHOLD (størst tab, sorteret efter andel af trup) ──");
  const topHuman = [...human].sort((a, b) => b.lossShare - a.lossShare || b.expiringCount - a.expiringCount).slice(0, 20);
  for (const r of topHuman) {
    const flag = r.belowDivisionMinNoAction ? "  ⚠ UNDER DIV-MIN" : (r.belowRaceMinNoAction ? "  ⚠ under løbs-min" : "");
    console.log(`  ${r.name.padEnd(34)} div${r.division}  ${String(r.currentActive).padStart(3)} → ${String(r.projectedNoAction).padStart(3)}  (−${r.expiringCount}, ${(r.lossShare * 100).toFixed(0)}%)${flag}`);
  }

  console.log("\n── Fordeling: hvor stor en ANDEL af truppen mister menneskehold hvis intet fornys ──");
  const buckets = [
    { label: "≥50% af truppen", pred: (r) => r.lossShare >= 0.5 },
    { label: "30-49% af truppen", pred: (r) => r.lossShare >= 0.3 && r.lossShare < 0.5 },
    { label: "10-29% af truppen", pred: (r) => r.lossShare >= 0.1 && r.lossShare < 0.3 },
    { label: "<10% af truppen", pred: (r) => r.lossShare < 0.1 },
  ];
  for (const b of buckets) {
    const n = human.filter(b.pred).length;
    console.log(`  ${b.label.padEnd(20)}: ${n} hold`);
  }

  console.log("\n=== Slut på dry-run — ingen rækker blev ændret ===");
}

main().catch((err) => { console.error("FEJL:", err.message); process.exit(1); });
