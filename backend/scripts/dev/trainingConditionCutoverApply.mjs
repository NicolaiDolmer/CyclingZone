// #5928: applies ONE reviewed cutover proposal via the atomic SQL bootstrap.
// Owner-gated prod mutation. Refuses unless the proposal's sha256 matches the
// value passed on the command line AND --confirm is given.
// Runs through psql (stdin, no statement timeout): the bootstrap is one
// transaction over every starter and can exceed the REST statement timeout.
// Credentials come from SUPABASE_DB_URL (Infisical) as PG* env, never argv/stdout.
// Usage (repo root): infisical run --env=prod -- node backend/scripts/dev/trainingConditionCutoverApply.mjs <proposal.private.json> <sha256> --confirm
import fs from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const [proposalPath, expectedSha, confirm] = process.argv.slice(2);
if (!proposalPath || !/^[0-9a-f]{64}$/.test(expectedSha ?? "") || confirm !== "--confirm") {
  throw new Error("Usage: <proposal.private.json> <sha256> --confirm");
}
const proposal = JSON.parse(fs.readFileSync(proposalPath, "utf8"));
const actual = createHash("sha256").update(JSON.stringify(proposal.args)).digest("hex");
if (proposal.operation !== "bootstrap_training_condition_date" || actual !== expectedSha || proposal.sha256 !== expectedSha) {
  throw new Error("Proposal does not match the reviewed sha256; re-export and re-review");
}
const { p_season_id, p_tick_date, p_openings, p_loads } = proposal.args;
if (!/^[0-9a-f-]{36}$/.test(p_season_id) || !/^\d{4}-\d{2}-\d{2}$/.test(p_tick_date)) throw new Error("Invalid season/date");
const tag = "$cz5928$";
const openings = JSON.stringify(p_openings);
const loads = JSON.stringify(p_loads);
if (openings.includes(tag) || loads.includes(tag)) throw new Error("Payload contains the quoting tag");

const dsn = process.env.SUPABASE_DB_URL;
if (!dsn) throw new Error("SUPABASE_DB_URL required (infisical run --env=prod)");
const u = new URL(dsn);
const pgEnv = { ...process.env, PGHOST: u.hostname, PGPORT: u.port || "5432",
  PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres",
  PGUSER: decodeURIComponent(u.username || "postgres"), PGPASSWORD: decodeURIComponent(u.password || ""),
  PGSSLMODE: u.searchParams.get("sslmode") || "require" };

const sql = `SET statement_timeout = 0;
SELECT public.bootstrap_training_condition_date('${p_season_id}'::uuid, '${p_tick_date}'::date, ${tag}${openings}${tag}::jsonb, ${tag}${loads}${tag}::jsonb) AS result;
`;
const res = spawnSync("psql", ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"],
  { input: sql, env: pgEnv, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (res.status !== 0) throw new Error(`bootstrap failed (atomic, nothing applied): ${(res.stderr || res.error?.message || "").trim()}`);
console.log(JSON.stringify({ applied: true, result: (res.stdout || "").trim() }));
