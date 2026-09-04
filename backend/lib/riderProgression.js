// Passiv rytterudviklings-motor (#1137 / epic #1136) — RENE kurve-funktioner.
//
// Ejer-besluttet 2026-06-07: udvikling muterer de afledte abilities DIREKTE
// (rider_derived_abilities, 0-99), ikke PCM-stats. Alt gameplay-forbrug hænger på
// abilities (race-motor #1102, base_value #1101, type #49), så mutation dér
// propagerer korrekt. Board-ungdomsmål #813 flyttes tilsvarende til ability-rummet.
//
// Denne fil er KUN ren matematik (ingen DB, ingen Math.random/Date.now) så den kan:
//   • kalibreres via scripts/previewRiderProgression.js (vis kurver → ejer justerer)
//   • køres deterministisk i season-transition (samme input → samme output)
//   • unit-testes isoleret.
//
// MODEL (alt i CONFIG nedenfor er ejer-justerbart i kalibrerings-løkken):
//   1. Loft per evne   = baseline-ability + headroom(potentiale) × signatur-vægt(type,evne)
//   2. Vækst < peak    = current rykker en alders-vægtet brøkdel af (loft − current)
//   3. Fald ≥ peak     = current falder N ability-point/sæson (type-afhængig peak-alder)
//   4. Determinisme    = seeded støj per (rider_id, sæson) via FNV-1a → reproducerbart
//   5. Retirement      = seeded i alders-vindue, garanteret ved guaranteedAge

import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { CAPS_SHAPING_WEIGHTS } from "./weights/capsShapingWeights.js";
import { ageForSeason } from "./riderSeasonAge.js";

// ── EJER-JUSTERBARE KONSTANTER (kalibreres i previewRiderProgression.js) ────────
export const PROGRESSION_CONFIG = Object.freeze({
  // Ejer 2026-06-07: ENS udviklingskurve per alder på tværs af typer → ét fælles
  // peak (ikke type-afhængigt). peakAgeByType bevaret som null-hook hvis type-
  // variation senere ønskes.
  peakAge: 28,
  peakAgeByType: null,

  // Headroom = ability-point en SIGNATUR-evne kan stige over sin baseline ved fuldt
  // indfriet potentiale. Interpoleret lineært mellem disse potentiale-ankre (1-6).
  // Off-type-evner får offTypeHeadroomFactor × headroom; modsatte (negativ type-vægt)
  // vokser ikke (factor 0).
  headroomByPotential: Object.freeze({ 1: 4, 2: 9, 3: 15, 4: 22, 5: 30, 6: 38 }),
  offTypeHeadroomFactor: 0.35,

  // Vækst-fraktion: andel af (loft − current) der lukkes pr. sæson, efter alder.
  // Yngre = hurtigere konvergens mod loftet (aftager asymptotisk).
  growthFractionByAge: Object.freeze([
    { maxAge: 19, frac: 0.35 },
    { maxAge: 22, frac: 0.28 },
    { maxAge: 25, frac: 0.18 },
    { maxAge: 99, frac: 0.10 },
  ]),
  // ± seeded variation på vækst-fraktionen (to ens talenter udvikler sig forskelligt,
  // men deterministisk). 0.15 = op til ±15% relativ på fraktionen.
  growthNoise: 0.15,

  // Fald efter peak: ability-point/sæson på signatur-evner, voksende med år forbi peak.
  declineByYearsPastPeak: Object.freeze([
    { maxYears: 3, drop: 1.0 },
    { maxYears: 6, drop: 1.8 },
    { maxYears: 99, drop: 2.6 },
  ]),
  offTypeDeclineFactor: 0.7,

  // Semi-auto retirement: seeded sandsynlighed stiger lineært fra windowStart til
  // guaranteedAge; garanteret derover. noticeSeasons = varsel før faktisk exit.
  retirement: Object.freeze({ windowStartAge: 36, guaranteedAge: 40, noticeSeasons: 1 }),
});

// ── Ungdoms-loft (#akademi-rework 2026-06-23) — START-værdier, kalibreres i Fase D ──
//
// ══ TO KNAPPER I STEDET FOR ÉN (#3709 trin 4, spec §2.2, ejer 14/8) ══
//
// Loftet gjorde indtil nu TO ting på én gang: det satte både hvor HØJT en evne
// kunne komme og hvor HURTIGT den voksede derhen — fordi væksten er
// gap-proportional (`dailyAbilityDelta`: base = gap × frac / dage). Konsekvensen
// blev målt over en hel karriere: forskellen mellem at træne rigtigt og forkert
// var 3 point ud af 60, og intensiteten var 1 point værd. Hver evne mættede sit
// loft under ALLE indstillinger, så raten bestemte kun HVORNÅR rytteren ankom,
// og ti sæsoner var rigeligt uanset hvad manageren gjorde. Udfaldet var afgjort
// ved genereringen. Managers kunne stole fuldstændig på rytterudviklingen — den
// var bare ikke deres.
//
// De to knapper skilles derfor ad. Hver (rytter, evne) hører til én af fem
// ROLLEKLASSER, og klassen giver både et TAG (hvor højt) og en RATE (hvor
// hurtigt). Klassen udledes ÉT sted — `abilityRoleClass` nedenfor — så tag og
// rate umuligt kan komme ud af trit med hinanden.
//
// TAGENE STIGER ALLE SAMMEN. Det er ikke en fejl: hvert eneste tag er højere end
// før (1,00→1,30 · 0,82→1,10 · 0,45→0,70 · 0,12→0,20, plus håndværkets 0,95 fra
// trin 3). Modvægten er raten, som falder hårdt. Resultatet er at ryttere holder
// op med at NÅ deres lofter — andelen af taget nået falder fra median 1,00 til
// 0,82 (beslutning 6, og det er meningen). Taget bliver "hvad han kunne være
// blevet"; manageren afgør hvor tæt han kommer, og på hvilke evner.
export const YOUTH_PROGRESSION_CONFIG = Object.freeze({
  // ══ TRIN 7 (#3746, ejer 16/8): TAGET ER FLADT OG SÆTTES AF ROLLEN ALENE ══
  //
  // Potentiale er HELT ude af tag-formlen. Hver rolleklasse har ét absolut tag,
  // ens for alle ryttere i klassen, uanset potentiale. Potentiale styrer KUN
  // farten (rateByPotential nedenfor). Konsekvensen er strukturel, ikke
  // kalibreret: taget kan aldrig sætte nogen over 95 (S1) eller ramme 99 (S2),
  // uanset hvilke tal nogen fremover drejer på.
  //
  // Signatur-taget ligger på 93, ikke 90: væksten er gap-proportional, så en
  // evne nærmer sig taget asymptotisk og ankommer aldrig. Skal 90 kunne nås af
  // spillets bedste (S4), skal taget ligge et stykke over 90 — og S1 kræver at
  // det ligger under 95. Vinduet er 92-94; 93 er målt til at give S4 = 311
  // dage (11,1 sæsoner) for et pot 6-akademitalent med fuld støtte.
  //
  // Rækkefølgen signatur > sekundær > håndværk > andenRolle > svaghed er
  // trin 4's ejer-besluttede ordning (14/8). Bemærk at håndværk (70) nu ligger
  // UNDER sekundær (80) — i den gamle faktormodel lå craft (0,95) over sekundær
  // (0,82). Det betyder at en rytter hvis positioning er sekundær-ejet BEHOLDER
  // sekundær-klassen (tag 80, rate 0,36) frem for at blive "opgraderet" ned.
  // abilityRoleClass' gulv-løft-invariant håndhæver det uanset værdierne.
  //
  // SVAGHED 25 → 45 (#4634/#4098, ejer-beslutning 4/9, variant A3 af
  // docs/audits/4634-cap-varianter-2026-09-04.md): 635 ryttere/867 evne-felter
  // stod på bund-loftet ("done", 0 point tilbage at vinde) i prod 4/9, heraf
  // halvdelen 29+ (aldersaftrapning, urørt af denne ændring). A3 frigiver alle
  // 631 under-29-ryttere/861 felter uden at flytte en eneste rytterværdi (målt
  // 0,00 % median værdi-ændring, `predictBaseValueV4` læser ikke roleTags) og
  // med kun +17 point evne-vækst totalt i resten af S3 (dedikeret hård
  // træning). ROLE_CLASS_RATE.svaghed (0,05) er UÆNDRET — raten er en separat
  // beslutning, egen session inden 11/9.
  roleTags: Object.freeze({ signatur: 93, sekundaer: 80, haandvaerk: 70, andenRolle: 55, svaghed: 45 }),

  // Potentiale → træningsfart-multiplikator. ══ SPREDT I TRIN 7 (ejer 16/8),
  // REKALIBRERET OP 21/8 (#3966) ══
  //
  // TRIN 7 (16/8) satte {1:0.11, 2:0.27, 3:0.42, 4:0.58, 5:0.73, 6:0.89}. Kombineret
  // med #3709 trin 4/5's roleRate (samme dag som trin 4/5, 14/8) faldt raten på
  // on-focus hård signatur-træning -70% (pot 6) til -92% (pot 1) siden før 14/8 —
  // kvantificeret i #3966 (spillerrapporter 19/8: udvikling føltes død). Ejer-
  // beslutning 21/8: rater OP, harness-gated, uden at gen-indføre før-14/8-tempoet.
  //
  // REKALIBRERINGEN (#3966, 21/8) løftede kun pot 1-5 — pot 6 er UÆNDRET (0.89):
  // S4 (dage til 90 for bedste rytter) stod allerede på 311 af det tilladte
  // 286-386-bånd, kun 25 dages margin til gulvet, så pot 6 kunne ikke løftes uden
  // at bryde S4. Loftet for pot 1 er sat af S5 (fart-spænd 2,5-3,5x): 0.135 giver
  // 2.61x, 0.11 margin til gulvet 2,5x. INGEN plads tilbage under de eksisterende
  // S1-S5-gates for yderligere løft — se PR #3966 for scorecard + åbent spørgsmål
  // om S4/S5-båndene selv skal genforhandles for mere hovedrum.
  //
  // Kalibreret mod S4/S5 målt på en ÆGTE KARRIERE (ejer-go 16/8: "det skal være
  // muligt at bedømme disse ting fx udfra en 16-årig og hele vejen til 40-årig"
  // — rytteren ældes, vækstbudgettet falder ved 20/23/26 år):
  //   • pot 6 fra 16 år med fuld støtte (facilitet 5, dedikeret hård træning,
  //     bonus): 20 → 90 på 311 dage = 11,1 sæsoner (S4-bånd 286-386, uændret af
  //     denne rekalibrering — pot 6 rørt ikke).
  //   • pot 1 når nu lidt længere end før rekalibreringen på samme tid (S5 = 2,61x,
  //     var 3,07x før #3966 — stadig inden for 2,5-3,5x-båndet).
  //
  // Det nominelle forhold er ikke det simulerede — gap-proportionaliteten æder
  // forskellen, fordi den hurtige bremser op nær taget mens den langsomme
  // stadig vokser frit. Rør ikke tallene uden at køre
  // scripts/spillervendteGates3709.mjs — den er facit.
  rateByPotential: Object.freeze({ 1: 0.135, 2: 0.31, 3: 0.47, 4: 0.62, 5: 0.74, 6: 0.89 }),

  // ── SUPERSEDERET AF roleTags (trin 7) — LÆSES IKKE AF MOTOREN ──────────────
  // Beholdt fordi committede engangs-/dev-scripts og historiske audits refererer
  // felterne (lofterDryRun3591, capSemanticsComparison m.fl.). De beskriver den
  // GAMLE model (tag = loftByPotential × faktor) og må ikke bruges i ny kode.
  loftByPotential: Object.freeze({ 1: 35, 2: 48, 3: 60, 4: 70, 5: 80, 6: 88 }),
  naturalPrimaryFactor: 1.00,
  naturalSecondaryFactor: 0.82,
  neutralFactor: 0.45,
  oppositeFactor: 0.12,
  craftFactor: 0.95,
});

// Klassens TAG — absolut loft for evnen, uafhængigt af potentiale (trin 7).
// Eksporteret ved siden af ROLE_CLASS_RATE så de to knapper står side om side.
export const ROLE_CLASS_TAG = YOUTH_PROGRESSION_CONFIG.roleTags;

// GC-PUNCH-GULV (#4634/#4098, ejer-beslutning 4/9, variant C2 af
// docs/audits/4634-cap-varianter-2026-09-04.md): `gc` har ingen punch-post i
// CAPS_SHAPING_WEIGHTS (capsShapingWeights.js), så en GC-rytters punch-tag
// afgøres i dag udelukkende af sekundærtypen — 69,7 % af GC-ryttere (331/475)
// endte på andenRolle-tag eller under, og de 22 gc/tt-ryttere endte i klassen
// `svaghed`. Gulvet løfter punch-TAGET (ikke evnen — se youthAbilityCap
// nedenfor) til sekundær-niveau for ALLE GC-ryttere, uanset klassificering.
// Det er et gulv PÅ LOFTET: bygges ind hvor det absolutte tag udledes
// (youthAbilityCap → buildYouthCaps → buildCapsForRider), så det tapres med
// alderen på præcis samme måde som ethvert andet tag, og aldrig konkurrerer
// med håndværks-gulvet (anden evne, positioning/tactics).
export const GC_PUNCH_FLOOR = 80;

// Evner ingen ryttertype fødes med, men alle kan lære (spec §2.1 "håndværk").
// Se craftFactor i YOUTH_PROGRESSION_CONFIG for hvorfor listen er præcis disse to.
export const CRAFT_ABILITIES = Object.freeze(["positioning", "tactics"]);

// De fem rolleklasser (spec §2.1). Rækkefølgen er faldende tag og er den
// rækkefølge `abilityRoleClass` afgør dem i.
export const ROLE_CLASSES = Object.freeze(["signatur", "sekundaer", "haandvaerk", "andenRolle", "svaghed"]);

// Klassens RATE — hvor hurtigt evnen lukker sit gap, som multiplikator på den
// daglige vækst (`dailyAbilityDelta`). Ejer-besluttet 14/8, spec §2.2.
//
// SIGNATUR-RATEN 0,45 ER ANKERET (beslutning 14). Den er ikke valgt for at ramme
// et bestemt slutniveau på den bedste evne, men for at holde RATINGEN på dagens
// niveau: 28 mod dagens 27 ved fremragende træning. Måles der på spidsen i
// stedet, stiger den til 44 mod dagens 36 — og de to kan beviseligt ikke ankres
// samtidig. Sænkes raten til 0,30 lander spidsen tæt på dagens 36, men ratingen
// falder til 24, altså UNDER dagens 27 for alle, også dem der spiller godt.
// Rating vandt fordi det er dét spilleren ser, økonomien prissætter, og som
// netop er kalibreret i #3666.
export const ROLE_CLASS_RATE = Object.freeze({
  signatur: 0.45,
  sekundaer: 0.36,
  haandvaerk: 0.22,
  andenRolle: 0.15,
  svaghed: 0.05,
});

// Hvilken rolleklasse hører (rytter, evne) til? ÉN kilde til klassen, så tag og
// rate ikke kan komme ud af trit — det er hele pointen med at skille dem ad.
//
// Rækkefølgen er ikke vilkårlig. Håndværks-gulvet lægges til SIDST og som en
// OPGRADERING, aldrig som erstatning (#3682's eksplicitte krav: "gulv-løft, ikke
// erstatning"). Det betyder noget i to retninger:
//   • en sprinter EJER nu positioning (#3682) → `signatur` vinder over håndværk
//   • en rytter med sprinter som SEKUNDÆR beholder `sekundaer`: under trin 7's
//     absolutte tag ligger håndværk (70) UNDER sekundær (80), så "opgraderingen"
//     ville være en sænkning — derfor sammenlignes der på TAGET, ikke på
//     klasse-navnet. Ændres tallene i morgen, kan gulvet stadig ikke sænke
//     nogens tag.
export function abilityRoleClass(primaryType, secondaryType, ability, cfg = YOUTH_PROGRESSION_CONFIG) {
  const wp = WEIGHTS_BY_TYPE[primaryType]?.[ability];
  const ws = WEIGHTS_BY_TYPE[secondaryType]?.[ability];
  let klasse;
  if (wp > 0) klasse = "signatur";
  else if (ws > 0) klasse = "sekundaer";
  else if (wp < 0 || ws < 0) klasse = "svaghed";
  else klasse = "andenRolle";

  if (CRAFT_ABILITIES.includes(ability) && Number.isFinite(cfg?.roleTags?.haandvaerk)
      && cfg.roleTags.haandvaerk > tagForClass(klasse, cfg)) {
    return "haandvaerk";
  }
  return klasse;
}

// Klassens absolutte tag (trin 7). En klasse uden defineret tag falder tilbage
// på andenRolle — samme sikre neutral som roleRateFactor bruger.
function tagForClass(klasse, cfg) {
  return cfg.roleTags?.[klasse] ?? cfg.roleTags?.andenRolle ?? 0;
}

// SUPERSEDERET (trin 7): "faktoren" var klassens andel af loftByPotential i den
// gamle model. Beholdt for committede dev-scripts; returnerer nu klassens tag
// som andel af signatur-taget, så relative sammenligninger stadig giver mening.
// Ny kode skal bruge abilityRoleClass + roleTags direkte.
export function youthRoleFactor(primaryType, secondaryType, ability, cfg = YOUTH_PROGRESSION_CONFIG) {
  const signatur = cfg.roleTags?.signatur || 1;
  return tagForClass(abilityRoleClass(primaryType, secondaryType, ability, cfg), cfg) / signatur;
}

// Rolle-faktor (RATEN) for én evne — den anden knap. Multiplikator på den daglige
// vækst, IKKE på loftet. Ukendt/manglende type falder tilbage på `andenRolle`,
// samme sikre neutral som taget bruger.
export function roleRateFactor(primaryType, secondaryType, ability, cfg = YOUTH_PROGRESSION_CONFIG, rates = ROLE_CLASS_RATE) {
  return rates[abilityRoleClass(primaryType, secondaryType, ability, cfg)] ?? rates.andenRolle;
}

// ── Determinisme: FNV-1a → [0,1) fra en streng-nøgle (samme familie som
//    abilityDerivation.hashNoise; genbrugt så seed er reproducerbart pr. rytter+sæson).
export function seededUnit(key) {
  const s = String(key ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Type-vægt pr. evne (positiv = signatur, negativ = modsat, 0 = neutral/off-type).
// #3665: loft-formningen læser sin EGEN tabel (weights/capsShapingWeights.js).
// Bit-identisk med de tre andre ved ikrafttræden, men adskilt så trinnet efter
// #3592 kan forme positioning op UDEN at røre en eneste rytters type eller
// markedsværdi. Se capsShapingWeights.js for den kendte, ejer-accepterede
// mismatch mod visnings-opskrifterne.
const WEIGHTS_BY_TYPE = Object.freeze(
  Object.fromEntries(CAPS_SHAPING_WEIGHTS.map((t) => [t.key, t.weights]))
);

// Signatur-faktor for (type, evne): 1.0 hvis positiv type-vægt (speciale), 0 hvis
// negativ (svaghed — vokser ikke / falder hurtigst), ellers offTypeHeadroomFactor.
export function signatureFactor(primaryType, ability, cfg = PROGRESSION_CONFIG) {
  const w = WEIGHTS_BY_TYPE[primaryType]?.[ability];
  if (w == null || w === 0) return cfg.offTypeHeadroomFactor;
  return w > 0 ? 1.0 : 0;
}

// Lineær interpolation af headroom på potentiale-ankrene (1..6, clamp udenfor).
export function headroomForPotential(potentiale, cfg = PROGRESSION_CONFIG) {
  const p = clamp(Number(potentiale) || 1, 1, 6);
  const lo = Math.floor(p), hi = Math.ceil(p);
  const a = cfg.headroomByPotential[lo] ?? 0;
  const b = cfg.headroomByPotential[hi] ?? a;
  return a + (b - a) * (p - lo);
}

export function peakAgeForType(primaryType, cfg = PROGRESSION_CONFIG) {
  return cfg.peakAgeByType?.[primaryType] ?? cfg.peakAge;
}

// ── Alders-taper på det ABSOLUTTE loft (ejer-valg B, 2026-07-16, #2472) ──────
// buildYouthCaps/youthAbilityCap er BEVIDST alders-uafhængige (samme potentiale-
// ankrede mål for en 22-årig og en 34-årig — se buildCapsForRider). Det er præcis
// hvorfor #2472's konsolidering ophævede aldringen for 556 veteraner (29-36):
// dailyAbilityDelta har INGEN aldersgate (kun stepAbility gater, og kun 1×/sæson),
// så et højere, alders-uafhængigt loft genåbnede væksten for post-peak-ryttere og
// den overhalede sæson-declinen.
//
// Denne taper løser det ved at aftrappe det ABSOLUTTE loftets bidrag efter
// peakAge. Ingen spiller mister evne af den grund — taperen begrænser kun
// fremtidig VÆKST: falder det tapered loft til/under current, giver
// dailyAbilityDelta gap = max(0, cap − current) = 0 → ingen daglig vækst
// tilbage, og sæsonens decline (stepAbility) dominerer igen alene. (Gulvet
// max(tapered, current), som tidligere gav samme nettoresultat ad en omvej,
// er fjernet i trin 7 — se buildCapsForRider, #3794.)
//
// Allerede skrevet som den rigtige plan i academyFlag.js's #2437-interim-
// kommentar: "jævn alders-taper, egen session". Denne funktion ER den session.
export const CAP_TAPER_CONFIG = Object.freeze({
  // Andel af det absolutte loft der er "tilbage" N år efter peakAge. Lineær
  // interpolation mellem ankrene (år ift. peakAge → retain-andel); fladt på
  // sidste ankers retain derefter. retain=0 ved 12 år forbi peak (dvs. alder 40
  // ved unified peakAge=28) — loftet bidrager intet, gulvet definerer cap alene.
  retainByYearsPastPeak: Object.freeze([
    { years: 0, retain: 1.0 },
    { years: 5, retain: 0.6 },
    { years: 9, retain: 0.3 },
    { years: 12, retain: 0.0 },
  ]),
});

// Lineær interpolation af retain-andelen på years-ankrene (0..sidste, clamp udenfor).
function interpolateRetain(yearsPast, anchors) {
  if (yearsPast <= anchors[0].years) return anchors[0].retain;
  for (let i = 1; i < anchors.length; i++) {
    const prev = anchors[i - 1];
    const cur = anchors[i];
    if (yearsPast <= cur.years) {
      const t = (yearsPast - prev.years) / (cur.years - prev.years);
      return prev.retain + (cur.retain - prev.retain) * t;
    }
  }
  return anchors[anchors.length - 1].retain;
}

// Aftrap ÉT absolut loft-tal efter alder. age ≤ peakAge ⇒ uændret (retain=1.0).
// Rent tal ind/ud — ingen clamp her (clamp 0-99 sker i buildCapsForRider EFTER
// gulvet er anvendt, så en tapered værdi aldrig kan clampe forkert alene).
// age null/undefined ⇒ uændret (sikker default for callers der ikke sender alder,
// jf. samme "valgfri, bagudkompatibel" kontrakt som academyRateMult/staff m.fl.).
export function taperedAbsoluteCap(absoluteCap, age, peakAge = PROGRESSION_CONFIG.peakAge, cfg = CAP_TAPER_CONFIG) {
  const cap = Number(absoluteCap) || 0;
  const a = Number(age);
  if (!Number.isFinite(a) || a <= peakAge) return cap;
  const retain = interpolateRetain(a - peakAge, cfg.retainByYearsPastPeak);
  return cap * retain;
}

function lookup(table, value, key, field) {
  for (const row of table) if (value <= row[key]) return row[field];
  return table[table.length - 1][field];
}

// Loft (potential ability) for én evne — uforanderligt, sættes ved init fra baseline.
export function abilityCap(baselineAbility, primaryType, ability, potentiale, cfg = PROGRESSION_CONFIG) {
  const headroom = headroomForPotential(potentiale, cfg) * signatureFactor(primaryType, ability, cfg);
  return clamp(Math.round(baselineAbility + headroom), 0, 99);
}

// Ét sæson-skridt for én evne. Returnerer den nye current (afrundet, clamp 0-99).
//   current  : nuværende ability
//   cap      : loftet (fra abilityCap)
//   age      : rytterens alder VED sæson-skiftet
//   peakAge  : type-peak
//   isSignature : true hvis positiv type-vægt (styrer fald-hastighed)
//   noiseUnit: seededUnit(`${rider_id}:${season}:${ability}`) ∈ [0,1)
//   growthMult: træningsbias på vækst-fraktionen (#1163); 1 = ingen træning.
//               Påvirker KUN vækst-fasen (alder ≤ peak) — træning fremskynder ikke decline.
export function stepAbility(current, cap, age, peakAge, isSignature, noiseUnit, cfg = PROGRESSION_CONFIG, growthMult = 1) {
  const c = Number(current);
  if (!Number.isFinite(c)) return current;

  if (age <= peakAge) {
    // Vækst mod loft (gør intet hvis allerede på/over loft).
    const gap = cap - c;
    if (gap <= 0) return Math.round(c);
    const baseFrac = lookup(cfg.growthFractionByAge, age, "maxAge", "frac");
    const noise = (noiseUnit * 2 - 1) * cfg.growthNoise; // [-growthNoise, +growthNoise]
    const frac = clamp(baseFrac * (1 + noise) * (Number(growthMult) || 1), 0, 1);
    return clamp(Math.round(c + gap * frac), 0, 99);
  }
  // Fald efter peak.
  const yearsPast = age - peakAge;
  const drop = lookup(cfg.declineByYearsPastPeak, yearsPast, "maxYears", "drop")
    * (isSignature ? 1 : cfg.offTypeDeclineFactor);
  return clamp(Math.round(c - drop), 0, 99);
}

// Seeded retirement-beslutning for én rytter i én sæson. Returnerer
// { retire, notice } hvor notice = "varsles nu, exit om noticeSeasons sæsoner".
export function retirementDecision(age, riderId, season, cfg = PROGRESSION_CONFIG) {
  const { windowStartAge, guaranteedAge } = cfg.retirement;
  if (age < windowStartAge) return { retire: false, notice: false };
  if (age >= guaranteedAge) return { retire: true, notice: true };
  const p = (age - windowStartAge) / (guaranteedAge - windowStartAge);
  const roll = seededUnit(`retire:${riderId}:${season}`);
  return { retire: roll < p, notice: roll < p };
}

// #2748 pension-minimum: forudsig DETERMINISTISK ved den AKTIVE sæsons START om
// rytteren pensioneres når sæsonen SLUTTER — uden at vente på season-transition-
// motoren (som først kører ved NÆSTE sæsons cutover).
//
// Skal ramme 100% samme svar som motoren rent faktisk beslutter. Sporet gennem
// riderProgressionEngine.js: ved processSeasonStart(N) sættes
//   age = ageForSeason(birthdate, N)
// og developRiderSeason() kalder derefter
//   retirementDecision(age − 1, riderId, season=N, cfg)
// Så: retirering "ved udgangen af sæson A" bliver FAKTISK afgjort når sæson A+1
// starter (N = A+1), med age − 1 = ageForSeason(birthdate, A+1) − 1. Da
// ageForSeason er lineær i sæsonnummeret (riderSeasonAge.js: ét sæsonnummer op
// = ét år op, ingen afrunding/spring), er det PRÆCIS ageForSeason(birthdate, A).
// Denne funktion regner derfor direkte på (ageForSeason(birthdate, A), season=A+1)
// — samme seed-nøgle (`retire:${riderId}:${A+1}`) som motoren vil bruge, blot
// beregnet på forhånd i stedet for at vente på cutover. Se
// riderProgression.test.js for beviset (samme svar som en simuleret
// developRiderSeason-kørsel ved A+1).
export function announcedRetirementAfterSeason(rider, activeSeason, cfg = PROGRESSION_CONFIG) {
  const age = ageForSeason(rider?.birthdate, activeSeason);
  if (age == null || rider?.id == null) return false;
  return retirementDecision(age, rider.id, activeSeason + 1, cfg).retire;
}

// Beregn én sæsons udvikling for en rytter på tværs af alle synlige evner.
//   rider     : { id, primary_type, potentiale, age }  (age = alder VED det nye sæson-skifte)
//   abilities : { climbing, sprint, ... } current-værdier
//   caps      : { climbing, sprint, ... } uforanderlige lofter (abilityCap pr. evne)
//   season    : sæson-nummer (seed-komponent)
//   training  : bias-modifier fra training.resolveTrainingModifier(...) | null (#1163).
//               { focusAbilities:Set, focusMult, offFocusMult } — biaser vækst pr. evne.
//   options   : { skipGrowth?: boolean } — anti-double-dip (#1305): når daglig træning
//               er aktiv for menneskelige hold spring VÆKST-fasen (age ≤ peakAge) over
//               pr. evne. Fald (age > peakAge) og retirement kører ALTID uændret.
//               Ingen effect på default-adfærd (options udeladt eller skipGrowth falsy).
// Returnerer { next: {<ability>: value}, changed: [...], retirement: {...} }.
export function developRiderSeason(rider, abilities, caps, season, cfg = PROGRESSION_CONFIG, training = null, options = {}) {
  const age = Number(rider.age);
  const type = rider.primary_type;
  const peakAge = peakAgeForType(type, cfg);
  const skipGrowth = options?.skipGrowth === true;
  const next = {};
  const changed = [];

  for (const ability of VISIBLE_ABILITIES) {
    const cur = abilities?.[ability];
    if (cur == null) continue;
    // skipGrowth: vækst-fasen (age ≤ peakAge) springes over — evnen forbliver uændret.
    // Fald-fasen (age > peakAge) kører som normalt — decline er sæsonbaseret for alle.
    if (skipGrowth && age <= peakAge) {
      next[ability] = Math.round(Number(cur));
      continue;
    }
    const isSig = signatureFactor(type, ability, cfg) >= 1.0;
    const cap = caps?.[ability] ?? abilityCap(cur, type, ability, rider.potentiale, cfg);
    const noiseUnit = seededUnit(`grow:${rider.id}:${season}:${ability}`);
    const potRate = youthRateForPotential(rider.potentiale);
    const growthMult = (training
      ? (training.focusAbilities.has(ability) ? training.focusMult : training.offFocusMult)
      : 1) * potRate;
    const val = stepAbility(cur, cap, age, peakAge, isSig, noiseUnit, cfg, growthMult);
    next[ability] = val;
    if (val !== Math.round(Number(cur))) changed.push(ability);
  }

  return {
    next,
    changed,
    // Ejer-regel 26/7 (cutover S1→S2): pension måles på den AFSLUTTEDE sæsons
    // alder (age − 1), ikke den nye sæsons. Spillerne er lovet pension "mellem
    // 36-40" — en rytter de har set som 35 hele sæsonen må ikke pensioneres
    // minutter efter sæsonslut. Konsekvens: ingen pension under synlig alder 36,
    // og garantien rammer efter sæsonen som synlig 40-årig (aldrig en 41-sæson).
    retirement: retirementDecision(age - 1, rider.id, season, cfg),
  };
}

// Potentiale → vækst-rate-multiplikator (lineær interpolation på rateByPotential).
export function youthRateForPotential(potentiale, cfg = YOUTH_PROGRESSION_CONFIG) {
  const p = clamp(Number(potentiale) || 1, 1, 6);
  const lo = Math.floor(p), hi = Math.ceil(p);
  const a = cfg?.rateByPotential?.[lo] ?? 1;
  const b = cfg?.rateByPotential?.[hi] ?? a;
  return a + (b - a) * (p - lo);
}

// SUPERSEDERET (trin 7): den gamle models potentiale-ankrede loft. Læses ikke
// af motoren; beholdt for historiske målinger (ingen levende kaldested — kun
// kommentar-referencer i backend/scripts/*, ikke reelle imports). `_`-præfiks
// er den lokale eslint-konvention for bevidst-unused (#3746 warning-budget-fund,
// pre-eksisterende siden commit d02b524b — rettet her, ikke omfattet af
// arkitektens "kun ændres ved defekt"-klausul for riderPrognosis/scoutingReport).
function _youthLoftForPotential(potentiale, cfg = YOUTH_PROGRESSION_CONFIG) {
  const p = clamp(Number(potentiale) || 1, 1, 6);
  const lo = Math.floor(p), hi = Math.ceil(p);
  const a = cfg.loftByPotential[lo] ?? 0;
  const b = cfg.loftByPotential[hi] ?? a;
  return a + (b - a) * (p - lo);
}

// Loftet for én evne = rolleklassens absolutte tag (trin 7, #3746, ejer 16/8).
// `potentiale` indgår IKKE længere — det styrer kun farten (rateByPotential).
// Parameteren beholdes i signaturen: (a) alle callers sender den allerede, og
// (b) .length === 5-kontrakten (ingen skjult baseline-param) er pinnet i test.
//
// GC-punch-gulvet (#4634/#4098, 4/9, variant C2 — se GC_PUNCH_FLOOR ovenfor)
// lægges oveni klasse-taget som en ren MAX, samme gulv-løft-invariant som
// håndværket bruger: den kan aldrig sænke et tag, kun løfte punch for `gc`.
export function youthAbilityCap(potentiale, primaryType, secondaryType, ability, cfg) {
  const c = cfg ?? YOUTH_PROGRESSION_CONFIG;
  let tag = tagForClass(abilityRoleClass(primaryType, secondaryType, ability, c), c);
  if (primaryType === "gc" && ability === "punch") {
    tag = Math.max(tag, GC_PUNCH_FLOOR);
  }
  return clamp(Math.round(tag), 0, 99);
}

// Byg caps-sættet for en ung over alle synlige evner.
export function buildYouthCaps(potentiale, primaryType, secondaryType, cfg = YOUTH_PROGRESSION_CONFIG) {
  const caps = {};
  for (const ability of VISIBLE_ABILITIES) {
    caps[ability] = youthAbilityCap(potentiale, primaryType, secondaryType, ability, cfg);
  }
  return caps;
}

// Byg loft-sættet for en rytter fra dens baseline-abilities (kaldes ÉN gang ved init).
export function buildCaps(baselineAbilities, primaryType, potentiale, cfg = PROGRESSION_CONFIG) {
  const caps = {};
  for (const ability of VISIBLE_ABILITIES) {
    const base = baselineAbilities?.[ability];
    if (base == null) continue;
    caps[ability] = abilityCap(base, primaryType, ability, potentiale, cfg);
  }
  return caps;
}

// ── Init-helpers for ability_caps + ability_progress (#2001) ─────────────────
// ability_caps + ability_progress var KUN populeret lazily ved første sæson-
// progression (riderProgressionEngine) eller daglig trænings-tick (dailyTrainingEngine).
// Ryttere der aldrig blev udviklet/trænet (free agents, ikke-tickede hold) endte med
// begge NULL — den nye rytter-side kan så ikke vise progress-bar/caps ægte. Disse
// helpers giver derive-stien (backfillCores) + en backfill-script ÉN delt, ren init
// der matcher præcis det loft motoren ellers ville lazy-initте.

// Det fulde caps-sæt for EN VILKÅRLIG rytter — ÉN semantik for alle aldre.
//
//   loft = afrundet( tapered( rolleklassens tag ) )        (trin 7, #3746)
//
// Konsolideringen til ÉN semantik er EJER-BESLUTTET 2026-07-15 (to uforenelige
// loft-modeller levede før side om side, og hvilken en rytter fik var et
// møntkast). Trin 7 (ejer 16/8) fjernede potentiale fra formlen: taget sættes
// af rolleklassen alene, potentiale styrer kun farten.
//
// ALDERS-UAFHÆNGIG med vilje: en semantik der skiftede ved 21→22 ville flytte rytterens
// livstidsloft på fødselsdagen — den bombe var kun udetoneret fordi sæson 1 stadig kører.
//
// Returnerer et 15-nøgle objekt (alle VISIBLE_ABILITIES).
//   abilities : { climbing, sprint, ... } nuværende/afledte evner (bruges ikke
//               i formlen efter #3794 — se gulv-blokken nedenfor)
//   rider     : { potentiale, age } — age er PÅKRÆVET, se kontrakten nedenfor
//   primaryType/secondaryType : ryttertype-nøgler (anlæggets to retninger)
//
// #2472 (16/7, ejer-valg B): det absolutte loft aftrappes efter peakAge via
// taperedAbsoluteCap — se den funktion for hvorfor (blocker-fund: uden taper
// ophæver #2472's konsolidering aldringen for post-peak-ryttere).
//
// ── ALDERS-KONTRAKTEN (#3591, 13/8): `age` SKAL angives eksplicit ────────────
// `age` var indtil nu dokumenteret som VALGFRI ("udeladt ⇒ intet taper,
// bagudkompatibelt"). Præcis den valgfrihed var rodårsagen bag #3591: to
// skrivestier kaldte den samme funktion med forskellig signatur, og forskellen
// var TAVS — den producerede et gyldigt, men for højt loft i stedet for en fejl.
//
//   dailyTrainingEngine.js:314  buildCapsForRider(ab, { ...rider, age }, ...)   MED alder
//   backfillCores.js:319        buildCapsForRider(ab, { potentiale }, ...)      UDEN alder
//
// Følgen målt på 10/8-snapshottet: kun 46 af 3.473 AI-rytteres gemte lofter
// matchede noget buildCapsForRider-output overhovedet, og 45,4 % ville tabe loft
// alene ved kaldformen. PR #3598 rettede det ene kaldsted; det gjorde ikke
// divergensen umulig — `starterSquadAllocator.js` kaldte stadig uden alder
// (fundet 13/8, mens dette blev skrevet, tre dage efter "rettelsen").
//
// Derfor er kontrakten nu EKSPLICIT frem for valgfri:
//   age = et tal   ⇒ loftet aftrappes efter peakAge (produktionens semantik)
//   age = null     ⇒ BEVIDST intet taper (offline-analyse, syntetiske fixtures)
//   age udeladt    ⇒ TypeError — en caller kan ikke længere glemme alderen tavst
//
// `null` er stadig lovligt fordi «ingen alder» er en ægte, meningsfuld tilstand
// for harnesses der måler netop taper-effekten. Forskellen er at den nu skal
// SKRIVES, og dermed ses i et review, i stedet for at opstå ved udeladelse.
// ── GULVET ER FJERNET (trin 7, #3794, ejer 16/8) ─────────────────────────────
// Loftet var `max(tapered, current)`. Begrundelsen i koden var "ingen spiller
// mister evne han ejer" — men det tab kan ikke ske, gulv eller ej (verificeret
// 15/8 på #3794): dailyTraining lægger kun til (loft under evnen giver gap = 0,
// altså nul vækst, ikke tab), stepAbility returnerer uændret ved gap <= 0, og
// declineByYearsPastPeak læser slet ikke loftet. Gulvets reelle virkning var at
// binde loftet til evnen for 78 % af rytterne, så det viste potentiale flyttede
// sig hver gang de trænede. Uden gulvet er ability_caps rent formel-bestemt og
// dermed STABILT mellem kalibreringer. En rytter med en evne over sit tag
// beholder evnen og står stille dér (ejer-beslutning 8, 15/8).
//
// Afrundingen til heltal er #3788: taperingen kunne give et loft midt i et
// niveau (fx 80,25), så træningsbaren viste fremgang mod et niveau rytteren
// aldrig kunne nå.
//
// `abilities` beholdes i signaturen: alle callers sender den, og den bevarer
// muligheden for fremtidige abilities-afhængige regler uden endnu et #3591-
// kaldeform-skisma.
export function buildCapsForRider(abilities, { potentiale, age } = {}, primaryType, secondaryType) {
  if (age === undefined) {
    throw new TypeError(
      "buildCapsForRider: `age` skal angives eksplicit (#3591). Send sæson-alderen " +
      "(ageForSeason(birthdate, seasonNumber)) — eller `age: null` hvis taperen bevidst skal udelades.",
    );
  }
  const absolute = buildYouthCaps(potentiale, primaryType, secondaryType);
  const peakAge = peakAgeForType(primaryType);
  const caps = {};
  for (const ability of VISIBLE_ABILITIES) {
    const tapered = taperedAbsoluteCap(absolute[ability] ?? 0, age, peakAge);
    caps[ability] = clamp(Math.round(tapered), 0, 99);
  }
  return caps;
}

// Er to caps-sæt ens over alle synlige evner? Motorerne genberegner loftet hver tick,
// men skal kun SKRIVE når det faktisk flyttede sig — ellers ville hver rytter få en
// overflødig UPDATE pr. tick. Et manglende/ikke-objekt loft tæller som forskelligt,
// så det bliver skrevet første gang.
export function sameCaps(a, b) {
  if (!a || typeof a !== "object" || !b || typeof b !== "object") return false;
  return VISIBLE_ABILITIES.every((ability) => Number(a[ability]) === Number(b[ability]));
}

// Nul-initialiseret progress-objekt over alle synlige evner: { climbing: 0, ... }.
// En aldrig-trænet rytter HAR ægte nul akkumuleret træning, så 0 er sandt (ikke en
// placeholder). Frontend viser kun en bar når fraktion > 0 → nul = ingen bar endnu,
// men feltet er nu et velformet, ikke-NULL objekt som rework-siden kan læse direkte.
export function buildProgressInit() {
  const progress = {};
  for (const ability of VISIBLE_ABILITIES) progress[ability] = 0;
  return progress;
}
