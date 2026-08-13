#!/usr/bin/env node
// backend/scripts/dev/lofterDryRun3591.mjs
// ============================================================================
// #3593 + #3591 pkt. 2 — READ-ONLY dry-run for IDENTITETEN OG LOFTERNE.
// Læser et DATERET snapshot fra disk. Rører aldrig databasen.
//
// SPØRGSMÅLENE DEN SVARER PÅ
//
//   1. #3593: `archetype_draw.secondary` er tom for en delmængde af bestanden.
//      De to skrivestier er derfor UENIGE om hvilken sekundær der former loftet:
//        derive-stien (backfillCores.js trin 3) bruger `draw.secondary || null`
//        motor-stien  (dailyTrainingEngine.js:314) bruger `riders.secondary_type`
//      Hvor mange ryttere rammes, og hvor meget flytter loftet sig?
//
//   2. #3591 pkt. 2: hvad sker der med de GEMTE lofter når
//      `race_day_engine_enabled` tændes 23/8 og AI-holdene tickes første gang?
//      Delta = gemt `ability_caps` mod det motoren ville genopbygge.
//
// FIRE LOFT-SÆT PR. RYTTER (samme evner, samme potentiale, samme sæson-alder)
//
//   gemt      : `rider_derived_abilities.ability_caps` som den står i DB
//   derive    : buildCapsForRider(evner, {potentiale, age}, draw.primary, draw.secondary ?? null)
//   motor     : buildCapsForRider(evner, {potentiale, age}, primary_type, secondary_type)
//   forankret : buildCapsForRider(evner, {potentiale, age}, draw.primary, draw.secondary ?? secondary_type)
//
//   «forankret» er hvad BEGGE stier producerer efter #3593. Er `forankret`
//   identisk med `motor` for alle ryttere, skifter #3593 intet synligt — det er
//   den påstand spec §12 gør, og den skal bevises, ikke antages.
//
// ALDERS-KONVENTIONEN: `age` i snapshottet ER sæson-alder (ageForSeason(birthdate,
// activeSeasonNumber)) — samme konvention som hele produktionskæden. Wall-clock må
// ALDRIG bruges til klassifikation (kostede blok 1 i #3570-natbølgen).
//
// KØRSEL
//   node scripts/dev/lofterDryRun3591.mjs
//   node scripts/dev/lofterDryRun3591.mjs --snapshot-dir ../docs/snapshots/3591 --out-dir <dir>
//   node scripts/dev/lofterDryRun3591.mjs --json          # kun maskinlæsbart resumé
//   node scripts/dev/lofterDryRun3591.mjs --detaljer      # + fuld pr-rytter-fil (~18 MB)
//
// Refs #3593 #3591 #3564 #3570.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { buildCapsForRider } from "../../lib/riderProgression.js";
import { resolveRiderTypes, RIDER_TYPE_KEYS } from "../../lib/riderTypes.js";
import { selectTypesBaseline } from "../../lib/riderTypesBaselineSelect.js";
import { ratingFromAbilities } from "../../lib/scoutingReport.js";
import { predictBaseValue } from "../../lib/riderValuation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(__dirname, "../..");
const REPO_ROOT = resolve(BACKEND_ROOT, "..");

const ADULT_BASELINE = JSON.parse(readFileSync(join(BACKEND_ROOT, "lib/riderTypesBaseline.json"), "utf8"));
const YOUTH_BASELINE = JSON.parse(readFileSync(join(BACKEND_ROOT, "lib/riderTypesBaselineYouth.json"), "utf8"));
const V4_MODEL = JSON.parse(readFileSync(join(BACKEND_ROOT, "lib/riderValuationModelV4.json"), "utf8"));

// ── CLI ─────────────────────────────────────────────────────────────────────
function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const JSON_ONLY = process.argv.includes("--json");
const SNAPSHOT_DIR = resolve(arg("--snapshot-dir", join(REPO_ROOT, "docs/snapshots/3591")));
const OUT_DIR = resolve(arg("--out-dir", join(REPO_ROOT, "docs/snapshots/3591")));

// ── Snapshot-indlæsning ─────────────────────────────────────────────────────
// Accepterer både `meta.json` (frisk output fra snapshot-3570-full.mjs) og den
// DATEREDE, gzippede form `meta-2026-08-11.json` / `riders_full-2026-08-11.json.gz`
// som ligger i repoet. Nyeste dato vinder, så en frisk snapshot i samme mappe
// automatisk bliver den der måles på.
function readSnapshotFile(base) {
  const kandidater = readdirSync(SNAPSHOT_DIR)
    .filter((f) => f === `${base}.json` || f === `${base}.json.gz` || new RegExp(`^${base}-\\d{4}-\\d{2}-\\d{2}\\.json(\\.gz)?$`).test(f))
    .sort()
    .reverse();
  for (const cand of kandidater) {
    const p = join(SNAPSHOT_DIR, cand);
    if (!existsSync(p)) continue;
    const raw = readFileSync(p);
    return JSON.parse(cand.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8"));
  }
  throw new Error(`Fandt ikke ${base}.json(.gz) eller ${base}-<dato>.json(.gz) i ${SNAPSHOT_DIR}`);
}

const meta = readSnapshotFile("meta");
const riders = readSnapshotFile("riders_full");

// ── Statistik-helpers ───────────────────────────────────────────────────────
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s.length ? s[0] : null,
    p10: quantile(s, 0.1),
    median: quantile(s, 0.5),
    p90: quantile(s, 0.9),
    max: s.length ? s[s.length - 1] : null,
  };
}
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
function fmtStats(st) {
  if (!st.n) return "—";
  return `n=${st.n} min ${r1(st.min)} · p10 ${r1(st.p10)} · median ${r1(st.median)} · p90 ${r1(st.p90)} · max ${r1(st.max)}`;
}

/** Er to loft-sæt ens over alle synlige evner? (samme semantik som sameCaps) */
function capsEqual(a, b) {
  return VISIBLE_ABILITIES.every((k) => num(a?.[k]) === num(b?.[k]));
}
/** Summeret loft-forskel over de 15 evner (b − a). */
function capsSumDelta(a, b) {
  return VISIBLE_ABILITIES.reduce((acc, k) => acc + (num(b?.[k]) - num(a?.[k])), 0);
}
/** Største enkelt-celle-forskel (absolut). */
function capsMaxAbsDelta(a, b) {
  return VISIBLE_ABILITIES.reduce((m, k) => Math.max(m, Math.abs(num(b?.[k]) - num(a?.[k]))), 0);
}
/** Bedste loft-rating over alle 8 typer — samme akse som #3591's "bedste-af-8". */
function bestOf8(caps) {
  return RIDER_TYPE_KEYS.reduce((m, t) => Math.max(m, ratingFromAbilities(caps, t)), 0);
}

// ── Beregn de fire loft-sæt pr. rytter ──────────────────────────────────────
const records = [];
for (const r of riders) {
  const draw = r.archetype_draw || {};
  const drawSecondary = draw.secondary ?? null;
  const secAnchored = drawSecondary ?? r.secondary_type ?? null;
  const age = r.age; // sæson-alder, jf. snapshottets ageConvention
  const ctx = { potentiale: r.potentiale, age };
  const ab = r.abilities || {};

  const gemt = r.ability_caps || {};
  const derive = buildCapsForRider(ab, ctx, draw.primary, drawSecondary);
  const motor = buildCapsForRider(ab, ctx, r.primary_type, r.secondary_type);
  const forankret = buildCapsForRider(ab, ctx, draw.primary, secAnchored);

  const model = selectTypesBaseline(age, ADULT_BASELINE, YOUTH_BASELINE);
  // Typen som den ville falde ud EFTER motorens genopbygning af loftet.
  const tEfter = resolveRiderTypes(r.archetype_draw, motor, model);
  // Typen som den ville falde ud efter #3593-forankringen (draw bærer nu sekundæren).
  const drawAnchored = { ...draw, secondary: secAnchored };
  const tForankret = resolveRiderTypes(drawAnchored, forankret, model);

  // Værdi: predictBaseValue læser abilities + valuation_type, IKKE caps. Den kan
  // derfor kun flytte sig hvis typen flytter sig OG valuation_type ikke er frosset
  // til noget andet. Vi regner den kontrafaktiske værdi hvis valuation_type sattes
  // til den type rytteren ville have EFTER ændringen — det er loftet for effekten.
  const bvNu = predictBaseValue({ ...r, age, valuation_type: r.valuation_type ?? r.primary_type }, ab, V4_MODEL);
  const bvEfter = predictBaseValue({ ...r, age, valuation_type: r.valuation_type ?? tEfter.primary.key }, ab, V4_MODEL);

  records.push({
    rider_id: r.rider_id,
    name: `${r.firstname} ${r.lastname}`,
    owner_kind: r.owner_kind,
    manager: r.manager_display_name,
    age,
    potentiale: r.potentiale,
    drawPrimary: draw.primary ?? null,
    drawSecondary,
    primary_type: r.primary_type,
    secondary_type: r.secondary_type,
    valuation_type: r.valuation_type,
    manglerSekundaertAnlaeg: drawSecondary == null,

    gemt, derive, motor, forankret,

    // #3591: hvad 23/8-tikket ville gøre ved det gemte loft
    tick_aendrer: !capsEqual(gemt, motor),
    tick_sumDelta: capsSumDelta(gemt, motor),
    tick_maxAbs: capsMaxAbsDelta(gemt, motor),
    tick_ratingDelta: ratingFromAbilities(motor, r.primary_type) - ratingFromAbilities(gemt, r.primary_type),
    tick_bestOf8Delta: bestOf8(motor) - bestOf8(gemt),
    tick_typeSkift: tEfter.primary.key !== r.primary_type,
    tick_sekundaerSkift: tEfter.secondary.key !== r.secondary_type,

    // #3593: hvad forankringen gør ved de to stier
    stier_uenige: !capsEqual(derive, motor),
    stier_sumDelta: capsSumDelta(derive, motor),
    forankret_lig_motor: capsEqual(forankret, motor),
    forankret_sumDelta: capsSumDelta(motor, forankret),
    forankret_ratingDelta: ratingFromAbilities(forankret, r.primary_type) - ratingFromAbilities(motor, r.primary_type),
    forankret_typeSkift: tForankret.primary.key !== r.primary_type,
    forankret_sekundaerSkift: tForankret.secondary.key !== r.secondary_type,

    bvNu, bvEfter,
    bvDelta: bvNu != null && bvEfter != null ? bvEfter - bvNu : null,
    market_value: r.market_value,
  });
}

// ── Rapport ─────────────────────────────────────────────────────────────────
const OWNERS = ["human", "ai", "free"];
const OWNER_DA = { human: "menneske-ejet", ai: "AI-hold", free: "fri agent" };

function section(title) {
  if (JSON_ONLY) return;
  console.log(`\n${"─".repeat(78)}\n${title}\n${"─".repeat(78)}`);
}
function line(s = "") {
  if (!JSON_ONLY) console.log(s);
}

line(`\n#3593 + #3591 pkt. 2 — dry-run (READ-ONLY, ingen mutation)`);
line(`Snapshot: ${SNAPSHOT_DIR}`);
line(`Taget:    ${meta.takenAt}   ·   aktiv sæson ${meta.activeSeasonNumber}`);
line(`race_day_engine_enabled = ${meta.appConfig?.race_day_engine_enabled}`);
line(`Ryttere:  ${records.length} levende (${OWNERS.map((o) => `${OWNER_DA[o]} ${records.filter((r) => r.owner_kind === o).length}`).join(" · ")})`);

// ── DEL 1: #3593 ────────────────────────────────────────────────────────────
section("DEL 1 — #3593: sekundæren mangler i anlægget");

const mangler = records.filter((r) => r.manglerSekundaertAnlaeg);
line(`Ryttere uden sekundært anlæg (archetype_draw.secondary = null): ${mangler.length}`);
for (const o of OWNERS) {
  const n = mangler.filter((r) => r.owner_kind === o).length;
  if (n) line(`   ${OWNER_DA[o].padEnd(14)} ${String(n).padStart(5)}`);
}

const uenige = records.filter((r) => r.stier_uenige);
line(`\nRyttere hvor derive-stien og motor-stien ville skrive FORSKELLIGE lofter: ${uenige.length}`);
line(`   heraf uden sekundært anlæg: ${uenige.filter((r) => r.manglerSekundaertAnlaeg).length}`);
if (uenige.length) {
  line(`   summeret loft-forskel (derive − motor) over 15 evner:`);
  line(`     ${fmtStats(stats(uenige.map((r) => r.stier_sumDelta)))}`);
}

const forankretAendrer = records.filter((r) => !r.forankret_lig_motor);
line(`\nEFTER forankring — ryttere hvor det forankrede loft afviger fra motor-stiens: ${forankretAendrer.length}`);
line(`Type-skift som følge af forankringen:  primær ${records.filter((r) => r.forankret_typeSkift).length} · sekundær ${records.filter((r) => r.forankret_sekundaerSkift).length}`);
if (forankretAendrer.length) {
  line(`   summeret loft-forskel (forankret − motor):`);
  line(`     ${fmtStats(stats(forankretAendrer.map((r) => r.forankret_sumDelta)))}`);
  line(`   loft-rating-delta for egen primærtype:`);
  line(`     ${fmtStats(stats(forankretAendrer.map((r) => r.forankret_ratingDelta)))}`);
}

// ── DEL 2: #3591 ────────────────────────────────────────────────────────────
section("DEL 2 — #3591 pkt. 2: hvad 23/8-tikket gør ved de GEMTE lofter");

const tick = records.filter((r) => r.tick_aendrer);
line(`Ryttere hvis gemte loft ville ændre sig ved motorens genopbygning: ${tick.length} af ${records.length} (${((tick.length / records.length) * 100).toFixed(1)} %)`);
line(``);
line(`${"ejerskab".padEnd(14)} ${"i alt".padStart(6)} ${"ændres".padStart(7)} ${"taber".padStart(7)} ${"vinder".padStart(7)}`);
for (const o of OWNERS) {
  const alle = records.filter((r) => r.owner_kind === o);
  const aendret = alle.filter((r) => r.tick_aendrer);
  const taber = aendret.filter((r) => r.tick_sumDelta < 0);
  const vinder = aendret.filter((r) => r.tick_sumDelta > 0);
  line(`${OWNER_DA[o].padEnd(14)} ${String(alle.length).padStart(6)} ${String(aendret.length).padStart(7)} ${String(taber.length).padStart(7)} ${String(vinder.length).padStart(7)}`);
}

if (tick.length) {
  line(`\nSummeret loft-forskel over 15 evner (motor − gemt):`);
  line(`   ${fmtStats(stats(tick.map((r) => r.tick_sumDelta)))}`);
  line(`Største enkelt-evne-forskel:`);
  line(`   ${fmtStats(stats(tick.map((r) => r.tick_maxAbs)))}`);
  line(`Loft-rating for egen primærtype (motor − gemt):`);
  line(`   ${fmtStats(stats(tick.map((r) => r.tick_ratingDelta)))}`);
  line(`Bedste-af-8 loft-rating (motor − gemt) — samme akse som #3591's oprindelige måling:`);
  line(`   ${fmtStats(stats(tick.map((r) => r.tick_bestOf8Delta)))}`);
}

const typeSkift = records.filter((r) => r.tick_typeSkift);
const sekSkift = records.filter((r) => r.tick_sekundaerSkift);
line(`\nSynligt TYPE-skift ved tikket:  primær ${typeSkift.length} · sekundær ${sekSkift.length}`);
if (typeSkift.length) {
  const fraTil = new Map();
  for (const r of typeSkift) {
    const k = `${r.primary_type} → ${r.drawPrimary}`;
    fraTil.set(k, (fraTil.get(k) || 0) + 1);
  }
  for (const [k, v] of [...fraTil].sort((a, b) => b[1] - a[1])) line(`   ${k.padEnd(34)} ${v}`);
}

const bvFlyttet = records.filter((r) => r.bvDelta != null && r.bvDelta !== 0);
line(`\nMarkedsværdi: ryttere hvis base_value ville flytte sig: ${bvFlyttet.length}`);
if (bvFlyttet.length) line(`   ${fmtStats(stats(bvFlyttet.map((r) => r.bvDelta)))}`);

// ── Gulv-garantien ──────────────────────────────────────────────────────────
section("GULV-GARANTIEN — kan en rytter miste evne han allerede ejer?");
let gulvBrud = 0;
for (const r of records) {
  for (const k of VISIBLE_ABILITIES) {
    const ab = riders.find((x) => x.rider_id === r.rider_id)?.abilities?.[k];
    if (ab != null && num(r.motor[k]) < num(ab) - 1e-9) { gulvBrud++; break; }
  }
}
line(`Ryttere hvor det genopbyggede loft ligger UNDER en nuværende evne: ${gulvBrud}`);
line(`(buildCapsForRider returnerer max(tapered, current) — 0 er det forventede svar.)`);

// ── Output ──────────────────────────────────────────────────────────────────
const resume = {
  snapshot: { dir: SNAPSHOT_DIR, takenAt: meta.takenAt, activeSeasonNumber: meta.activeSeasonNumber },
  population: {
    levende: records.length,
    ...Object.fromEntries(OWNERS.map((o) => [o, records.filter((r) => r.owner_kind === o).length])),
  },
  i3593: {
    udenSekundaertAnlaeg: mangler.length,
    udenSekundaertAnlaegPrEjer: Object.fromEntries(OWNERS.map((o) => [o, mangler.filter((r) => r.owner_kind === o).length])),
    stierUenige: uenige.length,
    forankringAendrerMotorLoft: forankretAendrer.length,
    forankringTypeSkiftPrimaer: records.filter((r) => r.forankret_typeSkift).length,
    forankringTypeSkiftSekundaer: records.filter((r) => r.forankret_sekundaerSkift).length,
  },
  i3591: {
    tikketAendrerLoft: tick.length,
    prEjer: Object.fromEntries(OWNERS.map((o) => {
      const alle = records.filter((r) => r.owner_kind === o);
      const aendret = alle.filter((r) => r.tick_aendrer);
      return [o, {
        iAlt: alle.length,
        aendres: aendret.length,
        taber: aendret.filter((r) => r.tick_sumDelta < 0).length,
        vinder: aendret.filter((r) => r.tick_sumDelta > 0).length,
      }];
    })),
    sumDelta: stats(tick.map((r) => r.tick_sumDelta)),
    ratingDelta: stats(tick.map((r) => r.tick_ratingDelta)),
    bestOf8Delta: stats(tick.map((r) => r.tick_bestOf8Delta)),
    typeSkiftPrimaer: typeSkift.length,
    typeSkiftSekundaer: sekSkift.length,
    baseValueFlyttet: bvFlyttet.length,
  },
  gulvBrud,
};

mkdirSync(OUT_DIR, { recursive: true });
const dato = String(meta.takenAt || "").slice(0, 10) || "udateret";
const resumePath = join(OUT_DIR, `dry-run-lofter-resume-${dato}.json`);
writeFileSync(resumePath, JSON.stringify(resume, null, 2));
// Detalje-filen er ~18 MB og fuldt regenererbar fra snapshottet — den ligger derfor
// IKKE i repoet. `--detaljer` skriver den ved siden af når man skal grave i enkelte
// rytterskæbner.
const detaljerPath = join(OUT_DIR, `dry-run-lofter-detaljer-${dato}.json`);
if (process.argv.includes("--detaljer")) writeFileSync(detaljerPath, JSON.stringify(records, null, 1));

if (JSON_ONLY) {
  console.log(JSON.stringify(resume, null, 2));
} else {
  line(`\nSkrev resumé  → ${resumePath}`);
  if (process.argv.includes("--detaljer")) line(`Skrev detaljer → ${detaljerPath}\n`);
  else line(`(kør med --detaljer for den fulde pr-rytter-fil — ~18 MB, ikke i repoet)\n`);
}
