// Email retention-loop runtime-flag (#2725, per-type split #2853). Bor i
// app_config (key/value) → flippes runtime UDEN re-deploy. Fail-safe:
// fejl/fravær/ukendt værdi → "off" (aldrig utilsigtet afsendelse).
//
// Tre-tilstand — IKKE samme semantik som featureStage.js's off/beta/on:
//   off     → cron-sweeps no-op'er helt (ingen query, ingen email_log-row).
//   dry_run → sweeps kører fuldt (dedupe/prefs-tjek uændret), men
//             emailService logger 'dry_run' i email_log i stedet for at
//             kalde Resend — bruges til at verificere targeting før live send.
//   on      → rigtig afsendelse via Resend.
//
// #2853: ét flag styrede tidligere ALLE tre sweeps (welcome/day1/race_digest)
// samtidig — umuligt at flippe fx day1 til dry_run uden også at røre
// race_digest. Hver type har nu sin egen app_config-nøgle
// (EMAIL_LOOP_TYPE_KEYS). Bagudkompatibel: mangler en types egen nøgle (row
// fraværende, eller en ukendt værdi), falder den tilbage til den gamle
// EMAIL_LOOP_FLAG_KEY-række — så eksisterende drift/scripts der kun kender
// det gamle flag fortsætter uændret, og en type kan "arve" den fælles
// indstilling indtil dens egen nøgle oprettes.
//
// Genbruger readFlagStage (generisk DB-opslag) fra featureStage.js, men IKKE
// evaluateFlagStage (dens boolean on/beta/off-evaluering matcher ikke
// off/dry_run/on-tre-tilstanden her).

import { readFlagStage } from "./featureStage.js";

export const EMAIL_LOOP_FLAG_KEY = "email_loop_enabled"; // legacy fallback-nøgle

export const EMAIL_LOOP_TYPE_KEYS = Object.freeze({
  welcome: "email_loop_welcome",
  day1: "email_loop_day1",
  race_digest: "email_loop_race_digest",
});

const VALID_STAGES = new Set(["off", "dry_run", "on"]);

/**
 * @param {*} supabase
 * @param {"welcome"|"day1"|"race_digest"} [type] Udelades for den gamle
 *   type-agnostiske læsning (kun EMAIL_LOOP_FLAG_KEY) — bruges af kald der
 *   går forud for per-type-opsplitningen, fx emailRetrySweep.js's
 *   upfront "er noget som helst tændt"-tjek.
 * @returns {Promise<"off"|"dry_run"|"on">} Altid "off" ved fejl/fravær/ukendt
 *   værdi, på hvert niveau af fallback-kæden.
 */
export async function readEmailLoopStage(supabase, type) {
  const typeKey = type ? EMAIL_LOOP_TYPE_KEYS[type] : null;
  if (typeKey) {
    const typedValue = await readFlagStage(supabase, typeKey);
    if (VALID_STAGES.has(typedValue)) return typedValue;
  }
  const legacyValue = await readFlagStage(supabase, EMAIL_LOOP_FLAG_KEY);
  return VALID_STAGES.has(legacyValue) ? legacyValue : "off";
}

/** True for både "dry_run" og "on" — brug denne til at gate om en sweep overhovedet skal query'e. */
export async function isEmailLoopActive(supabase, type) {
  return (await readEmailLoopStage(supabase, type)) !== "off";
}
