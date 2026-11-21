// #7947 (ejer 20/11): alle træninger kan køres på Let, Mellem og Hård, "ligesom i gamle dage".
//
// ═══ HVORFOR DET ER EN KONTAKT OG IKKE EN NY FORMEL ══════════════════════════
// Motoren regner allerede på et frit par (fokus, intensitet): vækst, træthed, skaderisiko og
// XP læser intensiteten uafhængigt af sessionen. Bindingen "en session har ét niveau" sidder
// kun i skrive- og visningslaget (trainingDayTypes.js SESSION_INTENSITY, programForChoice,
// normalizeProgram; trainingPrograms.js resolveDayProgram). Kontakten løsner netop den binding
// og intet andet: ingen ny formel, ingen ny kolonne, ingen nye tal.
//
// ═══ DATAFORMEN ══════════════════════════════════════════════════════════════
// training_week_plans.days og training_groups.days får to ADDITIVE nøgler pr. ugedag:
//   effort      : dagens valgte indsats ("easy" | "normal" | "hard"), eller fraværende.
//   slotEfforts : op til PROGRAM_SLOTS felter; null = følg dagens indsats.
// Cellens `intensity` forbliver sessionens standardniveau, så rækken stadig er en gyldig
// programrække for alle de steder, der validerer den, og for den gamle læsesti.
//
// ═══ FORRANG ═════════════════════════════════════════════════════════════════
// Feltets egen indsats, ellers dagens, ellers sessionens standardniveau. Hvile og aktiv
// restitution ignorerer indsatsen (de er hele dage, ikke sessioner). Et løb vinder som før.
//
// Kontakten er binær: kun den eksakte værdi "on" tænder. En manglende række, "beta" eller en
// fejlet læsning er slukket, altså præcis dagens regel. Læses frisk (motorkontakt).
import { readFlagStage } from "./featureStage.js";

export const TRAINING_EFFORT_LEVELS_KEY = "training_effort_levels";

// Indsatsniveauerne. Samme tre ord som sessionernes niveauer (TRAINING_LEVELS i
// trainingDayTypes.js); en test holder de to lister ens.
export const EFFORT_LEVELS = Object.freeze(["easy", "normal", "hard"]);

export function isEffortLevel(value) {
  return typeof value === "string" && EFFORT_LEVELS.includes(value);
}

// Indsatsen for ÉT felt i en ugedags celle: feltets egen, ellers dagens, ellers null
// (= sessionens standardniveau). Ugyldige værdier tæller som fraværende.
export function effortForDayEntry(entry, slotIndex = 0) {
  if (!entry || typeof entry !== "object") return null;
  const idx = Number.isInteger(slotIndex) && slotIndex >= 0 ? slotIndex : 0;
  const slot = Array.isArray(entry.slotEfforts) ? entry.slotEfforts[idx] : null;
  if (isEffortLevel(slot)) return slot;
  return isEffortLevel(entry.effort) ? entry.effort : null;
}

export async function isTrainingEffortLevelsEnabled(supabase) {
  return (await readFlagStage(supabase, TRAINING_EFFORT_LEVELS_KEY, { fresh: true })) === "on";
}
