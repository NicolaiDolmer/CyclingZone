// backend/lib/academyIntake2View.js
// #6666 Optag 2.0: GET /api/academy/me's ekstra lag, kun når pull-optaget er
// tændt (academy_intake_pull_enabled). Holdt ude af api.js, så ruten kun får
// én linje kobling.
//
//   • Pull-kandidater (ikke underskrevet): potentialet står "Learned through
//     training". Hverken bånd eller estimat forlader serveren (punkt 1).
//   • Akademirytterne: prognose-båndet vises på det kendskabs-niveau holdets
//     træningsløbsdage med rytteren har givet (punkt 2), ikke som fuldt kendt.
//   • Profil-blokken: niveau, låste felter, aktiv og ventende profil (punkt 4-5).
import { buildTypePrognosisBands } from "./scoutingReport.js";
import { loadScout } from "./scoutAssignmentService.js";
import { loadTrainingStaffContext } from "./trainingStaffContext.js";
import { ageForSeason } from "./riderSeasonAge.js";
import { knowledgeStage, learningSpeed, loadTrainingDaysOnTeam } from "./academyProspectKnowledge.js";
import { loadAcademyProfileState, profileOptions } from "./academyIntakeProfile.js";

export const PULL_SOURCE = "pull";

/** Fjern alt potentiale fra en ikke-underskrevet pull-kandidat. */
export function maskPullCandidate(item) {
  if (item?.source !== PULL_SOURCE) return item;
  return { ...item, potentialEstimate: null, potentialBand: null, potentialLearned: true };
}

/** Akademirytterens prognose på holdets nuværende kendskabs-niveau. */
export function rosterPrognosis({ rider, abilities, potRow, daysOnTeam, speed, seasonNumber, teamId, scout }) {
  const stage = knowledgeStage(daysOnTeam, speed);
  const out = { stage: stage.stage, daysOnTeam, nextStageDays: stage.nextStageDays, band: null };
  if (stage.level == null || !abilities || !potRow?.primary_type) return out;
  const age = ageForSeason(potRow.birthdate ?? rider.birthdate, seasonNumber);
  if (age == null) return out;
  const bands = buildTypePrognosisBands({
    nowAbilities: abilities,
    age,
    primaryType: potRow.primary_type,
    secondaryType: potRow.secondary_type,
    potentiale: potRow.potentiale,
    level: stage.level,
    riderId: rider.id,
    teamId,
    scout,
  });
  const band = bands.find((b) => b.key === potRow.primary_type);
  if (band && band.progLo != null) out.band = { role: band.key, lo: band.progLo, hi: band.progHi };
  return out;
}

/**
 * @returns {Promise<{ roster: object[], intake: object[], profile: object }>}
 */
export async function buildIntake2View(supabase, { teamId, roster, intake, seasonNumber, now = new Date() }) {
  const riderIds = (roster ?? []).map((r) => r.id).filter(Boolean);
  const [profileState, staffCtx, scout, daysByRider, potRes, abRes] = await Promise.all([
    loadAcademyProfileState(supabase, { teamId, now }),
    loadTrainingStaffContext(supabase, teamId),
    riderIds.length > 0 ? loadScout(teamId, supabase) : null,
    loadTrainingDaysOnTeam(supabase, { teamId, riderIds }),
    riderIds.length > 0
      ? supabase.from("riders").select("id, potentiale, birthdate, primary_type, secondary_type").in("id", riderIds).limit(riderIds.length)
      : { data: [] },
    riderIds.length > 0
      ? supabase.from("rider_derived_abilities").select("*").in("rider_id", riderIds)
      : { data: [] },
  ]);
  if (potRes.error) throw new Error(`academy-view potentiale: ${potRes.error.message}`);
  if (abRes.error) throw new Error(`academy-view abilities: ${abRes.error.message}`);
  const potById = new Map((potRes.data ?? []).map((r) => [r.id, r]));
  const abById = new Map((abRes.data ?? []).map((r) => [r.rider_id, r]));
  const speed = learningSpeed(staffCtx);

  return {
    intake: (intake ?? []).map(maskPullCandidate),
    roster: (roster ?? []).map((rider) => ({
      ...rider,
      prognosis: rosterPrognosis({
        rider,
        abilities: abById.get(rider.id),
        potRow: potById.get(rider.id),
        daysOnTeam: daysByRider.get(rider.id) ?? 0,
        speed,
        seasonNumber,
        teamId,
        scout,
      }),
    })),
    profile: {
      tier: profileState.tier,
      candidatesPerWeek: profileState.rules.candidates,
      slots: {
        origins: profileState.rules.origins,
        types: profileState.rules.types,
        extra: profileState.rules.extra,
      },
      active: profileState.active,
      pending: profileState.pending,
      options: profileOptions(),
    },
  };
}
