// #1857: genafspil en RIGTIG afviklet etape fra dens private motor-input-snapshot.
//
// READ-ONLY. Læser én række fra race_stage_engine_inputs (service-rollen) og
// kører motoren igen lokalt. Skriver ALDRIG til databasen.
//
//   1) Bit-identitet på samme revision (exit 0 = identisk, 2 = afvigelse):
//      infisical run --env=prod -- node backend/scripts/dev/replayStage1857.mjs --race=<uuid> --stage=3
//   2) Før/efter mod en kandidat-revision (kun v4-etaper):
//      ... --race=<uuid> --stage=3 --candidate=s5_profiles_v3
//   3) Offline fra en gemt række (JSON med input_gzip_b64, eller rå base64):
//      node backend/scripts/dev/replayStage1857.mjs --file=row.json [--candidate=...]
//   Valgfrit: --top=30 (antal ryttere i flytte-listen), --json (maskinlæsbart output)
//
// Bit-identitet kræver samme motor-KODE som etapen kørte på: rækkens engine_build
// er den deployede commit. Afviger koden, viser output-hashen præcis det.
import { readFileSync } from "node:fs";
import {
  ENGINE_INPUT_SNAPSHOT_TABLE,
  compareRanked,
  decodeSnapshot,
  replayEngineInput,
} from "../../lib/engineInputSnapshot1857.js";
import { isKnownRulesRevision } from "../../lib/raceEngineRulesRevision.ts";

function arg(name) {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? null;
}
const asJson = process.argv.includes("--json");
const top = Number(arg("top") ?? 20);
const candidate = arg("candidate");
const file = arg("file");
const raceId = arg("race");
const stageNumber = arg("stage") != null ? Number(arg("stage")) : null;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (candidate && !isKnownRulesRevision(candidate)) fail(`Unknown --candidate revision: ${candidate}`);

async function loadRow() {
  if (file) {
    const text = readFileSync(file, "utf8").trim();
    return text.startsWith("{") ? JSON.parse(text) : { input_gzip_b64: text };
  }
  if (!raceId || !Number.isInteger(stageNumber)) fail("Use --race=<uuid> --stage=<n> or --file=<path>");
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) fail("Missing SUPABASE secrets (run via: infisical run --env=prod -- node ...)");
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data, error } = await sb
    .from(ENGINE_INPUT_SNAPSHOT_TABLE)
    .select("race_id, stage_number, engine, engine_version, rules_revision, seed_input, engine_build, format, input_gzip_b64, input_bytes, stored_bytes, input_sha256, output_sha256, created_at")
    .eq("race_id", raceId)
    .eq("stage_number", stageNumber)
    .maybeSingle();
  if (error) fail(`Read failed: ${error.message}`);
  if (!data) fail(`No snapshot for race ${raceId} stage ${stageNumber}`);
  return data;
}

const row = await loadRow();
const payload = decodeSnapshot(row);
if (row.input_sha256 && row.input_sha256 !== payload.inputSha256) fail("input_sha256 mismatch: the stored snapshot is corrupt");

const base = await replayEngineInput(payload);
const identical = row.output_sha256 ? base.outputSha256 === row.output_sha256 : null;

const report = {
  race_id: row.race_id ?? null,
  stage_number: payload.stageNumber,
  engine: payload.engine,
  rules_revision: payload.rulesRevision,
  engine_build: row.engine_build ?? null,
  stored_bytes: row.stored_bytes ?? null,
  input_bytes: row.input_bytes ?? null,
  stored_output_sha256: row.output_sha256 ?? null,
  replay_output_sha256: base.outputSha256,
  bit_identical: identical,
  winner: base.result.ranked?.[0]?.rider_id ?? null,
};

if (candidate) {
  const cand = await replayEngineInput(payload, { revisionOverride: candidate });
  report.candidate = { rules_revision: candidate, output_sha256: cand.outputSha256, ...compareRanked(base.result.ranked, cand.result.ranked, { top }) };
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Race ${report.race_id ?? "(file)"} stage ${report.stage_number} · engine ${report.engine} · revision ${report.rules_revision} · build ${report.engine_build ?? "?"}`);
  console.log(`Snapshot: ${report.stored_bytes ?? "?"} bytes stored (${report.input_bytes ?? "?"} raw)`);
  if (identical === null) console.log("Bit-identity: no stored output hash (engine threw or old row)");
  else console.log(`Bit-identity on the same revision: ${identical ? "YES" : "NO - output differs from the original run"}`);
  if (report.candidate) {
    const c = report.candidate;
    console.log(`\nCandidate ${c.rules_revision}: same winner=${c.sameWinner} · ranks changed ${c.changedRanks}/${c.total}`);
    if (c.onlyInBase.length) console.log(`  finished only in base: ${c.onlyInBase.length}`);
    if (c.onlyInCandidate.length) console.log(`  finished only in candidate: ${c.onlyInCandidate.length}`);
    console.log("  rider            base  cand  delta   base_gap  cand_gap");
    for (const m of c.moves) {
      console.log(`  ${String(m.rider_id).slice(0, 14).padEnd(16)} ${String(m.base_rank).padStart(4)}  ${String(m.candidate_rank ?? "-").padStart(4)}  ${String(m.delta ?? "-").padStart(5)}   ${String(m.base_gap ?? "-").padStart(8)}  ${String(m.candidate_gap ?? "-").padStart(8)}`);
    }
  }
}

process.exit(identical === false ? 2 : 0);
