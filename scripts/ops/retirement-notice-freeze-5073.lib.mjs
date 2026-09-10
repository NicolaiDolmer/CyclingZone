// scripts/ops/retirement-notice-freeze-5073.lib.mjs
//
// #5073 · Den RENE klassifikationskerne bag maalescriptet: hvad sagde pensions-
// varslet FOER 7/9, hvad siger det I DAG, og hvem divergerer?
//
// Hvorfor en separat fil og ikke bare export'er i .mjs-scriptet:
//   CI's `static-guards`-job koerer bevidst UDEN `npm ci` (ci.yml: "de ti
//   IKKE-required, lette statiske guards (ingen npm ci)"). Testen maa derfor ikke
//   ad en importkaede traekke @supabase/supabase-js ind - saa fejler den med
//   ERR_MODULE_NOT_FOUND i CI, selvom den passerer lokalt hvor node_modules
//   findes. Denne fil importerer KUN dependency-frie backend/lib-moduler
//   (riderSeasonAge.js -> ingen imports, riderProgression.js -> kun rene libs),
//   saa `node --test` kan koere den i et bart checkout. Selve DB-scriptet
//   (retirement-notice-freeze-5073.mjs) importerer supabase-klienten og denne fil.
//
// ROD-AARSAG (dokumenteret i #5073-kommentaren 10/9):
//   Varslet er IKKE et lagret felt. GET /api/riders/:id/retirement-status regner
//   det on-the-fly via announcedRetirementAfterSeason(rider, activeSeason)
//   (backend/lib/riderProgression.js), som er ren funktion af
//   (rider.id, rider.birthdate, activeSeason) OG af hash-funktionen bag rullet.
//   PR #4990 (commit 742ba4d30, merged 2026-09-07 12:29 UTC) skiftede
//   retirementDecision() fra seededUnit() til seededUnitMixed(). Samme rytter,
//   samme saeson, NYT tal - og dermed nyt svar for alle i det seedede vindue
//   (saeson-alder 36-39). Uden for vinduet er svaret uaendret: <36 er altid nej,
//   >=40 er altid ja.
//
//   Praecis evidens for hash-skiftet (kommandoen betyder noget - `-S` taeller
//   FOREKOMSTER af en streng, saa en aendring der bevarer antallet giver ingen
//   traeffer):
//     git log -S 'seededUnitMixed(`retire:' -- backend/lib/riderProgression.js
//       -> 742ba4d30 (#4990) - selve skiftet
//     git log -S 'retire:${riderId}' -- backend/lib/riderProgression.js
//       -> 647881330 (#4021, varslet blev foedt) og ba2d29266 (#2979)
//   Diffen i 742ba4d30 viser skiftet direkte; det er beviset, ikke -S-taellingen.
//
// SSOT der er i spil (hard rule 30):
//   docs/PROGRESSION_RULES.md §6, raekken "Dags-/saeson-seedet stoej ... SKAL bruge
//   seededUnitMixed()" (#4987). Den regel er rigtig for daglig stoej, men den
//   kolliderer med #2700/#2748's loefte om at et GIVET varsel staar fast. Konflikten
//   er loest i §9 (modsigelse nr. 9): varslet er nu en GEMT kendsgerning paa
//   riders (retirement_notice_season / -after_season / -given_at), og dette
//   script skriver netop de kolonner for saeson 3.

import { ageForSeason } from "../../backend/lib/riderSeasonAge.js";
import {
  PROGRESSION_CONFIG,
  seededUnit,
  announcedRetirementAfterSeason,
} from "../../backend/lib/riderProgression.js";
import { noticeFreezePatch } from "../../backend/lib/retirementNotice.js";

// ── LEGACY-rullet (frossen kopi af koden FOER commit 742ba4d30) ───────────────
// Bevidst en kopi og ikke en import: den nuvaerende retirementDecision() tager
// ingen injicerbar hash, og pointen er netop at kunne reproducere det svar
// spillerne saa FOER 7/9. Kopien maa ALDRIG "vedligeholdes" - aendres den, holder
// den op med at vaere en historisk reference. Den bruges kun her, aldrig i motoren.
export function legacyAnnouncedRetirementAfterSeason(rider, activeSeason, cfg = PROGRESSION_CONFIG) {
  const age = ageForSeason(rider?.birthdate, activeSeason);
  if (age == null || rider?.id == null) return false;
  const { windowStartAge, guaranteedAge } = cfg.retirement;
  if (age < windowStartAge) return false;
  if (age >= guaranteedAge) return true;
  const p = (age - windowStartAge) / (guaranteedAge - windowStartAge);
  return seededUnit(`retire:${rider.id}:${activeSeason + 1}`) < p;
}

// ── Ren klassifikation (ingen DB) - det testbare hjerte ──────────────────────
/**
 * Klassificér én rytter: hvad sagde varslet FOER 7/9, hvad siger det I DAG, og
 * er det en divergens spilleren kan have handlet paa?
 *
 * @param {object} rider   { id, firstname, lastname, birthdate, team_id }
 * @param {number} activeSeason
 * @returns {{riderId:string, age:number|null, inSeededWindow:boolean, legacy:boolean, current:boolean, diverged:boolean, direction:"gained"|"lost"|null}}
 */
export function classifyRider(rider, activeSeason, cfg = PROGRESSION_CONFIG) {
  const age = ageForSeason(rider?.birthdate, activeSeason);
  const { windowStartAge, guaranteedAge } = cfg.retirement;
  const inSeededWindow = age != null && age >= windowStartAge && age < guaranteedAge;
  const legacy = legacyAnnouncedRetirementAfterSeason(rider, activeSeason, cfg);
  const current = announcedRetirementAfterSeason(rider, activeSeason, cfg);
  const diverged = legacy !== current;
  return {
    riderId: rider?.id ?? null,
    age,
    inSeededWindow,
    legacy,
    current,
    diverged,
    direction: diverged ? (current ? "gained" : "lost") : null,
  };
}

/**
 * Saml hele populationen til en rapport. Pure - tager raekker ind, giver tal ud,
 * saa den kan testes uden prod.
 *
 * @param {Array<object>} riders  ryttere med team-metadata paahaeftet (isHuman)
 * @param {number} activeSeason
 */
export function buildFreezeReport(riders, activeSeason, cfg = PROGRESSION_CONFIG) {
  const rows = [];
  const totals = {
    ridersScanned: riders.length,
    inSeededWindow: 0,
    legacyAnnounced: 0,
    currentAnnounced: 0,
    diverged: 0,
    gained: 0,
    lost: 0,
    humanInSeededWindow: 0,
    humanDiverged: 0,
    humanGained: 0,
    humanLost: 0,
    freeAgentInSeededWindow: 0,
    freeAgentDiverged: 0,
  };

  for (const rider of riders) {
    const c = classifyRider(rider, activeSeason, cfg);
    const isFreeAgent = rider.team_id == null;
    if (c.inSeededWindow) {
      totals.inSeededWindow += 1;
      if (rider.isHuman) totals.humanInSeededWindow += 1;
      if (isFreeAgent) totals.freeAgentInSeededWindow += 1;
    }
    if (c.legacy) totals.legacyAnnounced += 1;
    if (c.current) totals.currentAnnounced += 1;
    if (c.diverged) {
      totals.diverged += 1;
      totals[c.direction] += 1;
      if (isFreeAgent) totals.freeAgentDiverged += 1;
      if (rider.isHuman) {
        totals.humanDiverged += 1;
        totals[c.direction === "gained" ? "humanGained" : "humanLost"] += 1;
      }
      rows.push({
        riderId: c.riderId,
        name: `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim(),
        age: c.age,
        teamId: rider.team_id ?? null,
        teamName: rider.teamName ?? null,
        isHuman: rider.isHuman === true,
        isFreeAgent,
        contractEndSeason: rider.contract_end_season ?? null,
        legacy: c.legacy,
        current: c.current,
        direction: c.direction,
      });
    }
  }

  rows.sort((a, b) => Number(b.isHuman) - Number(a.isHuman) || (b.age ?? 0) - (a.age ?? 0));
  return { activeSeason, totals, diverged: rows };
}


// ── Reparations-planen (hvad --execute skriver) ──────────────────────────────
/**
 * Byg de raekker frysningen skal skrive.
 *
 * Reglen er ejer-beslutningen 10/9 kl. 16:05 ("A: genopret loeftet + gem
 * varslet"):
 *   · i det seedede vindue (36-39) skrives det svar spillerne saa FOER 7/9,
 *     altsaa `source = "legacy"` (det gamle seededUnit-rul),
 *   · udenfor vinduet skrives det gaeldende svar - som pr. konstruktion er
 *     identisk med legacy, fordi under windowStartAge er svaret altid nej og fra
 *     guaranteedAge altid ja. Der er intet rul at genoprette, kun en alders-regel
 *     at skrive ned.
 *
 * ALLE ryttere faar en raekke. Det er bevidst: efter koerslen er saeson N besvaret
 * for hele populationen, saa hverken cutover eller rytterkortet behoever falde
 * tilbage paa et nyt rul. Ryttere der TRAEDER IND i vinduet senere (akademi-
 * graduering, nygenererede) daekkes af lazy freeze i
 * backend/lib/retirementNotice.js - det hul fra den foerste udgave af dette
 * script er lukket i koden, ikke kun i en kommentar.
 *
 * @param {Array<object>} riders
 * @param {number} activeSeason  saesonen varslet gaelder (rytteren stopper EFTER den)
 * @param {"legacy"|"current"} source
 * @param {string} [now]  ISO-tidsstempel (injicerbart, saa tests er deterministiske)
 * @returns {Array<{riderId:string, announced:boolean, inSeededWindow:boolean, patch:object}>}
 */
export function buildFreezeRows(riders, activeSeason, source, now, cfg = PROGRESSION_CONFIG) {
  if (source !== "legacy" && source !== "current") {
    throw new Error(`ukendt --source: ${source} (brug legacy eller current)`);
  }
  const rows = [];
  for (const rider of riders) {
    const c = classifyRider(rider, activeSeason, cfg);
    if (!c.riderId) continue;
    const announced = c.inSeededWindow ? (source === "legacy" ? c.legacy : c.current) : c.current;
    rows.push({
      riderId: c.riderId,
      announced,
      inSeededWindow: c.inSeededWindow,
      patch: noticeFreezePatch(activeSeason, announced, now),
    });
  }
  return rows;
}
