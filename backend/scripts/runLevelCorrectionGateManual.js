// #3750 · MANUEL kørsel af niveau-korrektionens gate-måling (ikke-søndag).
//
// Ejer-direktiv 21/8: overgangen til det nye værdisystem fremrykkes, så
// gate-målingen skal kunne køres udenfor søndags-cron'en. Scriptet kalder
// PRÆCIS samme sweep som cron.js (samme filtre, samme evaluering, samme
// gate-log-skrivning) — kun søndags-checket er slået fra via `manual: true`.
//
// Kør fra backend/ (dotenv/config forventer backend/.env i cwd):
//
//   node scripts/runLevelCorrectionGateManual.js
//
// Sikkerhed:
//   - Skriver KUN til market_value_level_correction_gate_log (måling + status).
//     Rører ALDRIG riders.* — selve korrektionen er stadig den ejer-gatede
//     engangs-kørsel i marketValueLevelCorrectionApply.js.
//   - Claim-dedup pr. dato: er dagens dato allerede målt (manuelt eller af
//     cron), er kørslen en no-op ("already_measured_today").

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

import { runMarketValueLevelCorrectionGateSweep } from "../lib/marketValueLevelCorrectionGate.js";

async function main() {
  console.log("=== MANUEL gate-måling · niveau-korrektionen (#3449/#3750) ===");

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Mangler SUPABASE_URL/SUPABASE_SERVICE_KEY i backend/.env");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  const result = await runMarketValueLevelCorrectionGateSweep({
    supabase,
    now: new Date(),
    manual: true,
    log: console.log,
  });

  if (!result.ran) {
    console.log(`Ikke kørt: ${result.skipped}`);
    if (result.skipped === "already_measured_today") {
      console.log("Dagens dato er allerede målt — se seneste række i market_value_level_correction_gate_log.");
    }
    return;
  }

  console.log(`\nMåledato: ${result.measuredDate} (manuel kørsel)`);
  console.log(`Gate: ${result.status.toUpperCase()} (${result.reason})`);
  console.log(result.reasonText);
  console.log(`n90 = ${result.n90} (krav ≥ ${result.minQualifiedTrades})`);
  console.log(`median90 = ${result.median90?.toFixed(3) ?? "n/a"}`);
  console.log("Rullende 30-dages-medianer (ældst → nyest):");
  for (const p of result.rollingMedians) {
    console.log(`  ${p.window_end}: n=${p.n}, median=${p.median?.toFixed(3) ?? "n/a"}`);
  }
  console.log(`c-kandidat: ${result.cCandidate?.toFixed(3) ?? "ingen (gate ikke grøn)"}`);
}

main().catch((e) => {
  console.error("FEJL:", e);
  process.exit(1);
});
