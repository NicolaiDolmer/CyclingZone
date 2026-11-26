// #7644 startstempel: skriver den frosne golden (raceRunner7644StampGolden.json) fra en
// SEPARAT checkout af merge-basen, aldrig fra den nye kode (#7587).
//
//   node backend/lib/__fixtures__/generateRaceRunner7644StampGolden.mjs <merge-base-checkout> <sha> > out.json
//
// Koerer merge-basens egne scenarier (raceRunner7644Scenarios.js) to gange: motoren uden nogen
// kontakt (slukket) og motoren med markeringen descentRegroupCap7644 (loftets regel, som den
// var foer stemplet). Kun hashes forlader scriptet (hard rule 17). Syntetisk, ingen prod-data.

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const [baseDir, sha] = process.argv.slice(2);
if (!baseDir || !/^[0-9a-f]{40}$/.test(sha ?? "")) {
  console.error("brug: generateRaceRunner7644StampGolden.mjs <merge-base-checkout> <40-tegns sha>");
  process.exit(2);
}
const lib = join(baseDir, "backend", "lib");
const scenarios = await import(pathToFileURL(join(lib, "__fixtures__", "raceRunner7644Scenarios.js")).href);
const { loadRaceEngineV4 } = await import(pathToFileURL(join(lib, "raceEngineV4Bridge.js")).href);

const engine = await loadRaceEngineV4();
const off = await scenarios.computeOffDigests7644(engine);
const on = await scenarios.computeOffDigests7644({ ...engine, descentRegroupCap7644: true });

const out = {
  sourceCommit: sha,
  note: "#7644 startstempel: merge-basens raceRunner7644Scenarios.js med den rigtige v4-motor, slukket (off) og med loftets markering (on). Kun hashes. Genereres ALDRIG med den nye kode.",
  off,
  on,
};
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
