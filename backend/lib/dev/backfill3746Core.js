// backend/lib/dev/backfill3746Core.js
// ============================================================================
// REN PLANLÆGNINGS-KERNE til trin 7-backfillen (#3746, #3794). Ingen DB, ingen
// I/O — samme kilde bruges af scripts/dev/lofterApply3746.mjs (både den
// prod-rettede kørsel OG --snapshot-dry-runnet mod
// docs/snapshots/3591/riders_full.json) og af backfill3746Core.test.js.
//
// HVAD DEN GØR. For hver rytter-række genberegner den `ability_caps` med den
// NYE trin-7-formel (buildCapsForRider — fladt rolle-tag, ingen potentiale,
// ingen gulv) og sammenligner mod den gemte værdi. Rører intet i DB selv —
// det er scriptets ansvar; denne fil er kun beslutningen om HVAD der skal stå.
//
// TYPE-VALGET spejler PRÆCIS deriveForRiderIds i backend/lib/backfillCores.js
// (linje ~294-297): har rytteren et persisteret archetype_draw, ER DET
// identiteten — loftet formes af det trukne anlæg, ikke af den (måske ældre)
// persisterede type. Uden et draw bruges den persisterede primary_type/
// secondary_type direkte — INGEN bootstrap-gæt her, for scopet er ryttere der
// allerede HAR en rider_derived_abilities-række og dermed allerede en type
// (bootstrap-stien i backfillCores.js gælder kun helt nye ryttere).
//
// ALDERS-KONTRAKTEN (#3591): age beregnes ALTID via ageForSeason(birthdate,
// seasonNumber) og sendes eksplicit til buildCapsForRider — aldrig udeladt,
// aldrig et rå felt fra en anden kilde. Se buildCapsForRider's egen
// TypeError-guard i riderProgression.js for hvorfor.
//
// GULVET ER FJERNET I TRIN 7 (#3794): et nyt loft der ligger under rytterens
// nuværende evne er nu LOVLIGT — designet, ikke en fejl. Evnen står stille
// indtil loftet indhenter den (dailyAbilityDelta giver gap=0, ikke tab). Denne
// kerne GATER derfor ikke på det brud — den TÆLLER det (floorBreaches) som
// informations-metrik i dry-run-rapporten.
//
// TO TAL FOR "EVNE > LOFT" — DE ER IKKE DET SAMME. Design-sessionens 16/8
// citerede tal (898 pladser / 553 ryttere, #3746-issuet) er MÅLT MOD DET
// RÅ, FLADE ROLLE-TAG (buildYouthCaps) — UDEN alders-taperen. Det tal denne
// backfill rent faktisk SKRIVER er buildCapsForRider's output, som tapered
// loftet ned for enhver rytter over peakAge (28). Verificeret mod
// docs/snapshots/3591 (16/8, dette script): rå tag ⇒ 894 pladser/553
// ryttere (matcher design-tallet); TAPERET (det der skrives) ⇒ langt flere,
// fordi mange karriere-ryttere allerede har passeret peak. Begge tal
// rapporteres derfor separat (floorBreaches = det skrevne/reelle,
// floorBreachesFlatTag = design-sessionens sammenligningstal) — vælg ALDRIG
// kun ét uden at sige hvilket.

import { VISIBLE_ABILITIES } from "../abilityDerivation.js";
import { buildCapsForRider, buildYouthCaps, abilityRoleClass } from "../riderProgression.js";
import { ageForSeason } from "../riderSeasonAge.js";

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const EPS = 1e-9;

export function capsEqual(a, b) {
  return VISIBLE_ABILITIES.every((k) => num(a?.[k]) === num(b?.[k]));
}

// Type-valg: archetype_draw hvis sat, ellers de persisterede typer. Spejler
// deriveForRiderIds (backend/lib/backfillCores.js, linje ~294-297).
export function selectRoleTypes({ archetypeDraw, persistedPrimaryType, persistedSecondaryType } = {}) {
  if (archetypeDraw && archetypeDraw.primary) {
    return { primary: archetypeDraw.primary, secondary: archetypeDraw.secondary || null, source: "draw" };
  }
  return { primary: persistedPrimaryType ?? null, secondary: persistedSecondaryType ?? null, source: "persisted" };
}

/**
 * Planlæg ÉN rytter.
 *
 * row: {
 *   riderId, firstname, lastname, birthdate, potentiale, teamId,
 *   archetypeDraw: { primary, secondary } | null,
 *   persistedPrimaryType, persistedSecondaryType,
 *   currentAbilities: { climbing, sprint, ... },  // nuværende evner
 *   currentCaps: { climbing, sprint, ... },        // det GEMTE loft ("gamle")
 * }
 * seasonNumber: aktiv sæsons nummer (ageForSeason-ankeret).
 *
 * Returnerer ALTID et fuldt beregnet objekt — også når loftet er uændret.
 * Population-stats (fx floorBreaches, rolleklasse-fordeling) kræver ALLE
 * rytterne, ikke kun dem der faktisk ændrer loft.
 */
export function planRider(row, seasonNumber) {
  const age = ageForSeason(row.birthdate ?? null, seasonNumber);
  const { primary, secondary, source } = selectRoleTypes(row);

  const abilities = {};
  for (const k of VISIBLE_ABILITIES) {
    if (row.currentAbilities?.[k] != null) abilities[k] = Number(row.currentAbilities[k]);
  }

  const nye = buildCapsForRider(abilities, { potentiale: row.potentiale, age }, primary, secondary);
  const gamle = row.currentCaps || {};
  // Rå, UTAPERET tag — se filens topkommentar "TO TAL FOR EVNE > LOFT".
  const flatTag = buildYouthCaps(row.potentiale, primary, secondary);

  const perAbility = {};
  const floorBreaches = [];
  const floorBreachesFlatTag = [];
  for (const k of VISIBLE_ABILITIES) {
    const gammelVaerdi = num(gamle[k]);
    const nyVaerdi = num(nye[k]);
    const delta = nyVaerdi - gammelVaerdi;
    perAbility[k] = {
      gamle: gammelVaerdi,
      nye: nyVaerdi,
      delta,
      roleClass: abilityRoleClass(primary, secondary, k),
    };
    if (abilities[k] != null && Number(abilities[k]) > nyVaerdi + EPS) {
      floorBreaches.push(k);
    }
    if (abilities[k] != null && Number(abilities[k]) > num(flatTag[k]) + EPS) {
      floorBreachesFlatTag.push(k);
    }
  }

  return {
    id: row.riderId,
    navn: [row.firstname, row.lastname].filter(Boolean).join(" ") || row.riderId,
    ejer: row.teamId ? "hold" : "fri",
    age,
    primary,
    secondary,
    typeSource: source,
    gamle,
    nye,
    perAbility,
    floorBreaches,
    floorBreachesFlatTag,
    changed: !capsEqual(gamle, nye),
  };
}

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length));
  return sortedAsc[idx];
}

function statsFor(values) {
  if (!values.length) return { n: 0, median: null, p90: null, max: null };
  const s = [...values].sort((a, b) => a - b);
  return { n: s.length, median: percentile(s, 0.5), p90: percentile(s, 0.9), max: s[s.length - 1] };
}

export const ROLE_CLASS_ORDER = Object.freeze(["signatur", "sekundaer", "haandvaerk", "andenRolle", "svaghed"]);

/**
 * Aggregerede tal over en FULD population af `planRider`-outputs (dvs. også
 * de uændrede — se planRider's kommentar for hvorfor).
 */
export function summarizePlan(computed) {
  const ridersChanged = computed.filter((c) => c.changed);

  const perAbility = {};
  for (const k of VISIBLE_ABILITIES) {
    let up = 0, down = 0, unchanged = 0;
    const upDeltas = [];
    const downDeltas = [];
    for (const c of computed) {
      const d = c.perAbility[k].delta;
      if (d > EPS) { up++; upDeltas.push(d); }
      else if (d < -EPS) { down++; downDeltas.push(-d); }
      else unchanged++;
    }
    perAbility[k] = { up, down, unchanged, loeftStats: statsFor(upDeltas), saenkningStats: statsFor(downDeltas) };
  }

  const perRoleClass = {};
  for (const rc of ROLE_CLASS_ORDER) {
    let up = 0, down = 0, unchanged = 0, floorBreaches = 0;
    const upDeltas = [];
    const downDeltas = [];
    for (const c of computed) {
      for (const k of VISIBLE_ABILITIES) {
        const pa = c.perAbility[k];
        if (pa.roleClass !== rc) continue;
        if (pa.delta > EPS) { up++; upDeltas.push(pa.delta); }
        else if (pa.delta < -EPS) { down++; downDeltas.push(-pa.delta); }
        else unchanged++;
        if (c.floorBreaches.includes(k)) floorBreaches++;
      }
    }
    perRoleClass[rc] = { up, down, unchanged, floorBreaches, loeftStats: statsFor(upDeltas), saenkningStats: statsFor(downDeltas) };
  }

  const allUp = [];
  const allDown = [];
  let totalFloorBreaches = 0;
  let totalFloorBreachesFlatTag = 0;
  const ridersWithFloorBreach = new Set();
  const ridersWithFlatTagBreach = new Set();
  for (const c of computed) {
    totalFloorBreaches += c.floorBreaches.length;
    totalFloorBreachesFlatTag += c.floorBreachesFlatTag.length;
    if (c.floorBreaches.length) ridersWithFloorBreach.add(c.id);
    if (c.floorBreachesFlatTag.length) ridersWithFlatTagBreach.add(c.id);
    for (const k of VISIBLE_ABILITIES) {
      const d = c.perAbility[k].delta;
      if (d > EPS) allUp.push(d);
      else if (d < -EPS) allDown.push(-d);
    }
  }

  return {
    ridersTotal: computed.length,
    ridersChanged: ridersChanged.length,
    ridersUnchanged: computed.length - ridersChanged.length,
    ridersHoldChanged: ridersChanged.filter((c) => c.ejer === "hold").length,
    ridersFriChanged: ridersChanged.filter((c) => c.ejer === "fri").length,
    perAbility,
    perRoleClass,
    // Det REELLE tal — det der faktisk skrives (buildCapsForRider, tapered).
    totalFloorBreaches,
    ridersWithFloorBreach: ridersWithFloorBreach.size,
    // Design-sessionens sammenligningstal (rå rolle-tag, ingen taper) — se
    // filens topkommentar "TO TAL FOR EVNE > LOFT" for hvorfor de to afviger.
    totalFloorBreachesFlatTag,
    ridersWithFlatTagBreach: ridersWithFlatTagBreach.size,
    loeftStats: statsFor(allUp),
    saenkningStats: statsFor(allDown),
  };
}

/**
 * Byg den fulde plan for en liste af rytter-rækker (se planRider for row-
 * kontrakten). Returnerer { computed, plan, stats } hvor `plan` kun er de
 * rækker hvor loftet faktisk ændrer sig — dét der skal SKRIVES.
 */
export function buildPlan(rows, seasonNumber) {
  const computed = rows.map((r) => planRider(r, seasonNumber));
  const plan = computed.filter((c) => c.changed);
  return { computed, plan, stats: summarizePlan(computed) };
}
