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

import type { EffortLevel, SegmentKind } from "../types.ts";
import { EFFORT_COST_EXTRA_TUNING } from "../tuning.ts";

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
};

export { EFFORT_COST_EXTRA_TUNING as EFFORT_COST_TUNING };

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
