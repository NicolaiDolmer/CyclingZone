// Transform-time rene funktioner (engangs, Task 3-runneren). Konverterer det
// nuværende blandede PATCHES-array til struktureret data: sprog-split,
// kategori-normalisering, audience-klassifikation, ref-parsing, title-afledning.

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
