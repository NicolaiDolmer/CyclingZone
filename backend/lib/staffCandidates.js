// Deterministisk staff-kandidat-generering. Seed = teamId+season+role → stabil på refresh.
// Navne: fiktive, kuraterede (anti-AI-slop, ingen ægte personer) — samme disciplin som
// SPONSOR_NAME_POOL. Udvid gerne puljen, men kuratér manuelt.
import { getStaffSalary } from "./facilityEngine.js";

export const STAFF_NAME_POOL = Object.freeze([
  "Marc Vandenbroucke", "Sofie Lindqvist", "Aldo Terranova", "Pieter Claes", "Jonas Weinberger",
  "Camille Roussel", "Iker Zabaleta", "Tomasz Wielgosz", "Bram Van Dijck", "Elena Sarti",
  "Rune Kristoffersen", "Mathieu Perrin", "Karel Novotny", "Ane Iturriaga", "Stefan Gruber",
  "Lucie Blanchard", "Marco Bellandi", "Jens Ostergaard", "Patrick O'Meara", "Ingrid Solheim",
  "Diego Salazar", "Milan Kovac", "Astrid Nyberg", "Thibaut Lemaire", "Paolo Ferretti",
  "Wout Segers", "Katarzyna Mazur", "Henrik Dahlgren", "Aurelien Costa", "Nils Brandt",
  "Rosa Delgado", "Viktor Hlinka", "Maren Vollan", "Julien Charrier", "Enzo Marini",
  "Sanne De Witte", "Ondrej Blaha", "Freja Holmgren", "Bastien Moreau", "Luca Antonelli",
]);

// mulberry32 — lille deterministisk PRNG (ingen Math.random: reproducérbarhed er kontrakten).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function generateStaffCandidates({ teamId, seasonNumber, role, facilityTier }) {
  const rand = mulberry32(hashString(`${teamId}:${seasonNumber}:${role}`));
  // facilityTier 0 giver stadig tier-1-kandidater (teaser i UI); selve ansættelsen blokeres af validateHire (staff-tier > facilitets-tier).
  const maxTier = Math.max(1, Math.min(5, facilityTier));
  const candidates = [];
  const usedNames = new Set();
  while (candidates.length < 3) {
    const name = STAFF_NAME_POOL[Math.floor(rand() * STAFF_NAME_POOL.length)];
    if (usedNames.has(name)) continue;
    usedNames.add(name);
    const tier = 1 + Math.floor(rand() * maxTier);
    candidates.push({ name, role, tier, salary: getStaffSalary(tier) });
  }
  return candidates;
}
