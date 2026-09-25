// backend/lib/engine/v4/mechanics/climbSelection.ts
// Race Engine v4 F2 (#4030): M2 - klatre-selektion.
// SSOT: docs/superpowers/specs/2026-08-21-race-engine-v4-f2-core-design.md §4
// punkt 3 + monotoni-implementeringen (samme §, sidste afsnit) + mor-spec
// §3.2/§4 M2 (docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md).
//
// REN — ingen import fra oevrigt backend, ingen IO/Date/Math.random.
//
// Ryttere i en climb-gruppe splitter bagud naar W' rammer nul ELLER en
// klatre-underskud-score overstiger tuning.selection.splitThreshold.
// Selektions-score = deficit(climbing) + energiunderskud + stoej (stoej
// skalerer magnitude, ALDRIG fortegn — §2 invariant 3). Monotoni haandhaeves
// af en post-sortering rank-guard: sorteret efter den stoej-frie baseScore
// faldende (svageste/mest energi-udtoemte foerst), propageres "ikke-split"
// ALTID fremad mod stigende klatre-evne/lavere energi-underskud, saa en
// staerkere klatrer (samme energi) aldrig kan splitte foer en svagere.
//
// Lokale normaliserings-/gap-konstanter (GRADIENT_NORM_PCT osv.) er BEVIDST
// ikke lagt i tuning.ts: SelectionTuning (types.ts) er en frosset kontrakt
// for denne fase (byggeplan §8: kun arkitekten aendrer types.ts), og disse
// konstanter er rene skalerings-detaljer for M2's egen scoreformel — samme
// "intern implementeringsdetalje"-praecedens som segmentLoop.ts's egne
// clamp/round2-helpers (og TerrainTuning-kommentaren om at fog-gaten kun
// gaelder events[].params, ikke interne konstanter). tuning.selection's 4
// frosne felter (deficitWeight, energyDeficitWeight, noiseSdBase,
// splitThreshold) er de reelt kalibrerbare haandtag (head-to-head, 23-24/8).

import type {
  ClimbSelectionHook,
  EngineState,
  GroupKind,
  RaceGroup,
  SegmentHookContext,
  SegmentHookResult,
  TimelineEvent,
} from "../types.ts";
import { gaussian } from "../rng.ts";
import { makeGroupId, splitGroup } from "../groups.ts";
import { EFFORT_GAIN_EXTRA_TUNING, GROUP_TEMPO_EFFORT_EXTRA_TUNING } from "../tuning.ts";
import type { GroupTempoModel } from "../tuning.ts";
import type { EffortLevel } from "../types.ts";

/**
 * #5580 (M1 punkt 1, indsatstrappen model 3): indsatsens GEVINST paa
 * stigningen. Split-scoren ganges med `(1 - relief[effort] x reserve01)`:
 * `protect`/`all_out` holder gruppen laengere, `save`/`grupetto` giver slip
 * tidligere, `normal` er praecis 1 (bit-uaendret).
 *
 * Gevinsten er GANGET MED REST-RESERVEN: en rytter der har braendt sin W' faar
 * intet led, mens den pris han har betalt (det hoejere kraftkrav, M12) staar
 * tilbage i energi-underskuddet. Tom reserve => han knaekker.
 *
 * Monotoni: for SAMME reserve og SAMME score er faktoren ikke-stigende op ad
 * trappen (relief-tabellen er ikke-faldende, laast af test), saa P(sat) aldrig
 * stiger naar indsatsen hoejnes. For to ryttere paa samme trin og samme
 * reserve er faktoren ens, saa rank-guardens evne-orden er bevaret.
 *
 * Faktoren clampes til >= 0: en score kan aldrig blive negativ (en negativ
 * score ville vende stoejens fortegn, §2 invariant 3).
 *
 * Eksporteret for property-testbarhed.
 */
export function effortClimbScoreFactor(
  effort: EffortLevel | undefined,
  reserve01: number,
  relief: Readonly<Record<EffortLevel, number>> = EFFORT_GAIN_EXTRA_TUNING.climbScoreRelief,
): number {
  const r = effort ? relief[effort] : 0;
  if (!Number.isFinite(r) || r === 0) return 1;
  const reserve = Number.isFinite(reserve01) ? clamp(reserve01, 0, 1) : 0;
  return Math.max(0, 1 - r * reserve);
}

/**
 * #5580 (M1 punkt 1, "en lavere indsats giver slip tidligere"): et ADDITIVT
 * straf-led paa split-scoren for de lave trin, skaleret med stigningens alvor
 * (0-1). Faktoren ovenfor kan ikke flytte en save-rytter, fordi hans score er
 * lille (han har sparet sin W'); et led der laegges til goer.
 *
 * Leddet vejer kun fuldt for en rytter der ER under gruppens bedste klatrer
 * (`deficit01` >= `fullAtDeficit`), og er 0 for gruppens bedste: den staerkeste
 * i gruppen kan ikke "give slip" fra svagere ryttere, for en udskilt gruppe
 * koerer i sit eget tempo, og en staerk rytter alene ville koere fra dem (fanget
 * af grupetto-tvilling-testen i segmentLoop.effortCost.test.ts). Leddet er
 * ikke-faldende i underskuddet, saa evne-monotonien inden for samme trin holder.
 *
 * Kontrakt: aldrig negativt (en straf er aldrig en bonus), 0 for `normal` og
 * op, ikke-stigende op ad trappen (laast af test), og 0 uden stigning (ingen
 * stigning, ingen udvaelgelse, #4604).
 *
 * Eksporteret for property-testbarhed.
 */
export function effortClimbScorePenalty(
  effort: EffortLevel | undefined,
  severity01: number,
  deficit01: number,
  penalty: Readonly<Record<EffortLevel, number>> = EFFORT_GAIN_EXTRA_TUNING.climbScorePenalty,
  fullAtDeficit: number = EFFORT_GAIN_EXTRA_TUNING.climbPenaltyFullAtDeficit,
): number {
  const p = effort ? penalty[effort] : 0;
  if (!Number.isFinite(p) || p <= 0) return 0;
  const severity = Number.isFinite(severity01) ? clamp(severity01, 0, 1) : 0;
  const deficit = Number.isFinite(deficit01) ? clamp(deficit01, 0, 1) : 0;
  const gate = fullAtDeficit > 0 ? clamp(deficit / fullAtDeficit, 0, 1) : 1;
  return p * severity * gate;
}

/**
 * #4914 (grupetto-tempo, EJER-VALG bag GROUP_TEMPO_EFFORT_EXTRA_TUNING.model):
 * skal en grupetto-rytter falde tilbage paa denne stigning?
 *
 * Kun i modellen "effort_weighted", og kun naar gruppen ogsaa rummer ryttere
 * der KOERER (ikke-grupetto) — en gruppe der udelukkende er grupetto ER den
 * sidste gruppe paa vejen og skal ikke splittes op i stumper. I default-
 * modellen "cp_only" er svaret altid nej, saa selektionen er bit-identisk med
 * main.
 *
 * Hvorfor den hoerer sammen med tempo-leddet (segmentLoop.groupEffortTempo):
 * #4909 byggede en tvungen tilbagefaldning ALENE og rullede den tilbage, fordi
 * en staerk grupetto-rytter alene i sin nye gruppe havde en hoejere kollektiv
 * CP end feltet og koerte FRA det. Med tempo-leddet koerer den gruppe i
 * grupetto-tempo, saa tilbagefaldningen virker efter hensigten. De to led er
 * derfor ÉN model bag én kontakt.
 *
 * Eksporteret for testbarhed af kontakten.
 */
export function grupettoDropBackForced(
  effort: string | undefined,
  groupHasRacers: boolean,
  tempoTuning: { model: GroupTempoModel } = GROUP_TEMPO_EFFORT_EXTRA_TUNING,
): boolean {
  return tempoTuning.model === "effort_weighted" && effort === "grupetto" && groupHasRacers;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Normaliseringsdenominatorer for "klatre-underskud × gradient × længde"
// (§4 punkt 3): en HC-agtig 15%/10km-referenceklatring giver
// climbDeficitScaled = 1 ved fuldt deficit (deficit01=1) — kalibreret saa
// tuning.selection.splitThreshold (0.12) rammes ved realistiske, ikke
// ekstreme, deficits paa almindelige stigninger.
const GRADIENT_NORM_PCT = 15;
const LENGTH_NORM_KM = 10;

// Split-gap-sekunder (hvor langt bagud den nye gruppe starter): base +
// skalering paa gennemsnitlig (stoej-fri) score blandt de splittede ryttere,
// clampet til et realistisk baand.
const SPLIT_GAP_BASE_SECONDS = 15;
const SPLIT_GAP_PER_SCORE_UNIT = 90;
const SPLIT_GAP_BOUNDS: readonly [number, number] = [10, 240];

type RiderSelection = {
  riderId: string;
  baseScore: number; // stoej-fri: deficitWeight*climbDeficitScaled + energyDeficitWeight*energyDeficit
  scoreTriggered: boolean; // (baseScore + stoej) > splitThreshold, FOER rank-guard
  wprimeForced: boolean; // wprime <= 0 — fysiologisk absolut, uafhaengig af rank-guard
  effortForced: boolean; // #4914: grupetto-rytter falder tilbage (kun model "effort_weighted") — rytterens EGET valg, uafhaengig af rank-guard
};

/** Klatre-underskud (0-1, normaliseret) relativt til gruppens staerkeste klatrer. */
function climbDeficit01(referenceClimbing: number, climbing: number): number {
  return clamp((referenceClimbing - climbing) / 99, 0, 1);
}

/**
 * "klatre-underskud × gradient × længde" (§4 punkt 3), normaliseret mod
 * GRADIENT_NORM_PCT/LENGTH_NORM_KM saa produktet er sammenligneligt med
 * tuning.selection-vaegtene/-taersklen (alle ~0-1-skala).
 */
function climbDeficitScaled(deficit01: number, gradientPct: number, lengthKm: number): number {
  return deficit01 * climbSeverity01(gradientPct, lengthKm);
}

/**
 * Stigningens SELEKTIONS-ALVOR (0-1): "gradient x laengde" normaliseret mod
 * GRADIENT_NORM_PCT/LENGTH_NORM_KM. 1 = HC-agtig referenceklatring.
 *
 * #4604: eksporteret og loeftet ud af climbDeficitScaled fordi den nu ogsaa
 * skalerer ENERGI-leddet i selektions-scoren. FOER: kun klatre-underskuddet
 * var alvors-skaleret, mens energi-underskuddet taalte fuldt uanset om
 * stigningen var en HC-bjergside eller en 2 km lang bakke. Efter 170 km har
 * NAESTEN HELE feltet et stort energi-underskud, saa energi-leddet alene
 * oversteg splitThreshold paa enhver stigning — og den foerste smaabakke sent
 * paa en FLAD etape shellede 179 af 180 ryttere i ét skridt (maalt 2/9 paa
 * S3-kalenderen: 83 % af de flade etaper ankom til finalen med en front-pulje
 * paa ÉN rytter). Selektions-pres skal skalere med selektions-MULIGHEDEN:
 * ingen stigning, ingen udvaelgelse.
 */
export function climbSeverity01(gradientPct: number, lengthKm: number): number {
  const gradientNorm = clamp(gradientPct, 0, 100) / GRADIENT_NORM_PCT;
  const lengthNorm = clamp(lengthKm, 0, 1000) / LENGTH_NORM_KM;
  return clamp(gradientNorm * lengthNorm, 0, 1);
}

/**
 * Energi-underskud (0-1): 1 = tom reserve, 0 = fuld reserve.
 *
 * #4604: `wprimeMax <= 0` returnerede FOER 0 — altsaa "fuldstaendig frisk".
 * Guarden var skrevet mod division med nul, men oversatte i praksis "ingen
 * anaerob kapacitet overhovedet" til "uudtoemmelig". De 6 ryttere i S3-
 * populationen med punch=acceleration=sprint=0 blev derfor IMMUNE over for
 * energi-leddet i selektionen: de overlevede hver eneste udvaelgelse, sad
 * alene i front og vandt massespurter med sprint-evne 0. En rytter uden
 * anaerob kapacitet er maksimalt saarbar, ikke usaarlig — derfor 1.
 */
function energyDeficit01(wprime: number, wprimeMax: number): number {
  if (wprimeMax <= 0) return 1;
  return clamp(1 - wprime / wprimeMax, 0, 1);
}

/**
 * Selektions-info pr. rytter i en climb-gruppe (§4 punkt 3 + monotoni-afsnittet).
 * baseScore er stoej-fri (bruges af rank-guarden); scoreTriggered inkluderer
 * stoej (den faktiske split-beslutning FOER guard).
 */
function computeSelections(
  group: RaceGroup,
  state: EngineState,
  ctx: SegmentHookContext,
  gradientPct: number,
  lengthKm: number,
): RiderSelection[] {
  const { entrants, tuning, rngFor } = ctx;
  const { deficitWeight, energyDeficitWeight, noiseSdBase, splitThreshold } = tuning.selection;

  let referenceClimbing = 0;
  let groupHasRacers = false;
  for (const riderId of group.rider_ids) {
    const entrant = entrants[riderId];
    if (!entrant) continue;
    referenceClimbing = Math.max(referenceClimbing, entrant.abilities.climbing);
    if (entrant.effort !== "grupetto") groupHasRacers = true;
  }

  const selections: RiderSelection[] = [];
  for (const riderId of group.rider_ids) {
    const entrant = entrants[riderId];
    const riderState = state.riders[riderId];
    if (!entrant || !riderState || riderState.status !== "racing") continue;

    const deficit01 = climbDeficit01(referenceClimbing, entrant.abilities.climbing);
    const deficitScaled = climbDeficitScaled(deficit01, gradientPct, lengthKm);
    const energyDeficit = energyDeficit01(riderState.wprime, riderState.wprimeMax);
    // Begge led er nu alvors-skalerede (#4604) — se climbSeverity01's docblock.
    const severity = climbSeverity01(gradientPct, lengthKm);
    const energyScaled = energyDeficit * severity;
    // #5580: indsats-leddet (gevinsten), skaleret med rest-reserven — se
    // effortClimbScoreFactor — plus de lave trins straf-led (se
    // effortClimbScorePenalty). Normal => faktor 1 og straf 0, dvs. bit-uaendret.
    const effortFactor = effortClimbScoreFactor(entrant.effort, 1 - energyDeficit);
    const effortPenalty = effortClimbScorePenalty(entrant.effort, severity, deficit01);
    const baseScore = (deficitWeight * deficitScaled + energyDeficitWeight * energyScaled) * effortFactor + effortPenalty;

    const noise = gaussian(rngFor("climbSelection", riderId), 0, noiseSdBase * baseScore);
    const noisyScore = baseScore + noise;

    selections.push({
      riderId,
      baseScore,
      scoreTriggered: noisyScore > splitThreshold,
      wprimeForced: riderState.wprime <= 0,
      effortForced: grupettoDropBackForced(entrant.effort, groupHasRacers),
    });
  }
  return selections;
}

/**
 * Rank-guard (§4 monotoni-afsnittet): sorteret efter baseScore faldende
 * (svageste/mest energi-udtoemte foerst), propageres "ikke-split" ALTID
 * fremad — saa en rytter med lavere baseScore (staerkere/friskere, samme
 * gruppe) aldrig kan ende splittet mens en med hoejere baseScore forbliver.
 * wprime-tvungne splits (fysiologisk absolut) er UNDTAGET guarden: de
 * paavirkes kun af selve energi-tilstanden, ikke af rangeringen.
 */
/**
 * Rank-guard (§4 monotoni-afsnittet): sorteret efter baseScore faldende
 * (svageste/mest energi-udtoemte foerst), propageres "ikke-split" ALTID
 * fremad — saa en rytter med lavere baseScore (staerkere/friskere, samme
 * gruppe) aldrig kan ende splittet mens en med hoejere baseScore forbliver.
 * wprime-tvungne splits (fysiologisk absolut) er UNDTAGET guarden: de
 * paavirkes kun af selve energi-tilstanden, ikke af rangeringen.
 */
function guardedSplitRiderIds(selections: RiderSelection[]): string[] {
  const sorted = [...selections].sort((a, b) => b.baseScore - a.baseScore || a.riderId.localeCompare(b.riderId));
  let stillEligible = true;
  const split: string[] = [];
  for (const sel of sorted) {
    const guardedTriggered = stillEligible && sel.scoreTriggered;
    if (!sel.scoreTriggered) stillEligible = false;
    if (guardedTriggered || sel.wprimeForced || sel.effortForced) split.push(sel.riderId);
  }
  return split.sort();
}

/**
 * Naar ALLE ryttere i en gruppe er udvalgt til split, beholdes én som
 * gruppens fortsatte front: den med laveste baseScore. #4914 (CodeRabbit-fund):
 * en tilbagefaldet grupetto-rytter (`effortForced`) maa aldrig vaere den der
 * bliver — ellers ville han blive i fronten mens en udkoert rytter der koerer
 * blev splittet, altsaa det modsatte af tilbagefaldet. Findes der ingen uden
 * `effortForced` (kan ikke ske: tilbagefaldet kraever en rytter der koerer),
 * falder reglen tilbage paa hele gruppen. I default-modellen er
 * `effortForced` altid false, saa valget er praecis det gamle.
 *
 * Eksporteret for testbarhed af netop denne regel.
 */
export function retainedRiderIdWhenAllSplit(
  selections: ReadonlyArray<Pick<RiderSelection, "riderId" | "baseScore" | "effortForced">>,
): string {
  const racers = selections.filter((s) => !s.effortForced);
  const candidates = racers.length > 0 ? racers : selections;
  return [...candidates].sort((a, b) => a.baseScore - b.baseScore || a.riderId.localeCompare(b.riderId))[0].riderId;
}

function gapSecondsDeltaFor(selections: RiderSelection[], splitRiderIds: string[]): number {
  const splitSet = new Set(splitRiderIds);
  const chosen = selections.filter((s) => splitSet.has(s.riderId));
  if (chosen.length === 0) return SPLIT_GAP_BOUNDS[0];
  const avgBaseScore = chosen.reduce((sum, s) => sum + s.baseScore, 0) / chosen.length;
  return clamp(
    SPLIT_GAP_BASE_SECONDS + SPLIT_GAP_PER_SCORE_UNIT * avgBaseScore,
    SPLIT_GAP_BOUNDS[0],
    SPLIT_GAP_BOUNDS[1],
  );
}

function causeFor(selections: RiderSelection[], splitRiderIds: string[]): string {
  const splitSet = new Set(splitRiderIds);
  const chosen = selections.filter((s) => splitSet.has(s.riderId));
  if (chosen.length === 0) return "climb_deficit";
  // #4914: en tilbagefaldet grupetto-rytter har sin EGEN aarsag — ellers ville
  // tidslinjen paastaa at han var koert i saenk. I default-modellen er
  // effortForced altid false, saa de tre gamle aarsager er uaendrede.
  if (chosen.every((s) => s.effortForced && !s.wprimeForced)) return "grupetto";
  const allForced = chosen.every((s) => s.wprimeForced);
  const noneForced = chosen.every((s) => !s.wprimeForced && !s.effortForced);
  if (allForced) return "wprime_depleted";
  if (noneForced) return "climb_deficit";
  return "mixed";
}

function splitKindFor(sourceKind: GroupKind, splitCount: number): GroupKind {
  if (splitCount === 1) return "solo";
  return sourceKind === "peloton" ? "gruppetto" : "chase";
}

/**
 * M2-hook: kaldes paa climb-segmenter (segmentLoop.ts). Behandler hver
 * eksisterende gruppe uafhaengigt (>=2 ryttere), splitter de udvalgte
 * ryttere bagud i en ny gruppe og emitterer ét peloton_splits-event pr.
 * ny gruppe med en kategorisk aarsag (wprime_depleted/climb_deficit/mixed).
 * REN: intet input muteres, samme (state, ctx) -> samme output.
 */
export const climbSelectionHook: ClimbSelectionHook = (
  state: EngineState,
  ctx: SegmentHookContext,
): SegmentHookResult => {
  const { segment } = ctx;
  if (segment.kind !== "climb") return { state, events: [] };

  const gradientPct = Math.max(0, segment.avg_gradient);
  const lengthKm = Math.max(0, segment.to_km - segment.from_km);

  // Deterministisk behandlingsraekkefolge (id-sorteret) — paavirker ikke
  // resultatet (rngFor er noeglet pr. rytter, ikke pr. kalde-raekkefolge),
  // men holder ny-gruppe-id'ernes taeller stabil pr. run.
  const groupsSorted = [...state.groups].sort((a, b) => a.id.localeCompare(b.id));

  let nextState = state;
  const events: TimelineEvent[] = [];
  let localSeq = 0;

  for (const group of groupsSorted) {
    if (group.rider_ids.length < 2) continue;

    const selections = computeSelections(group, nextState, ctx, gradientPct, lengthKm);
    if (selections.length < 2) continue;

    let splitRiderIds = guardedSplitRiderIds(selections);
    if (splitRiderIds.length === 0) continue;
    if (splitRiderIds.length >= group.rider_ids.length) {
      // Ekstremt segment (fx laengere hele-etape-klatring i test-harnesset):
      // ALLE ryttere kan i princippet ramme wprime<=0 samtidig. En gruppe kan
      // aldrig splitte fra sig selv — behold altid mindst den bedst-
      // positionerede rytter (laveste baseScore) som gruppens fortsatte front,
      // saa selektionen stadig differentierer resten (climbDeficitScaled
      // adskiller ryttere ogsaa naar alle er wprime-tvungne).
      const bestRiderId = retainedRiderIdWhenAllSplit(selections);
      splitRiderIds = splitRiderIds.filter((id) => id !== bestRiderId);
    }
    if (splitRiderIds.length === 0) continue;

    const kind = splitKindFor(group.kind, splitRiderIds.length);
    const seq = ctx.segmentIndex * 1000 + localSeq;
    localSeq += 1;
    const newGroupId = makeGroupId(kind, seq);
    const gapSecondsDelta = gapSecondsDeltaFor(selections, splitRiderIds);

    const groups = splitGroup(nextState.groups, group.id, splitRiderIds, {
      id: newGroupId,
      kind,
      gapSecondsDelta,
    });
    nextState = { ...nextState, groups };

    events.push({
      km: round2(segment.to_km),
      type: "peloton_splits",
      params: {
        group_id: newGroupId,
        source_group_id: group.id,
        rider_ids: [...splitRiderIds],
        cause: causeFor(selections, splitRiderIds),
        gap_seconds: round2(gapSecondsDelta),
      },
    });
  }

  return { state: nextState, events };
};
