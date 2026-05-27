#!/usr/bin/env node
// Refs #667 · genererer fkIDteam-diff for dyn_cyclist Google Sheet.
//
// Læser arket via offentligt CSV-export, joiner mod CZ riders+teams, og udskriver
// (a) en summary, (b) en diff-liste over ryttere der skifter team, og (c) den
// fulde 312-rækkers fkIDteam-kolonne klar til paste ind i sheet-kolonne E.
//
// Algoritme (afstemt 2026-05-27 med bruger, inkl. cleanup-rule kl. 12:00):
//   For hver sheet-row med IDcyclist:
//     - Find CZ rider via pcm_id. Hvis fundet:
//       - Rider.is_retired = true → 119.
//       - Rider på CZ-team hvor is_ai=true ELLER is_bank=true → 119.
//       - Rider på CZ-team hvor teams.ai_source_id IS NOT NULL → ai_source_id.
//       - Ellers (team_id=NULL eller team uden ai_source_id-mapping) → fkIDteam urørt.
//     - Hvis IKKE fundet i CZ:
//       - Cleanup-rule: hvis current fkIDteam er en af de 17 tracked PCM-IDs,
//         men rytteren ikke findes i CZ → 119. PCM-tracked team må kun indeholde
//         CZ-team's ryttere, ikke originale PCM-ryttere som ingen CZ-manager
//         har valgt.
//       - Ellers → fkIDteam urørt.
//
// Read-only mod arket; skriver kun til console + valgfrit til disk via --out.
// Skriver én row til import_log med audit-tal (kan disable med --no-log).
//
// Usage:
//   node scripts/sync-dyn-cyclist-teams.mjs \
//     --sheet "https://docs.google.com/spreadsheets/d/1udT_JNud-5rToeArx3AzC9BYb4uUUMGD8Vd8DSjPQgs/edit"
//
//   Optional:
//     --out <path>       Skriv den fulde fkIDteam-kolonne til fil (1 værdi pr. linje).
//     --diff-out <path>  Skriv kun de skiftende rækker (pcm_id,name,old,new) som CSV.
//     --no-log           Skip import_log INSERT.

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(__dirname, "../backend/.env"), quiet: true });

const BANK_AI_FALLBACK_TEAM_ID = 119;

// PCM-IDs der svarer til CZ user-teams. Bruges af cleanup-rule til at
// evicte gamle PCM-ryttere som ikke længere er på det tilsvarende CZ-team.
// Genereres dynamisk fra teams.ai_source_id i runFunction — denne const er
// kun et fallback hvis DB-query fejler.
const FALLBACK_TRACKED_PCM_IDS = new Set([3, 6, 10, 13, 14, 26, 33, 70, 176, 265, 398, 409, 522, 533, 603, 624, 649]);

function parseArgs(argv) {
  const args = { sheet: null, out: null, diffOut: null, log: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sheet") args.sheet = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--diff-out") args.diffOut = argv[++i];
    else if (a === "--no-log") args.log = false;
    else if (a === "--help" || a === "-h") {
      console.log("Usage: see script header");
      process.exit(0);
    }
  }
  if (!args.sheet) {
    console.error("ERROR: --sheet <google-sheets-url> kræves.");
    process.exit(1);
  }
  return args;
}

function extractSheetId(url) {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) throw new Error(`Kan ikke udtrække sheet-ID fra: ${url}`);
  return m[1];
}

// Parser CSV-linjer der respekterer quoted commas (PCM-eksporter kan have kommaer i navne).
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function fetchSheetCsv(sheetId) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheet-fetch fejlede: ${res.status} ${res.statusText}`);
  return res.text();
}

async function fetchAllRiders(supabase) {
  const all = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("riders")
      .select("id, pcm_id, firstname, lastname, team_id, is_retired")
      .not("pcm_id", "is", null)
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`riders fetch: ${error.message}`);
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

async function fetchAllTeams(supabase) {
  const { data, error } = await supabase
    .from("teams")
    .select("id, name, ai_source_id, is_ai, is_bank");
  if (error) throw new Error(`teams fetch: ${error.message}`);
  return data || [];
}

function buildTeamIndex(teams) {
  const byId = new Map();
  for (const t of teams) byId.set(t.id, t);
  return byId;
}

function computeNewFkIDteam(rider, teamIndex, currentSheetValue) {
  if (rider.is_retired) return BANK_AI_FALLBACK_TEAM_ID;
  if (rider.team_id == null) return currentSheetValue;
  const team = teamIndex.get(rider.team_id);
  if (!team) return currentSheetValue;
  if (team.is_ai || team.is_bank) return BANK_AI_FALLBACK_TEAM_ID;
  if (team.ai_source_id != null) return team.ai_source_id;
  return currentSheetValue;
}

function computeCleanupEvict(currentSheetValue, trackedPcmIds) {
  // Rytter findes ikke i CZ men er på et tracked PCM-team → evict til 119.
  return trackedPcmIds.has(currentSheetValue) ? BANK_AI_FALLBACK_TEAM_ID : currentSheetValue;
}

async function logImport(supabase, summary) {
  const { error } = await supabase.from("import_log").insert({
    import_type: "dyn_cyclist_sheets",
    rows_processed: summary.rows_total,
    rows_updated: summary.diff_count,
    rows_inserted: 0,
    errors: [],
    imported_by: null,
  });
  if (error) console.warn(`⚠ import_log INSERT fejlede: ${error.message}`);
}

async function main() {
  const args = parseArgs(process.argv);
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  console.log("🔄 Henter sheet ...");
  const sheetId = extractSheetId(args.sheet);
  const csv = await fetchSheetCsv(sheetId);
  const lines = csv.split("\n").filter(l => l.trim());
  if (lines.length < 2) throw new Error("Sheet er tomt");

  const headers = parseCsvLine(lines[0]).map(h => h.replace(/^"|"$/g, "").trim());
  const idIdx = headers.indexOf("IDcyclist");
  const teamIdx = headers.indexOf("fkIDteam");
  const lastIdx = headers.indexOf("gene_sz_lastname");
  const firstIdx = headers.indexOf("gene_sz_firstname");
  if (idIdx === -1 || teamIdx === -1) {
    throw new Error(`Forventede kolonner mangler: IDcyclist=${idIdx} fkIDteam=${teamIdx}`);
  }
  console.log(`  ✓ ${lines.length - 1} rytter-rækker i sheet`);

  console.log("🔄 Henter CZ-data ...");
  const [riders, teams] = await Promise.all([
    fetchAllRiders(supabase),
    fetchAllTeams(supabase),
  ]);
  const teamIndex = buildTeamIndex(teams);
  const riderByPcmId = new Map(riders.map(r => [r.pcm_id, r]));
  const trackedPcmIds = new Set(teams.filter(t => t.ai_source_id != null).map(t => t.ai_source_id));
  if (trackedPcmIds.size === 0) {
    console.warn(`  ⚠ Ingen tracked PCM-IDs i DB — bruger fallback-konstant`);
    for (const id of FALLBACK_TRACKED_PCM_IDS) trackedPcmIds.add(id);
  }
  console.log(`  ✓ ${riders.length} ryttere, ${teams.length} hold (${trackedPcmIds.size} tracked PCM-IDs)`);

  console.log("🔄 Computer diff ...");
  const fullColumn = [];
  const diffs = [];
  let inSheetButNotCz = 0;
  let inCzMappedToBank = 0;
  let inCzMappedToTrackedTeam = 0;
  let inCzRetired = 0;
  let untouched = 0;
  let cleanupEvictions = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const pcmIdRaw = cols[idIdx]?.replace(/^"|"$/g, "").trim();
    const pcmId = parseInt(pcmIdRaw, 10);
    const currentRaw = cols[teamIdx]?.replace(/^"|"$/g, "").trim();
    const currentValue = parseInt(currentRaw, 10);

    if (isNaN(pcmId)) {
      fullColumn.push(currentRaw || "");
      untouched++;
      continue;
    }

    const rider = riderByPcmId.get(pcmId);
    if (!rider) {
      const cleanupValue = computeCleanupEvict(currentValue, trackedPcmIds);
      fullColumn.push(String(cleanupValue));
      inSheetButNotCz++;
      if (cleanupValue !== currentValue) {
        const lastname = cols[lastIdx]?.replace(/^"|"$/g, "").trim() || "";
        const firstname = cols[firstIdx]?.replace(/^"|"$/g, "").trim() || "";
        diffs.push({
          row: i + 1,
          pcm_id: pcmId,
          name: `${firstname} ${lastname}`.trim(),
          old: currentValue,
          new: cleanupValue,
          cz_team: "(not in CZ)",
          reason: "cleanup-evict",
        });
        cleanupEvictions++;
      } else {
        untouched++;
      }
      continue;
    }

    const newValue = computeNewFkIDteam(rider, teamIndex, currentValue);
    fullColumn.push(String(newValue));

    if (newValue !== currentValue) {
      const lastname = cols[lastIdx]?.replace(/^"|"$/g, "").trim() || rider.lastname || "";
      const firstname = cols[firstIdx]?.replace(/^"|"$/g, "").trim() || rider.firstname || "";
      const team = rider.team_id ? teamIndex.get(rider.team_id) : null;
      diffs.push({
        row: i + 1,
        pcm_id: pcmId,
        name: `${firstname} ${lastname}`.trim(),
        old: isNaN(currentValue) ? currentRaw : currentValue,
        new: newValue,
        cz_team: team?.name || (rider.is_retired ? "(retired)" : "(unaffiliated)"),
        reason: newValue === BANK_AI_FALLBACK_TEAM_ID
          ? (rider.is_retired ? "retired" : "bank/AI")
          : "team-transition",
      });
    } else {
      untouched++;
    }

    if (rider.is_retired) inCzRetired++;
    else if (rider.team_id) {
      const t = teamIndex.get(rider.team_id);
      if (t?.is_ai || t?.is_bank) inCzMappedToBank++;
      else if (t?.ai_source_id != null) inCzMappedToTrackedTeam++;
    }
  }

  const summary = {
    rows_total: lines.length - 1,
    rows_in_sheet_not_in_cz: inSheetButNotCz,
    diff_count: diffs.length,
    cleanup_evictions: cleanupEvictions,
    untouched,
    cz_riders_mapped_to_tracked_team: inCzMappedToTrackedTeam,
    cz_riders_mapped_to_bank_or_ai: inCzMappedToBank,
    cz_riders_retired: inCzRetired,
  };

  console.log("\n📊 SUMMARY");
  console.log(JSON.stringify(summary, null, 2));

  console.log(`\n🔁 DIFF (${diffs.length} rækker skifter)`);
  if (diffs.length === 0) {
    console.log("  (ingen ændringer)");
  } else {
    console.log("  row | pcm_id | name | old → new | reason (cz_team)");
    console.log("  " + "-".repeat(80));
    for (const d of diffs) {
      console.log(`  ${String(d.row).padStart(3)} | ${String(d.pcm_id).padStart(6)} | ${d.name.padEnd(28)} | ${String(d.old).padStart(4)} → ${String(d.new).padStart(4)} | ${d.reason} (${d.cz_team})`);
    }
  }

  if (args.out) {
    writeFileSync(args.out, fullColumn.join("\n") + "\n");
    console.log(`\n📄 Fuld fkIDteam-kolonne (${fullColumn.length} værdier) → ${args.out}`);
    console.log("   Marker celle E2 i sheet, paste, Enter. Tjek diff bagefter.");
  }

  if (args.diffOut) {
    const csv = "row,pcm_id,name,old,new,reason,cz_team\n" + diffs.map(d =>
      `${d.row},${d.pcm_id},"${d.name}",${d.old},${d.new},${d.reason},"${d.cz_team}"`
    ).join("\n") + "\n";
    writeFileSync(args.diffOut, csv);
    console.log(`📄 Diff-CSV → ${args.diffOut}`);
  }

  if (args.log) {
    await logImport(supabase, summary);
    console.log("\n📝 Audit-row INSERT'd i import_log");
  }

  console.log("\n✅ Færdig");
}

main().catch(err => {
  console.error("❌ Fejl:", err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
