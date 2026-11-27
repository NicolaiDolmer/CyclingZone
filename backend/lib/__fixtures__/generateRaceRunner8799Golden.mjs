// #8799: skriver den frosne fixture raceRunner8799FlagOff.json. Koeres KUN i en separat checkout af
// merge-basen (foer kontakten), med raceRunner8799Scenarios.js kopieret ind ved siden af (#7587).
// Genereres aldrig med den nye kode. Kun hashes (hard rule 17).
// Brug (i merge-basens backend/): node lib/__fixtures__/generateRaceRunner8799Golden.mjs <sourceCommit> <out.json>
import { writeFileSync } from "node:fs";
import { computeOffDigests8799 } from "./raceRunner8799Scenarios.js";

const [sourceCommit, outFile] = process.argv.slice(2);
if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? "") || !outFile) throw new Error("brug: <sourceCommit> <out.json>");
const digests = await computeOffDigests8799();
writeFileSync(outFile, `${JSON.stringify({ sourceCommit, note: "#8799: skrevet af merge-basens kode foer kontakten, kun hashes; genereres aldrig med den nye kode.", ...digests }, null, 2)}\n`);
console.log("skrev", outFile);
