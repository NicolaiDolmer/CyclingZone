// backend/lib/engine/v4/mechanics/longAttack7884.ts
// #7884/#8828 (kontakten long_attack_7884, IKKE tilsluttet segment-loopet endnu): langt angreb
// fra FODEN af den valgte stigning. Design: docs/superpowers/specs/2026-11-12-7884-langt-angreb-design.md
// afsnit 2 ("Motorens regel"); dommer-scenarierne M1-M8 staar i
// docs/superpowers/specs/2026-11-26-7884-taktik-klager-og-angreb-paa-stigning.md afsnit 6.
//
// Princippet: intet foraeret. Rytteren saetter af fra den gruppe han sidder i, med samme hul som
// gruppen. Han koerer hurtigere end sin egen evne ved at bruge af sin reserve; naar den er tom, er
// tillaegget vaek, og motorens almindelige straf for en toemt reserve goer ham langsommere ("gaaet
// doed", med aegte aarsag). Derfra gaelder motorens almindelige regler for fart, laeg, dal og jagt.
//
// REN: ingen IO, ingen Date, ingen tilfaeldighed. Funktionerne tager ingen rng og aendrer intet input.
// LONG_ATTACK_7884_ENGINE_READY (tacticAttackTrigger7884.js) flippes foerst i den PR, der kobler
// mekanikken paa segment-loopet med maaling og dommer; indtil da kalder motoren ikke denne fil.

import type { RaceGroup } from "../types.ts";
import { splitGroup } from "../groups.ts";
import { LONG_ATTACK_7884_TUNING } from "../tuning.ts";

export type LongAttack7884Tuning = { cpBonus: number; reserveSharePerHour: number };

/** Gruppe-id'et for et angreb (deterministisk: rytteren og segmentet). */
export function longAttackGroupId7884(riderId: string, segmentIndex: number): string {
  return `long-attack-7884-${segmentIndex}-${riderId}`;
}

/**
 * M1: afsaettet. Rytteren flyttes ud af sin gruppe til en solo-gruppe med SAMME hul (ingen flytning
 * frem, intet startforspring). Er han alene i gruppen, eller findes han ikke, er der intet at
 * saette af fra: samme array tilbage. Oprindelsen arves (en rytter der saetter af fra udbruddet,
 * koerer stadig i dagens udbrud).
 */
export function launchLongAttack7884(groups: readonly RaceGroup[], riderId: string, segmentIndex: number): RaceGroup[] {
  const own = groups.find((g) => g.rider_ids.includes(riderId));
  if (!own || own.rider_ids.length < 2) return groups as RaceGroup[];
  return splitGroup([...groups], own.id, [riderId], { id: longAttackGroupId7884(riderId, segmentIndex), kind: "solo", gapSecondsDelta: 0 });
}

/**
 * M2/M3: et skridt af angrebet. Tillaegget over egen evne gaelder kun, mens reserven raekker, og
 * hvert sekund med tillaeg koster reserve. Returnerer den gennemsnitlige evne-faktor for skridtet,
 * reserven efter og hvor mange sekunder tillaegget holdt. En tom reserve giver faktor 1 (ingen
 * gevinst); motorens egen straf for en toemt reserve goer resten.
 */
export function longAttackStep7884(
  args: { wprime: number; wprimeMax: number; dtSeconds: number },
  tuning: LongAttack7884Tuning = LONG_ATTACK_7884_TUNING,
): { cpMultiplier: number; wprimeAfter: number; bonusSeconds: number } {
  const { wprime, wprimeMax, dtSeconds } = args;
  if (!(wprimeMax > 0) || !(wprime > 0) || !(dtSeconds > 0) || !(tuning.cpBonus > 0) || !(tuning.reserveSharePerHour > 0)) {
    return { cpMultiplier: 1, wprimeAfter: Math.max(0, wprime || 0), bonusSeconds: 0 };
  }
  const costPerSecond = (wprimeMax * tuning.reserveSharePerHour) / 3600;
  const bonusSeconds = Math.min(dtSeconds, wprime / costPerSecond);
  return {
    cpMultiplier: 1 + tuning.cpBonus * (bonusSeconds / dtSeconds),
    wprimeAfter: bonusSeconds < dtSeconds ? 0 : Math.max(0, wprime - bonusSeconds * costPerSecond), // tom = praecis 0
    bonusSeconds,
  };
}

/**
 * M5/M6: er angriberen hentet? Hans gruppe efter skridtet rummer ryttere, der foer skridtet sad i
 * en gruppe BAG ham. At koere op til en gruppe foran er ikke at blive hentet. Kender motoren ikke
 * hans gruppe foer eller efter (fx udgaaet), er han ikke hentet.
 */
export function longAttackCaught7884(before: readonly RaceGroup[], after: readonly RaceGroup[], riderId: string): boolean {
  const ownBefore = before.find((g) => g.rider_ids.includes(riderId));
  const ownAfter = after.find((g) => g.rider_ids.includes(riderId));
  if (!ownBefore || !ownAfter) return false;
  const gapBefore = new Map<string, number>();
  for (const g of before) for (const id of g.rider_ids) gapBefore.set(id, g.gap_seconds);
  const mine = new Set(ownBefore.rider_ids);
  return ownAfter.rider_ids.some((id) => !mine.has(id) && (gapBefore.get(id) ?? -Infinity) > ownBefore.gap_seconds);
}

/** M5 (ejerens valg 4 A): hvad en hentet rytter koerer resten af leddet. */
export const LONG_ATTACK_7884_AFTER_CAUGHT_TASK = "follow_moves" as const;

/**
 * M8: én ejer af gevinsten pr. rytter og segment. En rytter paa aktivt langt angreb er ikke
 * kandidat til "Alt ud"-gevinsten (climbSelection) paa samme segment.
 */
export function allOutGainEligible7884(riderId: string, activeLongAttackers: ReadonlySet<string> | undefined): boolean {
  return !(activeLongAttackers?.has(riderId) ?? false);
}
