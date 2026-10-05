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
  | "leader_at_risk"
  // #6187 (KUN orders_gc_v3): den eneste trussel foran er holdets egne ryttere
  // (eller sidder i en gruppe med en af holdets egne). Holdet jager ikke.
  | "own_rider_ahead"
  // #5978 (KUN orders_gc_v3, endagsloeb): en rytter der paa evner kan vinde paa
  // dagens rute sidder foran holdets kaptajn, som selv kan vinde.
  | "winner_ahead"
  // #5978 (KUN orders_gc_v3, endagsloeb): holdet har ingen kaptajn der kan vinde.
  | "no_contender";

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
  /**
   * #5955: det forspring paa vejen holdet kan tolerere foer truslen bliver
   * reel (klassementshul minus fremskrivning, aldrig negativ) — den mindste
   * blandt truslens ryttere. Kun sat naar severity ikke er "none".
   */
  tolerated_lead_seconds?: number;
  /**
   * #6187 (KUN orders_gc_v3, reason "own_rider_ahead"): gruppen med holdets
   * egen rytter, hvor den trussel holdet ikke jager, sidder.
   */
  own_rider_group_id?: string;
  /**
   * #5978 (KUN orders_gc_v3, "snoren"): en farlig rytter sidder stadig foran,
   * og forspringet er endnu ikke under hans afstand minus snorens margin. Et
   * hold der allerede reagerer, stopper ikke som "contained" (teamChaseReaction).
   */
  leash_hold?: boolean;
  /** #5978 (KUN orders_gc_v3): de farlige ryttere snoren holder (sorteret). */
  leash_rider_ids?: string[];
  /** #5978 (KUN orders_gc_v3): truslen er et endagsloebs (evne, ikke klassement). */
  one_day?: boolean;
};

/**
 * #5978 (KUN orders_gc_v3): hvad farlighed maales paa ud over dagens tidshul.
 * Udeladt = orders_gc_v1/v2-vurderingen, bit-identisk.
 */
export type DangerModel = {
  /** Etaper tilbage efter i dag (GcContext.stages_remaining). Udeladt = 0. */
  stagesRemaining?: number;
  /** Endagsloeb: dagens evne-vektor (finalens krav). Udeladt = ingen endagsvurdering. */
  routeDemand?: Readonly<Partial<Record<AbilityKey, number>>>;
};

/**
 * #5978 (KUN orders_gc_v3) START-KANDIDATER, kalibreres privat
 * (balance-internals/5978/). Ejer-design 5/10: hoej risiko, hoej gevinst.
 */
export const GC_THREAT_V3_TUNING = Object.freeze({
  // Pr. resterende etape, skaleret med (styrkeforhold - 1): en staerkere
  // GC-rytter vinder tid paa de kommende etaper, en svagere taber den.
  futureSecondsPerStage: 40,
  // Hvem har noget at forsvare: GC-rytteren er inden for dette af foereren
  // (plus et tillaeg pr. resterende etape), eller blandt de forreste.
  defendBaseSeconds: 180,
  defendSecondsPerStage: 45,
  // Snoren: et hold der reagerer, holder forspringet under den farlige rytters
  // (fremskrevne) afstand minus denne margin, saa laenge han sidder der.
  leashMarginSeconds: 75,
  // Endagsloeb: det forspring et hold med en kaptajn der kan vinde, giver en
  // anden vinderkandidat (snoren maales fra det).
  oneDayAllowanceSeconds: 150,
  // Endagsloeb: "kan vinde" = dagens evne mindst denne andel af feltets bedste.
  oneDayCanWinShare: 0.9,
});

/** #5978: rytterens evne paa dagens rute (sum af krav-vaegt x normaliseret evne). */
export function routeAbility(entrant: Entrant | undefined, demand: Readonly<Partial<Record<AbilityKey, number>>>): number {
  const abilities = entrant?.abilities;
  if (!abilities) return 0;
  let sum = 0;
  for (const key of Object.keys(demand) as AbilityKey[]) {
    const weight = Number(demand[key]) || 0;
    if (weight > 0) sum += weight * (clamp(Number(abilities[key]) || 0, 0, 99) / 99);
  }
  return sum;
}

/** #5978: feltets bedste evne paa dagens rute blandt de koerende i grupperne. */
function fieldBestRouteAbility(
  groups: readonly RaceGroup[],
  entrants: Readonly<Record<string, Entrant>>,
  demand: Readonly<Partial<Record<AbilityKey, number>>>,
  isRacing: (id: string) => boolean,
): number {
  let best = 0;
  for (const group of groups) for (const id of group.rider_ids) if (isRacing(id)) best = Math.max(best, routeAbility(entrants[id], demand));
  return best;
}

/**
 * #5978 (KUN orders_gc_v3, endagsloeb): holdets kaptajn der selv kan vinde paa
 * dagens rute (bedste kaptajn/sprint-kaptajn paa evne), eller null.
 */
export function oneDayProtectedRider(input: {
  teamId: string;
  groups: readonly RaceGroup[];
  entrants: Readonly<Record<string, Entrant>>;
  routeDemand: Readonly<Partial<Record<AbilityKey, number>>>;
  racingRiderIds?: ReadonlySet<string>;
}): string | null {
  const isRacing = (id: string) => (input.racingRiderIds ? input.racingRiderIds.has(id) : true);
  const best = fieldBestRouteAbility(input.groups, input.entrants, input.routeDemand, isRacing);
  if (!(best > 0)) return null;
  let pick: { id: string; ability: number } | null = null;
  for (const group of input.groups) {
    for (const id of group.rider_ids) {
      const entrant = input.entrants[id];
      if (!isRacing(id) || entrant?.team_id !== input.teamId || !LEADER_ROLES.has(String(entrant.role))) continue;
      const ability = routeAbility(entrant, input.routeDemand);
      if (!pick || ability > pick.ability || (ability === pick.ability && id < pick.id)) pick = { id, ability };
    }
  }
  return pick && pick.ability >= GC_THREAT_V3_TUNING.oneDayCanWinShare * best ? pick.id : null;
}

const LEADER_ROLES: ReadonlySet<string> = new Set(["captain", "sprint_captain"]);

/** #5978: har holdets GC-rytter noget at forsvare (KUN orders_gc_v3)? */
function hasSomethingToDefend(standing: GcStanding, isLeader: boolean, stagesRemaining: number): boolean {
  if (isLeader || standing.rank <= GC_THREAT_TUNING.protectRankLimit) return true;
  const t = GC_THREAT_V3_TUNING;
  return standing.gap_seconds <= t.defendBaseSeconds + t.defendSecondsPerStage * Math.max(0, stagesRemaining);
}

function stagesRemainingOf(model: DangerModel | undefined): number {
  const n = Number(model?.stagesRemaining);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

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
      // #5978 (ADDITIVT, kun sat af broen under orders_gc_v3): etaper tilbage efter i dag.
      const stagesRemaining = Number(ctx["stages_remaining"]);
      const remaining = ctx["stages_remaining"] !== undefined && Number.isInteger(stagesRemaining) && stagesRemaining >= 0
        ? { stages_remaining: stagesRemaining }
        : {};
      return { status: "standings", stage_number: stageNumber, leader_id: leaderId, standings, ...remaining };
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
  /**
   * #6187 (KUN orders_gc_v3): holdet vurderingen gaelder. Holdets egne ryttere
   * er aldrig en trussel. Udeladt = ingen saadan undtagelse (orders_gc_v1/v2,
   * bit-identisk).
   */
  ownTeamId?: string;
  /**
   * #6187 (KUN orders_gc_v3, kraever ownTeamId): en gruppe foran med en af
   * holdets egne koerende ryttere vurderes slet ikke; holdet jager den ikke.
   * Er det kun derfor der ingen trussel er, er grunden "own_rider_ahead".
   */
  skipOwnRiderGroups?: boolean;
  /**
   * #5978 (KUN orders_gc_v3): farlighed = tid + evne + resterende etaper, hvem
   * har noget at forsvare, snoren og endagsloebets evne-vurdering. Udeladt =
   * orders_gc_v1/v2-vurderingen, bit-identisk.
   */
  dangerModel?: DangerModel;
}): GcThreat {
  const tuning = GC_THREAT_TUNING;
  const gcContext = input.gcContext ?? null;
  const model = input.dangerModel;
  if (!gcContext || gcContext.status === "missing") return { ...NO_THREAT_BASE, severity: "none", reason: "no_context" };
  if (gcContext.status === "one_day") {
    if (model?.routeDemand) return assessOneDayThreat({ ...input, routeDemand: model.routeDemand });
    return { ...NO_THREAT_BASE, severity: "none", reason: "one_day" };
  }
  if (gcContext.status === "first_stage") return { ...NO_THREAT_BASE, severity: "none", reason: "first_stage" };

  const protectedId = input.protectedRiderId;
  const standingById = new Map(gcContext.standings.map((s) => [s.rider_id, s]));
  const protectedStanding = protectedId ? standingById.get(protectedId) : undefined;
  if (!protectedId || !protectedStanding) return { ...NO_THREAT_BASE, severity: "none", reason: "no_protected_rider" };

  const isLeader = gcContext.leader_id === protectedId;
  const stagesRemaining = stagesRemainingOf(model);
  const interested = model
    ? hasSomethingToDefend(protectedStanding, isLeader, stagesRemaining)
    : isLeader || protectedStanding.rank <= tuning.protectRankLimit;
  if (!interested) {
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
  type Candidate = { riderId: string; severity: GcThreatSeverity; reason: GcThreatReason; margin: number; lead: number; tied: boolean; own: boolean; groupId: string; rival: boolean; leashRoom: number };
  const candidates: Candidate[] = [];
  let anyClassified = false;
  // #6187: under orders_gc_v3 taeller holdets egne ryttere aldrig (og med
  // skipOwnRiderGroups heller ikke deres gruppe). Uden ownTeamId er `own` altid
  // falsk, og vurderingen er praecis som foer.
  const ownTeamId = input.ownTeamId;
  const isOwn = (riderId: string) => ownTeamId !== undefined && input.entrants[riderId]?.team_id === ownTeamId;
  for (const group of ahead) {
    const lead = Math.max(0, protectedGroup.gap_seconds - group.gap_seconds);
    const ownGroup = input.skipOwnRiderGroups === true && group.rider_ids.some((id) => isRacing(id) && isOwn(id));
    for (const riderId of group.rider_ids) {
      if (!isRacing(riderId)) continue;
      const standing = standingById.get(riderId);
      if (!standing) continue; // ikke i klassementet: ingen GC-trussel
      anyClassified = true;
      const deficit = standing.gap_seconds - protectedStanding.gap_seconds;
      const strengthRaw = protectedStrength > 0 ? gcAbility(input.entrants[riderId]) / protectedStrength : 1;
      const strength = clamp(strengthRaw, ratioLo, ratioHi);
      // #5978 (KUN orders_gc_v3): de kommende etaper taeller med (evne x antal).
      const future = model ? stagesRemaining * GC_THREAT_V3_TUNING.futureSecondsPerStage * (strength - 1) : 0;
      const potential = Math.max(
        0,
        Math.min(terrain.openKm * tuning.potentialSecondsPerOpenKm, tuning.potentialOpenCapSeconds) + terrain.climbKm * tuning.potentialSecondsPerClimbKm * (strength - 1) + future,
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
      candidates.push({ riderId, severity, reason, margin, lead, tied: deficit === 0, own: ownGroup || isOwn(riderId), groupId: group.id, rival: isRival, leashRoom: deficit - Math.max(0, future) - GC_THREAT_V3_TUNING.leashMarginSeconds });
    }
  }
  if (!anyClassified) return { ...base, threat_rider_ids: [], tied: false, severity: "none", reason: "no_classified_rider_ahead" };

  const bySeverity = (a: Candidate, b: Candidate) =>
    severityRank[b.severity] - severityRank[a.severity] || a.margin - b.margin || a.riderId.localeCompare(b.riderId);
  const counted = candidates.filter((c) => !c.own).sort(bySeverity);
  const suppressed = candidates.filter((c) => c.own).sort(bySeverity);
  if (suppressed.length > 0 && (counted.length === 0 || counted[0].severity === "none")) {
    // #6187: det eneste der ville have vaeret en trussel, er holdets egne
    // (eller sidder sammen med dem). Holdet jager ikke sine egne.
    if (suppressed[0].severity !== "none") {
      return { ...base, threat_rider_ids: [], tied: false, severity: "none", reason: "own_rider_ahead", own_rider_group_id: suppressed[0].groupId };
    }
    if (counted.length === 0) return { ...base, threat_rider_ids: [], tied: false, severity: "none", reason: "no_classified_rider_ahead" };
  }
  const worst = counted[0];
  // #5978 (KUN orders_gc_v3): ogsaa naar snoren er den eneste trussel, kan
  // holdet ikke jage fra en anden gruppe end jagtgruppen (samme pause/stop).
  const leashOnly = model !== undefined && worst.severity === "none" && leashHeldBy(counted);
  if ((worst.severity !== "none" || leashOnly) && input.chasingGroupIds && !input.chasingGroupIds.has(protectedGroup.id)) {
    return { ...base, threat_rider_ids: [], tied: worst.tied, severity: "none", reason: "protected_in_other_group" };
  }
  const threatRiderIds = worst.severity === "none"
    ? []
    : counted.filter((c) => c.severity === worst.severity).map((c) => c.riderId).sort();
  if (model) return withLeash({ ...base, severity: worst.severity, reason: worst.reason, threat_rider_ids: threatRiderIds, tied: worst.tied }, counted);
  const toleratedLead = Math.max(0, Math.min(...counted.filter((c) => c.severity !== "none").map((c) => c.lead + c.margin)));
  return {
    ...base, severity: worst.severity, reason: worst.reason, threat_rider_ids: threatRiderIds, tied: worst.tied,
    ...(worst.severity !== "none" ? { tolerated_lead_seconds: toleratedLead } : {}),
  };
}

/** #5978 (KUN orders_gc_v3): holder denne rytter snoren (reel rival under snorens margin)? */
function holdsLeash(c: { margin: number; rival: boolean }): boolean {
  return c.rival && c.margin < GC_THREAT_V3_TUNING.leashMarginSeconds;
}

/** #5978 (KUN orders_gc_v3): holder nogen af de talte ryttere snoren? */
function leashHeldBy(counted: ReadonlyArray<{ margin: number; rival: boolean }>): boolean {
  return counted.some(holdsLeash);
}

/**
 * #5978 (KUN orders_gc_v3): snoren. En farlig rytter (reel rival, ikke holdets
 * egen) foran, hvis fremskrevne margin endnu er under snorens margin, holder
 * snoren. Det tolererede forspring (GC-bremsen) er snorens laengde
 * (`leashRoom`): hans afstand (plus det han vinder paa de kommende etaper)
 * minus margin; i endagsloeb det tolererede forspring minus margin.
 */
function withLeash(
  threat: GcThreat,
  counted: ReadonlyArray<{ riderId: string; severity: GcThreatSeverity; margin: number; rival: boolean; leashRoom: number }>,
): GcThreat {
  const held = counted.filter(holdsLeash);
  const limiting = counted.filter((c) => c.severity !== "none" || holdsLeash(c));
  const tolerated = limiting.length > 0
    ? { tolerated_lead_seconds: Math.max(0, Math.min(...limiting.map((c) => c.leashRoom))) }
    : {};
  return {
    ...threat,
    ...tolerated,
    leash_hold: held.length > 0,
    ...(held.length > 0 ? { leash_rider_ids: held.map((c) => c.riderId).sort() } : {}),
  };
}

/**
 * #5978 (KUN orders_gc_v3): endagsloebets vurdering, maalt paa evne. Holdets
 * kaptajn kan selv vinde paa dagens rute (oneDayProtectedRider); en anden
 * rytter foran, der ogsaa kan vinde og er en reel rival paa dagens evne, er
 * farlig. Margin = det tolererede forspring minus det faktiske.
 */
function assessOneDayThreat(input: {
  groups: readonly RaceGroup[];
  entrants: Readonly<Record<string, Entrant>>;
  protectedRiderId: string | null;
  racingRiderIds?: ReadonlySet<string>;
  chasingGroupIds?: ReadonlySet<string>;
  ownTeamId?: string;
  skipOwnRiderGroups?: boolean;
  routeDemand: Readonly<Partial<Record<AbilityKey, number>>>;
}): GcThreat {
  const tuning = GC_THREAT_TUNING;
  const v3 = GC_THREAT_V3_TUNING;
  const oneDay = { one_day: true as const };
  const protectedId = input.protectedRiderId;
  if (!protectedId) return { ...NO_THREAT_BASE, severity: "none", reason: "no_contender", ...oneDay };
  const isRacing = (riderId: string) => (input.racingRiderIds ? input.racingRiderIds.has(riderId) : true);
  const protectedGroup = input.groups.find((g) => g.rider_ids.includes(protectedId));
  if (!protectedGroup || !isRacing(protectedId)) {
    return { ...NO_THREAT_BASE, protected_rider_id: protectedId, severity: "none", reason: "protected_not_racing", ...oneDay };
  }
  const base = { protected_rider_id: protectedId, chase_group_id: protectedGroup.id, ...oneDay };
  const ahead = input.groups
    .filter((g) => g.id !== protectedGroup.id && g.gap_seconds < protectedGroup.gap_seconds)
    .sort((a, b) => a.gap_seconds - b.gap_seconds || a.id.localeCompare(b.id));
  if (ahead.length === 0) {
    const protectedLeads = input.groups.some((g) => g.id !== protectedGroup.id);
    return { ...base, threat_rider_ids: [], tied: false, severity: "none", reason: protectedLeads ? "protected_ahead" : "nothing_ahead" };
  }
  const best = fieldBestRouteAbility(input.groups, input.entrants, input.routeDemand, isRacing);
  const protectedAbility = routeAbility(input.entrants[protectedId], input.routeDemand);
  const isOwn = (riderId: string) => input.ownTeamId !== undefined && input.entrants[riderId]?.team_id === input.ownTeamId;
  type Candidate = { riderId: string; severity: GcThreatSeverity; margin: number; lead: number; own: boolean; groupId: string; rival: boolean; leashRoom: number };
  const candidates: Candidate[] = [];
  for (const group of ahead) {
    const lead = Math.max(0, protectedGroup.gap_seconds - group.gap_seconds);
    const ownGroup = input.skipOwnRiderGroups === true && group.rider_ids.some((id) => isRacing(id) && isOwn(id));
    for (const riderId of group.rider_ids) {
      if (!isRacing(riderId)) continue;
      const ability = routeAbility(input.entrants[riderId], input.routeDemand);
      const rival = best > 0 && ability >= v3.oneDayCanWinShare * best
        && (protectedAbility > 0 ? ability / protectedAbility : 1) >= tuning.rivalStrengthMin;
      if (!rival) continue;
      const margin = v3.oneDayAllowanceSeconds - lead;
      const severity: GcThreatSeverity = margin <= 0 ? "serious" : margin <= tuning.moderateWindowSeconds ? "moderate" : "none";
      candidates.push({ riderId, severity, margin, lead, own: ownGroup || isOwn(riderId), groupId: group.id, rival, leashRoom: v3.oneDayAllowanceSeconds - v3.leashMarginSeconds });
    }
  }
  const severityRank: Record<GcThreatSeverity, number> = { none: 0, moderate: 1, serious: 2 };
  const bySeverity = (a: Candidate, b: Candidate) =>
    severityRank[b.severity] - severityRank[a.severity] || a.margin - b.margin || a.riderId.localeCompare(b.riderId);
  const counted = candidates.filter((c) => !c.own).sort(bySeverity);
  const suppressed = candidates.filter((c) => c.own).sort(bySeverity);
  if (counted.length === 0) {
    if (suppressed.length > 0) {
      return { ...base, threat_rider_ids: [], tied: false, severity: "none", reason: "own_rider_ahead", own_rider_group_id: suppressed[0].groupId };
    }
    return { ...base, threat_rider_ids: [], tied: false, severity: "none", reason: "harmless", leash_hold: false };
  }
  const worst = counted[0];
  // #5978: ogsaa naar snoren er den eneste trussel (samme pause/stop som i etapeloeb).
  if ((worst.severity !== "none" || leashHeldBy(counted)) && input.chasingGroupIds && !input.chasingGroupIds.has(protectedGroup.id)) {
    return { ...base, threat_rider_ids: [], tied: false, severity: "none", reason: "protected_in_other_group" };
  }
  const threatRiderIds = worst.severity === "none" ? [] : counted.filter((c) => c.severity === worst.severity).map((c) => c.riderId).sort();
  return withLeash(
    { ...base, severity: worst.severity, reason: worst.severity === "none" ? "harmless" : "winner_ahead", threat_rider_ids: threatRiderIds, tied: false },
    counted,
  );
}

/**
 * #5978 (KUN orders_gc_v3, dannelsen): de hold for hvem et forsoeg fra
 * `riderId` er farligt, foer der er noget forspring (lead 0, hele dagens
 * resterende terraen). Samme farlighed som snoren: en reel rival hvis
 * fremskrevne margin er under snorens margin. Holdets egne taeller aldrig.
 * Ren og deterministisk (sorteret).
 */
export function formationDangerTeams(input: {
  gcContext: GcContext | null | undefined;
  riderId: string;
  teamIds: readonly string[];
  groups: readonly RaceGroup[];
  entrants: Readonly<Record<string, Entrant>>;
  route: RouteV2;
  km: number;
  racingRiderIds?: ReadonlySet<string>;
  dangerModel: DangerModel;
}): string[] {
  const gcContext = input.gcContext ?? null;
  if (!gcContext || (gcContext.status !== "standings" && gcContext.status !== "one_day")) return [];
  if (gcContext.status === "one_day" && !input.dangerModel.routeDemand) return [];
  const riderTeam = input.entrants[input.riderId]?.team_id;
  // Rytteren alene foran sin egen gruppe, uden forspring: samme vurdering som
  // paa vejen, med lead 0.
  const source = input.groups.find((g) => g.rider_ids.includes(input.riderId));
  if (!source) return [];
  const probe: RaceGroup = { ...source, id: `${source.id}#attempt`, rider_ids: [input.riderId], gap_seconds: source.gap_seconds - 1e-9 };
  const rest: RaceGroup = { ...source, rider_ids: source.rider_ids.filter((id) => id !== input.riderId) };
  const groups = [probe, rest];
  const out: string[] = [];
  for (const teamId of [...input.teamIds].sort((a, b) => a.localeCompare(b))) {
    if (teamId === riderTeam) continue;
    const protectedRiderId = gcContext.status === "one_day"
      ? oneDayProtectedRider({ teamId, groups, entrants: input.entrants, routeDemand: input.dangerModel.routeDemand!, racingRiderIds: input.racingRiderIds })
      : protectedRiderForTeam({ gcContext, teamId, entrants: input.entrants });
    if (!protectedRiderId || protectedRiderId === input.riderId) continue;
    if (gcContext.status === "one_day") {
      // Endagsloeb: en vinderkandidat er farlig fra start (intet tidshul at maale).
      const demand = input.dangerModel.routeDemand!;
      const isRacing = (id: string) => (input.racingRiderIds ? input.racingRiderIds.has(id) : true);
      const best = fieldBestRouteAbility(groups, input.entrants, demand, isRacing);
      const ability = routeAbility(input.entrants[input.riderId], demand);
      const protectedAbility = routeAbility(input.entrants[protectedRiderId], demand);
      const rival = best > 0 && ability >= GC_THREAT_V3_TUNING.oneDayCanWinShare * best
        && (protectedAbility > 0 ? ability / protectedAbility : 1) >= GC_THREAT_TUNING.rivalStrengthMin;
      if (rival) out.push(teamId);
      continue;
    }
    const threat = assessGcThreat({
      gcContext, groups, entrants: input.entrants, route: input.route, protectedRiderId, km: input.km,
      racingRiderIds: input.racingRiderIds, ownTeamId: teamId, dangerModel: input.dangerModel,
    });
    if (threat.leash_hold === true || threat.severity !== "none") out.push(teamId);
  }
  return out;
}
