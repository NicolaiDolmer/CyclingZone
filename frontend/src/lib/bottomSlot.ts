// Én delt bund-slot (#5440 punkt 1).
//
// Tre flader tegner fast i bunden (`fixed inset-x-0`, lige over bundmenuen på
// mobil, se mobileNavOffset.ts / #5561): cookie-banneret, release-
// banneret (#5159) og NPS-baren (#940/#4997). Før dette gatede release-banneret
// og NPS-hooket sig hver for sig på samtykke-banneret, men INGEN af dem kendte
// hinanden: NPS-baren bor inde i DashboardPage/TeamResultsTab, release-banneret
// i App, og begge tegnede oven i hinanden når en ny frontend blev opdaget mens
// NPS-baren stod.
//
// Nu registrerer hver flade sit ØNSKE om bundkanten her, og kun én ad gangen får
// den. Prioriteten er fast og ejer-beskrevet i #5440:
//
//   samtykke > release > NPS
//
// Samtykke er en juridisk beslutning og ejer kanten alene. Release-banneret er
// spillerens eneste synlige udvej når appen IKKE må genindlæse af sig selv, så
// det slår en frivillig spørgeskema-bar. Står to krav med samme prioritet (fx to
// monterede NPS-flader), vinder det der kom først, så baren ikke skifter plads.
//
// En flade der taber, rendrer null men forbliver MONTERET: dens lokale tilstand
// (fx et valgt NPS-tal eller en halvskrevet begrundelse) overlever, og den kommer
// tilbage med det samme i det sekund kanten er fri igen.
//
// Modul-singleton som reloadGate.js (der findes én browserfane) og uden React-
// provider med vilje: AppProviders deles med build-time-prerenderen, og en ny
// provider dér ville ændre det træ landing-hydrationen sammenligner med. På
// serveren registrerer ingen noget (effects kører ikke), så ingen får slottet.

import { useEffect, useState, useSyncExternalStore } from "react";

export const BOTTOM_SLOT_PRIORITY = Object.freeze({
  consent: 3,
  release: 2,
  nps: 1,
});

export type BottomSlotKind = keyof typeof BOTTOM_SLOT_PRIORITY;

export interface BottomSlotClaim {
  id: number;
  kind: BottomSlotKind;
  // Registrerings-rækkefølge: afgør uafgjort mellem to krav af samme slags.
  seq: number;
}

/**
 * Den rene beslutning: hvilket krav holder slottet? Højeste prioritet vinder,
 * uafgjort afgøres af hvem der registrerede sig først. Ingen krav = ingen holder.
 */
export function resolveBottomSlotHolder(claims: Iterable<BottomSlotClaim>): number | null {
  let best: BottomSlotClaim | null = null;
  for (const claim of claims) {
    const priority = BOTTOM_SLOT_PRIORITY[claim.kind];
    if (priority === undefined) continue;
    if (
      best === null ||
      priority > BOTTOM_SLOT_PRIORITY[best.kind] ||
      (priority === BOTTOM_SLOT_PRIORITY[best.kind] && claim.seq < best.seq)
    ) {
      best = claim;
    }
  }
  return best ? best.id : null;
}

let nextInstanceId = 0;
let nextSeq = 0;
const claims = new Map<number, BottomSlotClaim>();
const listeners = new Set<() => void>();
let holder: number | null = null;

function recompute(): void {
  const next = resolveBottomSlotHolder(claims.values());
  if (next === holder) return;
  holder = next;
  // Kopi: en lytter må gerne afmelde sig selv inde fra sit eget kald.
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // En fejl i én flade må ikke stoppe de andre.
    }
  }
}

/** Et nyt, stabilt id til én flade (ét pr. hook-instans). */
export function createBottomSlotInstanceId(): number {
  nextInstanceId += 1;
  return nextInstanceId;
}

/**
 * Registrér et krav på bundkanten. Returnerer release-funktionen; den er
 * idempotent, så den kan bruges direkte som effect-cleanup.
 */
export function claimBottomSlot(id: number, kind: BottomSlotKind): () => void {
  nextSeq += 1;
  claims.set(id, { id, kind, seq: nextSeq });
  recompute();
  let released = false;
  return function releaseBottomSlot() {
    if (released) return;
    released = true;
    claims.delete(id);
    recompute();
  };
}

/** Id'et på den flade der har bundkanten lige nu, eller null. */
export function getBottomSlotHolder(): number | null {
  return holder;
}

export function subscribeBottomSlot(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getServerHolder(): number | null {
  return null;
}

/**
 * React-siden af slottet. Ét kald pr. flade:
 *
 *   const granted = useBottomSlot("release", Boolean(show));
 *
 * Kravet står mens `wants` er sand og slippes i cleanup — også ved unmount, så
 * en flade der navigeres væk fra aldrig kan efterlade kanten optaget.
 *
 * @returns sand når netop DENNE flade må tegne i bunden nu.
 */
export function useBottomSlot(kind: BottomSlotKind, wants: boolean): boolean {
  const [id] = useState(createBottomSlotInstanceId);
  useEffect(() => {
    if (!wants) return undefined;
    return claimBottomSlot(id, kind);
  }, [id, kind, wants]);
  const current = useSyncExternalStore(subscribeBottomSlot, getBottomSlotHolder, getServerHolder);
  return wants && current === id;
}

/**
 * KUN til tests: nulstiller modulets tilstand mellem scenarier (samme grund som
 * reloadGate.js' tilsvarende: modulet er bevidst et singleton).
 */
export function __resetBottomSlotForTests(): void {
  claims.clear();
  listeners.clear();
  holder = null;
  nextInstanceId = 0;
  nextSeq = 0;
}
