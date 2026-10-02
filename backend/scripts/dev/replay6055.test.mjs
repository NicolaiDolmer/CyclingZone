// #6055: anker for AI-holdenes favoritter (gate).
//
// Maaler det spillerne saa: naar et AI-hold koerer for sin kaptajn (han er
// blandt feltets favoritter til dagens terraen, holdet jager), skal han ogsaa
// ende fremme. Foer #6055 satte AI'en ham paa `protect` eller `all_out`; begge
// braendte reserven af foer finalen, og favoritten landede langt nede netop
// paa de dage holdet satsede paa ham. Koeres paa de samme prod-lignende
// divisionsfelter som #5957's korrelationsanker (AI-roller og -ordrer).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { divisionBatches } from "./replay5957.mjs";
import { runHeadToHead } from "../headToHeadV4.js";
import { rankedFromV4Output } from "../../lib/raceEngineV4Bridge.js";
import { AI_TACTICS_TUNING, classifyTerrainDemand } from "../../lib/engine/v4/ai/aiTactics.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const POPULATION = path.join(here, "..", "baselines", "population-snapshot-2026-09-24.json");
const STAGES = path.join(here, "..", "baselines", "v4-proxy-stages-2026-09-06.json");

const PRIMARY = { climb: "climbing", punch: "punch", sprint: "sprint", cobbles: "cobblestone", time_trial: "time_trial", rolling: "tempo" };

/** Top-10-andel for AI-favoritkaptajner pr. terraen-krav, paa divisionsfelter. */
function favouriteCaptainTop10Share({ population, stages, seed }) {
  const byDemand = new Map();
  for (const batch of divisionBatches(population, stages)) {
    const riderById = new Map(batch.population.riders.map((r) => [r.id, r]));
    for (const row of runHeadToHead({ population: batch.population, stages: batch.stages, seedInput: seed, fieldSize: 180, orderMode: "ai" })) {
      const route = row.raw.route;
      const demand = classifyTerrainDemand({ profile_type: route.profile_type, finale_type: route.finale_type ?? null });
      const ability = PRIMARY[demand];
      const leaderRole = demand === "sprint" ? "sprint_captain" : "captain";
      const ranked = rankedFromV4Output(row.raw.v4Output);
      const rankById = new Map(ranked.map((r) => [r.rider_id, r.rank]));
      const fieldValues = ranked.map((r) => Number(riderById.get(r.rider_id)?.abilities?.[ability]) || 0);
      for (const [riderId, role] of row.raw.roles) {
        if (role !== leaderRole || !rankById.has(riderId)) continue;
        const value = Number(riderById.get(riderId)?.abilities?.[ability]) || 0;
        const fieldRank = fieldValues.filter((v) => v > value).length + 1;
        if (fieldRank > AI_TACTICS_TUNING.CONTENDER_FIELD_RANK) continue; // kun de dage holdet koerer for ham
        const acc = byDemand.get(demand) ?? { n: 0, top10: 0 };
        acc.n += 1;
        if (rankById.get(riderId) <= 10) acc.top10 += 1;
        byDemand.set(demand, acc);
      }
    }
  }
  return byDemand;
}

// Gulvene ligger et godt stykke under det maalte efter rettelsen og over det
// maalte foer (tal privat i balance-internals/6055/).
const GATE = [
  { label: "flad (sprint-kaptajn)", demands: ["sprint"], min: 0.25 },
  { label: "bjerg/kuperet/rullende (kaptajn)", demands: ["climb", "punch", "rolling"], min: 0.5 },
];

test("#6055 anker: AI-favoritkaptajnen ender fremme de dage holdet koerer for ham", () => {
  const population = JSON.parse(readFileSync(POPULATION, "utf8"));
  const stagesFile = JSON.parse(readFileSync(STAGES, "utf8"));
  const stages = Array.isArray(stagesFile) ? stagesFile : stagesFile.stages;
  const byDemand = favouriteCaptainTop10Share({ population, stages, seed: "s1" });
  const failures = [];
  for (const gate of GATE) {
    const accs = gate.demands.map((d) => byDemand.get(d)).filter(Boolean);
    const n = accs.reduce((s, a) => s + a.n, 0);
    assert.ok(n > 0, `${gate.label}: ingen favoritkaptajner i ankeret`);
    const share = accs.reduce((s, a) => s + a.top10, 0) / n;
    if (!(share >= gate.min)) failures.push(`${gate.label}: ${share.toFixed(2)} < ${gate.min}`);
  }
  assert.deepEqual(failures, [], `AI-favoritankeret fejler:\n${failures.join("\n")}`);
});
