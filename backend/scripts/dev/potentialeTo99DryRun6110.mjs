// #3564 / #6110: DRY-RUN af omregningen potentiale 1-6 -> ét fast tal 1-99.
//
// KUN LÆSNING. Scriptet laver SELECT mod riders (eller læser et dateret
// snapshot) og skriver én privat rapport. Det skriver ALDRIG til databasen,
// heller ikke til riders.base_talent. Selve omregningen er backend/lib/
// potentialeScale99.ts (remap-variant B som ren funktion). Apply er ejer-gated
// og findes ikke her.
//
// Kør (live SELECT):
//   PARAMS=<privat params.json> infisical run --env=prod -- \
//     node backend/scripts/dev/potentialeTo99DryRun6110.mjs
// Kør (offline, snapshot fra snapshot-6110-potential-estimate.mjs):
//   SNAP_DIR=<snapshot> PARAMS=<privat params.json> \
//     node backend/scripts/dev/potentialeTo99DryRun6110.mjs
//   Snapshot'et skal have birthdate pr. rytter og season_number i meta.json
//   (eller SEASON=<nummer>); ældre snapshots med kun kalenderalder afvises.
//
// PARAMS: de private kalibreringstal (se PotentialeScale99Params). Filen kan
// enten VÆRE params-objektet eller have det under nøglen "potentialeScale99".
// Der findes ingen standardværdier; mangler filen, stopper scriptet.
//
// Output (kun til OUT_DIR, som SKAL ligge under balance-internals/, hard rule 17;
// standard er <repo>/balance-internals/6110):
//   potentiale-to-99-dryrun-<tidsstempel>.json   fuld rapport inkl. pr. rytter
//   potentiale-to-99-dryrun-<tidsstempel>.md     kort læsbar oversigt
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { POTENTIALE_STEPS, scalePotentialeTo99, tierInterval, validateParams } from "../../lib/potentialeScale99.ts";
import { ageForSeason } from "../../lib/riderSeasonAge.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const PRIVATE_DIR_NAME = "balance-internals";

// ── Rene hjælpere (testes i potentialeTo99DryRun6110.test.mjs) ─────────────

/** OUT_DIR skal ligge under en balance-internals-mappe; ellers kaster den. */
export function resolveOutDir(outDirEnv, repoRoot = REPO_ROOT) {
  const dir = path.resolve(outDirEnv || path.join(repoRoot, PRIVATE_DIR_NAME, "6110"));
  const segments = dir.split(/[\\/]+/);
  if (!segments.includes(PRIVATE_DIR_NAME)) {
    throw new Error(`OUT_DIR skal ligge under ${PRIVATE_DIR_NAME}/ (hard rule 17), fik: ${dir}`);
  }
  return dir;
}

/** Læser de private params og afviser dem straks, hvis de ikke er gyldige. */
export function parseParams(json) {
  const params = json && typeof json === "object" && json.potentialeScale99 ? json.potentialeScale99 : json;
  validateParams(params);
  return params;
}

/**
 * DB- eller snapshot-rækker -> funktionens input. Alderen er ALTID spillets
 * sæson-alder (riderSeasonAge.ageForSeason) regnet af birthdate og sæsonnummer,
 * ens i live- og snapshot-tilstand. Et færdigt `age`-felt bruges aldrig: i
 * snapshots fra snapshot-6110-potential-estimate.mjs er det kalenderalder, som
 * grupperer rytterne i andre aldersbånd end live. Rækker uden birthdate-feltet
 * (ældre snapshots) afvises derfor med en klar fejl i stedet for at regne videre.
 * birthdate = null (rytter uden fødselsdato) er gyldigt og giver missing_age.
 * Ryttere uden potentiale tælles, men omregnes ikke.
 */
export function toRiderInputs(rows, seasonNumber) {
  if (!Number.isFinite(seasonNumber)) {
    throw new Error("Sæsonnummer mangler: sæson-alderen kræver det (SEASON=<nummer> eller season_number i snapshot'ets meta.json)");
  }
  const riders = [];
  let missingPotentiale = 0;
  for (const r of rows) {
    if (r.potentiale == null) { missingPotentiale++; continue; }
    if (!Object.hasOwn(r, "birthdate")) {
      throw new Error(`Rytter ${r.id} mangler birthdate: snapshot'et er fra før sæson-alderen (kun kalenderalder). Tag et nyt snapshot med snapshot-6110-potential-estimate.mjs`);
    }
    riders.push({ id: r.id, potentiale: Number(r.potentiale), age: ageForSeason(r.birthdate, seasonNumber) });
  }
  return { riders, missingPotentiale };
}

/**
 * Sæsonnummeret for et snapshot: SEASON vinder, ellers season_number fra
 * snapshot'ets meta.json. Mangler begge, stopper scriptet.
 */
export function snapshotSeasonNumber(seasonEnv, meta) {
  if (seasonEnv !== undefined) return seasonEnv;
  const n = meta?.season_number;
  if (!Number.isFinite(n)) {
    throw new Error("Snapshot'et har intet season_number i meta.json; sæt SEASON=<nummer> eller tag et nyt snapshot");
  }
  return n;
}

function quantiles(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { n: s.length, min: s[0], p10: at(0.1), median: at(0.5), p90: at(0.9), max: s[s.length - 1] };
}

/**
 * Selve dry-runnet som ren funktion: omregner og opsummerer. Rører hverken
 * DB eller filer. `source` beskriver hvor rytterne kom fra (til rapporten).
 */
export function buildDryRunReport(rows, params, { asOf, source, seasonNumber }) {
  const { riders, missingPotentiale } = toRiderInputs(rows, seasonNumber);
  const { byId, skipped, rankViolations } = scalePotentialeTo99(riders, params);
  const compressIdx = POTENTIALE_STEPS.indexOf(params.compressFromPotentiale);

  const perBand = {};
  for (const band of params.ageBands) {
    const inBand = riders.filter((r) => byId.get(r.id)?.band === band.key);
    const perPot = {};
    for (const pot of POTENTIALE_STEPS) {
      const vals = inBand.filter((r) => r.potentiale === pot).map((r) => byId.get(r.id).pot99);
      if (vals.length) perPot[String(pot)] = quantiles(vals);
    }
    perBand[band.key] = { n: inBand.length, perPotentiale: perPot };
  }

  // "Presset ned" = toptalent-klassen lander under centret af sit gamle trin.
  let pressedDown = 0;
  for (const r of riders) {
    const scaled = byId.get(r.id);
    if (!scaled || r.potentiale < params.compressFromPotentiale) continue;
    const [lo, hi] = tierInterval(params, POTENTIALE_STEPS.indexOf(r.potentiale));
    if (scaled.pot99 < (lo + hi) / 2) pressedDown++;
  }

  const floorBreaches = params.floors.map(({ potentiale, floor }) => ({
    potentiale,
    floor,
    below: riders.filter((r) => r.potentiale === potentiale && byId.has(r.id) && byId.get(r.id).pot99 < floor).length,
  }));

  const skippedByReason = {};
  for (const s of skipped) skippedByReason[s.reason] = (skippedByReason[s.reason] || 0) + 1;

  return {
    kind: "potentiale-to-99-dryrun",
    issue: "#3564",
    measuredAt: asOf.toISOString(),
    source,
    seasonNumber: seasonNumber ?? null,
    writes: "none",
    counts: {
      rowsRead: rows.length,
      missingPotentiale,
      scaled: byId.size,
      skipped: skipped.length,
      skippedByReason,
      topClass: riders.filter((r) => byId.has(r.id) && POTENTIALE_STEPS.indexOf(r.potentiale) >= compressIdx).length,
      topClassPressedDown: pressedDown,
    },
    rankViolations: rankViolations.length,
    floorBreaches,
    perBand,
    riders: riders
      .filter((r) => byId.has(r.id))
      .map((r) => ({ id: r.id, oldPot: r.potentiale, band: byId.get(r.id).band, pot99: byId.get(r.id).pot99 })),
    skippedRiders: skipped,
  };
}

export function renderMarkdown(report) {
  const c = report.counts;
  const lines = [
    `# Dry-run: potentiale 1-6 -> 1-99 (#3564)`,
    "",
    `- Målt: ${report.measuredAt} (kilde: ${report.source}, sæson-alder fra sæson ${report.seasonNumber})`,
    `- Skrivninger: ${report.writes}`,
    `- Læst: ${c.rowsRead} · omregnet: ${c.scaled} · sprunget over: ${c.skipped} · uden potentiale: ${c.missingPotentiale}`,
    `- Toptalent-klassen: ${c.topClass}, heraf presset under gammelt trin-center: ${c.topClassPressedDown}`,
    `- Rang-brud: ${report.rankViolations} (krav 0)`,
    `- Gulv-brud: ${report.floorBreaches.map((f) => `${f.potentiale}: ${f.below}`).join(", ") || "ingen gulve"} (krav 0)`,
    "",
    "## Fordeling pr. aldersbånd og gammelt potentiale (min / p10 / median / p90 / max)",
  ];
  for (const [band, { n, perPotentiale }] of Object.entries(report.perBand)) {
    lines.push("", `### ${band} (n=${n})`, "", "| gammelt | n | min | p10 | median | p90 | max |", "|---|---|---|---|---|---|---|");
    for (const [pot, q] of Object.entries(perPotentiale)) {
      lines.push(`| ${pot} | ${q.n} | ${q.min} | ${q.p10} | ${q.median} | ${q.p90} | ${q.max} |`);
    }
  }
  return lines.join("\n") + "\n";
}

// ── I/O (kun når scriptet køres direkte) ───────────────────────────────────

async function liveClient() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Mangler SUPABASE secrets (infisical run --env=prod), eller brug SNAP_DIR");
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

/** Den aktive sæsons nummer (SELECT), til sæson-alderen. */
async function selectActiveSeasonNumber(sb) {
  const { data, error } = await sb.from("seasons").select("number").eq("status", "active").maybeSingle();
  if (error) throw new Error(`seasons: ${error.message}`);
  if (!data || !Number.isFinite(data.number)) throw new Error("Ingen aktiv sæson fundet; sæt SEASON=<nummer>");
  return data.number;
}

async function selectLiveRiders(sb) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    // Stabil, unik sortering (id), ellers kan PostgREST-sider overlappe.
    const { data, error } = await sb
      .from("riders")
      .select("id, birthdate, potentiale")
      .or("is_retired.is.null,is_retired.eq.false")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`riders: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function main() {
  const { PARAMS, SNAP_DIR, OUT_DIR, SEASON } = process.env;
  if (!PARAMS) {
    console.error("Brug: PARAMS=<privat params.json> [SNAP_DIR=<snapshot>] [SEASON=<nummer>] [OUT_DIR=<balance-internals/...>] node backend/scripts/dev/potentialeTo99DryRun6110.mjs");
    process.exit(1);
  }
  const outDir = resolveOutDir(OUT_DIR);
  const params = parseParams(JSON.parse(fs.readFileSync(PARAMS, "utf8")));
  const asOf = new Date();
  let seasonNumber = SEASON ? Number(SEASON) : undefined;
  if (SEASON && !Number.isFinite(seasonNumber)) throw new Error(`SEASON skal være et tal, fik ${SEASON}`);

  let rows;
  let source;
  if (SNAP_DIR) {
    rows = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, "riders.json"), "utf8"));
    const metaPath = path.join(SNAP_DIR, "meta.json");
    const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : null;
    seasonNumber = snapshotSeasonNumber(seasonNumber, meta);
    source = `snapshot ${path.basename(path.resolve(SNAP_DIR))}`;
  } else {
    const sb = await liveClient();
    if (seasonNumber === undefined) seasonNumber = await selectActiveSeasonNumber(sb);
    rows = await selectLiveRiders(sb);
    source = "live SELECT riders";
  }

  const report = buildDryRunReport(rows, params, { asOf, source, seasonNumber });
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = asOf.toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `potentiale-to-99-dryrun-${stamp}.json`);
  const mdPath = path.join(outDir, `potentiale-to-99-dryrun-${stamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, renderMarkdown(report));
  console.log(`Dry-run færdig (ingen skrivninger til DB). Rang-brud: ${report.rankViolations}.`);
  console.log(`Privat rapport: ${jsonPath}`);
  console.log(`Privat oversigt: ${mdPath}`);
  if (report.rankViolations > 0 || report.floorBreaches.some((f) => f.below > 0)) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err?.stack || String(err));
    process.exit(1);
  });
}
