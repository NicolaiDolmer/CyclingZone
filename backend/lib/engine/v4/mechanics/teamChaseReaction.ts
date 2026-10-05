// backend/lib/engine/v4/mechanics/teamChaseReaction.ts
// #5978 (#5984 Task 4): et holds faktiske GC-reaktion paa en etape, og det
// kumulative arbejde den koster. KUN under regel-revisionen "orders_gc_v1".
//
// Produktkontrakt (spec 2026-09-30 §4-5):
//   - "chase" (eksplicit jagt) styres af holdets ordre og er IKKE begraenset af
//     dette moduls budget. Modulet roerer den ikke.
//   - "neutral" reagerer efter holdets egen GC-interesse: ingen trussel = den
//     almindelige default (holdet jager ikke), en trussel = holdets ledige
//     hjaelpere i GC-rytterens gruppe trækker.
//   - "let_go" er passiv, med én undtagelse: en ALVORLIG GC-trussel giver en
//     begraenset, forebyggende reaktion. Den deler ÉT endeligt arbejdsbudget
//     pr. hold pr. etape paa tvaers af pauser, gentagne trusler og segmenter.
//     Stop ved inddaemmet trussel eller opbrugt budget. Ingen garanteret
//     indhentning.
//   - Hjaelpere: kun holdets ikke-ledere i GC-rytterens egen gruppe, med en
//     indsats der arbejder for holdet og kraefter tilbage. Ingen ledige
//     hjaelpere = ingen reaktion, og det siges aerligt.
//   - Arbejdet bogfoeres EN gang, med det rytterne faktisk betalte.
//
// Events (fog-gate #1791): kun kvalitative tilstande og grunde, aldrig budget,
// arbejde, vaegte eller sandsynligheder.
//
// REN: ingen IO, ingen rng, muterer intet input.

import type { Entrant, RiderState, TeamReactionMode, TeamReactionState, TimelineEvent } from "../types.ts";
import { TEAM_PLAY_EXTRA_TUNING } from "../tuning.ts";
import { helperCostMultiplier } from "./teamPlay.ts";
import type { GcThreat } from "./gcThreat.ts";

export type ReactionStance = "chase" | "neutral" | "let_go";

/**
 * START-KANDIDATER (lokal praecedens som breakaway.ts's TEAM_CHASE). Arbejdet
 * maales i samme valuta som jagtens pris: andele af rytternes team_cp_factor.
 */
export const TEAM_REACTION_TUNING = Object.freeze({
  /** Neutral: intensitet ved en moderat hhv. alvorlig trussel. */
  neutralModerateIntensity: 0.5,
  neutralSeriousIntensity: 1,
  /** Lad gaa: den forebyggende undtagelses intensitet (kun alvorlig trussel). */
  preventiveIntensity: 0.6,
  /** Lad gaa: holdets samlede forebyggende arbejdsbudget pr. etape. */
  preventiveBudget: 0.03,
  /** En hjaelper under denne friskhed (team_cp_factor) er for traet til at reagere. */
  minWorkerFreshness: TEAM_PLAY_EXTRA_TUNING.minCpFactor + 0.02,
});

/** En leder trækker ikke (samme rolle-skel som breakaway.ts's CHASE_EXEMPT_ROLES). */
const LEADER_ROLES: ReadonlySet<string> = new Set(["captain", "sprint_captain"]);

export const IDLE_TEAM_REACTION: TeamReactionState = Object.freeze({
  status: "idle",
  mode: null,
  neutral_work: 0,
  preventive_work: 0,
  reason: null,
}) as TeamReactionState;

/**
 * Holdets ledige hjaelpere i GC-rytterens gruppe: ikke-ledere fra holdet, der
 * stadig koerer, hvis indsats arbejder for holdet, og som ikke er for traette.
 * Sorteret paa rider_id (deterministisk).
 */
export function availableReactionWorkers(input: {
  teamId: string;
  groupRiderIds: readonly string[];
  entrants: Readonly<Record<string, Entrant>>;
  riders: Readonly<Record<string, RiderState>>;
  minFreshness?: number;
}): string[] {
  const minFreshness = input.minFreshness ?? TEAM_REACTION_TUNING.minWorkerFreshness;
  const out: string[] = [];
  for (const riderId of input.groupRiderIds) {
    const entrant = input.entrants[riderId];
    const rider = input.riders[riderId];
    if (!entrant || !rider || rider.status !== "racing") continue;
    if (entrant.team_id !== input.teamId) continue;
    if (LEADER_ROLES.has(entrant.role)) continue;
    if (!(helperCostMultiplier(entrant.effort) > 0)) continue;
    const factor = Number.isFinite(rider.team_cp_factor) ? (rider.team_cp_factor as number) : 1;
    if (factor < minFreshness) continue;
    out.push(riderId);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export type TeamReactionPlan = {
  /** (0, 1] naar holdet reagerer i dette segment, ellers 0. */
  intensity: number;
  mode: TeamReactionMode | null;
  /** Resterende forebyggende budget (kun meningsfuldt for mode "preventive"). */
  budgetRemaining: number;
  /** Hvorfor holdet (ikke) reagerer — samme ordforraad som eventsene. */
  reason: string;
};

/**
 * Beslutningen for ét segment, foer arbejdet er udfoert. Ren funktion af den
 * forrige tilstand, truslen, ordren og de ledige hjaelpere.
 */
export function planTeamReaction(input: {
  prior: TeamReactionState | undefined;
  threat: GcThreat;
  stance: ReactionStance;
  availableWorkers: readonly string[];
  /**
   * #5978 (KUN orders_gc_v3): snoren. Et hold der reagerer, slipper ikke, saa
   * laenge truslen siger `leash_hold` (den farlige rytter sidder der, og
   * margin er ikke naaet); det stopper kun naar hjaelperne eller budgettet er
   * brugt. Endagsloebets trussel giver ingen lad-gaa-undtagelse (ejer 30/9).
   * Udeladt = orders_gc_v1/v2, bit-identisk.
   */
  leash?: boolean;
}): TeamReactionPlan {
  const prior = input.prior ?? IDLE_TEAM_REACTION;
  const tuning = TEAM_REACTION_TUNING;
  const budgetRemaining = Math.max(0, tuning.preventiveBudget - prior.preventive_work);
  const none = (reason: string): TeamReactionPlan => ({ intensity: 0, mode: null, budgetRemaining, reason });

  // Eksplicit jagt: ordren styrer, undtagelsens budget gaelder ikke.
  if (input.stance === "chase") return none("explicit_chase");
  if (input.threat.severity === "none") {
    if (input.leash && input.threat.leash_hold === true && prior.status === "reacting" && prior.mode) {
      if (input.availableWorkers.length === 0) return none("no_workers");
      if (prior.mode === "neutral") return { intensity: tuning.neutralModerateIntensity, mode: "neutral", budgetRemaining, reason: "leash" };
      if (budgetRemaining <= 0) return none("budget_exhausted");
      return { intensity: tuning.preventiveIntensity, mode: "preventive", budgetRemaining, reason: "leash" };
    }
    return none(input.threat.reason);
  }

  if (input.stance === "neutral") {
    if (input.availableWorkers.length === 0) return none("no_workers");
    const intensity = input.threat.severity === "serious" ? tuning.neutralSeriousIntensity : tuning.neutralModerateIntensity;
    return { intensity, mode: "neutral", budgetRemaining, reason: input.threat.reason };
  }

  // #5978 (KUN orders_gc_v3): lad-gaa-undtagelsen beskytter kun klassementet.
  if (input.leash && input.threat.one_day === true) return none("let_go_one_day");
  // let_go: kun en alvorlig trussel, kun med budget tilbage, kun med hjaelpere.
  if (input.threat.severity !== "serious") return none("let_go_not_serious");
  if (prior.status === "exhausted" || budgetRemaining <= 0) return none("budget_exhausted");
  if (input.availableWorkers.length === 0) return none("no_workers");
  return { intensity: tuning.preventiveIntensity, mode: "preventive", budgetRemaining, reason: input.threat.reason };
}

/**
 * Begraens en forebyggende intensitet saa det OEVRE skoen paa segmentets pris
 * aldrig overskrider resten af budgettet. `fullIntensityCostBound` er prisen
 * hjaelperne hoejst kan betale i segmentet ved intensitet 1 (uden deling med
 * andre jaegere — den faktiske pris er altid <= den).
 */
export function capPreventiveIntensity(plan: TeamReactionPlan, fullIntensityCostBound: number): number {
  if (plan.mode !== "preventive" || !(plan.intensity > 0)) return plan.intensity;
  if (!(fullIntensityCostBound > 0)) return plan.intensity;
  return Math.max(0, Math.min(plan.intensity, plan.budgetRemaining / fullIntensityCostBound));
}

// ── #5955 (ejer-valg B 1/10, KUN orders_gc_v1): GC-bremsen i lad-gaa-fasen ──
//
// Under legacy roerer ingen ordre lad-gaa-fasen (#5812-kontrakten): hullet
// vokser mod loftet uanset hvad holdene vil. Under orders_gc_v1 maa et hold
// ved en REEL (alvorlig) GC-trussel bremse fasen og holde hullet nede:
//   - et hold hvis GC-reaktion er aktiv (neutral eller den forebyggende
//     lad-gaa-undtagelse), med de hjaelpere der allerede reagerer, og
//   - et hold med eksplicit jagtordre.
// En moderat trussel eller en jagtordre uden trussel bremser ikke: feltet
// lader stadig dagens udbrud faa sit forspring (den moderate reaktion virker
// som foer kun i jagtfasen). Op til det forspring holdet kan tolerere
// (GcThreat.tolerated_lead_seconds) vokser hullet frit; over det daempes det.
// Bremsen er arbejde: de bremsende ryttere betaler for de bremsede lad-gaa-km
// i samme valuta som jagten, og den forebyggende undtagelses budget daekker
// hele segmentet (capPreventiveIntensity), saa bremsen holder sig inden for
// det eksisterende budget pr. hold pr. etape. Bremsen er bounded (maxBrake
// < 1): et udbrud faar altid plads at vokse, og ingen indhentning er garanteret.

export const LET_GO_BRAKE_TUNING = Object.freeze({
  /** Hoejeste andel af lad-gaa-vaeksten bremsen kan fjerne (aldrig hele). */
  maxBrake: 0.3,
  /** Effektive bremse-ryttere (fuld effort, friske) der giver den fulde bremse. */
  referenceBrakers: 4,
  /**
   * #5978 (KUN orders_gc_v3): bremsens loft for AL GC-bremse i revisionen
   * (erstatter maxBrake, ogsaa ved en alvorlig trussel uden snor; breakaway.ts
   * progressChase). Under 1: et udbrud kan stadig vokse lidt, og ingen
   * indhentning er garanteret.
   * START-KANDIDAT, kalibreres privat (balance-internals/5978/).
   */
  leashMaxBrake: 0.9,
});

/** Et holds beslutning for segmentet, som bremsen laeser den (strukturel type). */
export type LetGoBrakeDecision = {
  teamId: string;
  threat: GcThreat;
  stance: ReactionStance;
  plan: Pick<TeamReactionPlan, "intensity">;
};

/**
 * Holdene der bremser lad-gaa-fasen foran `chaseGroupId`: GC-rytteren sidder i
 * den jagtgruppe, og holdet enten reagerer (plan > 0) eller har eksplicit
 * jagtordre ved en reel trussel. Vaerdien er det forspring holdet tolererer
 * (GcThreat.tolerated_lead_seconds; mangler det, 0 = ingen tolerance).
 */
export function letGoBrakingTeams(decisions: readonly LetGoBrakeDecision[], chaseGroupId: string, leash = false): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of decisions) {
    if (d.threat.chase_group_id !== chaseGroupId) continue;
    const reacting = d.plan.intensity > 0;
    // #5978 (KUN orders_gc_v3): et hold der holder snoren, bremser ogsaa.
    const leashBrake = leash && reacting && (d.threat.severity === "moderate" || d.threat.leash_hold === true);
    if (d.threat.severity !== "serious" && !leashBrake) continue;
    const threatenedChase = d.stance === "chase";
    if (!reacting && !threatenedChase) continue;
    const tolerated = d.threat.tolerated_lead_seconds;
    out.set(d.teamId, Number.isFinite(tolerated) ? Math.max(0, tolerated as number) : 0);
  }
  return out;
}

/**
 * Bremsens styrke i [0, maxBrake], de ryttere der betaler for den, og det
 * forspring bremsen holder hullet under (det mindste blandt de hold der
 * faktisk bremser). Kun ryttere fra de bremsende hold, der allerede arbejder i
 * jagtplanen (`chaserWork`: effort-vaegt, for reaktioner skaleret med
 * intensiteten), og hver taeller med sin friskhed: et traet hold bremser
 * svagere.
 */
export function letGoBrake(input: {
  chaserWork: ReadonlyMap<string, number>;
  braking: ReadonlyMap<string, number>;
  entrants: Readonly<Record<string, Entrant>>;
  riders: Readonly<Record<string, RiderState>>;
  /** #5978 (KUN orders_gc_v3): bremsens loft (LET_GO_BRAKE_TUNING.leashMaxBrake). Udeladt = maxBrake. */
  maxBrake?: number;
}): { fraction: number; work: Map<string, number>; toleratedSeconds: number } {
  const tuning = LET_GO_BRAKE_TUNING;
  const maxBrake = input.maxBrake ?? tuning.maxBrake;
  const work = new Map<string, number>();
  const none = { fraction: 0, work: new Map<string, number>(), toleratedSeconds: Infinity };
  if (input.braking.size === 0) return none;
  let pull = 0;
  let toleratedSeconds = Infinity;
  for (const riderId of [...input.chaserWork.keys()].sort((a, b) => a.localeCompare(b))) {
    const weight = input.chaserWork.get(riderId) ?? 0;
    const teamId = input.entrants[riderId]?.team_id;
    if (!(weight > 0) || typeof teamId !== "string" || !input.braking.has(teamId)) continue;
    const factor = input.riders[riderId]?.team_cp_factor;
    const freshness = Math.max(0, Math.min(1, Number.isFinite(factor) ? (factor as number) : 1));
    pull += weight * freshness;
    work.set(riderId, weight);
    toleratedSeconds = Math.min(toleratedSeconds, input.braking.get(teamId) ?? 0);
  }
  if (!(pull > 0) || !(tuning.referenceBrakers > 0)) return none;
  const fraction = maxBrake * Math.max(0, Math.min(1, pull / tuning.referenceBrakers));
  return { fraction, work, toleratedSeconds };
}

/**
 * Lad-gaa-vaeksten med bremsen: op til det tolererede forspring vokser hullet
 * frit (feltet lader et ufarligt forspring gaa), over det daempes vaeksten med
 * `fraction`. `brakedShare` er den andel af lad-gaa-km'ene der faktisk blev
 * bremset — kun dem betaler de bremsende ryttere for. Uden bremse er vaeksten
 * uaendret og andelen 0. `ceilingSeconds` er lad-gaa-loftet: vaekst over det
 * sker alligevel ikke, saa den bremses (og betales) heller ikke.
 */
export function brakedLetGoGrowth(input: {
  separationSeconds: number;
  growthSeconds: number;
  fraction: number;
  toleratedSeconds: number;
  ceilingSeconds?: number;
}): { growthSeconds: number; brakedShare: number } {
  const raw = Math.max(0, input.growthSeconds);
  const room = input.ceilingSeconds !== undefined && Number.isFinite(input.ceilingSeconds)
    ? Math.max(0, input.ceilingSeconds - input.separationSeconds)
    : raw;
  const growth = Math.min(raw, room);
  if (!(input.fraction > 0) || !(growth > 0)) return { growthSeconds: input.growthSeconds, brakedShare: 0 };
  const free = Math.max(0, Math.min(growth, input.toleratedSeconds - input.separationSeconds));
  const excess = growth - free;
  if (!(excess > 0)) return { growthSeconds: input.growthSeconds, brakedShare: 0 };
  const fraction = Math.min(1, input.fraction);
  return { growthSeconds: free + excess * (1 - fraction), brakedShare: excess / raw };
}

function reactionEvent(km: number, teamId: string, status: string, reason: string, threat: GcThreat, mode: TeamReactionMode | null): TimelineEvent {
  return {
    km,
    type: "gc_reaction",
    params: {
      team_id: teamId,
      status,
      reason,
      ...(mode ? { mode } : {}),
      ...(threat.protected_rider_id ? { protected_rider_id: threat.protected_rider_id } : {}),
      ...(threat.threat_rider_ids.length > 0 ? { rider_ids: [...threat.threat_rider_ids] } : {}),
    },
  };
}

/**
 * Fremskriver holdets reaktions-tilstand ét segment.
 *
 * @param prior          tilstanden foer segmentet (udeladt = idle)
 * @param threat         truslen mod holdets GC-rytter i dette segment
 * @param stance         holdets ordre (breakaway_stance)
 * @param availableWorkers holdets ledige hjaelpere i GC-rytterens gruppe
 * @param performedWork  det arbejde reaktionen FAKTISK kostede i segmentet
 *                       (sum af hjaelpernes betalte team_cp_factor). Bogfoeres
 *                       én gang, kumulativt, aldrig nulstillet.
 * @param plan           planen der blev brugt (default: planTeamReaction(...))
 * @returns next (ny tilstand), workers (dem der reagerede), events (aerlige
 *          kvitteringer: started/stopped/exhausted/unavailable)
 */
export function advanceTeamReaction(input: {
  prior: TeamReactionState | undefined;
  threat: GcThreat;
  stance: ReactionStance;
  availableWorkers: readonly string[];
  performedWork: number;
  teamId: string;
  km: number;
  plan?: TeamReactionPlan;
  /** #5978 (KUN orders_gc_v3): se planTeamReaction. */
  leash?: boolean;
  /**
   * #5978 (review af #5978, punkt 7, KUN med leash): etapens sidste segment.
   * En reaktion der stadig holder pause her, afsluttes aerligt.
   */
  lastSegment?: boolean;
}): { next: TeamReactionState; workers: string[]; events: TimelineEvent[] } {
  const prior = input.prior ?? IDLE_TEAM_REACTION;
  const plan = input.plan ?? planTeamReaction(input);
  const work = Number.isFinite(input.performedWork) ? Math.max(0, input.performedWork) : 0;
  const events: TimelineEvent[] = [];

  if (prior.status === "exhausted") {
    // Opbrugt er opbrugt for resten af etapen; eventuel neutral-arbejde kan
    // ikke opstaa her (planen er altid 0 for let_go efter udmattelse).
    return { next: prior, workers: [], events };
  }

  if (plan.intensity > 0 && plan.mode) {
    const neutralWork = prior.neutral_work + (plan.mode === "neutral" ? work : 0);
    const preventiveWork = prior.preventive_work + (plan.mode === "preventive" ? work : 0);
    if (prior.status !== "reacting" || prior.mode !== plan.mode) {
      events.push(reactionEvent(input.km, input.teamId, "started", plan.reason, input.threat, plan.mode));
    }
    const exhausted = plan.mode === "preventive"
      && preventiveWork >= TEAM_REACTION_TUNING.preventiveBudget - 1e-12;
    if (exhausted) {
      events.push(reactionEvent(input.km, input.teamId, "exhausted", "budget_exhausted", input.threat, plan.mode));
    }
    return {
      next: {
        status: exhausted ? "exhausted" : "reacting",
        mode: plan.mode,
        neutral_work: neutralWork,
        preventive_work: preventiveWork,
        reason: exhausted ? "budget_exhausted" : plan.reason,
      },
      workers: [...input.availableWorkers],
      events,
    };
  }

  // Ingen reaktion i dette segment.
  if (prior.status === "reacting" && input.leash === true && input.threat.reason === "protected_in_other_group") {
    // #5978 (KUN orders_gc_v3): holdets GC-rytter sidder et oejeblik i en anden
    // gruppe end jagtgruppen (fx bag en lille gruppe). Holdet kan ikke jage
    // derfra, men truslen er ikke under kontrol: reaktionen holder pause uden
    // at stoppe (ingen arbejde, intet event), og fortsaetter naar han er tilbage.
    // Review af #5978, punkt 7: varer pausen etapen ud, afsluttes reaktionen paa
    // sidste segment, saa filmen aldrig viser "starter" uden "stopper".
    if (input.lastSegment !== true) return { next: prior, workers: [], events };
    const reason = input.threat.reason;
    events.push(reactionEvent(input.km, input.teamId, "stopped", reason, input.threat, prior.mode));
    return { next: { ...prior, status: "idle", reason }, workers: [], events };
  }
  if (prior.status === "reacting") {
    // #6187 (KUN orders_gc_v3): truslen sidder nu sammen med holdets egen mand.
    // Det er ikke "under kontrol"; holdet jager bare ikke sine egne.
    // #5978 (KUN orders_gc_v3): mens snoren holder, er truslen ikke "under
    // kontrol"; holdet stopper kun fordi hjaelperne eller budgettet er brugt.
    const leashHeld = input.threat.severity === "none" && input.threat.leash_hold === true
      && (plan.reason === "no_workers" || plan.reason === "budget_exhausted");
    const reason = leashHeld
      ? plan.reason
      : input.threat.severity === "none" ? (input.threat.reason === "own_rider_ahead" ? "own_rider_ahead" : "contained") : plan.reason;
    events.push(reactionEvent(input.km, input.teamId, "stopped", reason, input.threat, prior.mode));
    return { next: { ...prior, status: "idle", reason }, workers: [], events };
  }
  if (plan.reason === "no_workers" && prior.reason !== "no_workers") {
    // Truslen er reel, men ingen kan reagere: sig det, én gang pr. tilstand.
    events.push(reactionEvent(input.km, input.teamId, "unavailable", "no_workers", input.threat, null));
    return { next: { ...prior, reason: "no_workers" }, workers: [], events };
  }
  if (plan.reason === "budget_exhausted" && prior.reason !== "budget_exhausted") {
    events.push(reactionEvent(input.km, input.teamId, "exhausted", "budget_exhausted", input.threat, "preventive"));
    return { next: { ...prior, status: "exhausted", reason: "budget_exhausted" }, workers: [], events };
  }
  // En "no_workers"-tilstand ophoerer naar truslen gaar over; en senere mangel
  // kvitteres saa igen.
  const reason = prior.reason === "no_workers" ? null : prior.reason;
  return { next: reason === prior.reason ? prior : { ...prior, reason }, workers: [], events };
}
