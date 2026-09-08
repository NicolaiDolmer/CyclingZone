// In-app spørgeskema (#4943) — ren logik, holdt ude af SurveyPage så den kan
// unit-testes med node:test (uden React/Supabase). Samme opdeling som
// lib/roadmapVoting.js.
//
// Værdi-former pr. `kind` (det der ender i survey_responses.value som JSONB —
// analysen i docs/SURVEY_SYSTEM.md §4 læser præcis disse former):
//   scale_1_5 / scale_0_10  { score: <int> }
//   idea_importance         { ratings: { <optionKey>: { idea, importance, dont_know } } }
//                           Kun funktioner spilleren har rørt står i objektet.
//                           dont_know: true ⇒ idea og importance er null.
//   multi_max3 / multi      { selected: [<optionKey>, ...] }
//   single / yes_no         { choice: <optionKey> }   (yes_no: "yes" | "no")
//   text                    { text: <string> }
//
// Hvorfor "ved ikke" er sit eget felt og ikke bare null: null kan ikke skelnes
// fra "ikke besvaret", og hele pointen med to akser (v2-udkastets §10) er at et
// nej skal trække ned mens et "ved ikke" skal stå udenfor gennemsnittet. To
// forskellige svar må ikke gemmes ens.

export const SCALE_1_5 = [1, 2, 3, 4, 5];
export const SCALE_0_10 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export const KINDS = [
  "scale_1_5",
  "scale_0_10",
  "idea_importance",
  "multi_max3",
  "multi",
  "single",
  "text",
  "yes_no",
];

export const MULTI_MAX3_LIMIT = 3;
export const TEXT_MAX_LENGTH = 1000;

const DA = (language) => Boolean(language && String(language).startsWith("da"));

export function questionLabel(question, language) {
  return DA(language) ? question.label_da : question.label_en;
}

export function questionHelp(question, language) {
  return (DA(language) ? question.help_da : question.help_en) || null;
}

export function optionLabel(option, language) {
  return DA(language) ? option.label_da : option.label_en;
}

export function questionOptions(question) {
  return Array.isArray(question?.options) ? question.options : [];
}

export function scaleFor(kind) {
  if (kind === "scale_0_10") return SCALE_0_10;
  if (kind === "scale_1_5" || kind === "idea_importance") return SCALE_1_5;
  return [];
}

/** Sorterer spørgsmål stabilt: sort_order, derefter key (tie-break). */
export function sortQuestions(questions) {
  return [...(questions ?? [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.key).localeCompare(String(b.key))
  );
}

function validScore(scale, value) {
  return Number.isInteger(value) && scale.includes(value);
}

/**
 * Normaliserer et råt UI-svar til den JSONB-form der gemmes.
 * Returnerer null når svaret er tomt (så autosave kan springe over frem for at
 * skrive en tom række). Kaster ved ugyldige værdier — et ugyldigt svar er en
 * fejl i kaldet, ikke et tomt svar.
 */
export function normalizeAnswer(question, raw) {
  const kind = question?.kind;
  if (!KINDS.includes(kind)) throw new Error(`unknown question kind: ${kind}`);
  if (raw === null || raw === undefined) return null;

  if (kind === "scale_1_5" || kind === "scale_0_10") {
    const score = typeof raw === "object" ? raw.score : raw;
    if (score === null || score === undefined || score === "") return null;
    if (!validScore(scaleFor(kind), score)) throw new Error(`score out of range for ${kind}: ${score}`);
    return { score };
  }

  if (kind === "idea_importance") {
    const source = (typeof raw === "object" && raw !== null && raw.ratings) || raw || {};
    const allowed = new Set(questionOptions(question).map((o) => o.key));
    const ratings = {};
    for (const [optionKey, entry] of Object.entries(source)) {
      if (!allowed.has(optionKey) || !entry) continue;
      const dontKnow = Boolean(entry.dont_know);
      if (dontKnow) {
        ratings[optionKey] = { idea: null, importance: null, dont_know: true };
        continue;
      }
      const idea = entry.idea ?? null;
      const importance = entry.importance ?? null;
      if (idea === null && importance === null) continue;
      if (idea !== null && !validScore(SCALE_1_5, idea)) throw new Error(`idea out of range: ${idea}`);
      if (importance !== null && !validScore(SCALE_1_5, importance)) {
        throw new Error(`importance out of range: ${importance}`);
      }
      ratings[optionKey] = { idea, importance, dont_know: false };
    }
    return Object.keys(ratings).length ? { ratings } : null;
  }

  if (kind === "multi_max3" || kind === "multi") {
    const list = Array.isArray(raw) ? raw : Array.isArray(raw.selected) ? raw.selected : [];
    const allowed = new Set(questionOptions(question).map((o) => o.key));
    const selected = [...new Set(list.filter((key) => allowed.has(key)))];
    if (kind === "multi_max3" && selected.length > MULTI_MAX3_LIMIT) {
      throw new Error(`multi_max3 accepts at most ${MULTI_MAX3_LIMIT} options`);
    }
    return selected.length ? { selected } : null;
  }

  if (kind === "single" || kind === "yes_no") {
    const choice = typeof raw === "object" ? raw.choice : raw;
    if (!choice) return null;
    const allowed = kind === "yes_no"
      ? new Set(["yes", "no"])
      : new Set(questionOptions(question).map((o) => o.key));
    if (!allowed.has(choice)) throw new Error(`choice not in options: ${choice}`);
    return { choice };
  }

  // text
  const text = (typeof raw === "object" ? raw.text : raw) ?? "";
  const trimmed = String(text).trim().slice(0, TEXT_MAX_LENGTH);
  return trimmed ? { text: trimmed } : null;
}

/**
 * Hvor mange "trin" spørgsmålet tæller i progress-linjen. To-akse-gitteret
 * tæller én pr. funktion: 12 funktioner må ikke være 1/12 af skemaet på
 * progress-linjen når de er over halvdelen af arbejdet.
 */
export function progressUnits(question) {
  return question?.kind === "idea_importance" ? questionOptions(question).length : 1;
}

/** Hvor mange af spørgsmålets trin der er besvaret. */
export function answeredUnits(question, value) {
  if (!value) return 0;
  if (question.kind === "idea_importance") {
    const ratings = value.ratings ?? {};
    return Object.values(ratings).filter(
      (r) => r && (r.dont_know === true || (r.idea !== null && r.importance !== null))
    ).length;
  }
  return 1;
}

export function isAnswered(question, value) {
  return answeredUnits(question, value) > 0;
}

/** { answered, total, percent } — percent er heltal 0-100. */
export function computeProgress(questions, answers) {
  const list = questions ?? [];
  let total = 0;
  let answered = 0;
  for (const question of list) {
    total += progressUnits(question);
    answered += Math.min(answeredUnits(question, answers?.[question.key]), progressUnits(question));
  }
  const percent = total === 0 ? 0 : Math.round((answered / total) * 100);
  return { answered, total, percent };
}

/** Keys på de påkrævede spørgsmål der endnu ikke er besvaret. */
export function missingRequired(questions, answers) {
  return (questions ?? [])
    .filter((question) => question.required && !isAnswered(question, answers?.[question.key]))
    .map((question) => question.key);
}

export function canSubmit(questions, answers) {
  return missingRequired(questions, answers).length === 0;
}

// ── Hvilken tilstand siden skal vise ────────────────────────────────────────
// Ejeren skal kunne SE en kladde som spillerne kommer til at se den, FØR den
// åbnes (#4943). RLS lader allerede admins læse både kladde-skemaet og dets
// spørgsmål; det der manglede var en visnings-tilstand imellem "åbent" og
// "lukket".
//
//   open     spilleren kan svare og sende
//   preview  kladde set af en admin: hele formularen, men intet gemmes
//   closed   alt andet (lukket skema, og en kladde set af en ikke-admin)
//
// "closed" er default med vilje: en ukendt eller manglende status må aldrig
// åbne et skema, og en kladde må aldrig lække til en ikke-admin gennem UI'et.
// RLS beskytter uanset — det her er laget ovenpå, ikke i stedet for.
export function resolveSurveyView({ status, isAdmin } = {}) {
  if (status === "open") return "open";
  if (status === "draft" && isAdmin === true) return "preview";
  return "closed";
}

export function buildResponsePayload({ surveyId, userId, teamId = null, questionKey, value }) {
  if (!surveyId || !userId || !questionKey) {
    throw new Error("surveyId, userId and questionKey are required");
  }
  if (!value) throw new Error("value is required — an empty answer is not written");
  return {
    survey_id: surveyId,
    user_id: userId,
    team_id: teamId,
    question_key: questionKey,
    value,
    updated_at: new Date().toISOString(),
  };
}

// ── Sektioner ───────────────────────────────────────────────────────────────
// Spørgsmålene grupperes i sektioner så siden ikke er 12 kort i træk.
// Sektionen er en EGENSKAB VED NØGLEN og ikke en kolonne i databasen: et
// spørgsmål kan flyttes mellem sektioner uden en migration, og et skema med
// ukendte nøgler falder i "other" i stedet for at forsvinde fra siden.
export const SECTION_ORDER = ["today", "ideas", "problems", "choices", "pro", "closing", "other"];

const SECTION_BY_KEY = {
  satisfaction: "today",
  feature_axes: "ideas",
  works_worst: "problems",
  works_worst_detail: "problems",
  one_thing: "choices",
  play_more: "choices",
  invite_friend: "choices",
  pro_contents: "pro",
  pro_exclusions: "pro",
  pro_would_pay: "pro",
  follow_up: "closing",
};

export function sectionForQuestion(question) {
  return SECTION_BY_KEY[question?.key] ?? "other";
}

/** [{ id, questions }] i SECTION_ORDER; tomme sektioner udelades. */
export function groupQuestionsIntoSections(questions) {
  const buckets = new Map(SECTION_ORDER.map((id) => [id, []]));
  for (const question of sortQuestions(questions)) {
    buckets.get(sectionForQuestion(question)).push(question);
  }
  return SECTION_ORDER.filter((id) => buckets.get(id).length > 0).map((id) => ({
    id,
    questions: buckets.get(id),
  }));
}

// ── Dashboard-indgangen ─────────────────────────────────────────────────────
// Luk-krydset på dashboard-kortet husker i 3 dage, ikke for evigt: skemaet er
// åbent i en kort periode, og en spiller der lukkede kortet den første dag
// skal have chancen igen inden det lukker. Nøglen bærer skemaets slug, så et
// nyt skema ikke arver et gammelt luk.
export const INVITE_DISMISS_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export function inviteDismissKey(slug) {
  return `cz-dashboard-survey-dismissed:${slug}`;
}

export function inviteDismissedUntil(now = Date.now()) {
  return now + INVITE_DISMISS_DAYS * DAY_MS;
}

export function isInviteDismissed(raw, now = Date.now()) {
  const until = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(until) && until > now;
}

/** survey_responses-rækker → { [question_key]: value }. */
export function answersByQuestionKey(rows) {
  const answers = {};
  for (const row of rows ?? []) {
    if (row?.question_key) answers[row.question_key] = row.value;
  }
  return answers;
}
