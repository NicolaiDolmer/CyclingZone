// Deterministisk staff-kandidat-generering. Seed = teamId+season+role → stabil på refresh.
// Navne: fiktive, kuraterede (anti-AI-slop, ingen ægte personer) — samme disciplin som
// SPONSOR_NAME_POOL. Udvid gerne puljen, men kuratér manuelt.
import { staffSalaryFor } from "./facilityConstants.js";
import { deriveStaffAbilities, topSpecialization } from "./staffAbilityDerivation.js";

// #2643-opfølgning: 40 navne gav ~78% kollisionsrate på tværs af hold i prod
// (birthday paradox ved 40 hold × 5 roller) — spillere læste det som "samme person
// ansat to gange". Puljen er udvidet til 150; de oprindelige 40 står FØRST og
// uændret (allerede ansatte team_staff-rækker beholder deres navn i DB).
export const STAFF_NAME_POOL = Object.freeze([
  "Marc Vandenbroucke", "Sofie Lindqvist", "Aldo Terranova", "Pieter Claes", "Jonas Weinberger",
  "Camille Roussel", "Iker Zabaleta", "Tomasz Wielgosz", "Bram Van Dijck", "Elena Sarti",
  "Rune Kristoffersen", "Mathieu Perrin", "Karel Novotny", "Ane Iturriaga", "Stefan Gruber",
  "Lucie Blanchard", "Marco Bellandi", "Jens Ostergaard", "Patrick O'Meara", "Ingrid Solheim",
  "Diego Salazar", "Milan Kovac", "Astrid Nyberg", "Thibaut Lemaire", "Paolo Ferretti",
  "Wout Segers", "Katarzyna Mazur", "Henrik Dahlgren", "Aurelien Costa", "Nils Brandt",
  "Rosa Delgado", "Viktor Hlinka", "Maren Vollan", "Julien Charrier", "Enzo Marini",
  "Sanne De Witte", "Ondrej Blaha", "Freja Holmgren", "Bastien Moreau", "Luca Antonelli",
  // ── Udvidelse 2026-07-18 (håndkurateret, fiktive — ingen kendte cykelnavne) ──
  "Stijn Vermassen", "Dries Callewaert", "Lotte Vermeire", "Maarten Deconinck", "Els Vanhoutte",
  "Ward Plancke", "Joris Ravensbergen", "Femke Zijlstra", "Ruben Hoekstra", "Gijs Meulendijk",
  "Annelies Verstraete", "Romain Delacroix", "Margaux Vasseur", "Etienne Chabrol", "Clement Barbier",
  "Amandine Leroux", "Fabrice Toussaint", "Nadine Girardet", "Olivier Rochefort", "Gaspard Meunier",
  "Pauline Verdier", "Yannick Sabatier", "Fabrizio Montanari", "Chiara Lombardi", "Dario Pellegrino",
  "Silvia Caruso", "Matteo Fabbri", "Giulia Serafini", "Renzo Cattaneo", "Alessia Vitale",
  "Corrado Bianchi", "Ornella Ricci", "Tullio Sabbatini", "Unai Etxeberria", "Nerea Aguirre",
  "Joaquin Baeza", "Maite Arriaga", "Gorka Mendizabal", "Alvaro Castejon", "Itziar Urrutia",
  "Ramon Escudero", "Blanca Navarrete", "Xabier Goikoetxea", "Carmen Villalba", "Mads Brogaard",
  "Signe Kjeldsen", "Anders Vestergaard", "Mette Juhl", "Troels Bundgaard", "Kirsten Hedegaard",
  "Lasse Winther", "Birgitte Krogh", "Sindre Halvorsen", "Tuva Eikeland", "Eirik Sandvik",
  "Kjetil Moldestad", "Solveig Haugland", "Torstein Lunde", "Ida Fossum", "Gustav Ekelund",
  "Linnea Sandell", "Oskar Melin", "Ebba Norling", "Joel Cederholm", "Vera Ahlberg",
  "Tilda Rosenqvist", "Matthias Kellner", "Franziska Ebner", "Lukas Steinbach", "Verena Achleitner",
  "Florian Reindl", "Heike Sommerfeld", "Urs Kaufmann", "Leonie Hartwig", "Marek Zawadzki",
  "Agnieszka Pilarska", "Bartosz Krupa", "Dorota Lisowska", "Szymon Gajewski", "Ewa Sobczak",
  "Jakub Prochazka", "Tereza Dvorakova", "Radek Svoboda", "Lenka Horakova", "Matej Kral",
  "Zuzana Beranova", "Ziga Kranjc", "Petra Zupancic", "Anze Kavcic", "Marko Horvat",
  "Rui Carvalho", "Ines Figueiredo", "Nuno Sarmento", "Beatriz Antunes", "Callum Prewett",
  "Declan Whelan", "Fiona MacAllister", "Harry Pemberton", "Niamh Gallagher", "Gareth Ludlow",
  "Eleanor Braithwaite", "Esteban Quintero", "Valentina Cardenas", "Mauricio Zuleta", "Camila Restrepo",
  "Hernan Bocanegra", "Toby Lawson", "Bridget Kennealy", "Wade Culpepper", "Sasha Delaney",
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
    // #2216 A4: berig med afledt overall + top-specialisering til UI-visning/
    // -sammenligning. Deterministisk (samme (role,tier,name) → samme profil).
    const profile = deriveStaffAbilities({ role, tier, name });
    candidates.push({
      name, role, tier,
      // #2216 A4 (Q1): rating-drevet løn — staffSalaryFor(overall) i stedet for den flade
      // tier-tabel, så lønnen bider proportionalt med kandidatens faktiske kvalitet.
      // Deterministisk (overall er deterministisk af (role,tier,name)).
      salary: staffSalaryFor(profile.overall),
      overall: profile.overall,
      topSpecialization: topSpecialization(profile),
    });
  }
  return candidates;
}
