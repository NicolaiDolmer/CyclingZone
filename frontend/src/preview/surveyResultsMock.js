// #4943 · Preview-/e2e-seed for admin-fladen med spørgeskema-resultater.
//
// Payloaden bygges ud fra SEED_SURVEY_QUESTIONS (samme kilde som spillersidens
// mock) frem for at være skrevet af i hånden: tallene kan så aldrig komme til
// at handle om andre spørgsmål eller andre idéer end dem skemaet faktisk har.
// Vi rammer det aggregerede svar fra GET /api/admin/surveys/:slug/results —
// formen er kontrakten, og den står i backend/lib/surveyResults.js.
//
// Tallene er DETERMINISTISKE (FNV-hash af option-nøglen), ikke tilfældige:
// et visuelt snapshot må ikke skifte fra kørsel til kørsel, og et e2e-tjek af
// "tabellen er sorteret efter prioritet" skal kunne skrive rækkefølgen ned.

import { SEED_SURVEY, SEED_SURVEY_QUESTIONS } from "./surveyMock.js";

const INVITED = 240;
const STARTED = 96;
const COMPLETED = 71;

/** FNV-1a → [0,1). Stabil på tværs af kørsler og maskiner. */
function unit(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

const round2 = (value) => Math.round(value * 100) / 100;
const pct1 = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

/** 1-5 med to decimaler, spredt så rangeringen er tydelig men ikke ekstrem. */
function scoreFor(seed) {
  return round2(1.9 + unit(seed) * 2.9);
}

function buildScale(question, segment) {
  const values = [1, 2, 3, 4, 5];
  const weights = values.map((value) => 1 + unit(`${question.key}-${value}`) * (value >= 3 ? 6 : 2));
  const total = weights.reduce((sum, w) => sum + w, 0);
  const counts = weights.map((w) => Math.max(1, Math.round((w / total) * STARTED)));
  const n = counts.reduce((sum, c) => sum + c, 0);
  const avg = round2(counts.reduce((sum, c, i) => sum + c * values[i], 0) / n);
  return {
    n,
    avg,
    distribution: values.map((value, i) => ({ value, count: counts[i], pct: pct1(counts[i], n) })),
    bySegment: segment
      ? segmentKeys(segment).map((key, i) => ({
        segment: key,
        n: Math.max(3, Math.round(n / (segmentKeys(segment).length + i))),
        avg: round2(2.6 + unit(`${question.key}-${segment}-${key}`) * 1.9),
      }))
      : null,
  };
}

function buildChoice(question, segment) {
  const options = question.options ?? [
    { key: "yes", label_en: "Yes", label_da: "Ja" },
    { key: "no", label_en: "No", label_da: "Nej" },
  ];
  const weights = options.map((option) => 1 + unit(`${question.key}-${option.key}`) * 5);
  const total = weights.reduce((sum, w) => sum + w, 0);
  const counts = weights.map((w) => Math.max(1, Math.round((w / total) * COMPLETED)));
  const n = counts.reduce((sum, c) => sum + c, 0);
  return {
    n,
    orphanKeys: [],
    options: options.map((option, i) => ({
      key: option.key,
      label_en: option.label_en,
      label_da: option.label_da,
      count: counts[i],
      pct: pct1(counts[i], n),
    })),
    bySegment: segment
      ? segmentKeys(segment).map((key) => ({
        segment: key,
        n: Math.max(3, Math.round(n / segmentKeys(segment).length)),
        counts: Object.fromEntries(options.map((option) => [
          option.key,
          Math.max(0, Math.round(unit(`${question.key}-${segment}-${key}-${option.key}`) * 9)),
        ])),
      }))
      : null,
  };
}

function buildMulti(question) {
  const options = question.options ?? [];
  const n = Math.round(STARTED * 0.86);
  const list = options.map((option) => {
    const count = Math.round(unit(`${question.key}-${option.key}`) * n * 0.55);
    return {
      key: option.key,
      label_en: option.label_en,
      label_da: option.label_da,
      count,
      pct: pct1(count, n),
    };
  });
  list.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return { n, picks: list.reduce((sum, o) => sum + o.count, 0), orphanKeys: [], options: list };
}

function buildIdeas(question, segment) {
  const options = (question.options ?? []).map((option) => {
    const avgIdea = scoreFor(`idea-${option.key}`);
    const avgImportance = scoreFor(`imp-${option.key}`);
    const dontKnow = Math.round(unit(`dk-${option.key}`) * 14);
    const rated = Math.round(STARTED * 0.78) - dontKnow;
    return {
      key: option.key,
      group_en: option.group_en ?? null,
      group_da: option.group_da ?? null,
      label_en: option.label_en,
      label_da: option.label_da,
      n: rated,
      dontKnow,
      dontKnowPct: pct1(dontKnow, rated + dontKnow),
      avgIdea,
      avgImportance,
      priority: round2(avgIdea * avgImportance),
      vetoPct: Math.round(unit(`veto-${option.key}`) * 340) / 10,
    };
  });
  [...options]
    .sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key))
    .forEach((option, index) => { option.rank = index + 1; });

  return {
    n: Math.round(STARTED * 0.78),
    orphanKeys: [],
    options,
    bySegment: segment
      ? segmentKeys(segment).map((key) => ({
        segment: key,
        n: Math.max(3, Math.round(STARTED / segmentKeys(segment).length)),
        options: options
          .map((option) => ({
            key: option.key,
            n: Math.max(3, Math.round(unit(`${segment}-${key}-${option.key}`) * 22) + 3),
            avgIdea: scoreFor(`${segment}-${key}-idea-${option.key}`),
            avgImportance: scoreFor(`${segment}-${key}-imp-${option.key}`),
          }))
          .map((option) => ({ ...option, priority: round2(option.avgIdea * option.avgImportance) }))
          .sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key)),
      }))
      : null,
  };
}

// Fritekst: korte, konkrete svar i begge sprog, så listen kan læses på et
// screenshot uden at være lorem ipsum. Ingen rigtige spillere er citeret.
const TEXT_SEEDS = {
  works_worst_detail: [
    ["Bjergholdet", 2, "da", "Løbene kører færdigt før jeg når at se dem. Jeg vil kunne følge en etape mens den kører."],
    ["Aquila Racing", 1, "en", "Auction timers overlap with the stage results, so I miss both."],
    ["Cobble Crew", 3, "da", "På telefonen skal jeg scrolle langt til højre for at se rytternes tal."],
  ],
  one_thing: [
    ["Aquila Racing", 1, "en", "Live races. Everything else can wait a season."],
    ["Bjergholdet", 2, "da", "Træningsprogrammer jeg kan genbruge i stedet for at sætte den samme uge op hver gang."],
    ["Nordlys CT", 4, "da", "U23-hold med egne løb."],
    ["Cobble Crew", 3, "en", "A dashboard that tells me what needs my attention today."],
  ],
  play_more: [
    ["Nordlys CT", 4, "da", "Flere løb pr. dag i de lave divisioner. Lige nu er der for lidt at lave."],
    ["Aquila Racing", 1, "en", "Something to do between the stages."],
  ],
  pro_exclusions: [
    ["Bjergholdet", 2, "da", "Intet der giver sportslig fordel. Scouting hører ikke hjemme i Pro."],
    ["Cobble Crew", 3, "en", "Keep results and training out of it. Cosmetics and stats are fine."],
  ],
};

function buildText(question) {
  const seeds = TEXT_SEEDS[question.key] ?? [];
  const answers = seeds.map(([teamName, division, language, text], index) => ({
    text,
    at: `2026-09-${String(9 + (index % 2)).padStart(2, "0")}T${String(9 + index).padStart(2, "0")}:24:00Z`,
    teamName,
    division,
    language,
    active: index % 3 === 0 ? "lapsed" : "active",
  }));
  answers.sort((a, b) => new Date(b.at) - new Date(a.at));
  return { n: answers.length, answers };
}

function segmentKeys(segment) {
  if (segment === "division") return ["1", "2", "3", "4"];
  if (segment === "language") return ["da", "en"];
  return ["active", "lapsed"];
}

/** Hele payloaden, som endpointet ville have svaret. */
export function buildMockSurveyResults(segment = null) {
  const dimension = ["division", "language", "active"].includes(segment) ? segment : null;

  const questions = SEED_SURVEY_QUESTIONS.map((question) => {
    const base = {
      key: question.key,
      kind: question.kind,
      sort_order: question.sort_order,
      label_en: question.label_en,
      label_da: question.label_da,
      required: Boolean(question.required),
    };
    switch (question.kind) {
      case "scale_1_5":
      case "scale_0_10":
        return { ...base, ...buildScale(question, dimension) };
      case "single":
      case "yes_no":
        return { ...base, ...buildChoice(question, dimension) };
      case "multi":
      case "multi_max3":
        return { ...base, ...buildMulti(question) };
      case "idea_importance":
        return { ...base, ...buildIdeas(question, dimension) };
      default:
        return { ...base, ...buildText(question) };
    }
  });

  return {
    survey: {
      slug: SEED_SURVEY.slug,
      title_en: SEED_SURVEY.title_en,
      title_da: SEED_SURVEY.title_da,
      status: "open",
      opens_at: SEED_SURVEY.opens_at,
      closes_at: null,
    },
    segment: dimension,
    segmentValues: dimension
      ? segmentKeys(dimension).map((key, i) => ({
        segment: key,
        started: Math.max(4, Math.round(STARTED / (segmentKeys(dimension).length + i))),
      }))
      : null,
    totals: {
      invited: INVITED,
      started: STARTED,
      completed: COMPLETED,
      startedPct: pct1(STARTED, INVITED),
      completedPct: pct1(COMPLETED, INVITED),
      finishPct: pct1(COMPLETED, STARTED),
      avgMinutes: 6.4,
    },
    timeline: [
      { date: "2026-09-08", started: 41, completed: 28 },
      { date: "2026-09-09", started: 33, completed: 27 },
      { date: "2026-09-10", started: 14, completed: 11 },
      { date: "2026-09-11", started: 8, completed: 5 },
    ],
    questions,
    orphanQuestionKeys: [],
  };
}

/**
 * Overlejrer resultat-endpointet på en Playwright-side. Registreres EFTER
 * installNetworkMocks, så denne route vinder (Playwright matcher LIFO).
 * `isAdmin: false` gør ikke-admin-redirecten testbar uden et prod-login.
 */
export async function installSurveyResultsRoutes(page, { isAdmin = true } = {}) {
  const json = (data, status = 200) => ({
    status, contentType: "application/json", body: JSON.stringify(data),
  });

  await page.route(/\/rest\/v1\/users/, (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, body: "" });
    if (request.method() !== "GET") return route.fulfill(json({}));
    return route.fulfill(json({
      id: "00000000-0000-4000-8000-000000000001",
      role: isAdmin ? "admin" : "manager",
      username: "Playwright Admin",
      language: "da",
    }));
  });

  await page.route(/\/api\/admin\/surveys\/[^/]+\/results/, (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, body: "" });
    if (!isAdmin) return route.fulfill(json({ error: "Admin only" }, 403));
    const segment = new URL(request.url()).searchParams.get("segment");
    return route.fulfill(json(buildMockSurveyResults(segment)));
  });
}
