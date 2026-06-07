// Passiv udviklings-motor (#1137) — DB-orchestrator for season-transition.
//
// Kører ÉN gang pr. (rytter, sæson) i processSeasonStart, EFTER payroll. Muterer
// rider_derived_abilities (current ability) mod et uforanderligt loft, re-beregner
// base_value, ældes ryttere (is_u25), og pensionerer semi-auto med notifikation.
//
// Idempotent: rider_development_log(rider_id, season_id) er UNIQUE og fungerer som
// både guard (skip allerede-udviklede) OG #918-snapshot. Re-run efter delvis fejl
// er sikker. Deterministisk: al variation seedes pr. (rider_id, sæson) i
// riderProgression.js, så samme transition kørt 2× giver samme resultat.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "./supabasePagination.js";
import { predictBaseValue } from "./riderValuation.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { developRiderSeason, buildCaps } from "./riderProgression.js";
import { notifyTeamOwner } from "./notificationService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Sæson 1 = launch-året (2026). Alder er SÆSON-drevet (ikke real-world-tid), så
// ryttere ældes troværdigt over sæsoner. ageForSeason(birthdate, N) = år N − fødselsår.
export const LAUNCH_REFERENCE_YEAR = 2026;

export function ageForSeason(birthdate, seasonNumber) {
  if (!birthdate || !Number.isFinite(seasonNumber)) return null;
  const birthYear = new Date(birthdate).getFullYear();
  if (!Number.isFinite(birthYear)) return null;
  return LAUNCH_REFERENCE_YEAR + (seasonNumber - 1) - birthYear;
}

let cachedModel = null;
function defaultModel() {
  if (!cachedModel) {
    cachedModel = JSON.parse(readFileSync(join(__dirname, "riderValuationModel.json"), "utf8"));
  }
  return cachedModel;
}

async function runBatched(items, concurrency, fn) {
  for (let i = 0; i < items.length; i += concurrency) {
    await Promise.all(items.slice(i, i + concurrency).map(fn));
  }
}

/**
 * Udvikl alle aktive ryttere én sæson frem. Idempotent + deterministisk.
 *
 * @param {object}  args
 * @param {object}  args.supabase       — service-role client
 * @param {string}  args.seasonId       — UUID på den NYE sæson (udviklingen hører til)
 * @param {number}  args.seasonNumber   — sæson-nummer (alder + seed)
 * @param {object}  [args.model]        — base_value-model (default: riderValuationModel.json)
 * @param {boolean} [args.notify=true]  — send retirement-notifikationer
 * @param {Date}    [args.now]          — til notifikations-dedup (default new Date())
 * @returns {Promise<object>} summary
 */
export async function developRidersForSeason({
  supabase, seasonId, seasonNumber, model = defaultModel(), notify = true, now = new Date(),
  notifyTeamOwnerFn = notifyTeamOwner,
}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!seasonId) throw new Error("seasonId required");

  // ── Idempotens: hvilke ryttere er allerede udviklet for denne sæson? ──────────
  const alreadyRows = await fetchAllRows(() =>
    supabase.from("rider_development_log").select("rider_id").eq("season_id", seasonId));
  const alreadyDeveloped = new Set(alreadyRows.map((r) => r.rider_id));

  // ── Load aktive ryttere + abilities (+ loft) ──────────────────────────────────
  const [riders, abilityRows] = await Promise.all([
    fetchAllRows(() => supabase
      .from("riders")
      .select("id, primary_type, potentiale, birthdate, base_value, is_u25, is_retired, team_id, firstname, lastname")
      .eq("is_retired", false)
      .order("id")),
    fetchAllRows(() => supabase.from("rider_derived_abilities").select("*").order("rider_id")),
  ]);
  const abilityByRider = new Map(abilityRows.map((a) => [a.rider_id, a]));

  const abilityUpdates = [];  // { id, patch } → rider_derived_abilities
  const riderUpdates = [];    // { id, patch } → riders
  const logRows = [];         // rider_development_log
  const notifications = [];   // { teamId, riderId, name }
  const summary = {
    season_id: seasonId, season_number: seasonNumber,
    candidates: 0, skipped_already_done: 0, developed: 0,
    grew: 0, declined: 0, retired: 0, caps_initialised: 0,
  };

  for (const r of riders) {
    if (alreadyDeveloped.has(r.id)) { summary.skipped_already_done++; continue; }
    if (!r.primary_type || r.potentiale == null) continue;
    const age = ageForSeason(r.birthdate, seasonNumber);
    if (age == null) continue;
    const abRow = abilityByRider.get(r.id);
    if (!abRow) continue;

    summary.candidates++;

    const abilities = {};
    for (const k of VISIBLE_ABILITIES) if (abRow[k] != null) abilities[k] = Number(abRow[k]);

    // Lazy-init af loftet fra baseline (første gang rytteren udvikles).
    let caps = abRow.ability_caps;
    const capsWasNull = !caps || typeof caps !== "object";
    if (capsWasNull) {
      caps = buildCaps(abilities, r.primary_type, r.potentiale);
      summary.caps_initialised++;
    }

    const { next, retirement } = developRiderSeason(
      { id: r.id, primary_type: r.primary_type, potentiale: r.potentiale, age },
      abilities, caps, seasonNumber
    );

    // Vækst/fald-tælling (signaturen er den højeste evne-bevægelse).
    const before = abilitySum(abilities);
    const after = abilitySum(next);
    if (after > before) summary.grew++; else if (after < before) summary.declined++;

    const newBaseValue = predictBaseValue({ primary_type: r.primary_type }, next, model);

    const abilityPatch = { ...next };
    if (capsWasNull) abilityPatch.ability_caps = caps;
    abilityUpdates.push({ id: r.id, patch: abilityPatch });

    const riderPatch = { is_u25: age < 25 };
    if (newBaseValue != null) riderPatch.base_value = newBaseValue;
    if (retirement.retire) { riderPatch.is_retired = true; summary.retired++; }
    riderUpdates.push({ id: r.id, patch: riderPatch });

    logRows.push({
      rider_id: r.id, season_id: seasonId, season_number: seasonNumber ?? null,
      age, abilities: next, base_value: newBaseValue ?? null,
      retired_this_season: retirement.retire,
    });

    if (retirement.retire && r.team_id) {
      notifications.push({ teamId: r.team_id, riderId: r.id, name: `${r.firstname} ${r.lastname}`.trim(), age });
    }
    summary.developed++;
  }

  // ── Skriv (idempotent): log-rows upsertes med onConflict-ignore som backup-guard ─
  if (logRows.length) {
    for (let i = 0; i < logRows.length; i += 500) {
      const { error } = await supabase
        .from("rider_development_log")
        .upsert(logRows.slice(i, i + 500), { onConflict: "rider_id,season_id", ignoreDuplicates: true });
      if (error) throw new Error(`dev-log upsert: ${error.message}`);
    }
  }
  await runBatched(abilityUpdates, 25, ({ id, patch }) =>
    supabase.from("rider_derived_abilities").update(patch).eq("rider_id", id).then(({ error }) => {
      if (error) throw new Error(`abilities update ${id}: ${error.message}`);
    }));
  await runBatched(riderUpdates, 25, ({ id, patch }) =>
    supabase.from("riders").update(patch).eq("id", id).then(({ error }) => {
      if (error) throw new Error(`riders update ${id}: ${error.message}`);
    }));

  // ── Retirement-notifikationer (fire-and-forget pr. ejer) ──────────────────────
  if (notify && notifications.length) {
    await runBatched(notifications, 10, ({ teamId, riderId, name, age }) =>
      notifyTeamOwnerFn({
        supabase, teamId, type: "rider_retired", relatedId: riderId, now,
        title: `${name} has retired`,
        message: `${name} has retired from professional cycling at age ${age}.`,
        metadata: {
          titleCode: "notification.rider_retired.title",
          titleParams: { name },
          messageCode: "notification.rider_retired.message",
          messageParams: { name, age },
        },
      }).catch(() => { /* notifikation må aldrig vælte transitionen */ }));
  }

  return summary;
}

function abilitySum(abilities) {
  let s = 0;
  for (const k of VISIBLE_ABILITIES) if (abilities[k] != null) s += Number(abilities[k]);
  return s;
}
