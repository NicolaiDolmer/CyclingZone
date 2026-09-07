// #5011 (ejer-direktiv 3/9, #4751) — @-tag af en manager i forummet, klientsiden.
//
// Filen har TO dele:
//
//  1. En VERBATIM kopi af parser-blokken i backend/lib/forumMentions.js
//     (mellem de to SHARED MENTION PARSER-markører). Kopien er bevidst: den
//     klikbare rendering skal skære teksten præcis samme sted op som serveren
//     sendte notifikationen for, ellers ville et navn kunne stå ulinket i
//     teksten mens modtageren fik en besked — eller omvendt. Paritet er ikke
//     en aftale, den er en test: forumMentions.parity.test.js sammenligner de
//     to blokke tegn for tegn og fejler hvis kun det ene sted rettes.
//     Ret ALTID backend-filen først og kør derefter
//     `node scripts/sync-forum-mentions-parser.mjs` (eller kopiér blokken
//     manuelt) — backend er kilden, fordi det er serveren der afgør hvem der
//     rent faktisk får en notifikation.
//
//  2. Klient-only-hjælpere (efter blokken): editorens autocomplete —
//     hvilket "@..."-ord står caret'en i, hvilke navne matcher det, og
//     hvordan indsættes det valgte navn i teksten.
//
// Ingen React-import, ingen DOM: reglerne kan køres direkte under
// `node --test` (samme mønster som components/forum/forumIdentity.js).

// >>> SHARED MENTION PARSER (#5011) — hold i sync med frontend/src/lib/forumMentions.js
export const MENTION_MAX_WORDS = 4;
/** Hvor mange tegn efter '@' der overhovedet scannes for et navn. */
export const MENTION_SCAN_LENGTH = 80;

const TRAILING_PUNCTUATION = /[.,!?;:…"'”’`)\]}]+$/u;
// Står der et bogstav/tal/underscore lige før '@', er det ikke et tag
// (e-mailadresser, "v1@2x"). '@' selv er tilladt før, så "@@navn" stadig
// rammer på den inderste '@'.
const NAME_CHAR = /[\p{L}\p{N}_]/u;

/** Sammenligningsnøgle for et navn: små bogstaver, kollapset whitespace. */
export function normalizeMentionName(name) {
  return String(name ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Opslagstabel navn → manager. Første forekomst vinder ved navne-kollision:
 * to konti med samme visningsnavn er et data-problem, ikke noget denne
 * parser skal gætte sig ud af — og at tagge den forkerte er værre end at
 * tagge den ene konsekvent.
 */
export function buildMentionIndex(managers) {
  const index = new Map();
  for (const manager of managers || []) {
    const key = normalizeMentionName(manager?.name);
    if (!key || index.has(key)) continue;
    index.set(key, manager);
  }
  return index;
}

/**
 * Længste navne-match der starter på `start` (tegnet lige efter '@').
 * @returns {{manager:object, length:number}|null} `length` er antal tegn af
 *   selve navnet, målt i kildeteksten (uden '@').
 */
function matchNameAt(body, start, index) {
  let end = body.indexOf("\n", start);
  if (end === -1) end = body.length;
  end = Math.min(end, start + MENTION_SCAN_LENGTH);
  const window = body.slice(start, end);
  // "@ navn" og "@" alene er ikke tags.
  if (!window || window[0] === " ") return null;

  let best = null;
  let cursor = 0;
  for (let words = 0; words < MENTION_MAX_WORDS; words += 1) {
    let wordEnd = cursor;
    if (words > 0) {
      // Ord bindes kun sammen af ÉT mellemrum — dobbelt mellemrum eller
      // tabulator betyder at navnet var slut.
      if (window[wordEnd] !== " ") break;
      wordEnd += 1;
      if (wordEnd >= window.length || window[wordEnd] === " ") break;
    }
    while (wordEnd < window.length && window[wordEnd] !== " ") wordEnd += 1;
    if (wordEnd === cursor) break;

    const raw = window.slice(0, wordEnd);
    // Trimmet først, råt sidst: matcher begge (fx managerne "J.R" og "J.R."),
    // vinder det længste — samme regel som mellem ord.
    for (const candidate of [raw.replace(TRAILING_PUNCTUATION, ""), raw]) {
      const manager = index.get(normalizeMentionName(candidate));
      if (manager) best = { manager, length: candidate.length };
    }
    cursor = wordEnd;
    if (cursor >= window.length) break;
  }
  return best;
}

/**
 * Alle @-tags i `text` der peger på et kendt managernavn, i tekstrækkefølge.
 * @param {string} text
 * @param {Array<{name:string}>|Map} managers — liste eller færdigbygget index
 * @returns {Array<{manager:object, name:string, index:number, length:number}>}
 *   `index`/`length` dækker HELE tagget inkl. '@', så en renderer kan skære
 *   teksten op uden at gætte.
 */
export function findForumMentions(text, managers) {
  const body = typeof text === "string" ? text : "";
  if (!body.includes("@")) return [];
  const index = managers instanceof Map ? managers : buildMentionIndex(managers);
  if (index.size === 0) return [];

  const matches = [];
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== "@") continue;
    if (i > 0 && NAME_CHAR.test(body[i - 1])) continue;
    const hit = matchNameAt(body, i + 1, index);
    if (!hit) continue;
    matches.push({
      manager: hit.manager,
      name: body.slice(i + 1, i + 1 + hit.length),
      index: i,
      length: hit.length + 1,
    });
    // Fortsæt EFTER tagget: et navn må ikke kunne matche ind i sig selv.
    i += hit.length;
  }
  return matches;
}

/**
 * Teksten skåret op i rene stykker og tags — grundlaget for den klikbare
 * rendering. Delt med frontenden, så "hvad er et tag" kun defineres ét sted.
 */
export function splitMentionSegments(text, managers) {
  const body = typeof text === "string" ? text : "";
  const matches = findForumMentions(body, managers);
  if (matches.length === 0) return body ? [{ type: "text", text: body }] : [];

  const segments = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.index > cursor) segments.push({ type: "text", text: body.slice(cursor, match.index) });
    segments.push({
      type: "mention",
      text: body.slice(match.index, match.index + match.length),
      name: match.name,
      manager: match.manager,
    });
    cursor = match.index + match.length;
  }
  if (cursor < body.length) segments.push({ type: "text", text: body.slice(cursor) });
  return segments;
}
// <<< SHARED MENTION PARSER (#5011)

// ── Klient-only: autocomplete i editoren ────────────────────────────────────

/**
 * Hvor mange tegn efter '@' der skal stå før listen åbner (ejer-valg 8/9:
 * "@ + 2 tegn"). Under den grænse ville et enkelt '@' i en pris eller en
 * e-mail poppe en liste op over hele feltet, hver gang.
 */
export const MENTION_MIN_QUERY = 2;

/** Hvor mange navne listen viser ad gangen — resten kræver flere tegn. */
export const MENTION_SUGGESTION_LIMIT = 6;

/**
 * Det "@..."-ord caret'en står i, hvis der er ét.
 *
 * Samme afgrænsning som parseren ovenfor (aldrig hen over et linjeskift,
 * aldrig lige efter et bogstav/tal, så en e-mail ikke åbner listen), men
 * målt BAGLÆNS fra caret'en i stedet for fremad fra '@': mens man skriver,
 * er navnet endnu ikke færdigt, så der er intet fuldt match at finde.
 *
 * @param {string} text — hele feltets værdi
 * @param {number} caret — selectionStart
 * @returns {{start:number, query:string}|null} `start` er '@'-tegnets index.
 */
export function findMentionQuery(text, caret) {
  const body = typeof text === "string" ? text : "";
  const pos = Math.max(0, Math.min(Number.isFinite(caret) ? caret : 0, body.length));
  const floor = Math.max(0, pos - MENTION_SCAN_LENGTH);
  for (let i = pos - 1; i >= floor; i -= 1) {
    const ch = body[i];
    if (ch === "\n") return null;
    if (ch !== "@") continue;
    if (i > 0 && NAME_CHAR.test(body[i - 1])) return null;
    const query = body.slice(i + 1, pos);
    // Samme ord-grænse som matchNameAt: dobbelt mellemrum afslutter navnet,
    // og et navn er højst MENTION_MAX_WORDS ord langt.
    if (query.includes("  ") || query.split(" ").length > MENTION_MAX_WORDS) return null;
    if (query.length < MENTION_MIN_QUERY) return null;
    return { start: i, query };
  }
  return null;
}

/**
 * Navnene der matcher det man er ved at skrive. Præfiks-match først (det man
 * skriver er som regel starten af navnet), derefter navne hvor teksten står
 * inde i navnet — begge dele alfabetisk, så listen ikke hopper rundt mens
 * man skriver.
 */
export function filterMentionCandidates(managers, query, limit = MENTION_SUGGESTION_LIMIT) {
  const needle = normalizeMentionName(query);
  if (!needle) return [];
  const prefix = [];
  const contains = [];
  for (const manager of managers || []) {
    const name = normalizeMentionName(manager?.name);
    if (!name) continue;
    if (name.startsWith(needle)) prefix.push(manager);
    else if (name.includes(needle)) contains.push(manager);
  }
  // Kodepunkt-sammenligning, ikke localeCompare: listen skal stå i SAMME
  // rækkefølge i alle browsere og i test — en ICU-forskel må ikke kunne flytte
  // hvilket navn der er forvalgt når man trykker Enter.
  const byName = (a, b) => {
    const x = normalizeMentionName(a.name);
    const y = normalizeMentionName(b.name);
    if (x === y) return 0;
    return x < y ? -1 : 1;
  };
  return [...prefix.sort(byName), ...contains.sort(byName)].slice(0, limit);
}

/**
 * Sæt det valgte navn ind i stedet for det halvskrevne "@...".
 * Der lægges ét mellemrum efter navnet — ellers ville næste tegn man skriver
 * blive en del af navnet og ødelægge matchet ved indsendelse. Står der
 * allerede whitespace efter tagget, tilføjes der ikke et til: at rette midt i
 * en færdig sætning må ikke efterlade et dobbelt mellemrum.
 *
 * @returns {{text:string, caret:number}} den nye feltværdi + hvor caret'en skal stå.
 */
export function applyMentionSelection(text, selection, name) {
  const body = typeof text === "string" ? text : "";
  if (!selection || typeof name !== "string" || !name) return { text: body, caret: body.length };
  const caretBefore = selection.start + 1 + selection.query.length;
  const rest = body.slice(caretBefore);
  // Kun et rigtigt mellemrum tæller som "der er allerede plads": står der et
  // linjeskift, skal navnet stadig have sit eget mellemrum, ellers ville
  // caret'en hoppe ned på næste linje.
  const spaceAlreadyThere = rest.startsWith(" ");
  const inserted = spaceAlreadyThere ? `@${name}` : `@${name} `;
  return {
    text: body.slice(0, selection.start) + inserted + rest,
    // Caret'en lander EFTER mellemrummet, også når mellemrummet allerede stod
    // der — man skal kunne skrive videre uden først at flytte den.
    caret: selection.start + inserted.length + (spaceAlreadyThere ? 1 : 0),
  };
}
