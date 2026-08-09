// Importérbare backfill-kerner (#1103) — ekstraheret fra de tre CLI-scripts
// (backfillRacePhysiology.js, backfillRiderTypes.js, backfillRiderBaseValue.js)
// så relaunch-orchestratoren og CLI'erne deler ÉN implementering.
//
// Hver kerne modtager en `supabase`-klient (bygger ikke sin egen), respekterer
// `dryRun` (ingen writes), logger via en injicerbar `log`, og returnerer en summary.
// Beregningslogikken er uændret — kun env/createClient/process.exit-skallen flyttede
// ud i CLI-wrapperne.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "./supabasePagination.js";
import { STAT_KEYS } from "./fictionalRiderGenerator.js";
import { seedPhysiologyFromLegacy } from "./physiologySeeding.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { buildCapsForRider, buildProgressInit } from "./riderProgression.js";
import { computeRiderTypes, resolveRiderTypes, RIDER_TYPE_KEYS, NEUTRAL_BASELINE } from "./riderTypes.js";
import { selectTypesBaseline } from "./riderTypesBaselineSelect.js";
import { predictBaseValue } from "./riderValuation.js";
import { currentProductionValue } from "./riderCareerNpv.js";
import { ageForSeason } from "./riderProgressionEngine.js";
import { calculateRiderMarketValue } from "./marketUtils.js";
import { computeFrozenSalary } from "./contractSeed.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPSERT_BATCH = 500;
const WRITE_CONCURRENCY = 25;

const TYPES_BASELINE_PATH = join(__dirname, "./riderTypesBaseline.json");
// #3570: unge (< 22 år, se riderTypesBaselineSelect.js) klassificeres mod DENNE
// baseline i den ENDELIGE type-tildeling i stedet for voksen-baselinen ovenfor.
const TYPES_BASELINE_YOUTH_PATH = join(__dirname, "./riderTypesBaselineYouth.json");
// #2594 cutover: v4 (karriere-NPV) er den live værdi-model.
const VALUATION_MODEL_PATH = join(__dirname, "./riderValuationModelV4.json");

// v4 forankrer alder i den aktive sæson (ageForSeason). Fallback: sæson 1.
async function activeSeasonNumber(supabase) {
  const { data, error } = await supabase
    .from("seasons").select("number").eq("status", "active").maybeSingle();
  if (error) throw new Error(`active season lookup: ${error.message}`);
  return data?.number ?? 1;
}

const noop = () => {};

// ── Logging-hjælpere (flyttet fra CLI-scripterne så diagnostik bevares via `log`) ──
const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));
const pct = (sortedAsc, p) =>
  sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length))];
function spread(values) {
  const s = [...values].sort((a, b) => a - b);
  const avg = (s.reduce((a, b) => a + b, 0) / (s.length || 1)).toFixed(1);
  return `min ${s[0]} · median ${s[Math.floor(s.length / 2)]} · max ${s[s.length - 1]} · avg ${avg}`;
}

async function upsertBatched(supabase, table, rows, onConflict) {
  let n = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH);
    const { error } = await supabase.from(table).upsert(batch, { onConflict });
    if (error) throw new Error(`${table} upsert fejlede ved ${i}: ${error.message}`);
    n += batch.length;
  }
  return n;
}

async function updateRidersConcurrent(supabase, updates) {
  let written = 0;
  for (let i = 0; i < updates.length; i += WRITE_CONCURRENCY) {
    const batch = updates.slice(i, i + WRITE_CONCURRENCY);
    await Promise.all(
      batch.map(({ id, ...patch }) =>
        supabase.from("riders").update(patch).eq("id", id).then(({ error }) => {
          if (error) throw new Error(`update ${id}: ${error.message}`);
        })
      )
    );
    written += batch.length;
  }
  return written;
}

// ── Physiology + udledte abilities (fra backfillRacePhysiology.js) ────────────
export async function runPhysiologyBackfill(supabase, { dryRun = true, physiologyOnly = false, now, log = noop } = {}) {
  const stamp = now || new Date().toISOString();
  const select = ["id", "height", "weight", "birthdate", "potentiale", ...STAT_KEYS].join(", ");
  const riders = await fetchAllRows(() =>
    supabase.from("riders").select(select).order("id", { ascending: true }));
  log(`physiology: ${riders.length} ryttere`);

  const profiles = riders.map((r) => ({ ...seedPhysiologyFromLegacy(r), updated_at: stamp }));
  log(`  ftp_wkg: ${spread(profiles.map((p) => p.ftp_wkg))}`);
  let abilities = [];
  if (!physiologyOnly) {
    abilities = profiles.map((p, i) => ({ ...deriveAbilities(p, riders[i]), generated_at: stamp }));
    log(`  climbing: ${spread(abilities.map((a) => a.climbing))}`);
    log(`  sprint:   ${spread(abilities.map((a) => a.sprint))}`);
  }

  if (dryRun) {
    return { riders: riders.length, profiles: profiles.length, abilities: abilities.length, written: 0 };
  }
  const written = await upsertBatched(supabase, "rider_physiology_profiles", profiles, "rider_id");
  if (!physiologyOnly) await upsertBatched(supabase, "rider_derived_abilities", abilities, "rider_id");
  return { riders: riders.length, profiles: profiles.length, abilities: abilities.length, written };
}

// ── Ryttertyper (fra backfillRiderTypes.js) ───────────────────────────────────
// #3325: type = POTENTIALE, ikke dagens form. Klassificerer mod ability_caps
// (evne-LOFTET) i stedet for de nuværende evner, så typen er stabil hele karrieren
// (se riderTypes.js's topkommentar for hvorfor + kollaps-historikken).
export async function runRiderTypesBackfill(supabase, { dryRun = true, baseline, youthBaseline, log = noop } = {}) {
  const model = baseline || JSON.parse(readFileSync(TYPES_BASELINE_PATH, "utf8"));
  // #3570: youthModel er OPT-IN via param (test/diagnostik-callere der ikke sender
  // den er uændrede — selectTypesBaseline falder tilbage til `model` for ALLE
  // aldre når youthModel er null/undefined). Produktionens CLI-wrapper
  // (scripts/backfillRiderTypes.js) sender ingen af de to — begge loades derfor
  // her fra de committede JSON-filer, så produktionsstien ER alders-gated by default.
  const youthModel = youthBaseline !== undefined
    ? youthBaseline
    : JSON.parse(readFileSync(TYPES_BASELINE_YOUTH_PATH, "utf8"));
  const seasonNumber = await activeSeasonNumber(supabase);
  // Alle ryttere med abilities — også retired. Retired ryttere vises stadig på
  // profiler + Hall of Fame, så de skal have en gyldig type; ellers efterlader en
  // type-fjernelse (fx leadout) dem med et tomt badge. Matcher base_value-backfill,
  // der også dækker alle riders. Inner-join holder orphan-abilities ude.
  // birthdate med i selectet (#3570) — kun til alders-gaten, skrives ingen steder.
  const rows = await fetchAllRows(() =>
    supabase
      .from("rider_derived_abilities")
      .select("rider_id, ability_caps, riders!inner(id, birthdate)")
      .order("rider_id"));
  log(`types: ${rows.length} ryttere (med abilities, inkl. retired) — klassificeret mod ability_caps`);

  const dist = Object.fromEntries(RIDER_TYPE_KEYS.map((k) => [k, 0]));
  const updates = rows.map((r) => {
    const age = ageForSeason(r.riders?.birthdate, seasonNumber);
    const rowModel = selectTypesBaseline(age, model, youthModel);
    const { primary, secondary } = computeRiderTypes(r.ability_caps || {}, rowModel);
    dist[primary.key] = (dist[primary.key] || 0) + 1;
    return { id: r.rider_id, primary_type: primary.key, secondary_type: secondary.key };
  });
  for (const k of RIDER_TYPE_KEYS) {
    const n = dist[k];
    log(`  ${k.padEnd(15)} ${String(n).padStart(5)} (${((n / (rows.length || 1)) * 100).toFixed(1).padStart(5)}%)`);
  }

  if (dryRun) return { riders: rows.length, written: 0 };
  const written = await updateRidersConcurrent(supabase, updates);
  return { riders: rows.length, written };
}

// ── Scoped derive-pipeline for NYE ryttere (#1478) ────────────────────────────
// Kører hele afled-kæden (physiology → abilities → primary/secondary_type →
// base_value) for et eksplicit sæt rider-id'er. Bruges ved runtime-intake
// (akademi-kuld) hvor ryttere oprettes EFTER den globale backfill-kæde og derfor
// ellers aldrig får physiology/abilities/type/base_value. Uden dette springes de
// over i træning-engine (mangler rider_derived_abilities) og viser rå PCM-stats.
//
// Genbruger de samme rene kerner (seedPhysiologyFromLegacy + deriveAbilities +
// computeRiderTypes + predictBaseValue) som den globale backfill — ÉN sandhed.
export async function deriveForRiderIds(supabase, riderIds, {
  dryRun = false,
  typesBaseline,
  youthTypesBaseline,
  valuationModel,
  now,
  log = noop,
} = {}) {
  const ids = Array.from(new Set((riderIds || []).filter((id) => id != null)));
  if (ids.length === 0) {
    return { riders: 0, profiles: 0, abilities: 0, typed: 0, valued: 0, dryRun };
  }
  const stamp = now || new Date().toISOString();
  const typesModel = typesBaseline || JSON.parse(readFileSync(TYPES_BASELINE_PATH, "utf8"));
  // #3570: OPT-IN via param (samme fallback-mønster som backfillRiderTypes-stien) —
  // callere der ikke sender youthTypesBaseline eksplicit får den committede JSON
  // (produktionsstien ER dermed alders-gated by default); undefined ⇒ ikke "slået fra".
  const youthTypesModel = youthTypesBaseline !== undefined
    ? youthTypesBaseline
    : JSON.parse(readFileSync(TYPES_BASELINE_YOUTH_PATH, "utf8"));
  const valModel = valuationModel || JSON.parse(readFileSync(VALUATION_MODEL_PATH, "utf8"));
  // #3570: seasonNumber flyttet HERTIL (var tidligere kun hentet ved trin 5) — trin 4
  // (ENDELIG type) skal nu også kende alderen for at vælge baseline.
  const seasonNumber = await activeSeasonNumber(supabase);

  // Hent de berørte ryttere (legacy stat-felter + krop til physiology-seed).
  // #3345: valuation_type med i selectet — se trin 5's kommentar for hvorfor
  // (denne sti dækker BÅDE helt nye ryttere OG re-derive af eksisterende/strandede
  // ryttere, og de to skal behandles forskelligt).
  // #3570 fase 2: archetype_draw med i selectet — det TRUKNE ungdoms-anlæg (skrevet
  // af academyIntake.js ved rytter-insert). Ryttere UDEN et draw (alle voksne, PCM-
  // import, alt eksisterende) har NULL her → uændret bootstrap-adfærd (trin 2/3).
  const select = ["id", "height", "weight", "birthdate", "potentiale", "valuation_type", "archetype_draw", ...STAT_KEYS].join(", ");
  const riders = await fetchAllRows(() =>
    supabase.from("riders").select(select).in("id", ids).order("id", { ascending: true }));
  log(`deriveForRiderIds: ${riders.length}/${ids.length} ryttere fundet`);

  // 1) Physiology + abilities (rene transformationer).
  const profiles = riders.map((r) => ({ ...seedPhysiologyFromLegacy(r), updated_at: stamp }));
  const abilities = profiles.map((p, i) => ({ ...deriveAbilities(p, riders[i]), generated_at: stamp }));

  // 2) BOOTSTRAP-type (#3325): en helt ny rytter har intet forudgående primary_type
  // at seede ability_caps' rolle-faktor med (buildYouthCaps/buildCapsForRider læser
  // primaryType/secondaryType — se riderProgression.js). Vi klassificerer derfor
  // FØRST mod de LIVE abilities (NEUTRAL_BASELINE — typesModel er caps-fittet og
  // ville give forkerte z-scores mod live-værdier) udelukkende for at give caps'
  // rolle-faktor en retning. Denne type skrives ALDRIG til riders — kun den ENDELIGE
  // caps-baserede type i trin 4 gør.
  const bootstrapTypeByRider = new Map();
  for (const a of abilities) {
    const { primary, secondary } = computeRiderTypes(a, NEUTRAL_BASELINE);
    bootstrapTypeByRider.set(a.rider_id, { primary_type: primary.key, secondary_type: secondary.key });
  }

  // 3) ability_caps + ability_progress (#2001): wire ALLE ryttere ved derive, ikke
  // kun akademi-alder. Tidligere satte denne sti KUN ungdoms-caps (#1791); voksne
  // fik NULL og ventede på et sæson-progression- eller daglig-trænings-tick — frie
  // agenter / aldrig-tickede hold endte derfor permanent NULL og kunne ikke vise
  // progress-bar/caps på den nye rytter-side. buildCapsForRider er nu ÉN semantik
  // for alle aldre (absolut loft + gulv, ejer 15/7).
  //
  // caps GENBEREGNES altid: loftet er en ren funktion af potentiale + anlæg + nuværende
  // evne, ikke akkumuleret state — så en stale eller forkert-semantik-værdi må ikke
  // overleve en re-derive. Det var netop "bevar hvis den findes"-mønstret der lod to
  // uforenelige loft-semantikker fryse ned i data. Bruger BOOTSTRAP-typen (trin 2) —
  // uændret formel/semantik ift. før #3325.
  //
  // progress BEVARES derimod: det ER akkumuleret træning (heal-sweep #1673 må ikke
  // nulstille en rytters optjente fremgang). Vi læser eksisterende og fylder kun NULL.
  const existingById = new Map();
  {
    const existing = await fetchAllRows(() =>
      supabase.from("rider_derived_abilities")
        .select("rider_id, ability_caps, ability_progress")
        .in("rider_id", ids)
        .order("rider_id", { ascending: true }));
    for (const e of existing) existingById.set(e.rider_id, e);
  }
  const riderById = new Map(riders.map((r) => [r.id, r]));
  const progressInit = buildProgressInit();
  const capsByRider = new Map();
  const abilitiesWithCaps = abilities.map((a) => {
    const rider = riderById.get(a.rider_id) || {};
    // #3570 fase 2: en rytter med et PERSISTERET archetype_draw (akademi-intake,
    // academyIntake.js) får sine caps formet af DET TRUKNE anlæg — den faktiske
    // stat-formning candidaten blev genereret efter — i stedet for bootstrap-
    // gættet (trin 2 ovenfor, klassificeret mod flade 1-12-profiler, målt 9/8:
    // 0/303 gc-trukne genkendes som gc). Uden et draw (alle eksisterende ryttere,
    // enhver ikke-akademi-sti) er dette bit-identisk med FØR #3570 fase 2 — samme
    // bootstrap-fallback, samme kodesti.
    const draw = rider.archetype_draw;
    const t = (draw && draw.primary)
      ? { primary_type: draw.primary, secondary_type: draw.secondary || null }
      : (bootstrapTypeByRider.get(a.rider_id) || {});
    const prev = existingById.get(a.rider_id) || {};
    const baseline = {};
    for (const k of VISIBLE_ABILITIES) if (a[k] != null) baseline[k] = Number(a[k]);
    const caps = buildCapsForRider(baseline, { potentiale: rider.potentiale }, t.primary_type, t.secondary_type);
    capsByRider.set(a.rider_id, caps);
    const progress = (prev.ability_progress && typeof prev.ability_progress === "object")
      ? prev.ability_progress
      : progressInit;
    return { ...a, ability_caps: caps, ability_progress: progress };
  });

  // 4) ENDELIG type (#3325): klassificeret mod ability_caps (trin 3) + den caps-
  // fittede baseline (typesModel) — DETTE er det der persisteres på riders og
  // vises til spilleren. Stabil resten af karrieren (afhænger ikke af dagens form).
  //
  // #3570: unge (< 22 år, samme sæson-alder som base_value-leddet i trin 5) bruger
  // i stedet youthTypesModel — se riderTypesBaselineSelect.js's topkommentar for
  // rod-årsagen. Voksne (>= 22) rammer PRÆCIS samme kodesti som før (selectTypesBaseline
  // returnerer typesModel uændret) — bit-identisk klassifikation, se
  // archetypeGenerationGates.test.js's "voksne uændret"-regressionstest.
  //
  // #3570 (ejer-beslutning 10/8, "fast identitet fra fødslen"): har rytteren et
  // PERSISTERET anlæg, er DET identiteten — vi klassificerer ikke oven i de caps
  // som anlægget selv lige har formet i trin 3. Uden dette blev anlægget brugt til
  // at forme lofterne og derefter kastet væk, hvorefter typen blev gættet forfra ud
  // fra de samme lofter. Se resolveRiderTypes i riderTypes.js for løkke-målingen.
  // Ryttere uden draw (alle eksisterende) rammer PRÆCIS samme kodesti som før.
  const typeByRider = new Map();
  for (const [riderId, caps] of capsByRider) {
    const rider = riderById.get(riderId) || {};
    const age = ageForSeason(rider.birthdate, seasonNumber);
    const rowModel = selectTypesBaseline(age, typesModel, youthTypesModel);
    const { primary, secondary } = resolveRiderTypes(rider.archetype_draw, caps, rowModel);
    typeByRider.set(riderId, { primary_type: primary.key, secondary_type: secondary.key });
  }

  // 5) base_value + current_production_value (kræver primary_type + abilities;
  //    v4 kræver desuden age + potentiale — birthdate/potentiale er i selected).
  //    seasonNumber er allerede hentet ovenfor (#3570, trin 4 har brug for den nu).
  const abilityByRider = new Map(abilities.map((a) => [a.rider_id, a]));
  const riderUpdates = riders.map((r) => {
    const t = typeByRider.get(r.id) || { primary_type: null, secondary_type: null };
    const valueRider = { ...r, primary_type: t.primary_type, age: ageForSeason(r.birthdate, seasonNumber) };
    const ab = abilityByRider.get(r.id);
    const bv = predictBaseValue(valueRider, ab, valModel);
    const cpv = currentProductionValue(valueRider, ab, valModel);
    return {
      id: r.id,
      ...t,
      // #3345: BEVAR et allerede-sat valuation_type (r.valuation_type, med i
      // selectet ovenfor). Denne sti dækker BÅDE helt nye ryttere OG re-derive af
      // EKSISTERENDE/strandede ryttere (riderDeriveHealSweep, migreringsscripts) —
      // en healed rytter der allerede har en frosset værdi må ikke få den
      // overskrevet med den friske (potentielt reklassificerede) type. Kun når
      // r.valuation_type mangler helt (en HELT NY rytter, netop insertet — ingen
      // gammel prod-værdi at bevare) sætter vi den ÉN GANG til den friske type, så
      // FREMTIDIGE reklassificeringer af denne rytter heller ikke rører værdien.
      // (bv/cpv ovenfor er allerede beregnet mod r.valuation_type via valueRiders
      // spread af r — kun selve OUTPUT-feltet her skal have samme fallback-logik.)
      valuation_type: r.valuation_type ?? t.primary_type,
      ...(bv != null ? { base_value: bv } : {}),
      ...(cpv != null ? { current_production_value: cpv } : {}),
    };
  });

  if (dryRun) {
    return {
      riders: riders.length,
      profiles: profiles.length,
      abilities: abilities.length,
      typed: typeByRider.size,
      valued: riderUpdates.filter((u) => u.base_value != null).length,
      dryRun: true,
    };
  }

  await upsertBatched(supabase, "rider_physiology_profiles", profiles, "rider_id");
  await upsertBatched(supabase, "rider_derived_abilities", abilitiesWithCaps, "rider_id");
  const typedWritten = await updateRidersConcurrent(supabase, riderUpdates);

  // ── Kilde-guard (#1673): verificér at ALLE input-id'er faktisk blev derived ──
  // Rod-årsagen til #1673 var at denne sti kunne efterlade en delmængde af de
  // inserterede ryttere "strandet" (ingen rider_derived_abilities-række + base_value
  // NULL) UDEN at fejle — et partielt batch fuldførte tavst. Samme sti bruges af
  // start-trup-allokeringen (insertDeriveAndReadPool → deriveForRiderIds) og akademi-
  // intake, så en frisk relaunch kunne genskabe bugen. Vi kaster nu, hvis et input-id
  // ikke fik en ability-række ELLER en base_value, så fejlen bliver synlig ved kilden
  // (call-sites er ikke-fatale/idempotente nok til at retry/heal-sweep tager over).
  //
  // Bemærk: et input-id der IKKE findes i `riders` (slettet/ugyldigt) er IKKE en fejl
  // her — vi verificerer kun de ryttere vi faktisk hentede. base_value må desuden
  // legitimt være NULL hvis predictBaseValue ikke kunne værdisætte (model-fejl /
  // ingen abilities); de fanges af "manglende ability-række"-tjekket alligevel, da
  // ingen abilities → ingen base_value.
  const derivedIds = new Set(abilities.map((a) => a.rider_id));
  const missingAbilities = riders.filter((r) => !derivedIds.has(r.id)).map((r) => r.id);
  const missingValue = riderUpdates.filter((u) => u.base_value == null).map((u) => u.id);
  if (missingAbilities.length > 0 || missingValue.length > 0) {
    const parts = [];
    if (missingAbilities.length) parts.push(`${missingAbilities.length} uden ability-række (${missingAbilities.slice(0, 5).join(", ")}${missingAbilities.length > 5 ? ", …" : ""})`);
    if (missingValue.length) parts.push(`${missingValue.length} uden base_value (${missingValue.slice(0, 5).join(", ")}${missingValue.length > 5 ? ", …" : ""})`);
    throw new Error(`deriveForRiderIds: partielt derive — ${parts.join("; ")}. ${riders.length}/${ids.length} ryttere hentet.`);
  }

  return {
    riders: riders.length,
    profiles: profiles.length,
    abilities: abilities.length,
    typed: typeByRider.size,
    valued: riderUpdates.filter((u) => u.base_value != null).length,
    written: typedWritten,
  };
}

// ── base_value SHADOW (fra backfillRiderBaseValue.js) ─────────────────────────
export async function runBaseValueBackfill(supabase, { dryRun = true, model, log = noop } = {}) {
  const m = model || JSON.parse(readFileSync(VALUATION_MODEL_PATH, "utf8"));
  // #3345: valuation_type (den FROSNE type) skal med i selectet — predictBaseValue/
  // currentProductionValue læser den FØR primary_type (se riderValuation.js). Uden
  // den ville denne sweep stille revaluere hele populationen efter enhver
  // primary_type-reklassificering (#3325/#3343), præcis det #3345 fryser mod.
  const [riders, abilities, teams, seasonNumber] = await Promise.all([
    fetchAllRows(() => supabase.from("riders").select("id, primary_type, valuation_type, base_value, market_value, prize_earnings_bonus, is_academy, salary, birthdate, potentiale, team_id").order("id")),
    fetchAllRows(() => supabase.from("rider_derived_abilities").select("*").order("rider_id")),
    fetchAllRows(() => supabase.from("teams").select("id, division").order("id")),
    activeSeasonNumber(supabase),
  ]);
  const abilityByRider = new Map(abilities.map((a) => [a.rider_id, a]));
  const divisionByTeam = new Map(teams.map((t) => [t.id, t.division]));

  const updates = [];
  let noAbilities = 0;
  let salariesRecomputed = 0;
  const oldVals = [];
  const newVals = [];
  for (const r of riders) {
    const valueRider = { ...r, age: ageForSeason(r.birthdate, seasonNumber) };
    const ab = abilityByRider.get(r.id);
    const bv = predictBaseValue(valueRider, ab, m);
    if (bv == null) { noAbilities++; continue; }
    const cpv = currentProductionValue(valueRider, ab, m);
    const update = { id: r.id, base_value: bv, ...(cpv != null ? { current_production_value: cpv } : {}) };
    // #2083 forward-guard: hold in-academy-rytteres frosne løn i sync med den
    // genberegnede værdi. #2594: løn-basen er nu current_production_value ×
    // per-division-sats. Seniorer (is_academy=false) røres ALDRIG — deres
    // kontrakt-løn er bevidst frossen ved signering. Kun akademiryttere med en
    // eksisterende løn re-synkes.
    if (r.is_academy && r.salary != null && cpv != null) {
      update.salary = computeFrozenSalary({ current_production_value: cpv, division: divisionByTeam.get(r.team_id) });
      salariesRecomputed++;
    }
    updates.push(update);
    oldVals.push(calculateRiderMarketValue(r));
    newVals.push(bv);
  }
  oldVals.sort((a, b) => a - b);
  newVals.sort((a, b) => a - b);
  log(`base_value: ${riders.length} ryttere · værdisat ${updates.length} · uden abilities ${noAbilities} · akademi-løn re-synket ${salariesRecomputed}`);
  if (updates.length > 0) {
    log("Fordeling (CZ$):           p10        median        p90          max");
    log(`  GAMMEL (uci): ${fmt(pct(oldVals, 0.1)).padStart(12)} ${fmt(pct(oldVals, 0.5)).padStart(12)} ${fmt(pct(oldVals, 0.9)).padStart(12)} ${fmt(oldVals[oldVals.length - 1]).padStart(12)}`);
    log(`  NY  (base):   ${fmt(pct(newVals, 0.1)).padStart(12)} ${fmt(pct(newVals, 0.5)).padStart(12)} ${fmt(pct(newVals, 0.9)).padStart(12)} ${fmt(newVals[newVals.length - 1]).padStart(12)}`);
  }

  if (dryRun) return { riders: riders.length, valued: updates.length, noAbilities, salariesRecomputed, written: 0 };
  const written = await updateRidersConcurrent(supabase, updates);
  return { riders: riders.length, valued: updates.length, noAbilities, salariesRecomputed, written };
}
