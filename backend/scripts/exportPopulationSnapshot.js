#!/usr/bin/env node
// backend/scripts/exportPopulationSnapshot.js
//
// Race v3 S0 dominance-harness (#2224): eksporterer den ÆGTE prod-population
// (ryttere + abilities + hold + condition) til én JSON-fil, som race-harnesset
// senere indlæser via `--population=<fil>`.
//
// 100% READ-ONLY mod prod — kun SELECT. Ingen insert/update/delete/rpc-mutationer.
//
// Dataudvælgelse:
//   1. Hold: EKSKLUDERER test-konti (is_test_account), frosne (is_frozen) og
//      bank-hold (is_bank, hvis kolonnen findes). AI-hold er MED (de kører løb).
//   2. Divisions-tier: løses via league_divisions.tier (probet ved limit-1-select),
//      med fallback til teams.division hvis league_division_id mangler/ikke matcher.
//   3. Ryttere: kun ikke-akademi, ikke-pensionerede ryttere hvis (oprindelige)
//      team_id er på et medtaget hold.
//   4. Aktive udlån (loan_agreements, status='active'): udlånt rytter kører for
//      LÅNER-holdet (to_team_id) — effektiv team_id ombygges. Hvis låner-holdet
//      ikke er blandt de medtagne hold → rytteren droppes (tælles).
//   5. Abilities (rider_derived_abilities): ryttere UDEN abilities-række droppes
//      (tælles) — spejler loadEntrantsForRace's defensive skip.
//   6. Condition (rider_condition): form/fatigue — mangler række → null (ikke drop).
//
// Holdnavne udelades BEVIDST (privatliv — repoet er publicly viewable, og
// snapshots kan blive committet ved en fejl).
//
// Usage:
//   cd backend && node scripts/exportPopulationSnapshot.js
//   node scripts/exportPopulationSnapshot.js --out=path/to/file.json
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role required for fuld læsning)

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ABILITY_KEYS } from "../lib/riderTypes.js";
import { fetchAllPaged, selectInChunks } from "../lib/dbChunk.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE_URL og/eller SUPABASE_SERVICE_KEY (se backend/.env).");
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function argValue(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : null;
}

function todayLocalISODate() {
  // Lokal dato (Europe/Copenhagen-værtsmiljø), YYYY-MM-DD — ikke UTC (kan skifte
  // dato op til 2 timer forkert i CEST hvis man bruger toISOString().slice(0,10)).
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const OUT_PATH = argValue("out")
  || join(REPO_ROOT, "backend", "scripts", "out", `population-snapshot-${todayLocalISODate()}.json`);

// ---------------------------------------------------------------------------
// Schema-probes (skema kan variere let mellem miljøer — fejl pænt, ikke hårdt)
// ---------------------------------------------------------------------------

const schemaSurprises = [];

// Probe: findes teams.is_bank?
async function probeTeamsHasIsBank() {
  const { error } = await supabase.from("teams").select("is_bank").limit(1);
  if (error) {
    schemaSurprises.push(`teams.is_bank findes ikke — bank-hold-eksklusion springes over (${error.message})`);
    return false;
  }
  return true;
}

// Probe: hvilken kolonne på league_divisions bærer tier-tallet?
async function probeLeagueDivisionsTierColumn() {
  const { data, error } = await supabase.from("league_divisions").select("*").limit(1);
  if (error || !data || data.length === 0) {
    schemaSurprises.push(`league_divisions kunne ikke probes (${error?.message || "tom tabel"}) — falder tilbage til teams.division`);
    return null;
  }
  const row = data[0];
  const candidates = ["tier", "level", "division_level", "rank"];
  const found = candidates.find((c) => Object.prototype.hasOwnProperty.call(row, c));
  if (!found) {
    schemaSurprises.push(`league_divisions har ingen genkendt tier-kolonne (prøvede ${candidates.join(", ")}) — falder tilbage til teams.division`);
    return null;
  }
  if (found !== "tier") {
    schemaSurprises.push(`league_divisions bruger "${found}" som tier-kolonne (ikke "tier")`);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Hold
// ---------------------------------------------------------------------------

async function loadTeams() {
  const hasIsBank = await probeTeamsHasIsBank();
  const columns = ["id", "is_ai", "is_test_account", "is_frozen", "league_division_id", "division"];
  if (hasIsBank) columns.push("is_bank");

  const { data, error } = await fetchAllPaged(() => supabase.from("teams").select(columns.join(", ")));
  if (error) throw new Error(`teams-select fejlede: ${error.message}`);

  const included = (data || []).filter((t) => {
    if (t.is_test_account) return false;
    if (t.is_frozen) return false;
    if (hasIsBank && t.is_bank) return false;
    return true;
  });

  return { allTeams: data || [], included, hasIsBank };
}

// Bygger league_division_id → tier (int, 1=øverst). Falder tilbage til
// teams.division (allerede tier-tallet i nuværende skema — men tåler også
// legacy tekst-form som "D1" via regex-parsing af sidste ciffer-gruppe).
async function resolveTeamTiers(teams) {
  const tierColumn = await probeLeagueDivisionsTierColumn();

  let divisionTierById = new Map();
  if (tierColumn) {
    const { data, error } = await fetchAllPaged(() =>
      supabase.from("league_divisions").select(`id, ${tierColumn}`)
    );
    if (error) {
      schemaSurprises.push(`league_divisions-select fejlede (${error.message}) — falder tilbage til teams.division for alle hold`);
    } else {
      for (const row of data || []) {
        divisionTierById.set(row.id, row[tierColumn]);
      }
    }
  }

  function legacyDivisionToTier(division) {
    if (division == null) return null;
    if (typeof division === "number") return division;
    const m = String(division).match(/(\d+)/);
    return m ? Number(m[1]) : null;
  }

  return teams.map((t) => {
    let tier = null;
    if (t.league_division_id != null && divisionTierById.has(t.league_division_id)) {
      tier = divisionTierById.get(t.league_division_id);
    } else {
      tier = legacyDivisionToTier(t.division);
    }
    return { id: t.id, tier, league_division_id: t.league_division_id ?? null, is_ai: !!t.is_ai };
  });
}

// ---------------------------------------------------------------------------
// Ryttere
// ---------------------------------------------------------------------------

async function loadCandidateRiders(includedTeamIds) {
  const { data, error } = await fetchAllPaged(() =>
    supabase
      .from("riders")
      .select("id, firstname, lastname, team_id, is_u25, is_academy, is_retired")
      .eq("is_academy", false)
      .eq("is_retired", false)
      .not("team_id", "is", null)
  );
  if (error) throw new Error(`riders-select fejlede: ${error.message}`);
  return (data || []).filter((r) => includedTeamIds.has(r.team_id));
}

// rider_id → to_team_id for AKTIVE udlån blandt kandidat-rytterne.
async function loadActiveLoanBorrowerByRider(riderIds) {
  if (riderIds.length === 0) return new Map();
  const { data, error } = await selectInChunks({
    supabase,
    table: "loan_agreements",
    columns: "rider_id, to_team_id, status",
    inColumn: "rider_id",
    ids: riderIds,
    extra: (q) => q.eq("status", "active"),
  });
  if (error) throw new Error(`loan_agreements-select fejlede: ${error.message}`);
  const map = new Map();
  for (const row of data || []) map.set(row.rider_id, row.to_team_id);
  return map;
}

async function loadAbilitiesByRider(riderIds) {
  if (riderIds.length === 0) return new Map();
  const columns = ["rider_id", ...ABILITY_KEYS].join(", ");
  const { data, error } = await selectInChunks({
    supabase, table: "rider_derived_abilities", columns, inColumn: "rider_id", ids: riderIds,
  });
  if (error) throw new Error(`rider_derived_abilities-select fejlede: ${error.message}`);
  const map = new Map();
  for (const row of data || []) map.set(row.rider_id, row);
  return map;
}

async function loadConditionByRider(riderIds) {
  if (riderIds.length === 0) return new Map();
  const { data, error } = await selectInChunks({
    supabase, table: "rider_condition", columns: "rider_id, form, fatigue", inColumn: "rider_id", ids: riderIds,
  });
  if (error) throw new Error(`rider_condition-select fejlede: ${error.message}`);
  const map = new Map();
  for (const row of data || []) map.set(row.rider_id, row);
  return map;
}

// ---------------------------------------------------------------------------
// Stats-helpers til konsol-rapport
// ---------------------------------------------------------------------------

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.round((p / 100) * (sortedArr.length - 1))));
  return sortedArr[idx];
}

function formatMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Henter hold (prod, read-only)...");
  const { allTeams, included: includedTeamsRaw, hasIsBank } = await loadTeams();
  const teamsResolved = await resolveTeamTiers(includedTeamsRaw);
  const includedTeamIds = new Set(teamsResolved.map((t) => t.id));

  console.log(`  ${allTeams.length} hold total → ${includedTeamIds.size} medtaget efter eksklusion.`);

  console.log("Henter kandidat-ryttere (ikke-akademi, ikke-pensioneret, ejer-hold medtaget)...");
  const candidates = await loadCandidateRiders(includedTeamIds);
  console.log(`  ${candidates.length} kandidat-ryttere.`);

  console.log("Henter aktive udlån...");
  const candidateIds = candidates.map((r) => r.id);
  const loanBorrowerByRider = await loadActiveLoanBorrowerByRider(candidateIds);

  let droppedLoanOutside = 0;
  const withEffectiveTeam = [];
  for (const r of candidates) {
    const borrowerTeamId = loanBorrowerByRider.get(r.id);
    if (borrowerTeamId != null) {
      if (!includedTeamIds.has(borrowerTeamId)) {
        droppedLoanOutside++;
        continue;
      }
      withEffectiveTeam.push({ ...r, effective_team_id: borrowerTeamId });
    } else {
      withEffectiveTeam.push({ ...r, effective_team_id: r.team_id });
    }
  }
  console.log(`  ${withEffectiveTeam.length} ryttere efter loan-mapping (${droppedLoanOutside} droppet: udlånt til ikke-medtaget hold).`);

  console.log("Henter abilities...");
  const abilitiesByRider = await loadAbilitiesByRider(withEffectiveTeam.map((r) => r.id));

  let droppedNoAbilities = 0;
  const withAbilities = [];
  for (const r of withEffectiveTeam) {
    const abilities = abilitiesByRider.get(r.id);
    if (!abilities) {
      droppedNoAbilities++;
      continue;
    }
    withAbilities.push({ ...r, abilities });
  }
  console.log(`  ${withAbilities.length} ryttere har abilities (${droppedNoAbilities} droppet: ingen abilities-række).`);

  console.log("Henter condition (form/fatigue)...");
  const conditionByRider = await loadConditionByRider(withAbilities.map((r) => r.id));

  const finalRiders = withAbilities.map((r) => {
    const cond = conditionByRider.get(r.id);
    const abilitiesOut = {};
    for (const key of ABILITY_KEYS) abilitiesOut[key] = r.abilities[key] ?? null;
    return {
      id: r.id,
      name: `${r.firstname} ${r.lastname}`,
      team_id: r.effective_team_id,
      is_u25: !!r.is_u25,
      form: cond ? cond.form : null,
      fatigue: cond ? cond.fatigue : null,
      abilities: abilitiesOut,
    };
  });

  // ---------------------------------------------------------------------------
  // Output
  // ---------------------------------------------------------------------------

  const filtersDescription =
    "Ekskluderer teams.is_test_account=true, teams.is_frozen=true"
    + (hasIsBank ? ", teams.is_bank=true" : " (is_bank-kolonne ikke fundet — sprunget over)")
    + "; ekskluderer riders.is_academy=true og is_retired=true; udlånte ryttere flyttet til låner-hold (droppet hvis låner-hold ikke medtaget); ryttere uden rider_derived_abilities-række droppet.";

  const snapshot = {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    source: "prod (read-only)",
    filters: filtersDescription,
    counts: {
      teams: teamsResolved.length,
      riders: finalRiders.length,
      dropped_no_abilities: droppedNoAbilities,
      dropped_loan_outside: droppedLoanOutside,
    },
    teams: teamsResolved.map((t) => ({
      id: t.id,
      tier: t.tier,
      league_division_id: t.league_division_id,
      is_ai: t.is_ai,
    })),
    riders: finalRiders,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(snapshot, null, 2));
  const fileSizeBytes = statSync(OUT_PATH).size;

  // ---------------------------------------------------------------------------
  // Konsol-rapport (ingen secrets, kun tal)
  // ---------------------------------------------------------------------------

  const teamsByTier = new Map();
  for (const t of teamsResolved) {
    const key = t.tier == null ? "ukendt" : t.tier;
    teamsByTier.set(key, (teamsByTier.get(key) || 0) + 1);
  }

  const ridersPerTeam = new Map();
  for (const t of teamsResolved) ridersPerTeam.set(t.id, 0);
  for (const r of finalRiders) ridersPerTeam.set(r.team_id, (ridersPerTeam.get(r.team_id) || 0) + 1);
  const ridersPerTeamSorted = [...ridersPerTeam.values()].sort((a, b) => a - b);

  const ridersWithForm = finalRiders.filter((r) => r.form != null).length;
  const conditionCoveragePct = finalRiders.length > 0
    ? ((ridersWithForm / finalRiders.length) * 100).toFixed(1)
    : "0.0";

  console.log("\n=== Population-snapshot — rapport ===");
  console.log("Hold pr. tier:");
  for (const [tier, count] of [...teamsByTier.entries()].sort((a, b) => (a[0] === "ukendt" ? 1 : b[0] === "ukendt" ? -1 : a[0] - b[0]))) {
    console.log(`  tier ${tier}: ${count} hold`);
  }
  console.log(`Ryttere i alt (eksporteret): ${finalRiders.length}`);
  console.log(`Ryttere pr. hold — p10=${percentile(ridersPerTeamSorted, 10)} median=${percentile(ridersPerTeamSorted, 50)} p90=${percentile(ridersPerTeamSorted, 90)}`);
  console.log(`Droppet — ingen abilities: ${droppedNoAbilities}; udlånt til ikke-medtaget hold: ${droppedLoanOutside}`);
  console.log(`Condition-dækning: ${ridersWithForm}/${finalRiders.length} (${conditionCoveragePct}%) har form != null`);
  console.log(`Output: ${OUT_PATH} (${formatMB(fileSizeBytes)} MB)`);

  if (schemaSurprises.length > 0) {
    console.log("\nSkema-overraskelser:");
    for (const s of schemaSurprises) console.log(`  - ${s}`);
  }
}

main().catch((err) => {
  console.error(`Fejl: ${err.message}`);
  process.exit(1);
});
