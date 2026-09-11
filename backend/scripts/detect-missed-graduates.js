#!/usr/bin/env node
// #5133 · Akademiryttere der faldt ud af graduerings-flowet: hvem mangler sit
// override-vindue, og hvad ville sweepet oprette for dem?
//
// BAGGRUND: detectGraduates koerer KUN ved saeson-transitionen. Misser en rytter
// den batch, findes der ingen raekke for ham — og graduerings-sweepet selekterer
// kun EKSISTERENDE pending-raekker, mens ownership-vagten (invariant G) er
// read-only. Resultatet var en rytter der stod stille fra 23/8 til naeste
// saesonskifte, uden at manageren kunne goere noget.
//
// Dette script er den manuelle udgave af den loebende redningssti i
// backend/lib/missedGraduateSweep.js — SAMME funktion, samme praedikat, begge
// veje. En dry-run der viser andre ryttere end den efterfoelgende koersel er den
// vaerste fejlklasse i et reparations-script (laering 3/9), saa der findes ikke
// et separat, "hurtigt" udvaelgelses-query her.
//
// HVAD --execute GOER: opretter den pending academy_graduation-raekke +
// notifikation som saeson-transitionen ville have oprettet, med et fuldt
// GRADUATION.DEADLINE_DAYS-vindue fra nu. Den roerer INGEN rytter-felter
// (is_academy, kontrakt, team_id staar uroert) og traeffer ikke managerens valg
// for ham — den giver ham valget. Udfaldet afgoeres foerst af managerens eget
// klik eller, hvis vinduet udloeber, af det eksisterende graduerings-sweep.
// Idempotent: en rytter der allerede har en raekke er ikke kandidat, og en tabt
// race paa UNIQUE(rider_id, season_id) taelles som duplicate, ikke som fejl.
//
// Usage:
//   node backend/scripts/detect-missed-graduates.js --dry-run          # default, READ-ONLY
//   node backend/scripts/detect-missed-graduates.js --dry-run --json
//   node backend/scripts/detect-missed-graduates.js --execute
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role)
// Exit: 0 = ok (0 kandidater, eller execute lykkedes), 1 = kandidater fundet i
//       dry-run, 2 = kald-/konfigurationsfejl.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { GRADUATION } from "../lib/academyGraduation.js";
import { runMissedGraduateSweep } from "../lib/missedGraduateSweep.js";
import { STUCK_GRADUATE_GRACE_HOURS } from "../lib/stuckAcademyGraduates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });

/**
 * Holdnavne til kandidaternes team_id'er. Dry-run'en er et beslutningsgrundlag:
 * et bart UUID fortaeller ikke om rytteren sidder paa et menneskehold eller et
 * AI-hold, og netop dét afgoer hvor meget det haster.
 */
export async function fetchTeamLabels(supabase, teamIds) {
  const labels = new Map();
  if (teamIds.length === 0) return labels;
  const { data, error } = await supabase.from("teams").select("id, name, is_ai").in("id", teamIds);
  if (error) throw new Error(`fetchTeamLabels: ${error.message}`);
  for (const t of data || []) labels.set(t.id, { name: t.name, isAi: t.is_ai === true });
  return labels;
}

function printHuman(result, labels, { execute }) {
  const mode = execute ? "EXECUTE" : "DRY-RUN (read-only)";
  const rows = result.candidates;
  console.log(`#5133 akademiryttere uden graduerings-vindue — ${mode} — ${new Date().toISOString()}`);
  console.log(`Saeson: ${result.seasonNumber ?? "ingen aktiv"}  ·  akademiryttere tjekket: ${result.checked}  ·  grace: ${STUCK_GRADUATE_GRACE_HOURS}t`);
  if (result.skipped) {
    console.log(`\nSprunget over: ${result.skipped}.`);
    return;
  }
  if (rows.length === 0) {
    console.log("\nIngen akademiryttere mangler et graduerings-vindue. Intet at goere.");
    return;
  }

  console.log(`\n  ${rows.length} rytter(e) er over gradueringsalderen UDEN nogen academy_graduation-raekke:\n`);
  for (const c of rows) {
    const team = labels.get(c.teamId);
    const teamLabel = team ? `${team.name}${team.isAi ? " (AI-hold)" : " (menneskehold)"}` : "ukendt hold";
    console.log(`  - rytter ${c.riderId}  ${c.name}`);
    console.log(`      hold ${c.teamId} — ${teamLabel}`);
    console.log(`      foedt ${c.birthdate}  ·  saesonalder ${c.age}  (graduerer ved ${GRADUATION.GRADUATE_AGE})`);
    console.log(`      ville oprette: academy_graduation status=pending, season_id=${c.wouldCreate.season_id}, deadline=${c.wouldCreate.deadline}`);
    console.log(`      + notifikation 'academy_graduation_ready' til holdets manager`);
  }
  console.log(
    `\nHandlingen er ADDITIV: der oprettes en pending-raekke + notifikation, praecis som saeson-transitionen ` +
    `ville have gjort. Ingen rytter-felter roeres, og managerens valg (promovér/saelg/slip) staar aabent i ` +
    `${GRADUATION.DEADLINE_DAYS} dage foer det eksisterende sweep tager over med default-kaeden.`
  );
  if (!execute) {
    console.log("\nIngen skrivning foretaget. Koer med --execute naar ejeren har set listen.");
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const JSON_OUT = args.includes("--json");
  const EXECUTE = args.includes("--execute");

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(2);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  try {
    // Kandidatlisten hentes ALTID som dry-run foerst, saa den samme liste kan
    // vises ejeren og skrives ud — ogsaa i --execute.
    const plan = await runMissedGraduateSweep({ supabase, dryRun: true });
    const labels = await fetchTeamLabels(supabase, [...new Set(plan.candidates.map((c) => c.teamId))]);

    if (JSON_OUT && !EXECUTE) {
      console.log(JSON.stringify({ ...plan, teams: Object.fromEntries(labels) }, null, 2));
      process.exit(plan.candidates.length > 0 ? 1 : 0);
    }

    printHuman(plan, labels, { execute: EXECUTE });

    if (!EXECUTE) process.exit(plan.candidates.length > 0 ? 1 : 0);

    const outcome = await runMissedGraduateSweep({ supabase });
    console.log(
      `\n${outcome.created} override-vindue(r) aabnet, ${outcome.duplicates} allerede oprettet af en anden sti, ` +
      `${outcome.failed} fejlede.`
    );
    for (const e of outcome.errors || []) console.log(`   ⏭  rytter ${e.riderId} (hold ${e.teamId}): ${e.message}`);
    console.log("Post-verify: koer scriptet igen med --dry-run — den skal vise 0 kandidater.");
    process.exit(outcome.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error(error?.message || error);
    process.exit(2);
  }
}
