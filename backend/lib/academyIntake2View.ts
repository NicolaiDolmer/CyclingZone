// backend/lib/academyIntake2View.ts
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
import { knowledgeStage, learningSpeed, loadTrainingDaysOnTeam } from "./academyProspectKnowledge.ts";
import type { KnowledgeStageKey } from "./academyProspectKnowledge.ts";
import { loadAcademyProfileState, profileOptions } from "./academyIntakeProfile.ts";
import type { ResolvedProfile } from "./academyIntakeProfile.ts";

export const PULL_SOURCE = "pull";

// Supabase-klienten og de rå rækker er utypede i kernen (samme som resten af
// akademi-modulerne); kun de felter denne fil selv læser, er typede.
type Db = any;
type Row = Record<string, any>;
export type IntakeItem = Row & { source?: string | null };
export type RosterRider = Row & { id: string; birthdate?: string | null };
export type PotentialeRow = {
  id: string;
  potentiale: number | null;
  birthdate: string | null;
  primary_type: string | null;
  secondary_type: string | null;
};
export type RosterPrognosis = {
  stage: KnowledgeStageKey;
  daysOnTeam: number;
  nextStageDays: number | null;
  band: { role: string; lo: number; hi: number | null } | null;
};
export type Intake2View = {
  intake: IntakeItem[];
  roster: (RosterRider & { prognosis: RosterPrognosis })[];
  profile: {
    tier: number;
    candidatesPerWeek: number;
    slots: { origins: number; types: number; extra: number };
    active: ResolvedProfile | null;
    pending: ResolvedProfile | null;
    options: ReturnType<typeof profileOptions>;
  };
};

/** Fjern alt potentiale fra en ikke-underskrevet pull-kandidat. */
export function maskPullCandidate<T extends IntakeItem | null | undefined>(item: T): T {
  if (item?.source !== PULL_SOURCE) return item;
  return { ...item, potentialEstimate: null, potentialBand: null, potentialLearned: true };
}

/** Akademirytterens prognose på holdets nuværende kendskabs-niveau. */
export function rosterPrognosis({ rider, abilities, potRow, daysOnTeam, speed, seasonNumber, teamId, scout }: {
  rider: RosterRider;
  abilities: Row | null | undefined;
  potRow: PotentialeRow | null | undefined;
  daysOnTeam: number;
  speed: number;
  seasonNumber: number;
  teamId: string;
  scout?: unknown;
}): RosterPrognosis {
  const stage = knowledgeStage(daysOnTeam, speed);
  const out: RosterPrognosis = { stage: stage.stage, daysOnTeam, nextStageDays: stage.nextStageDays, band: null };
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
    // scoutingReport.js er utypet JS: parametertypen er udledt af dens default
    // (DEFAULT_SCOUT). loadScout-rækken har samme form, så den gives videre uændret.
    scout: scout as Parameters<typeof buildTypePrognosisBands>[0]["scout"],
  });
  const band = (bands as { key: string; progLo: number | null; progHi: number | null }[])
    .find((b) => b.key === potRow.primary_type);
  if (band && band.progLo != null) out.band = { role: band.key, lo: band.progLo, hi: band.progHi };
  return out;
}

export async function buildIntake2View(supabase: Db, { teamId, roster, intake, seasonNumber, now = new Date() }: {
  teamId: string;
  roster: RosterRider[] | null | undefined;
  intake: IntakeItem[] | null | undefined;
  seasonNumber: number;
  now?: Date | string | number;
}): Promise<Intake2View> {
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
  const potById = new Map<string, PotentialeRow>((potRes.data ?? []).map((r: PotentialeRow) => [r.id, r]));
  const abById = new Map<string, Row>((abRes.data ?? []).map((r: Row) => [r.rider_id, r]));
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
