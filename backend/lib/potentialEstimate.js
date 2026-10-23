// #6110 Udvikling 2.0: potentiale vist som ét skønnet tal + et sikkerhedsord.
//
// Spec: docs/superpowers/specs/2026-10-23-6110-potentiale-et-tal-samlet-design.md §3.
// Ren funktion uden I/O. Bruges i første omgang KUN af harnessen
// (scripts/dev/potentialEstimateHarness6110.mjs); ingen spillerflade læser den
// endnu, og den ændrer intet i spillet.
//
// Adfærd (spec §3.2): skønnet er det sande loft plus en afvigelse, der skrumper
// med viden. Afvigelsen har en fælles del pr. rytter, en del pr. (rytter, hold)
// og en del pr. vidensniveau. Usikkerheden går aldrig under params.minU, så
// selv et sikkert skøn kan ramme lidt ved siden af (ejer 23/10).
//
// Konstruktion, vægte og alle tal er PRIVATE (hard rule 17, balance-internals/6110/)
// og gives som `params`. Der er bevidst ingen standardværdier.

import { seededUnitMixed } from "./riderProgression.js";

export const CERTAINTY_WORDS = Object.freeze(["unsure", "fair", "sure"]);

// Standard-normalfordelt tal fra to seeded uniforme tal (Box-Muller).
function seededNormal(key) {
  const u1 = Math.max(seededUnitMixed(`${key}:a`), 1e-12);
  const u2 = seededUnitMixed(`${key}:b`);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Afvigelsen for ét vidensniveau, klippet til ±clip.
export function deviation(riderId, teamId, levelKey, params) {
  const shared = seededNormal(`pot-est:${params.salt}:${riderId}`);
  const pair = seededNormal(`pot-est:${params.salt}:${riderId}:${teamId}`);
  const perLevel = seededNormal(`pot-est:${params.salt}:${riderId}:${teamId}:${levelKey}`);
  const { shared: ws, pair: wp, level: wl } = params.weights;
  const z = ws * shared + wp * pair + wl * perLevel;
  return Math.max(-params.clip, Math.min(params.clip, z));
}

// Usikkerhed (halv-spredning i ratingpoint) og nøglen for vidensniveauet.
// Returnerer null, når holdet intet ved (fremmed rytter uden kig, eller egen
// ungdomsrytter under grænsen for første skøn): så vises intet tal.
//
// knowledge:
//   own                 true for holdets egen rytter
//   trainingDates       antal rigtige datoer med afregnet træning på holdet (S18)
//   staffSpeed          >= 0, hvor meget træner/facilitet fremskynder egen viden
//   looks               antal kig (scout-niveau, capped af params)
//   bestScoutTier       scoutens niveau ved det bedste kig (1-5), null = standardscout
export function knowledgeLevel(knowledge, params) {
  const k = knowledge || {};
  if (k.own) {
    const dates = Math.max(0, Number(k.trainingDates) || 0);
    if (dates < params.own.firstEstimateDates) return null;
    const effective = dates * (1 + Math.max(0, Number(k.staffSpeed) || 0) * params.own.staffSpeedWeight);
    const steps = params.own.steps; // [{ fromDates, u }] stigende fromDates
    let idx = 0;
    steps.forEach((s, i) => { if (effective >= s.fromDates) idx = i; });
    return { key: `own${idx}`, u: Math.max(params.minU, steps[idx].u) };
  }
  const looks = Math.min(Math.max(0, Number(k.looks) || 0), params.scout.maxLooks);
  if (looks <= 0) return null;
  const tier = Math.min(5, Math.max(1, Number(k.bestScoutTier) || params.scout.defaultTier));
  const u = params.scout.uByLooks[looks - 1] * params.scout.tierFactor[tier - 1];
  return { key: `s${looks}t${tier}`, u: Math.max(params.minU, u) };
}

export function uncertaintyFor(knowledge, params) {
  return knowledgeLevel(knowledge, params)?.u ?? null;
}

export function certaintyWord(u, params) {
  if (u == null) return null;
  if (u <= params.words.sureAtOrBelow) return "sure";
  if (u <= params.words.fairAtOrBelow) return "fair";
  return "unsure";
}

// Det tal spilleren ser.
//   truePot        rytterens sande loft i ratingskala (1-99)
//   currentRating  rytterens nuværende rating; skønnet vises aldrig under den
// Returnerer { hidden: true } eller { hidden: false, value, u, certainty }.
export function estimatePotential({ truePot, currentRating, riderId, teamId, knowledge }, params) {
  const level = knowledgeLevel(knowledge, params);
  if (!level) return { hidden: true };
  const z = deviation(riderId, teamId, level.key, params);
  const raw = Number(truePot) + z * level.u;
  const floor = Math.max(1, Math.round(Number(currentRating) || 1));
  const value = Math.max(floor, Math.min(99, Math.round(raw)));
  return { hidden: false, value, u: level.u, certainty: certaintyWord(level.u, params) };
}
