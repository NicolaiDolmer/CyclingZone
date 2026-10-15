// backend/lib/academyProspectKnowledge.ts
// #6666 (ejer-beslutning 15/10, punkt 2): prognosen LÆRES gennem træning.
//
// Ved hentning ser manageren kun basis (navn, alder, nationalitet, type, evner);
// potentialet står som "Learned through training". Efter underskrift snævrer
// prognose-båndet ind med de træningsløbsdage rytteren har haft PÅ HOLDET:
// først et bredt bånd, så et smalt, og endeligt efter en sæson. Bedre træner og
// træningsfacilitet giver hurtigere SIKKERHED (dagene tæller mere), aldrig bedre
// talent: rytterens potentiale og udvikling er urørt, kun visningens bredde flytter.
//
// Båndet er det samme prognose-bånd resten af spillet viser
// (scoutingReport.buildTypePrognosisBands); denne fil afgør kun hvilket
// kendskabs-niveau (0..maxLevel) holdets egen akademirytter vises på.
//
// Tærsklerne og fart-leddene er START-KANDIDATER, kalibreres privat
// (balance-internals/6666/).
import { SCOUTING_CONFIG } from "./scouting.js";
import { staffEffectFactor } from "./facilityEngine.js";
import { MAX_FACILITY_TIER } from "./facilityConstants.js";

// Supabase-klienten er utypet i kernen (samme som resten af akademi-modulerne).
type Db = any;
export type KnowledgeStageKey = "learning" | "broad" | "narrow" | "final";
export type KnowledgeStage = {
  stage: KnowledgeStageKey;
  level: number | null;
  effectiveDays: number;
  nextStageDays: number | null;
};

export const KNOWLEDGE_DAYS = Object.freeze({
  broad: 10,   // første bånd
  narrow: 30,  // smalt bånd
  final: 140,  // en sæsons løbsdage: endelig prognose
});

// Fart: 1 + facilitets-led + træner-led. Facilitet = træningsfacilitetens niveau,
// træner = holdets stærkeste aktive træningschef (samme kilde som motoren,
// trainingStaffContext.js). Ingen træner og ingen facilitet = fart 1.
export const KNOWLEDGE_SPEED = Object.freeze({
  facilityPerTier: 0.1,
  coachMax: 0.3,
});

/** Hvor meget én træningsløbsdag tæller for holdets kendskab til rytteren. */
export function learningSpeed(
  { facilityTier = 0, staff = null }: { facilityTier?: number | null; staff?: object | null } = {},
): number {
  const tier = Math.max(0, Math.min(MAX_FACILITY_TIER, Number(facilityTier) || 0));
  // staffEffectFactor: 0.5 uden træner → 1.0 for en perfekt træner. Omsat til 0..1.
  const coachQuality = staff ? Math.max(0, Math.min(1, (staffEffectFactor(staff) - 0.5) * 2)) : 0;
  return 1 + KNOWLEDGE_SPEED.facilityPerTier * tier + KNOWLEDGE_SPEED.coachMax * coachQuality;
}

/**
 * Kendskabs-trinnet for en akademirytter.
 *   level = det scout-niveau prognose-båndet vises på (null = intet bånd endnu).
 *   nextStageDays = træningsløbsdage (rå, uden fart) til næste trin, eller null.
 */
export function knowledgeStage(daysOnTeam: unknown, speed: unknown = 1): KnowledgeStage {
  const days = Math.max(0, Number(daysOnTeam) || 0);
  const s = Math.max(1, Number(speed) || 1);
  const effectiveDays = days * s;
  const toNext = (threshold: number): number => Math.max(1, Math.ceil(threshold / s - days));
  if (effectiveDays >= KNOWLEDGE_DAYS.final) {
    return { stage: "final", level: SCOUTING_CONFIG.maxLevel, effectiveDays, nextStageDays: null };
  }
  if (effectiveDays >= KNOWLEDGE_DAYS.narrow) {
    return { stage: "narrow", level: Math.max(1, SCOUTING_CONFIG.maxLevel - 1), effectiveDays, nextStageDays: toNext(KNOWLEDGE_DAYS.final) };
  }
  if (effectiveDays >= KNOWLEDGE_DAYS.broad) {
    return { stage: "broad", level: 1, effectiveDays, nextStageDays: toNext(KNOWLEDGE_DAYS.narrow) };
  }
  return { stage: "learning", level: null, effectiveDays, nextStageDays: toNext(KNOWLEDGE_DAYS.broad) };
}

/**
 * Træningsløbsdage pr. rytter PÅ DETTE HOLD (én rider_training_scores-række pr.
 * rytter pr. løbsdag, unik pr. rytter+sæson+løbsdag). Optælling pr. rytter med
 * head:true, så der aldrig hentes rækker (ingen 1000-rækkers-loft).
 */
export async function loadTrainingDaysOnTeam(
  supabase: Db,
  { teamId, riderIds }: { teamId: string; riderIds: (string | null | undefined)[] | null | undefined },
): Promise<Map<string, number>> {
  const ids = [...new Set((riderIds ?? []).filter((id): id is string => Boolean(id)))];
  const out = new Map<string, number>();
  await Promise.all(ids.map(async (riderId) => {
    const { count, error } = await supabase
      .from("rider_training_scores")
      .select("id", { count: "exact", head: true })
      .eq("rider_id", riderId)
      .eq("team_id", teamId);
    if (error) throw new Error(`academy-knowledge training days (${riderId}): ${error.message}`);
    out.set(riderId, count ?? 0);
  }));
  return out;
}
