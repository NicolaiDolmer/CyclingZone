# Patch Notes verdensklasse-redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gør `/patch-notes` til en spiller-egnet, dag-grupperet changelog i verdensklasse: kun aktivt sprog, kun spiller-rettet indhold, overskrifter før klik, kategori-filter + søg.

**Architecture:** Data flyttes ud af komponenten til `frontend/src/data/patchNotes.js` i en struktureret form (`{version,date,label,changes:[{category,topic,audience,en:{title,body},da:{title,body},refs}]}`). En engangs-transform (script + rene funktioner) producerer dataen fra det nuværende array. Ren runtime-logik i `frontend/src/lib/patchNotes.js` (filter/group/lang-pick), unit-testet med `node:test`. Komponenten bliver tynd og præsentationel. CI-version-gaten bevares ved at flytte dens fil-konstant.

**Tech Stack:** React + Vite, `node:test` (frontend unit-tests), Playwright (visuelle snapshots), Node ESM scripts.

**Spec:** `docs/superpowers/specs/2026-06-20-patch-notes-world-class-redesign-design.md`

---

## File map

| Fil | Ansvar | Status |
|---|---|---|
| `frontend/src/data/patchNotes.js` | Struktureret data (det transformerede `PATCHES`-array) | Create (via transform) |
| `frontend/src/lib/patchNotes.js` | Runtime rene funktioner: `flattenChanges`, `pickLang`, `filterChanges`, `groupByDay`, `computeNewDays`, `CATEGORY_META` | Create |
| `frontend/src/lib/patchNotes.test.js` | Unit-tests for runtime-funktioner | Create |
| `frontend/src/lib/patchNotes.data.test.js` | Data-invariant-tests (kører over ægte data) | Create |
| `scripts/lib/patchNotesTransform.mjs` | Transform-time rene funktioner: `splitLang`, `detectLang`, `normalizeCategory`, `getTopic`, `classifyAudience`, `parseRefs`, `deriveTitle` | Create |
| `scripts/lib/patchNotesTransform.test.mjs` | Unit-tests for transform-funktioner | Create |
| `scripts/transform-patch-notes.mjs` | Engangs-runner: læser nuv. array-snapshot, skriver struktureret data | Create |
| `frontend/src/pages/PatchNotesPage.jsx` | Tynd præsentationskomponent (search/filter/expand/last-seen state) | Rewrite |
| `frontend/src/pages/PatchNotesPage.test.js` | Source-assertion-tests (audience-filter, i18n.language, ingen dobbelt-sprog) | Create |
| `scripts/check-patch-notes-version.js` | `PATCH_FILE`-konstant → ny data-fil | Modify |

---

## Task 1: Flyt PATCHES-array til data-modul (ren refactor, ingen adfærdsændring)

**Files:**
- Create: `frontend/src/data/patchNotes.js`
- Modify: `frontend/src/pages/PatchNotesPage.jsx:1-3` (import) + slet array-literal
- Modify: `scripts/check-patch-notes-version.js:7`
- Create: `scripts/patch-notes-source-snapshot.json` (rå array som JSON, til reproducerbar transform i Task 3)

- [ ] **Step 1: Kopiér array til data-modul**

Flyt hele `const PATCHES = [...]` fra `PatchNotesPage.jsx` til `frontend/src/data/patchNotes.js` som `export const PATCHES = [ ... ];` (verbatim, ingen indholdsændring endnu).

- [ ] **Step 2: Importér i komponenten**

I `PatchNotesPage.jsx` toppen:
```jsx
import { useState } from "react";
import { PATCHES } from "../data/patchNotes.js";
```
Resten af komponenten uændret (renderer stadig begge sprog — det er meningen i dette trin).

- [ ] **Step 3: Opdatér CI-version-check fil-konstant**

`scripts/check-patch-notes-version.js:7`:
```js
const PATCH_FILE = "frontend/src/data/patchNotes.js";
```

- [ ] **Step 4: Gem rå-snapshot til reproducerbar transform**

Eksportér det nuværende array til `scripts/patch-notes-source-snapshot.json` (engangs; bruges af Task 3-runneren som immutabel kilde). Genereres med en kort node-one-liner der importerer `PATCHES` og `JSON.stringify`er det.

- [ ] **Step 5: Verificér ingen adfærdsændring**

Run: `cd frontend && node --test` → eksisterende tests grønne.
Run: `cd frontend && npm run build` → bygger uden nye warnings.
Run: `node scripts/check-patch-notes-version.js` → `ok (471 versions, top …)`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/data/patchNotes.js frontend/src/pages/PatchNotesPage.jsx scripts/check-patch-notes-version.js scripts/patch-notes-source-snapshot.json
git commit -m "refactor(patch-notes): flyt PATCHES til data-modul + flyt CI-version-check fil-konstant"
```

---

## Task 2: Transform-time rene funktioner (TDD)

**Files:**
- Create: `scripts/lib/patchNotesTransform.mjs`
- Test: `scripts/lib/patchNotesTransform.test.mjs`

- [ ] **Step 1: Skriv de fejlende tests**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitLang, normalizeCategory, getTopic, classifyAudience, parseRefs, deriveTitle,
} from "./patchNotesTransform.mjs";

test("splitLang skiller EN·/DA·-præfiks", () => {
  assert.deepEqual(splitLang("EN · Hello world"), { lang: "en", body: "Hello world" });
  assert.deepEqual(splitLang("DA · Hej verden"), { lang: "da", body: "Hej verden" });
});

test("splitLang detekterer dansk for legacy-streng uden præfiks", () => {
  assert.equal(splitLang("Ryttersøgning matcher nu fulde navne").lang, "da");
});

test("normalizeCategory mapper top-level til enum", () => {
  assert.equal(normalizeCategory("Fixed · Mobile", ""), "fixed");
  assert.equal(normalizeCategory("Forbedringer", ""), "improved");
  assert.equal(normalizeCategory("Nyt", ""), "new");
  assert.equal(normalizeCategory("Added · Race results", ""), "new");
});

test("normalizeCategory falder tilbage på indhold for emne-kategori", () => {
  assert.equal(normalizeCategory("Auktioner", "Rettet en fejl hvor bud crashede"), "fixed");
});

test("getTopic returnerer delen efter ·", () => {
  assert.equal(getTopic("Improved · Getting started"), "Getting started");
  assert.equal(getTopic("Nyt"), "");
});

test("classifyAudience markerer interne kategorier + signaler", () => {
  assert.equal(classifyAudience("Infra · CI-guard", "x"), "internal");
  assert.equal(classifyAudience("Admin · PCM-import", "x"), "internal");
  assert.equal(classifyAudience("S-02a", "x"), "internal");
  assert.equal(classifyAudience("Fixed · Mobile", "GRANT SELECT on riders"), "internal");
  assert.equal(classifyAudience("Improved · Getting started", "Hover the balance to learn"), "player");
});

test("parseRefs trækker issue-numre ud og renser body", () => {
  const r = parseRefs("Live balance in the header. Refs #46");
  assert.deepEqual(r.refs, [46]);
  assert.equal(r.body, "Live balance in the header.");
});

test("deriveTitle bruger topic hvis kort, ellers første klausul", () => {
  assert.equal(deriveTitle("Getting started", "A long body here"), "Getting started");
  assert.equal(deriveTitle("", "Mobile tables no longer clip, and more"), "Mobile tables no longer clip");
});
```

- [ ] **Step 2: Kør → FAIL**

Run: `node --test scripts/lib/patchNotesTransform.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implementér**

```js
export const CATEGORY_MAP = {
  new: "new", nyt: "new", added: "new", "tilføjet": "new", feature: "new",
  improved: "improved", forbedringer: "improved", improvements: "improved",
  changed: "improved", updated: "improved", update: "improved", ux: "improved",
  ui: "improved", design: "improved", qol: "improved", quality: "improved",
  copy: "improved", tema: "improved", localization: "improved", language: "improved",
  navigation: "improved", display: "improved", filtrering: "improved",
  fixed: "fixed", fixes: "fixed", fix: "fixed", fejlrettelser: "fixed",
  bugfix: "fixed", "bug-bash": "fixed", robusthed: "fixed", stabilitet: "fixed",
  stability: "fixed",
};

export const INTERNAL_CATEGORIES = new Set([
  "admin", "infra", "intern infrastruktur", "infrastructure", "reliability",
  "security", "sikkerhed", "backend", "teknisk", "teknik", "tech debt", "drift",
  "observability", "observabilitet", "architecture", "kodekvalitet", "hardening",
  "verifikation", "data", "dokumentation", "documentation",
]);

const INTERNAL_BODY_RE = /(\bSELECT\b|\bINSERT\b|\bUPDATE\b\s|\bDELETE\b|\bALTER\b|CREATE TABLE|\bGRANT\b|\bRLS\b|service_role|\bRPC\b|\bmigration\b|\.sql\b|scripts\/|\.github\/|edge function)/i;
const SPRINT_CODE_RE = /^(S-\d|R\d|P\d)/i;

export function splitLang(item) {
  const m = /^(EN|DA)\s·\s([\s\S]*)$/.exec(item);
  if (m) return { lang: m[1].toLowerCase(), body: m[2].trim() };
  return { lang: detectLang(item), body: String(item).trim() };
}

export function detectLang(s) {
  if (/[æøå]/i.test(s)) return "da";
  if (/\b(ikke|nu kan|og|på|løb|hold|som|der|ved|til|fra)\b/i.test(s)) return "da";
  return "da"; // korpus af legacy enkeltstrenge er overvejende dansk
}

export function getTopic(rawCategory) {
  const parts = String(rawCategory || "").split("·");
  return parts.length > 1 ? parts.slice(1).join("·").trim() : "";
}

export function normalizeCategory(rawCategory, body) {
  const top = String(rawCategory || "").split("·")[0].trim().toLowerCase();
  if (CATEGORY_MAP[top]) return CATEGORY_MAP[top];
  if (/\b(fix|fixed|rettet|løst|crash|bug|fejl|no longer)\b/i.test(body)) return "fixed";
  if (/\b(new|now you can|added|introduc|ny |nu kan|tilføjet)\b/i.test(body)) return "new";
  return "improved";
}

export function classifyAudience(rawCategory, body) {
  const raw = String(rawCategory || "").trim();
  const top = raw.split("·")[0].trim().toLowerCase();
  if (INTERNAL_CATEGORIES.has(top)) return "internal";
  if (SPRINT_CODE_RE.test(raw)) return "internal";
  if (INTERNAL_BODY_RE.test(body)) return "internal";
  return "player";
}

export function parseRefs(body) {
  const refs = [...String(body).matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
  const cleaned = String(body).replace(/\s*(Refs?:?\s*)?(#\d+[\s.]*)+$/i, "").trim();
  return { refs: [...new Set(refs)], body: cleaned };
}

export function deriveTitle(topic, body) {
  if (topic && topic.length <= 40) return topic;
  const firstSentence = String(body).split(/(?<=[.!?])\s/)[0] || String(body);
  let t = firstSentence.split(/[,:;–—]| - /)[0].trim();
  if (t.length > 56) t = t.slice(0, 53).trimEnd() + "…";
  return t;
}
```

- [ ] **Step 4: Kør → PASS**

Run: `node --test scripts/lib/patchNotesTransform.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/patchNotesTransform.mjs scripts/lib/patchNotesTransform.test.mjs
git commit -m "feat(patch-notes): transform-time rene funktioner (lang/kategori/audience/title)"
```

---

## Task 3: Transform-runner — producér struktureret data

**Files:**
- Create: `scripts/transform-patch-notes.mjs`
- Overwrite (genereret): `frontend/src/data/patchNotes.js`

- [ ] **Step 1: Skriv runneren**

```js
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

const patches = source.map((p) => {
  const changes = [];
  for (const section of p.changes || []) {
    const items = section.items || [];
    // saml EN/DA-par pr. logisk ændring: gruppér på position (EN+DA i samme section = ét change)
    const byLang = { en: [], da: [] };
    for (const raw of items) {
      const { lang, body } = splitLang(raw);
      byLang[lang].push(body);
    }
    const n = Math.max(byLang.en.length, byLang.da.length, 0);
    if (byLang.en.length === byLang.da.length && n > 0) {
      // parret: zip
      for (let i = 0; i < n; i++) {
        changes.push(buildChange(section.category, byLang.en[i], byLang.da[i]));
      }
    } else {
      // uparret: hvert item bliver sit eget change i sit sprog
      for (const raw of items) {
        const { lang, body } = splitLang(raw);
        changes.push(buildChange(section.category, lang === "en" ? body : undefined, lang === "da" ? body : undefined));
      }
    }
  }
  return { version: p.version, date: p.date, label: p.label, changes };
});

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

function cleanLang(rawBody, topic) {
  const { refs, body } = parseRefs(rawBody);
  return { title: deriveTitle(topic, body), body, refs };
}

const banner = `// AUTO-GENERERET af scripts/transform-patch-notes.mjs fra patch-notes-source-snapshot.json.
// Efter første generering er DENNE fil source of truth: håndskrevne overskrifter +
// audience-rettelser redigeres her direkte (re-kør IKKE transformen oven på dem).
// CI: scripts/check-patch-notes-version.js læser version:-felterne herfra.\n`;

writeFileSync(OUT, `${banner}export const PATCHES = ${JSON.stringify(patches, null, 2)};\n`, "utf8");
console.log(`Wrote ${patches.length} patches → ${OUT}`);
```

- [ ] **Step 2: Kør transformen**

Run: `node scripts/transform-patch-notes.mjs`
Expected: `Wrote 471 patches → …/patchNotes.js`.

- [ ] **Step 3: Verificér struktur + CI-gate**

Run: `cd frontend && npm run build` → grøn.
Run: `node scripts/check-patch-notes-version.js` → `ok (471 versions, …)`.
Manuel: åbn `patchNotes.js`, bekræft formen `{category, audience, topic?, en?, da?, refs?}`.

- [ ] **Step 4: Commit**

```bash
git add scripts/transform-patch-notes.mjs frontend/src/data/patchNotes.js
git commit -m "feat(patch-notes): generér struktureret data (lang-split, kategori, audience, refs, auto-title)"
```

---

## Task 4: Runtime rene funktioner (TDD)

**Files:**
- Create: `frontend/src/lib/patchNotes.js`
- Test: `frontend/src/lib/patchNotes.test.js`

- [ ] **Step 1: Skriv de fejlende tests**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  flattenChanges, pickLang, filterChanges, groupByDay, computeNewDays,
} from "./patchNotes.js";

const PATCHES = [
  { version: "2.0", date: "2026-06-20", label: "Beta", changes: [
    { category: "improved", topic: "Getting started", audience: "player",
      en: { title: "Tooltips for newcomers", body: "Hover to learn" },
      da: { title: "Tooltips til nye", body: "Hold musen for at lære" } },
    { category: "fixed", audience: "internal",
      en: { title: "DB grant", body: "GRANT SELECT" } },
  ]},
  { version: "1.0", date: "2026-06-19", label: "Beta", changes: [
    { category: "new", audience: "player", da: { title: "Akademi", body: "Nyt akademi" } },
  ]},
];

test("flattenChanges folder versioner ud + tilføjer date/version/_key", () => {
  const flat = flattenChanges(PATCHES);
  assert.equal(flat.length, 3);
  assert.equal(flat[0].date, "2026-06-20");
  assert.equal(flat[0]._key, "2.0#0");
});

test("pickLang vælger aktivt sprog, falder tilbage med flag", () => {
  const c = PATCHES[1].changes[0]; // kun da
  assert.equal(pickLang(c, "da").body, "Nyt akademi");
  const fb = pickLang(c, "en");
  assert.equal(fb.body, "Nyt akademi");
  assert.equal(fb.isFallback, true);
});

test("filterChanges fjerner interne + matcher kategori og query", () => {
  const flat = flattenChanges(PATCHES);
  assert.equal(filterChanges(flat, { lang: "en", category: "all", query: "" }).length, 2);
  assert.equal(filterChanges(flat, { lang: "en", category: "new", query: "" }).length, 1);
  assert.equal(filterChanges(flat, { lang: "en", category: "all", query: "tooltips" }).length, 1);
});

test("groupByDay grupperer player-changes pr. dato, nyeste først", () => {
  const flat = filterChanges(flattenChanges(PATCHES), { lang: "en", category: "all", query: "" });
  const days = groupByDay(flat, "en");
  assert.equal(days.length, 2);
  assert.equal(days[0].date, "2026-06-20");
  assert.equal(days[0].count, 1);
  assert.equal(days[0].categories.improved.length, 1);
});

test("computeNewDays markerer dage nyere end lastSeen; tom ved første besøg", () => {
  assert.deepEqual([...computeNewDays(["2026-06-20", "2026-06-19"], "2026-06-19")], ["2026-06-20"]);
  assert.equal(computeNewDays(["2026-06-20"], null).size, 0);
});
```

- [ ] **Step 2: Kør → FAIL**

Run: `cd frontend && node --test src/lib/patchNotes.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implementér**

```js
export const CATEGORY_META = {
  new: { en: "New", da: "Nyt", dot: "bg-green-400" },
  improved: { en: "Improved", da: "Forbedringer", dot: "bg-blue-400" },
  fixed: { en: "Fixed", da: "Fejlrettelser", dot: "bg-red-400" },
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
```

- [ ] **Step 4: Kør → PASS**

Run: `cd frontend && node --test src/lib/patchNotes.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/patchNotes.js frontend/src/lib/patchNotes.test.js
git commit -m "feat(patch-notes): runtime rene funktioner (flatten/pickLang/filter/group/newDays)"
```

---

## Task 5: Data-invariant-test (sikkerhedsnet for kuratering)

**Files:**
- Create: `frontend/src/lib/patchNotes.data.test.js`

- [ ] **Step 1: Skriv testen**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { PATCHES } from "../data/patchNotes.js";
import { flattenChanges } from "./patchNotes.js";

const CATS = new Set(["new", "improved", "fixed"]);
const AUD = new Set(["player", "internal"]);
const LEAK_RE = /(\bSELECT \b|\bINSERT \b|\bGRANT \b|service_role|\.sql\b|scripts\/|\bRLS\b|\.github\/)/i;
const RECENT_CUTOFF = "2026-05-21";

function cmp(a, b) {
  const A = a.split(".").map(Number), B = b.split(".").map(Number);
  for (let i = 0; i < Math.max(A.length, B.length); i++) { const d = (A[i] || 0) - (B[i] || 0); if (d) return d; }
  return 0;
}

test("hver change har gyldig category, audience og ≥1 sprog-body", () => {
  for (const c of flattenChanges(PATCHES)) {
    assert.ok(CATS.has(c.category), `dårlig category ${c.category} i ${c.version}`);
    assert.ok(AUD.has(c.audience), `dårlig audience ${c.audience} i ${c.version}`);
    assert.ok((c.en && c.en.body) || (c.da && c.da.body), `intet sprog-body i ${c.version}`);
  }
});

test("ingen player-body lækker interne signaler", () => {
  for (const c of flattenChanges(PATCHES)) {
    if (c.audience !== "player") continue;
    for (const lang of ["en", "da"]) {
      const body = c[lang]?.body || "";
      assert.ok(!LEAK_RE.test(body), `intern lækage i player ${c.version}/${lang}: ${body.slice(0, 70)}`);
    }
  }
});

test("versioner er unikke og strengt faldende", () => {
  const vs = PATCHES.map((p) => p.version);
  assert.equal(new Set(vs).size, vs.length, "dublet-versioner");
  for (let i = 1; i < vs.length; i++) assert.ok(cmp(vs[i - 1], vs[i]) > 0, `ikke faldende: ${vs[i - 1]} før ${vs[i]}`);
});

test("seneste player-entries har overskrift pr. tilstedeværende sprog", () => {
  for (const c of flattenChanges(PATCHES)) {
    if (c.audience !== "player" || c.date < RECENT_CUTOFF) continue;
    for (const lang of ["en", "da"]) {
      if (c[lang]?.body) assert.ok(c[lang].title?.trim(), `seneste ${c.version}/${lang} mangler overskrift`);
    }
  }
});
```

- [ ] **Step 2: Kør → forventet delvist FAIL**

Run: `cd frontend && node --test src/lib/patchNotes.data.test.js`
Expected: De første 3 tests PASS; "ingen player-body lækker" og "seneste … overskrift" kan FAIL → dette er arbejdslisten for Task 6+7. Noter de rapporterede `version/lang` linjer.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/patchNotes.data.test.js
git commit -m "test(patch-notes): data-invariant-net (audience, leak-guard, versioner, overskrifter)"
```

---

## Task 6: Audience-verifikation (luk leak-guard-fails)

**Files:**
- Modify: `frontend/src/data/patchNotes.js` (data-rettelser)

Brug data-invariant-testens "ingen player-body lækker"-output som arbejdsliste. For hver rapporteret entry: afgør om den er reelt intern (sæt `audience: "internal"`) eller en player-note der blot nævner et issue-tal/teknisk ord (behold `player`, men fjern det lækkende signal fra body hvis det er et råt SQL/sti-fragment). Kør parallelt (Workflow fan-out) med adversariel verifikation: en player-note må aldrig fejlklassificeres som intern.

- [ ] **Step 1: Kør leak-guard for arbejdsliste**

Run: `cd frontend && node --test src/lib/patchNotes.data.test.js 2>&1 | grep "intern lækage"`

- [ ] **Step 2: Ret hver entry i `patchNotes.js`** (audience-flip eller body-rens, pr. vurdering).

- [ ] **Step 3: Kør → leak-test PASS**

Run: `cd frontend && node --test src/lib/patchNotes.data.test.js`
Expected: "ingen player-body lækker" PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/data/patchNotes.js
git commit -m "fix(patch-notes): audience-verifikation — skjul interne noter, ingen leaks"
```

---

## Task 7: Håndskriv overskrifter for seneste ~30 dage

**Files:**
- Modify: `frontend/src/data/patchNotes.js`

For hver `player`-change med `date ≥ 2026-05-21`: erstat den auto-afledte `title` med en skarp, menneske-sprog-overskrift på begge tilstedeværende sprog (≤ ~6 ord, sætnings-case). Kør som Workflow fan-out i dato-batches; jeg reviewer outputtet. (Den auto-afledte invariant-test sikrer at ingen recent title er tom.)

- [ ] **Step 1: List recent player-entries** (script eller manuelt filter på `date ≥ 2026-05-21 && audience==="player"`).
- [ ] **Step 2: Skriv overskrifter** (en.title + da.title) direkte i `patchNotes.js`.
- [ ] **Step 3: Kør → invariant + lib-tests PASS**

Run: `cd frontend && node --test`
Expected: alle grønne.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/data/patchNotes.js
git commit -m "feat(patch-notes): håndskrevne overskrifter for seneste 30 dages noter"
```

---

## Task 8: Skriv den nye komponent

**Files:**
- Rewrite: `frontend/src/pages/PatchNotesPage.jsx`
- Create: `frontend/src/pages/PatchNotesPage.test.js`

- [ ] **Step 1: Skriv source-assertion-testen**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "PatchNotesPage.jsx"), "utf8");

test("bruger aktivt sprog via i18n.language", () => {
  assert.match(src, /i18n\.language/);
});

test("renderer via runtime-lib (filterChanges + groupByDay)", () => {
  assert.match(src, /filterChanges/);
  assert.match(src, /groupByDay/);
});

test("renderer IKKE rå items direkte (ingen dobbelt-sprog)", () => {
  assert.doesNotMatch(src, /section\.items\.map/);
});

test("gemmer last-seen i localStorage", () => {
  assert.match(src, /cz_patchnotes_last_seen/);
});
```

- [ ] **Step 2: Kør → FAIL**

Run: `cd frontend && node --test src/pages/PatchNotesPage.test.js`
Expected: FAIL (gammelt indhold matcher `section.items.map`).

- [ ] **Step 3: Implementér den nye komponent**

```jsx
import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PATCHES } from "../data/patchNotes.js";
import {
  flattenChanges, filterChanges, groupByDay, pickLang, computeNewDays, CATEGORY_META,
} from "../lib/patchNotes.js";

const LAST_SEEN_KEY = "cz_patchnotes_last_seen";
const CATEGORIES = ["all", "new", "improved", "fixed"];

function formatDate(iso, lang) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(lang === "da" ? "da-DK" : "en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export default function PatchNotesPage() {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith("da") ? "da" : "en";
  const da = lang === "da";

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [openDays, setOpenDays] = useState(() => new Set());
  const [openChanges, setOpenChanges] = useState(() => new Set());

  const flat = useMemo(() => flattenChanges(PATCHES), []);
  const days = useMemo(
    () => groupByDay(filterChanges(flat, { lang, category, query })),
    [flat, lang, category, query],
  );

  const [lastSeen] = useState(() => { try { return localStorage.getItem(LAST_SEEN_KEY); } catch { return null; } });
  const newDays = useMemo(() => computeNewDays(days.map((d) => d.date), lastSeen), [days, lastSeen]);

  useEffect(() => {
    if (days[0]?.date) {
      try { localStorage.setItem(LAST_SEEN_KEY, days[0].date); } catch { /* ignore */ }
    }
  }, [days]);

  // Nyeste dag åben som standard (kun når intet filter aktivt og intet manuelt valg)
  const latest = days[0]?.date;
  const isDayOpen = (date) => (openDays.has(date) || (date === latest && openDays.size === 0 && !query));

  const toggleDay = (date) =>
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date); else next.add(date);
      // sørg for at latest forbliver styrbar når man lukker den
      if (date === latest && !prev.has(date) && prev.size === 0) { next.delete(date); }
      return next;
    });

  const toggleChange = (key) =>
    setOpenChanges((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-cz-1">{da ? "Patch notes" : "Patch notes"}</h1>
        <p className="text-cz-3 text-sm">{da ? "Hvad er nyt i Cycling Zone Manager" : "What's new in Cycling Zone Manager"}</p>
      </div>

      <div className="mb-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={da ? "Søg i opdateringer" : "Search updates"}
          placeholder={da ? "Søg i opdateringer…" : "Search updates…"}
          className="w-full bg-cz-card border border-cz-border rounded-lg px-3 py-2 text-sm text-cz-1 placeholder:text-cz-3 focus:outline-none focus:border-cz-accent/50"
        />
      </div>

      <div className="flex flex-wrap gap-2 mb-6" role="group" aria-label={da ? "Filtrér efter kategori" : "Filter by category"}>
        {CATEGORIES.map((cat) => {
          const active = category === cat;
          const meta = CATEGORY_META[cat];
          const label = cat === "all" ? (da ? "Alle" : "All") : (da ? meta.da : meta.en);
          return (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              aria-pressed={active}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-2 ${
                active ? "border-cz-accent/40 bg-cz-accent/10 text-cz-accent-t" : "border-cz-border text-cz-2 hover:text-cz-1"
              }`}
            >
              {meta && <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />}
              {label}
            </button>
          );
        })}
      </div>

      {days.length === 0 && (
        <p className="text-cz-3 text-sm">{da ? "Ingen opdateringer matcher." : "No updates match."}</p>
      )}

      <div className="flex flex-col gap-3">
        {days.map((day) => {
          const open = isDayOpen(day.date);
          const isNew = newDays.has(day.date);
          return (
            <div key={day.date} className={`bg-cz-card border rounded-xl overflow-hidden ${open ? "border-cz-accent/30" : "border-cz-border"}`}>
              <button onClick={() => toggleDay(day.date)} className="w-full flex items-center justify-between px-5 py-4 text-left">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-cz-1 font-bold text-sm capitalize">{formatDate(day.date, lang)}</span>
                    {isNew && (
                      <span className="text-[9px] uppercase bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30 px-2 py-0.5 rounded-full">
                        {da ? "Ny" : "New"}
                      </span>
                    )}
                  </div>
                  <div className="text-cz-3 text-xs mt-0.5">
                    {day.count} {da ? "opdateringer" : "updates"}{day.topics.length ? ` · ${day.topics.slice(0, 3).join(", ")}` : ""}
                  </div>
                </div>
                <span className={`text-cz-3 text-xs transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
              </button>

              {open && (
                <div className="px-5 pb-5 border-t border-cz-border pt-4 space-y-4">
                  {["new", "improved", "fixed"].map((cat) => {
                    const list = day.categories[cat];
                    if (!list || !list.length) return null;
                    const meta = CATEGORY_META[cat];
                    return (
                      <div key={cat}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${meta.dot}`} />
                          <span className="text-cz-2 text-xs font-semibold uppercase tracking-wider">{da ? meta.da : meta.en}</span>
                        </div>
                        <ul className="flex flex-col gap-2 ms-3.5">
                          {list.map((c) => {
                            const v = pickLang(c, lang);
                            const expanded = openChanges.has(c._key);
                            return (
                              <li key={c._key}>
                                <button
                                  onClick={() => toggleChange(c._key)}
                                  aria-expanded={expanded}
                                  className="w-full flex items-start justify-between gap-2 text-left"
                                >
                                  <span className="text-cz-1 text-sm font-medium leading-snug">
                                    {v.title || v.body}
                                    {v.isFallback && <span className="text-cz-3 text-xs ms-1">({v.lang === "da" ? "Dansk" : "English"})</span>}
                                  </span>
                                  <span className={`text-cz-3 text-xs mt-0.5 transition-transform ${expanded ? "rotate-90" : ""}`}>›</span>
                                </button>
                                {expanded && v.title && (
                                  <p className="text-cz-2 text-sm leading-relaxed mt-1">{v.body}</p>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 text-cz-3 text-xs mt-6">
        <span>{da ? "Interne og tekniske noter er skjult fra denne side." : "Internal & technical notes are hidden from this page."}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Kør → PASS**

Run: `cd frontend && node --test src/pages/PatchNotesPage.test.js`
Expected: PASS.

- [ ] **Step 5: Build + manuel sanity**

Run: `cd frontend && npm run build` → grøn, ingen nye warnings.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/PatchNotesPage.jsx frontend/src/pages/PatchNotesPage.test.js
git commit -m "feat(patch-notes): ny dag-grupperet komponent (sprog-filter, kategori, søg, expand)"
```

---

## Task 9: Lokal logget-ind-verifikation (begge sprog)

**Files:** ingen (verifikation)

- [ ] **Step 1: Kør Playwright-mock-screenshot** af `/patch-notes` i EN og DA (fixtures.js mocker Supabase). Bekræft: kun aktivt sprog, ingen interne noter, dag-gruppering, nyeste dag åben, søg + chips virker, "Ny"-markør.
- [ ] **Step 2: Ret evt. visuelle fejl** i komponenten; gentag.

---

## Task 10: Refresh snapshots + fuldt CI-gate

**Files:** Playwright-snapshot-PNG'er (alle 3 projekter)

- [ ] **Step 1: Opdatér core-smoke snapshots (alle 3 projekter, win32)**

Run: `cd frontend && npx playwright test core-smoke --update-snapshots`
(Inkluderer desktop-chromium + mobile-chromium + mobile-webkit.)

- [ ] **Step 2: Kør hele gate-sættet**

Run: `pwsh -File scripts/verify-local.ps1` (backend+frontend tests + build)
Run: `cd frontend && npm run lint` + i18n-leak + tone-em-dash + warning-budget
Run: `node scripts/check-patch-notes-version.js`

- [ ] **Step 3: Commit snapshots**

```bash
git add frontend/tests/**/*.png
git commit -m "test(patch-notes): refresh core-smoke snapshots (3 projekter)"
```

---

## Task 11: Close-out — patch note, NOW, help, issues

**Files:**
- Modify: `frontend/src/data/patchNotes.js` (ny top-version + entry om selve redesignet)
- Modify: `docs/NOW.md`
- Modify (hvis relevant): `frontend/public/locales/{en,da}/help.json`
- Modify (hvis relevant): `docs/FEATURE_STATUS.md`

- [ ] **Step 1: Tilføj patch note-entry** øverst i `patchNotes.js` med ny top-version (> nuværende top), EN+DA, `category: "improved"`, `audience: "player"`, om at patch notes-siden er gentænkt (dag-gruppering, sprog, søg, kategorier).
- [ ] **Step 2: Opdatér `docs/NOW.md`** (CI-krav når patch-data ændres) — close-out-blok + nulstil 🎯/🤖 + trim til ~1.200 tok.
- [ ] **Step 3: help.json** — opdatér hvis FAQ refererer patch notes; ellers notér hvorfor ikke i PR-body.
- [ ] **Step 4: Kør fuld gate igen** (tests + build + version-check).
- [ ] **Step 5: Commit + PR**

```bash
git add -A
git commit -m "docs(patch-notes): patch note v<NY> + NOW close-out for redesign"
```
PR-body: Brugerverifikation-sektion med `- [x]`-trin (EN+DA screenshot, ingen interne noter, søg/filter). Ingen migration → ren frontend. `Refs #1594 #253 #43`.

- [ ] **Step 6: Issue-close-out** — kommentér/luk #1594; kommentér #253/#43/#413/#954 med hvad dette leverer; #978/#1600 forbliver åbne.

---

## Self-review (udført ved plan-skrivning)

- **Spec-dækning:** §3 beslutninger → Tasks 1-8; §5 transform → Tasks 2-3; §6 arkitektur → Tasks 1,4,8; §7 features → Task 8; §8 CI → Task 1; §10 test → Tasks 4-5,9-10; §11 close-out → Task 11. Ingen huller.
- **Placeholder-scan:** ingen TBD/TODO; alle kode-trin har komplet kode; data-kurerings-trin (6,7) er anker­et af invariant-testen (Task 5).
- **Type-konsistens:** `flattenChanges` tilføjer `_key`/`date`/`version` (Task 4) brugt i komponenten (Task 8); `pickLang` returnerer `{title,body,isFallback,lang}` brugt konsistent; `CATEGORY_META` defineret i lib (Task 4), brugt i komponent (Task 8); `audience`/`category`-enums ens i transform (Task 2), invariant (Task 5) og runtime (Task 4).
