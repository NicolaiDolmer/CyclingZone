// Race v3 (#2351) — provably-fair seed-salt på resultat-seeds.
//
// Spec: docs/superpowers/specs/2026-07-11-race-engine-depth-credibility-design.md §10.
// Race-motorens resultat-seed er i dag `${race.id}:${stageNumber}` — deterministisk,
// men også teoretisk pre-computable fra offentlige data (race.id + etapenummer er
// begge kendte). Dette modul blander en server-side hemmelighed ind i seed-inputtet,
// så udfaldet ikke kan udledes uden at kende salten.
//
// Salten bor UDELUKKENDE i Railway/Infisical-env (RACE_ENGINE_SEED_SALT) — den må
// ALDRIG logges, persisteres i DB eller sendes til klienten. Kun en sha256-hash af
// salten (saltCommitHash) er beregnet til at forlade processen, til brug i en senere
// commit-reveal-publicering (S6): hashen publiceres FØR sæsonen, selve salten
// reveales først ved sæsonslut, så spillere kan verificere at den ikke blev ændret
// undervejs.
//
// Env læses ved KALD-tid (ikke ved module-load), så tests kan sætte/rydde env uden
// at genindlæse modulet. Parcours-seeds (raceStageProfileGenerator.js har sin egen
// lokale stableSeed) saltes IKKE — etapeprofiler skal forblive offentlige/forudsigelige.
//
// Salt er inaktiv (legacy-adfærd, uændret seed-input) indtil ejeren sætter
// RACE_ENGINE_SEED_SALT i Railway — planlagt til natten mellem to løbsdage, ALDRIG
// midt i en aktiv etape (ejer-beslutning 11/7).

import { createHash } from "node:crypto";

function rawSalt() {
  const v = process.env.RACE_ENGINE_SEED_SALT;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** true når en salt-værdi er sat i env (ikke tom/unset). */
function isSaltActive() {
  return rawSalt() !== null;
}

/**
 * Resultat-seed-input for en etape. Uændret legacy-input (`${raceId}:${stageNumber}`)
 * når salt er inaktiv — eksisterende persisterede seeds forbliver reproducerbare.
 * Med aktiv salt: `${salt}:${raceId}:${stageNumber}`.
 */
export function raceSeedInput(raceId, stageNumber) {
  const salt = rawSalt();
  if (salt == null) return `${raceId}:${stageNumber}`;
  return `${salt}:${raceId}:${stageNumber}`;
}

/**
 * Aktiv salt-version (positivt heltal), eller null når salt er inaktiv.
 * RACE_ENGINE_SEED_SALT_VERSION default 1 når salt er sat; ugyldig værdi → 1.
 */
export function activeSaltVersion() {
  if (!isSaltActive()) return null;
  const raw = process.env.RACE_ENGINE_SEED_SALT_VERSION;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/**
 * sha256-hex af den aktive salt, eller null når salt er inaktiv. Bruges til
 * commit-reveal-publicering (S6): hashen publiceres offentligt FØR sæsonen; selve
 * salten reveales (og kan verificeres mod denne hash) ved sæsonslut.
 */
export function saltCommitHash() {
  const salt = rawSalt();
  if (salt == null) return null;
  return createHash("sha256").update(salt).digest("hex");
}
