// backend/lib/raceStageRolesApi.js
// Race Engine v3 (#2224), slice S3 (#2034) — GET/PUT /api/races/:raceId/stage-roles.
// Ren validering + DB-operationer (kaldes fra routes/api.js), mønster fra
// raceSelection.js. Fejl returneres som snake_case-koder (errors[0] til brugeren).
//
// #2034: dette endpoint er BEVIDST tilladt mens løbet er LIVE (status='scheduled',
// stages_completed>0) — taktik-skift undervejs (rolle/effort for KOMMENDE etaper)
// er hele pointen. Det omgår IKKE lineup-frysningen (#1825/selection_race_started):
// frysningen gælder STARTFELTET (race_entries — hvem der overhovedet er udtaget),
// ikke fremtidige etapers roller. Kun løbets FÆRDIGGØRELSE (status='completed')
// lukker for redigering; kørte etapers rækker (stage_number <= stages_completed)
// røres desuden ALDRIG, uanset request-body.

import { VALID_RACE_ROLES, VALID_EFFORTS } from "./raceRoles.js";

/**
 * Ren validering af en PUT-body. Ingen DB. Fejlrækkefølge (errors[0] til brugeren,
 * spejler raceSelection.validateSelection's mønster): løb completed → stage-lås →
 * fremmed rytter → ugyldig rolle → ugyldig effort → rolle-overlap → dublet.
 *
 * @param {{
 *   overrides: Array<{stage_number, rider_id, race_role, effort}>,
 *   raceCompleted: boolean,
 *   stageCount: number,
 *   stagesCompleted: number,
 *   teamRiderIds: Set<string>,
 * }} args
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateStageRoleOverrides({
  overrides = [],
  raceCompleted = false,
  stageCount = 0,
  stagesCompleted = 0,
  teamRiderIds = new Set(),
}) {
  if (raceCompleted) return { ok: false, errors: ["stage_roles_race_completed"] };
  if (!Array.isArray(overrides)) return { ok: false, errors: ["stage_roles_invalid_body"] };

  const errors = [];

  for (const o of overrides) {
    const sn = o?.stage_number;
    if (!Number.isInteger(sn) || sn < 1 || sn > stageCount || sn <= stagesCompleted) {
      errors.push("stage_roles_stage_locked");
      break;
    }
  }
  for (const o of overrides) {
    if (!teamRiderIds.has(o?.rider_id)) { errors.push("stage_roles_rider_not_entered"); break; }
  }
  for (const o of overrides) {
    if (!VALID_RACE_ROLES.includes(o?.race_role)) { errors.push("stage_roles_invalid_role"); break; }
  }
  for (const o of overrides) {
    if (!VALID_EFFORTS.includes(o?.effort)) { errors.push("stage_roles_invalid_effort"); break; }
  }

  // >1 captain eller >1 sprint_captain pr. etape for holdet.
  const countByStageRole = new Map();
  for (const o of overrides) {
    if (o?.race_role !== "captain" && o?.race_role !== "sprint_captain") continue;
    const key = `${o.stage_number}:${o.race_role}`;
    countByStageRole.set(key, (countByStageRole.get(key) || 0) + 1);
  }
  if ([...countByStageRole.values()].some((c) => c > 1)) errors.push("stage_roles_role_overlap");

  // Dublet (stage, rider) i body.
  const keys = overrides.map((o) => `${o?.stage_number}:${o?.rider_id}`);
  if (new Set(keys).size !== keys.length) errors.push("stage_roles_duplicate");

  return { ok: errors.length === 0, errors };
}

/**
 * Kontekst til GET-endpointet + PUT-validering: holdets ryttere i løbets
 * race_entries (navn + basis-race_role) og holdets eksisterende race_stage_roles-
 * overrides for ALLE etaper (også kørte — frontend viser låst historik).
 *
 * @param {{supabase, race: {id, stages, stages_completed}, teamId: string}} args
 */
export async function getStageRolesContext({ supabase, race, teamId }) {
  const { data: entries, error: entriesErr } = await supabase
    .from("race_entries")
    .select("rider_id, race_role")
    .eq("race_id", race.id)
    .eq("team_id", teamId);
  if (entriesErr) throw new Error(`race_entries: ${entriesErr.message}`);

  const riderIds = (entries || []).map((e) => e.rider_id);

  let ridersById = new Map();
  if (riderIds.length) {
    const { data: riderRows, error: riderErr } = await supabase
      .from("riders")
      .select("id, firstname, lastname")
      .in("id", riderIds);
    if (riderErr) throw new Error(`riders: ${riderErr.message}`);
    ridersById = new Map((riderRows || []).map((r) => [r.id, r]));
  }

  const riders = (entries || []).map((e) => {
    const r = ridersById.get(e.rider_id);
    return {
      rider_id: e.rider_id,
      name: [r?.firstname, r?.lastname].filter(Boolean).join(" ") || null,
      race_role: e.race_role ?? null,
    };
  });

  let overrides = [];
  if (riderIds.length) {
    const { data: overrideRows, error: ovErr } = await supabase
      .from("race_stage_roles")
      .select("stage_number, rider_id, race_role, effort")
      .eq("race_id", race.id)
      .in("rider_id", riderIds);
    if (ovErr) throw new Error(`race_stage_roles: ${ovErr.message}`);
    overrides = overrideRows || [];
  }

  return {
    stages_completed: race.stages_completed ?? 0,
    stage_count: race.stages ?? 0,
    riders,
    overrides,
    teamRiderIds: new Set(riderIds),
  };
}

/**
 * REPLACE-semantik for holdets ryttere på REDIGERBARE etaper (stage_number >
 * stagesCompleted). Kørte etapers rækker røres ALDRIG (delete er scopet med
 * .gt("stage_number", stagesCompleted)). Delete-then-insert i ÉN sekvens
 * (samme rækkefølge som race_results' idempotente mønster) — ingen RPC (lav
 * volumen, ejer-hold, ikke kritisk race-window).
 *
 * @param {{supabase, raceId, teamRiderIds: Set<string>, stagesCompleted: number, overrides: Array}} args
 */
export async function saveStageRoleOverrides({ supabase, raceId, teamRiderIds, stagesCompleted, overrides }) {
  const riderIds = [...teamRiderIds];
  if (riderIds.length) {
    const { error: delErr } = await supabase
      .from("race_stage_roles")
      .delete()
      .eq("race_id", raceId)
      .gt("stage_number", stagesCompleted)
      .in("rider_id", riderIds);
    if (delErr) throw new Error(`race_stage_roles delete: ${delErr.message}`);
  }
  if (overrides.length) {
    const now = new Date().toISOString();
    const rows = overrides.map((o) => ({
      race_id: raceId,
      stage_number: o.stage_number,
      rider_id: o.rider_id,
      race_role: o.race_role,
      effort: o.effort,
      updated_at: now,
    }));
    const { error: insErr } = await supabase.from("race_stage_roles").insert(rows);
    if (insErr) throw new Error(`race_stage_roles insert: ${insErr.message}`);
  }
}
