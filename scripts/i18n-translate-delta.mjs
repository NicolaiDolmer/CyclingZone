#!/usr/bin/env node
// i18n delta-oversætter — Refs #4733 (trin 1 af sprogpipelinen, ejer-go 3/9 på #4110).
//
// Formål: et nyt sprog skal koste ~0 at vedligeholde. EN er sandhed; hvert
// målsprog holdes i sync ved KUN at oversætte de nøgler der er nye eller hvis
// EN-kilde er ændret. Alt andet røres aldrig, så en sprogkaptajns rettelser
// overlever enhver senere kørsel.
//
// Ændringsdetektion sker via `frontend/i18n-state.json` (bevidst UDEN for
// `frontend/public/`, som Vite kopierer råt til `dist/` og Vercel serverer
// offentligt: state-filen er build-tid-metadata, ikke et deploy-artefakt):
//
//   { "version": 1, "languages": { "<lng>": { "<ns>": {
//       "<dot.path>": { "srcHash": "<sha256-prefix af EN-værdien>",
//                       "status": "machine" | "reviewed" } } } } }
//
// Regler (samme rækkefølge som scriptet evaluerer dem):
//   1. Nøgle mangler i målsproget (eller står som `__MISSING__`) → oversæt, status `machine`.
//   2. Nøgle findes, men state mangler (første kørsel på et håndskrevet sprog som da)
//      → registrér som `reviewed` med den aktuelle hash UDEN at oversætte.
//   3. Nøgle findes og srcHash afviger fra EN nu → gen-oversæt, status tilbage til `machine`.
//   4. Nøgle findes og srcHash matcher → røres ALDRIG.
//   5. Nøgle findes ikke længere i EN → fjernes fra målsprog + state (rapporteres).
//
// Kaptajn-flow: kaptajnen retter JSON'en direkte i en PR, og flipper derefter
// namespacet til `reviewed` med `--mark-reviewed` (se docs/i18n/README.md).
//
// Brug:
//   node scripts/i18n-translate-delta.mjs --dry-run
//   infisical run --env=dev -- npm run i18n:translate
//   node scripts/i18n-translate-delta.mjs --mark-reviewed --lng da --ns common
//
// Flag:
//   --dry-run          vis hvad der ville ske; ingen API-kald, ingen skrivning
//   --lng <kode>       kun ét målsprog (default: alle mapper under locales/ undtagen en/en-XA)
//   --ns <navn>        kun ét namespace (default: alle EN-namespaces)
//   --model <id>       overstyr modellen (default DEFAULT_MODEL nedenfor)
//   --max-keys <N>     sikkerhedsloft for antal nøgler pr. kørsel (default 500)
//   --mark-reviewed    flip status til `reviewed` for nøgler hvis hash matcher EN
//
// API-nøglen læses KUN fra process.env.ANTHROPIC_API_KEY og logges aldrig.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { valueHasDoubleBrace } from "./i18n-check-icu-braces.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

export const DEFAULT_MODEL = "claude-sonnet-5";
export const DEFAULT_MAX_KEYS = 500;
export const MAX_KEYS_PER_REQUEST = 60;
export const PLACEHOLDER = "__MISSING__";
export const STATE_VERSION = 1;
export const EM_DASH = "—";

// `en` er sandheden, og `en-XA` er en runtime-genereret pseudo-locale (ingen mappe
// i dag) — begge springes over hvis de dukker op som mapper.
const NON_TARGET_LNGS = new Set(["en", "en-XA"]);

const SOURCE_LNG = "en";

// ---------------------------------------------------------------------------
// Rene hjælpere (eksporteret for tests)
// ---------------------------------------------------------------------------

/** Kort, stabil hash af en EN-værdi. 16 hex-tegn er rigeligt til drift-detektion. */
export function shortHash(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 16);
}

/**
 * Flad en locale-fil ud til Map<dot.path, string>. Arrays flades med index som
 * segment (`reactions.goal_proposal.0`), så board.json's reaktions-lister også
 * kan delta-oversættes. Ikke-strenge blade (tal/bool) er ikke oversættelige og
 * udelades — de kopieres verbatim ved genopbygning.
 */
export function flattenLocale(node, prefix = "", out = new Map()) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => flattenLocale(v, prefix ? `${prefix}.${i}` : String(i), out));
    return out;
  }
  if (node !== null && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      flattenLocale(v, prefix ? `${prefix}.${k}` : k, out);
    }
    return out;
  }
  if (typeof node === "string") out.set(prefix, node);
  return out;
}

/**
 * Genopbyg en målsprogsfil ved at gå EN-strukturen igennem. Det giver gratis:
 * samme nøglerækkefølge som EN, samme nesting/arrays, og at nøgler der er
 * forsvundet fra EN falder ud af filen.
 *
 * `resolveValue(path, enValue)` returnerer strengen der skal stå i målsproget.
 */
export function rebuildFromEn(enNode, resolveValue, prefix = "") {
  if (Array.isArray(enNode)) {
    return enNode.map((v, i) => rebuildFromEn(v, resolveValue, prefix ? `${prefix}.${i}` : String(i)));
  }
  if (enNode !== null && typeof enNode === "object") {
    const out = {};
    for (const [k, v] of Object.entries(enNode)) {
      out[k] = rebuildFromEn(v, resolveValue, prefix ? `${prefix}.${k}` : k);
    }
    return out;
  }
  if (typeof enNode === "string") return resolveValue(prefix, enNode);
  return enNode;
}

/** 2-space indent, trailing newline, UTF-8 uden BOM (matcher de eksisterende filer). */
export function serializeLocale(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

// --- ICU-validering --------------------------------------------------------
//
// Projektet bruger i18next-icu (ENKELT-klamme). To udtræk, fordi et naivt
// `{ident}`-scan giver falske positiver inde i select-grene: i
// `{kind, select, crash {crash} other {incident}}` ser `{crash}` ud som en
// placeholder, men er en oversættelig submessage. Derfor:
//   • ICU-strenge (plural/select/selectordinal) valideres på ARGUMENT-navnene
//     (`{ident,`), på antal `#` og på klamme-balancen.
//   • Almindelige strenge valideres på det fulde `{ident}`-sæt.

const ICU_CONSTRUCT_RE = /,\s*(plural|select|selectordinal)\s*,/;
const SIMPLE_PLACEHOLDER_RE = /\{\s*([A-Za-z0-9_]+)\s*\}/g;
const ICU_ARGUMENT_RE = /\{\s*([A-Za-z0-9_]+)\s*,/g;

export function hasIcuConstruct(value) {
  return ICU_CONSTRUCT_RE.test(String(value));
}

function matchSet(value, re) {
  const out = new Set();
  for (const m of String(value).matchAll(re)) out.add(m[1]);
  return out;
}

export function extractSimplePlaceholders(value) {
  return matchSet(value, SIMPLE_PLACEHOLDER_RE);
}

export function extractIcuArguments(value) {
  return matchSet(value, ICU_ARGUMENT_RE);
}

function countChar(value, ch) {
  let n = 0;
  for (const c of String(value)) if (c === ch) n += 1;
  return n;
}

function sortedDiff(a, b) {
  return [...a].filter((x) => !b.has(x)).sort();
}

/**
 * Post-validering af én oversat streng mod dens EN-kilde. Returnerer
 * `{ ok, errors }`; en nøgle med fejl skrives IKKE.
 */
export function validateTranslation(source, target) {
  const errors = [];
  if (typeof target !== "string") {
    return { ok: false, errors: [`ikke en streng (fik ${typeof target})`] };
  }
  if (target.trim() === "") errors.push("tom streng");
  if (target.includes(EM_DASH)) errors.push("indeholder em-dash (U+2014)");
  if (valueHasDoubleBrace(target)) errors.push("indeholder `{{ident}}` — ICU bruger enkelt-klamme");

  const openSrc = countChar(source, "{");
  const closeSrc = countChar(source, "}");
  const openTgt = countChar(target, "{");
  const closeTgt = countChar(target, "}");
  if (openTgt !== closeTgt) errors.push(`ubalancerede klammer (${openTgt} \`{\` vs ${closeTgt} \`}\`)`);
  if (openTgt !== openSrc || closeTgt !== closeSrc) {
    errors.push(`klamme-antal afviger fra kilden (kilde ${openSrc}/${closeSrc}, mål ${openTgt}/${closeTgt})`);
  }

  if (hasIcuConstruct(source)) {
    const srcArgs = extractIcuArguments(source);
    const tgtArgs = extractIcuArguments(target);
    const missing = sortedDiff(srcArgs, tgtArgs);
    const extra = sortedDiff(tgtArgs, srcArgs);
    if (missing.length) errors.push(`manglende ICU-argument(er): ${missing.join(", ")}`);
    if (extra.length) errors.push(`ukendt(e) ICU-argument(er): ${extra.join(", ")}`);
    if (countChar(source, "#") !== countChar(target, "#")) errors.push("antal `#` afviger fra kilden");
  } else {
    const srcVars = extractSimplePlaceholders(source);
    const tgtVars = extractSimplePlaceholders(target);
    const missing = sortedDiff(srcVars, tgtVars);
    const extra = sortedDiff(tgtVars, srcVars);
    if (missing.length) errors.push(`manglende placeholder(e): ${missing.join(", ")}`);
    if (extra.length) errors.push(`ukendt(e) placeholder(e): ${extra.join(", ")}`);
  }

  return { ok: errors.length === 0, errors };
}

// --- Glossar ---------------------------------------------------------------

/**
 * Parse markdown-tabellen under "## Termer" i docs/i18n/GLOSSARY.md.
 * Kolonner: | English | Dansk | Kontekst | Må IKKE oversættes? |
 * Parses ved runtime, så glossaret kan udvides uden at røre dette script.
 */
export function parseGlossary(markdown) {
  const terms = [];
  let inTerms = false;
  let seenHeader = false;
  for (const rawLine of String(markdown).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("## ")) {
      inTerms = /^##\s+Termer\b/i.test(line);
      seenHeader = false;
      continue;
    }
    if (!inTerms || !line.startsWith("|")) continue;
    const cells = line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    if (cells.length < 4) continue;
    if (/^-{2,}$/.test(cells[0].replace(/[:\s]/g, "-"))) continue; // separator-rækken
    if (!seenHeader) {
      seenHeader = true;
      continue; // header-rækken
    }
    const [english, danish, context, doNot] = cells;
    if (!english) continue;
    terms.push({
      english,
      danish,
      context,
      doNotTranslate: /^ja$/i.test(doNot),
    });
  }
  return terms;
}

const LANGUAGE_NAMES = { da: "Danish", fr: "French", nl: "Dutch", it: "Italian", es: "Spanish", de: "German" };

export function languageName(lng) {
  if (LANGUAGE_NAMES[lng]) return LANGUAGE_NAMES[lng];
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(lng) || lng;
  } catch {
    return lng;
  }
}

/**
 * System-prompten. Injicerer glossaret (parset ved runtime), tone-reglerne,
 * ICU-reglen og kontekst-hintet (namespace + dot-path).
 */
export function buildSystemPrompt({ lng, ns, terms }) {
  const name = languageName(lng);
  const locked = terms.filter((t) => t.doNotTranslate);
  const flexible = terms.filter((t) => !t.doNotTranslate);

  const lines = [];
  lines.push(
    `You are the localisation engine for Cycling Zone, a browser-based multiplayer cycling manager game.`,
    `Translate UI strings from English into ${name} (BCP 47 code: ${lng}).`,
    ``,
    `## Output contract`,
    `Return a single JSON object and nothing else. No prose, no markdown fences.`,
    `The object must contain exactly the same keys as the input object, with the translated string as each value.`,
    ``,
    `## Glossary (from docs/i18n/GLOSSARY.md)`,
    `Never translate these terms. Keep them verbatim, exactly as written:`,
  );
  for (const t of locked) lines.push(`- ${t.english}${t.context ? ` (${t.context})` : ""}`);
  lines.push(``, `Domain terms. Translate only when the target language has a natural equivalent, otherwise keep the English term (cycling jargon is anglo-dominated):`);
  for (const t of flexible) {
    const danishHint = lng === "da" && t.danish ? ` -> use "${t.danish}"` : "";
    lines.push(`- ${t.english}${danishHint}${t.context ? ` (${t.context})` : ""}`);
  }

  lines.push(
    ``,
    `## Tone`,
    `- Direct and informal, the same voice as the English source. Never corporate, never marketing filler.`,
    `- Never use an em-dash (U+2014). Use a comma, a full stop or a colon instead.`,
    `- No AI filler: no "please note", no "in order to", no invented explanations, no hedging the source does not have.`,
    `- Do not add information that is not in the source, and do not drop information that is.`,
  );
  if (lng === "da") {
    lines.push(`- Danish must use the real letters ae, oe and aa written as æ, ø and å. Never write them as "ae", "oe" or "aa".`);
  }

  lines.push(
    ``,
    `## ICU MessageFormat (hard requirement)`,
    `The app renders these strings with i18next-icu, single-brace ICU MessageFormat.`,
    `- Keep every placeholder exactly as written: {name}, {count}, {rider}. Never rename, translate, reorder into a different placeholder, or add new ones.`,
    `- Keep plural and select structures byte-identical in shape: {count, plural, one {...} other {...}} keeps the argument name, the keyword and the branch selectors (one, other, few, many, =0, male, female, ...). Translate only the text inside the branches.`,
    `- Keep every \`#\` exactly where it is. It renders the number.`,
    `- Never write double braces {{like this}}. ICU does not interpolate them and the literal braces reach the UI.`,
    ``,
    `## Length`,
    `Short UI strings stay short. A button, a tab label or a table header must not grow into a sentence.`,
    `Do not add explanations, articles or politeness that the English source does not have.`,
    ``,
    `## Context`,
    `Namespace: ${ns}. Every input key is the dot-path of the string inside that namespace, which tells you where it renders (for example "nav.item.dashboard" is a navigation label, "errors.bidTooLow" is an error message).`,
  );

  return lines.join("\n");
}

export function buildUserPrompt({ lng, ns, entries }) {
  const payload = {};
  for (const e of entries) payload[e.key] = e.source;
  return [
    `Namespace: ${ns}`,
    `Target language: ${languageName(lng)} (${lng})`,
    `Translate every value. Return one JSON object with exactly these ${entries.length} keys.`,
    ``,
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

/** Streng JSON-parse af modelsvaret. Tolererer en markdown-fence, intet andet. */
export function parseModelJson(text) {
  let body = String(text).trim();
  const fence = body.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  if (fence) body = fence[1].trim();
  const parsed = JSON.parse(body);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("svaret var ikke et JSON-objekt");
  }
  return parsed;
}

// --- Delta -----------------------------------------------------------------

/**
 * Beregn hvad der skal ske for ét sprog/namespace.
 * `nsState` er state-objektet for netop dette sprog+namespace (kan være tomt).
 */
export function computeNamespaceDelta({ enFlat, targetFlat, nsState = {} }) {
  const toTranslate = [];
  const firstRun = [];
  const unchanged = [];

  for (const [key, source] of enFlat) {
    const hash = shortHash(source);
    const targetValue = targetFlat.get(key);
    const hasTarget = typeof targetValue === "string" && targetValue !== PLACEHOLDER;
    const entry = nsState[key];

    if (!hasTarget) {
      toTranslate.push({ key, source, hash, reason: "new" });
    } else if (!entry) {
      // Første kørsel på et håndskrevet sprog: registrér som reviewed, oversæt ikke.
      firstRun.push({ key, hash });
    } else if (entry.srcHash !== hash) {
      toTranslate.push({ key, source, hash, reason: "changed" });
    } else {
      unchanged.push(key);
    }
  }

  const known = new Set([...targetFlat.keys(), ...Object.keys(nsState)]);
  const removed = [...known].filter((k) => !enFlat.has(k)).sort();

  return { toTranslate, firstRun, unchanged, removed };
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function listTargetLanguages(localesDir) {
  return readdirSync(localesDir)
    .filter((name) => {
      if (NON_TARGET_LNGS.has(name)) return false;
      try {
        return statSync(join(localesDir, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

export function listNamespaces(localesDir, lng = SOURCE_LNG) {
  return readdirSync(join(localesDir, lng))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

export function loadState(statePath) {
  if (!existsSync(statePath)) return { version: STATE_VERSION, languages: {} };
  const raw = readJson(statePath);
  return { version: raw.version ?? STATE_VERSION, languages: raw.languages ?? {} };
}

// ---------------------------------------------------------------------------
// Claude-kaldet (kun her rører vi netværk / API-nøgle)
// ---------------------------------------------------------------------------

export function createClaudeTranslateBatch() {
  let clientPromise = null;

  async function getClient() {
    if (!clientPromise) {
      clientPromise = (async () => {
        const mod = await import("@anthropic-ai/sdk");
        const Anthropic = mod.default ?? mod.Anthropic;
        return new Anthropic(); // læser ANTHROPIC_API_KEY fra env
      })();
    }
    return clientPromise;
  }

  async function callOnce({ model, systemPrompt, userPrompt }) {
    const client = await getClient();
    const response = await client.messages.create({
      model,
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    return response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  }

  return async function translateBatch({ model, systemPrompt, lng, ns, entries }) {
    const userPrompt = buildUserPrompt({ lng, ns, entries });
    try {
      return parseModelJson(await callOnce({ model, systemPrompt, userPrompt }));
    } catch (err) {
      // Ét retry ved ugyldig JSON — derefter fejler batchen.
      const retryPrompt = `${userPrompt}\n\nYour previous answer was not valid JSON (${err.message}). Return ONLY the JSON object, no prose and no markdown fences.`;
      return parseModelJson(await callOnce({ model, systemPrompt, userPrompt: retryPrompt }));
    }
  };
}

// ---------------------------------------------------------------------------
// Orkestrering
// ---------------------------------------------------------------------------

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Kør delta-oversættelsen. Alt I/O er parametriseret og `translateBatch` er
 * injicerbar, så tests kan køre uden netværk.
 */
export async function runTranslateDelta({
  localesDir,
  glossaryPath,
  statePath,
  lng: lngFilter = null,
  ns: nsFilter = null,
  model = DEFAULT_MODEL,
  dryRun = false,
  markReviewed = false,
  maxKeys = DEFAULT_MAX_KEYS,
  translateBatch = null,
  log = console.log,
} = {}) {
  const terms = parseGlossary(readFileSync(glossaryPath, "utf8"));
  const state = loadState(statePath);

  const languages = listTargetLanguages(localesDir).filter((l) => !lngFilter || l === lngFilter);
  if (lngFilter && languages.length === 0) {
    throw new Error(`ukendt målsprog "${lngFilter}" — fandt ingen mappe ${join(localesDir, lngFilter)}`);
  }
  const namespaces = listNamespaces(localesDir).filter((n) => !nsFilter || n === nsFilter);
  if (nsFilter && namespaces.length === 0) {
    throw new Error(`ukendt namespace "${nsFilter}" — fandt ingen fil ${join(localesDir, SOURCE_LNG, `${nsFilter}.json`)}`);
  }

  // --- Fase 1: læs alt og beregn deltaet (ingen API-kald endnu) -------------
  const plans = [];
  let plannedKeys = 0;

  for (const lng of languages) {
    for (const ns of namespaces) {
      const enFlat = flattenLocale(readJson(join(localesDir, SOURCE_LNG, `${ns}.json`)));
      const targetPath = join(localesDir, lng, `${ns}.json`);
      const targetRaw = existsSync(targetPath) ? readJson(targetPath) : {};
      const targetFlat = flattenLocale(targetRaw);
      const nsState = state.languages?.[lng]?.[ns] ?? {};
      const delta = computeNamespaceDelta({ enFlat, targetFlat, nsState });
      plannedKeys += delta.toTranslate.length;
      plans.push({ lng, ns, enPath: join(localesDir, SOURCE_LNG, `${ns}.json`), targetPath, targetFlat, nsState, delta });
    }
  }

  if (markReviewed) {
    return markReviewedRun({ plans, state, statePath, dryRun, log });
  }

  if (plannedKeys > maxKeys) {
    throw new Error(
      `sikkerhedsloftet er ramt: ${plannedKeys} nøgler skal oversættes, --max-keys er ${maxKeys}. ` +
        `Kør med --max-keys ${plannedKeys} hvis det er meningen (fx første kørsel på et nyt sprog), ` +
        `eller indsnævr med --lng / --ns.`,
    );
  }

  let callModel = translateBatch;
  if (!dryRun && plannedKeys > 0 && !callModel) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY mangler. Nøglen ligger i Infisical og må aldrig committes. " +
          "Kør: infisical run --env=dev -- npm run i18n:translate",
      );
    }
    callModel = createClaudeTranslateBatch();
  }

  // --- Fase 2: oversæt + validér + skriv -----------------------------------
  const rows = [];
  const failures = [];

  for (const plan of plans) {
    const { lng, ns, delta } = plan;
    const translated = new Map();
    let failed = 0;

    if (!dryRun && delta.toTranslate.length > 0) {
      const systemPrompt = buildSystemPrompt({ lng, ns, terms });
      for (const batch of chunk(delta.toTranslate, MAX_KEYS_PER_REQUEST)) {
        let result;
        try {
          result = await callModel({ model, systemPrompt, lng, ns, entries: batch });
        } catch (err) {
          failed += batch.length;
          failures.push(`[${lng}/${ns}] batch på ${batch.length} nøgler fejlede: ${err.message}`);
          continue;
        }
        for (const entry of batch) {
          const candidate = Object.prototype.hasOwnProperty.call(result, entry.key) ? result[entry.key] : undefined;
          if (candidate === undefined) {
            failed += 1;
            failures.push(`[${lng}/${ns}] "${entry.key}": modellen returnerede ikke nøglen`);
            continue;
          }
          const check = validateTranslation(entry.source, candidate);
          if (!check.ok) {
            failed += 1;
            failures.push(`[${lng}/${ns}] "${entry.key}": ${check.errors.join("; ")}`);
            continue;
          }
          translated.set(entry.key, { value: candidate, hash: entry.hash });
        }
      }
    }

    const written = delta.toTranslate.filter((e) => translated.has(e.key)).length;
    rows.push({
      lng,
      ns,
      new: delta.toTranslate.filter((e) => e.reason === "new").length,
      changed: delta.toTranslate.filter((e) => e.reason === "changed").length,
      removed: delta.removed.length,
      registered: delta.firstRun.length,
      unchanged: delta.unchanged.length,
      translated: written,
      failed,
    });

    if (dryRun) continue;

    const touchesFile = written > 0 || delta.removed.length > 0;
    const touchesState = written > 0 || delta.removed.length > 0 || delta.firstRun.length > 0;
    if (!touchesFile && !touchesState) continue;

    // Skriv locale-filen ved at genopbygge fra EN (rækkefølge + fjernede nøgler).
    if (touchesFile) {
      const enObj = readJson(plan.enPath);
      const rebuilt = rebuildFromEn(enObj, (path) => {
        if (translated.has(path)) return translated.get(path).value;
        const existing = plan.targetFlat.get(path);
        return typeof existing === "string" ? existing : PLACEHOLDER;
      });
      mkdirSync(dirname(plan.targetPath), { recursive: true });
      writeFileSync(plan.targetPath, serializeLocale(rebuilt), "utf8");
    }

    // Opdatér state.
    state.languages[lng] ??= {};
    const nsState = { ...plan.nsState };
    for (const key of delta.removed) delete nsState[key];
    for (const entry of delta.firstRun) nsState[entry.key] = { srcHash: entry.hash, status: "reviewed" };
    for (const [key, { hash }] of translated) nsState[key] = { srcHash: hash, status: "machine" };
    state.languages[lng][ns] = nsState;
  }

  if (!dryRun) writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  printReport({ rows, failures, dryRun, model, log });

  return { rows, failures, exitCode: failures.length > 0 ? 1 : 0 };
}

function markReviewedRun({ plans, state, statePath, dryRun, log }) {
  const rows = [];
  const failures = [];

  for (const plan of plans) {
    const { lng, ns, delta } = plan;
    state.languages[lng] ??= {};
    const nsState = { ...plan.nsState };
    let flipped = 0;

    for (const key of delta.unchanged) {
      if (nsState[key] && nsState[key].status !== "reviewed") {
        nsState[key] = { ...nsState[key], status: "reviewed" };
        flipped += 1;
      }
    }
    // Nøgler uden state-post (håndskrevne) registreres samtidig som reviewed.
    for (const entry of delta.firstRun) {
      nsState[entry.key] = { srcHash: entry.hash, status: "reviewed" };
      flipped += 1;
    }
    for (const key of delta.removed) delete nsState[key];

    const stale = delta.toTranslate.length;
    rows.push({ lng, ns, flipped, stale, removed: delta.removed.length });
    if (stale > 0) {
      failures.push(
        `[${lng}/${ns}] ${stale} nøgle(r) blev IKKE markeret reviewed: EN-kilden er ændret eller mangler oversættelse. Kør npm run i18n:translate først.`,
      );
    }
    state.languages[lng][ns] = nsState;
  }

  if (!dryRun) writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  log(`\n${dryRun ? "[dry-run] " : ""}mark-reviewed`);
  log(pad("lng", 6) + pad("namespace", 22) + pad("flipped", 9) + pad("stale", 7) + "removed");
  for (const r of rows) {
    log(pad(r.lng, 6) + pad(r.ns, 22) + pad(String(r.flipped), 9) + pad(String(r.stale), 7) + String(r.removed));
  }
  for (const f of failures) log(`  ! ${f}`);

  // `stale` er information, ikke en fejl: kaptajnen får bare at vide hvad der mangler.
  return { rows, failures: [], exitCode: 0 };
}

function pad(s, n) {
  return String(s).length >= n ? `${String(s)} ` : String(s).padEnd(n, " ");
}

function printReport({ rows, failures, dryRun, model, log }) {
  const active = rows.filter((r) => r.new || r.changed || r.removed || r.registered || r.failed);
  log(`\n${dryRun ? "[dry-run] " : ""}i18n delta (model: ${model})`);
  log(
    pad("lng", 6) + pad("namespace", 22) + pad("new", 6) + pad("changed", 9) + pad("removed", 9) + pad("registered", 12) + "failed",
  );
  if (active.length === 0) {
    log("  (intet at gøre — alle målsprog er i sync med EN)");
  }
  for (const r of active) {
    log(
      pad(r.lng, 6) +
        pad(r.ns, 22) +
        pad(String(r.new), 6) +
        pad(String(r.changed), 9) +
        pad(String(r.removed), 9) +
        pad(String(r.registered), 12) +
        String(r.failed),
    );
  }
  const sum = (f) => rows.reduce((acc, r) => acc + r[f], 0);
  log(
    `${pad("TOTAL", 28)}${pad(String(sum("new")), 6)}${pad(String(sum("changed")), 9)}${pad(String(sum("removed")), 9)}${pad(String(sum("registered")), 12)}${String(sum("failed"))}`,
  );
  if (failures.length > 0) {
    log(`\n${failures.length} nøgle(r) blev IKKE skrevet:`);
    for (const f of failures) log(`  ! ${f}`);
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const opts = { dryRun: false, markReviewed: false, lng: null, ns: null, model: DEFAULT_MODEL, maxKeys: DEFAULT_MAX_KEYS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--mark-reviewed") opts.markReviewed = true;
    else if (arg === "--lng") opts.lng = argv[++i];
    else if (arg === "--ns") opts.ns = argv[++i];
    else if (arg === "--model") opts.model = argv[++i];
    else if (arg === "--max-keys") opts.maxKeys = Number(argv[++i]);
    else throw new Error(`ukendt flag: ${arg}`);
  }
  if (!Number.isFinite(opts.maxKeys) || opts.maxKeys < 0) throw new Error("--max-keys kræver et ikke-negativt tal");
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const localesDir = join(ROOT, "frontend", "public", "locales");
  const result = await runTranslateDelta({
    ...opts,
    localesDir,
    glossaryPath: join(ROOT, "docs", "i18n", "GLOSSARY.md"),
    statePath: join(ROOT, "frontend", "i18n-state.json"),
  });
  process.exitCode = result.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`i18n-translate-delta: ${err.message}`);
    process.exitCode = 1;
  });
}
