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
//   z_i   = (evne_i − profil-reference_i) / profil-bredde_i
//   sig_i = logistisk(z_i) ∈ (0, 1)
//   loft-faktor_i  = sig_i                           (v2: kun styrker får loft)
//   fald_i         = sig_i · fald(speciale) + (1 − sig_i) · fald(ikke-speciale)
//
//   profil-reference_i = snit + k·spredning af rytterens ØVRIGE evner (uden i)
//   profil-bredde_i    = max(spredning af de øvrige · s, gulv)
//
// Kun evne-tal indgår. To ryttere med samme evner, alder og potentiale får
// derfor identisk prognose, uanset label. Og fordi sig er glat i evnerne, kan
// ét evnepoint ikke vippe en evne fra "svaghed" til "speciale" i ét hop.
//
// v2 (#5497, 23/9) — to rettelser efter målingen 22/9:
//   1. Udvikl-og-sælg: v1 gav ALLE evner mindst mellemniveauets loft
//      (off + (1 − off)·sig ≥ off). v4 har tre klasser: speciale (fuldt loft),
//      neutral (mellemniveau) og svaghed (intet loft). Uden svagheds-klassen
//      delte v1 mere loft ud end v4 i alt, og mest til svage evner, som løfter
//      overall og dermed den konvekse elitepræmie ved horisonten. Rettelse:
//      loft-faktoren er speciale-graden selv (svaghed → 0, styrke → 1), og
//      profil-parametrene vælges så det samlede loft-budget i populationen
//      svarer til v4's (målescriptet viser valget). Kun FORDELINGEN mellem
//      evner kommer nu fra rytterens egne tal; mængden er v4's.
//   2. Glathed: v1 regnede referencen MED evnen selv, så +1 på en evne også
//      hævede dens egen reference. Nu regnes reference og bredde for evne i
//      uden evne i. Et evnepoint hæver derfor altid evnens egen speciale-grad.
//      (En relativ profil kan stadig ikke være helt monoton: +1 på én evne gør
//      de ØVRIGE styrker en anelse mindre fremtrædende. Målt i rapporten.)
//
// v1-opførslen kan vælges eksplicit (profile.reference = "including_self",
// profile.headroom = "off_floor") — kun til før/efter-målingen.
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

export const PROFILE_REFERENCE_MODES = Object.freeze(["leave_one_out", "including_self"]);
export const PROFILE_HEADROOM_MODES = Object.freeze(["strengths_only", "off_floor"]);

const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : fallback);
const meanSd = (vals) => {
  const mean = vals.reduce((x, y) => x + y, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((x, y) => x + (y - mean) ** 2, 0) / vals.length);
  return { mean, sd };
};

// Profil-signatur: speciale-grad pr. evne ud fra rytterens egne evner.
// Returnerer { [evne]: sig ∈ (0,1) }. Beregnes ÉN gang fra start-evnerne (som
// v4's caps), så prognosen er deterministisk. Standard: referencen for evne i
// regnes uden evne i (leave-one-out).
export function profileSignature(abilities = {}, profile = {}) {
  const k = num(profile.ref_sd, 0.5);
  const s = num(profile.width_sd, 0.5);
  const floor = num(profile.width_floor, 2);
  const mode = profile.reference ?? "leave_one_out";
  if (!PROFILE_REFERENCE_MODES.includes(mode)) throw new RangeError(`profileSignature: ukendt reference "${mode}"`);
  const present = [];
  for (const a of VISIBLE_ABILITIES) {
    const v = Number(abilities?.[a]);
    if (abilities?.[a] != null && Number.isFinite(v)) present.push([a, v]);
  }
  const sig = {};
  if (!present.length) return sig;
  const all = meanSd(present.map(([, v]) => v));
  for (const [a, v] of present) {
    let ref, width;
    if (mode === "including_self" || present.length < 2) {
      ref = all.mean + k * all.sd;
      width = Math.max(all.sd * s, floor);
    } else {
      const others = meanSd(present.filter(([b]) => b !== a).map(([, x]) => x));
      ref = others.mean + k * others.sd;
      width = Math.max(others.sd * s, floor);
    }
    sig[a] = logistic((v - ref) / width);
  }
  return sig;
}

// Loft-faktor fra speciale-grad (samme skala som v4's signatureFactor:
// 0 = svaghed, 1 = speciale). v2-standard: faktoren ER speciale-graden.
// "off_floor" (v1) giver alle evner mindst mellemniveauet.
export function capFactorFromSig(sig, cfg = PROGRESSION_CONFIG, mode = "strengths_only") {
  if (!PROFILE_HEADROOM_MODES.includes(mode)) throw new RangeError(`capFactorFromSig: ukendt headroom "${mode}"`);
  const s = clamp(Number(sig) || 0, 0, 1);
  if (mode === "strengths_only") return s;
  const off = cfg.offTypeHeadroomFactor;
  return off + (1 - off) * s;
}

// Loft-budget: gennemsnitlig loft-faktor over rytterens evner (1 = alle evner
// får fuldt potentiale-loft). Målescriptet sammenligner populationens snit med
// v4's (typens faktorer), så det typefri forslag ikke deler mere loft ud i alt.
export function headroomBudget(abilities = {}, profile = {}, cfg = PROGRESSION_CONFIG) {
  const sig = profileSignature(abilities, profile);
  const vals = Object.values(sig).map((x) => capFactorFromSig(x, cfg, profile.headroom ?? "strengths_only"));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

// Loft pr. evne. Samme formel som riderProgression.abilityCap, men med
// profil-faktoren i stedet for type-faktoren.
export function buildCapsTypefree(
  baseline,
  sigByAbility,
  potentiale,
  { headroom: headroomMode = "strengths_only", cfg = PROGRESSION_CONFIG, factorFn = (sig) => capFactorFromSig(sig, cfg, headroomMode) } = {},
) {
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
