// #5497 R3 — typefri karriereprognose inde i værdiberegningen (DEV-ONLY).
//
// Ejer-valg 7 (22/9): prognosen for FREMTIDIGE evner er typefri — kun inde i
// værdiberegningen. Faktisk træning/udvikling ændres ikke. Potentiale-raten er
// uændret (riderCareerNpv.js' frosne tabel, #3750/#3449 ejer frysningen).
//
// Hvad typen gør i v4-prognosen (riderCareerNpv.js expectedNextAbilities):
//   • signatureFactor(type, evne) sætter hvor meget loft hver evne får
//     (1 = speciale, 0 = svaghed, ellers et fast mellemniveau)
//   • isSig (samme faktor ≥ 1) sætter hvor hurtigt evnen falder efter topalder
//   • peakAgeForType — allerede fælles (PROGRESSION_CONFIG.peakAgeByType = null)
//
// Typefri afløser: "speciale" udledes af rytterens EGEN evneprofil, glat:
//
//   z_i   = (evne_i − profil-reference) / profil-bredde
//   sig_i = logistisk(z_i) ∈ (0, 1)
//   loft-faktor_i  = off + (1 − off) · sig_i        (off = mellemniveauet fra
//                                                      PROGRESSION_CONFIG)
//   fald_i         = sig_i · fald(speciale) + (1 − sig_i) · fald(ikke-speciale)
//
//   profil-reference = snit + k·spredning af rytterens egne evner
//   profil-bredde    = max(spredning · s, gulv)
//
// Kun evne-tal indgår. To ryttere med samme evner, alder og potentiale får
// derfor identisk prognose, uanset label. Og fordi sig er glat i evnerne, kan
// ét evnepoint ikke vippe en evne fra "svaghed" til "speciale" i ét hop.
//
// Paritet med v4 (bevist i valuationTypefree.test.js): sendes en signaturfunktion
// ind der returnerer netop v4's type-faktor, regner stepTypefree bit-identisk
// med expectedNextAbilities. Dvs. det ENESTE der er ændret er kilden til
// speciale-graden — vækstkurve, fald, potentiale-rate og afrunding er de samme.

import { VISIBLE_ABILITIES } from "../abilityDerivation.js";
import {
  PROGRESSION_CONFIG,
  headroomForPotential,
  stepAbility,
  youthRateForPotential,
} from "../riderProgression.js";

// Kopi af riderCareerNpv.js' FROZEN_NPV_RATE_BY_POTENTIAL (modul-privat dér).
// Offentlige tal i forvejen. Paritetstesten fanger enhver drift mellem de to.
const FROZEN_NPV_RATE_BY_POTENTIAL = Object.freeze({ 1: 0.6, 2: 0.78, 3: 0.92, 4: 1.06, 5: 1.2, 6: 1.35 });

export function frozenNpvRateTypefree(potentiale) {
  return youthRateForPotential(potentiale, { rateByPotential: FROZEN_NPV_RATE_BY_POTENTIAL });
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const logistic = (z) => 1 / (1 + Math.exp(-z));

// Profil-signatur: speciale-grad pr. evne ud fra rytterens egne evner.
// Returnerer { [evne]: sig ∈ (0,1) }. Beregnes ÉN gang fra start-evnerne (som
// v4's caps), så prognosen er deterministisk.
export function profileSignature(abilities = {}, profile = {}) {
  const k = Number.isFinite(Number(profile.ref_sd)) ? Number(profile.ref_sd) : 0.5;
  const s = Number.isFinite(Number(profile.width_sd)) ? Number(profile.width_sd) : 0.5;
  const floor = Number.isFinite(Number(profile.width_floor)) ? Number(profile.width_floor) : 2;
  const vals = [];
  for (const a of VISIBLE_ABILITIES) {
    const v = Number(abilities?.[a]);
    if (Number.isFinite(v)) vals.push(v);
  }
  const sig = {};
  if (!vals.length) return sig;
  const mean = vals.reduce((x, y) => x + y, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((x, y) => x + (y - mean) ** 2, 0) / vals.length);
  const ref = mean + k * sd;
  const width = Math.max(sd * s, floor);
  for (const a of VISIBLE_ABILITIES) {
    const v = Number(abilities?.[a]);
    if (!Number.isFinite(v)) continue;
    sig[a] = logistic((v - ref) / width);
  }
  return sig;
}

// Loft-faktor fra speciale-grad (samme skala som v4's signatureFactor).
export function capFactorFromSig(sig, cfg = PROGRESSION_CONFIG) {
  const off = cfg.offTypeHeadroomFactor;
  return off + (1 - off) * clamp(Number(sig) || 0, 0, 1);
}

// Loft pr. evne. Samme formel som riderProgression.abilityCap, men med
// profil-faktoren i stedet for type-faktoren.
export function buildCapsTypefree(baseline, sigByAbility, potentiale, { factorFn = (sig) => capFactorFromSig(sig), cfg = PROGRESSION_CONFIG } = {}) {
  const headroom = headroomForPotential(potentiale, cfg);
  const caps = {};
  for (const a of VISIBLE_ABILITIES) {
    const base = baseline?.[a];
    if (base == null) continue;
    caps[a] = clamp(Math.round(base + headroom * factorFn(sigByAbility?.[a], a)), 0, 99);
  }
  return caps;
}

// Ét forventet sæson-skridt for alle evner (støj nulstillet, som v4).
//   sigByAbility: { evne: sig ∈ [0,1] } — sig 1 ≙ speciale, 0 ≙ ikke-speciale.
// Vækstfasen er identisk med v4 (loftet bærer speciale-graden). Faldfasen
// interpolerer mellem stepAbility(isSig=true) og stepAbility(isSig=false), så
// den er glat i sig og bit-identisk med v4 når sig ∈ {0, 1}.
export function stepTypefree(abilities, caps, sigByAbility, { potentiale, age }, cfg = PROGRESSION_CONFIG) {
  const peakAge = cfg.peakAge;
  const growthMult = frozenNpvRateTypefree(potentiale);
  const next = {};
  for (const a of VISIBLE_ABILITIES) {
    const cur = abilities?.[a];
    if (cur == null) continue;
    const cap = caps?.[a];
    const sig = clamp(Number(sigByAbility?.[a]) || 0, 0, 1);
    if (age <= peakAge || sig >= 1 || sig <= 0) {
      next[a] = stepAbility(cur, cap, age, peakAge, sig >= 1, 0.5, cfg, growthMult);
    } else {
      const hi = stepAbility(cur, cap, age, peakAge, true, 0.5, cfg, growthMult);
      const lo = stepAbility(cur, cap, age, peakAge, false, 0.5, cfg, growthMult);
      next[a] = sig * hi + (1 - sig) * lo;
    }
  }
  return next;
}
