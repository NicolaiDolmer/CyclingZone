// #7713: faste scenarier for "ingen lodtraekning efter maalstregen".
// Delt af noRandomWithdrawals7713.test.ts og generatoren af den frosne fixture
// (noRandomWithdrawals7713Base.json). Samme fil koeres i merge-basen (foer rettelsen)
// og i den nye kode; kun hashes forlader modulet (hard rule 17). Ingen prod-data.
//
// Projektionen goer de to koersler sammenlignelige: en rytter der trak en nitte i
// merge-basen, regnes tilbage til "i maal" og hans incident fjernes. Hvad der er
// tilbage, skal vaere ens i gammel og ny kode. Placering og maalets egne point tager
// projektionen ikke med: de foelger af hvem der stadig er i loebet, og er netop den
// tilsigtede aendring.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const sha256 = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Slidte ryttere, saa et etapeloeb rammer samme gren som i prod. Rent syntetisk. */
function wornStartlist(startlist) {
  return startlist.map((entrant) => ({ ...entrant, condition: 0 }));
}

function standingsContext(startlist) {
  // Kun toppen af klassementet er med: resten af feltet ligger uden for den beskyttede top.
  const ids = startlist.slice(0, 3).map((entrant) => entrant.rider_id);
  return {
    status: "standings",
    stage_number: 3,
    leader_id: ids[0] ?? null,
    standings: ids.map((rider_id, index) => ({ rider_id, rank: index + 1, gap_seconds: index * 10 })),
    stages_remaining: 2,
  };
}

const SEEDS = Object.freeze(["a", "b", "c", "d", "e", "f"]);

const CONTEXTS = Object.freeze({
  one_day: () => ({ status: "one_day" }),
  first_stage: () => ({ status: "first_stage", stage_number: 1 }),
  standings: standingsContext,
});

/** Alle fixtures x loebskontekster x seeds paa s5_profiles_v3. */
export function scenarios7713(fixturesDir) {
  const out = [];
  for (const name of readdirSync(fixturesDir).sort()) {
    const base = JSON.parse(readFileSync(path.join(fixturesDir, name, "input.json"), "utf8"));
    for (const [key, context] of Object.entries(CONTEXTS)) {
      const startlist = key === "one_day" ? base.startlist : wornStartlist(base.startlist);
      for (const seed of SEEDS) {
        out.push({
          id: `${name}/${key}/${seed}`,
          input: { ...base, seed: `${base.seed}-${seed}`, startlist, rules_revision: "s5_profiles_v3", gc_context: context(startlist) },
        });
      }
    }
  }
  return out;
}

/** Etapens output uden lodtraekningens spor. */
export function withoutWithdrawals7713(output) {
  const incidents = output.incidents ?? [];
  const withdrawn = new Set(incidents.filter((incident) => incident.kind === "withdrawal").map((incident) => incident.rider_id));
  return {
    results: output.results
      .map((row) => [row.rider_id, row.time_seconds, row.group_id, withdrawn.has(row.rider_id) ? "finished" : row.status])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    incidents: incidents.filter((incident) => incident.kind !== "withdrawal"),
    loads: output.loads,
    events: output.timeline.events.filter((event) => event.type !== "finish"),
  };
}

/** Hash pr. scenarie + om lodtraekningen ramte (saa testen ikke kan vaere tom). */
export function digest7713(simulate, fixturesDir) {
  const digests = {};
  for (const { id, input } of scenarios7713(fixturesDir)) {
    const output = simulate(input);
    digests[id] = {
      had_withdrawal: (output.incidents ?? []).some((incident) => incident.kind === "withdrawal"),
      projection: sha256(withoutWithdrawals7713(output)),
    };
  }
  return digests;
}
