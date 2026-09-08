// #5011 (ejer-direktiv 3/9, #4751) — @-tag af en manager i forummet.
//
// Udtrækket bor HER, i backend, og kaldes fra POST /api/forum/posts og
// POST /api/forum/posts/:id/replies. Klienten bestemmer ALDRIG hvem der bliver
// tagget: den sender kun teksten, og serveren afgør hvilke managernavne der
// står i den. En klient-side parser ville være en fri kanal til at sende
// notifikationer til vilkårlige brugere.
//
// MATCH-REGLER (låst i #5011):
//   · case-insensitivt
//   · HELE navne — "@Nico" rammer aldrig manageren "Nicolai"
//   · navne med mellemrum understøttes (op til MENTION_MAX_WORDS ord); det
//     LÆNGSTE match vinder, så "@Team Sky" ikke stopper ved "Team"
//   · tegnsætning efter navnet ignoreres ("@Nicolai," og "@Nicolai." rammer),
//     men et navn der SELV ender på tegnsætning ("J.R.") prøves også råt
//   · '@' skal stå efter noget der ikke er bogstav/tal/underscore, så
//     e-mails ("nicolai@dolmer") aldrig bliver til et tag
//   · aldrig hen over et linjeskift
//
// Selve PARSEREN er bevidst uden dependencies (ingen Supabase-klient, ingen
// Sentry) af to grunde: den kan køres direkte under `node --test`, og frontendens
// render-kopi (frontend/src/lib/forumMentions.js) skal opføre sig præcis
// ens — paritet håndhæves af forumMentions.parity.test.js, så en regel der
// kun rettes ét af stederne fejler i test i stedet for tavst i prod.
//
// Importen nedenfor bruges KUN af loadMentionableManagers (nederst), aldrig af
// parser-blokken — derfor står den uden for den delte blok.
import { SUPABASE_IN_CHUNK_SIZE, fetchAllRows } from "./supabasePagination.js";

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

/**
 * De managere der faktisk skal have en notifikation: én pr. bruger (to tags af
 * samme person i samme indlæg = én besked) og aldrig skribenten selv.
 */
export function uniqueMentionTargets(matches, { excludeUserId = null } = {}) {
  const seen = new Set();
  const targets = [];
  for (const match of matches) {
    const manager = match.manager || match;
    if (!manager?.userId) continue;
    if (manager.userId === excludeUserId) continue;
    if (seen.has(manager.userId)) continue;
    seen.add(manager.userId);
    targets.push(manager);
  }
  return targets;
}

/**
 * Alle taggbare managere: menneskestyrede hold med et brugernavn.
 * Kun `username` + `team_id` forlader denne funktion — begge dele står
 * allerede på hvert eneste forum-indlæg (ForumAuthorIdentity, #4751), så
 * listen tilføjer ingen ny eksponering.
 *
 * PAGINERING ER IKKE VALGFRI HER (#3331, CodeRabbit 8/9). `teams` rummer også
 * ALLE AI-holdene, altså langt over PostgRESTs 1000-rækkers cap. Et enkelt
 * select uden `.range()` ville derfor tavst returnere de første 1000 rækker og
 * tabe managere fra listen — og en tabt manager er ikke en kosmetisk fejl: hans
 * navn ville stå ulinket i teksten OG han ville aldrig få sin notifikation.
 * Derfor både server-side-filtrering (så kun menneskehold hentes) og
 * fetchAllRows (så resten aldrig kan blive kappet).
 */
export async function loadMentionableManagers({ supabase }) {
  let teamRows;
  try {
    teamRows = await fetchAllRows(() => supabase
      .from("teams")
      .select("id, user_id, is_ai, is_bank")
      .eq("is_ai", false)
      .eq("is_bank", false)
      .not("user_id", "is", null)
      // Stabil sortering er et KRAV for sidedeling (se supabasePagination.js).
      .order("id", { ascending: true }));
  } catch (e) {
    throw new Error(`forum: could not load mentionable teams: ${e?.message || e}`, { cause: e });
  }

  // Samme filter igen i JS: server-side-filteret er optimeringen, denne er
  // garantien. De to må aldrig kunne komme til at sige noget forskelligt om
  // hvem der er en rigtig manager.
  const teams = (teamRows || []).filter((t) => t?.user_id && !t.is_ai && !t.is_bank);
  if (teams.length === 0) return [];

  const userIds = [...new Set(teams.map((t) => t.user_id))];
  const userRows = [];
  try {
    // .in() med mange id'er sprænger både URL-længden og 1000-rækkers-cappen —
    // derfor chunkes den på den kanoniske størrelse.
    for (let i = 0; i < userIds.length; i += SUPABASE_IN_CHUNK_SIZE) {
      const chunk = userIds.slice(i, i + SUPABASE_IN_CHUNK_SIZE);
      const page = await fetchAllRows(() => supabase
        .from("users")
        .select("id, username")
        .in("id", chunk)
        .order("id", { ascending: true }));
      userRows.push(...page);
    }
  } catch (e) {
    throw new Error(`forum: could not load mentionable managers: ${e?.message || e}`, { cause: e });
  }

  const nameByUser = new Map(userRows.map((u) => [u.id, u.username]));
  const managers = [];
  const seenUsers = new Set();
  for (const team of teams) {
    const name = nameByUser.get(team.user_id);
    if (!name || seenUsers.has(team.user_id)) continue;
    seenUsers.add(team.user_id);
    managers.push({ userId: team.user_id, teamId: team.id, name });
  }
  // Stabil, forudsigelig rækkefølge for autocomplete-listen.
  return managers.sort((a, b) => normalizeMentionName(a.name).localeCompare(normalizeMentionName(b.name)));
}
