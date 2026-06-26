// backend/lib/raceSelection.js
// #1307: manager-udtagelse — ren validering + DB-operationer (kaldes fra api.js).
// Fejl returneres som snake_case-koder (frontend oversætter; mønster fra training-ruterne).

import { selectionSizeForRace, suitabilityScore, stageSuitabilityScores } from "./raceAutopick.js";
import { ABILITY_KEYS } from "./raceSimulator.js";
import { copenhagenDateString } from "./copenhagenTime.js";
import { applyRiderEligibilityFilter } from "./riderEligibility.js";
import { loadLoanedOutRiderIds } from "./raceEntriesLoader.js";

export function validateSelection({
  riderIds = [], captainId = null, sprintCaptainId = null, hunterId = null,
  teamRiderIds, injuredRiderIds, sizeRule, availableCount,
}) {
  const errors = [];
  // Fejlrækkefølge (errors[0] vises til brugeren): duplikat → størrelse → fremmed → skadet → kaptajn → roller.
  // (Overlap-binding håndhæves separat i PUT /selection-handleren og returnerer sin egen 409, ikke en errors[]-kode.)
  const unique = new Set(riderIds);
  if (unique.size !== riderIds.length) errors.push("selection_duplicate_rider");

  // Fuld opstilling KRÆVES (#1906, ejer-beslutning 26/6): man kan ikke gemme en delvis
  // trup — vil/kan man ikke stille fuldt hold til et løb, afmelder man sig i stedet, eller
  // henter fri-agenter. `required` = løbets pladsantal (sizeRule.max == feltstørrelsen for
  // alle rigtige klasser). To distinkte fejl, så UI kan guide forskelligt:
  //   - selection_insufficient_riders: holdet har fysisk for få raske, berettigede ryttere
  //     til en fuld opstilling → vis afmeld + link til fri transfers.
  //   - selection_wrong_size: holdet KAN fylde, men har valgt for få/mange → fyld op.
  const required = sizeRule.max;
  if (Number.isFinite(availableCount) && availableCount < required) {
    errors.push("selection_insufficient_riders");
  } else if (riderIds.length !== required) {
    errors.push("selection_wrong_size");
  }

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
  // Deletes eksisterende entries og indsætter nye. Ingen transaktion:
  // fejler insert → holdet har 0 entries → autopick fylder dem ved
  // simuleringstid (race_entries.is_auto_filled = true). Accepteret degradering.
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

// Ren mapping af evner+kondition+profiler → riderRows (testbar uden DB).
// suitability = løb-snit (0-100); stageSuitability = per-etape (0-100) til S4 rute-match.
// Ingen evner → begge null (graceful degrade på klienten).
export function buildRiderRows({ riders, stages, abilityByRider, conditionByRider, todayStr }) {
  return riders.map((r) => {
    const cond = conditionByRider.get(r.id);
    const ab = abilityByRider.get(r.id);
    const hasFit = ab && stages.length;
    return {
      id: r.id,
      name: [r.firstname, r.lastname].filter(Boolean).join(" "),
      // #1747: ryttertype (top-2) til visning i udtagelses-panelet. null = endnu ikke beregnet.
      primaryType: r.primary_type ?? null,
      secondaryType: r.secondary_type ?? null,
      suitability: hasFit ? Math.round(suitabilityScore(ab, stages) * 100) : null,
      stageSuitability: hasFit ? stageSuitabilityScores(ab, stages) : null,
      // S5: aggression (0-99) — driver udbruds-CHANCEN i motoren (raceSimulator.aggressionScore).
      // Surfaces så HunterExplainer kan rangere jæger-kandidater. null = endnu ikke beregnet.
      aggression: ab?.aggression ?? null,
      form: cond?.form ?? null,
      fatigue: cond?.fatigue ?? null,
      injured: !!(cond?.injured_until && cond.injured_until >= todayStr),
    };
  });
}

// Kontekst til GET-endpointet: holdets ryttere (raske/skadede markeret, suitability
// pr. løbets profiler), nuværende udtagelse, størrelses-regel.
// Holdet har maks ~30 ryttere, så plain .in() er tilstrækkeligt her
// (ingen chunking nødvendig — i modsætning til raceRunner's full-field-opslag).
export async function getSelectionContext({ supabase, race, teamId }) {
  const [ridersRes, profilesRes, entriesRes] = await Promise.all([
    // #1307/#1308: akademiryttere er ikke løbs-berettigede. Rod B: delt eligibility-filter.
    // #1747: ryttertype (primary/secondary) med så fronten kan vise typen ved udtagelsen.
    applyRiderEligibilityFilter(
      supabase.from("riders").select("id, firstname, lastname, primary_type, secondary_type").eq("team_id", teamId)
    ),
    supabase.from("race_stage_profiles").select("stage_number, profile_type, demand_vector")
      .eq("race_id", race.id).order("stage_number", { ascending: true }),
    supabase.from("race_entries").select("rider_id, race_role, is_auto_filled")
      .eq("race_id", race.id).eq("team_id", teamId),
  ]);
  for (const [name, res] of [["riders", ridersRes], ["race_stage_profiles", profilesRes], ["race_entries", entriesRes]]) {
    if (res.error) throw new Error(`${name}: ${res.error.message}`);
  }
  const allRiders = ridersRes.data || [];
  const stages = profilesRes.data || [];
  // Loan-aware (#1906): en udlånt rytter beholder ejer-holdets team_id men kører for
  // låneren — udelad ham fra ejerens valgbare trup, så han hverken vises, tæller i
  // kapacitet eller kan udtages (ellers fantom-rytter + mulig dobbelt-feltning).
  const { data: loanedOut, error: loanErr } = await loadLoanedOutRiderIds({
    supabase, riderIds: allRiders.map((r) => r.id),
  });
  if (loanErr) throw new Error(`loan_agreements: ${loanErr.message}`);
  const riders = allRiders.filter((r) => !loanedOut.has(r.id));
  const riderIds = riders.map((r) => r.id);

  const abilityCols = ["rider_id", ...ABILITY_KEYS].join(", ");
  const [abilitiesRes, conditionRes] = await Promise.all([
    supabase.from("rider_derived_abilities").select(abilityCols).in("rider_id", riderIds),
    supabase.from("rider_condition").select("rider_id, form, fatigue, injured_until").in("rider_id", riderIds),
  ]);
  const abilityByRider = new Map((abilitiesRes.data || []).map((a) => [a.rider_id, a]));
  const conditionByRider = new Map((conditionRes.data || []).map((c) => [c.rider_id, c]));
  const todayStr = copenhagenDateString();

  const riderRows = buildRiderRows({ riders, stages, abilityByRider, conditionByRider, todayStr });

  // Rod B (#1800/#1742): kryds committede entries mod den gyldige roster. En ghost
  // (rytter udtaget FØR han blev solgt/fyret/akademi/pensioneret) er ikke i `riders`
  // (eligibility-filtreret ovenfor) og må hverken vises eller tælle med — ellers
  // renderer den blank i kolonnen (intet ×), tæller i 6/6, og låser redigeringen.
  const eligibleIds = new Set(riderRows.map((r) => r.id));
  const entries = (entriesRes.data || []).filter((e) => eligibleIds.has(e.rider_id));
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
