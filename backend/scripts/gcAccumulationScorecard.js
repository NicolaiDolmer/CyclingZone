#!/usr/bin/env node
// GC-akkumulerings-scorecard (#2072) — READ-ONLY prod-verifikation.
//
// For hvert afsluttet etapeløb med resultater: genberegn slut-GC ved at AKKUMULERE
// de persisterede race_results-etaperækker gennem den ÆGTE klassements-kerne
// (raceClassifications.accumulateStageRows + rankByCumTimeAsc) og sammenlign med
// det publicerede slut-GC. Afviger de, har løbet været ramt af re-simulerings-
// arkitekturen (fixet i buildStageRowsAccumulated) — de publicerede etape-gaps og
// slut-GC modsiger hinanden, præcis som spillerne kunne regne ud (Vuelta Burgalesa).
//
//   node scripts/gcAccumulationScorecard.js                 # alle afsluttede etapeløb
//   node scripts/gcAccumulationScorecard.js --name=Burgalesa  # filtrér på navn
//   node scripts/gcAccumulationScorecard.js --limit=20
//
// Skriver INTET — kun SELECTs + konsol-rapport.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllRows } from "../lib/supabasePagination.js";
import {
  accumulateStageRows,
  filterCompletedEntrants,
  rankByCumTimeAsc,
  formatGap,
  parseGapSeconds,
} from "../lib/raceClassifications.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("❌ Missing SUPABASE_URL/SUPABASE_SERVICE_KEY"); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const nameFilter = (process.argv.find((a) => a.startsWith("--name=")) || "").slice("--name=".length);
const limit = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").slice("--limit=".length)) || null;

async function main() {
  let q = supabase
    .from("races")
    .select("id, name, race_class, stages, status")
    .eq("race_type", "stage_race")
    .eq("status", "completed")
    .order("created_at", { ascending: false });
  if (nameFilter) q = q.ilike("name", `%${nameFilter}%`);
  const { data: races, error } = await q;
  if (error) throw new Error(error.message);
  const subset = limit ? races.slice(0, limit) : races;

  let checked = 0, clean = 0, mismatched = 0, skipped = 0;
  const mismatches = [];

  for (const race of subset) {
    const rows = await fetchAllRows(() =>
      supabase
        .from("race_results")
        .select("stage_number, result_type, rank, rider_id, team_id, rider_name, finish_time")
        .eq("race_id", race.id)
        .order("id", { ascending: true })
    );
    const stageRows = rows.filter((r) => r.result_type === "stage" && r.rider_id);
    const publishedGc = rows.filter((r) => r.result_type === "gc").sort((a, b) => a.rank - b.rank);
    if (!stageRows.length || !publishedGc.length) { skipped++; continue; }

    const { data: profiles } = await supabase
      .from("race_stage_profiles")
      .select("stage_number, profile_type")
      .eq("race_id", race.id);
    const profileTypeByStage = new Map((profiles || []).map((p) => [p.stage_number || 1, p.profile_type]));

    // Entrants-surrogat: alle ryttere med mindst én etaperække (team fra rækkerne).
    const riderMeta = new Map();
    for (const r of stageRows) {
      if (!riderMeta.has(r.rider_id)) riderMeta.set(r.rider_id, { rider_id: r.rider_id, team_id: r.team_id, rider_name: r.rider_name });
    }
    const acc = accumulateStageRows({ stageRows, profileTypeByStage });
    const completed = filterCompletedEntrants([...riderMeta.values()], acc.stagesByRider, acc.stageNumbers);
    const gc = rankByCumTimeAsc(completed, acc.cumTime, acc.posSum);
    const leaderTime = gc.length ? gc[0].time : 0;

    checked++;
    const recomputedWinner = gc[0];
    const publishedWinner = publishedGc[0];
    const winnerMatch = recomputedWinner?.rider_id === publishedWinner?.rider_id;
    // Gap-sammenligning på tværs af fælles top-10 (afsløringsgrad uden støj fra bagfeltet).
    let gapDiffs = 0;
    const pubById = new Map(publishedGc.map((p) => [p.rider_id, p]));
    for (const g of gc.slice(0, 10)) {
      const pub = pubById.get(g.rider_id);
      if (!pub) { gapDiffs++; continue; }
      if (parseGapSeconds(pub.finish_time) !== g.time - leaderTime) gapDiffs++;
    }

    if (winnerMatch && gapDiffs === 0) {
      clean++;
    } else {
      mismatched++;
      mismatches.push({
        race: race.name, id: race.id,
        publishedWinner: publishedWinner?.rider_name ?? publishedWinner?.rider_id,
        recomputedWinner: riderMeta.get(recomputedWinner?.rider_id)?.rider_name ?? recomputedWinner?.rider_id,
        recomputedWinnerGapToPublished: publishedWinner && recomputedWinner
          ? formatGap((acc.cumTime.get(publishedWinner.rider_id) || 0) - recomputedWinner.time)
          : "?",
        top10GapDiffs: gapDiffs,
      });
    }
  }

  console.log(`\n📊 GC-akkumulerings-scorecard (#2072) — ${checked} afsluttede etapeløb tjekket (${skipped} uden data)`);
  console.log(`   ✅ ${clean} løb: publiceret slut-GC == sum af publicerede etape-gaps`);
  console.log(`   ❌ ${mismatched} løb: slut-GC MODSIGER de publicerede etaperesultater`);
  for (const m of mismatches) {
    console.log(`\n   ${m.race} (${m.id})`);
    console.log(`     publiceret vinder:  ${m.publishedWinner}`);
    console.log(`     gap-sum-vinder:     ${m.recomputedWinner} (publiceret vinder reelt ${m.recomputedWinnerGapToPublished} efter)`);
    console.log(`     top-10 gap-afvigelser: ${m.top10GapDiffs}`);
  }
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
