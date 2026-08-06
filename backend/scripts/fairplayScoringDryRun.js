#!/usr/bin/env node
// #3138 — dry-run: kør fair-play-scoringen mod de sidste 90 dages FAKTISKE
// handler og print scores UDEN at skrive noget. READ-ONLY — ingen writes,
// ingen mutationer; upsert-stien i runFairplayScoringSweep invokeres aldrig
// (dryRun: true kortslutter FØR enhver write, verificeret i
// fairplayFlagsCron.test.js "dryRun rører aldrig databasen med writes").
//
// Genbruger den ÆGTE sweep-logik 1:1 (samme mønster som
// transferPriceBandDryRun.js), så rapporten aldrig kan drifte fra hvad
// cron'en rent faktisk ville skrive.
//
// Formål (acceptkriteriet i #3138): verificér empirisk at
//   - #2221-parret og evt. #2776-rester scorer HØJT
//   - de 5 kendte lovlige par ligger UNDER tærsklen
// og se hvilke evt. NYE kandidater scoringen finder, før migrationen applies.
//
//   node scripts/fairplayScoringDryRun.js               # fuld rapport
//   node scripts/fairplayScoringDryRun.js --min=0.1     # vis også svage kandidater
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role, read-only forbrug her).

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

import { runFairplayScoringSweep } from "../lib/fairplayFlagsCron.js";
import { FAIRPLAY_DEFAULTS } from "../lib/fairplayScoring.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  return def;
}

const MIN_SCORE = Number(arg("min", "0"));

function pad(value, width) {
  const s = String(value ?? "");
  return s.length >= width ? s.slice(0, width) : s + " ".repeat(width - s.length);
}

async function main() {
  const report = await runFairplayScoringSweep({ supabase, now: new Date(), dryRun: true });

  console.log(`\nDRY-RUN #3138 — fair-play-scoring mod 90 dages faktiske data (READ-ONLY, ingen writes)\n`);
  console.log(
    `Population: ${report.population} rigtige hold · ${report.tradingPairs} handlende par · ` +
      `${report.whitelistedPairsSkipped} whitelistet-skippet · tærskel ${report.threshold ?? FAIRPLAY_DEFAULTS.flagThreshold}` +
      (report.whitelistMissing ? " · ADVARSEL: whitelist-tabellen findes ikke endnu" : "")
  );

  const shown = report.flags.filter((f) => f.score >= MIN_SCORE);
  if (!shown.length) {
    console.log("\nIngen par over tærsklen. (Brug --min=0.1 for at se svage kandidater.)\n");
    return;
  }

  console.log(`\n${pad("Score", 8)}${pad("Type", 18)}${pad("Par", 44)}Signaler`);
  console.log("-".repeat(110));
  for (const f of shown) {
    const parLabel = `${f.evidence.team_lo} ↔ ${f.evidence.team_hi}`;
    const signals = f.signals.map((s) => `${s.name}(${s.contribution})`).join(", ");
    console.log(`${pad(f.score.toFixed(3), 8)}${pad(f.flag_type, 18)}${pad(parLabel, 44)}${signals}`);
  }

  console.log(
    "\nHUSK: base_value/market_value er NUTIDIGE værdier (ingen historisk snapshot), og\n" +
      "level/xp/login_streak er nutidige proxies. #2776-kontiene er slettet (sanktion 22/7)\n" +
      "og KAN ikke optræde i en live kørsel — den sag er verificeret via fixtures i\n" +
      "fairplayScoring.test.js mod backup-tallene (jf. #3135-audittens rekonstruktion).\n"
  );
}

main().catch((err) => {
  console.error("Dry-run fejlede:", err.message);
  process.exit(1);
});
