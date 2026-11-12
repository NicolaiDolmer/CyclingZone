// Prognose-motoren (#3746 trin 7, ejer-beslutning B+C 16/8) — RENE funktioner.
//
// ═══ HVAD DEN ER ════════════════════════════════════════════════════════════
// Profilen viser ikke længere et loft ("hvor højt kan han teoretisk nå") men en
// PROGNOSE ("hvor ender han realistisk"). Ejerens beslutninger 16/8:
//
//   B: prognosen er MOTORENS EGEN fremskrivning — nuværende evne, alder og
//      potentiale-rate frem til peak-alderen, med præcis de konstanter
//      dailyTraining.js kører på. Den kan ikke drifte fra virkeligheden, for
//      den ER virkeligheden kørt frem.
//   C: prognosen antager ikke ÉN træningsstil — den er et BÅND fra "spredt"
//      (fokus hver fjerde dag) til "dedikeret" (fokus hver dag, hårdt). En god
//      sæson løfter bunden; en spildt sæson sænker toppen. Intet hopper når
//      manageren skifter fokus, for planen indgår ikke i beregningen.
//
// Scout-laget (beslutning D) ligger IKKE her — det bor i scoutingReport.js,
// som kalder denne fil med det potentiale-interval scouten kan se. Denne fil
// kender kun ægte tal og er dermed også harness-venlig.
//
// ═══ HVORFOR DEN IKKE KAN DRIFTE ════════════════════════════════════════════
// Alle konstanter importeres fra motoren selv (riderProgression, training,
// academyFlag). Ændrer nogen en motor-konstant, følger prognosen med i samme
// commit — der findes ingen kopi at glemme. Envelopes (SPREDT/DEDIKERET) er de
// eneste egne tal, og de er definitioner af "træningsstil", ikke kalibrering.
//
// Bevidst UDELADT af kæden: staff, faciliteter, bonus-klik og dagsform-noise.
// De løfter/ryster begge kanter ens og ville kræve viewerens kontekst (hvem
// ejer rytteren i morgen?). Prognosen beskriver RYTTEREN, ikke hans nuværende
// arbejdsgiver. developmentProjectionHarness måler at ægte trajektorier ligger
// i båndet (coverage-gate) — det er dér udeladelsen bevises harmløs.
//
// ═══ UNDER XP-MODELLEN (#6110, #7684) ═══════════════════════════════════════
// Gives `developmentXp` (XP-params, kun når development_xp_model gælder for
// datoen), regnes prognosen på samme kilde som potentiale-skønnet:
// standardkarrieren i developmentXpExpectedTop.ts. Endpointet er evnerne i den
// sæson, rytteren topper, og båndets to kanter er den karriere ved potentiale-
// intervallets bund og top. Envelopes er en kurve B-størrelse og bruges ikke under
// XP: én standardkarriere, så skøn og prognose siger det samme om samme rytter
// (ejer 9/11). Uden `developmentXp` er alt som før, bit for bit.

import {
  PROGRESSION_CONFIG, YOUTH_PROGRESSION_CONFIG, ROLE_CLASS_RATE,
  abilityRoleClass, youthRateForPotential, buildCapsForRider, peakAgeForType,
} from "./riderProgression.js";
import { TRAINING_CONFIG } from "./training.js";
import { youthMultiplier } from "./academyFlag.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { DAILY_TRAINING_CONFIG } from "./dailyTraining.js";
import { expectedCareer } from "./developmentXpExpectedTop.ts";
import { abilityValue } from "./weights/displayRecipes.js";

// Trænings-envelopes (beslutning C). SPREDT: rytteren får fokus ca. hver
// fjerde dag på normal intensitet, resten af dagene er evnen off-fokus.
// DEDIKERET: fokus hver dag, hård session. Tallene er definitioner af de to
// stilarter udtrykt i motorens egne multiplikatorer — ikke frie knapper.
export const PROGNOSIS_ENVELOPES = Object.freeze({
  spredt: 0.25 * TRAINING_CONFIG.focusGrowthMult.normal + 0.75 * TRAINING_CONFIG.offFocusMult,
  dedikeret: TRAINING_CONFIG.focusGrowthMult.hard,
});

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function growthFracForAge(age) {
  for (const row of PROGRESSION_CONFIG.growthFractionByAge) if (age <= row.maxAge) return row.frac;
  return PROGRESSION_CONFIG.growthFractionByAge.at(-1).frac;
}

// Fremskriv ÉN evne til peak-alderen. Deterministisk (ingen noise — noise er
// dagsform, og over en karriere midler den ud; envelopes bærer usikkerheden).
//   current   : evnen nu
//   cap       : evnens loft (fladt rolle-tag, evt. tapered — kalderen leverer)
//   age       : rytterens alder nu (heltal, sæson-alder)
//   peakAge   : peak-alderen for rytterens type
//   roleRate  : ROLE_CLASS_RATE for evnens klasse
//   potRate   : youthRateForPotential for det potentiale der fremskrives med
//   envelope  : PROGNOSIS_ENVELOPES.spredt | .dedikeret
export function prognoseAbilityEndpoint({ current, cap, age, peakAge, roleRate, potRate, envelope }) {
  let cur = Number(current) || 0;
  const target = Number(cap) || 0;
  const days = DAILY_TRAINING_CONFIG.daysPerSeason;
  for (let a = Math.round(age); a <= peakAge; a++) {
    const dagsFaktor = (growthFracForAge(a) / days) * envelope * roleRate
      * youthMultiplier(a) * potRate * DAILY_TRAINING_CONFIG.dailyBudgetBoost;
    for (let d = 0; d < days; d++) {
      const gap = target - cur;
      if (gap <= 0) break;
      cur += gap * dagsFaktor;
    }
  }
  return clamp(cur, 0, 99);
}

// Under XP: evnerne i den sæson, standardkarrieren topper (samme kilde som skønnet).
// `riderId` seeder sæsonskiftet som i motoren. Uden evner eller alder: evnerne nu.
// Som før viser prognosen aldrig en evne under dens nu: topper rytteren først efter
// et sæsonfald, står den faldne evne på sit nu.
function xpPrognoseAbilities({ nowAbilities, age, primaryType, secondaryType, potentiale, riderId }, developmentXp) {
  const career = expectedCareer({
    id: riderId ?? "prognosis", abilities: nowAbilities, age, potentiale, primaryType, secondaryType,
  }, developmentXp);
  const out = {};
  for (const ability of VISIBLE_ABILITIES) {
    // NULL er en manglende evne (displayRecipes.abilityValue), ikke et nul.
    const current = abilityValue(nowAbilities?.[ability]);
    if (current === null) continue;
    out[ability] = clamp(Math.max(current, career?.abilities?.[ability] ?? current), 0, 99);
  }
  return out;
}

// Fremskriv ALLE synlige evner for én rytter under (potentiale, envelope).
// caps beregnes med motorens egen buildCapsForRider (fladt tag + taper).
// Returnerer { <ability>: endpoint } — RÅ tal; maskering er kalderens ansvar.
// `developmentXp` (valgfri): XP-params, se toppen af filen.
export function prognoseAbilities({ nowAbilities, age, primaryType, secondaryType, potentiale, envelope, riderId = null, developmentXp = null }) {
  if (developmentXp) {
    return xpPrognoseAbilities({ nowAbilities, age, primaryType, secondaryType, potentiale, riderId }, developmentXp);
  }
  const caps = buildCapsForRider(nowAbilities, { potentiale, age }, primaryType, secondaryType);
  const peakAge = peakAgeForType(primaryType);
  const potRate = youthRateForPotential(potentiale);
  const out = {};
  for (const ability of VISIBLE_ABILITIES) {
    const current = Number(nowAbilities?.[ability]);
    if (!Number.isFinite(current)) continue;
    if (age > peakAge) {
      // Efter peak vokser ingen evne i prognosen — den står på sit nu.
      // (Sæson-declinen vises af udviklings-projektionen, ikke af endpoint-
      // prognosen: "hvor ender han" er allerede sket for en post-peak-rytter.)
      out[ability] = clamp(current, 0, 99);
      continue;
    }
    const klasse = abilityRoleClass(primaryType, secondaryType, ability, YOUTH_PROGRESSION_CONFIG);
    out[ability] = prognoseAbilityEndpoint({
      current, cap: caps[ability], age, peakAge,
      roleRate: ROLE_CLASS_RATE[klasse] ?? ROLE_CLASS_RATE.andenRolle,
      potRate, envelope,
    });
  }
  return out;
}

// Prognose-bånd pr. evne under et POTENTIALE-INTERVAL [potLo, potHi] (scout-
// usikkerheden, beslutning D — kalderen udleder intervallet af scout-niveauet):
//   lo = spredt træning ved potLo   (bunden: langsomste plausible rytter, spredt)
//   hi = dedikeret træning ved potHi (toppen: hurtigste plausible, dedikeret)
// Returnerer { <ability>: { lo, hi } }, heltal, lo <= hi.
// Under XP (`developmentXp`): standardkarrieren ved potLo og ved potHi.
export function prognoseAbilityBands({ nowAbilities, age, primaryType, secondaryType, potLo, potHi, riderId = null, developmentXp = null }) {
  const xp = developmentXp ? { riderId, developmentXp } : {};
  const lo = prognoseAbilities({
    nowAbilities, age, primaryType, secondaryType,
    potentiale: potLo, envelope: PROGNOSIS_ENVELOPES.spredt, ...xp,
  });
  const hi = prognoseAbilities({
    nowAbilities, age, primaryType, secondaryType,
    potentiale: potHi, envelope: PROGNOSIS_ENVELOPES.dedikeret, ...xp,
  });
  const out = {};
  for (const ability of Object.keys(lo)) {
    const a = Math.round(lo[ability]);
    const b = Math.round(hi[ability] ?? lo[ability]);
    out[ability] = { lo: Math.min(a, b), hi: Math.max(a, b) };
  }
  return out;
}
