/**
 * Svartids-loft for de ti vigtigste handlinger (#8101)
 * =====================================================
 * Ejeren godkendte 13/11 listen over de ti handlinger og "mulighed A": serveren
 * måler selv, alarmen går til den eksisterende drifts-kanal, ingen ny tjeneste.
 *
 * Tre dele, alle i denne fil:
 *   1. MÅLING (pr. request, i hukommelsen): `createActionTimingMiddleware`
 *      matcher metode + sti mod de ti handlingers ruter og noterer varigheden
 *      når svaret er sendt (`res.on("finish")`). Intet databasekald, intet
 *      ekstra arbejde for ruter uden for listen, og ingen ændring i svaret.
 *      Måleren må aldrig kunne vælte et kald: alt er pakket i try/catch.
 *   2. OPGØRELSE (hvert kvarter, fra cron.js): `runActionTimingFlush` tømmer
 *      hukommelsen og skriver én række pr. handling pr. kvarter i
 *      `action_timing_windows` (database/2026-11-13-8101-action-timing.sql).
 *      Lederen læser hele døgnet med én SELECT:
 *        select * from public.action_timing_summary(24);
 *   3. ALARM (samme tick): en handling der bryder kvarter- ELLER time-reglen,
 *      giver én besked til Discord-ops. Dubletspærren (opsAlertDedupe.js) gør,
 *      at hver handling højst giver ÉN besked pr. alarmvindue, uanset hvilken
 *      af de to regler der fyrede. Handlinger på listen over KENDTE brud
 *      (KNOWN_BREACHES) måles og gemmes som alle andre, men giver i stedet højst
 *      ÉN samlet påmindelse i døgnet ("stadig over loftet: ...").
 *
 * Hvorfor reglerne ser ud som de gør (kvalitativt; tallene står i #8101):
 *   - Sjældne handlinger (Træn nu, Opret hold) bruges få gange om dagen, og hvert
 *     tryk er en spiller der venter. Ét langsomt kald er nok.
 *   - De hyppige handlinger har i dag enkelte spredte kald over 3 s. Kvarter-
 *     reglen kræver både et minimum af langsomme kald og en andel over dagens
 *     udgangspunkt, så den ikke hyler fra dag ét, men fyrer når det bliver værre.
 *   - Time-reglen (designet i #8101: over 20 % af kaldene den seneste time, mindst
 *     5 kald) fanger langsomhed der er spredt jævnt ud, så intet enkelt kvarter
 *     når minimum på 3 langsomme kald.
 *   - "Opret hold" og "gem holdprofil" deler ruten PUT /api/teams/my. Ruten
 *     markerer selv en rigtig oprettelse (`markActionTiming`), så kun den tæller
 *     som Opret hold; profil-gem måles under en egen nøgle uden alarm.
 *   - Hængende forbindelser (meget lange kald) er en anden fejl end langsom kode
 *     (#8101-noten). De tælles for sig og udløser ikke 3-sekunders-alarmen.
 *   - 5xx-svar springes over (Sentry fanger dem), og de første minutter efter
 *     en deploy springes over (kold start).
 */

import { buildAlertSignature, shouldAlertOnChange } from "./opsAlertDedupe.js";

export const ACTION_TIMING_TABLE = "action_timing_windows";
export const SLOW_MS = 3000;
export const HUNG_MS = 60_000;
export const FLUSH_INTERVAL_MS = 15 * 60 * 1000;
export const ALERT_WINDOW_MS = 6 * 60 * 60 * 1000;
export const WARMUP_MS = 2 * 60 * 1000;
export const MIN_SLOW_CALLS = 3;
export const MAX_SLOW_SHARE = 0.1;
// Time-reglen fra designet i #8101: over 20 % af kaldene den seneste time, kun
// når der var mindst 5 kald.
export const HOUR_WINDOW_MS = 60 * 60 * 1000;
export const HOUR_MIN_CALLS = 5;
export const HOUR_MAX_SLOW_SHARE = 0.2;
// Kendte brud giver højst én samlet påmindelse pr. fast UTC-døgn.
export const KNOWN_BREACH_REMINDER_MS = 24 * 60 * 60 * 1000;
export const RETENTION_DAYS = 35;
// Øvre grænse (ms) for hver histogram-spand; sidste spand er "over den sidste".
// SKAL matche bounds-arrayet i database/2026-11-13-8101-action-timing.sql (testet).
export const BUCKET_BOUNDS_MS = [
  250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 15000, 20000, 30000, 60000,
];
const MAX_SAMPLES_PER_WINDOW = 20_000;
const ALERT_KEY_PREFIX = "action-timing-8101";

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const SEG = "[^/]+";

/**
 * De ti ejer-godkendte handlinger (#8101, 13/11). Rækkefølgen er ejerens liste.
 * `rare: true` = sjælden handling, hvor ét langsomt kald er nok til alarm.
 */
export const ACTIONS = [
  { key: "train_now", label: "Træn nu", rare: true, routes: [["POST", "/api/training/train-now"]] },
  { key: "training_open", label: "Åbn Træning", routes: [["GET", "/api/training/me"]] },
  { key: "race_selection_open", label: "Åbn løbets udtagelse", routes: [["GET", `/api/races/${SEG}/selection`]] },
  { key: "race_selection_save", label: "Gem udtagelse", routes: [["PUT", `/api/races/${SEG}/selection`]] },
  {
    key: "tactics_save",
    label: "Gem taktik",
    routes: [
      ["PUT", `/api/races/${SEG}/team-orders/${SEG}`],
      ["PUT", `/api/races/${SEG}/stage-roles`],
    ],
  },
  { key: "training_choice", label: "Træningsvalg pr. rytter", routes: [["POST", `/api/training/${UUID}`]] },
  {
    key: "auction_bid",
    label: "Bud på auktion",
    routes: [
      ["POST", `/api/auctions/${SEG}/bid`],
      ["PATCH", `/api/auctions/${SEG}/proxy`],
    ],
  },
  {
    key: "list_for_sale",
    label: "Sæt til salg",
    routes: [
      ["POST", "/api/auctions"],
      ["POST", "/api/transfers"],
    ],
  },
  // Ingen egen rute: PUT /api/teams/my matches som team_profile_save og løftes
  // til team_create, når ruten markerer en rigtig oprettelse (se SECONDARY_ACTIONS).
  { key: "team_create", label: "Opret hold", rare: true, routes: [] },
  {
    key: "dashboard_open",
    label: "Åbn forsiden",
    routes: [
      ["GET", "/api/board/status"],
      ["GET", "/api/dashboard/my-latest-result"],
    ],
  },
];

/**
 * Målt, men aldrig alarmerende. PUT /api/teams/my bruges både til at oprette
 * holdet og til at gemme holdnavn/managernavn bagefter. Et langsomt profil-gem må
 * ikke give en alarm med titlen "Opret hold"; men tallet er gratis at gemme og
 * viser i opgørelsen, om ruten som helhed er langsom. `promotesTo` er den eneste
 * nøgle, ruten må løfte kaldet til (via `markActionTiming`).
 */
export const SECONDARY_ACTIONS = [
  {
    key: "team_profile_save",
    label: "Gem holdprofil",
    alert: false,
    promotesTo: "team_create",
    routes: [["PUT", "/api/teams/my"]],
  },
];

/**
 * KENDTE brud: handlinger der i dag ligger over loftet, og som har en åben opgave.
 * De måles og står i opgørelsen som alle andre, men giver højst ÉN samlet
 * påmindelse i døgnet i stedet for en alarm pr. handling pr. 6 timer. Fjern en
 * linje, når opgaven er løst; så alarmerer handlingen som alle andre igen.
 *   - Træn nu: #7982 (svaret tager 10 til 22 s).
 *   - Opret hold: #8143 (serverens mange ture til databasen; der findes ingen
 *     egen opgave for opret hold, og det er de samme ture der gør den langsom).
 */
export const KNOWN_BREACHES = Object.freeze([
  Object.freeze({ key: "train_now", issue: 7982 }),
  Object.freeze({ key: "team_create", issue: 8143 }),
]);

const MEASURED_ACTIONS = [...ACTIONS, ...SECONDARY_ACTIONS];
const ACTION_BY_KEY = new Map(MEASURED_ACTIONS.map((a) => [a.key, a]));

// Forkompilerede matchere grupperet pr. metode: et request uden for listen
// koster ét Map-opslag og højst et par regex-tests.
const MATCHERS_BY_METHOD = (() => {
  const byMethod = new Map();
  for (const action of MEASURED_ACTIONS) {
    for (const [method, pattern] of action.routes) {
      if (!byMethod.has(method)) byMethod.set(method, []);
      byMethod.get(method).push({ key: action.key, re: new RegExp(`^${pattern}/?$`) });
    }
  }
  return byMethod;
})();

/**
 * Hvilken af de ti handlinger er dette kald? Query-strengen ignoreres.
 * @param {string} method
 * @param {string} url  req.originalUrl (inkl. evt. query)
 * @returns {string|null} handlingens nøgle eller null
 */
export function matchAction(method, url) {
  const matchers = MATCHERS_BY_METHOD.get(String(method || "").toUpperCase());
  if (!matchers || typeof url !== "string") return null;
  const q = url.indexOf("?");
  const path = q === -1 ? url : url.slice(0, q);
  for (const m of matchers) if (m.re.test(path)) return m.key;
  return null;
}

/** Nearest-rank-percentil af et SORTERET array. */
export function percentile(sorted, q) {
  if (!sorted.length) return null;
  const rank = Math.max(1, Math.ceil(q * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

/** Histogram over BUCKET_BOUNDS_MS (+ én overløbs-spand). */
export function bucketize(durations) {
  const buckets = new Array(BUCKET_BOUNDS_MS.length + 1).fill(0);
  for (const d of durations) {
    let i = BUCKET_BOUNDS_MS.findIndex((ub) => d <= ub);
    if (i === -1) i = BUCKET_BOUNDS_MS.length;
    buckets[i] += 1;
  }
  return buckets;
}

/**
 * Opgørelse af ét vindue for én handling.
 * @param {number[]} durations  ms
 */
export function summarizeDurations(durations) {
  const sorted = [...durations].sort((a, b) => a - b);
  const over3s = sorted.filter((d) => d > SLOW_MS).length;
  const hung = sorted.filter((d) => d > HUNG_MS).length;
  return {
    calls: sorted.length,
    p50Ms: sorted.length ? Math.round(percentile(sorted, 0.5)) : null,
    p95Ms: sorted.length ? Math.round(percentile(sorted, 0.95)) : null,
    maxMs: sorted.length ? Math.round(sorted[sorted.length - 1]) : null,
    over3s,
    hung,
    buckets: bucketize(sorted),
  };
}

/** Langsomme kald i en opgørelse: over 3 s, men ikke hængende (egen fejlklasse). */
export function slowCallsOf(summary) {
  return Math.max(0, (summary?.over3s ?? 0) - (summary?.hung ?? 0));
}

/**
 * Alarm-reglerne for én handling. Hængende kald tæller ikke med (egen fejlklasse).
 *   - Kvarter: sjælden handling ved ét langsomt kald; ellers mindst 3 langsomme
 *     kald og mindst 10 % af kvarterets kald.
 *   - Time: over 20 % af kaldene den seneste time, kun med mindst 5 kald.
 * `rule` er "quarter", "hour", "both" eller null. To regler giver stadig kun ét
 * brud (og dermed højst én besked) for handlingen.
 * @param {{ key: string, summary: ReturnType<typeof summarizeDurations>,
 *           hour?: { calls: number, slowCalls: number } }} args
 */
export function evaluateBreach({ key, summary, hour }) {
  const action = ACTION_BY_KEY.get(key);
  const slowCalls = slowCallsOf(summary);
  const calls = summary?.calls ?? 0;
  const share = calls > 0 ? slowCalls / calls : 0;
  const hourCalls = hour?.calls ?? 0;
  const hourSlowCalls = hour?.slowCalls ?? 0;
  const hourShare = hourCalls > 0 ? hourSlowCalls / hourCalls : 0;
  const base = { slowCalls, share, hourCalls, hourSlowCalls, hourShare };
  if (!action || action.alert === false) return { breach: false, rule: null, ...base };

  const quarter = slowCalls > 0 && (action.rare ? true : slowCalls >= MIN_SLOW_CALLS && share >= MAX_SLOW_SHARE);
  const hourly = hourCalls >= HOUR_MIN_CALLS && hourShare > HOUR_MAX_SLOW_SHARE;
  const rule = quarter && hourly ? "both" : quarter ? "quarter" : hourly ? "hour" : null;
  return { breach: rule !== null, rule, ...base };
}

/**
 * Den seneste times kvarterer pr. handling, i hukommelsen (én pr. proces). Hver
 * flush lægger sit kvarter til; time-reglen lægger de kvarterer sammen, der
 * sluttede inden for den seneste time (dette + de tre foregående).
 */
export function createHourHistory({ windowMs = HOUR_WINDOW_MS } = {}) {
  const byKey = new Map();
  const prune = (list, atMs) => {
    while (list.length && list[0].atMs <= atMs - windowMs) list.shift();
  };
  return {
    add(key, atMs, calls, slowCalls) {
      let list = byKey.get(key);
      if (!list) byKey.set(key, (list = []));
      list.push({ atMs, calls, slowCalls });
      prune(list, atMs);
    },
    totals(key, atMs) {
      const list = byKey.get(key) ?? [];
      prune(list, atMs);
      let calls = 0;
      let slowCalls = 0;
      for (const e of list) {
        calls += e.calls;
        slowCalls += e.slowCalls;
      }
      return { calls, slowCalls };
    },
  };
}

export const defaultHourHistory = createHourHistory();

/** Start på det faste alarmvindue (UTC-justeret), som `now` ligger i. */
export function alertWindowStart(now, windowMs = ALERT_WINDOW_MS) {
  const t = now.getTime();
  return new Date(t - (t % windowMs));
}

/**
 * In-memory-opsamler. Én pr. proces (se `defaultActionTimingRecorder`).
 * @param {{ nowMs?: () => number, bootMs?: number, warmupMs?: number }} [opts]
 */
export function createActionTimingRecorder({ nowMs = () => Date.now(), bootMs, warmupMs = WARMUP_MS } = {}) {
  const startedAt = bootMs ?? nowMs();
  let windowStartMs = nowMs();
  let samples = new Map();
  return {
    /** Notér ét færdigt kald. Returnerer true hvis det blev talt med. */
    record(key, durationMs, statusCode = 200) {
      if (!ACTION_BY_KEY.has(key)) return false;
      if (!Number.isFinite(durationMs) || durationMs < 0) return false;
      if (statusCode >= 500) return false;
      if (nowMs() - startedAt < warmupMs) return false;
      let list = samples.get(key);
      if (!list) samples.set(key, (list = []));
      if (list.length >= MAX_SAMPLES_PER_WINDOW) return false;
      list.push(durationMs);
      return true;
    },
    /** Tøm vinduet og returnér { windowStart, windowEnd, perAction: Map<key, number[]> }. */
    drain() {
      const end = nowMs();
      const out = { windowStart: new Date(windowStartMs), windowEnd: new Date(end), perAction: samples };
      samples = new Map();
      windowStartMs = end;
      return out;
    },
    /** Kun til test/inspektion. */
    pendingCount() {
      let n = 0;
      for (const list of samples.values()) n += list.length;
      return n;
    },
  };
}

export const defaultActionTimingRecorder = createActionTimingRecorder();

/**
 * Ruten fortæller måleren, hvilken handling kaldet reelt var. Bruges af
 * PUT /api/teams/my, når `upsertOwnTeamProfile` har oprettet holdet
 * (`result.created`). Intet databasekald, ingen ændring i svaret; kaster aldrig.
 * Middlewaren accepterer kun en nøgle, som den matchede rutes `promotesTo` tillader.
 */
export function markActionTiming(res, key) {
  try {
    if (res && ACTION_BY_KEY.has(key)) {
      if (!res.locals) res.locals = {};
      res.locals.actionTimingKey = key;
    }
  } catch {
    // best-effort: en tabt markering betyder kun, at kaldet tælles som profil-gem.
  }
}

/**
 * Express-middleware. Placeres tidligt i server.js, så hele serverens tid tæller.
 * @param {{ recorder?: ReturnType<typeof createActionTimingRecorder>, clock?: () => number }} [opts]
 */
export function createActionTimingMiddleware({
  recorder = defaultActionTimingRecorder,
  clock = () => performance.now(),
} = {}) {
  return function actionTimingMiddleware(req, res, next) {
    try {
      const key = matchAction(req.method, req.originalUrl || req.url);
      if (key) {
        const started = clock();
        res.once("finish", () => {
          try {
            const marked = res.locals?.actionTimingKey;
            const finalKey = marked && marked === ACTION_BY_KEY.get(key)?.promotesTo ? marked : key;
            recorder.record(finalKey, clock() - started, res.statusCode);
          } catch {
            // best-effort: måleren må aldrig kunne vælte et svar (#8101); en
            // tabt måling er harmløs, og et kast her ville ramme Node's event-emitter.
          }
        });
      }
    } catch {
      // best-effort: samme begrundelse som ovenfor; kaldet fortsætter altid.
    }
    next();
  };
}

function fmtSeconds(ms) {
  if (ms == null) return "-";
  return `${(ms / 1000).toFixed(2).replace(".", ",")} s`;
}

const pctText = (share) => `${Math.round(share * 100)} %`;

/** Discord-embed for én handling i ét vindue. */
export function buildBreachEmbed({
  key,
  summary,
  windowStart,
  windowEnd,
  slowCalls,
  share,
  rule = "quarter",
  hourCalls = 0,
  hourSlowCalls = 0,
  hourShare = 0,
}) {
  const label = ACTION_BY_KEY.get(key)?.label ?? key;
  const minutes = Math.max(1, Math.round((windowEnd.getTime() - windowStart.getTime()) / 60000));
  const quarterLine = `${slowCalls} af ${summary.calls} kald tog over 3 sekunder de seneste ${minutes} min (${pctText(share)}).`;
  const hourLine = `${hourSlowCalls} af ${hourCalls} kald tog over 3 sekunder den seneste time (${pctText(hourShare)}).`;
  const lines = rule === "hour" ? [hourLine] : rule === "both" ? [quarterLine, hourLine] : [quarterLine];
  return {
    embeds: [
      {
        title: `Svartid over 3 s: ${label}`,
        description: `${lines.join("\n")}\nHele døgnet: \`select * from public.action_timing_summary(24);\``,
        color: 0xe67e22,
        fields: [
          { name: "Kald", value: String(summary.calls), inline: true },
          { name: "Median", value: fmtSeconds(summary.p50Ms), inline: true },
          { name: "95 %", value: fmtSeconds(summary.p95Ms), inline: true },
          { name: "Langsomste", value: fmtSeconds(summary.maxMs), inline: true },
          { name: "Over 3 s", value: String(slowCalls), inline: true },
          { name: "Hængende (over 60 s)", value: String(summary.hung), inline: true },
        ],
        footer: { text: "Højst én besked pr. handling pr. 6 timer (#8101)" },
        timestamp: windowEnd.toISOString(),
      },
    ],
  };
}

/**
 * Én samlet påmindelse om kendte brud (højst én pr. døgn).
 * @param {{ breaches: object[], knownBreaches: ReadonlyArray<{key: string, issue: number}>, now: Date }} args
 */
export function buildKnownBreachEmbed({ breaches, knownBreaches, now }) {
  const issueOf = new Map(knownBreaches.map((k) => [k.key, k.issue]));
  const names = breaches.map((b) => `${ACTION_BY_KEY.get(b.key)?.label ?? b.key} (#${issueOf.get(b.key)})`);
  const detail = breaches.map((b) => {
    const label = ACTION_BY_KEY.get(b.key)?.label ?? b.key;
    return `${label}: ${b.slowCalls} af ${b.summary.calls} kald over 3 s i kvarteret, langsomste ${fmtSeconds(b.summary.maxMs)}`;
  });
  return {
    embeds: [
      {
        title: "Kendte brud på svartids-loftet",
        description:
          `Stadig over loftet: ${names.join(", ")}.\n${detail.join("\n")}\n` +
          "Kendt og har en opgave, derfor kun én påmindelse i døgnet. Hele døgnet: " +
          "`select * from public.action_timing_summary(24);`",
        color: 0x95a5a6,
        footer: { text: "Højst én påmindelse pr. døgn; fjern handlingen fra KNOWN_BREACHES når opgaven er løst (#8101)" },
        timestamp: now.toISOString(),
      },
    ],
  };
}

function processId() {
  const dep = (process.env.RAILWAY_DEPLOYMENT_ID || "").trim();
  return `${dep || "local"}:${process.pid}`;
}

function isMissingTable(error) {
  const code = String(error?.code ?? "");
  return code === "42P01" || code === "PGRST205" || /does not exist|could not find the table/i.test(String(error?.message ?? ""));
}

let missingTableLogged = false;

/**
 * Cron-tick (hvert kvarter): opgør, gem og alarmér.
 * @param {{ supabase: object, recorder?: ReturnType<typeof createActionTimingRecorder>,
 *           now?: Date, sendWebhookFn?: Function, getOpsWebhookFn?: Function,
 *           captureExceptionFn?: Function, procId?: string }} args
 * @returns {Promise<{ rows: object[], breaches: object[], alerted: string[],
 *                     reminded: string[], persisted: boolean }>}
 */
export async function runActionTimingFlush({
  supabase,
  recorder = defaultActionTimingRecorder,
  hourHistory = defaultHourHistory,
  knownBreaches = KNOWN_BREACHES,
  now = new Date(),
  sendWebhookFn,
  getOpsWebhookFn,
  captureExceptionFn,
  procId = processId(),
} = {}) {
  const { windowStart, windowEnd, perAction } = recorder.drain();
  const rows = [];
  const breaches = [];
  for (const action of MEASURED_ACTIONS) {
    const durations = perAction.get(action.key);
    if (!durations?.length) continue;
    const summary = summarizeDurations(durations);
    hourHistory.add(action.key, now.getTime(), summary.calls, slowCallsOf(summary));
    rows.push({
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      action: action.key,
      process_id: procId,
      calls: summary.calls,
      p50_ms: summary.p50Ms,
      p95_ms: summary.p95Ms,
      max_ms: summary.maxMs,
      over_3s: summary.over3s,
      hung: summary.hung,
      buckets: summary.buckets,
    });
    const hour = hourHistory.totals(action.key, now.getTime());
    const verdict = evaluateBreach({ key: action.key, summary, hour });
    if (verdict.breach) breaches.push({ key: action.key, summary, ...verdict });
  }
  const knownKeys = new Set(knownBreaches.map((k) => k.key));
  const knownHits = breaches.filter((b) => knownKeys.has(b.key));
  const newBreaches = breaches.filter((b) => !knownKeys.has(b.key));

  let persisted = false;
  if (rows.length && supabase) {
    const { error } = await supabase.from(ACTION_TIMING_TABLE).insert(rows);
    if (!error) {
      persisted = true;
      const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { error: delErr } = await supabase.from(ACTION_TIMING_TABLE).delete().lt("window_start", cutoff);
      if (delErr) captureExceptionFn?.(new Error(`action_timing_windows retention: ${delErr.message}`), { tags: { cron: "action-timing-flush" } });
    } else if (isMissingTable(error)) {
      // Migrationen køres efter merge (#2642); indtil da kører alarmen videre
      // uden historik. Én linje pr. proces, ikke én pr. kvarter.
      if (!missingTableLogged) console.log("action-timing (#8101): tabellen findes ikke endnu, gemmer ikke historik");
      missingTableLogged = true;
    } else {
      captureExceptionFn?.(new Error(`action_timing_windows insert: ${error.message}`), { tags: { cron: "action-timing-flush" } });
    }
  }

  const alerted = [];
  const reminded = [];
  const url = breaches.length && supabase && getOpsWebhookFn ? await getOpsWebhookFn() : null;
  // Uden en kanal at sende til claimes vinduet ikke: ellers ville en midlertidigt
  // manglende webhook bruge vinduet op, og bruddet ville aldrig blive meldt.
  if (url && sendWebhookFn) {
    const signature = buildAlertSignature([alertWindowStart(now).toISOString()]);
    for (const b of newBreaches) {
      // Én besked pr. handling pr. alarmvindue: signaturen er vinduets start, så
      // første brud i et nyt vindue er "ændret", og resten af vinduet er stille.
      // Fail-safe-stille ved læsefejl: en svartids-alarm hvert kvarter er værre
      // end én tabt besked (cronHeartbeat.js gør samme valg).
      const dedupe = {
        supabase,
        alertKey: `${ALERT_KEY_PREFIX}:${b.key}`,
        signature,
        now,
        captureExceptionFn,
        alertOnReadError: false,
      };
      // Spørg først uden at claime, send, og claim derefter (emailHealthReport-
      // mønsteret): et fejlende send må ikke bruge vinduet op. sendWebhook lægger
      // selv en fejlet levering i outbox'en.
      const { alert } = await shouldAlertOnChange({ ...dedupe, claim: false });
      if (!alert) continue;
      await sendWebhookFn(url, buildBreachEmbed({ ...b, windowStart, windowEnd }));
      await shouldAlertOnChange(dedupe);
      alerted.push(b.key);
    }

    // Kendte brud: én samlet påmindelse pr. fast UTC-døgn, uanset hvor mange af
    // dem der bryder, og hvor mange kvarterer de gør det i. Samme spørg-send-
    // claim-mønster som ovenfor.
    if (knownHits.length) {
      const dedupe = {
        supabase,
        alertKey: `${ALERT_KEY_PREFIX}:known-breaches`,
        signature: buildAlertSignature([alertWindowStart(now, KNOWN_BREACH_REMINDER_MS).toISOString()]),
        now,
        captureExceptionFn,
        alertOnReadError: false,
      };
      const { alert } = await shouldAlertOnChange({ ...dedupe, claim: false });
      if (alert) {
        await sendWebhookFn(url, buildKnownBreachEmbed({ breaches: knownHits, knownBreaches, now }));
        await shouldAlertOnChange(dedupe);
        reminded.push(...knownHits.map((b) => b.key));
      }
    }
  }

  return { rows, breaches, alerted, reminded, persisted };
}

let configuredFlush = null;

/**
 * Binder flushens afhængigheder én gang (fra cron.js) og returnerer tick-funktionen.
 * Samme binding bruges af `flushActionTimingOnShutdown`, så server.js ikke skal
 * kende supabase-klienten eller webhook-hjælperne.
 */
export function configureActionTimingFlush(deps) {
  configuredFlush = () => runActionTimingFlush(deps);
  return configuredFlush;
}

/**
 * Sidste flush ved SIGTERM: uden den taber hver deploy det igangværende kvarter,
 * og en proces der lever under et kvarter ville aldrig gemme noget. Kaster aldrig.
 * No-op når cron ikke er startet (fx lokalt uden cron).
 */
export async function flushActionTimingOnShutdown({ captureExceptionFn, timeoutMs = 10_000 } = {}) {
  if (!configuredFlush) return null;
  let timer;
  try {
    // Loftet holder nedlukningen inden for Railways drain-vindue, også hvis
    // databasen hænger: hellere et tabt kvarter end en SIGKILL midt i et løb.
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    return await Promise.race([configuredFlush(), timeout]);
  } catch (err) {
    captureExceptionFn?.(err, { tags: { cron: "action-timing-flush", phase: "shutdown" } });
    console.error("action-timing (#8101): flush ved nedlukning fejlede:", err?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
