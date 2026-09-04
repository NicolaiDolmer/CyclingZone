// Server-side i18n — Refs #4734.
//
// Backend sender normalt kun NOEGLE + PARAMETRE til spilleren, og frontend
// rendrer i modtagerens `users.language` (#666-kontrakten:
// notifications.metadata.{titleCode,titleParams,messageCode,messageParams},
// renderet af frontend/src/lib/backendMessage.js).
//
// To steder kan backend ikke naaes af den kontrakt og skal rendre selv:
//   1. Fallback-teksten i notifications.title/message. Den er stadig raekkens
//      dedup-noegle og det gamle klienter/e-mail-digest laeser, saa den skal
//      findes — men den skal stamme FRA noeglen, ikke fra en haandskrevet
//      streng ved siden af (ellers driver de to fra hinanden).
//   2. Discord-DM'er. De forlader appen som faerdig tekst, saa der er ingen
//      frontend til at oversaette dem. De rendres derfor her i modtagerens
//      `users.language`, praecis som retention-mailsene i emailTemplates.js.
//
// Strengene laeses fra backend/lib/locales/backendMessages.generated.json, der
// genereres fra frontend/public/locales af scripts/build-backend-locales.mjs.
// Se den fil for hvorfor der er en generator og ikke et direkte disk-opslag.
//
// ICU-understoettelse er bevidst et MINIMUM (ingen ny dependency i backend):
// simpel {placeholder}-interpolation samt {count, plural, ...}/{x, select, ...}
// med =N/one/other-grene og #. Det daekker praecis de konstruktioner der findes
// i backendMessages.json i dag; scripts/i18n-check-icu-braces.mjs er gaten der
// holder locale-filerne inden for samme delmaengde.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
const BUNDLE_FILE = join(LIB_DIR, "locales", "backendMessages.generated.json");

export const DEFAULT_LANGUAGE = "en";

let bundleCache = null;

function loadBundle() {
  if (bundleCache) return bundleCache;
  try {
    bundleCache = JSON.parse(readFileSync(BUNDLE_FILE, "utf8"));
  } catch {
    // En manglende bundle maa ALDRIG vaelte den spilhandling der udloeste
    // notifikationen. translate() falder saa tilbage til noeglen selv, og
    // scripts/build-backend-locales.mjs --check fanger tilstanden i CI.
    bundleCache = {};
  }
  return bundleCache;
}

/** Kun til test: tvinger naeste opslag til at laese bundlen fra disk igen. */
export function __resetBundleCacheForTests() {
  bundleCache = null;
}

/**
 * Normalisér et sprog fra users.language til et sprog vi har strenge for.
 * Samme binaere "da eller fallback-engelsk"-selektor som
 * backend/lib/emailTemplates.js' normalizeLanguage — udvides naar et 3. sprog
 * faktisk faar locale-filer (#4110).
 */
export function normalizeLanguage(language) {
  const bundle = loadBundle();
  const code = typeof language === "string" ? language.trim().toLowerCase().split("-")[0] : "";
  return Object.prototype.hasOwnProperty.call(bundle, code) ? code : DEFAULT_LANGUAGE;
}

// ── ICU-delmaengde ───────────────────────────────────────────────────────────

/**
 * Find den matchende ICU-argument-blok fra og med `start` (som peger paa "{").
 * Returnerer indekset for den matchende "}", eller -1 hvis den mangler.
 */
function matchBrace(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Del "one {a} other {b}" op i { one: "a", other: "b" }. */
function parseBranches(body) {
  const branches = {};
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i])) i += 1;
    const nameStart = i;
    while (i < body.length && !/\s|\{/.test(body[i])) i += 1;
    const name = body.slice(nameStart, i).trim();
    while (i < body.length && /\s/.test(body[i])) i += 1;
    if (body[i] !== "{" || !name) break;
    const end = matchBrace(body, i);
    if (end === -1) break;
    branches[name] = body.slice(i + 1, end);
    i = end + 1;
  }
  return branches;
}

function pluralCategory(value) {
  return Number(value) === 1 ? "one" : "other";
}

/**
 * Render en ICU-delmaengde: {name}, {count, plural, ...}, {x, select, ...}, #.
 * Ukendte parametre efterlades som "{name}" (samme adfaerd som i18next uden
 * vaerdi), saa en manglende param er synlig i stedet for at blive til "undefined".
 */
export function formatMessage(template, params = {}, depthValue = null) {
  if (typeof template !== "string" || !template.includes("{")) {
    return typeof template === "string" ? template.replace(/#/g, depthValue == null ? "#" : String(depthValue)) : "";
  }

  let out = "";
  let i = 0;
  while (i < template.length) {
    const ch = template[i];
    if (ch === "#" && depthValue != null) {
      out += String(depthValue);
      i += 1;
      continue;
    }
    if (ch !== "{") {
      out += ch;
      i += 1;
      continue;
    }
    const end = matchBrace(template, i);
    if (end === -1) {
      out += template.slice(i);
      break;
    }
    const inner = template.slice(i + 1, end);
    const commaIdx = inner.indexOf(",");
    if (commaIdx === -1) {
      const name = inner.trim();
      const value = params?.[name];
      out += value == null ? `{${name}}` : String(value);
    } else {
      const name = inner.slice(0, commaIdx).trim();
      const rest = inner.slice(commaIdx + 1);
      const typeIdx = rest.indexOf(",");
      const type = (typeIdx === -1 ? rest : rest.slice(0, typeIdx)).trim();
      const body = typeIdx === -1 ? "" : rest.slice(typeIdx + 1);
      const value = params?.[name];
      if (type === "plural" || type === "selectordinal") {
        const branches = parseBranches(body);
        const exact = branches[`=${Number(value)}`];
        const chosen = exact ?? branches[pluralCategory(value)] ?? branches.other ?? "";
        out += formatMessage(chosen, params, Number(value));
      } else if (type === "select") {
        const branches = parseBranches(body);
        const chosen = branches[String(value)] ?? branches.other ?? "";
        out += formatMessage(chosen, params, depthValue);
      } else {
        // Ukendt ICU-type (fx number/date) — vis raa vaerdi frem for at kaste.
        out += value == null ? `{${name}}` : String(value);
      }
    }
    i = end + 1;
  }
  return out;
}

// ── Opslag ───────────────────────────────────────────────────────────────────

/**
 * Slaa en backendMessages-noegle op og render den med `params`.
 *
 * @param {string} key    - fx "notif.auctionWon.title"
 * @param {object} params - ICU-parametre
 * @param {{ language?: string, fallback?: string }} [opts]
 * @returns {string} Den rendrede streng. Mangler noeglen i sproget, forsoeges
 *   EN; mangler den ogsaa der, returneres `fallback` hvis givet, ellers noeglen
 *   selv (aldrig en tom streng — en tom notifikation er vaerre end en raa noegle).
 */
export function translate(key, params = {}, { language = DEFAULT_LANGUAGE, fallback = "" } = {}) {
  if (!key || typeof key !== "string") return fallback || "";
  const bundle = loadBundle();
  const lng = normalizeLanguage(language);
  const template = bundle?.[lng]?.[key] ?? bundle?.[DEFAULT_LANGUAGE]?.[key];
  if (template == null) return fallback || key;
  return formatMessage(template, params);
}

/** Findes noeglen i EN-bundlen? Bruges af tests og guards. */
export function hasKey(key) {
  const bundle = loadBundle();
  return Boolean(bundle?.[DEFAULT_LANGUAGE] && Object.prototype.hasOwnProperty.call(bundle[DEFAULT_LANGUAGE], key));
}

/** Alle sprog i bundlen (til tests der skal daekke hvert sprog). */
export function bundledLanguages() {
  return Object.keys(loadBundle());
}

/**
 * Modtagerens sprog fra `users.language`. Samme kilde som retention-mailsene
 * (backend/lib/emailService.js). Fejler opslaget, falder vi tilbage til EN —
 * en DM paa forkert sprog er bedre end ingen DM.
 */
export async function resolveUserLanguage(supabase, userId) {
  if (!supabase || !userId) return DEFAULT_LANGUAGE;
  try {
    const { data, error } = await supabase
      .from("users")
      .select("language")
      .eq("id", userId)
      .maybeSingle();
    if (error) return DEFAULT_LANGUAGE;
    return normalizeLanguage(data?.language);
  } catch {
    return DEFAULT_LANGUAGE;
  }
}
