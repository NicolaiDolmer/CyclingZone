// Runtime rene funktioner for patch notes-siden. Leverer filter/group/lang-pick
// til komponenten + en loader der henter den statiske patch-notes-JSON on-demand.
// Holdt fri for React/Vite så den kan unit-testes med node:test.
//
// #2108/#2060: changelog-prosaen bundtes IKKE længere ind i JS. Den emitteres som
// dist/patch-notes.json af vite-plugins/patch-notes-json.js (SSOT = data/patchNotes.js)
// og hentes her ved runtime, så den route-lazy PatchNotesPage-chunk er slank.

// Stien matcher assetet emitteret af patch-notes-json-pluginet (dist-roden) og
// middleware'en i dev/preview. Absolut fra roden → uafhængig af route-dybde.
export const PATCH_NOTES_URL = "/patch-notes.json";

// Henter og parser patch-notes-JSON'en. Kaster ved HTTP-fejl eller ugyldig form,
// så kalderen kan vise en fejl-tilstand i stedet for en tavst tom side.
export async function loadPatches(url = PATCH_NOTES_URL, fetchImpl = fetch) {
  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`patch-notes: fetch fejlede (${res.status} ${res.statusText})`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("patch-notes: forventede en array af patches");
  }
  return data;
}

export const CATEGORY_META = {
  new: { en: "New", da: "Nyt", dot: "bg-cz-success" },
  improved: { en: "Improved", da: "Forbedringer", dot: "bg-cz-info" },
  fixed: { en: "Fixed", da: "Fejlrettelser", dot: "bg-cz-danger" },
};

export function flattenChanges(patches) {
  const out = [];
  for (const p of patches || []) {
    (p.changes || []).forEach((c, i) => {
      out.push({ ...c, version: p.version, date: p.date, label: p.label, _key: `${p.version}#${i}` });
    });
  }
  return out;
}

export function pickLang(change, lang) {
  const primary = change?.[lang];
  if (primary && primary.body) return { title: primary.title || "", body: primary.body, isFallback: false, lang };
  const other = lang === "da" ? "en" : "da";
  const alt = change?.[other];
  if (alt && alt.body) return { title: alt.title || "", body: alt.body, isFallback: true, lang: other };
  return { title: "", body: "", isFallback: false, lang };
}

export function filterChanges(changes, { lang, category, query }) {
  const q = (query || "").trim().toLowerCase();
  return (changes || []).filter((c) => {
    if (c.audience !== "player") return false;
    if (category && category !== "all" && c.category !== category) return false;
    if (q) {
      const v = pickLang(c, lang);
      const hay = `${v.title} ${v.body} ${c.topic || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function groupByDay(changes) {
  const byDate = new Map();
  for (const c of changes || []) {
    if (!byDate.has(c.date)) byDate.set(c.date, []);
    byDate.get(c.date).push(c);
  }
  const days = [...byDate.entries()].map(([date, list]) => {
    const categories = { new: [], improved: [], fixed: [] };
    const topics = [];
    for (const c of list) {
      (categories[c.category] || (categories[c.category] = [])).push(c);
      if (c.topic && !topics.includes(c.topic)) topics.push(c.topic);
    }
    return { date, count: list.length, topics, categories };
  });
  days.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return days;
}

export function computeNewDays(dayDates, lastSeen) {
  if (!lastSeen) return new Set();
  return new Set((dayDates || []).filter((d) => d > lastSeen));
}
