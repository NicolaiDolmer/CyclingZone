// Anvender håndskrevne overskrifter + audience-verdikter (fra titel-workflow'et)
// på frontend/src/data/patchNotes.js. Idempotent: matcher pr. "version#index"-key.
//   node scripts/apply-patch-notes-edits.mjs scripts/_title-edits.json
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "frontend", "src", "data", "patchNotes.js");
const editsPath = process.argv[2] || join(__dirname, "_title-edits.json");

const editsRaw = JSON.parse(readFileSync(editsPath, "utf8"));
const editsArr = Array.isArray(editsRaw) ? editsRaw : (editsRaw.edits || []);
const byKey = new Map(editsArr.map((e) => [e.key, e]));

const { PATCHES } = await import(pathToFileURL(DATA).href);

let titlesSet = 0;
let audienceFlips = 0;
for (const p of PATCHES) {
  p.changes.forEach((c, i) => {
    const e = byKey.get(`${p.version}#${i}`);
    if (!e) return;
    if (c.en && c.en.body && e.en_title) { c.en.title = e.en_title; titlesSet++; }
    if (c.da && c.da.body && e.da_title) { c.da.title = e.da_title; titlesSet++; }
    if (e.audience && e.audience !== c.audience) { c.audience = e.audience; audienceFlips++; }
  });
}

const banner = `// AUTO-GENERERET af scripts/transform-patch-notes.mjs fra patch-notes-source-snapshot.json.
// Efter første generering er DENNE fil source of truth: håndskrevne overskrifter +
// audience-rettelser redigeres her direkte (re-kør IKKE transformen oven på dem).
// CI: scripts/check-patch-notes-version.js læser version:-felterne herfra.\n`;

writeFileSync(DATA, `${banner}export const PATCHES = ${JSON.stringify(PATCHES, null, 2)};\n`, "utf8");
console.log(`Applied ${byKey.size} edits: ${titlesSet} titles set, ${audienceFlips} audience flips.`);
