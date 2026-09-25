// #5580 (spec motor runde 2, M1 punkt 6): READ-ONLY rapport over hvor de to
// effort-kilder er uenige: race_team_orders.riders[].effort (sandheden, ejer
// 21/8) mod race_stage_roles.effort (v3-overlayet). Ingen apply-sti, ingen
// skrivning. En backfill er ejer-gated og kraever en database/-migration med
// ejer-go (risk:high); denne rapport er det foerste skridt, ikke backfillen.
//
// Koer fra backend: infisical run --env=prod --silent -- node scripts/dev/effortSourceDiff5580.mjs [--out=5580-effort-diff.json]
// stdout: kun taellinger (ingen id'er). --out skriver den fulde liste (race,
// etape, rytter) under balance-internals/ (gitignoreret, hard rule 17).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllRows } from "../../lib/supabasePagination.js";

const EFFORT_LEVELS = new Set(["grupetto", "save", "normal", "protect", "all_out"]);

function keyOf(raceId, stageNumber, riderId) {
  return `${raceId}|${Number(stageNumber)}|${riderId}`;
}

/**
 * Ren sammenligning af de to kilder. En ordre-raekke uden gyldig effort for en
 * rytter taeller ikke som en ordre-effort (samme regel som motoren:
 * raceStageRoles.orderEffortByRiderForStage).
 *
 * @param {{stageRoleRows: Array<{race_id, stage_number, rider_id, effort}>, teamOrderRows: Array<{race_id, stage_number, riders}>}} args
 */
export function diffEffortSources({ stageRoleRows = [], teamOrderRows = [] }) {
  const fromOrders = new Map();
  for (const row of teamOrderRows) {
    for (const rider of Array.isArray(row.riders) ? row.riders : []) {
      if (rider?.rider_id == null || !EFFORT_LEVELS.has(rider.effort)) continue;
      fromOrders.set(keyOf(row.race_id, row.stage_number, String(rider.rider_id)), rider.effort);
    }
  }
  const fromStageRoles = new Map();
  for (const row of stageRoleRows) {
    fromStageRoles.set(keyOf(row.race_id, row.stage_number, String(row.rider_id)), row.effort || "normal");
  }

  const disagreements = [];
  const transitions = {};
  let bothSources = 0;
  let onlyStageRoles = 0;
  for (const [key, stageEffort] of fromStageRoles) {
    const orderEffort = fromOrders.get(key);
    if (orderEffort === undefined) {
      onlyStageRoles += 1;
      continue;
    }
    bothSources += 1;
    if (orderEffort === stageEffort) continue;
    const [race_id, stage_number, rider_id] = key.split("|");
    disagreements.push({ race_id, stage_number: Number(stage_number), rider_id, stage_roles: stageEffort, order: orderEffort });
    const t = `${stageEffort}->${orderEffort}`;
    transitions[t] = (transitions[t] ?? 0) + 1;
  }
  let onlyOrders = 0;
  for (const key of fromOrders.keys()) if (!fromStageRoles.has(key)) onlyOrders += 1;

  return {
    dryRun: true,
    written: 0,
    stageRoleRows: fromStageRoles.size,
    orderRiderRows: fromOrders.size,
    bothSources,
    disagree: disagreements.length,
    onlyStageRoles,
    onlyOrders,
    transitions,
    disagreements,
  };
}

export function parseArgs(args) {
  const options = { out: null };
  for (const arg of args) {
    if (arg.startsWith("--out=") && arg.length > 6) options.out = arg.slice(6);
    else throw new Error(`Unsupported argument: ${arg}. This script is read-only.`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const privateRoot = fileURLToPath(new URL("../../../balance-internals/", import.meta.url));
  const output = options.out ? resolve(privateRoot, options.out) : null;
  if (output) {
    const rel = relative(privateRoot, output);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Output must be inside balance-internals");
  }
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY missing");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const stageRoleRows = await fetchAllRows(() => supabase
    .from("race_stage_roles")
    .select("race_id, stage_number, rider_id, effort")
    .order("race_id").order("stage_number").order("rider_id"));
  const teamOrderRows = await fetchAllRows(() => supabase
    .from("race_team_orders")
    .select("race_id, stage_number, team_id, riders")
    .order("race_id").order("stage_number").order("team_id"));
  const result = diffEffortSources({ stageRoleRows, teamOrderRows });
  if (output) {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  }
  const { disagreements: _rows, ...summary } = result;
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
