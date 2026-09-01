#!/usr/bin/env node
// backend/scripts/dev/mandateScorecard3514.mjs
// ============================================================================
// #3514 fase 1-rest — SCORECARD-GENERATOREN. Rent READ-ONLY: dette script
// kalder INGEN .insert()/.update()/.upsert()/.delete() nogen steder, kun
// .select(). Det er DET dokument ejeren skal se LIVE før mandateShadowRebuild3514.mjs
// nogensinde køres med --apply (addendum 1/9: "ejer ser scorecardet LIVE før apply").
//
// Producerer en markdown-rapport der sammenligner:
//   1. Confidence-fordeling: gammel model (tre satisfaction-tal pr. hold) vs.
//      ny model (ét migreret confidence-tal), samme regnestykke som
//      mandateMigration3514.mjs/mandateShadowRebuild3514.mjs (delt kilde:
//      backend/lib/boardMandate.js — ÉT sted regner tallet, ikke tre).
//   2. Hold pr. konsekvens-lag, gammel vs. ny model — FLAGER enhver "uforskyldt"
//      krydsning (et hold der lander i et hårdere lag under den nye model end
//      det VÆRSTE af dets tre gamle tal allerede gav det).
//   3. Visions-milepæle pr. mål-sæson (fra nuværende board_profiles-tilstand,
//      grandfathered til planernes egne slut-sæsoner).
//   4. Top-10 største confidence-skift, med årsag (hvilke planer holdet havde,
//      og om skiftet er en OPRUNDING/lettelse eller en NEDRUNDING/stramning).
//
// KØRSEL
//   mod staging/prod (kun SELECT, ingen creds skrives noget sted):
//     cd backend && infisical run --env=prod -- node scripts/dev/mandateScorecard3514.mjs
//   mod fixtures/ingen DB (selvtest af markdown-generatoren):
//     node scripts/dev/mandateScorecard3514.mjs --selvtest
//
// Output: markdown til stdout OG til --out=<fil> hvis angivet.
// Refs #3514.

import { pathToFileURL } from "node:url";

import { createClient } from "@supabase/supabase-js";

import {
  computeMigratedConfidence,
  consequenceLayersFor,
  isBonusBand,
  isUnsignedLongPlan,
  planToMilestones,
} from "../../lib/boardMandate.js";

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(`--${name}`);
const flagValue = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const SELFTEST_ONLY = hasFlag("selvtest");
const OUT_PATH = flagValue("out");
const PAGE = 1000;

// ── Ren markdown-bygger (testbar uden DB — det er DENNE funktion --selvtest kalder) ──
export function buildScorecardMarkdown({ projectRef, activeSeasonNumber, plan, warnings = [] }) {
  const BUCKETS = ["0-9", "10-14", "15-29", "30-39", "40-59", "60-74", "75-89", "90-100"];
  const bucket = (v) => (v < 10 ? "0-9" : v < 15 ? "10-14" : v < 30 ? "15-29" : v < 40 ? "30-39"
    : v < 60 ? "40-59" : v < 75 ? "60-74" : v < 90 ? "75-89" : "90-100");
  const pct = (n, total) => (total ? `${((n / total) * 100).toFixed(1)}%` : "-");

  const total = plan.length;
  const beforeCounts = {}; const afterCounts = {};
  for (const b of BUCKETS) { beforeCounts[b] = 0; afterCounts[b] = 0; }
  let beforeN = 0;
  for (const p of plan) {
    for (const v of Object.values(p.satisfactions)) {
      if (v == null) continue;
      beforeCounts[bucket(v)] += 1; beforeN += 1;
    }
    afterCounts[bucket(p.confidence)] += 1;
  }

  const LAYER_NAMES = { 2: "Lønloft", 3: "Signerings-restriktion", 4: "Tvangslistning", 5: "Sponsor-pullout" };
  const layerRows = [];
  const crossings = [];
  for (const layer of [2, 3, 4, 5]) {
    let oldCount = 0, newCount = 0;
    for (const p of plan) {
      const olds = Object.values(p.satisfactions).filter((v) => v != null);
      if (!olds.length) continue;
      const worstOldLayers = consequenceLayersFor(Math.min(...olds));
      const newLayers = consequenceLayersFor(p.confidence);
      if (worstOldLayers.includes(layer)) oldCount += 1;
      if (newLayers.includes(layer)) newCount += 1;
      if (newLayers.includes(layer) && !worstOldLayers.includes(layer) && !crossings.some((c) => c.team === p.teamName && c.layer === layer)) {
        crossings.push({ team: p.teamName, layer, old: olds, new: p.confidence });
      }
    }
    layerRows.push({ layer, name: LAYER_NAMES[layer], oldCount, newCount });
  }
  let oldBonus = 0, newBonus = 0;
  for (const p of plan) {
    const olds = Object.values(p.satisfactions).filter((v) => v != null);
    if (olds.some((v) => isBonusBand(v))) oldBonus += 1;
    if (isBonusBand(p.confidence)) newBonus += 1;
  }

  const bySeason = {};
  for (const p of plan) for (const m of p.milestones) {
    const key = m.target_season_number;
    if (!bySeason[key]) bySeason[key] = { total: 0, headline: 0 };
    bySeason[key].total += 1;
    if (m.is_headline) bySeason[key].headline += 1;
  }

  const shifts = plan
    .map((p) => {
      const olds = Object.values(p.satisfactions).filter((v) => v != null);
      if (!olds.length) return null;
      const referencePoint = olds.reduce((a, b) => a + b, 0) / olds.length; // simpelt snit til "årsag"-visning
      return { ...p, delta: p.confidence - referencePoint };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 10);

  const lines = [];
  lines.push(`# Mandat-scorecard (#3514)`);
  lines.push("");
  lines.push(`**Genereret:** ${new Date().toISOString()}`);
  lines.push(`**Database:** ${projectRef}`);
  lines.push(`**Aktiv sæson:** ${activeSeasonNumber != null ? `S${activeSeasonNumber}` : "ukendt"}`);
  lines.push(`**Hold i populationen:** ${total}`);
  lines.push(`**READ-ONLY:** dette dokument er genereret af mandateScorecard3514.mjs, som kun læser (\`.select()\`) — ingen mutation er sket.`);
  lines.push("");
  lines.push(`## 1. Confidence-fordeling: gammel model (3 tal) vs. ny model (ét confidence)`);
  lines.push("");
  lines.push(`| Bånd | Før (plan-rækker) | Efter (hold) |`);
  lines.push(`|---|---|---|`);
  for (const b of BUCKETS) {
    lines.push(`| ${b} | ${beforeCounts[b]} (${pct(beforeCounts[b], beforeN)}) | ${afterCounts[b]} (${pct(afterCounts[b], total)}) |`);
  }
  lines.push("");
  lines.push(`## 2. Hold pr. konsekvens-lag: gammel vs. ny model`);
  lines.push("");
  lines.push(`| Lag | Konsekvens | Gammel (værste af 3) | Ny (ét confidence) |`);
  lines.push(`|---|---|---|---|`);
  for (const row of layerRows) {
    lines.push(`| ${row.layer} | ${row.name} | ${row.oldCount} | ${row.newCount} |`);
  }
  lines.push(`| 6 | Bonustilbud (>75) | ${oldBonus} | ${newBonus} |`);
  lines.push("");
  if (crossings.length === 0) {
    lines.push(`✅ **0 hold krydser en NY konsekvens-tærskel uforskyldt.** (Matematisk garanteret af det vægtede snit — se selvtesten i mandateMigration3514.mjs/mandateShadowRebuild3514.mjs.)`);
  } else {
    lines.push(`🔴 **${crossings.length} hold krydser en NY konsekvens-tærskel de ikke sad i under den værste af deres tre gamle tal — STOP OG UNDERSØG:**`);
    lines.push("");
    lines.push(`| Hold | Lag | Gamle tal | Nyt tal |`);
    lines.push(`|---|---|---|---|`);
    for (const c of crossings.slice(0, 30)) {
      lines.push(`| ${c.team} | ${c.layer} (${LAYER_NAMES[c.layer]}) | ${JSON.stringify(c.old)} | ${c.new} |`);
    }
  }
  lines.push("");
  lines.push(`## 3. Visions-milepæle pr. mål-sæson (grandfathered fra planernes egne slut-sæsoner)`);
  lines.push("");
  lines.push(`| Sæson | Milepæle | Heraf headline |`);
  lines.push(`|---|---|---|`);
  for (const [season, counts] of Object.entries(bySeason).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const marker = activeSeasonNumber != null && Number(season) < activeSeasonNumber ? " ⚠ FORTID" : "";
    lines.push(`| S${season}${marker} | ${counts.total} | ${counts.headline} |`);
  }
  lines.push("");
  lines.push(`## 4. Top-10 største confidence-skift`);
  lines.push("");
  lines.push(`| Hold | Gamle tal | Nyt confidence | Delta | Årsag |`);
  lines.push(`|---|---|---|---|---|`);
  for (const s of shifts) {
    const reason = s.delta > 0
      ? "Renormaliseret vægt løfter tallet — holdet manglede en eller flere planer, så de tilbageværende vejer mere"
      : "Renormaliseret vægt sænker tallet, eller de tre gamle tal var spredte og snittet trækker mod midten";
    lines.push(`| ${s.teamName} | ${JSON.stringify(s.satisfactions)} | ${s.confidence} | ${s.delta > 0 ? "+" : ""}${Math.round(s.delta)} | ${reason} |`);
  }
  lines.push("");
  if (warnings.length) {
    const grouped = {};
    for (const w of warnings) grouped[w.reason] = (grouped[w.reason] || 0) + 1;
    lines.push(`## 5. Advarsler`);
    lines.push("");
    for (const [reason, n] of Object.entries(grouped)) lines.push(`- **${reason}:** ${n}`);
  }
  lines.push("");
  return lines.join("\n");
}

// CLI-krop KUN når filen køres direkte (node scripts/dev/mandateScorecard3514.mjs).
// Import (fx `import { buildScorecardMarkdown } from "./mandateScorecard3514.mjs"`,
// som scorecardet også blev kørt via mod prod-data hentet READ-ONLY gennem
// Supabase MCP i #3514-PR'en) skal kunne genbruge den rene markdown-bygger
// UDEN at trigge SUPABASE_URL-tjekket eller process.exit nedenfor.
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain && SELFTEST_ONLY) {
  const md = buildScorecardMarkdown({
    projectRef: "selvtest", activeSeasonNumber: 3,
    plan: [
      { teamName: "A", satisfactions: { "1yr": 80, "3yr": 60, "5yr": 40 }, confidence: 66, milestones: [{ target_season_number: 5, is_headline: true }] },
      { teamName: "B", satisfactions: { "1yr": 20 }, confidence: 20, milestones: [] },
    ],
    warnings: [{ reason: "unsigned_long_plan_excluded" }],
  });
  if (!md.includes("Mandat-scorecard") || !md.includes("konsekvens-lag")) throw new Error("SELVTEST FEJLEDE: markdown mangler forventede sektioner");
  console.log("✅ Selvtest OK (markdown-generatoren producerer alle sektioner).");
  process.exit(0);
}

// ── DB-læsning (kun .select(), ALDRIG en mutation) ──────────────────────────
if (isMain && !SELFTEST_ONLY) {
  const SUPABASE_URL = flagValue("url") || process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = flagValue("key") || process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (kør via infisical run --env=prod -- ...).");
    process.exit(1);
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const projectRef = (() => { try { return new URL(SUPABASE_URL).hostname.split(".")[0]; } catch { return "ukendt"; } })();

  const fetchAll = async (table, cols) => {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from(table).select(cols).range(from, from + PAGE - 1).order("id", { ascending: true });
      if (error) throw new Error(`${table}: ${error.message}`);
      rows.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    return rows;
  };

  const [boards, teams, seasons] = await Promise.all([
    fetchAll("board_profiles", "id, team_id, plan_type, satisfaction, current_goals, season_id, negotiation_status, plan_start_season_number, plan_end_season_number"),
    fetchAll("teams", "id, name, is_ai"),
    fetchAll("seasons", "id, number, status"),
  ]);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const activeSeason = seasons.find((s) => s.status === "active")
    ?? seasons.slice().sort((a, b) => (b.number ?? 0) - (a.number ?? 0))[0] ?? null;

  const parseGoals = (raw) => {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") { try { return JSON.parse(raw) ?? []; } catch { return []; } }
    return [];
  };

  const byTeam = new Map();
  for (const board of boards) {
    if (board.plan_type === "baseline") continue;
    if (!byTeam.has(board.team_id)) byTeam.set(board.team_id, {});
    byTeam.get(board.team_id)[board.plan_type] = board;
  }

  const plan = [];
  const warnings = [];
  for (const [teamId, plans] of byTeam.entries()) {
    const team = teamById.get(teamId);
    if (!team || team.is_ai) continue;

    for (const planType of ["3yr", "5yr"]) {
      if (plans[planType] && isUnsignedLongPlan(plans[planType])) {
        warnings.push({ teamId, reason: "unsigned_long_plan_excluded", planType });
        delete plans[planType];
      }
    }

    const satisfactions = { "1yr": plans["1yr"]?.satisfaction, "3yr": plans["3yr"]?.satisfaction, "5yr": plans["5yr"]?.satisfaction };
    const { confidence } = computeMigratedConfidence(satisfactions);

    const milestones = [];
    for (const planType of ["3yr", "5yr"]) {
      const source = plans[planType];
      if (!source) continue;
      const result = planToMilestones(source, parseGoals(source.current_goals));
      milestones.push(...result.milestones);
      for (const skip of result.skipped) warnings.push({ teamId, reason: skip.reason, planType });
    }

    plan.push({ teamId, teamName: team.name, satisfactions, confidence, milestones });
  }

  const markdown = buildScorecardMarkdown({ projectRef, activeSeasonNumber: activeSeason?.number ?? null, plan, warnings });
  console.log(markdown);
  if (OUT_PATH) {
    const fs = await import("node:fs");
    fs.writeFileSync(OUT_PATH, markdown, "utf8");
    console.error(`\n(skrevet til ${OUT_PATH})`);
  }
}
