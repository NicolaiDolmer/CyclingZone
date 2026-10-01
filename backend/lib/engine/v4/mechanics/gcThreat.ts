// backend/lib/engine/v4/mechanics/gcThreat.ts
// #5978 (#5984 Task 4): hvor alvorlig er dagens situation for ét holds
// klassement? KUN under regel-revisionen "orders_gc_v1" (StageInput.
// rules_revision); legacy-stien kalder aldrig dette modul.
//
// Kontrakt (spec 2026-09-30 "orders, GC reactions and a truthful film" §4 +
// "Proposed typed boundaries"):
//   - Kilden er det PUBLICEREDE klassement FOER etapen for dagens startere
//     (StageInput.gc_context). Slutresultatet af etapen bruges aldrig.
//   - Foerste etape, endagsloeb og manglende data er EKSPLICITTE tilstande. Et
//     ukendt hul behandles aldrig som et nul-hul (dvs. aldrig som "foereren").
//   - Virtuel foering alene er ikke nok: truslen afgoeres af klassements-hullet,
//     det aktuelle forspring paa vejen, det resterende terraen og rytterens
//     relevante evner sammenholdt med holdets egen GC-rytter.
//   - En GC-rytter der ikke er i jagtgruppen (sat af, foran, i udbruddet) kan
//     ikke beskyttes af holdets jagt i en anden gruppe: ingen opdigtet
//     beskyttelse.
//
// REN: ingen IO, ingen rng, muterer intet input. Tuning-vaerdierne nedenfor er
// START-KANDIDATER (samme lokale praecedens som breakaway.ts's TEAM_CHASE); de
// kalibreres privat (#5984 Task 6) og er ikke ejer-godkendte maal.

import type { AbilityKey, Entrant, GcContext, GcStanding, RaceGroup, RouteV2 } from "../types.ts";

export type GcThreatSeverity = "none" | "moderate" | "serious";

export type GcThreatReason =
  // Ingen kontekst at vurdere ud fra (eksplicitte tilstande).
  | "no_context"
  | "one_day"
  | "first_stage"
  // Holdet har ingen GC-interesse at forsvare.
  | "no_protected_rider"
  | "no_gc_interest"
  | "protected_not_racing"
  // Holdets GC-rytter kan ikke hjaelpes af en jagt fra hans gruppe.
  | "protected_ahead"
  | "protected_in_other_group"
  // Vurderinger af ryttere foran.
  | "nothing_ahead"
  | "no_classified_rider_ahead"
  | "harmless"
  | "transient_only"
  | "rival_close"
  | "rival_ahead"
  | "leader_jersey_at_risk"
  | "leader_at_risk";

export type GcThreat = {
  severity: GcThreatSeverity;
  reason: GcThreatReason;
  /** Holdets GC-rytter (den der beskyttes), eller null. */
  protected_rider_id: string | null;
  /** Gruppen holdets GC-rytter sidder i (den eneste gruppe en reaktion kan virke fra). */
  chase_group_id: string | null;
  /** Ryttere foran der udgoer truslen (tom ved severity "none"). */
  threat_rider_ids: string[];
  /** Sand naar den alvorligste trussel staar paa samme klassementstid som GC-rytteren. */
  tied: boolean;
};

export const GC_THREAT_TUNING = Object.freeze({
  // Et hold har GC-interesse naar dets bedste rytter er blandt de forreste i
  // klassementet (foereren har den altid).
  protectRankLimit: 10,
  // Hvor mange sekunder et udbrud plausibelt kan vinde pr. resterende km paa
  // aabent terraen, hvis ingen reagerer.
  potentialSecondsPerOpenKm: 1.5,
  // #5955: loft paa det AABNE terraens fremskrivning. Uden loft blev naesten
  // enhver klassementsrytter i et udbrud tidligt paa en lang etape vurderet
  // som alvorlig (aabne km x sats), selv om feltet aldrig giver et udbrud
  // ubegraenset plads. Stigningsleddet (styrkeforholdet) er ikke loftet.
  potentialOpenCapSeconds: 150,
  // Pr. resterende stignings-km, skaleret med (styrkeforhold - 1): en staerkere
  // klatrer vinder tid op ad bakke, en svagere taber den igen.
  potentialSecondsPerClimbKm: 10,
  // Et hul inden for dette vindue (efter fremskrivning) er "taet paa".
  moderateWindowSeconds: 45,
  // Rytterens GC-evner relativt til GC-rytterens: under dette er han ingen
  // reel rival (kun en forbigaaende virtuel foering).
  rivalStrengthMin: 0.92,
  strengthRatioBounds: [0.5, 1.5] as readonly [number, number],
});

const GC_ABILITY_KEYS: readonly AbilityKey[] = ["climbing", "tempo", "time_trial"];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function gcAbility(entrant: Entrant | undefined): number {
  const abilities = entrant?.abilities;
  if (!abilities) return 0;
  let sum = 0;
  for (const key of GC_ABILITY_KEYS) sum += clamp(Number(abilities[key]) || 0, 0, 99) / 99;
  return sum / GC_ABILITY_KEYS.length;
}

/**
 * Validerer en raa gc_context (fra broen eller en test). Alt der ikke er en
 * gyldig, eksplicit tilstand bliver "missing" — aldrig et tomt klassement der
 * kunne laeses som "alle staar lige".
 */
export function normalizeGcContext(raw: unknown): GcContext {
  if (!raw || typeof raw !== "object") return { status: "missing" };
  const ctx = raw as Record<string, unknown>;
  const stageNumber = Number(ctx["stage_number"]);
  const hasStage = Number.isFinite(stageNumber) && stageNumber >= 1;
  switch (ctx["status"]) {
    case "one_day":
      return { status: "one_day" };
    case "first_stage":
      return hasStage ? { status: "first_stage", stage_number: stageNumber } : { status: "missing" };
    case "standings": {
      const rawStandings = Array.isArray(ctx["standings"]) ? (ctx["standings"] as unknown[]) : [];
      const standings: GcStanding[] = [];
      const seen = new Set<string>();
      for (const row of rawStandings) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const riderId = r["rider_id"];
        const rank = Number(r["rank"]);
        const gap = Number(r["gap_seconds"]);
        if (typeof riderId !== "string" || !riderId || seen.has(riderId)) continue;
        if (!Number.isFinite(rank) || rank < 1 || !Number.isFinite(gap) || gap < 0) continue;
        seen.add(riderId);
        standings.push({ rider_id: riderId, rank, gap_seconds: gap });
      }
      if (!hasStage || standings.length === 0) return { status: "missing", ...(hasStage ? { stage_number: stageNumber } : {}) };
      standings.sort((a, b) => a.rank - b.rank || a.rider_id.localeCompare(b.rider_id));
      const rawLeader = ctx["leader_id"];
      const leaderId = typeof rawLeader === "string" && seen.has(rawLeader) ? rawLeader : standings[0].rider_id;
      return { status: "standings", stage_number: stageNumber, leader_id: leaderId, standings };
    }
    case "missing":
      return hasStage ? { status: "missing", stage_number: stageNumber } : { status: "missing" };
    default:
      return { status: "missing" };
  }
}

/**
 * Holdets GC-rytter: den bedst placerede af holdets startere i det
 * publicerede klassement. Null naar holdet ingen klassificerede startere har.
 */
export function protectedRiderForTeam(input: {
  gcContext: GcContext;
  teamId: string;
  entrants: Readonly<Record<string, Entrant>>;
}): string | null {
  if (input.gcContext.status !== "standings") return null;
  for (const standing of input.gcContext.standings) {
    const teamId = input.entrants[standing.rider_id]?.team_id;
    if (typeof teamId === "string" && teamId === input.teamId) return standing.rider_id;
  }
  return null;
}

/** Resterende stignings-km og oevrige km fra `km` til maal. */
export function remainingTerrainKm(route: RouteV2, km: number): { climbKm: number; openKm: number } {
  let climbKm = 0;
  let openKm = 0;
  for (const segment of route.segments) {
    const span = Math.max(0, segment.to_km - Math.max(segment.from_km, km));
    if (span <= 0) continue;
    if (segment.kind === "climb") climbKm += span;
    else openKm += span;
  }
  return { climbKm, openKm };
}

const NO_THREAT_BASE = { protected_rider_id: null, chase_group_id: null, threat_rider_ids: [] as string[], tied: false };

/**
 * Vurderer truslen mod holdets GC-rytter (`protectedRiderId`) ud fra grupperne
 * FORAN hans gruppe. `km` er positionen vurderingen gaelder fra (typisk
 * segmentets slut-km): kun terraenet derfra og til maal taeller.
 *
 * Alvor pr. rytter foran (klassementshul `d` til GC-rytteren, forspring `L`
 * paa vejen, fremskrevet ekstra forspring `P` paa resterende terraen):
 *   - fremskrevet foran GC-rytteren (d - L - P <= 0) og en reel rival -> serious
 *   - fremskrevet foran, men ingen reel rival: moderate kun hvis GC-rytteren er
 *     foereren (troejen), ellers none ("transient_only")
 *   - taet paa (inden for moderateWindowSeconds) og en reel rival -> moderate
 *   - ellers none ("harmless")
 * Den alvorligste rytter afgoer resultatet; lige alvor afgoeres af mindste
 * fremskrevne margin, derefter rider_id (deterministisk).
 */
export function assessGcThreat(input: {
  gcContext: GcContext | null | undefined;
  groups: readonly RaceGroup[];
  entrants: Readonly<Record<string, Entrant>>;
  route: RouteV2;
  protectedRiderId: string | null;
  km: number;
  racingRiderIds?: ReadonlySet<string>;
  /**
   * Grupper der faktisk jager noget foran sig (M5's jagtgrupper). Er GC-
   * rytterens gruppe ikke iblandt dem (han er fx sat af bag en anden gruppe),
   * kan holdets hjaelpere ikke beskytte ham: severity "none",
   * "protected_in_other_group". Udeladt = ingen saadan begraensning.
   */
  chasingGroupIds?: ReadonlySet<string>;
}): GcThreat {
  const tuning = GC_THREAT_TUNING;
  const gcContext = input.gcContext ?? null;
  if (!gcContext || gcContext.status === "missing") return { ...NO_THREAT_BASE, severity: "none", reason: "no_context" };
  if (gcContext.status === "one_day") return { ...NO_THREAT_BASE, severity: "none", reason: "one_day" };
  if (gcContext.status === "first_stage") return { ...NO_THREAT_BASE, severity: "none", reason: "first_stage" };

  const protectedId = input.protectedRiderId;
  const standingById = new Map(gcContext.standings.map((s) => [s.rider_id, s]));
  const protectedStanding = protectedId ? standingById.get(protectedId) : undefined;
  if (!protectedId || !protectedStanding) return { ...NO_THREAT_BASE, severity: "none", reason: "no_protected_rider" };

  const isLeader = gcContext.leader_id === protectedId;
  if (!isLeader && protectedStanding.rank > tuning.protectRankLimit) {
    return { ...NO_THREAT_BASE, protected_rider_id: protectedId, severity: "none", reason: "no_gc_interest" };
  }

  const isRacing = (riderId: string) => (input.racingRiderIds ? input.racingRiderIds.has(riderId) : true);
  const protectedGroup = input.groups.find((g) => g.rider_ids.includes(protectedId));
  if (!protectedGroup || !isRacing(protectedId)) {
    return { ...NO_THREAT_BASE, protected_rider_id: protectedId, severity: "none", reason: "protected_not_racing" };
  }
  const base = { protected_rider_id: protectedId, chase_group_id: protectedGroup.id };

  const ahead = input.groups
    .filter((g) => g.id !== protectedGroup.id && g.gap_seconds < protectedGroup.gap_seconds)
    .sort((a, b) => a.gap_seconds - b.gap_seconds || a.id.localeCompare(b.id));
  if (ahead.length === 0) {
    // Ingen foran: enten er GC-rytterens gruppe selv fronten (fx han sidder i
    // udbruddet), eller der er intet udbrud. Ingen jagt at lave.
    const protectedLeads = input.groups.some((g) => g.id !== protectedGroup.id);
    return { ...base, threat_rider_ids: [], tied: false, severity: "none", reason: protectedLeads ? "protected_ahead" : "nothing_ahead" };
  }

  const protectedStrength = gcAbility(input.entrants[protectedId]);
  const terrain = remainingTerrainKm(input.route, input.km);
  const [ratioLo, ratioHi] = tuning.strengthRatioBounds;

  const severityRank: Record<GcThreatSeverity, number> = { none: 0, moderate: 1, serious: 2 };
  type Candidate = { riderId: string; severity: GcThreatSeverity; reason: GcThreatReason; margin: number; tied: boolean };
  const candidates: Candidate[] = [];
  let anyClassified = false;
  for (const group of ahead) {
    const lead = Math.max(0, protectedGroup.gap_seconds - group.gap_seconds);
    for (const riderId of group.rider_ids) {
      if (!isRacing(riderId)) continue;
      const standing = standingById.get(riderId);
      if (!standing) continue; // ikke i klassementet: ingen GC-trussel
      anyClassified = true;
      const deficit = standing.gap_seconds - protectedStanding.gap_seconds;
      const strengthRaw = protectedStrength > 0 ? gcAbility(input.entrants[riderId]) / protectedStrength : 1;
      const strength = clamp(strengthRaw, ratioLo, ratioHi);
      const potential = Math.max(
        0,
        Math.min(terrain.openKm * tuning.potentialSecondsPerOpenKm, tuning.potentialOpenCapSeconds) + terrain.climbKm * tuning.potentialSecondsPerClimbKm * (strength - 1),
      );
      const margin = deficit - lead - potential;
      const isRival = strengthRaw >= tuning.rivalStrengthMin;
      let severity: GcThreatSeverity;
      let reason: GcThreatReason;
      if (margin <= 0) {
        if (isRival) {
          severity = "serious";
          reason = isLeader ? "leader_at_risk" : "rival_ahead";
        } else if (isLeader) {
          severity = "moderate";
          reason = "leader_jersey_at_risk";
        } else {
          severity = "none";
          reason = "transient_only";
        }
      } else if (margin <= tuning.moderateWindowSeconds && isRival) {
        severity = "moderate";
        reason = "rival_close";
      } else {
        severity = "none";
        reason = "harmless";
      }
      candidates.push({ riderId, severity, reason, margin, tied: deficit === 0 });
    }
  }
  if (!anyClassified) return { ...base, threat_rider_ids: [], tied: false, severity: "none", reason: "no_classified_rider_ahead" };

  candidates.sort(
    (a, b) => severityRank[b.severity] - severityRank[a.severity] || a.margin - b.margin || a.riderId.localeCompare(b.riderId),
  );
  const worst = candidates[0];
  if (worst.severity !== "none" && input.chasingGroupIds && !input.chasingGroupIds.has(protectedGroup.id)) {
    return { ...base, threat_rider_ids: [], tied: worst.tied, severity: "none", reason: "protected_in_other_group" };
  }
  const threatRiderIds = worst.severity === "none"
    ? []
    : candidates.filter((c) => c.severity === worst.severity).map((c) => c.riderId).sort();
  return { ...base, severity: worst.severity, reason: worst.reason, threat_rider_ids: threatRiderIds, tied: worst.tied };
}
