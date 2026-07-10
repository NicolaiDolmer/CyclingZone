// backend/lib/raceSelection.js
// #1307: manager-udtagelse — ren validering + DB-operationer (kaldes fra api.js).
// Fejl returneres som snake_case-koder (frontend oversætter; mønster fra training-ruterne).

import { selectionSizeForRace, suitabilityScore, stageSuitabilityScores } from "./raceAutopick.js";
import { ABILITY_KEYS } from "./raceSimulator.js";
import { copenhagenDateString } from "./copenhagenTime.js";
import { applyRiderEligibilityFilter } from "./riderEligibility.js";
import { loadLoanedOutRiderIds } from "./raceEntriesLoader.js";
import { assertLineupMutationAllowed } from "./raceActiveGuard.js";

export function validateSelection({
  riderIds = [], captainId = null, sprintCaptainId = null, hunterId = null,
  teamRiderIds, injuredRiderIds, sizeRule,
}) {
  const errors = [];
  // Fejlrækkefølge (errors[0] vises til brugeren): duplikat → størrelse → fremmed → skadet → kaptajn → roller.
  // (Overlap-binding håndhæves separat i PUT /selection-handleren og returnerer sin egen 409, ikke en errors[]-kode.)
  const unique = new Set(riderIds);
  if (unique.size !== riderIds.length) errors.push("selection_duplicate_rider");

  // Delvis trup TILLADT (ejer 28/6, afløser #1906): manageren gemmer sine egne picks frit;
  // er truppen ikke fuld ved race-tid, top-fylder raceEntryGenerator gabet automatisk fra
  // holdets ledige ryttere. Derfor afvises KUN for-mange (over feltstørrelsen) ved gem.
  if (riderIds.length > sizeRule.max) errors.push("selection_wrong_size");

  for (const id of riderIds) {
    if (!teamRiderIds.has(id)) { errors.push("selection_rider_not_on_team"); break; }
  }
  for (const id of riderIds) {
    if (injuredRiderIds.has(id)) { errors.push("selection_rider_injured"); break; }
  }

  // Kaptajn kræves kun når der ER manuelt udtagne ryttere (en tom trup = ren auto-udtagelse).
  // En tom trup må dog ikke bære en forældet kaptajn-reference uden for trupperne (input-hul).
  if (riderIds.length === 0) {
    if (captainId) errors.push("selection_captain_not_selected");
  } else {
    if (!captainId) errors.push("selection_captain_required");
    else if (!unique.has(captainId)) errors.push("selection_captain_not_selected");
  }

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

// Gem udtagelsen atomisk: erstat holdets entries for løbet i ÉN transaktion via
// replace_race_selection-RPC'en (#2173). Enten gemmes hele truppen, eller intet
// ændres — ingen delete-uden-insert-degradering, ingen delvist gemt trup.
export async function saveSelection({ supabase, race, teamId, riderIds, captainId, sprintCaptainId = null, hunterId = null }) {
  // Forward-guard (#2074): nægt delete-then-insert hvis løbets felt er LÅST
  // (stages_completed>0). Rute-laget gater allerede, men guarden gør invarianten lokal
  // til mutationen så en fremtidig kalder ikke kan nulstille et aktivt startfelt.
  await assertLineupMutationAllowed({ supabase, raceId: race?.id, race, label: "saveSelection" });
  // #2173: atomisk erstat via RPC. Tidligere var det en delete-then-insert UDEN
  // transaktion ("accepteret degradering") — fejlede insert efter delete, stod
  // løbet med 0 entries (tavst tab). replace_race_selection kører delete+insert i
  // ÉN transaktion under advisory-lås på holdet, så et gem enten lykkes fuldt
  // eller ruller helt tilbage (og en samtidig PUT til samme hold serialiseres).
  const rows = riderIds.map((rider_id) => ({
    race_id: race.id, rider_id, team_id: teamId,
    race_role: roleFor(rider_id, { captainId, sprintCaptainId, hunterId }),
    is_auto_filled: false,
  }));
  const { error: rpcErr } = await supabase.rpc("replace_race_selection", {
    p_team_id: teamId,
    p_race_id: race.id,
    p_rider_ids: riderIds,
    p_roles: rows.map((r) => r.race_role),
  });
  if (rpcErr) {
    // #2256: RPC'ens binding-guard (overlap-tjek UNDER advisory-låsen) afviser med
    // 'selection_rider_bound'. Markér fejlen med en kode så ruten kan svare 409 med
    // den eksisterende i18n-nøgle i stedet for en opak 500 (TOCTOU-taberen skal se
    // samme besked som pre-flight-tjekket giver).
    const err = new Error(`replace_race_selection: ${rpcErr.message}`);
    if (String(rpcErr.message || "").includes("selection_rider_bound")) err.code = "selection_rider_bound";
    throw err;
  }
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
