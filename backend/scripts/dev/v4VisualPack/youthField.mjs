// backend/scripts/dev/v4VisualPack/youthField.mjs
// #5804: "en ungdomsetape hvis muligt". Ungdomspuljerne (league_divisions.squad
// u23/junior) findes ikke i prod endnu, saa der er ingen ungdomskalender at laese.
// Det der FINDES er ungdomsrytterne (riders.squad). Denne fil bygger derfor et
// U23-startfelt af de rigtige U23-ryttere fra prod — hvert hold med sine egne,
// udtaget af assistentens autopick til den givne etape — saa v4 kan ses paa et
// ungdomsfelt. Etapen laanes fra S4-planen og vises tydeligt som syntetisk.
//
// Kun SELECT.

import { applyRiderEligibilityFilter } from "../../../lib/riderEligibility.js";
import { ABILITY_KEYS } from "../../../lib/raceSimulator.js";
import { autopickTeamSelection } from "../../../lib/raceAutopick.js";

const CHUNK = 200;

async function selectIn({ supabase, table, columns, column, ids }) {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase.from(table).select(columns).in(column, ids.slice(i, i + CHUNK));
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
  }
  return out;
}

/**
 * @returns {Promise<Array<object>>} entrants i loadEntrantsForRace-form
 */
export async function loadYouthEntrants({ supabase, squad = "u23", stages, maxPerTeam = 6, minPerTeam = 3, maxRiders = 180 }) {
  const { data: riders, error } = await applyRiderEligibilityFilter(
    supabase.from("riders").select("id, team_id, firstname, lastname").not("team_id", "is", null),
    { squad },
  ).order("id");
  if (error) throw new Error(`riders (${squad}): ${error.message}`);
  const ids = (riders ?? []).map((r) => r.id);
  if (!ids.length) return [];
  const abilities = await selectIn({ supabase, table: "rider_derived_abilities", columns: ["rider_id", ...ABILITY_KEYS].join(", "), column: "rider_id", ids });
  const conditions = await selectIn({ supabase, table: "rider_condition", columns: "rider_id, form, fatigue", column: "rider_id", ids });
  const teamIds = [...new Set((riders ?? []).map((r) => r.team_id))];
  const teams = await selectIn({ supabase, table: "teams", columns: "id, name, is_ai", column: "id", ids: teamIds });
  const abBy = new Map(abilities.map((a) => [a.rider_id, a]));
  const condBy = new Map(conditions.map((c) => [c.rider_id, c]));
  const teamBy = new Map(teams.map((t) => [t.id, t]));

  const byTeam = new Map();
  for (const r of riders ?? []) {
    if (!abBy.has(r.id)) continue;
    if (!byTeam.has(r.team_id)) byTeam.set(r.team_id, []);
    byTeam.get(r.team_id).push(r);
  }
  const entrants = [];
  for (const [teamId, list] of [...byTeam.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)))) {
    if (list.length < minPerTeam) continue;
    if (entrants.length + Math.min(list.length, maxPerTeam) > maxRiders) break;
    const picks = autopickTeamSelection({
      riders: list.map((r) => ({ rider_id: r.id, abilities: abBy.get(r.id), fatigue: condBy.get(r.id)?.fatigue })),
      stages,
      sizeRule: { min: minPerTeam, max: maxPerTeam },
    });
    for (const p of picks) {
      const r = list.find((x) => x.id === p.rider_id);
      const cond = condBy.get(p.rider_id);
      const team = teamBy.get(teamId);
      entrants.push({
        rider_id: p.rider_id,
        team_id: teamId,
        team_name: team?.name ?? null,
        rider_name: [r?.firstname, r?.lastname].filter(Boolean).join(" ") || null,
        is_u25: true,
        abilities: abBy.get(p.rider_id),
        race_role: p.race_role,
        ...(team?.is_ai === true ? { team_is_ai: true } : {}),
        ...(cond ? { form: cond.form, fatigue: cond.fatigue } : {}),
      });
    }
  }
  return entrants;
}
