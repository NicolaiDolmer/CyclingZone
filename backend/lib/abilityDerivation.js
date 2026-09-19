import {
  REGISTRY_ABILITY_KEYS, REGISTRY_CONTRAST_KEYS, REGISTRY_PRIMARY_STAT,
} from "./abilityRegistry.js";
// SSOT for launch-referenceåret + fødselsår-udtrækket. riderSeasonAge.js er bevidst
// dependency-fri, så denne rene derivations-fil ikke trækker I/O med sig (#4455).
import { LAUNCH_REFERENCE_YEAR, birthYearFrom } from "./riderSeasonAge.js";

// Evne-system v3 (#1122 / #1101-kæden) — fysiske evner afledes nu fra fysiologi-profiler
// (rider_physiology_profiles); tekniske/mentale forbliver skill-stat-drevne.
// prolog FJERNET (merged ind i time_trial, §0.1 Beslutning 2).
// Fallback til v2 PCM-stat-derivation når fysiologi mangler.
// Designet: docs/decisions/rider-ability-system-v2.md (source of truth).
//
// KALIBRERINGS-MODEL (§0.1 Beslutning 3 — KANDIDAT-koefficienter, tunes i Task C1):
//   Fysiske evner ← normaliserede fysiologi-metrics (PHYS_ANCHORS), lineært kombineret.
//   Tekniske/mentale ← skill-stats (50-85 → 1-99), uændret kilde fra v2.
//   Fallback (ingen fysiologi): v2 PCM-stat-derivation (PCM 50 → 1, PCM 85 → 99).

export const FORMULA_VERSION = 3;

// ── Kalibrerings-ankre (§6) — ejer tuner her ──────────────────────────────────
export const CALIBRATION = Object.freeze({
  pcmFloor: 50,   // PCM-stat der mapper til spil-1
  pcmCeil: 85,    // PCM-stat der mapper til spil-99 (stats >85 clampes til 99)
  // alder = asOfYear − fødselsår (til aggression/tactics/hidden). #4455: dette var
  // den FEMTE kopi af launch-referenceåret, og den eneste i den KØRENDE backend —
  // deriveAbilities() kaldes uden asOfYear fra backfillCores.js og
  // starterSquadAllocator.js, så literalen her var den faktiske default i prod.
  asOfYear: LAUNCH_REFERENCE_YEAR,
});

// ── Evne-niveau KONTRAST-FORSTÆRKNING (§5-B, #1122 — "A+B") ───────────────────
// Den additive arketype-skew (A) i archetypePhysiology.js METTER ved superstar-tier
// (frac = clamp01(tierLevel≈0.92 + skew + støj)): en superstar-klatrer med aero-skew
// −0.10 får stadig aero ≈ 0.82 → høj time_trial → "god til alt". Resultat: hvilken
// FØDT-SOM-type der vinder afhænger af det tilfældige arketype-lotteri blandt de 12
// superstars pr. seed → seed 2026 grøn, 7/42 røde (calibration-log 15/6).
//
// REMEDIEN (design §5-B): efter de rå fysiske evner, skub HVER rytters fysiske evner
// væk fra rytterens EGEN evne-median: out = median + k·(raw − median), clamp [floor,99].
// TIER-UAFHÆNGIG (måler afstand fra rytterens egen profil, ikke et absolut loft) → selv
// superstars bliver tydeligt svage off-disciplin uden at bunden bliver karikatur (floor).
//
// NB: dette er IKKE riderTypes.js' z-score-kontrast (den er TYPE-niveau, mod populationen);
// dette er et nyt EVNE-niveau-trin på den enkelte rytters fysiske profil.
export const CONTRAST = Object.freeze({
  k: 1.52,    // forstærknings-faktor (1 = ingen kontrast); tunet cross-seed (#1122)
  floor: 8,   // domestique-gulv: en specialists svageste evne ikke clampet til karikatur
});

// De 10 FYSISKE evner kontrasten opererer på (median-basis OG forstærkede). De er de
// fysiologi-mættende disciplin-evner der driver demand-vektor-scoringen + born-as.
// Tekniske/mentale (descending/cobblestone/positioning/aggression/tactics/hidden) er
// skill-stat-drevne, IKKE en del af mætnings-problemet, og holdes helt uden for kontrasten.
//
// NB: `durability` ER med — selvom intet terræn har en stærk durability-demand (den virker
// gennem condition/fatigue-seamen, #1021-placeholder), spreder forstærkningen durabilitys
// felt-fordeling, hvilket HOLDER durability-liveness-seamen over gulvet (dryrun sektion E).
// Udeladelse komprimerede tværtimod durability mod hver rytters median → seam under gulv.
// #3665: udledt af evne-registret (`inContrast`). De 5 evner der IKKE er med —
// descending, cobblestone, positioning, aggression, tactics — er skill-stat-drevne
// og var aldrig en del af det mætnings-problem forstærkningen løste. Bivirkningen
// er at de fem lever på en anden fordeling end de ti; det er #3668, ikke en fejl her.
export const CONTRAST_ABILITIES = REGISTRY_CONTRAST_KEYS;

// Median af de fysiske evner for ÉN rytter (rytterens egen profil-midte).
function ownPhysicalMedian(out) {
  const vals = CONTRAST_ABILITIES.map((k) => out[k]).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!vals.length) return 50;
  const mid = vals.length >> 1;
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

// Skub de fysiske evner væk fra rytterens egen median (in-place på out). Tier-uafhængig:
// superstars beholder deres høje median men spredes; domestiques spredes om en lav median
// men gulvet (CONTRAST.floor) forhindrer karikatur. Tekniske/mentale røres ikke.
function applyContrast(out, { k = CONTRAST.k, floor = CONTRAST.floor } = {}) {
  const median = ownPhysicalMedian(out);
  for (const ab of CONTRAST_ABILITIES) {
    const raw = out[ab];
    if (!Number.isFinite(raw)) continue;
    out[ab] = clamp(Math.round(median + k * (raw - median)), floor, 99);
  }
  return out;
}

// De synlige evner (§3) — 17 efter #5268 (teamwork + leadership).
// prolog merged ind i time_trial (§0.1 Beslutning 2).
// #3665: udledt af evne-registrets `storageOrder` = visnings-/lagrings-orden.
// At tilføje en evne kræver nu én registry-post, ikke en jagt gennem tredive
// filer — se docs/HOWTO_ADD_ABILITY.md.
export const VISIBLE_ABILITIES = REGISTRY_ABILITY_KEYS;

// Skjulte evner (§3). potentiale forbliver en eksisterende riders-kolonne; her
// udleder vi kun hidden_potential.
export const HIDDEN_ABILITIES = Object.freeze(["hidden_potential"]);

export const ALL_ABILITY_KEYS = Object.freeze([...VISIBLE_ABILITIES, ...HIDDEN_ABILITIES]);

// #4311: fyld-ryttere (generation_tag='fill_tail', sat af buildWeakStarterPool i
// starterSquadAllocator.js) faar stats klemt i bund FOER derivation, men to af de
// seksten evner udledes slet ikke af stats (tactics = alder, hidden_potential =
// potentiale) og sprang derfor uden om klemmen. En 32-aarig fyld-rytter fik taktik
// 57 og laeste som en normal rytter (populationens bedste evne-snit 41; fyldets
// bedste evne UDEN tactics 7). Loftet ligger HER (ikke kun i generator-scriptet),
// saa en senere re-derive (deriveForRiderIds, riderDeriveHealSweep osv.) ikke kan
// genoplive tactics 57 — klemmen gaelder for ENHVER rider_row der baerer taggen,
// uanset hvilken kodesti der kalder deriveAbilities.
export const FILL_TAIL_ABILITY_CAP = 15;
export const FILL_TAIL_GENERATION_TAG = "fill_tail";
// Ejer-beslutning 27/8 (#4311): fyld-rytteres potentiale klemmes til maks 2,5 —
// forhindrer hidden_potential (afledt af potentiale, ikke stats) i at laekke over
// evne-loftet. Bruges af buildWeakStarterPool (starterSquadAllocator.js) FOER
// derivation; evne-loftet ovenfor er det UAFHAENGIGE sikkerhedsnet EFTER derivation.
export const FILL_TAIL_MAX_POTENTIALE = 2.5;

// Disciplin-evne → primær PCM-stat (§3 "Kilde"). Bruges kun i FALLBACK-stien
// (ingen fysiologi). prolog FJERNET. Ren 50-85 → 1-99-mapping.
// #3665: udledt af registrets `derivation: { source: "pcm", stat }`. De tre evner
// med `source: "skill"` (positioning, aggression, tactics, teamwork, leadership) har ingen PCM-kilde og
// optræder derfor bevidst ikke her — præcis som før.
export const PRIMARY_STAT = REGISTRY_PRIMARY_STAT;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// PCM-stat → fraktion ∈ [0,1] på ankrene [pcmFloor, pcmCeil]. Ugyldig stat → 0.
function pcmFrac(stat) {
  const v = Number(stat);
  if (!Number.isFinite(v)) return 0;
  return clamp((v - CALIBRATION.pcmFloor) / (CALIBRATION.pcmCeil - CALIBRATION.pcmFloor), 0, 1);
}

// Fraktion ∈ [0,1] → spil-score ∈ [1,99] (frac 0 → 1, frac 1 → 99).
const scoreFrac = (f) => clamp(Math.round(1 + clamp(f, 0, 1) * 98), 1, 99);

// Spil-score ∈ [1,99] → fraktion ∈ [0,1]. Præcis invers af scoreFrac (ikke score/99),
// så en evne der fødes af ANDRE evner lever på nøjagtig samme skala som dem — det er
// selve gaten G-A1. Bruges af teamwork/leadership (spec H2/L1).
const abilityFrac = (score) => {
  const v = Number(score);
  if (!Number.isFinite(v)) return 0;
  return clamp((v - 1) / 98, 0, 1);
};

// ── MENTALE EVNER: EGEN PRIOR (#5268, ejer-beslutninger 15/9 på #3668) ───────
//
// Ordret fra ejeren 15/9: *"taktik og aggression må fremadrettet hverken bygge på
// alder eller på en anden evne; de er egne evner med egen udvikling."*
//
// Hvad der var galt (docs/audits/2026-09-15-3668-ability-scale-investigation.md
// §1.2/§1.3): de to formler lagde et ADDITIVT ALDERS-LED oveni en stat.
//   tactics    = 0,55·experience + 0,45·aggressionFrac  → et aldersmålerur:
//                median 14 ved 16-21 år, 57 ved 31-33 år, uden sammenhæng med kunnen.
//                En 31-årig fik MINDST 55 i taktik uanset hvor dårlig han var.
//   aggression = 0,85·pcmFrac(stat_ftr) + 0,15·youth    → +15 gratis point til unge.
// Rapportens behandling C fjernede de to led og målte begge evner tilbage inde i
// de ti fysiske evners eget spænd (median 12 / p90 29). Ejeren gik et skridt
// længere end C: C beholdt `0,15·experience` i taktik — det er væk her.
//
// Hvad der er tilbage: hver mental evne har sin EGEN prior = rytterens egen
// PROFIL (rå stats, aldrig en anden AFLEDT evne) + deterministisk støj. Støjen er
// CENTRERET om 0, så den spreder uden at løfte medianen, og den er salted pr.
// (rytter, evne), så to ryttere med identisk profil ikke får identiske mentale tal.
//
// Undtagelsen er `leadership`: alder er dér en LOVLIG faktor (spec L1 / GDD D-030
// — lederskab er lavt hos unge og topper sent). Vægten er bevidst lille, netop
// fordi et tungt alders-led er præcis den fejl taktik havde: gaten (G-A1) er at
// median/p90 skal ligge i samme spænd som descending/positioning, og et
// maturity-led over ~0,2 sprænger p90 alene på de 11 % ryttere der er 31+.
//
// INGEN NY PCM-VÆGTNING: ejeren sagde samme dag *"intet skal være vægtet på PCM-stats
// mere."* De to NYE evner (`teamwork`, `leadership`) rører derfor ingen `stat_*`-felter.
// De fødes af ALLEREDE AFLEDTE evner — positioning/tactics/durability (H2) og
// tactics/positioning (L1) — præcis som den ejer-låste spec skriver:
// docs/superpowers/specs/2026-09-15-holdarbejde-og-lederskab-evner-design.md §4 trin 1.
// At de evner SELV er PCM-afledte på fallback-stien er den legacy der findes i forvejen;
// den nye, PCM-frie fødselssti bygges i `fictionalRiderGenerator.js` (#5269). Kontrakten
// mellem de to spor er at REGISTRET er sandheden om hvilke evner der findes, og at #5269
// giver enhver mental evne den ikke kender en default-prior. Rør ikke den ene herfra.
export const MENTAL_PRIOR = Object.freeze({
  // Bredden på den centrerede støj i frac-rummet. 0,10 ≈ ±5 evne-point.
  aggressionSpread: 0.10,
  tacticsSpread: 0.14,
  // Spec H2: "stor støj oveni" — holdarbejde må ikke kunne aflæses af profilen alene.
  teamworkSpread: 0.20,
  leadershipSpread: 0.10,
  // Taktik: rytterens egen profil for at LÆSE et løb (fighter + nedkørsel).
  // Vægtene er rapportens behandling C minus alders-leddet.
  tacticsFighter: 0.60,
  tacticsDescent: 0.40,
  // Holdarbejde (spec H2, ordret): "arketype + positionering/taktik/durability giver
  // et gennemsnit, stor støj oveni; ingen kobling til rå styrke". Kilden er derfor de
  // ALLEREDE AFLEDTE evner, ikke rå PCM-stats. Arketypen kommer med af sig selv: det
  // er arketypen der skæver fysiologien bag `durability` og skill-stats bag
  // `positioning`/`tactics` — den er ikke et selvstændigt fjerde led.
  teamworkPositioning: 0.40,
  teamworkTactics: 0.30,
  teamworkDurability: 0.30,
  // Lederskab: lille grundniveau + alder (den ene lovlige aldersfaktor) + lille
  // profil-træk. Alders-vægten er loftet af G-A1, ikke af smag — se ovenfor.
  // Profil-trækket er taktik/positionering (spec L1 ordret), igen afledte evner.
  leadershipBase: 0.04,
  leadershipMaturity: 0.16,
  leadershipTactics: 0.30,
  leadershipPositioning: 0.20,
  // maturity = clamp((alder − 20) / (34 − 20), 0, 1): 20 → 0, 34+ → 1.
  leadershipMaturityFrom: 20,
  leadershipMaturityTo: 34,
});

// Deterministisk støj ∈ [0,1) fra rider_id (FNV-1a). Kun til skjult potentiale.
function hashNoise(id) {
  const s = String(id ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

// Bevidst en ANDEN semantik end riderSeasonAge.ageForSeason: clampet til [16,45] og
// med snit-alder 25 som fallback i stedet for null, fordi evne-derivationen skal give
// et tal uanset hvad. Kun selve fødselsår-UDTRÆKKET deles (#4455), så de to ikke kan
// divergere på tidszone — se birthYearFrom's kommentar i riderSeasonAge.js.
function ageFrom(birthdate, asOfYear) {
  if (!birthdate) return 25; // snit-alder fallback
  const year = birthYearFrom(birthdate);
  if (year === null) return 25;
  return clamp(asOfYear - year, 16, 45);
}

// Fysiologi-ankre (§0.1 Beslutning 3) — [lav, høj] pr. metric → normaliseres [0,1].
// Lav = peloton-bund (≈evne 1), høj = elite-loft (≈evne 99). Tuning-flade (Task C1).
export const PHYS_ANCHORS = Object.freeze({
  ftp_wkg: [3.6, 6.6], vo2max_power_wkg: [4.6, 7.4], zone2_power_wkg: [2.3, 4.8],
  pmax_watts: [900, 1900], power_5s_wkg: [14, 21], power_15s_wkg: [10, 16.5],
  power_1m_wkg: [7.2, 11.2], power_2m_wkg: [6.2, 9.3], power_10m_wkg: [4.7, 6.9],
  high_intensity_energy_kj: [12, 28], time_to_exhaustion_ftp_min: [33, 72],
  fatigue_resistance: [0.45, 0.93], recovery_rate: [0.45, 0.93], aero: [0.45, 0.93],
});

const normPhys = (phys, key) => {
  const anchor = PHYS_ANCHORS[key];
  if (!anchor) return 0; // ukendt key → degradér blødt (letter debug ved fremtidig tastefejl)
  const [lo, hi] = anchor;
  const v = Number(phys?.[key]);
  if (!Number.isFinite(v)) return 0;
  const frac = clamp((v - lo) / (hi - lo), 0, 1);
  return Number.isFinite(frac) ? frac : 0; // guard mod degenereret anker (hi==lo → NaN)
};

// v3 kræver en KOMPLET v2-profil (arketype-seedet via archetypePhysiology.js): den har
// bl.a. `aero` (+ power_2m_wkg/power_10m_wkg). En gammel v1-profil (seedPhysiologyFromLegacy)
// mangler disse → falder BEVIDST tilbage til PCM-stat-derivationen i stedet for at
// underestimere time_trial/flat/punch/tempo (normPhys→0 for manglende metrics). Task D2
// re-seeder PCM-ryttere til v2 FØR previewDerivedAbilities re-derives dem. `!= null`
// afviser eksplicit DB-NULL (Number(null)=0 er finit men ikke en gyldig profil).
const hasPhysiology = (phys) =>
  phys != null &&
  phys.ftp_wkg != null && Number.isFinite(Number(phys.ftp_wkg)) &&
  phys.aero != null && Number.isFinite(Number(phys.aero));

// physiology: rider_physiology_profiles-række (driver fysiske evner i v3).
// riderRow:   stat_*-felter + birthdate + potentiale + id (tekniske/mentale + fallback).
// opts.pool:   accepteres for bagudkompat (v1/v2) men ignoreres.
export function deriveAbilities(physiology = {}, riderRow = {}, { asOfYear = CALIBRATION.asOfYear } = {}) {
  const age = ageFrom(riderRow.birthdate, asOfYear);
  const youth = clamp((32 - age) / (32 - 21), 0, 1);       // 21→1, 32→0 — KUN hidden_potential
  // #5268: `experience` er fjernet. Den fodrede udelukkende taktik-formlens
  // alders-led, og det led er væk (se MENTAL_PRIOR). `leadership` bruger sin egen
  // maturity-rampe med egne ankre, så de to ikke kan drive fra hinanden i det skjulte.
  const potRaw = Number(riderRow.potentiale);
  const potential = Number.isFinite(potRaw) ? clamp((potRaw - 1) / 5, 0, 1) : 0.4; // 1-6 → 0..1

  const out = { rider_id: physiology.rider_id ?? riderRow.id, formula_version: FORMULA_VERSION };

  // ── Fysiske evner ← fysiologi (§0.1 Beslutning 3). KANDIDAT-vægte (Task C1). ──
  const fromPhysiology = hasPhysiology(physiology);
  if (fromPhysiology) {
    const P = (k) => normPhys(physiology, k);
    out.sprint       = scoreFrac(0.25 * P("pmax_watts") + 0.45 * P("power_5s_wkg") + 0.30 * P("power_15s_wkg"));
    out.acceleration = scoreFrac(0.40 * P("pmax_watts") + 0.60 * P("power_5s_wkg"));
    out.punch        = scoreFrac(0.65 * P("power_1m_wkg") + 0.35 * P("power_2m_wkg"));
    out.tempo        = scoreFrac(0.45 * P("vo2max_power_wkg") + 0.35 * P("power_10m_wkg") + 0.20 * P("zone2_power_wkg"));
    out.climbing     = scoreFrac(0.50 * P("ftp_wkg") + 0.50 * P("vo2max_power_wkg")); // VO2-loft separerer klatrer fra tt
    out.time_trial   = scoreFrac(0.30 * P("ftp_wkg") + 0.55 * P("aero") + 0.15 * P("zone2_power_wkg")); // aero separerer tt fra gc på flad ITT
    out.flat         = scoreFrac(0.45 * P("ftp_wkg") + 0.30 * P("aero") + 0.25 * P("zone2_power_wkg"));
    out.endurance    = scoreFrac(0.40 * P("zone2_power_wkg") + 0.35 * P("time_to_exhaustion_ftp_min") + 0.25 * P("fatigue_resistance"));
    out.recovery     = scoreFrac(P("recovery_rate"));
    out.durability   = scoreFrac(0.65 * P("fatigue_resistance") + 0.35 * P("high_intensity_energy_kj"));
  } else {
    // Fallback (PCM-ryttere uden profil / pre-v3): v2 PCM-stat-derivation.
    out.sprint       = scoreFrac(pcmFrac(riderRow.stat_sp));
    out.acceleration = scoreFrac(pcmFrac(riderRow.stat_acc));
    out.punch        = scoreFrac(pcmFrac(riderRow.stat_bk));
    out.tempo        = scoreFrac(pcmFrac(riderRow.stat_kb));
    out.climbing     = scoreFrac(pcmFrac(riderRow.stat_bj));
    out.time_trial   = scoreFrac(Math.max(pcmFrac(riderRow.stat_tt), pcmFrac(riderRow.stat_prl))); // prolog merged
    out.flat         = scoreFrac(pcmFrac(riderRow.stat_fl));
    out.endurance    = scoreFrac(pcmFrac(riderRow.stat_udh));
    out.recovery     = scoreFrac(pcmFrac(riderRow.stat_res));
    out.durability   = scoreFrac(pcmFrac(riderRow.stat_mod));
  }

  // ── §5-B KONTRAST: skub de fysiske evner væk fra rytterens egen median ────────
  // KUN på fysiologi-stien. Mætnings-problemet (additiv arketype-skew mætter ved
  // superstar-tier) eksisterer KUN i fysiologi-derivationen; PCM-fallback er en ren
  // lineær stat-remap uden mætning. Kontrast på fallback-stien ville desuden forskyde
  // value-modellen (riderValuationModel.json fittet mod PRE-kontrast-fordelingen →
  // superstjerne-tælling springer) — den refit hører til Plan 4, ikke her. KØRES FØR
  // cobblestone, der afleder af den (evt. kontrast-justerede) durability.
  if (fromPhysiology) applyContrast(out);

  // ── Tekniske/mentale ← skill-stats (skæv pr. arketype, §0.1 Beslutning 1) ────
  const M = MENTAL_PRIOR;
  const riderKey = riderRow.id ?? physiology.rider_id;
  // Centreret støj ∈ [−spread/2, +spread/2], deterministisk pr. (rytter, evne).
  const mentalNoise = (abilityKey, spread) => (hashNoise(`${riderKey}:${abilityKey}`) - 0.5) * spread;
  // Lederskabets alders-rampe. Egne ankre, bevidst adskilt fra `youth`.
  const maturity = clamp(
    (age - M.leadershipMaturityFrom) / (M.leadershipMaturityTo - M.leadershipMaturityFrom), 0, 1,
  );

  out.descending  = scoreFrac(pcmFrac(riderRow.stat_ned));
  out.cobblestone = scoreFrac(0.85 * pcmFrac(riderRow.stat_bro) + 0.15 * (out.durability / 99));
  out.positioning = scoreFrac(0.50 * pcmFrac(riderRow.stat_fl) + 0.30 * pcmFrac(riderRow.stat_ned) + 0.20 * pcmFrac(riderRow.stat_ftr));

  // Mentale evner — egen prior, ingen alder (undtagen leadership), ingen anden evne.
  out.aggression = scoreFrac(
    pcmFrac(riderRow.stat_ftr)
    + mentalNoise("aggression", M.aggressionSpread),
  );
  out.tactics = scoreFrac(
    M.tacticsFighter * pcmFrac(riderRow.stat_ftr)
    + M.tacticsDescent * pcmFrac(riderRow.stat_ned)
    + mentalNoise("tactics", M.tacticsSpread),
  );
  // Holdarbejde + lederskab afledes af de evner der ER udledt ovenfor (abilityFrac),
  // ALDRIG af rå PCM-stats. Rækkefølgen er derfor bindende: durability (fysisk blok,
  // efter kontrast), positioning og tactics skal stå før disse to linjer.
  out.teamwork = scoreFrac(
    M.teamworkPositioning * abilityFrac(out.positioning)
    + M.teamworkTactics * abilityFrac(out.tactics)
    + M.teamworkDurability * abilityFrac(out.durability)
    + mentalNoise("teamwork", M.teamworkSpread),
  );
  out.leadership = scoreFrac(
    M.leadershipBase
    + M.leadershipMaturity * maturity
    + M.leadershipTactics * abilityFrac(out.tactics)
    + M.leadershipPositioning * abilityFrac(out.positioning)
    + mentalNoise("leadership", M.leadershipSpread),
  );

  out.hidden_potential = scoreFrac(0.60 * potential + 0.25 * youth + 0.15 * hashNoise(riderKey));

  // #4311: evne-loft EFTER afledning for fyld-ryttere. Ligger sidst saa den fanger
  // ALLE seksten evner uanset kilde (fysiologi/PCM-fallback/skill-stat/alder/potentiale).
  if (riderRow.generation_tag === FILL_TAIL_GENERATION_TAG) {
    for (const k of ALL_ABILITY_KEYS) {
      if (Number.isFinite(out[k])) out[k] = Math.min(out[k], FILL_TAIL_ABILITY_CAP);
    }
  }

  return out;
}
