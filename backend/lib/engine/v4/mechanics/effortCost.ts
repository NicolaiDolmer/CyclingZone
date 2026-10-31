// backend/lib/engine/v4/mechanics/effortCost.ts
// Race Engine v4 F3 (#4030 M12): effort-styring (protect/normal/save fra
// TeamOrder/Entrant.effort) modulerer work-cost/W'-forbrug i fysiologi-ticket.
// SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md
// §4 M12 ("Effort-styring pr. rytter pr. etape") + §8 beslutning 14 (fuld
// effort-pakke fra start).
//
// REN — ingen import fra oevrigt backend, ingen IO/Date/Math.random (ingen rng
// overhovedet: effort-modulationen er et rent taerskel-lookup, ikke stoej).
//
// Kontrakt (opgave-brief): "effortFatigueMultiplier-moensteret fra
// backend/lib/raceRoles.js genimplementeres RENT i v4 (laes raceRoles.js
// foerst, kopier ikke - genimplementer som ren funktion)." raceRoles.js's
// effortFatigueMultiplier(effort) returnerer RACE_V3_TUNING's
// FATIGUE_MULTIPLIER_PROTECT/_SAVE/_NORMAL (1.2/0.7/1.0) — protect (arbejder
// FOR holdet: leadout, tempo-traek, beskytter kaptajnen) koster ekstra
// belastning, save (koerer inden for sig selv) koster mindre, normal er
// uaendret. v4-genimplementeringen ANKRER paa DE SAMME tre startvaerdier
// (samme kalibrerings-praecedens: v3-tallene er allerede spillet ind mod
// virkelige etaper), som `tuning.ts`'s EFFORT_COST_EXTRA_TUNING (additiv
// tuning-flade, samme moenster som FINALE_EXTRA_TUNING) — v4 importerer
// ALDRIG raceRoles.js (renheds-graensen).
//
// WIRET 6/9 (#4632, ejer-beslutning model C). segmentLoop.ts's
// `tickGroupRiders` beregner `demand = groupDemand * positionFactor`
// (positionFactor = front-/draftFactor fra tuning.work) og kalder
// `applyEffortToDemand(demand, entrant.effort)` FOER
// physiology.tickPhysiologyOverSegment. Dermed braender en 'protect'-rytter
// W' hurtigere/krydser CP oftere (betaler for holdarbejdet), en 'save'-rytter
// langsommere, 'all_out' haardest og 'grupetto' mindst. Modulationen sidder
// paa KRAVET og aldrig paa CP'en (M7/M11/M16's plads): CP er hvad rytteren kan
// baere i dag, kravet er hvad han vaelger at lave — se segmentLoop.ts's
// M12-blok for hele begrundelsen.
//
// En startliste hvor ALLE er 'normal' (fixtures, harness-default) koerer
// bit-uaendret: normal-multiplikatoren er praecis 1.0.
//
// #4914 (kalibreringspakken, punkt M12): all_out var GRATIS paa flade etaper.
// Terraenets krav er en andel af gruppens tempo, og den andel er lav paa fladt
// (feltet ruller i lae), saa én faelles all_out-multiplikator loeftede aldrig
// kravet over CP dér — mens den samme multiplikator paa en bjergetape var en
// stor arm. All_out-multiplikatoren er derfor TERRAEN-afhaengig. De fire andre
// trin er terraen-uafhaengige som foer.
//
// #5580 (spec motor runde 2, M1 punkt 4): opslaget skiftede fra etapens
// `profile_type` til SEGMENTETS `kind` (`demandMultiplierAllOutBySegmentKind`).
// "all_out-prisen foelger terraenet under hjulene" (ejer 23/9 valg 1c): en
// stigning paa en flad etape koster som en stigning, og en flad dal paa en
// bjergetape koster som fladt. Segment-terraener der ikke staar i tabellen
// beholder den faelles vaerdi, saa bjerg-armen er uroert.

//
// #6641 (KUN s5_profiles_v3, slukket): de fem trin har egne priser under v3, og
// climbGapEffortFactor nedenfor lader indsatsen virke paa hullet paa stigningen.
// Ordenen grupetto < save < normal < protect < all_out og all_out-tabellen pr.
// segment-terraen er uaendrede. Alle aeldre revisioner beholder
// EFFORT_COST_EXTRA_TUNING bit-identisk. Retningerne er laast i effortCost.test.ts,
// segmentLoop.effortCost.test.ts og backend/scripts/dev/effortLevels6641.test.mjs;
// maalinger og begrundelser er private (hard rule 17, balance-internals/6641/).

import type { EffortLevel, SegmentKind } from "../types.ts";
import { EFFORT_COST_EXTRA_TUNING, RACE_V4_TUNING } from "../tuning.ts";
import { isS5ProfilesV3OrLater } from "../../../raceEngineRulesRevision.ts";

/**
 * Tuning-formen EFFORT_COST_EXTRA_TUNING (tuning.ts) implementerer. Holdt her
 * (ikke i types.ts, som er frosset og kun aendres af arkitekten) saa
 * funktionerne nedenfor har en navngiven, testbar parameter-type.
 */
export type EffortCostTuning = {
  demandMultiplierGrupetto: number; // <save: koerer med, gaar ikke efter noget (#4632, raceRoles FATIGUE_MULTIPLIER_GRUPETTO-anker)
  demandMultiplierProtect: number; // >1: beskytter/traekker for holdet koster ekstra effekt-krav (raceRoles FATIGUE_MULTIPLIER_PROTECT-anker)
  demandMultiplierNormal: number; // =1: baseline, ingen modulation
  demandMultiplierSave: number; // <1: koerer bevidst inden for sig selv (raceRoles FATIGUE_MULTIPLIER_SAVE-anker)
  demandMultiplierAllOut: number; // >protect: alt ud (#4632, raceRoles FATIGUE_MULTIPLIER_ALL_OUT-anker) — faelles vaerdi for segment-terraener uden egen raekke nedenfor
  // #4914 -> #5580: all_out pr. SEGMENT-terraen. Valgfri: en tuning uden
  // tabellen (aeldre tests, harness-overrides) falder tilbage paa den faelles
  // vaerdi ovenfor.
  demandMultiplierAllOutBySegmentKind?: Readonly<Partial<Record<SegmentKind, number>>>;
  // #7280 (kun den slukkede pakke): tabellens gulv. Udeladt = protect-trinnet (strengt over).
  demandMultiplierAllOutFloor?: number;
};

export { EFFORT_COST_EXTRA_TUNING as EFFORT_COST_TUNING };

// #6641: den kalibrerede all_out-vaerdi op ad en stigning. Flade og rullende
// segmenter afledes som foer (#4914): samme andel af gruppens tempo som
// stigningen giver, regnet af terraenernes baseDemand.
const CALIBRATED_ALL_OUT_6641 = 1.11;
function calibratedAllOutMatchingClimb(kind: SegmentKind): number {
  const demand = RACE_V4_TUNING.terrain.baseDemand;
  return CALIBRATED_ALL_OUT_6641 * (demand.climb / demand[kind]);
}

/** #6641: de fem trins pris under s5_profiles_v3 (deep-frosset). Se filhovedet. */
export const EFFORT_COST_TUNING_6641: Readonly<EffortCostTuning> = Object.freeze({
  demandMultiplierGrupetto: 0.5,
  demandMultiplierSave: 0.9,
  demandMultiplierNormal: 1.0,
  demandMultiplierProtect: 1.05,
  demandMultiplierAllOut: CALIBRATED_ALL_OUT_6641,
  demandMultiplierAllOutBySegmentKind: Object.freeze({
    flat: calibratedAllOutMatchingClimb("flat"),
    rolling: calibratedAllOutMatchingClimb("rolling"),
  }) as Readonly<Partial<Record<SegmentKind, number>>>,
});

// #6641/#7280 (SLUKKET, ejer-go kraeves foer taend): Alt ud efter ejerens design 27/10
// (spec docs/superpowers/specs/2026-10-27-6641-alt-ud-design.md). s5_profiles_v3 er
// den AKTUELLE revision (#7237), saa pakken kan ikke ligge bag revisionen alene;
// slukket er motoren bit-identisk med main. Taend = ejerens ordrette go i en egen PR.
//   1+2. Gevinsten: paa den afgoerende stigning (allOutCrack6641.ts), i finalen
//        (effortFinaleTerm, uaendret) og i enkeltstarten (allOutTimeTrialBonus7280).
//        Paa transport-terraen koerer alt ud som normal: ingen pris, ingen gevinst.
//   3.   Prisen: traethed der hober sig op (conditionModelV2.stageLoadV2).
//   4.   Knaek: med lav reserve kan rytteren blive sat paa den afgoerende stigning.
//   5.   Motor-events all_out_gain / all_out_cracked (kun det motoren faktisk gjorde).
export const ALL_OUT_7280_ACTIVE: boolean = true; // ejer-go 27/10 ("Ja, taend foer 11"), #6641

/** Knapperne bag pakken (balance, hard rule 17: maalinger kun i balance-internals/). */
export type AllOut7280Tuning = {
  transportDemand: number; // all_out-kravet paa flad/rullende/nedkoersel (1 = som normal)
  climbDemand: number; // all_out-kravet op ad en stigning og paa brosten
  gainLoss: number; // relativt tab taget af hullet paa den afgoerende stigning ved fuld evne og reserve
  levelPower: number; // evne-vaegt: (1 - underskud til gruppens bedste) ^ levelPower
  reserveWprimeWeight: number; // W'-andelens vaegt i reserven (resten er dagens friskhed alene)
  crackReserve: number; // under denne reserve (0-1) vokser risikoen for at knaekke
  crackMaxProbability: number; // risikoen over hele den afgoerende stigning ved tom reserve
  crackLoss: number; // relativt tab lagt OVEN I hullet naar rytteren knaekker
  fatigueLoad: number; // condition v2: alt ud-dagens belastnings-faktor (ogsaa i enkeltstart)
  timeTrialGain: number; // enkeltstart: tillaeg til kapaciteten (evne-enheder, som dagsformen) ved evne 99
};

export const ALL_OUT_7280_TUNING: Readonly<AllOut7280Tuning> = Object.freeze({
  transportDemand: 1.0,
  climbDemand: 1.0,
  gainLoss: 0.25,
  levelPower: 3,
  reserveWprimeWeight: 0.3,
  crackReserve: 0.7,
  crackMaxProbability: 1.0,
  crackLoss: 0.15,
  fatigueLoad: 2.0,
  timeTrialGain: 0.15,
});

// Kun dev-benches (effortLevels6641.mjs, tacticsEffects7266.mjs) maaler med kontakten
// taendt og med kandidat-knapper. Produktionskode kalder aldrig setteren.
let benchOverride7280: { active: boolean; tuning: Readonly<AllOut7280Tuning> } | null = null;
/** KUN dev-benches: taend/sluk pakken og saet kandidat-knapper. `null` nulstiller. */
export function setAllOut7280ForBench(override: { active: boolean; tuning?: Partial<AllOut7280Tuning> } | null): void {
  benchOverride7280 = override ? { active: override.active === true, tuning: Object.freeze({ ...ALL_OUT_7280_TUNING, ...(override.tuning ?? {}) }) } : null;
}
/** Er pakken taendt (kontakten, eller en dev-bench)? Gaelder kun under s5_profiles_v3. */
export function allOut7280Active(): boolean {
  return benchOverride7280 ? benchOverride7280.active : ALL_OUT_7280_ACTIVE;
}
/** Knapperne der gaelder lige nu. */
export function allOut7280Tuning(): Readonly<AllOut7280Tuning> {
  return benchOverride7280?.tuning ?? ALL_OUT_7280_TUNING;
}
/** Er pakken i kraft for et loeb paa `revision`? */
export function isAllOut7280On(revision: unknown): boolean {
  return allOut7280Active() && isS5ProfilesV3OrLater(revision);
}

/**
 * #7280 (slukket): de fem trins pris under s5_profiles_v3 med kontakten taendt. De
 * fire andre trin er praecis #6641's. all_out koerer som normal paa transport-
 * terraenet (ejer 27/10 punkt 2: naesten intet paa flade transportstraekninger) og
 * betaler sin pris i traetheden bagefter (punkt 3), ikke i reserven undervejs.
 */
export function effortCostTuning7280(t: Readonly<AllOut7280Tuning> = allOut7280Tuning()): EffortCostTuning {
  return {
    demandMultiplierGrupetto: EFFORT_COST_TUNING_6641.demandMultiplierGrupetto,
    demandMultiplierSave: EFFORT_COST_TUNING_6641.demandMultiplierSave,
    demandMultiplierNormal: EFFORT_COST_TUNING_6641.demandMultiplierNormal,
    demandMultiplierProtect: EFFORT_COST_TUNING_6641.demandMultiplierProtect,
    demandMultiplierAllOut: t.climbDemand,
    demandMultiplierAllOutBySegmentKind: { flat: t.transportDemand, rolling: t.transportDemand, descent: t.transportDemand },
    demandMultiplierAllOutFloor: EFFORT_COST_TUNING_6641.demandMultiplierNormal,
  };
}

/**
 * #7280 (slukket): enkeltstartens gevinst. Kapaciteten faar timeTrialGain x
 * (evne/99) lagt til (som dagsformen): alle vinder, mest de staerke (ejer 27/10 punkt 1). 0 for alle andre trin,
 * og naar pakken ikke er i kraft (bit-identisk).
 */
export function allOutTimeTrialBonus7280(effort: EffortLevel | undefined, timeTrialAbility: number, on: boolean): number {
  if (!on || effort !== "all_out") return 0;
  const level = Number.isFinite(timeTrialAbility) ? Math.max(0, Math.min(99, timeTrialAbility)) / 99 : 0;
  return allOut7280Tuning().timeTrialGain * level;
}

// #7332 (TAENDT 31/10 paa ejerens go; ejer-beslutning 31/10 valg A): 'Spar' paa en
// ENKELTSTART (itt, itt_hilly; ikke ttt) koster tid og sparer traethed, som i virkeligheden.
// 'Beskyt' og 'grupetto' koerer som 'spar' mod uret (der er intet hold at beskytte og ingen
// grupetto). Normal og Alt ud er uaendrede. Kun under s5_profiles_v3 (isSaveItt7332On).
//   Tid:      kapaciteten faar et fradrag, der vokser med tidskoersels-evnen (spejl af
//             allOutTimeTrialBonus7280), og kravet regnes som 'spar' (individualTimeTrial.ts).
//   Traethed: belastningen faar spar-rabatten fra en FLAD etape (conditionModelV2.stageLoadV2).
// Slukket er motor og traethed bit-identiske med main foer #7332.
export const SAVE_ITT_7332_ACTIVE: boolean = true; // ejer-go 31/10, #7332

/** Knappen bag pakken (balance, hard rule 17: maalinger kun i balance-internals/). */
export type SaveItt7332Tuning = {
  saveTimeTrialLoss: number; // enkeltstart: knappen for fradraget i kapaciteten (evne-enheder, som dagsformen)
};

export const SAVE_ITT_7332_TUNING: Readonly<SaveItt7332Tuning> = Object.freeze({
  saveTimeTrialLoss: 0.15,
});

/** Trinnene der koerer som 'spar' paa en enkeltstart, naar pakken er i kraft. */
export const SAVE_ITT_7332_EFFORTS: ReadonlySet<EffortLevel> = new Set<EffortLevel>(["save", "protect", "grupetto"]);

// Kun tests og dev-benches maaler med kontakten taendt og med kandidat-knapper.
// Produktionskode kalder aldrig setteren.
let benchOverride7332: { active: boolean; tuning: Readonly<SaveItt7332Tuning> } | null = null;
/** KUN tests/dev-benches: taend/sluk #7332 og saet kandidat-knapper. `null` nulstiller. */
export function setSaveItt7332ForBench(override: { active: boolean; tuning?: Partial<SaveItt7332Tuning> } | null): void {
  benchOverride7332 = override ? { active: override.active === true, tuning: Object.freeze({ ...SAVE_ITT_7332_TUNING, ...(override.tuning ?? {}) }) } : null;
}
/** Er #7332 taendt (kontakten, eller en dev-bench)? Gaelder kun under s5_profiles_v3. */
export function saveItt7332Active(): boolean {
  return benchOverride7332 ? benchOverride7332.active : SAVE_ITT_7332_ACTIVE;
}
/** Knappen der gaelder lige nu. */
export function saveItt7332Tuning(): Readonly<SaveItt7332Tuning> {
  return benchOverride7332?.tuning ?? SAVE_ITT_7332_TUNING;
}
/** Er #7332 i kraft for et loeb paa `revision`? */
export function isSaveItt7332On(revision: unknown): boolean {
  return saveItt7332Active() && isS5ProfilesV3OrLater(revision);
}
/** Koerer `effort` som 'spar' paa en enkeltstart, naar pakken er i kraft (`on`)? */
export function isSaveItt7332Effort(effort: EffortLevel | undefined, on: boolean): boolean {
  return on && effort !== undefined && SAVE_ITT_7332_EFFORTS.has(effort);
}

/**
 * #7332 (slukket): enkeltstartens pris for 'spar' (og 'beskyt'/'grupetto'). Kapaciteten
 * faar et fradrag, der vokser med tidskoersels-evnen, i samme enheder som alt ud's gevinst.
 * 0 for normal og alt ud, og naar pakken ikke er i kraft (bit-identisk).
 */
export function saveTimeTrialPenalty7332(effort: EffortLevel | undefined, timeTrialAbility: number, on: boolean): number {
  if (!isSaveItt7332Effort(effort, on)) return 0;
  const level = Number.isFinite(timeTrialAbility) ? Math.max(0, Math.min(99, timeTrialAbility)) / 99 : 0;
  return saveItt7332Tuning().saveTimeTrialLoss * level;
}

/** #6641: revisionen der baerer kalibreringen (s5_profiles_v3 og senere, slukket). */
export function isEffortCalibration6641Revision(revision: unknown): boolean {
  return isS5ProfilesV3OrLater(revision);
}

/**
 * #6641 (ejer 25/10, "som i virkeligheden", KUN s5_profiles_v3, slukket): GEVINSTEN
 * paa den afgoerende stigning. Under tidsmodellen fra official_times-linjen afgoeres
 * hullet paa en topankomst af rytterens eget underskud (evne + reserve,
 * timeModel.climbSplitGapSeconds), ikke af split-scoren, saa stignings-lettelsen fra
 * #5580 (climbScoreRelief x rest-reserve) naaede aldrig hullet: en hoejere indsats
 * kunne kun koste. Her ganges den SAMME faktor paa underskuddet bag hullet (#7280,
 * slukket: all_out faar i stedet sin gevinst i sekunder, allOutCrack6641.ts): all_out
 * graver dybere og taber mindre tid paa dagen (betalt med reserven undervejs og
 * traetheden bagefter), save giver slip og taber lidt. Normal er praecis 1.
 * Kaldes med hook-kontekstens s5ProfilesV3-flag (sat af segmentLoop via
 * isS5ProfilesV3OrLater). Alle aeldre revisioner: 1 (bit-identisk).
 */
export function climbGapEffortFactor(s5ProfilesV3: boolean, effortScoreFactor: number): number {
  if (s5ProfilesV3 !== true || !Number.isFinite(effortScoreFactor)) return 1;
  return Math.max(0, effortScoreFactor);
}

/**
 * #6641: prisen for et loeb bundet til `revision`. Aeldre revisioner: uaendret tuning.
 * #7280: `allOut7280` (default kontakten, slukket) vaelger #7280-prisen under
 * s5_profiles_v3; parameteren findes kun saa testene kan laase begge.
 */
export function effortCostTuningFor(revision: unknown, allOut7280: boolean = allOut7280Active()): EffortCostTuning {
  if (!isEffortCalibration6641Revision(revision)) return EFFORT_COST_EXTRA_TUNING;
  return allOut7280 ? effortCostTuning7280() : EFFORT_COST_TUNING_6641;
}

/**
 * all_out-multiplikatoren for et givet segment-terraen (#4914, #5580).
 * Terraener uden egen raekke (og et manglende/ukendt navn) faar den faelles
 * `demandMultiplierAllOut`. En tabel-vaerdi der IKKE er et endeligt tal over
 * protect-trinnet ignoreres forsvarsmaessigt: all_out maa aldrig blive billigere
 * end protect (femtrins-ordenen, #4632), heller ikke ved en tastefejl i tabellen.
 */
export function allOutDemandMultiplier(
  segmentKind: SegmentKind | null | undefined,
  tuning: EffortCostTuning = EFFORT_COST_EXTRA_TUNING,
): number {
  const byKind = segmentKind ? tuning.demandMultiplierAllOutBySegmentKind?.[segmentKind] : undefined;
  if (typeof byKind === "number" && Number.isFinite(byKind) && byKind > tuning.demandMultiplierProtect) {
    return byKind;
  }
  // #7280 (slukket pakke): transport-terraenet maa ligge paa normal, aldrig under.
  const floor = tuning.demandMultiplierAllOutFloor;
  if (typeof byKind === "number" && Number.isFinite(byKind) && typeof floor === "number" && byKind >= floor) {
    return byKind;
  }
  return tuning.demandMultiplierAllOut;
}

/**
 * effortFatigueMultiplier-moensteret (raceRoles.js), ren v4-genimplementering:
 * effort-niveauet lookes op til en effekt-krav-multiplikator. Ingen rng, ingen
 * afhaengighed af rytter-tilstand — REN funktion af (effort, segment-terraen),
 * saa den er triviel at property-teste (samme multiplikator for samme input,
 * uanset kalde-kontekst) og trivielt determinismesikker. Terraenet flytter KUN
 * all_out-trinnet (#4914, #5580); uden terraen er resultatet den faelles vaerdi.
 */
export function effortDemandMultiplier(
  effort: EffortLevel,
  tuning: EffortCostTuning = EFFORT_COST_EXTRA_TUNING,
  segmentKind: SegmentKind | null = null,
): number {
  // #4632: femtrins-skalaen. 'grupetto' og 'all_out' skal have deres EGEN
  // multiplikator — faldt de igennem til normal-grenen, ville et femtrins-valg
  // stille blive til en normal dag, hvilket er praecis den fejlklasse
  // teamOrdersAdapter's VALID_EFFORTS-sæt ogsaa lukker.
  if (effort === "protect") return tuning.demandMultiplierProtect;
  if (effort === "save") return tuning.demandMultiplierSave;
  if (effort === "grupetto") return tuning.demandMultiplierGrupetto;
  if (effort === "all_out") return allOutDemandMultiplier(segmentKind, tuning);
  return tuning.demandMultiplierNormal;
}

/**
 * Modifier-hook (wiring-signatur til orkestratoren): tager den effekt-krav
 * (`demand`) segmentLoop.ts allerede har udregnet for en rytter i dette
 * segment (baseDemand * positionFactor, foer physiology-tick'et) og
 * returnerer den effort-modulerede vaerdi. REN — ingen mutation, intet
 * sidevirkning; `demand < 0` clampes forsvarsmaessigt til 0 (effekt-krav kan
 * aldrig vaere negativt), men multiplikatoren selv aendrer ALDRIG fortegn
 * (protect/save/normal skalerer altid samme ikke-negative demand op/ned).
 */
export function applyEffortToDemand(
  demand: number,
  effort: EffortLevel,
  tuning: EffortCostTuning = EFFORT_COST_EXTRA_TUNING,
  segmentKind: SegmentKind | null = null,
): number {
  const safeDemand = Math.max(0, demand);
  return safeDemand * effortDemandMultiplier(effort, tuning, segmentKind);
}
