// backend/lib/raceSelection.js
// #1307: manager-udtagelse — ren validering + DB-operationer (kaldes fra api.js).
// Fejl returneres som snake_case-koder (frontend oversætter; mønster fra training-ruterne).

import { selectionSizeForRace, suitabilityScore } from "./raceAutopick.js";
import { ABILITY_KEYS } from "./raceSimulator.js";
import { copenhagenDateString } from "./copenhagenTime.js";

export function validateSelection({
  riderIds = [], captainId = null, sprintCaptainId = null, hunterId = null,
  teamRiderIds, injuredRiderIds, sizeRule, availableCount,
}) {
  const errors = [];
  const unique = new Set(riderIds);
  if (unique.size !== riderIds.length) errors.push("selection_duplicate_rider");

  // Lille-trup-lempelse: min sænkes til antal tilgængelige (autopick-paritet).
  const effectiveMin = Math.min(sizeRule.min, Number.isFinite(availableCount) ? availableCount : sizeRule.min);
  if (riderIds.length < effectiveMin || riderIds.length > sizeRule.max) errors.push("selection_wrong_size");

  for (const id of riderIds) {
    if (!teamRiderIds.has(id)) { errors.push("selection_rider_not_on_team"); break; }
  }
  for (const id of riderIds) {
    if (injuredRiderIds.has(id)) { errors.push("selection_rider_injured"); break; }
  }

  if (!captainId) errors.push("selection_captain_required");
  else if (!unique.has(captainId)) errors.push("selection_captain_not_selected");

  for (const roleId of [sprintCaptainId, hunterId]) {
    if (roleId && !unique.has(roleId)) errors.push("selection_role_not_selected");
  }
  const roleIds = [captainId, sprintCaptainId, hunterId].filter(Boolean);
  if (new Set(roleIds).size !== roleIds.length) errors.push("selection_role_overlap");

  return { ok: errors.length === 0, errors };
}

function roleFor(riderId, { captainId, sprintCaptainId, hunterId }) {
  if (riderId === captainId) return "captain";
  if (riderId === sprintCaptainId) return "sprint_captain";
  if (riderId === hunterId) return "hunter";
  return "helper";
}

// Gem udtagelsen: slet holdets eksisterende entries for løbet, indsæt de nye.
// PK (race_id, rider_id) gør gen-kørsel ufarlig (delete-then-insert).
export async function saveSelection({ supabase, race, teamId, riderIds, captainId, sprintCaptainId = null, hunterId = null }) {
  const { error: delErr } = await supabase
    .from("race_entries").delete().eq("race_id", race.id).eq("team_id", teamId);
  if (delErr) throw new Error(`race_entries delete: ${delErr.message}`);

  const rows = riderIds.map((rider_id) => ({
    race_id: race.id, rider_id, team_id: teamId,
    race_role: roleFor(rider_id, { captainId, sprintCaptainId, hunterId }),
    is_auto_filled: false,
  }));
  const { error: insErr } = await supabase.from("race_entries").insert(rows);
  if (insErr) throw new Error(`race_entries insert: ${insErr.message}`);
  return rows;
}

// Kontekst til GET-endpointet: holdets ryttere (raske/skadede markeret, suitability
// pr. løbets profiler), nuværende udtagelse, størrelses-regel.
// Holdet har maks ~30 ryttere, så plain .in() er tilstrækkeligt her
// (ingen chunking nødvendig — i modsætning til raceRunner's full-field-opslag).
export async function getSelectionContext({ supabase, race, teamId }) {
  const [ridersRes, profilesRes, entriesRes] = await Promise.all([
    supabase.from("riders").select("id, firstname, lastname")
      .eq("team_id", teamId).or("is_retired.is.null,is_retired.eq.false"),
    supabase.from("race_stage_profiles").select("stage_number, profile_type, demand_vector")
      .eq("race_id", race.id).order("stage_number", { ascending: true }),
    supabase.from("race_entries").select("rider_id, race_role, is_auto_filled")
      .eq("race_id", race.id).eq("team_id", teamId),
  ]);
  for (const [name, res] of [["riders", ridersRes], ["race_stage_profiles", profilesRes], ["race_entries", entriesRes]]) {
    if (res.error) throw new Error(`${name}: ${res.error.message}`);
  }
  const riders = ridersRes.data || [];
  const stages = profilesRes.data || [];
  const riderIds = riders.map((r) => r.id);

  const abilityCols = ["rider_id", ...ABILITY_KEYS].join(", ");
  const [abilitiesRes, conditionRes] = await Promise.all([
    supabase.from("rider_derived_abilities").select(abilityCols).in("rider_id", riderIds),
    supabase.from("rider_condition").select("rider_id, form, fatigue, injured_until").in("rider_id", riderIds),
  ]);
  const abilityByRider = new Map((abilitiesRes.data || []).map((a) => [a.rider_id, a]));
  const conditionByRider = new Map((conditionRes.data || []).map((c) => [c.rider_id, c]));
  const todayStr = copenhagenDateString();

  const riderRows = riders.map((r) => {
    const cond = conditionByRider.get(r.id);
    const ab = abilityByRider.get(r.id);
    return {
      id: r.id,
      name: [r.firstname, r.lastname].filter(Boolean).join(" "),
      suitability: ab ? Math.round(suitabilityScore(ab, stages) * 100) : null,
      form: cond?.form ?? null,
      fatigue: cond?.fatigue ?? null,
      injured: !!(cond?.injured_until && cond.injured_until >= todayStr),
    };
  });

  const entries = entriesRes.data || [];
  const selection = entries.length
    ? {
        rider_ids: entries.map((e) => e.rider_id),
        captain_id: entries.find((e) => e.race_role === "captain")?.rider_id ?? null,
        sprint_captain_id: entries.find((e) => e.race_role === "sprint_captain")?.rider_id ?? null,
        hunter_id: entries.find((e) => e.race_role === "hunter")?.rider_id ?? null,
        is_auto_filled: entries.every((e) => e.is_auto_filled),
      }
    : null;

  return {
    size: selectionSizeForRace(race),
    riders: riderRows,
    selection,
    availableCount: riderRows.filter((r) => !r.injured).length,
  };
}
