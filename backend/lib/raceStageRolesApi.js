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

import { VALID_RACE_ROLES, validEffortsFor } from "./raceRoles.js";
import { loadAbandonedRiderIds } from "./raceIncidents.js";
import { suitabilityScore, stageSuitabilityScores } from "./raceAutopick.js";
import { ABILITY_KEYS } from "./raceSimulator.js";
import { fetchAllRows } from "./supabasePagination.js";

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
 *   baseRoleByRider: Map<string, string|null>,
 *   abandonedRiderIds: Set<string>,
 *   intentionEnabled: boolean,
 * }} args
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateStageRoleOverrides({
  overrides = [],
  raceCompleted = false,
  stageCount = 0,
  stagesCompleted = 0,
  teamRiderIds = new Set(),
  baseRoleByRider = new Map(),
  abandonedRiderIds = new Set(),
  // #4632: race_day_intention_enabled. Default FALSE — en kalder der glemmer at
  // sende flaget får dagens tre-værdi-vokabular, aldrig det udvidede.
  intentionEnabled = false,
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
  // #4538: en udgået/skadet rytter (race_incidents.outcome='abandon' — dækker
  // BÅDE styrt-DNF og skadet-inden-etapestart) kører ikke de resterende etaper.
  // Motoren ekskluderer ham allerede (raceRunner via loadAbandonedRiderIds) —
  // en ny taktik-override for ham ville derfor blive gemt uden nogensinde at
  // blive læst, og fladen ville løbe stille løbet fra virkeligheden.
  for (const o of overrides) {
    if (abandonedRiderIds.has(o?.rider_id)) { errors.push("stage_roles_rider_abandoned"); break; }
  }
  for (const o of overrides) {
    if (!VALID_RACE_ROLES.includes(o?.race_role)) { errors.push("stage_roles_invalid_role"); break; }
  }
  // #4632: femtrins-intentionen bag flag. Off = PRÆCIS dagens tre værdier, så
  // et UI der er deployet før flag-flippet ikke kan gemme 'grupetto'/'all_out'
  // (og motoren derfor aldrig kan møde dem). Samme fejlkode i begge tilstande —
  // fladen skal ikke afsløre at der findes flere trin end den kender.
  const validEfforts = validEffortsFor(intentionEnabled);
  for (const o of overrides) {
    if (!validEfforts.includes(o?.effort)) { errors.push("stage_roles_invalid_effort"); break; }
  }

  // >1 captain, >1 sprint_captain eller >1 hunter pr. etape for holdet — talt
  // på den EFFEKTIVE rolle (override → basis-rolle), ikke på bodyens rækker
  // alene.
  //
  // #4344: bodyen indeholder per kontrakt KUN celler der afviger fra basis-
  // rollen (frontendens diffToOverrides), så en urørt basis-kaptajn er aldrig
  // med i den. En tælling over bodyen alene så derfor præcis 1 kaptajn i det
  // ene tilfælde hvor der reelt var 2: basis-kaptajnen urørt + én forfremmet
  // hjælper. 3+ kaptajner blev afvist korrekt (2+ overrides), 2 slap igennem.
  // Motoren tog så den sidste af de to (raceSimulator.buildTeamContext) og gav
  // beskyttelsen til en rytter spilleren ikke havde valgt.
  //
  // #4746/#2405: `hunter` var udeladt her, selvom holdudtagelsen
  // (`race_entries`) allerede håndhæver den unikt via
  // `uq_race_entries_hunter` (database/2026-06-12-race-entries-roles.sql).
  // Gabet lod 119 af 760 hold-etape-hunter-grupper stå med mere end én hunter
  // samtidig (op til 6), målt 3/9 — se decision-spec §5 (option A) og
  // RACE_ENGINE_RULES.md §7 modsigelse 12. `hunter` er nu med her, og siden
  // #4613 er DENNE guard den ENESTE håndhævelse af reglen: rollen sættes ikke
  // længere pr. etape i UI'et (den gælder hele løbet, ejer 6/9), så frontendens
  // gamle EXCLUSIVE_ROLES/demoteOtherHoldersOfRole er væk sammen med etape-
  // taktik-matrixen. Et gem afvises konsekvent hvis en klient alligevel sender
  // to ledere for samme etape. Ingen DB-constraint tilføjet her — 119 eksisterende
  // grupper ville brække en unique-indeks med det samme, og en oprydning af
  // eksisterende data er ejer-gated (destruktivt), ikke en sidegevinst ved
  // denne visnings-fejl.
  //
  // Kun etaper der optræder i bodyen kan overhovedet få en ny leder: en etape
  // uden overrides falder tilbage til race_entries alene, hvor de partielle
  // unique-indexes (uq_race_entries_captain/_sprint_captain/_hunter) allerede
  // garanterer højst én af hver pr. (løb, hold).
  const stagesInBody = [...new Set(overrides.map((o) => o?.stage_number))];
  const roleOverlap = stagesInBody.some((stageNumber) => {
    const rowsForStage = overrides.filter((o) => o?.stage_number === stageNumber);
    const overriddenRiders = new Set(rowsForStage.map((o) => o?.rider_id));
    return ["captain", "sprint_captain", "hunter"].some((role) => {
      let count = rowsForStage.filter((o) => o?.race_role === role).length;
      // Ryttere UDEN override på etapen beholder deres basis-rolle.
      for (const riderId of teamRiderIds) {
        if (!overriddenRiders.has(riderId) && baseRoleByRider.get(riderId) === role) count += 1;
      }
      return count > 1;
    });
  });
  if (roleOverlap) errors.push("stage_roles_role_overlap");

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

  // #4538: rytterens deltagerstatus (udgået/skadet = 'abandon', samme kilde
  // som raceRunner bruger til at ekskludere ham fra kommende etapers felt).
  // Slås kun op når holdet har ryttere i løbet — spejler riders/overrides-
  // opslagene ovenfor.
  let abandonedRiderIds = new Set();
  if (riderIds.length) {
    abandonedRiderIds = await loadAbandonedRiderIds({ supabase, raceId: race.id });
  }

  // #4613 (holdfanen på løbssiden): fit / form / træthed pr. rytter. PRÆCIS de
  // tre tal holdudtagelses-panelet allerede viser (RaceSelectionPanel via
  // GET /selection → buildRiderRows: `suitability`, `rider_condition.form`,
  // `rider_condition.fatigue`) — samme kilder, samme skala, ingen anden
  // afledning. Uden dem taber Holdfanen sine kolonner i det øjeblik løbet er
  // startet, fordi /selection selv gater på race.status === 'scheduled'.
  //
  // FIT = løbs-snittet (suitabilityScore over løbets etape-profiler), ikke en
  // per-etape-værdi: rollen og udtagelsen gælder HELE løbet, så kolonnen skal
  // sige det samme hele vejen igennem. Ingen profiler / ingen evner → null
  // (degraderer til "—" på fladen, aldrig et opdigtet tal).
  // #4992 (spillerønske egomadsen 7/9): Taktik-fanens rute-match-kolonne skal
  // vise egnetheden mod DEN VALGTE ETAPE, ikke løbets snit — man sætter jo
  // taktik til én dag ad gangen. Tallene beregnes her fordi evnerne og etape-
  // profilerne ALLEREDE hentes til `fit` lige nedenfor: samme kald, samme
  // terrainScore, ét ekstra felt. Ingen ny tabel, intet nyt endpoint, og ingen
  // rå evne-tal på klienten (fog of war) — kun det færdige 0-100-tal.
  let stageFitByRider = new Map();
  let fitByRider = new Map();
  let conditionByRider = new Map();
  if (riderIds.length) {
    const [abilitiesRes, conditionRes, profileRows] = await Promise.all([
      supabase.from("rider_derived_abilities").select(["rider_id", ...ABILITY_KEYS].join(", ")).in("rider_id", riderIds),
      supabase.from("rider_condition").select("rider_id, form, fatigue").in("rider_id", riderIds),
      // #3331: race_stage_profiles er deny-listed, fordi PostgREST TAVST kapper
      // et svar ved 1000 rækker. Et enkelt løb har langt færre etaper end det,
      // men guarden ratcheter på FORMEN og ikke på dagens tal — og et løb er
      // netop den slags "kan ikke blive stort" der har fejlet før. fetchAllRows
      // koster ét kald ekstra i værste fald og fjerner spørgsmålet helt.
      // .catch: samme ærlige degradering som de to andre (fetchAllRows kaster,
      // hvor PostgREST-klienten returnerer {error}).
      fetchAllRows(() => supabase.from("race_stage_profiles")
        .select("stage_number, profile_type, demand_vector")
        .eq("race_id", race.id)
        .order("stage_number", { ascending: true })).catch(() => null),
    ]);
    // Degradér ærligt: en fejl på nogen af de tre må ALDRIG vælte taktik-
    // fladen — den er stadig fuldt brugbar uden kolonnerne.
    const stages = profileRows || [];
    if (!abilitiesRes.error && stages.length) {
      fitByRider = new Map((abilitiesRes.data || []).map((ab) => [ab.rider_id, Math.round(suitabilityScore(ab, stages) * 100)]));
      // Nøglet på stage_number, ikke på arrayets indeks: rækkerne er sorteret
      // efter stage_number, men et løb kan mangle en profil-række, og så ville
      // et indeks-array tavst forskyde alle etaper efter hullet.
      stageFitByRider = new Map((abilitiesRes.data || []).map((ab) => {
        const perStage = stageSuitabilityScores(ab, stages);
        const byStage = {};
        stages.forEach((s, i) => {
          if (s?.stage_number != null && Number.isFinite(perStage[i])) byStage[s.stage_number] = perStage[i];
        });
        return [ab.rider_id, byStage];
      }));
    }
    if (!conditionRes.error) {
      conditionByRider = new Map((conditionRes.data || []).map((c) => [c.rider_id, c]));
    }
  }

  const riders = (entries || []).map((e) => {
    const r = ridersById.get(e.rider_id);
    const cond = conditionByRider.get(e.rider_id);
    return {
      rider_id: e.rider_id,
      name: [r?.firstname, r?.lastname].filter(Boolean).join(" ") || null,
      race_role: e.race_role ?? null,
      abandoned: abandonedRiderIds.has(e.rider_id),
      fit: fitByRider.get(e.rider_id) ?? null,
      // #4992: { [stage_number]: 0-100 }. null når evner eller profiler mangler
      // — fladen viser da "—", aldrig et opdigtet tal.
      stage_fit: stageFitByRider.get(e.rider_id) ?? null,
      form: cond?.form ?? null,
      fatigue: cond?.fatigue ?? null,
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
    // #4344: basis-rollen pr. rytter (race_entries.race_role) — validatoren
    // skal kunne tælle EFFEKTIVE roller, ikke kun bodyens. Samme felt som
    // raceTeamOrdersApi.getTeamOrdersContext returnerer.
    baseRoleByRider: new Map(riders.map((r) => [r.rider_id, r.race_role])),
    // #4538: PUT-validatoren afviser overrides for disse.
    abandonedRiderIds,
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
