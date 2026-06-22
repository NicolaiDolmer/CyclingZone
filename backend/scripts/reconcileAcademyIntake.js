// Engangs-reconcile (#1756): ryd stale academy_intake 'offered'-rækker mod
// rytter-ejerskab.
//
// En stale række er en academy_intake-række der stadig er 'offered', men hvor
// rytteren ALLEREDE er ejet (riders.team_id sat) — flippet blev aldrig fuldført da
// rytteren blev anskaffet. Prod-audit 2026-06-22 fandt 5 sådanne (af 73 'offered').
// PR #1754's RLS-fix skjuler dem fra UI'et, så der er ingen spiller-impact; dette
// er ren data-hygiejne for konsistens i intake-sporet.
//
// Mål-status afgøres af HVEM der ejer rytteren nu (se academyIntakeReconcile.js):
//   • ejet af det tilbudte hold        → 'signed'   (underskrevet, flip fejlede)
//   • ejet af et andet hold            → 'rejected' (afvist → vundet på ungdomsauktion)
//   • rytter stadig fri (team_id NULL) → IKKE stale, røres ikke
//
// Idempotent + sikkert: kun status/resolved_at på academy_intake ændres. Ejerskab,
// balance, finance og auktioner røres ALDRIG (de er allerede korrekte). Et re-run
// finder ingen stale rækker (de er nu signed/rejected) → no-op.
//
//   node scripts/reconcileAcademyIntake.js          # DRY-RUN (default — ingen writes)
//   node scripts/reconcileAcademyIntake.js --live    # APPLY (flip de stale rækker)
//
// KØR ALDRIG --live mod prod uden ejer-godkendelse. Ejeren kører --live selv.
// Anbefalet rutine: kør FØRST uden flag (dry-run) og inspicér plan-listen; bekræft
// at antallet matcher prod-auditten (forventet ~5); kør derefter --live.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runAcademyIntakeReconcile } from "../lib/academyIntakeReconcile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI ───────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith("reconcileAcademyIntake.js")) {
  dotenv.config({ path: join(__dirname, "../.env"), quiet: true });
  const dryRun = !process.argv.includes("--live"); // default: dry-run
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("FEJL: Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  console.log(`=== Academy-intake reconcile ${dryRun ? "(DRY-RUN)" : "(LIVE)"} (#1756) ===`);
  runAcademyIntakeReconcile({ supabase, dryRun })
    .then((r) => {
      console.log("OK:", JSON.stringify({ dryRun: r.dryRun, stale: r.stale, signed: r.signed, rejected: r.rejected, updated: r.updated }));
      process.exit(0);
    })
    .catch((err) => { console.error("FEJL:", err.message); process.exit(1); });
}
