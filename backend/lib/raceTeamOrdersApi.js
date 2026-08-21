// backend/lib/raceTeamOrdersApi.js
// F3 taktik-ordrer v1 (#4030/#3855) — GET/PUT /api/races/:raceId/team-orders.
// race_team_orders er ENESTE sandhed for rolle + effort + udbrud pr.
// (team, race, stage) (ejer-beslutning 21/8; race_stage_roles udfases efter
// v4-flippet). Mønster fra raceStageRolesApi.js: ren validering her, DB-kald
// co-locerede, fejl som snake_case-koder (errors[0] til brugeren).
//
// T2 (taktik-spec): ordrer LÅSES ved etapestart — ikke ved løbsstart. Låsen
// afgøres af race_stage_schedule.scheduled_at (etapens faktiske starttidspunkt);
// kørte etaper (stage_number <= stages_completed) er altid låst. locked_at-
// SNAPSHOTTET i tabellen sættes af F3/raceRunner ved etapestart — API'et her
// afviser blot writes efter lock, det stempler aldrig selv.
// T4: ingen række = neutrale defaults (roller fra lineup, effort normal,
// stance neutral, intet break-flag). Passivitet straffes aldrig.

import { VALID_RACE_ROLES, VALID_EFFORTS } from "./raceRoles.js";

export const VALID_BREAKAWAY_STANCES = ["chase", "neutral", "let_go"];

/**
 * T4-defaulten: den ordre motoren skal se når holdet intet har gemt.
 * Ren konstant-fabrik (nyt objekt pr. kald — kalderen må mutere frit).
 */
export function neutralTeamOrder() {
  return { breakaway_stance: "neutral", riders: [] };
}

/**
 * T2: er en etape låst for ordre-writes? Ren. Låst når etapen er kørt
 * (stagesCompleted) ELLER dens planlagte start er passeret. Mangler
 * scheduled_at (defensivt: schedule-hul) behandles etapen som ÅBEN indtil
 * stages_completed siger andet — en manglende række må aldrig fastlåse
 * taktikken for et helt løb.
 *
 * @param {{stageNumber: number, stagesCompleted: number, scheduledAt: string|null|undefined, now?: Date}} args
 */
export function isStageLocked({ stageNumber, stagesCompleted = 0, scheduledAt, now = new Date() }) {
  if (stageNumber <= stagesCompleted) return true;
  if (!scheduledAt) return false;
  const startMs = Date.parse(scheduledAt);
  return Number.isFinite(startMs) && now.getTime() >= startMs;
}

/**
 * Ren validering af én PUT-body (ordren for ÉN etape). Fejlrækkefølge
 * (errors[0] vises til brugeren): løb completed → etape-lås → ugyldig body →
 * ugyldig stance → fremmed rytter → ugyldig rolle → ugyldig effort →
 * rolle-overlap → dublet-rytter.
 *
 * @param {{
 *   order: {breakaway_stance?: string, riders?: Array<{rider_id, race_role, effort, try_break}>},
 *   raceCompleted: boolean,
 *   stageNumber: number,
 *   stageCount: number,
 *   stagesCompleted: number,
 *   scheduledAt: string|null,
 *   teamRiderIds: Set<string>,
 *   now?: Date,
 * }} args
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateTeamOrder({
  order,
  raceCompleted = false,
  stageNumber,
  stageCount = 0,
  stagesCompleted = 0,
  scheduledAt = null,
  teamRiderIds = new Set(),
  now = new Date(),
}) {
  if (raceCompleted) return { ok: false, errors: ["team_orders_race_completed"] };
  if (!Number.isInteger(stageNumber) || stageNumber < 1 || stageNumber > stageCount) {
    return { ok: false, errors: ["team_orders_invalid_stage"] };
  }
  if (isStageLocked({ stageNumber, stagesCompleted, scheduledAt, now })) {
    return { ok: false, errors: ["team_orders_stage_locked"] };
  }
  if (!order || typeof order !== "object" || Array.isArray(order)) {
    return { ok: false, errors: ["team_orders_invalid_body"] };
  }
  const riders = order.riders ?? [];
  if (!Array.isArray(riders)) return { ok: false, errors: ["team_orders_invalid_body"] };

  const errors = [];
  const stance = order.breakaway_stance ?? "neutral";
  if (!VALID_BREAKAWAY_STANCES.includes(stance)) errors.push("team_orders_invalid_stance");

  for (const r of riders) {
    if (!teamRiderIds.has(r?.rider_id)) { errors.push("team_orders_rider_not_entered"); break; }
  }
  for (const r of riders) {
    if (!VALID_RACE_ROLES.includes(r?.race_role)) { errors.push("team_orders_invalid_role"); break; }
  }
  for (const r of riders) {
    if (!VALID_EFFORTS.includes(r?.effort)) { errors.push("team_orders_invalid_effort"); break; }
  }

  // Højst én captain og én sprint_captain pr. etape (samme regel som
  // stage-roles/selection — backend er sidste vagt, uanset UI).
  for (const role of ["captain", "sprint_captain"]) {
    if (riders.filter((r) => r?.race_role === role).length > 1) {
      errors.push("team_orders_role_overlap");
      break;
    }
  }

  const ids = riders.map((r) => r?.rider_id);
  if (new Set(ids).size !== ids.length) errors.push("team_orders_duplicate_rider");

  return { ok: errors.length === 0, errors };
}

/**
 * Normalisér en valideret body til DB-rækkens form: stance-default + kun de
 * fire kontraktfelter pr. rytter, try_break tvunget til boolean. Ren.
 */
export function normalizeTeamOrder(order) {
  return {
    breakaway_stance: order.breakaway_stance ?? "neutral",
    riders: (order.riders ?? []).map((r) => ({
      rider_id: r.rider_id,
      race_role: r.race_role,
      effort: r.effort,
      try_break: r.try_break === true,
    })),
  };
}

/**
 * Kontekst til GET + PUT-validering: holdets udtagne ryttere (race_entries),
 * holdets eksisterende ordrer for ALLE etaper (låst historik vises i UI) og
 * etapernes starttidspunkter (T2-låsen + "Locks Tue 11:00"-metaen i kortet).
 *
 * @param {{supabase, race: {id, stages, stages_completed, status}, teamId: string}} args
 */
export async function getTeamOrdersContext({ supabase, race, teamId }) {
  const [entriesRes, ordersRes, schedRes] = await Promise.all([
    supabase
      .from("race_entries")
      .select("rider_id, race_role")
      .eq("race_id", race.id)
      .eq("team_id", teamId), // pagination-safe: eet holds entries i EET loeb — maks feltstoerrelsen (6-8 raekker)
    supabase
      .from("race_team_orders")
      .select("stage_number, breakaway_stance, riders, locked_at, updated_at")
      .eq("race_id", race.id)
      .eq("team_id", teamId), // pagination-safe: PK-scopet (team, race) — maks 1 raekke pr. etape (<=21)
    supabase
      .from("race_stage_schedule")
      .select("stage_number, scheduled_at")
      .eq("race_id", race.id), // pagination-safe: eet loebs etaper — maks 21 raekker (GT)
  ]);
  if (entriesRes.error) throw new Error(`race_entries: ${entriesRes.error.message}`);
  if (ordersRes.error) throw new Error(`race_team_orders: ${ordersRes.error.message}`);
  if (schedRes.error) throw new Error(`race_stage_schedule: ${schedRes.error.message}`);

  const entries = entriesRes.data || [];
  const scheduleByStage = new Map((schedRes.data || []).map((s) => [s.stage_number, s.scheduled_at]));

  return {
    stage_count: race.stages ?? 0,
    stages_completed: race.stages_completed ?? 0,
    race_completed: race.status === "completed",
    teamRiderIds: new Set(entries.map((e) => e.rider_id)),
    baseRoleByRider: new Map(entries.map((e) => [e.rider_id, e.race_role ?? null])),
    orders: ordersRes.data || [],
    scheduleByStage,
  };
}

/**
 * Gem én etapes ordre (upsert på PK (team, race, stage)). REPLACE-semantik for
 * rækken — riders-arrayet erstattes helt (én række ER hele etapens taktik).
 * Låste rækker afvises af validateTeamOrder FØR dette kald.
 */
export async function saveTeamOrder({ supabase, teamId, raceId, stageNumber, order }) {
  const normalized = normalizeTeamOrder(order);
  const { error } = await supabase.from("race_team_orders").upsert(
    {
      team_id: teamId,
      race_id: raceId,
      stage_number: stageNumber,
      breakaway_stance: normalized.breakaway_stance,
      riders: normalized.riders,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "team_id,race_id,stage_number" },
  );
  if (error) throw new Error(`race_team_orders upsert: ${error.message}`);
  return normalized;
}
