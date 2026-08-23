// #1364 — base_value følger udviklede evner (Model 1, objektiv rating).
// recomputeRiderValue: ren kæde (typer → base_value), samme som relaunch-backfill
// + fictionalPopulationPreview. refreshChangedRiderValues: genberegn alle, skriv
// kun de ændrede (ingen daglig churn). base_value afrundes (INTEGER-kolonne).
//
// #2594 CUTOVER: modellen er nu v4 (karriere-NPV, riderValuationModelV4.json).
// v4 kræver alder + potentiale (fremskriver karrieren), så sweepen henter
// birthdate/potentiale og en aktiv sæson. Sweepen skriver desuden
// current_production_value (sæson-0-leddet) — løn-basen (#2428 løn-decoupling).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "./supabasePagination.js";
import { resolveRiderTypes, ABILITY_KEYS } from "./riderTypes.js";
import { selectTypesBaseline } from "./riderTypesBaselineSelect.js";
import { predictBaseValue } from "./riderValuation.js";
import { currentProductionValue } from "./riderCareerNpv.js";
import { ageForSeason } from "./riderProgressionEngine.js";
import { applyTypeDampening } from "./riderValuationTypeDampening.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TYPES_BASELINE_PATH = join(__dirname, "./riderTypesBaseline.json");
// #3570: unge (< 22 år) klassificeres mod DENNE baseline — se riderTypesBaselineSelect.js.
const TYPES_BASELINE_YOUTH_PATH = join(__dirname, "./riderTypesBaselineYouth.json");
const VALUATION_MODEL_PATH = join(__dirname, "./riderValuationModelV4.json");
const noop = () => {};
const WRITE_CONCURRENCY = 25;

// riderRow skal bære age + potentiale (v4-krav); mangler age → begge værdier null
// (rytteren springes over i sweepen — samme kontrakt som manglende abilities).
//
// #3325: typen klassificeres mod ability_caps (POTENTIALE — stabil hele karrieren),
// IKKE mod de live `abilities` der bruges til selve værdisætningen. `typeAbilities`
// er derfor et separat, eksplicit argument — falder tilbage til `abilities` KUN hvis
// caps ikke er givet (fx en rytter der endnu ikke har fået caps deriveret; degraderer
// til den gamle live-baserede klassifikation for den ene rytter frem for at kaste).
// #3570: youthBaseline (opts) er OPT-IN og BAGUDKOMPATIBEL — udeladt/null ⇒
// funktionen bruger `baseline` for ALLE aldre, PRÆCIS som før #3570 (ingen
// eksisterende caller/test ændrer adfærd uden eksplicit at sende den med).
// Når den sendes med, vælges den for ryttere med riderRow.age < 22 (se
// riderTypesBaselineSelect.js). age skal være sæson-alder (ageForSeason) —
// samme konvention som resten af værdi-kæden.
export function recomputeRiderValue(riderRow, abilities, baseline, model, { typeAbilities, youthBaseline } = {}) {
  const typeSource = (typeAbilities && Object.keys(typeAbilities).length > 0) ? typeAbilities : abilities;
  const typeModel = selectTypesBaseline(riderRow?.age, baseline, youthBaseline);
  // #3570 (ejer-beslutning 10/8): bærer rytteren et PERSISTERET anlæg
  // (riders.archetype_draw), er DET identiteten — nattens sweep omdøber ham ikke.
  // Det var her løkken lukkede sig: caps blev formet af typen (dailyTrainingEngine)
  // og typen udledt af de samme caps her, hver nat. Se resolveRiderTypes.
  // Ryttere uden draw klassificeres præcis som før — bit-identisk.
  const { primary, secondary } = resolveRiderTypes(riderRow?.archetype_draw, typeSource, typeModel);
  // #3345: primary_type/secondary_type overskrives ALTID med den friske
  // klassifikation ovenfor (de må frit reklassificeres — #3325/#3343). Bemærk at
  // valuation_type IKKE overskrives her — den flyder ureguleret igennem fra
  // riderRow via spreadet, så predictBaseValue/currentProductionValue (som læser
  // valuation_type FØR primary_type, se riderValuation.js) fortsætter med at bruge
  // den FROSNE type. Mangler riderRow.valuation_type helt (fixtures/tests/en
  // rytter uden det felt), falder value-funktionerne selv tilbage til
  // withType.primary_type (den friske type ovenfor) — uændret adfærd.
  const withType = { ...riderRow, primary_type: primary.key, secondary_type: secondary.key };
  const raw = predictBaseValue(withType, abilities, model);
  const cpv = currentProductionValue(withType, abilities, model);
  return {
    primary_type: primary.key,
    secondary_type: secondary.key,
    base_value: raw == null ? null : Math.round(raw),
    current_production_value: cpv == null ? null : Math.round(cpv),
  };
}

// Ren diff: returnér KUN ryttere hvor base_value, current_production_value eller
// type ændrede sig. capsByRider er valgfri (bagudkompatibel) — udeladt/tom Map ⇒
// recomputeRiderValue falder tilbage til abilities for typen (se ovenfor).
export function selectChangedValueUpdates(riders, abilityByRider, baseline, model, capsByRider = new Map(), youthBaseline) {
  const updates = [];
  for (const r of riders) {
    const ab = abilityByRider.get(r.id);
    if (!ab) continue; // ingen abilities → spring over (kan ikke værdisættes)
    const next = recomputeRiderValue(r, ab, baseline, model, { typeAbilities: capsByRider.get(r.id), youthBaseline });
    if (next.base_value == null) continue;
    const changed =
      next.base_value !== r.base_value ||
      next.current_production_value !== (r.current_production_value ?? null) ||
      next.primary_type !== r.primary_type ||
      next.secondary_type !== r.secondary_type;
    if (changed) {
      updates.push({
        id: r.id,
        primary_type: next.primary_type,
        secondary_type: next.secondary_type,
        base_value: next.base_value,
        current_production_value: next.current_production_value,
      });
    }
  }
  return updates;
}

async function writeUpdates(supabase, updates) {
  let written = 0;
  for (let i = 0; i < updates.length; i += WRITE_CONCURRENCY) {
    const batch = updates.slice(i, i + WRITE_CONCURRENCY);
    await Promise.all(
      batch.map(({ id, ...patch }) =>
        supabase.from("riders").update(patch).eq("id", id).then(({ error }) => {
          if (error) throw new Error(`riders update ${id}: ${error.message}`);
        })
      )
    );
    written += batch.length;
  }
  return written;
}

// Genberegn type+base_value+current_production_value for (evt. ét holds) ryttere;
// skriv kun de ændrede. baseline/model defaulter fra de committede JSON-filer
// (som runBaseValueBackfill).
export async function refreshChangedRiderValues(supabase, { baseline, youthBaseline, model, log = noop, teamId, seasonNumber: seasonNumberOverride } = {}) {
  const bl = baseline || JSON.parse(readFileSync(TYPES_BASELINE_PATH, "utf8"));
  // #3570: OPT-IN via param, samme mønster som backfillCores.js — produktionens
  // CLI/sweep-callere sender ikke youthBaseline eksplicit og får derfor den
  // committede ungdoms-JSON (alders-gated by default); test-callere der IKKE
  // ønsker gating kan sende `youthBaseline: null` eksplicit for at slå den fra.
  const youthBl = youthBaseline !== undefined
    ? youthBaseline
    : JSON.parse(readFileSync(TYPES_BASELINE_YOUTH_PATH, "utf8"));
  // #4000: applyTypeDampening() er en no-op indtil TYPE_DAMPENING_ENABLED
  // flippes ved cutover (se riderValuationTypeDampening.js) — ingen
  // adfærdsændring her i dag.
  const m = model || applyTypeDampening(JSON.parse(readFileSync(VALUATION_MODEL_PATH, "utf8")));

  // v4-alder forankres i den aktive sæson (samme ageForSeason som progression).
  // Cutover-fix 23/8: mellem "Afslut sæson" og transitionen er der INGEN aktiv
  // sæson, og '?? 1' ankrede hele populationen ét år for ungt (Riva 4,17M i
  // stedet for de ejer-godkendte 3,74M). seasonNumberOverride lader cutover-
  // værktøjet ankre eksplicit; fallback uden aktiv sæson er nu seneste
  // completed sæson (aldrig 1).
  let seasonNumber = Number(seasonNumberOverride) || null;
  if (!seasonNumber) {
    const { data: season, error: seasonErr } = await supabase
      .from("seasons").select("number").eq("status", "active").maybeSingle();
    if (seasonErr) throw new Error(`value-refresh season lookup: ${seasonErr.message}`);
    seasonNumber = season?.number ?? null;
  }
  if (!seasonNumber) {
    const { data: lastDone, error: doneErr } = await supabase
      .from("seasons").select("number").eq("status", "completed")
      .order("number", { ascending: false }).limit(1).maybeSingle();
    if (doneErr) throw new Error(`value-refresh season lookup (completed): ${doneErr.message}`);
    seasonNumber = lastDone?.number ?? 1;
  }

  const riderQuery = () => {
    // #3345: valuation_type (den FROSNE type) skal med i selectet — recomputeRiderValue
    // videresender den uændret til predictBaseValue/currentProductionValue via spread.
    // #3570: archetype_draw med i selectet — rytterens persisterede anlæg er hans
    // identitet, og uden den i rækken ville sweepen gætte typen forfra hver nat.
    let q = supabase.from("riders")
      .select("id, primary_type, secondary_type, valuation_type, base_value, current_production_value, birthdate, potentiale, archetype_draw")
      .order("id");
    if (teamId) q = q.eq("team_id", teamId);
    return q;
  };
  const riders = await fetchAllRows(riderQuery);
  for (const r of riders) r.age = ageForSeason(r.birthdate, seasonNumber);
  const riderIds = new Set(riders.map((r) => r.id));
  // #3325: ability_caps hentes med — typen klassificeres mod POTENTIALET, ikke
  // dagens form, så træning/progression ikke længere flytter type-labelen.
  const abilities = await fetchAllRows(() =>
    supabase.from("rider_derived_abilities").select(`rider_id, ability_caps, ${ABILITY_KEYS.join(", ")}`).order("rider_id"));
  const abilityByRider = new Map(abilities.filter((a) => riderIds.has(a.rider_id)).map((a) => [a.rider_id, a]));
  const capsByRider = new Map(abilities.filter((a) => riderIds.has(a.rider_id)).map((a) => [a.rider_id, a.ability_caps]));

  const updates = selectChangedValueUpdates(riders, abilityByRider, bl, m, capsByRider, youthBl);
  log(`value-refresh${teamId ? ` (team ${teamId})` : ""}: ${riders.length} scannet · ${updates.length} ændret`);
  const written = await writeUpdates(supabase, updates);
  return { scanned: riders.length, changed: updates.length, written };
}
