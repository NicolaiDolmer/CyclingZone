// Engangs-runner (Task 3): læser den immutable snapshot og skriver struktureret
// data til frontend/src/data/patchNotes.js. Efter første kørsel er output source
// of truth (håndskrevne overskrifter + audience-rettelser redigeres DER, ikke her).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  splitLang, normalizeCategory, getTopic, classifyAudience, parseRefs, deriveTitle,
} from "./lib/patchNotesTransform.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = join(__dirname, "patch-notes-source-snapshot.json");
const OUT = join(__dirname, "..", "frontend", "src", "data", "patchNotes.js");

const source = JSON.parse(readFileSync(SNAPSHOT, "utf8"));

function cleanLang(rawBody, topic) {
  const { refs, body } = parseRefs(rawBody);
  return { title: deriveTitle(topic, body), body, refs };
}

function buildChange(rawCategory, enBody, daBody) {
  const topic = getTopic(rawCategory);
  const refSource = enBody || daBody || "";
  const category = normalizeCategory(rawCategory, refSource);
  const audience = classifyAudience(rawCategory, `${enBody || ""} ${daBody || ""}`);
  const en = enBody ? cleanLang(enBody, topic) : undefined;
  const da = daBody ? cleanLang(daBody, topic) : undefined;
  const refs = [...new Set([...(en?.refs || []), ...(da?.refs || [])])];
  const out = { category, audience };
  if (topic) out.topic = topic;
  if (en) out.en = { title: en.title, body: en.body };
  if (da) out.da = { title: da.title, body: da.body };
  if (refs.length) out.refs = refs;
  return out;
}

const patches = source.map((p) => {
  const changes = [];
  for (const section of p.changes || []) {
    const items = section.items || [];
    const byLang = { en: [], da: [] };
    for (const raw of items) {
      const { lang, body } = splitLang(raw);
      byLang[lang].push(body);
    }
    const n = Math.max(byLang.en.length, byLang.da.length, 0);
    if (byLang.en.length === byLang.da.length && n > 0) {
      for (let i = 0; i < n; i++) {
        changes.push(buildChange(section.category, byLang.en[i], byLang.da[i]));
      }
    } else {
      for (const raw of items) {
        const { lang, body } = splitLang(raw);
        changes.push(buildChange(section.category, lang === "en" ? body : undefined, lang === "da" ? body : undefined));
      }
    }
  }
  return { version: p.version, date: p.date, label: p.label, changes };
});

const banner = `// AUTO-GENERERET af scripts/transform-patch-notes.mjs fra patch-notes-source-snapshot.json.
// Efter første generering er DENNE fil source of truth: håndskrevne overskrifter +
// audience-rettelser redigeres her direkte (re-kør IKKE transformen oven på dem).
// CI: scripts/check-patch-notes-version.js læser version:-felterne herfra.\n`;

writeFileSync(OUT, `${banner}export const PATCHES = ${JSON.stringify(patches, null, 2)};\n`, "utf8");

const flat = patches.flatMap((p) => p.changes);
const internal = flat.filter((c) => c.audience === "internal").length;
console.log(`Wrote ${patches.length} patches, ${flat.length} changes (${internal} internal, ${flat.length - internal} player) -> ${OUT}`);
