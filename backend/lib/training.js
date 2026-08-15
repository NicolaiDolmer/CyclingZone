// Progression L2 — træning (teaser) (#1163 / epic #931 / #1136) — RENE funktioner.
//
// Ejer-besluttet 2026-06-08 (design-session): sæson-granulær TRÆNINGSFOKUS som
// on-ramp til den fulde Zwift/TrainingPeaks-epic. En manager vælger ét fokus +
// intensitet for op til slotsPerSeason nøgleryttere pr. sæson. Ved sæson-skift
// biaser planen den passive motor (#1137) mod cap — gated bag SAMME flag som
// #1137 (intent+UI ved launch, mekanik når progression tændes).
//
// Backend ejer KUN ledgeren (training_plans): én aktiv row pr. (hold, rytter,
// sæson). Denne fil er ren JS uden DB/Date/Math.random, så den kan unit-testes
// isoleret og køres deterministisk i season-transition (genbruger seededUnit fra
// riderProgression for reproducerbar risiko).

import { seededUnit, signatureFactor, PROGRESSION_CONFIG, abilityRoleClass, YOUTH_PROGRESSION_CONFIG } from "./riderProgression.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";

// ── EJER-JUSTERBARE KONSTANTER (kalibreres i scripts/previewTraining.js) ────────
export const TRAINING_CONFIG = Object.freeze({
  // Antal aktive træningsfokus en manager har pr. sæson. Spejler scouting (#1138)
  // — udledes pr. aktiv sæson, ingen reset-hook. Gratis (fair-premium).
  slotsPerSeason: 3,

  // #1305: Daglig træning = ubegrænsede programmer (hele truppen). Slot-cap bevares
  // for eventuel fremtidig brug (backward compat), men håndhæves ikke når dette er sat.
  unlimitedSlots: true,

  // Gyldige intensiteter (display via i18n; nøgler er stabile).
  // "rest" er nu gyldig — daglig intensitet, ingen vækst (håndteres i dailyTraining.js).
  // "recovery" (#3762) er aktiv restitution: mindre vækst end let, og trætheden
  // falder stadig — men langsommere end på en hviledag (se fatigueLoad).
  intensities: Object.freeze(["easy", "normal", "hard", "rest", "recovery"]),

  // Vækst-multiplikator på FOKUS-evnernes gap-lukning mod cap, pr. intensitet.
  // Startgæt — dry-run'es mod population før un-gating af progression.
  // `recovery` ligger under `easy`: en restitutionsdag skal kunne mærkes, men
  // aldrig konkurrere med en rigtig træningsdag — ellers er den ikke hvile,
  // den er bare den billigste træning.
  focusGrowthMult: Object.freeze({ easy: 1.15, normal: 1.35, hard: 1.60, recovery: 0.50 }),

  // Ikke-fokus-evner lukker mindre samme sæson (fokus-trade-off): du
  // specialiserer mod X frem for breddevækst.
  //
  // ── 0,97 → 0,35 (#3709 trin 4, spec §2.2, ejer 14/8) ──────────────────────
  // Den gamle værdi var bevidst MILD, og begrundelsen var god på sin tid: en
  // dry-run i #1163 viste at 0,90 ramte alle ~13 ikke-fokus-evner så hårdt at
  // træning blev netto-negativ, så ingen ville træne. Men 0,97 betød i praksis
  // at fokusvalget ikke betød noget: forskellen mellem at træne rigtigt og
  // forkert gennem en hel karriere blev målt til 3 point ud af 60.
  //
  // Grunden til at 0,35 nu er sikkert, hvor 0,90 dengang var farligt, er at
  // ROLLE-RATEN er kommet til (riderProgression.ROLE_CLASS_RATE). I #1163 var
  // off-fokus-straffen den ENESTE bremse, så den ramte signatur-evner og
  // svagheder lige hårdt. Nu bærer rolleklassen forskellen, og off-fokus
  // afgør kun hvad manageren PRIORITERER inden for den. De to håndtag er
  // begge nødvendige — negativ-testen beviser det: køres kandidaten med
  // offFocusMult uændret på 0,97, falder agens-spændet fra 13 til 7 point og
  // arketype-spændet tilbage til 0,03, altså uændret fra i dag.
  offFocusMult: 0.35,

  // Seeded risiko for tilbageslag (overtraining → tabt vækst), pr. intensitet.
  // Let = ingen risiko; hård = mærkbar. Varsles tydeligt i UI.
  // `recovery` har ingen risiko — en restitutionsdag der kan give tilbageslag
  // ville være selvmodsigende.
  setbackChance: Object.freeze({ easy: 0, normal: 0.05, hard: 0.18, recovery: 0 }),
  // Når tilbageslag rammer: sæsonens samlede vækst skaleres med denne faktor.
  setbackGrowthMult: 0.5,
});

// Fokus-nøgle → de evner (rider_derived_abilities) fokus skubber mod cap.
// Træningssprog der overlever ind i den fulde epic (sessions-kataloget).
// #3762: `tempo` og `restitution` er kommet til. De to er sessioner i den nye
// dagstype-model (trainingDayTypes.js), ikke nye frie fokus — hvornår de kan
// vælges afgøres af dagstypen. De står her fordi motoren slår evnerne op i
// netop denne tabel; havde de ikke stået her, ville de træne ingenting.
export const TRAINING_FOCUSES = Object.freeze({
  vo2max:      Object.freeze(["climbing", "punch", "tempo"]),
  threshold:   Object.freeze(["time_trial", "tempo"]),
  sprint:      Object.freeze(["sprint", "acceleration"]),
  endurance:   Object.freeze(["endurance", "recovery", "durability"]),
  technique:   Object.freeze(["descending", "positioning", "cobblestone"]),
  aero:        Object.freeze(["time_trial", "flat"]),
  tempo:       Object.freeze(["tempo", "flat", "durability"]),
  restitution: Object.freeze(["recovery"]),
});
export const TRAINING_FOCUS_KEYS = Object.freeze(Object.keys(TRAINING_FOCUSES));

// ⚠ FROSSET LISTE — rør den ikke når du tilføjer et fokus (#3762).
//
// `smartDefaultFocus` vælger det fokus assistenten træner en IKKE-planlagt
// rytter med, live for tusindvis af ryttere. Den returnerer det FØRSTE fokus
// med "strength" i nøgle-rækkefølge, så et nyt fokus i TRAINING_FOCUSES ville
// kunne ændre assistentens valg for en hel type uden at nogen bad om det.
// Specens krav er eksplicit: "smartDefaultFocus må ikke ændres som sideeffekt"
// — den er verificeret bit-identisk gennem trin 3 og 4 og pinnet i en test.
// Et nyt fokus skal derfor tilføjes HER bevidst, med en egen måling.
export const SMART_DEFAULT_FOCUS_KEYS = Object.freeze([
  "vo2max", "threshold", "sprint", "endurance", "technique", "aero",
]);

export function isValidFocus(focus) {
  return Object.prototype.hasOwnProperty.call(TRAINING_FOCUSES, focus);
}
export function isValidIntensity(intensity, cfg = TRAINING_CONFIG) {
  return cfg.intensities.includes(intensity);
}

// Udled træningsstate for ÉT hold ud fra dets training_plans-rows.
//   rows           : [{ rider_id, season_id, focus, intensity }, ...] (kun dette holds rows)
//   activeSeasonId : den aktive sæsons id (slots + aktive planer tælles kun her)
// Returnerer { slots:{total,used,remaining}, focuses:[...], intensities:[...],
//   plans:{<rider_id>:{focus,intensity}} } hvor plans kun er den aktive sæsons.
// Når cfg.unlimitedSlots=true: slots.total=null, slots.remaining=null (UI: ubegrænset).
export function deriveTrainingState(rows, activeSeasonId, cfg = TRAINING_CONFIG) {
  const plans = {};
  let used = 0;
  for (const row of rows ?? []) {
    if (activeSeasonId == null || row.season_id !== activeSeasonId) continue;
    plans[row.rider_id] = { focus: row.focus, intensity: row.intensity };
    used++;
  }
  const unlimited = cfg.unlimitedSlots === true;
  const total = unlimited ? null : cfg.slotsPerSeason;
  const remaining = unlimited ? null : Math.max(0, cfg.slotsPerSeason - used);
  return {
    slots: { total, used, remaining },
    focuses: TRAINING_FOCUS_KEYS,
    intensities: cfg.intensities,
    plans,
  };
}

// Må dette hold sætte/ændre en plan på denne rytter lige nu? Ren guard.
//   hasPlan        : har holdet allerede en aktiv plan på rytteren i sæsonen?
//   slotsRemaining : tilbageværende slots i sæsonen (null = ubegrænset)
// Om-målretning af en eksisterende plan koster ikke et nyt slot; kun en NY plan gør.
// Returnerer { ok, reason } hvor reason ∈ "no_slots" | null.
export function canTrain(hasPlan, slotsRemaining, cfg = TRAINING_CONFIG) {
  if (hasPlan) return { ok: true, reason: null };
  if (cfg.unlimitedSlots === true) return { ok: true, reason: null };
  if ((slotsRemaining ?? 0) <= 0) return { ok: false, reason: "no_slots" };
  return { ok: true, reason: null };
}

// #1885: øvre grænse for hvor mange ryttere ét bulk-træningsrequest må røre.
// En lovlig trup er 30 senior + akademi (~realistisk < 50); 100 er en rummelig
// DoS-bund uden at ramme nogen legitim "anvend på hele truppen"-handling.
export const BULK_TRAINING_MAX_RIDERS = 100;

// #1885: resolver ét bulk-træningsrequest. Frontend sender de ønskede riderIds;
// vi partitionerer dem mod hvad holdet faktisk ejer + slot-budgettet, så route-
// handleren kan upserte ALLE gyldige i ÉT kald (i stedet for ét HTTP-request pr.
// rytter, der sprængte marketWriteLimiter på en fuld trup).
//   riderIds        : ønskede rytter-ids (kan have dubletter/null)
//   ownedRiderIds   : Set/array af ids holdet ejer (kalderen slår op i DB)
//   plannedRiderIds : ids der ALLEREDE har en aktiv plan (re-targeting = gratis slot)
//   slotsRemaining  : tilbageværende slots (null = ubegrænset; default-konfig)
// Returnerer { toApply, skippedNotOwned, skippedNoSlots } — alle arrays, deduped,
// i input-rækkefølge. Slot-grenen er inert når slotsRemaining=null (unlimitedSlots).
export function partitionBulkTrainingTargets({
  riderIds,
  ownedRiderIds,
  plannedRiderIds = [],
  slotsRemaining = null,
} = {}) {
  const owned = ownedRiderIds instanceof Set ? ownedRiderIds : new Set(ownedRiderIds ?? []);
  const planned = plannedRiderIds instanceof Set ? plannedRiderIds : new Set(plannedRiderIds ?? []);
  const seen = new Set();
  const toApply = [];
  const skippedNotOwned = [];
  const skippedNoSlots = [];
  let remaining = slotsRemaining; // null = ubegrænset
  for (const id of riderIds ?? []) {
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    if (!owned.has(id)) {
      skippedNotOwned.push(id);
      continue;
    }
    const isNewPlan = !planned.has(id);
    if (isNewPlan && remaining != null) {
      if (remaining <= 0) {
        skippedNoSlots.push(id);
        continue;
      }
      remaining -= 1;
    }
    toApply.push(id);
  }
  return { toApply, skippedNotOwned, skippedNoSlots };
}

// #1894 variant 3: partitionér et bulk-smart-focus-request. Smart-mode adskiller sig
// fra partitionBulkTrainingTargets på ÉT punkt: ryttere med en EKSISTERENDE plan
// springes over (ikke re-target) — en managers eget valg må ALDRIG overskrives af
// "anvend smart fokus på hele truppen". Ren funktion; kaldes af routes/api.js FØR
// partitionBulkTrainingTargets (som stadig håndterer ejerskab + slot-budget).
//   riderIds        : ønskede rytter-ids (kan have dubletter/null)
//   plannedRiderIds : ids der ALLEREDE har en aktiv plan i denne sæson
// Returnerer { eligible, skippedHasPlan } — deduped, input-rækkefølge bevaret.
export function partitionSmartBulkTargets({ riderIds, plannedRiderIds = [] } = {}) {
  const planned = plannedRiderIds instanceof Set ? plannedRiderIds : new Set(plannedRiderIds ?? []);
  const seen = new Set();
  const eligible = [];
  const skippedHasPlan = [];
  for (const id of riderIds ?? []) {
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    if (planned.has(id)) skippedHasPlan.push(id);
    else eligible.push(id);
  }
  return { eligible, skippedHasPlan };
}

// Resolvér en plan til en bias-modifier som riderProgression.developRiderSeason
// konsumerer. Seeder tilbageslags-rullet deterministisk pr. (rytter, sæson, plan).
//   plan         : { focus, intensity } | null
//   riderId      : seed-komponent
//   seasonNumber : seed-komponent (samme sæson → samme udfald)
// Returnerer null hvis ingen/ugyldig plan, ellers
//   { focusAbilities:Set<string>, focusMult:number, offFocusMult:number, setbackHit:boolean }.
// #1974: coarse, type-derived trainability-signal pr. fokus — UI-hint om HVORFOR
// et fokus knap ikke rykker en given rytter.
//
// #3195 (2026-08-03, rod-årsag rettet): udledes nu af
// youthRoleFactor(primaryType, secondaryType, ability) (riderProgression.js) —
// SAMME model som buildCapsForRider RENT FAKTISK bruger til at beregne
// livstidsloftet for ALLE ryttere uanset alder (ejer-besluttet 2026-07-15, se
// buildCapsForRider-kommentaren: "ÉN semantik for alle aldre"). Den gamle
// version brugte signatureFactor(primaryType) — en forældet to-formel-rest fra
// FØR den konsolidering, der (a) helt ignorerede rytterens SEKUNDÆRE type og
// (b) læste PROGRESSION_CONFIG's egne, andre konstanter (offTypeHeadroomFactor
// 0,35 / "blocked" = 0) i stedet for YOUTH_PROGRESSION_CONFIG (neutralFactor
// 0,45 / oppositeFactor 0,12), som er den model motoren faktisk kører på.
//
// Verificeret mod ægte prod-rytter (Oliver Doyle, primary=tt/secondary=sprinter,
// potentiale 6.0, academy): labelen sagde "Begrænset" på Sprint-fokus ("lidt
// naturligt anlæg... vækst bliver langsom"), mens rider_derived_abilities.
// ability_caps i DB viste sprint=72 / acceleration=72 — dvs.
// loftByPotential[6]=88 × naturalSecondaryFactor 0,82 (hans sekundære
// sprinter-type løfter loftet næsten til fuldt niveau). Den gamle model så kun
// tt-vægtene (sprint:-1, acceleration: uvægtet) og konkluderede fejlagtigt et
// lavt loft. INGEN caps eller potentiale-TAL eksponeres her (server-hidden per
// #1162) — kun den samme kvalitative strength/limited/blocked-tendens som før,
// nu bare udledt af den model der rent faktisk styrer loftet.
//
// Én af:
//   "strength" — mindst én fokus-evne rammer primær- ELLER sekundær-type-match
//                (factor ≥ naturalSecondaryFactor — reelt højt loft, ~82-100%
//                af potentialet)
//   "blocked"  — ALLE fokus-evner er modsat-type i BÅDE primær og sekundær
//                (factor === oppositeFactor, ~12% af potentialet — laveste
//                tier, men IKKE nul; se trainabilityChipBlockedTitle)
//   "limited"  — resten (neutral blanding, factor === neutralFactor, ~45%)
// Ukendt/manglende primærtype → alt "limited" (sikker neutral, ingen falsk positiv/negativ).
export function focusTrainability(primaryType, secondaryType = null, cfg = YOUTH_PROGRESSION_CONFIG) {
  const out = {};
  for (const [focusKey, abilities] of Object.entries(TRAINING_FOCUSES)) {
    if (primaryType == null) {
      out[focusKey] = "limited";
      continue;
    }
    // LABELEN LÆSER KLASSEN, IKKE FAKTOREN (rettet 15/8). Tærsklen var
    // `factor >= naturalSecondaryFactor`, og den holdt kun så længe håndværks-
    // taget (0,95) lå UNDER sekundær. Det gør det ikke: trin 3 indførte 0,95
    // mens sekundær er 0,82, så positioning og tactics ville stå som "strength"
    // for HVER eneste rytter i spillet. Håndværk er per definition det alle kan
    // lære lidt af, aldrig et anlæg. Klassen er uafhængig af kalibreringen.
    const klasser = abilities.map((ability) => abilityRoleClass(primaryType, secondaryType, ability, cfg));
    if (klasser.some((k) => k === "signatur" || k === "sekundaer")) out[focusKey] = "strength";
    else if (klasser.every((k) => k === "svaghed")) out[focusKey] = "blocked";
    else out[focusKey] = "limited";
  }
  return out;
}

// Privat, BEVIDST UÆNDRET fra før #3195 — kun brugt af smartDefaultFocus nedenfor.
// smartDefaultFocus's fokus-VALG er en separat, balance-følsom beslutning: den
// afgør hvilket fokus assistenten rent faktisk træner en ikke-planlagt rytter
// med, live for hele populationen. At gøre DEN sekundær-type-bevidst ville
// ændre hvilket fokus tusindvis af eksisterende ryttere trænes med i prod — det
// kræver egen dry-run + ejer-godkendelse (balance-følsomme-systemer-reglen),
// ikke et biprodukt af #3195's UI-label-rettelse (se PR-beskrivelsen). Denne
// helper er derfor en fastfrossen kopi af #1974's oprindelige
// primær-type-only-model, så smartDefaultFocus's output er 100% uændret.
function legacyPrimaryTypeTier(primaryType, cfg = PROGRESSION_CONFIG) {
  const out = {};
  // SMART_DEFAULT_FOCUS_KEYS, ikke TRAINING_FOCUSES: se kommentaren ved listen.
  for (const focusKey of SMART_DEFAULT_FOCUS_KEYS) {
    const abilities = TRAINING_FOCUSES[focusKey];
    if (primaryType == null) {
      out[focusKey] = "limited";
      continue;
    }
    const factors = abilities.map((ability) => signatureFactor(primaryType, ability, cfg));
    if (factors.some((f) => f >= 1.0)) out[focusKey] = "strength";
    else if (factors.every((f) => f === 0)) out[focusKey] = "blocked";
    else out[focusKey] = "limited";
  }
  return out;
}

// #1894: smart default-fokus for ryttere UDEN aktiv plan (44% af trup ramte
// hardcoded DEFAULT_PROGRAM.focus="endurance" i dailyTraining.js uanset type —
// en sprinter trænede endurance i stedet for sprint). Bruger legacyPrimaryTypeTier
// (se kommentar ovenfor — IKKE den korrigerede focusTrainability, bevidst).
// Deterministisk: første fokus-nøgle (TRAINING_FOCUS_KEYS-rækkefølge) med
// "strength", ellers første ikke-"blocked", ellers "endurance" (sikker
// fallback, ukendt/manglende type).
export function smartDefaultFocus(primaryType, cfg = PROGRESSION_CONFIG) {
  const trainability = legacyPrimaryTypeTier(primaryType, cfg);
  for (const focusKey of SMART_DEFAULT_FOCUS_KEYS) {
    if (trainability[focusKey] === "strength") return focusKey;
  }
  // Manglende/ukendt type (eller en type uden nogen "strength"-fokus) giver ALT
  // "limited" (legacyPrimaryTypeTier) — uden denne guard ville loopet nedenfor
  // vælge "vo2max" (første TRAINING_FOCUS_KEYS-nøgle) blot fordi den kommer
  // først i rækkefølgen, hvilket ikke er en meningsfuld "smart" default.
  // "endurance" matcher DEFAULT_PROGRAM's hidtidige adfærd (bagudkompatibelt).
  const allLimited = SMART_DEFAULT_FOCUS_KEYS.every((k) => trainability[k] === "limited");
  if (allLimited) return "endurance";
  for (const focusKey of SMART_DEFAULT_FOCUS_KEYS) {
    if (trainability[focusKey] !== "blocked") return focusKey;
  }
  return "endurance";
}

// ── #1895 PR 1: ugentlig træningsrytme på holdniveau ────────────────────────────
// Holdets ugerytme (training_week_plans, rider_id IS NULL) sætter en ØNSKET
// intensitet pr. ugedag — fokus rører den ALDRIG (fokus bor 100% i training_plans
// + smartDefaultFocus). Lagdelt opløsning af dagens EFFEKTIVE intensitet pr.
// rytter, se resolveDayIntensity nedenfor.

export const WEEKDAY_KEYS = Object.freeze(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

// days-form: { mon: { intensity: "rest" }, ..., sun: { intensity: "normal" } }.
// Alle 7 ugedags-nøgler kræves (ingen delvis rytme — en manager sætter hele ugen
// på én gang), ukendte nøgler afvises (fx "theme" er reserveret til #2337 men
// skrives ikke af denne PR endnu), og hver dags intensity skal være gyldig.
export function isValidWeekPlanDays(days, cfg = TRAINING_CONFIG) {
  if (!days || typeof days !== "object" || Array.isArray(days)) return false;
  const keys = Object.keys(days);
  if (keys.length !== WEEKDAY_KEYS.length) return false;
  for (const key of keys) {
    if (!WEEKDAY_KEYS.includes(key)) return false;
  }
  for (const weekday of WEEKDAY_KEYS) {
    const entry = days[weekday];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    if (!isValidIntensity(entry.intensity, cfg)) return false;
  }
  return true;
}

// Lagdelt opløsning af dagens EFFEKTIVE intensitet for ÉN rytter. Ren funktion —
// kaldes af dailyTrainingEngine.js pr. rytter pr. tick, og af frontend (ren
// visning, samme regel) for at markere rækker hvor rytmen afviger fra sæson-
// intensiteten. Prioritet (højeste vinder):
//   1) riderOverrideDays[weekday].intensity — rytterens EGEN pr-dag-override
//      (den separate "individuel ugeplan"-flade)
//   2) planIntensity, HVIS hasExplicitPlan — rytterens egen individuelle
//      trænings-indstilling (training_plans, sat af spilleren pr. rytter).
//      #2438 — ejerens præcedens: en individuel rytter-indstilling overtrumfer
//      den ugentlige rutine; rutinen er kun default for ryttere UDEN override.
//      Før denne fix vandt holdrytmen ubetinget over rytterens egen intensitet
//      (fx "rest"), selv når rytteren havde en eksplicit plan — det var kilden
//      til #2438 ("hele mit hold trænede hard selvom jeg satte dem til rest").
//   3) teamWeekDays[weekday].intensity — holdets ugerytme, som DEFAULT for
//      ryttere uden egen eksplicit plan
//   4) planIntensity — sidste fallback (typisk DEFAULT_PROGRAM="normal" når
//      rytteren slet ingen plan har; kalderen har allerede resolvet dette)
//   5) "normal" — sidste sikkerhedsnet hvis planIntensity selv mangler
//   weekday           : én af WEEKDAY_KEYS ("mon".."sun")
//   riderOverrideDays : rytterens days-objekt (rider_id sat) eller null
//   teamWeekDays      : holdets days-objekt (rider_id IS NULL) eller null
//   planIntensity     : allerede-resolvet sæson-/default-intensitet
//   hasExplicitPlan   : true hvis rytteren selv har sat focus+intensity
//                       (training_plans-row eksisterer med begge felter sat)
export function resolveDayIntensity({
  weekday, riderOverrideDays, teamWeekDays, planIntensity, hasExplicitPlan = false,
}) {
  const riderOverride = riderOverrideDays?.[weekday]?.intensity;
  if (isValidIntensity(riderOverride)) return riderOverride;

  if (hasExplicitPlan && isValidIntensity(planIntensity)) return planIntensity;

  const teamDay = teamWeekDays?.[weekday]?.intensity;
  if (isValidIntensity(teamDay)) return teamDay;

  if (isValidIntensity(planIntensity)) return planIntensity;

  return "normal";
}

// #2578: hvilke SYNLIGE evner står på deres livstidsloft, ud fra den persisterede
// rider_derived_abilities-row (ability_caps skrives af motorerne, frisk pr. seneste
// tick efter #2471/#2472). Returnerer KUN ability-nøgler — aldrig tal: caps og
// potentiale er server-hidden (#1162), og markeringen må kun afsløre AT loftet er
// nået, ikke hvor det ligger. Manglende/ukendt cap ⇒ ikke markeret (konservativt:
// hellere en progress-bar for meget end en falsk "færdigudviklet"); current ≥ 99
// er dog ALTID på loftet (dailyTraining.js klipper ved min(99, cap)).
export function cappedVisibleAbilities(abilityRow) {
  if (!abilityRow || typeof abilityRow !== "object") return [];
  const caps = abilityRow.ability_caps;
  const out = [];
  for (const ability of VISIBLE_ABILITIES) {
    const current = Number(abilityRow[ability]);
    if (!Number.isFinite(current)) continue;
    if (current >= 99) { out.push(ability); continue; }
    const cap = Number(caps?.[ability]);
    if (Number.isFinite(cap) && current >= Math.min(99, cap)) out.push(ability);
  }
  return out;
}

export function resolveTrainingModifier(plan, riderId, seasonNumber, cfg = TRAINING_CONFIG) {
  if (!plan || !isValidFocus(plan.focus) || !isValidIntensity(plan.intensity, cfg)) return null;
  const focusAbilities = new Set(TRAINING_FOCUSES[plan.focus]);
  // "rest" i den sæsonale sti behandles som "easy": ingen vækst-boost, aldrig setback.
  // Den daglige sti (dailyTraining.js/abilityMult) håndterer rest-semantikken selvstændigt.
  const effectiveIntensity = plan.intensity === "rest" ? "easy" : plan.intensity;
  const baseFocus = cfg.focusGrowthMult[effectiveIntensity] ?? 1;
  const chance = plan.intensity === "rest" ? 0 : (cfg.setbackChance[effectiveIntensity] ?? 0);
  const roll = seededUnit(`train:${riderId}:${seasonNumber}:${plan.focus}:${plan.intensity}`);
  const setbackHit = roll < chance;
  const dampen = setbackHit ? cfg.setbackGrowthMult : 1;
  return {
    focusAbilities,
    focusMult: baseFocus * dampen,
    offFocusMult: cfg.offFocusMult * dampen,
    setbackHit,
  };
}
