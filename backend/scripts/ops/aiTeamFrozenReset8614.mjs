// #8614 / #8808 (Fable 26/11 fund 6) · Genkoersel af AI-holdenes engangs-nulstilling.
//
// Nulstillingen (skader vaek, fast traethed) koerer af sig selv ved saesonskiftet, naar kontakten
// ai_team_frozen_state_8614 er on (aiTeamFrozenState8614.js). Fejler den, slippes claimen, og
// saesonskiftet fortsaetter (fasen logger fejlen og melder den til Sentry). Denne kommando viser
// status og koerer SAMME idempotente nulstilling igen, uden at vente paa naeste saesonskifte.
// Den bruges ogsaa, hvis kontakten taendes midt i en saeson, og ejeren vil nulstille med det samme.
//
// SIKKERHED
//  - DRY-RUN er default: viser kontakten og claimen, skriver intet.
//  - `--apply --owner-go` koerer nulstillingen. Den goer intet med kontakten slukket, aldrig to gange
//    efter en fuldfoert koersel (claim status "done"), og respekterer en igangvaerende claim.
//  - Output indeholder kun status og et antal ryttere, ingen navne eller id'er.
//
// Brug (fra backend/):
//   infisical run --env=prod -- node scripts/ops/aiTeamFrozenReset8614.mjs                    # status (dry-run)
//   infisical run --env=prod -- node scripts/ops/aiTeamFrozenReset8614.mjs --apply --owner-go  # KUN efter ejerens "koer"

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyAiFrozenStateResetOnce, loadAiFrozenStateResetStatus } from "../../lib/aiTeamFrozenState8614.js";

/**
 * REN orkestrering (klient og ur injiceres), testbar uden createClient.
 * @param {{ supabase: any, now: Date, apply: boolean, log?: (line: string) => void }} args
 */
export async function runAiFrozenResetOps({ supabase, now, apply, log = console.log }) {
  const status = await loadAiFrozenStateResetStatus({ supabase });
  log(`Kontakt ai_team_frozen_state_8614: ${status.switchReadFailed ? "LAESNING FEJLEDE (taeller som off)" : status.switchOn ? "on" : "off"}`);
  log(`Claim: ${status.claim ? `${status.claim.status ?? "ukendt"}${status.claim.done_at ? ` (faerdig ${status.claim.done_at})` : ""}` : "ingen (aldrig fuldfoert, eller sluppet efter en fejl)"}`);
  if (!apply) {
    log("DRY-RUN: intet skrevet. Koer med --apply --owner-go for at nulstille.");
    return { applied: false, status };
  }
  const result = await applyAiFrozenStateResetOnce({ supabase, now });
  log(result.ran ? `Nulstillet: ${result.riders} AI-ryttere.` : `Ikke koert: ${result.reason}.`);
  return { applied: true, status, result };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: join(__dirname, "../../.env"), quiet: true });
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("FEJL: Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  const args = new Set(process.argv.slice(2));
  const apply = args.has("--apply");
  if (apply && !args.has("--owner-go")) {
    console.error("FEJL: --apply kraever --owner-go (ejerens eksplicitte go).");
    process.exit(1);
  }
  runAiFrozenResetOps({ supabase: createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY), now: new Date(), apply })
    .then(() => process.exit(0))
    .catch((err) => { console.error("FEJL:", err.message); process.exit(1); });
}
