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

// Roadmap-hub (#5387): en beta-note følger sin kontakt. Er kontakten slået til
// for alle, læses noten som "beta_to_live" uden at datafilen skal rettes.
export function effectiveRollout(change, liveFlags) {
  const written = change.rollout || (change.stage === "beta" ? "beta" : "live");
  if (written === "beta" && change.flag && liveFlags && liveFlags[change.flag] === true) return "beta_to_live";
  return written;
}

export function filterByRollout(changes, mode, liveFlags) {
  if (mode === "beta") return changes.filter((c) => effectiveRollout(c, liveFlags) === "beta");
  return changes;
}

// ── #8049: den nye side (uge for uge, efter område, arkiv pr. måned) ─────────
//
// Siden ligger bag kontakten patch_notes_v2_8049. Slukket = den gamle side ovenfor,
// uændret. Data kommer fra vite-plugins/patch-notes-v2.js som små filer pr. sprog:
// recent (de seneste uger + listen over arkivmåneder), index (titler til søgning i
// arkivet, hentes ved første søgning) og én fil pr. måned (hentes når måneden åbnes).
// Et punkt i filerne er kompakt: { k, v, d, s, a, c, r?, f?, ti, b, fb?, img?, hl?, rp? }.

export const PATCH_NOTES_V2_FLAG = "patch_notes_v2_8049";
export const PATCH_NOTES_DATA_DIR = "patch-notes-data";

/** Områderne i ejerens faste rækkefølge (#8049). "other" er kun arkivets reserve. */
export const PATCH_NOTE_AREAS = Object.freeze([
  "tactics", "races", "engine", "training", "development", "market",
  "academy", "board", "economy", "interface", "mobile", "help",
]);
export const OTHER_AREA = "other";
export const PATCH_NOTE_AREAS_WITH_OTHER = Object.freeze([...PATCH_NOTE_AREAS, OTHER_AREA]);

/** Ét mærke pr. linje, i den rækkefølge ugens nyhed vælges (ejer 16/11). */
export const PATCH_NOTE_TAGS = Object.freeze(["on", "new", "beta", "improved", "fixed"]);

/** Er den nye side tændt for denne viewer? (off = den gamle side) */
export function isPatchNotesV2Stage(stage) {
  return stage === "beta" || stage === "on";
}

export function patchNotesRecentUrl(lang) {
  return `/${PATCH_NOTES_DATA_DIR}/recent.${lang}.json`;
}
export function patchNotesIndexUrl(lang) {
  return `/${PATCH_NOTES_DATA_DIR}/index.${lang}.json`;
}
export function patchNotesMonthUrl(month, lang) {
  return `/${PATCH_NOTES_DATA_DIR}/${month}.${lang}.json`;
}

/** Henter én af de små filer. Kaster ved HTTP-fejl, så kalderen kan vise en fejl. */
export async function loadPatchNotesFile(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`patch-notes: fetch fejlede (${res.status} ${res.statusText})`);
  return res.json();
}

/** Mandag i ugen for en ISO-dato (YYYY-MM-DD). Regnet i UTC, så tidszonen ikke flytter dagen. */
export function weekStartOf(iso) {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

export function addDaysIso(iso, days) {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** ISO-ugenummer (mandag-søndag), som spilleren kender det fra kalenderen. */
export function isoWeekNumber(iso) {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7));
  const jan4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t - jan4) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}

/** Dagens dato hos spilleren (lokal kalenderdag), som YYYY-MM-DD. */
export function todayIso(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Linjens mærke. Udrulning vinder over kategori; en beta-note følger sin kontakt
 * (#6154), så den læses som "Tændt for alle", når kontakten er on for alle.
 */
export function tagOf(item, liveFlags) {
  const rollout = effectiveRollout({ rollout: item.r, flag: item.f }, liveFlags);
  if (rollout === "beta") return "beta";
  if (rollout === "switched_on" || rollout === "beta_to_live") return "on";
  return item.c === "new" || item.c === "improved" || item.c === "fixed" ? item.c : "improved";
}

/**
 * Beta og tændt samme uge (ejer 16/11, valg 6): kun den seneste vises i ugen.
 * En beta-note skjules, når en ikke-beta-note i samme liste har samme kontakt
 * (`f`) eller peger på den med `rp` (replaces). Arkivet og søgningen viser begge.
 */
export function dedupeWeek(items) {
  const written = (it) => it.r || "live";
  const laterFlags = new Set(items.filter((it) => it.f && written(it) !== "beta").map((it) => it.f));
  const replaced = new Set(items.filter((it) => it.rp).map((it) => it.rp));
  return items.filter((it) => {
    if (replaced.has(it.k)) return false;
    return !(written(it) === "beta" && it.f && laterFlags.has(it.f));
  });
}

const TAG_RANK = { on: 0, new: 1, beta: 2, improved: 3, fixed: 4 };

/** Nyeste først; ved samme dag den højeste version først. */
export function compareNewestFirst(a, b) {
  if (a.s !== b.s) return a.s < b.s ? 1 : -1;
  return a.k < b.k ? 1 : a.k > b.k ? -1 : 0;
}

/**
 * Ugens store nyhed (ejer 16/11, valg 3): `hl` overstyrer; ellers Tændt for alle >
 * Nyt > Beta, nyeste først. Ingen af dem: ingen nyhed (en fejlrettelse er aldrig ugens nyhed).
 */
export function pickHero(items, liveFlags) {
  const sorted = [...items].sort(compareNewestFirst);
  const highlighted = sorted.find((it) => it.hl);
  if (highlighted) return highlighted;
  for (const tag of ["on", "new", "beta"]) {
    const hit = sorted.find((it) => tagOf(it, liveFlags) === tag);
    if (hit) return hit;
  }
  return null;
}

/** [[område, punkter]] i den faste rækkefølge, punkterne ordnet efter mærke og nyeste først. */
export function groupByArea(items, liveFlags) {
  const map = new Map();
  for (const it of items) {
    const area = PATCH_NOTE_AREAS_WITH_OTHER.includes(it.a) ? it.a : OTHER_AREA;
    if (!map.has(area)) map.set(area, []);
    map.get(area).push(it);
  }
  return PATCH_NOTE_AREAS_WITH_OTHER.filter((a) => map.has(a)).map((a) => [
    a,
    map.get(a).sort((x, y) => TAG_RANK[tagOf(x, liveFlags)] - TAG_RANK[tagOf(y, liveFlags)] || compareNewestFirst(x, y)),
  ]);
}

/**
 * Er punktet nyt siden spillerens markør (#6515)? Markøren er enten en dato (sat af
 * den gamle side: "så alt til og med den dag") eller dato + løbenummer som klokkeslæt
 * (`seenKey`, #8049), så en note der lander senere samme dag også er ny.
 * Ingen markør (første besøg): intet er "nyt", som på den gamle side.
 */
export function isNewSince(item, marker) {
  if (!marker || typeof marker !== "string") return false;
  if (marker.length <= 10) return item.d > marker;
  return (item.s || item.d) > marker;
}

/** Den nyeste seenKey blandt punkterne (det siden markerer som set). */
export function latestSeenKey(items) {
  let best = null;
  for (const it of items || []) {
    const key = it.s || it.d;
    if (key && (!best || key > best)) best = key;
  }
  return best;
}

/** Mandagsreglen (ejer 16/11, valg 2): sidste uge står åben, når denne uge har under 10 ændringer. */
export const THIN_WEEK_LIMIT = 10;
export function isThinWeek(count) {
  return count < THIN_WEEK_LIMIT;
}

export function filterV2Items(items, { area = "all", betaOnly = false, onlyNew = false, marker = null, liveFlags = null } = {}) {
  return (items || []).filter((it) => {
    if (area !== "all" && it.a !== area) return false;
    if (betaOnly && tagOf(it, liveFlags) !== "beta") return false;
    if (onlyNew && !isNewSince(it, marker)) return false;
    return true;
  });
}

export function normalizeQuery(query) {
  return (query || "").trim().toLowerCase();
}

/** Søgning i titel og tekst (punkter der er hentet). */
export function matchesQuery(item, q) {
  if (!q) return true;
  return `${item.ti || ""} ${item.b || ""}`.toLowerCase().includes(q);
}

/** Resumé af en uge: de to vigtigste titler og de tre største områder (+ resten). */
export function weekSummary(items, liveFlags) {
  const ranked = [...items].sort((x, y) => TAG_RANK[tagOf(x, liveFlags)] - TAG_RANK[tagOf(y, liveFlags)] || compareNewestFirst(x, y));
  const top = ranked.filter((it) => tagOf(it, liveFlags) !== "fixed").slice(0, 2);
  const areas = groupByArea(items, liveFlags).map(([a, list]) => [a, list.length]).sort((x, y) => y[1] - x[1]);
  const rest = areas.slice(3).reduce((sum, [, n]) => sum + n, 0);
  return { top, areas: areas.slice(0, 3), rest };
}

/** Antal pr. mærke i en liste, i mærkernes faste rækkefølge (kun dem der findes). */
export function countTags(items, liveFlags) {
  const counts = {};
  for (const it of items) {
    const tag = tagOf(it, liveFlags);
    counts[tag] = (counts[tag] || 0) + 1;
  }
  return PATCH_NOTE_TAGS.filter((t) => counts[t]).map((t) => [t, counts[t]]);
}
