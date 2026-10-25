// backend/lib/engine/v4/mechanics/pointsJersey2757.ts
// #2757 G18 (KUN s5_profiles_v3): klassementsfolkene koerer ikke efter pointtroejen.
//
// Testporten (s5_profiles_v3, 25/10) viste at klassementsvinderen vinder pointtroejen
// for ofte i etapeloeb med flere flade etaper. Maalingen (privat, balance-internals/
// 2757-g18/) viste hvor pointene kom fra: klart mest fra MAALET paa de flade
// massespurt-etaper, hvor en staerk klassementskaptajn spurtede med om sejren, og
// dernaest fra de indlagte spurter. Saadan koerer en klassementsrytter ikke i
// virkeligheden: paa en flad etape sidder han sikkert i feltet og ruller i maal paa
// feltets tid, mens sprinterne kaemper om spurten og pointene.
//
// To adfaerdsregler, begge kun under s5_profiles_v3 (aeldre revisioner er bit-identiske):
//   1. Massespurten: en klassementskaptajn (rolle "captain") i feltet spurter ikke, hverken
//      om sejren eller bag et overlevende udbrud. Han ruller i maal bag spurtens front, paa
//      SAMME tid (feltet deler én tid), saa klassementet roeres kun af de bonussekunder han
//      ikke laengere tager. En kaptajn i et overlevende udbrud eller en lille gruppe koerer
//      stadig om sejren; er hans udbrud hentet, sidder han i feltet.
//      Kun den flade massespurt: en stigende spurt og en punch-/bjergfinale er et
//      klassementsterraen, hvor favoritterne ogsaa i virkeligheden koerer om sejren.
//   2. Indlagte spurter: foerer en klassementskaptajn pointkonkurrencen, forsvarer han
//      den ikke i feltets indlagte spurter (pointfoereren "kaemper altid", #5914, gaelder
//      ikke ham). I en lille gruppe kaemper han som foer: dér er bonussekunderne
//      klassementets, og den post er lille i maalingen.
//
// Point-skalaerne er ejer-laaste og roeres ikke: det er HVEM der kaemper der aendres.
//
// REN: ingen IO, ingen rng, intet input muteres.

import type { Entrant, FinaleType, GcContext } from "../types.ts";
import { isStageRaceGcContext } from "./breakawayV3_6804.ts";

/**
 * Regel 1 gaelder: s5_profiles_v3 og et etapeloeb (klassement eller 1. etape). I et
 * endagsloeb er der intet klassement at koere for: kaptajnen koerer om sejren som foer.
 */
export function gcCaptainRollInApplies(ctx: { s5ProfilesV3?: true; gcContext?: GcContext | null }): boolean {
  return ctx.s5ProfilesV3 === true && isStageRaceGcContext(ctx.gcContext);
}

/** Klassementskaptajnens rolle. En sprint-kaptajn ("sprint_captain") er netop spurteren. */
export const GC_CAPTAIN_ROLE = "captain";

/** De flade massespurt-finaler (S5's flat_sprint og den aeldre bunch_sprint). */
export const BUNCH_SPRINT_FINALES: readonly FinaleType[] = Object.freeze(["flat_sprint", "bunch_sprint"] as FinaleType[]);

/**
 * Saa mange placeringer i massespurten afgoeres af dem der spurter, foer en
 * klassementskaptajn ruller ind. Spurtens front er sprinterne og deres tog; resten
 * af feltet ruller i maal paa samme tid. Arbejdsvalg: feltets forreste klump.
 */
export const GC_CAPTAIN_ROLL_IN_AFTER = 20;

/**
 * Hvor langt inde i feltet kaptajnen ruller i maal (seedet pr. rytter): et spaend af
 * placeringer efter spurtens front, saa han ikke staar paa samme plads hver dag.
 */
export const GC_CAPTAIN_ROLL_IN_SPREAD = 20;

export function isBunchSprintFinale(finaleType: FinaleType | null | undefined): boolean {
  return finaleType != null && BUNCH_SPRINT_FINALES.includes(finaleType);
}

/**
 * Regel 1: en maalpuljes raekkefoelge med klassementskaptajnerne rullet ind bag
 * spurtens front. Kalderen afgoer om puljen er FELTET (finale.ts: felt-stor pulje,
 * `isBunchSizedChaseGroup`): et overlevende udbrud eller en lille gruppe koerer om
 * sejren, ogsaa kaptajnen i den; en kaptajn hvis udbrud blev hentet, sidder i feltet.
 * Hver kaptajn faar en plads blandt de oevrige: efter de forreste `rollInAfter`, plus
 * et seedet stykke af `spread` (`jitter(riderId)` i [0, 1), udeladt = 0). Alle andre
 * bevarer deres indbyrdes raekkefoelge; kaptajner med samme maalplads beholder deres.
 * Er puljen kortere, kommer kaptajnen sidst. Ikke en massespurt = uaendret (ny kopi).
 */
export function rollInGcCaptainsOnBunchSprint<T extends { riderId: string }>(
  ordered: readonly T[],
  args: {
    finaleType: FinaleType | null | undefined;
    roleOf: (riderId: string) => string | null | undefined;
    jitter?: (riderId: string) => number;
    rollInAfter?: number;
    spread?: number;
  },
): T[] {
  if (!isBunchSprintFinale(args.finaleType)) return [...ordered];
  const rollInAfter = Math.max(0, args.rollInAfter ?? GC_CAPTAIN_ROLL_IN_AFTER);
  const spread = Math.max(0, args.spread ?? GC_CAPTAIN_ROLL_IN_SPREAD);
  const sprinting: T[] = [];
  const rolling: Array<{ entry: T; target: number; order: number }> = [];
  for (const entry of ordered) {
    if (args.roleOf(entry.riderId) === GC_CAPTAIN_ROLE) {
      const u = Math.min(Math.max(Number(args.jitter?.(entry.riderId) ?? 0) || 0, 0), 0.999999);
      rolling.push({ entry, target: rollInAfter + Math.floor(u * spread), order: rolling.length });
    } else sprinting.push(entry);
  }
  if (rolling.length === 0) return [...ordered];
  rolling.sort((a, b) => a.target - b.target || a.order - b.order);
  // Indsaet bag `target` af de oevrige (maalt i de oevrige, ikke i den samlede liste).
  const out: T[] = [];
  let r = 0;
  for (let i = 0; i <= sprinting.length; i++) {
    while (r < rolling.length && (rolling[r].target <= i || i === sprinting.length)) out.push(rolling[r++].entry);
    if (i < sprinting.length) out.push(sprinting[i]);
  }
  return out;
}

/**
 * Regel 2b: pointfoereren "kaemper altid" om en indlagt spurt (#5914), undtagen en
 * klassementskaptajn: han koerer for klassementet og forsvarer ikke pointtroejen i
 * feltets indlagte spurter. Returnerer det id passagen skal behandle som foerer.
 */
export function intermediateSprintLeaderV3(
  pointsLeaderId: string | null | undefined,
  entrants: Readonly<Record<string, Entrant>>,
): string | null {
  if (pointsLeaderId == null) return null;
  return String(entrants[pointsLeaderId]?.role ?? "") === GC_CAPTAIN_ROLE ? null : pointsLeaderId;
}
