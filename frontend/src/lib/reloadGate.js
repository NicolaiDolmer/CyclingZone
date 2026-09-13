// Én delt tilladelse til AUTOMATISK genindlæsning (#5159, Codex-fund B1).
//
// Problemet den løser: lag 3 (releaseWatch.js) genindlæser dokumentet når der er
// deployet en ny release. Den eneste beskyttelse var "står markøren i et
// tekstfelt?". Det beskytter FOKUS, ikke ARBEJDE. En spiller der har sat sit
// hold, flyttet fokus væk og læser videre på siden, mister hele udtagelsen når
// intervallet fyrer. Auditten reproducerede præcis det i både Chromium og WebKit
// på PR-preview (login-feltet blev tømt efter blur).
//
// Modellen er derfor eksplicit i stedet for gættet: en flade der HAR ugemt
// arbejde, en igangværende skrivning, en åben dialog eller en kørende afspilning
// registrerer en blokering, og slipper den igen når tilstanden er væk. Så længe
// der er mindst én blokering, må intet lag genindlæse af sig selv. Opdagelsen
// fortsætter (watcheren må gerne VIDE at der er en ny release) — det er kun
// selve genindlæsningen der venter på et dokumenteret sikkert punkt.
//
// Spillerens eget klik på "Update"-banneret er ikke omfattet: et udtrykkeligt
// klik er spillerens beslutning, ikke appens. Der er sidens egen beforeunload-
// vagt (fx RaceHubBoard) stadig sikkerhedsnettet, og den SKAL kun kunne komme
// frem efter en handling spilleren selv har foretaget.
//
// Bevidst valg: vi gemmer ALDRIG spillerens kladde automatisk som en del af et
// deploy. Et deploy må udskyde sig selv; det må ikke skrive i spillerens navn.

import { useEffect } from "react";

// Faste årsager, så telemetri og tests kan tælle på noget stabilt. Strengen er
// et teknisk id, aldrig spiller-vendt tekst.
export const RELOAD_BLOCK_REASONS = Object.freeze({
  // Ugemt kladde: lokale valg der først findes på serveren efter Gem.
  DIRTY: "dirty",
  // Igangværende skrivning: et PUT/POST der er sendt men ikke svaret endnu.
  BUSY: "busy",
  // Åben dialog der venter på spillerens svar (fx bud-bekræftelsen).
  DIALOG: "dialog",
  // Kørende afspilning (film/finalekilometer) som et reload ville afbryde.
  PLAYBACK: "playback",
});

let nextToken = 0;
/** @type {Map<number, {reason: string, at: number}>} */
const blocks = new Map();
/** @type {Set<() => void>} */
const listeners = new Set();

function notifyAllowed() {
  // Kopi: en lytter må gerne afmelde sig selv inde fra sit eget kald.
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // En fejl i én lytter må ikke stoppe de andre — og slet ikke blive til en
      // unhandledrejection, som chunkErrors.js' globale net så ser igen.
    }
  }
}

/**
 * Registrér en blokering mod automatisk genindlæsning.
 *
 * @param {string} [reason] et af RELOAD_BLOCK_REASONS (fri streng tillades, men
 *   hold dig til listen — den er det telemetrien kan tælle på).
 * @returns {() => void} release-funktionen. Idempotent: flere kald gør intet
 *   ekstra, så den kan bruges direkte som en React-effect-cleanup.
 */
export function acquireReloadBlock(reason = "unknown") {
  const token = ++nextToken;
  blocks.set(token, { reason: String(reason), at: Date.now() });
  let released = false;
  return function releaseReloadBlock() {
    if (released) return;
    released = true;
    blocks.delete(token);
    if (blocks.size === 0) notifyAllowed();
  };
}

/** Sand når INGEN flade har ugemt arbejde, åben dialog eller kørende skrivning. */
export function isReloadAllowed() {
  return blocks.size === 0;
}

/**
 * Årsagerne bag de aktive blokeringer, uden dubletter og i fast rækkefølge.
 * Kun til telemetri og fejlsøgning — aldrig spiller-vendt tekst.
 * @returns {string[]}
 */
export function getReloadBlockReasons() {
  return [...new Set([...blocks.values()].map((b) => b.reason))].sort();
}

/**
 * Kaldes når den SIDSTE blokering slippes. Det er det sikre punkt: spilleren har
 * gemt eller fortrudt, og der er ikke længere noget at miste.
 *
 * Bemærk at lytteren kun fyrer på overgangen "blokeret -> fri". Er der ingen
 * blokeringer i forvejen, sker der intet — kalderen skal selv tjekke
 * `isReloadAllowed()` når den starter.
 *
 * @param {() => void} listener
 * @returns {() => void} afmeld
 */
export function onReloadAllowed(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * React-siden af porten. Ét kald pr. flade, ingen anden ændring:
 *
 *   useReloadBlock(dirty || saving, RELOAD_BLOCK_REASONS.DIRTY);
 *
 * Effekten registrerer blokeringen mens `active` er sand og slipper den i
 * cleanup — også ved unmount, så en flade der navigeres væk fra aldrig kan
 * efterlade en hængende blokering.
 *
 * @param {boolean} active
 * @param {string} [reason]
 */
export function useReloadBlock(active, reason = RELOAD_BLOCK_REASONS.DIRTY) {
  useEffect(() => {
    if (!active) return undefined;
    return acquireReloadBlock(reason);
  }, [active, reason]);
}

/**
 * KUN til tests: nulstiller modulets tilstand mellem scenarier. Modulet er
 * bevidst et singleton (der findes én browserfane), så testene har brug for en
 * eksplicit vej tilbage til udgangspunktet.
 */
export function __resetReloadGateForTests() {
  blocks.clear();
  listeners.clear();
  nextToken = 0;
}
