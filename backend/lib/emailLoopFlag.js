// Email retention-loop runtime-flag (#2725). Bor i app_config (key/value) →
// flippes runtime UDEN re-deploy. Fail-safe: fejl/fravær/ukendt værdi → "off"
// (aldrig utilsigtet afsendelse).
//
// Tre-tilstand — IKKE samme semantik som featureStage.js's off/beta/on:
//   off     → cron-sweeps no-op'er helt (ingen query, ingen email_log-row).
//   dry_run → sweeps kører fuldt (dedupe/prefs-tjek uændret), men
//             emailService logger 'dry_run' i email_log i stedet for at
//             kalde Resend — bruges til at verificere targeting før live send.
//   on      → rigtig afsendelse via Resend.
//
// Genbruger readFlagStage (generisk DB-opslag) fra featureStage.js, men IKKE
// evaluateFlagStage (dens boolean on/beta/off-evaluering matcher ikke
// off/dry_run/on-tre-tilstanden her).

import { readFlagStage } from "./featureStage.js";

export const EMAIL_LOOP_FLAG_KEY = "email_loop_enabled";

const VALID_STAGES = new Set(["off", "dry_run", "on"]);

/** @returns {Promise<"off"|"dry_run"|"on">} Altid "off" ved fejl/fravær/ukendt værdi. */
export async function readEmailLoopStage(supabase) {
  const value = await readFlagStage(supabase, EMAIL_LOOP_FLAG_KEY);
  return VALID_STAGES.has(value) ? value : "off";
}

/** True for både "dry_run" og "on" — brug denne til at gate om en sweep overhovedet skal query'e. */
export async function isEmailLoopActive(supabase) {
  return (await readEmailLoopStage(supabase)) !== "off";
}
