#!/usr/bin/env node
// Permanent forward-guard for #2377: hver liga-pulje (league_divisions) SKAL
// have PRÆCIS 24 hold. Ikke 23, ikke 25 — ejer-kravet er absolut og gælder
// ALLE grupper i ALLE divisioner, ingen undtagelser/whitelist.
//
// BAGGRUND: prod-audit 12/7 fandt 9 overskudshold på tværs af 4 puljer
// (Division 1: 25, Division 3 A-D: 25×4, Division 4 B/C: 26×2) — alle enten
// AI-hold fra pyramide-omlægningen (#2187-rod-årsagen) eller et frosset
// test-hold uden is_test_account-flag. Reparationen (ejer-go krævet,
// destruktiv) er separat spor; dette script er KUN forward-guarden, så
// ENHVER fremtidig afvigelse opdages inden for et døgn uanset årsag.
//
// Ren læse-audit: SELECT teams + league_divisions + riders (til
// rider_count-signalet), INGEN writes. Rapporterer pr. gruppe: label, antal,
// delta (+/-), og en topliste over sandsynlige overskudskandidater — AI-hold
// (nyest oprettet), frosne hold, og 0-rytter-hold — som beslutningshjælp til
// den (manuelle, ejer-godkendte) reparation. Scriptet trimmer INTET selv.
//
// Usage:
//   node backend/scripts/audit-league-size-invariant.js          # human-readable
//   node backend/scripts/audit-league-size-invariant.js --json   # JSON for CI
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role required)
// Exit: 1 hvis ENHVER gruppe ≠ 24 hold, 0 hvis alt er præcis 24.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatSupabaseAuditError } from "./audit-error-classifier.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });

export const REQUIRED_TEAM_COUNT = 24;
export const TOP_CANDIDATES = 5;
const PAGE_SIZE = 1000;

// Kanonisk paginering (spejler backend/lib/supabasePagination.js — dupliceret
// lokalt i stedet for importeret, så scriptet forbliver et selvstændigt,
// let-testbart CLI-værktøj uden en runtime-afhængighed på backend/lib).
async function fetchAllRows(buildQuery, pageSize = PAGE_SIZE) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

// Overskuds-score: højere = mere sandsynlig sikker trim-kandidat. Matcher
// #2377's observerede overskuds-profil (AI-hold, frosset, eller 0-rytter).
// Ren funktion — ingen sideeffekter, kun rangering til beslutningsstøtte.
export function excessScore(team) {
  let score = 0;
  if (team.is_ai) score += 4;
  if (team.is_frozen) score += 2;
  if (team.rider_count === 0) score += 3;
  return score;
}

function toCandidate(team, riderCountByTeam) {
  return {
    id: team.id,
    name: team.name,
    is_ai: !!team.is_ai,
    is_frozen: !!team.is_frozen,
    created_at: team.created_at,
    rider_count: riderCountByTeam.get(team.id) || 0,
  };
}

// REN orkestrering (DB injiceres) — testbar uden createClient.
export async function runLeagueSizeAudit({
  supabase,
  requiredCount = REQUIRED_TEAM_COUNT,
  topCandidates = TOP_CANDIDATES,
}) {
  const [divisions, teams, riderRows] = await Promise.all([
    fetchAllRows(() =>
      supabase.from("league_divisions").select("id, tier, pool_index, label").order("id", { ascending: true })
    ).catch((error) => {
      throw new Error(formatSupabaseAuditError("league_divisions select", error));
    }),
    fetchAllRows(() =>
      supabase
        .from("teams")
        .select("id, name, is_ai, is_frozen, is_bank, created_at, league_division_id, pending_removal_at")
        .order("id", { ascending: true })
    ).catch((error) => {
      throw new Error(formatSupabaseAuditError("teams select", error));
    }),
    fetchAllRows(() =>
      supabase.from("riders").select("team_id").not("team_id", "is", null).order("id", { ascending: true })
    ).catch((error) => {
      throw new Error(formatSupabaseAuditError("riders select", error));
    }),
  ]);

  const riderCountByTeam = new Map();
  for (const row of riderRows) {
    riderCountByTeam.set(row.team_id, (riderCountByTeam.get(row.team_id) || 0) + 1);
  }

  // Bank-hold (is_bank) er en systemkonto, ikke et rigtigt hold i en pulje —
  // ekskludér fra invariant-tællingen (spejler #2361-mønstret: match UI/spil-
  // logikkens filter for "rigtige hold").
  // #2639: hold der ER markeret til fjernelse (pending_removal_at) tæller IKKE
  // med i invarianten. De er allerede besluttet ude — men aiTeamTrimHealSweep
  // må ikke slette et hold med igangværende løbs-entries (guarden fra #2074),
  // så markøren består indtil løbene er afviklet. Uden dette filter rapporterer
  // auditen en "overtrædelse" for en pulje der reelt HAR 24 aktive hold, og
  // checket bliver rødt på ALLE PR'er i dagevis (målt 23/7: 11 markerede hold i
  // 5 puljer, hver med 6-7 igangværende løb; hver pulje = præcis 24 uden dem).
  const realTeams = teams.filter((t) => !t.is_bank && t.pending_removal_at == null);

  // Teams uden league_division_id (endnu ikke pulje-allokeret — typisk
  // dev/test-hold, jf. #1608 "NULL = endnu ikke pulje-allokeret") hører ikke
  // til nogen "gruppe" og er derfor uden for #2377's 24-hold-invariant (den
  // gælder puljer, ikke ikke-allokerede hold). Et separat spor kan tage
  // "team uden pulje" op som sit eget kvalitetstjek hvis det bliver relevant.
  const teamsByDivision = new Map();
  for (const team of realTeams) {
    if (team.league_division_id == null) continue;
    if (!teamsByDivision.has(team.league_division_id)) teamsByDivision.set(team.league_division_id, []);
    teamsByDivision.get(team.league_division_id).push(team);
  }

  const sortedDivisions = [...divisions].sort((a, b) => a.tier - b.tier || a.pool_index - b.pool_index);
  const findings = [];
  for (const div of sortedDivisions) {
    const groupTeams = teamsByDivision.get(div.id) || [];
    const count = groupTeams.length;
    if (count === requiredCount) continue;
    const delta = count - requiredCount;
    const candidates = groupTeams
      .map((t) => toCandidate(t, riderCountByTeam))
      .sort((a, b) => excessScore(b) - excessScore(a) || new Date(b.created_at) - new Date(a.created_at))
      .slice(0, topCandidates);
    findings.push({
      league_division_id: div.id,
      label: div.label,
      tier: div.tier,
      pool_index: div.pool_index,
      count,
      required: requiredCount,
      delta,
      top_candidates: delta > 0 ? candidates : [],
    });
  }

  return {
    generated_at: new Date().toISOString(),
    required_team_count: requiredCount,
    groups_checked: sortedDivisions.length,
    total_findings: findings.length,
    findings,
  };
}

function formatCandidateLine(c) {
  const flags = [c.is_ai ? "AI" : null, c.is_frozen ? "frosset" : null, c.rider_count === 0 ? "0-ryttere" : null]
    .filter(Boolean)
    .join(", ");
  const flagsStr = flags ? ` [${flags}]` : "";
  const created = c.created_at ? c.created_at.slice(0, 10) : "?";
  return `      - ${c.name} (${c.id})${flagsStr} — oprettet ${created}, ${c.rider_count} ryttere`;
}

function printHuman(summary) {
  console.log(`League-size invariant audit — ${summary.generated_at}`);
  console.log(`Krav: præcis ${summary.required_team_count} hold pr. pulje (${summary.groups_checked} puljer tjekket)`);
  console.log(`Total findings: ${summary.total_findings}\n`);

  if (summary.total_findings === 0) {
    console.log("OK — alle puljer har præcis 24 hold.\n");
    return;
  }

  for (const f of summary.findings) {
    const sign = f.delta > 0 ? `+${f.delta}` : `${f.delta}`;
    console.log(`  ${f.label}: ${f.count} hold (krav ${f.required}, delta ${sign})`);
    if (f.top_candidates.length > 0) {
      console.log(`    Sandsynlige overskudskandidater (top ${f.top_candidates.length}):`);
      for (const c of f.top_candidates) console.log(formatCandidateLine(c));
    }
  }
  console.log();
}

// ---------------------------------------------------------------------------
// CLI entry — kun når scriptet køres direkte (ikke ved import i tests).
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const JSON_OUT = args.includes("--json");

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(2);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const summary = await runLeagueSizeAudit({ supabase });
    if (JSON_OUT) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      printHuman(summary);
    }
    process.exit(summary.total_findings > 0 ? 1 : 0);
  } catch (error) {
    console.error(error.message || error);
    process.exit(2);
  }
}
