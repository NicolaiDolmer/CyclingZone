// backend/lib/engine/v4/mechanics/breakawayV3_6804.ts
// #6804 (KUN s5_profiles_v3, SLUKKET): udbrudspakken trin 2, ét trin ad gangen.
// Spec docs/superpowers/specs/2026-10-21-6804-udbrud-pr-loebsgruppe-design.md og
// 2026-10-17-6804-hilly-breakaway-design.md. Reglerne: docs/RACE_ENGINE_RULES.md.
//
// P1 "slank B" (ejer 18/10, B): jagten paa kuperet i etapeloeb.
//   1. Finalevaegten (etapeinteressen i stageWinChaseForceV3) ganges med en faktor pr.
//      afslutning, saa en kuperet etape med spurt jages mindre end en flad massespurt.
//      Ordenen i udbruddets favoer (spurt < bakke/mur < nedkoersel, K2) bevares.
//   2. Jagten foer finalestigningen er daempet (bjergets knap); en GC-reaktion jager
//      stadig uden daempning (breakaway.ts, uaendret).
//   3. Lavere lad-gaa-loft.
// Endagsloeb roeres ikke (de vinder allerede for ofte paa kuperet; G14). Ingen ny
// tilfaeldighed: alle tre knapper flytter kun eksisterende jagt-led.
//
// P6 (ejer-beslutning 4 = A): klassementskontrol paa snor, se afsnittet nedenfor.
//
// REN: ingen IO, ingen rng. Alle aeldre revisioner (ctx.s5ProfilesV3 udeladt) faar
// de neutrale vaerdier (faktor 1 / undefined), saa de er byte-identiske.

import type { FinaleType, GcContext, ProfileType } from "../types.ts";
import { S5_V3_BREAKAWAY_TUNING } from "../tuning.ts";

/** Etapeloeb (ikke endagsloeb): klassementet findes eller loebet er paa sin foerste etape. */
export function isStageRaceGcContext(gcContext: GcContext | null | undefined): boolean {
  return gcContext?.status === "standings" || gcContext?.status === "first_stage";
}

/** P1 gaelder: v3, kuperet profil og et etapeloeb. */
export function s5V3HillyChaseApplies(input: { s5ProfilesV3?: boolean; profileType: ProfileType; gcContext: GcContext | null | undefined }): boolean {
  return input.s5ProfilesV3 === true
    && S5_V3_BREAKAWAY_TUNING.p1.hillyProfiles.includes(input.profileType)
    && isStageRaceGcContext(input.gcContext);
}

/** P1.1: faktoren paa finalevaegten (1 = uaendret, fx nedkoersel og alt uden for P1). */
export function s5V3FinaleWeightScale(applies: boolean, finaleType: FinaleType | null | undefined): number {
  if (!applies || !finaleType) return 1;
  const f = S5_V3_BREAKAWAY_TUNING.p1.finaleWeightFactorByFinale[finaleType];
  return Number.isFinite(f) && (f as number) > 0 ? (f as number) : 1;
}

/** P1.2: jagtens lukning foer finalestigningen paa kuperet (undefined = profilens egen knap). */
export function s5V3PreFinalChaseClosingScale(applies: boolean): number | undefined {
  return applies ? S5_V3_BREAKAWAY_TUNING.p1.preFinalChaseClosingScale : undefined;
}

/** P1.3: faktoren paa lad-gaa-loftet (1 = uaendret). */
export function s5V3LetGoMaxGapScale(applies: boolean): number {
  return applies ? S5_V3_BREAKAWAY_TUNING.p1.letGoMaxGapScale : 1;
}

// ── P6 (ejer-beslutning 4 = A, 21/10): klassementskontrol paa snor ───────────
//   1. Kontrol: foer finalen holder en reagerende klassementsjagt forspringet paa det
//      holdet tolererer (snoren, #5978) i stedet for at hente; finalen henter, og en snor
//      under den mindste laengde er brudt (der hentes). Kun i etapeloeb (breakaway.ts).
//   2. Den fremskrevne gevinst paa resten af etapen vaegtes efter resterende distance.
//   3. "Noget at forsvare" i korte etapeloeb kraever en reel klassementschance.
//   4. En udbryder uden klassementsevne er ingen trussel, heller ikke mod troejen;
//      klassementets forreste (rivalRankAlways) er det stadig altid (gcThreat.ts).

/** P6.2: vaegten paa den fremskrevne gevinst med `remainingKm` tilbage, i [gulv, 1]; 1 i finalen. */
export function s5V3ProjectionWeight(remainingKm: number): number {
  const t = S5_V3_BREAKAWAY_TUNING.p6;
  if (!(Number.isFinite(remainingKm) && remainingKm > t.projectionFullKm)) return 1;
  return Math.max(t.projectionMinWeight, Math.min(1, t.projectionFullKm / remainingKm));
}

/**
 * P6.3: et kort etapeloeb (hoejst shortRaceMaxStages etaper). Antallet er dagens etape plus
 * etaperne tilbage efter i dag (broen), ellers loebets etaper (race_gc_stages). Ukendt = nej
 * (saa gaelder revisionens almindelige regel).
 */
export function s5V3IsShortStageRace(gc: GcContext | null | undefined): boolean {
  if (!gc || gc.status !== "standings") return false;
  const max = S5_V3_BREAKAWAY_TUNING.p6.shortRaceMaxStages;
  const remaining = Number(gc.stages_remaining);
  if (gc.stages_remaining !== undefined && Number.isInteger(remaining) && remaining >= 0) return gc.stage_number + remaining <= max;
  const stages = gc.race_gc_stages;
  return Array.isArray(stages) && stages.length > 0 && stages.length <= max;
}

/** P6.3: plads paa klassementsevne et hold i et kort etapeloeb hoejst maa have for at forsvare. */
export function s5V3ContenderAbilityRank(): number {
  return S5_V3_BREAKAWAY_TUNING.p6.contenderAbilityRank;
}

/** P6.1: ligger segmentets slutning i finalen (de sidste controlFinaleKm), hvor der hentes? */
export function s5V3InControlFinale(distanceKm: number, toKm: number): boolean {
  if (!(Number.isFinite(distanceKm) && distanceKm > 0)) return true;
  return distanceKm - toKm <= S5_V3_BREAKAWAY_TUNING.p6.controlFinaleKm;
}

/**
 * P6.1: snoren jagten holder udbruddet paa: det mindste forspring de reagerende hold
 * tolererer. null = ingen kontrol: ingen tolerance at holde, eller snoren er brudt
 * (kortere end minLeashSeconds), saa der hentes.
 */
export function s5V3ControlTargetSeconds(toleratedSeconds: readonly (number | undefined)[]): number | null {
  const finite = toleratedSeconds.filter((s): s is number => typeof s === "number" && Number.isFinite(s));
  if (finite.length === 0) return null;
  const target = Math.max(0, Math.min(...finite));
  return target >= S5_V3_BREAKAWAY_TUNING.p6.minLeashSeconds ? target : null;
}

/**
 * P6.1: jagtens lukning under kontrol. Uden reaktionerne lukker feltet `baseClosing`
 * (fx en etapeinteresse); reaktionernes ekstra lukning (op til `fullClosing`) maa kun
 * bringe forspringet ned til snoren, aldrig under. Aldrig mere end uden kontrol.
 */
export function s5V3ControlledClosing(input: { fullClosing: number; baseClosing: number; gapSeconds: number; targetSeconds: number }): number {
  const full = Math.max(0, input.fullClosing);
  const base = Math.min(full, Math.max(0, input.baseClosing));
  const room = Math.max(0, input.gapSeconds - input.targetSeconds);
  return Math.max(base, Math.min(full, room));
}

// ── P2 (#6912, K3, byg-go 21/10): realistisk forspring ───────────────────────
//   Ikke en klemme paa uret, men feltets adfaerd: naar forspringet naar det feltet
//   tolererer pr. profil, slutter lad-gaa-fasen, og jagten tager over hos de hold der har
//   interesse. Interesse = positiv etapeinteresse (`interestByTeam` fra
//   stageWinChaseForceV3) ELLER et positivt ordre-/klassementssignal (`teamSignals`; "lad
//   gaa" er negativt og taeller ikke). Kun naar INGEN hold har interesse, kan forspringet
//   vokse til den sjaeldne oevre zone, og aldrig over den. Kun i etapeloeb (endagsloeb har
//   deres eget loft, #6428) og kun paa profiler med etapeinteressen (chaseV3).
//   Automatisk jagt baerer arbejde: et interesseret hold uden ordre/reaktion skriver sine
//   jagt-rytteres arbejde i work-mappen (traethed + "hvem jagede" i filmen). Lukkekraften er
//   uaendret (interessen), saa intet taelles dobbelt.

/** P2 gaelder: v3, et etapeloeb og en profil med etapeinteressen (chaseV3). */
export function s5V3RealisticLeadApplies(input: { s5ProfilesV3?: boolean; chaseV3: boolean; gcContext: GcContext | null | undefined }): boolean {
  return input.s5ProfilesV3 === true && input.chaseV3 && isStageRaceGcContext(input.gcContext);
}

/** P2: de hold (sorteret) der har jagt-interesse i dette udbrud; udelukkede hold (egne foran, #6187) aldrig. */
export function s5V3InterestedTeamIds(input: {
  interestByTeam: ReadonlyMap<string, number>;
  teamSignals?: ReadonlyMap<string, number>;
  excludedTeamIds?: ReadonlySet<string>;
}): string[] {
  const ids = new Set<string>();
  for (const [teamId, interest] of input.interestByTeam) if (interest > 0) ids.add(teamId);
  for (const [teamId, signal] of input.teamSignals ?? []) if (Math.max(0, signal) > 0) ids.add(teamId);
  return [...ids].filter((id) => !input.excludedTeamIds?.has(id)).sort((a, b) => a.localeCompare(b));
}

/** P2: lad-gaa-loftet feltet tolererer: mellemzonen med interesse, ellers den oevre zone. */
export function s5V3RealisticLeadCeilingSeconds(profileType: ProfileType, interested: boolean): number {
  const t = S5_V3_BREAKAWAY_TUNING.p2;
  if (!interested) return t.unchasedLeadSeconds;
  const ov = process.env.CZ_P2 ? JSON.parse(process.env.CZ_P2) : null;
  if (ov && ov[profileType] != null) return ov[profileType];
  return t.interestedLeadSecondsByProfile[profileType] ?? t.interestedLeadSecondsDefault;
}

/**
 * P2: arbejds-intensiteten (0..1) for et holds automatiske jagt: interessen maalt mod en
 * fuld ordre (`fullOrderForce`), ganget med autoChaseWorkScale. 0 uden interesse.
 */
export function s5V3AutoChaseIntensity(teamInterest: number, fullOrderForce: number): number {
  if (!(teamInterest > 0) || !(fullOrderForce > 0)) return 0;
  return Math.max(0, Math.min(1, (teamInterest / fullOrderForce) * S5_V3_BREAKAWAY_TUNING.p2.autoChaseWorkScale));
}

// ── P2.4 klatre-jagten (design 2026-10-23-6804-v3-climb-chase-design.md) ─────────────────
// Kun hvor P2 gaelder, kun paa en stigning og kun naar lad-gaa-fasen er slut for udbruddet.
// Hold med effektiv interesse (interesse OG koerende ryttere i jagtgruppen) holder forspringet
// paa snoren med deres klatrere: en kontrol, aldrig en hentning, og aldrig oveni den
// almindelige lukning. Uden effektiv interesse klemmes intet, og filmen faar en aarsag.

/** P2.4 gaelder paa dette segment: P2 gaelder, segmentet er en stigning, og lad-gaa-fasen er slut. */
export function s5V3ClimbChaseApplies(input: { p2Lead: boolean; segmentKind: string; letGoKm: number; chaseKm: number }): boolean {
  if (String(process.env.CZ_ABL ?? "").includes("climb")) return false;
  return input.p2Lead && S5_V3_BREAKAWAY_TUNING.p2.climbChaseSegmentKinds.includes(input.segmentKind) && !(input.letGoKm > 0) && input.chaseKm > 0;
}

/** P2.4: klatre-jagtens snor for profilen. */
export function s5V3ClimbChaseLeashSeconds(profileType: ProfileType): number {
  const t = S5_V3_BREAKAWAY_TUNING.p2;
  return t.climbChaseLeadSecondsByProfile[profileType] ?? t.climbChaseLeadSecondsDefault;
}

/**
 * P2.4: segmentets lukning med klatre-jagten. Den almindelige lukning gaelder som foer; ligger
 * forspringet efter den stadig over snoren, lukker klatre-jagten resten ned TIL snoren (aldrig
 * under). `extra` er den del klatre-jagten selv bar (0 = den almindelige lukning var nok).
 */
export function s5V3ClimbChaseClosing(input: { grownSeconds: number; baseClosingSeconds: number; leashSeconds: number }): { closing: number; extra: number } {
  const base = Math.max(0, input.baseClosingSeconds);
  const needed = input.grownSeconds - input.leashSeconds;
  if (!(needed > base)) return { closing: base, extra: 0 };
  return { closing: needed, extra: needed - base };
}

/** P2.4: arbejds-intensiteten (0..1) for den lukning klatre-jagten bar, maalt mod en fuld ordre. */
export function s5V3ClimbChaseIntensity(input: { extraClosingSeconds: number; chaseKm: number; closingSecondsPerKmPerUnit: number; fullOrderForce: number; teams: number }): number {
  const perUnit = input.chaseKm * input.closingSecondsPerKmPerUnit;
  if (!(input.extraClosingSeconds > 0) || !(perUnit > 0) || !(input.fullOrderForce > 0) || !(input.teams > 0)) return 0;
  const advantage = input.extraClosingSeconds / perUnit / input.teams;
  return Math.max(0, Math.min(1, (advantage / input.fullOrderForce) * S5_V3_BREAKAWAY_TUNING.p2.climbChaseWorkScale));
}
