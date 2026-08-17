/**
 * #3514 fase 1b: navngivne bestyrelsesmedlemmer, navnepulje efter klub-DNA.
 * =========================================================================
 * Ejer-beslutning 8 af 7/8: "navnepulje følger klub-DNA" (italiensk klassiker →
 * italienske navne, skandinavisk udvikling → nordiske osv.).
 *
 * Spec §2 princip 3: "Personer i front. 5 navngivne medlemmer; hvert mål ejes af
 * et medlem; formanden taler." I dag har `team_board_members` kun en
 * `archetype_key`, medlemmerne har ingen navne, og derfor heller ingen ansigt.
 *
 * Generatoren er REN og DETERMINISTISK: samme (team_id, archetype_key) giver altid
 * samme navn. Ingen DB-kolonne behøver at gemme navnet i fase 1, det udledes.
 * Det betyder også at et navn ikke kan "forsvinde" ved en migration, og at fase 2
 * kan vise navne uden at vente på endnu en backfill.
 *
 * Navnepuljerne genbruges fra `fictionalRiderNames.js` (#669) frem for at blive
 * duplikeret. En ny pulje ville drive fra hinanden i forhold til rytternavnene, og
 * så ville en italiensk klub få italienske ryttere og halv-italienske direktører.
 */

import { NAME_CLUSTERS, ISO_TO_CLUSTER } from "./fictionalRiderNames.js";
import { BOARD_CLUB_DNA, DNA_KEYS } from "./boardClubDna.js";

/**
 * DNA → navne-cluster. Udledes af DNA'ets `national_affinity` (første land der har
 * et cluster), så en ny DNA automatisk får den rigtige pulje uden at nogen skal
 * huske at opdatere en tabel her. `sprint_kommerciel` har fx en bred affinity og
 * lander derfor på sin første match.
 */
export function clusterForDna(dnaKey) {
  const dna = BOARD_CLUB_DNA?.[dnaKey];
  const affinity = Array.isArray(dna?.national_affinity) ? dna.national_affinity : [];
  for (const iso of affinity) {
    const cluster = ISO_TO_CLUSTER[iso];
    if (cluster && NAME_CLUSTERS[cluster]) return cluster;
  }
  // Ukendt/manglende DNA → anglo. Bevidst valg frem for at kaste: et hold uden
  // DNA skal stadig kunne vise navngivne medlemmer.
  return "anglo";
}

/**
 * Stabil 32-bit hash (FNV-1a). Vi bruger ikke tegn-sum som `sampleReactionForFeedback`,
 * fordi tegn-sum kolliderer voldsomt på strenge der kun adskiller sig i rækkefølge,
 * og de fem arketype-nøgler for ét hold ligger tæt på hinanden.
 */
function hashSeed(input) {
  let hash = 0x811c9dc5;
  const text = String(input ?? "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Ét navn til ét medlem. `salt` lader kalderen skubbe et navn videre i puljen ved
 * kollision inden for samme hold, uden at ændre resten af holdet.
 */
export function generateMemberName({ teamId, archetypeKey, dnaKey, salt = 0 } = {}) {
  const cluster = NAME_CLUSTERS[clusterForDna(dnaKey)] ?? NAME_CLUSTERS.anglo;
  const base = hashSeed(`${teamId ?? ""}:${archetypeKey ?? ""}:${dnaKey ?? ""}`);
  const firstIdx = (base + salt) % cluster.first.length;
  // Andet hash-trin på efternavnet, ellers følger fornavn og efternavn hinanden
  // gennem puljerne og to hold med samme arketype får samme kombination.
  const lastIdx = (hashSeed(`${base}:last:${salt}`)) % cluster.last.length;
  return {
    first_name: cluster.first[firstIdx],
    last_name: cluster.last[lastIdx],
    full_name: `${cluster.first[firstIdx]} ${cluster.last[lastIdx]}`,
    // Initial-avatar (spec §3.4: "initial-avatarer", stroke-ikoner, emoji udgår).
    initials: `${cluster.first[firstIdx][0]}${cluster.last[lastIdx][0]}`,
    name_cluster: clusterForDna(dnaKey),
  };
}

/**
 * Navne til et helt bestyrelsesrum. Garanterer at ingen to medlemmer på SAMME hold
 * får identisk fulde navn, et bestyrelsesrum med to "Marco Conti" ville læse som
 * en bug, ikke som en tilfældighed.
 */
export function generateBoardMemberNames({ teamId, members = [], dnaKey } = {}) {
  const taken = new Set();
  return (members || []).map((member) => {
    const archetypeKey = typeof member === "string" ? member : member?.archetype_key;
    let salt = 0;
    let name = generateMemberName({ teamId, archetypeKey, dnaKey, salt });
    // Puljerne er 18 fornavne × 28 efternavne = 504 kombinationer pr. cluster, så
    // loftet her rammes reelt aldrig; det er en garanti mod uendelig løkke, ikke
    // en forventet sti.
    while (taken.has(name.full_name) && salt < 32) {
      salt += 1;
      name = generateMemberName({ teamId, archetypeKey, dnaKey, salt });
    }
    taken.add(name.full_name);
    return {
      ...(typeof member === "string" ? { archetype_key: member } : member),
      ...name,
    };
  });
}

export const SUPPORTED_DNA_KEYS = DNA_KEYS;
