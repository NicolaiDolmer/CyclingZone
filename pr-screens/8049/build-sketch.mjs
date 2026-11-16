// #8049 skitse-generator: bygger pr-screens/8049/patch-notes.html med ÆGTE
// patch notes fra frontend/src/data/patchNotes.js. Kun skitse, intet produktkode.
// Kør: node pr-screens/8049/build-sketch.mjs  (fra repo-roden)
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const { PATCHES } = await import(pathToFileURL(path.join(ROOT, "frontend/src/data/patchNotes.js")).href);

// Skitsens "i dag" og spillerens sidste besøg (seen_markers.patch_notes).
const TODAY = "2026-11-16";
const LAST_SEEN = "2026-11-13";

// Områderne i ejerens rækkefølge (#8049).
export const AREAS = [
  ["tactics", "Taktik", "Tactics"],
  ["races", "Løb og løbsfilm", "Races and race film"],
  ["engine", "Løbsmotor", "Race engine"],
  ["training", "Træning", "Training"],
  ["development", "Udvikling", "Development"],
  ["market", "Marked", "Market"],
  ["academy", "Akademi og ungdom", "Academy and youth"],
  ["board", "Bestyrelse", "Board"],
  ["economy", "Økonomi", "Economy"],
  ["interface", "Brugerflade", "Interface"],
  ["mobile", "Mobil", "Mobile"],
  ["help", "Hjælp", "Help"],
];

// Backfill-regel for gamle noter: `topic` -> område. Nye noter skriver `area` selv.
export const TOPIC_AREA = {
  Tactics: "tactics", Planning: "tactics", "Race selection": "tactics", "Team selection": "tactics", "Squad selection": "tactics", "Season planner": "tactics", Assistant: "tactics",
  Races: "races", Racing: "races", "Race results": "races", Results: "races", "Race calendar": "races", Calendar: "races", Standings: "races", Rankings: "races",
  "Race engine": "engine",
  Training: "training",
  "Rider development": "development", Development: "development", Riders: "development", "Rider values": "development", Ratings: "development",
  Transfers: "market", Auctions: "market", Market: "market", "Transfer market": "market", Scouting: "market", Contracts: "market", Watchlist: "market",
  Academy: "academy", "Youth teams": "academy", Youth: "academy",
  Board: "board", "The board": "board", Boardroom: "board",
  Economy: "economy", Finance: "economy", Finances: "economy", Sponsors: "economy", Staff: "economy",
  Mobile: "mobile", "Mobile polish": "mobile", App: "mobile",
  Help: "help",
};
const areaOf = (c) => c.area || TOPIC_AREA[c.topic] || "interface";

// Ét mærke pr. linje: udrulning vinder over kategori.
export function tagOf(c) {
  const r = c.rollout || (c.stage === "beta" ? "beta" : null);
  if (r === "beta") return "beta";
  if (r === "switched_on" || r === "beta_to_live") return "on";
  return c.category; // new | improved | fixed
}
const TAG_RANK = { on: 0, new: 1, beta: 2, improved: 3, fixed: 4 };

const weekStart = (d) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
};

const all = [];
for (const p of PATCHES) {
  (p.changes || []).forEach((c, i) => {
    if (c.audience !== "player") return;
    all.push({
      id: `${p.version}#${i}`, v: p.version, d: p.date, w: weekStart(p.date), m: p.date.slice(0, 7),
      a: areaOf(c), t: tagOf(c), f: c.flag || null,
      ti: c.da?.title || c.en?.title || "", b: c.da?.body || c.en?.body || "",
    });
  });
}

// Samme kontakt i samme uge: "tændt for alle"/live-noten erstatter beta-noten.
function dedupeWeek(list) {
  const liveFlags = new Set(list.filter((c) => c.f && c.t !== "beta").map((c) => c.f));
  return list.filter((c) => !(c.t === "beta" && c.f && liveFlags.has(c.f)));
}

const thisWeek = weekStart(TODAY);
const weeks = [...new Set(all.map((c) => c.w))].sort().reverse();
const recentWeeks = weeks.slice(0, 6); // denne + sidste + 4 forrige
const recent = all.filter((c) => recentWeeks.includes(c.w));
const weekData = recentWeeks.map((w) => {
  const list = dedupeWeek(recent.filter((c) => c.w === w)).sort((x, y) => TAG_RANK[x.t] - TAG_RANK[y.t] || (x.d < y.d ? 1 : -1));
  return { w, list };
});

// Arkiv: hele måneder før den nuværende måned. Oktober med fulde titler som demo
// af "åbn måned"; de øvrige kun titler (til søgning).
const months = [...new Set(all.map((c) => c.m))].sort().reverse().filter((m) => m < TODAY.slice(0, 7));
const archive = months.map((m) => ({
  m,
  n: all.filter((c) => c.m === m).length,
  items: all.filter((c) => c.m === m).map((c) => ({ ti: c.ti, a: c.a, t: c.t, d: c.d })),
}));

const DATA = { TODAY, LAST_SEEN, thisWeek, AREAS, weeks: weekData, archive };
const tpl = readFileSync(path.join(HERE, "sketch-template.html"), "utf8");
const html = tpl.replace("/*__DATA__*/null", JSON.stringify(DATA));
writeFileSync(path.join(HERE, "patch-notes.html"), html);
console.log("skrev patch-notes.html", (html.length / 1024).toFixed(0), "KB; uger", weekData.map((x) => `${x.w}:${x.list.length}`).join(" "));
