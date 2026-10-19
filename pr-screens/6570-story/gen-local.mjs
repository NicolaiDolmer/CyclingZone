// #6643 · Lokale data til render.mjs uden prod: koerer v4-motoren paa en frossen
// proxy-etape (bjerg) og skriver prod-events.json + prod-results.json i
// render.mjs' format. Ryttere og hold er syntetiske.
//
//   node pr-screens/6570-story/gen-local.mjs <datadir>
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { frozenStageOutput } from "../../backend/lib/engine/v4/testUtils/oldRevisionDigests6199.ts";

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2];
if (!out) throw new Error("brug: node pr-screens/6570-story/gen-local.mjs <datadir>");
mkdirSync(out, { recursive: true });
const raw = JSON.parse(readFileSync(resolve(here, "../../backend/scripts/baselines/v4-proxy-stages-2026-09-06.json"), "utf8"));
const rows = Array.isArray(raw) ? raw : raw.stages;
const row = rows.find((r) => r.profile_type === "mountain") ?? rows[0];
const res = frozenStageOutput(row, "6643-squish", "official_times_v4");
writeFileSync(resolve(out, "prod-events.json"), JSON.stringify(res.timeline.events));
const finishers = res.results.filter((r) => r.status !== "abandoned").sort((a, b) => a.rank - b.rank);
const t0 = finishers[0]?.time_seconds ?? 0;
const nats = ["DK", "FR", "BE", "IT", "ES", "NL", "NO", "CO"];
const rowsOut = finishers.map((r, i) => [r.rank, r.rider_id, `Rider`, `No${i + 1}`, nats[i % nats.length], (i % 20) + 1, Math.round(r.time_seconds - t0)]);
writeFileSync(resolve(out, "prod-results.json"), JSON.stringify(rowsOut));
console.log(`${row.profile_type}/${row.finale_type}: ${res.timeline.events.length} events, ${rowsOut.length} finishers`);
