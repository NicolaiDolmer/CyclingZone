#!/usr/bin/env node
// patch-notes-discord.mjs - laver copy-paste-klar Discord-tekst (EN) fra
// frontend/src/data/patchNotes.js i det format, de bedste opslag har (7.295-7.308):
//
//   **Patch 7.341** (5 Oct)
//
//   **Training**
//   - **Title**: first sentence of the body.
//
//   **Beta group**
//   - ...
//
//   Full detail as always at cyclingzone.org/patch-notes.
//
// Én kategori-overskrift pr. topic, live før beta, én linje pr. ændring med fed
// titel + kort forklaring. Flere versioner samles i ét opslag. Discord har et loft
// på 2.000 tegn pr. besked, så teksten deles ved overskrifter og nummereres 1/2, 2/2.
//
// Brug:
//   node scripts/patch-notes-discord.mjs 7.341
//   node scripts/patch-notes-discord.mjs 7.339 7.341        (interval, begge med)
//   node scripts/patch-notes-discord.mjs 7.341 --lang=da     (dansk kanal)
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const LIMIT = 1900;
const FOOTER = { en: "Full detail as always at cyclingzone.org/patch-notes.", da: "Alle detaljer som altid på cyclingzone.org/patch-notes." };
const BETA = { en: "Beta group", da: "Beta-gruppen" };
const TOPIC_DA = { Races: "Løb", Training: "Træning", Riders: "Ryttere", Academy: "Akademi", Board: "Bestyrelse", Auctions: "Auktioner", Economy: "Økonomi", Interface: "Interface", Transfers: "Transfers", Scouting: "Scouting", Finance: "Økonomi", Help: "Hjælp", Dashboard: "Dashboard" };
const MONTHS = { en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], da: ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"] };

const cmp = (a, b) => { const [x1, y1] = a.split(".").map(Number); const [x2, y2] = b.split(".").map(Number); return x1 - x2 || y1 - y2; };
const firstSentence = (text) => { const m = String(text ?? "").match(/^(.+?[.!?])(\s|$)/); return (m ? m[1] : String(text ?? "")).trim(); };
const fmtDate = (iso, lang) => { const d = new Date(`${iso}T12:00:00Z`); return `${d.getUTCDate()} ${MONTHS[lang][d.getUTCMonth()]}`; };

export function buildDiscordText(patches, { from, to, lang = "en" }) {
  const picked = patches.filter((p) => p.version && cmp(p.version, from) >= 0 && cmp(p.version, to ?? from) <= 0).sort((a, b) => cmp(a.version, b.version));
  if (!picked.length) throw new Error(`Ingen patch notes mellem ${from} og ${to ?? from}`);
  const versions = picked.length === 1 ? picked[0].version : `${picked[0].version}–${picked.at(-1).version}`;
  const dates = [...new Set(picked.map((p) => fmtDate(p.date, lang)))];
  const head = `**Patch ${versions}** (${dates.length === 1 ? dates[0] : `${dates[0]} to ${dates.at(-1)}`})`;
  const groups = new Map();
  for (const p of picked) for (const c of p.changes ?? []) {
    if (c.audience && c.audience !== "player") continue;
    const t = c[lang] ?? c.en; if (!t?.title) continue;
    const key = c.rollout === "beta" ? BETA[lang] : (lang === "da" ? (TOPIC_DA[c.topic] ?? c.topic) : c.topic) ?? "Other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(`- **${t.title.replace(/\.$/, "")}**: ${firstSentence(t.body)}`);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => (a === BETA[lang]) - (b === BETA[lang]));
  const blocks = ordered.map(([k, lines]) => `**${k}**\n${lines.join("\n")}`);
  const messages = []; let cur = head;
  for (const b of blocks) { if ((cur + "\n\n" + b).length > LIMIT) { messages.push(cur); cur = b; } else cur += "\n\n" + b; }
  cur += `\n\n${FOOTER[lang]}`; messages.push(cur);
  return messages.length === 1 ? messages : messages.map((m, i) => `${i + 1}/${messages.length}\n${m}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); const lang = (args.find((a) => a.startsWith("--lang=")) ?? "--lang=en").slice(7);
  const [from, to] = args.filter((a) => !a.startsWith("--"));
  if (!from) { console.error("Brug: node scripts/patch-notes-discord.mjs <fra-version> [til-version] [--lang=da]"); process.exit(1); }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { PATCHES } = await import(pathToFileURL(resolve(root, "frontend/src/data/patchNotes.js")).href);
  console.log(buildDiscordText(PATCHES, { from, to, lang }).join("\n\n----- næste besked -----\n\n"));
}
