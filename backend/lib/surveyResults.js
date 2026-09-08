// #4943 · Aggregering af spoergeskema-svar til admin-fladen.
//
// REN FUNKTION MED VILJE. Ruten (/api/admin/surveys/:slug/results) laeser
// raekkerne med service-klienten og kalder buildSurveyResults() paa dem. Al
// regning bor her, saa den kan testes med node:test uden Supabase — samme
// opdeling som lib/growthSnapshot.js og frontend/src/lib/survey.js.
//
// HVORFOR AGGREGERE I NODE OG IKKE I SQL: skemaet har 241 inviterede og hoejst
// nogle hundrede svar-raekker. En SQL-aggregering pr. spoergsmaalstype ville
// vaere fem forespoergsler med LATERAL-joins der skal holdes i sync med
// docs/SURVEY_SYSTEM.md §5, og segmenteringen ville gange dem op. Datamaengden
// er lille nok til at een laesning + een pass i hukommelsen er baade
// hurtigere og laesbar.
//
// VAERDI-FORMERNE der laeses her staar i docs/SURVEY_SYSTEM.md §4 og i
// frontend/src/lib/survey.js' hoved. De maa ikke drifte fra hinanden.

/** Segment-dimensioner fladen kan skifte imellem. */
export const SEGMENT_DIMENSIONS = ["division", "language", "active"];

/** Hvor mange dage uden `last_seen` foer en konto taeller som "faldet fra". */
export const ACTIVE_WINDOW_DAYS = 7;

/**
 * Under tre svar er stoej, ikke et segment (samme graense som
 * docs/SURVEY_SYSTEM.md §5.5's HAVING count(*) >= 3).
 */
export const MIN_SEGMENT_N = 3;

const UNKNOWN = "unknown";

// ── Smaa regne-hjaelpere ────────────────────────────────────────────────────
// null frem for 0 naar der ikke er noget at regne paa: "0 %" og "ingen svar
// endnu" er to forskellige udsagn, og fladen skal kunne skrive det andet.

/** Gennemsnit med 2 decimaler, eller null naar n = 0. */
export function avg2(sum, n) {
  return n > 0 ? Math.round((sum / n) * 100) / 100 : null;
}

/** Procent med 1 decimal, eller null naar naevneren er 0. */
export function pct1(num, den) {
  return den > 0 ? Math.round((num / den) * 1000) / 10 : null;
}

/**
 * Dato i dansk lokaltid som YYYY-MM-DD. Svarene falder over doegn-graenser,
 * og en bar pr. dag skal foelge ejerens kalender, ikke UTC's.
 */
export function copenhagenDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // sv-SE formaterer som YYYY-MM-DD, hvilket er praecis ISO-dagen.
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Copenhagen",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Alle dage fra `from` til `to` inklusive, saa bar-charten ikke springer dage over. */
export function dateRange(from, to) {
  if (!from || !to) return [];
  const days = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  // Guard mod en omvendt/absurd graense saa en daarlig raekke ikke kan loope evigt.
  let safety = 0;
  while (cursor <= end && safety < 400) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    safety += 1;
  }
  return days;
}

// ── Segmenter ───────────────────────────────────────────────────────────────
// Join-noeglerne staar i docs/SURVEY_SYSTEM.md §3: division haenger paa HOLDET
// (svarets egen team_id-oejebliks-kopi), sprog og aktivitet haenger paa KONTOEN
// (user_id). Et join paa bruger for division ville duplikere hvert svar een
// gang pr. hold manageren ejer.

/**
 * Segment-vaerdien for een svar-raekke.
 * @param {string} dimension division | language | active
 */
export function segmentValue(dimension, row, { teamsById = {}, usersById = {}, now = Date.now() } = {}) {
  if (dimension === "division") {
    const division = teamsById[row?.team_id]?.division;
    return division === null || division === undefined ? UNKNOWN : String(division);
  }
  if (dimension === "language") {
    const user = usersById[row?.user_id];
    const raw = user?.language || user?.browser_language;
    if (!raw) return UNKNOWN;
    return String(raw).toLowerCase().startsWith("da") ? "da" : "en";
  }
  if (dimension === "active") {
    const lastSeen = usersById[row?.user_id]?.last_seen;
    if (!lastSeen) return UNKNOWN;
    const seen = new Date(lastSeen).getTime();
    if (Number.isNaN(seen)) return UNKNOWN;
    const ageDays = (now - seen) / 86400000;
    return ageDays <= ACTIVE_WINDOW_DAYS ? "active" : "lapsed";
  }
  return UNKNOWN;
}

// ── Spoergsmaals-aggregater ─────────────────────────────────────────────────

function optionsOf(question) {
  if (Array.isArray(question?.options) && question.options.length) return question.options;
  // yes_no seedes uden options; de to valg er faste (survey.js' normalizeAnswer).
  if (question?.kind === "yes_no") {
    return [
      { key: "yes", label_en: "Yes", label_da: "Ja" },
      { key: "no", label_en: "No", label_da: "Nej" },
    ];
  }
  return [];
}

function scaleValues(kind) {
  return kind === "scale_0_10" ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [1, 2, 3, 4, 5];
}

function aggregateScale(question, rows, segmentFor) {
  const values = scaleValues(question.kind);
  const counts = new Map(values.map((v) => [v, 0]));
  const perSegment = new Map();
  let n = 0;
  let sum = 0;

  for (const row of rows) {
    const score = row?.value?.score;
    if (!Number.isInteger(score) || !counts.has(score)) continue;
    counts.set(score, counts.get(score) + 1);
    n += 1;
    sum += score;
    if (segmentFor) {
      const key = segmentFor(row);
      const bucket = perSegment.get(key) || { segment: key, n: 0, sum: 0 };
      bucket.n += 1;
      bucket.sum += score;
      perSegment.set(key, bucket);
    }
  }

  return {
    n,
    avg: avg2(sum, n),
    distribution: values.map((value) => ({
      value,
      count: counts.get(value),
      pct: pct1(counts.get(value), n),
    })),
    bySegment: segmentFor ? sortSegments([...perSegment.values()].map((b) => ({
      segment: b.segment,
      n: b.n,
      avg: avg2(b.sum, b.n),
    }))) : null,
  };
}

function aggregateChoice(question, rows, segmentFor) {
  const options = optionsOf(question);
  const allowed = new Map(options.map((o) => [o.key, o]));
  const counts = new Map(options.map((o) => [o.key, 0]));
  const perSegment = new Map();
  const orphanKeys = new Set();
  let n = 0;

  for (const row of rows) {
    const choice = row?.value?.choice;
    if (!choice) continue;
    if (!allowed.has(choice)) { orphanKeys.add(choice); continue; }
    counts.set(choice, counts.get(choice) + 1);
    n += 1;
    if (segmentFor) {
      const key = segmentFor(row);
      const bucket = perSegment.get(key) || { segment: key, n: 0, counts: {} };
      bucket.n += 1;
      bucket.counts[choice] = (bucket.counts[choice] || 0) + 1;
      perSegment.set(key, bucket);
    }
  }

  return {
    n,
    orphanKeys: [...orphanKeys],
    options: options.map((option) => ({
      key: option.key,
      label_en: option.label_en,
      label_da: option.label_da,
      count: counts.get(option.key),
      pct: pct1(counts.get(option.key), n),
    })),
    bySegment: segmentFor ? sortSegments([...perSegment.values()]) : null,
  };
}

function aggregateMulti(question, rows) {
  const options = optionsOf(question);
  const allowed = new Map(options.map((o) => [o.key, o]));
  const counts = new Map(options.map((o) => [o.key, 0]));
  const orphanKeys = new Set();
  let n = 0;
  let picks = 0;

  for (const row of rows) {
    const selected = Array.isArray(row?.value?.selected) ? row.value.selected : null;
    if (!selected || selected.length === 0) continue;
    n += 1;
    // Et dobbelt valg i samme raekke maa ikke taelle to gange.
    for (const key of new Set(selected)) {
      if (!allowed.has(key)) { orphanKeys.add(key); continue; }
      counts.set(key, counts.get(key) + 1);
      picks += 1;
    }
  }

  const list = options.map((option) => ({
    key: option.key,
    label_en: option.label_en,
    label_da: option.label_da,
    count: counts.get(option.key),
    // Andel af DEM DER SVAREDE, ikke af alle kryds: spoergsmaalet er
    // "hvor mange naevnte det", og et flervalg summer over 100 %.
    pct: pct1(counts.get(option.key), n),
  }));
  // Stabil sortering: flest foerst, derefter alfabetisk paa noeglen.
  list.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  return { n, picks, orphanKeys: [...orphanKeys], options: list };
}

function aggregateIdeaImportance(question, rows, segmentFor) {
  const options = optionsOf(question);
  const allowed = new Map(options.map((o) => [o.key, o]));
  const stats = new Map(
    options.map((o) => [o.key, { rated: 0, dontKnow: 0, ideaSum: 0, importanceSum: 0, veto: 0 }])
  );
  const perSegment = new Map();
  const orphanKeys = new Set();
  let answerers = 0;

  for (const row of rows) {
    const ratings = row?.value?.ratings;
    if (!ratings || typeof ratings !== "object") continue;
    let touched = false;
    const segment = segmentFor ? segmentFor(row) : null;

    for (const [key, entry] of Object.entries(ratings)) {
      if (!allowed.has(key)) { orphanKeys.add(key); continue; }
      if (!entry) continue;
      const bucket = stats.get(key);
      if (entry.dont_know === true) {
        bucket.dontKnow += 1;
        touched = true;
        continue;
      }
      const idea = entry.idea;
      const importance = entry.importance;
      // Kun fuldt besvarede raekker taeller i gennemsnittene: en halv raekke
      // (kun idé, ingen vigtighed) ville trække de to akser skaevt fra hinanden.
      if (!Number.isInteger(idea) || !Number.isInteger(importance)) continue;
      bucket.rated += 1;
      bucket.ideaSum += idea;
      bucket.importanceSum += importance;
      if (idea <= 2) bucket.veto += 1;
      touched = true;

      if (segment) {
        const segBucket = perSegment.get(segment) || new Map();
        const optBucket = segBucket.get(key) || { key, n: 0, ideaSum: 0, importanceSum: 0 };
        optBucket.n += 1;
        optBucket.ideaSum += idea;
        optBucket.importanceSum += importance;
        segBucket.set(key, optBucket);
        perSegment.set(segment, segBucket);
      }
    }
    if (touched) answerers += 1;
  }

  const list = options.map((option) => {
    const bucket = stats.get(option.key);
    const avgIdea = avg2(bucket.ideaSum, bucket.rated);
    const avgImportance = avg2(bucket.importanceSum, bucket.rated);
    return {
      key: option.key,
      group_en: option.group_en ?? null,
      group_da: option.group_da ?? null,
      label_en: option.label_en,
      label_da: option.label_da,
      n: bucket.rated,
      dontKnow: bucket.dontKnow,
      dontKnowPct: pct1(bucket.dontKnow, bucket.rated + bucket.dontKnow),
      avgIdea,
      avgImportance,
      // Prioritetsscoren: idé x vigtigt (0-25). Produktet frem for summen,
      // fordi en idé der er god MEN ligegyldig, og en der er vigtig MEN
      // daarlig, begge skal falde — summen ville lade den ene baere den anden.
      priority: avgIdea === null || avgImportance === null
        ? null
        : Math.round(avgIdea * avgImportance * 100) / 100,
      // Andelen der gav 1 eller 2 paa idé-aksen. Over 25 % er funktionen
      // omstridt uanset hvor paent gennemsnittet ser ud (SURVEY_SYSTEM §5.2).
      vetoPct: pct1(bucket.veto, bucket.rated),
    };
  });

  const ranked = [...list].sort(
    (a, b) => (b.priority ?? -1) - (a.priority ?? -1) || b.n - a.n || a.key.localeCompare(b.key)
  );
  ranked.forEach((entry, index) => { entry.rank = entry.priority === null ? null : index + 1; });

  const bySegment = segmentFor
    ? sortSegments([...perSegment.entries()].map(([segment, optionMap]) => ({
      segment,
      options: [...optionMap.values()]
        .map((o) => {
          const avgIdea = avg2(o.ideaSum, o.n);
          const avgImportance = avg2(o.importanceSum, o.n);
          return {
            key: o.key,
            n: o.n,
            avgIdea,
            avgImportance,
            priority: avgIdea === null || avgImportance === null
              ? null
              : Math.round(avgIdea * avgImportance * 100) / 100,
          };
        })
        .filter((o) => o.n >= MIN_SEGMENT_N)
        .sort((a, b) => (b.priority ?? -1) - (a.priority ?? -1) || a.key.localeCompare(b.key)),
      n: [...optionMap.values()].reduce((max, o) => Math.max(max, o.n), 0),
    })))
    : null;

  return { n: answerers, orphanKeys: [...orphanKeys], options: list, bySegment };
}

function aggregateText(question, rows, context) {
  const answers = rows
    .map((row) => {
      const text = row?.value?.text;
      if (typeof text !== "string" || !text.trim()) return null;
      const team = context.teamsById[row.team_id];
      return {
        text: text.trim(),
        at: row.updated_at || row.created_at || null,
        // Kontekst en admin faktisk bruger til at vaegte svaret. Ingen email,
        // ingen brugernavn: holdnavnet er nok til at genkende en manager, og
        // rapporten skal kunne deles paa et screenshot.
        teamName: team?.name ?? null,
        division: team?.division ?? null,
        language: segmentValue("language", row, context),
        active: segmentValue("active", row, context),
      };
    })
    .filter(Boolean);

  // Nyeste foerst; raekker uden tidsstempel til sidst.
  answers.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  return { n: answers.length, answers };
}

/** Segment-buckets i en fast, laesbar raekkefoelge: kendte foerst, `unknown` sidst. */
function sortSegments(buckets) {
  return [...buckets].sort((a, b) => {
    if (a.segment === UNKNOWN) return 1;
    if (b.segment === UNKNOWN) return -1;
    return String(a.segment).localeCompare(String(b.segment), "en", { numeric: true });
  });
}

// ── Hoved-funktionen ────────────────────────────────────────────────────────

/**
 * Bygger hele resultat-payloaden.
 *
 * @param {object} input
 * @param {object} input.survey        surveys-raekken
 * @param {object[]} input.questions   survey_questions (sorteres her)
 * @param {object[]} input.responses   survey_responses for skemaet
 * @param {object[]} input.completions survey_completions for skemaet
 * @param {number} input.invitedCount  antal udsendte invitationer
 * @param {object} input.teamsById     { [team_id]: { division, name } }
 * @param {object} input.usersById     { [user_id]: { language, browser_language, last_seen } }
 * @param {string|null} input.segment  division | language | active | null
 * @param {number} input.now           epoch-ms (injiceres i tests)
 */
export function buildSurveyResults({
  survey,
  questions = [],
  responses = [],
  completions = [],
  invitedCount = 0,
  teamsById = {},
  usersById = {},
  segment = null,
  now = Date.now(),
} = {}) {
  const dimension = SEGMENT_DIMENSIONS.includes(segment) ? segment : null;
  const context = { teamsById, usersById, now };
  const segmentFor = dimension ? (row) => segmentValue(dimension, row, context) : null;

  const sorted = [...questions].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.key).localeCompare(String(b.key))
  );

  const byQuestion = new Map(sorted.map((q) => [q.key, []]));
  const firstSeenByUser = new Map();
  const startedUsers = new Set();
  for (const row of responses) {
    if (!row?.question_key) continue;
    startedUsers.add(row.user_id);
    const stamp = row.created_at || row.updated_at;
    const day = copenhagenDate(stamp);
    if (day) {
      const prev = firstSeenByUser.get(row.user_id);
      if (!prev || day < prev) firstSeenByUser.set(row.user_id, day);
    }
    // Svar paa noegler skemaet ikke laengere kender skal ikke tabes tavst;
    // de dukker op i orphanQuestionKeys nedenfor.
    if (byQuestion.has(row.question_key)) byQuestion.get(row.question_key).push(row);
  }

  const orphanQuestionKeys = [
    ...new Set(responses.map((r) => r?.question_key).filter((k) => k && !byQuestion.has(k))),
  ];

  const startedCount = startedUsers.size;
  const completedCount = completions.length;
  const secondsRows = completions.filter((c) => Number.isFinite(c?.seconds_spent));
  const secondsSum = secondsRows.reduce((sum, c) => sum + c.seconds_spent, 0);

  // Tidslinjen: en manager taelles paa den dag han BEGYNDTE, og gennemfoerelsen
  // paa den dag den blev sendt. De to kurver er ikke den samme kohorte, og det
  // er meningen: afstanden mellem dem er dem der faldt fra undervejs.
  const startDays = new Map();
  for (const day of firstSeenByUser.values()) startDays.set(day, (startDays.get(day) || 0) + 1);
  const completedDays = new Map();
  for (const completion of completions) {
    const day = copenhagenDate(completion?.completed_at);
    if (day) completedDays.set(day, (completedDays.get(day) || 0) + 1);
  }
  const allDays = [...new Set([...startDays.keys(), ...completedDays.keys()])].sort();
  const timeline = dateRange(allDays[0], allDays[allDays.length - 1]).map((date) => ({
    date,
    started: startDays.get(date) || 0,
    completed: completedDays.get(date) || 0,
  }));

  // Segment-oversigten taeller BRUGERE, ikke svar-raekker: 12 raekker fra een
  // manager er een besvarelse i division 2, ikke tolv.
  let segmentValues = null;
  if (dimension) {
    const usersBySegment = new Map();
    for (const row of responses) {
      const key = segmentFor(row);
      const set = usersBySegment.get(key) || new Set();
      set.add(row.user_id);
      usersBySegment.set(key, set);
    }
    segmentValues = sortSegments(
      [...usersBySegment.entries()].map(([value, users]) => ({ segment: value, started: users.size }))
    );
  }

  const questionResults = sorted.map((question) => {
    const rows = byQuestion.get(question.key) || [];
    const base = {
      key: question.key,
      kind: question.kind,
      sort_order: question.sort_order ?? 0,
      label_en: question.label_en,
      label_da: question.label_da,
      required: Boolean(question.required),
    };
    switch (question.kind) {
      case "scale_1_5":
      case "scale_0_10":
        return { ...base, ...aggregateScale(question, rows, segmentFor) };
      case "single":
      case "yes_no":
        return { ...base, ...aggregateChoice(question, rows, segmentFor) };
      case "multi":
      case "multi_max3":
        return { ...base, ...aggregateMulti(question, rows) };
      case "idea_importance":
        return { ...base, ...aggregateIdeaImportance(question, rows, segmentFor) };
      case "text":
        return { ...base, ...aggregateText(question, rows, context) };
      default:
        return { ...base, n: rows.length, unsupported: true };
    }
  });

  return {
    survey: survey
      ? {
        slug: survey.slug,
        title_en: survey.title_en,
        title_da: survey.title_da,
        status: survey.status,
        opens_at: survey.opens_at ?? null,
        closes_at: survey.closes_at ?? null,
      }
      : null,
    segment: dimension,
    segmentValues,
    totals: {
      invited: invitedCount,
      started: startedCount,
      completed: completedCount,
      // To procenter, ikke een: "hvor mange aabnede skemaet" og "hvor mange
      // blev faerdige" er to forskellige spoergsmaal, og forskellen mellem dem
      // er selve frafaldet.
      startedPct: pct1(startedCount, invitedCount),
      completedPct: pct1(completedCount, invitedCount),
      finishPct: pct1(completedCount, startedCount),
      avgMinutes: secondsRows.length ? Math.round((secondsSum / secondsRows.length / 60) * 10) / 10 : null,
    },
    timeline,
    questions: questionResults,
    orphanQuestionKeys,
  };
}
