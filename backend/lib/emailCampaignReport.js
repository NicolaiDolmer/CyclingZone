// #8807 -- campaign report for hand-run mail campaigns (S6 first).
//
// Answers, per audience x language x subject variant: how many were sent, delivered, bounced (hard/soft), complained,
// unsubscribed and clicked (unique), and how many were active 1, 3, 7 and 14
// days after the mail: logged in, set training, picked a lineup, raced in the
// campaign season, bought Pro.
//
// Pure: every row comes in as an argument, so all counts are unit-tested with
// fixtures. scripts/email-campaign-report.mjs does the (read-only) I/O and
// writes the result to a private OneDrive file, never to GitHub.
//
// Webhook health (#8807 point 3): if the campaign's sends are old enough that
// Resend must have answered and email_events holds no event for any of them,
// the report says so loudly and the CLI exits non-zero. 26/11 the webhook was
// missing entirely and three bounces never reached the database; a report
// that quietly shows "0 bounces" in that state is worse than no report.
//
// Sources and their limits (also in docs/EMAIL_STACK.md §6):
//   - audience is not stored at send time. It is read from the click link
//     (utm_content) when there is one, otherwise rebuilt from the last visit
//     before the send: users.last_seen when it is still older than the send
//     (exact), else the newest activity event before the send (approximate).
//   - unsubscribes carry no timestamp. A recipient who is muted now (or has
//     withdrawn the marketing consent) is counted; every recipient was allowed
//     at send time, so the change came after.
//   - training tables only keep the latest edit, so "set training" means the
//     latest change falls in the window; an earlier change overwritten later
//     is not seen.
//   - "logged in" counts visit evidence only: users.last_seen and activity
//     events a manager's own browser writes. Events the server writes without
//     a visit (a checkout confirmation arriving by webhook) are left out.
//   - "bought Pro" counts the completed-payment event (checkout_completed),
//     not the subscription row, which is also written when checkout starts.
//   - every manager who allows the mail gets it; there is no control group
//     (owner 27/11), so activity is compared across groups, not against
//     managers who were not mailed.

import { s6AudienceForDaysAway, S6_AUDIENCES } from "./emailTemplates.js";
import { isHardBounce } from "./resendWebhook.js";
import {
  S6_MAIL_EMAIL_KIND,
  S6_MAIL_SUBJECT_VARIANT,
  s6MailLanguage,
  s6MailPrefsAllow,
}from "./s6MailCampaign.js";
import { hasWinbackConsent } from "./winbackSegment.js";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export const REPORT_WINDOWS_DAYS = Object.freeze([1, 3, 7, 14]);
export const ACTIVITY_SIGNALS = Object.freeze(["login", "training", "lineup", "season_race", "pro_purchase"]);

/**
 * Activity events the server writes on its own (payment webhooks). They say
 * nothing about a manager being in the game, so they are not visit evidence.
 */
export const SERVER_WRITTEN_EVENT_NAMES = Object.freeze(["checkout_started", "checkout_completed", "checkout_paused"]);
export const PRO_PURCHASE_EVENT_NAME = "checkout_completed";

/** True when a player_events row is visit evidence for the "logged in" signal. */
export function isVisitEvent(eventName) {
  return !SERVER_WRITTEN_EVENT_NAMES.includes(eventName);
}
export const UNKNOWN_AUDIENCE = "unknown";

/** Statuses that mean Resend accepted the mail (sendLoopEmail's dedupe set). */
const CONTACTED_STATUSES = new Set(["sent", "delivered", "bounced", "complained"]);

/** Sends younger than this are not yet expected to have a webhook event. */
export const WEBHOOK_GRACE_HOURS = 2;
/** Below this share of sends with an event (after the grace), the report warns. */
export const WEBHOOK_MIN_EVENT_SHARE = 0.9;

/** Campaigns the report knows. */
export const REPORT_CAMPAIGNS = Object.freeze({
  [S6_MAIL_EMAIL_KIND]: Object.freeze({
    utmCampaignPrefix: "s6-",
    defaultVariant: S6_MAIL_SUBJECT_VARIANT,
  }),
});

function toMs(value) {
  if (value === null || value === undefined || value === "") return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function campaignConfig(campaign) {
  const config = REPORT_CAMPAIGNS[campaign];
  if (!config) throw new Error(`unknown campaign: ${campaign}`);
  return config;
}

/** The dedupe-key prefix one edition of a campaign writes into email_log. */
export function editionKeyPrefix(campaign, edition) {
  return `${campaign}:${edition}:`;
}

/**
 * The edition's email_log rows, split into sends Resend accepted (one per
 * user, earliest wins) and sends that only failed.
 */
export function campaignSends({ emailLogRows = [], campaign, edition }) {
  const prefix = editionKeyPrefix(campaign, edition);
  const contacted = new Map();
  const failedUsers = new Set();
  for (const row of emailLogRows) {
    if (!row?.user_id || typeof row.dedupe_key !== "string" || !row.dedupe_key.startsWith(prefix)) continue;
    if (row.email_type && row.email_type !== campaign) continue;
    if (CONTACTED_STATUSES.has(row.status)) {
      const prev = contacted.get(row.user_id);
      if (!prev || (toMs(row.created_at) ?? Infinity) < (toMs(prev.created_at) ?? Infinity)) contacted.set(row.user_id, row);
    } else if (row.status === "failed") {
      failedUsers.add(row.user_id);
    }
  }
  for (const userId of contacted.keys()) failedUsers.delete(userId);
  return { sends: [...contacted.values()], failedUserIds: [...failedUsers] };
}

/** utm_content "<audience>-<variant>" from a click link, or null. */
export function parseUtmContent(link) {
  if (typeof link !== "string" || !link) return null;
  let content;
  try {
    content = new URL(link).searchParams.get("utm_content");
  } catch {
    // best-effort: a link Resend reports in an unexpected shape just means no
    // audience from this click; the audience then comes from the last visit.
    return null;
  }
  if (!content) return null;
  const [audience, variant] = content.split("-");
  if (!S6_AUDIENCES.includes(audience)) return null;
  return { audience, variant: variant || null };
}

/**
 * Fold webhook events per Resend email id.
 * @returns {Map<string, {count, delivered, bounceHard, bounceSoft, complained, clicks, firstClickContent}>}
 */
export function foldEmailEvents(emailEvents = []) {
  const byProvider = new Map();
  for (const event of emailEvents) {
    const providerId = event?.provider_id;
    if (!providerId) continue;
    let entry = byProvider.get(providerId);
    if (!entry) {
      entry = { count: 0, delivered: false, bounceHard: false, bounceSoft: false, complained: false, clicks: 0, firstClickContent: null };
      byProvider.set(providerId, entry);
    }
    entry.count += 1;
    const data = event.payload?.data ?? {};
    switch (event.type) {
      case "email.delivered":
        entry.delivered = true;
        break;
      case "email.bounced":
        if (isHardBounce(data.bounce)) entry.bounceHard = true;
        else entry.bounceSoft = true;
        break;
      case "email.complained":
        entry.complained = true;
        break;
      case "email.clicked": {
        entry.clicks += 1;
        if (!entry.firstClickContent) entry.firstClickContent = parseUtmContent(data.click?.link ?? data.link);
        break;
      }
      default:
        break;
    }
  }
  return byProvider;
}

/**
 * Delivery outcome of one send. email_log.status is the webhook's own summary
 * and covers an event row that was later pruned; the events add the bounce
 * type and the clicks the status cannot hold.
 */
export function deliveryOutcome(send, events) {
  const status = send?.status;
  const e = events ?? null;
  const complained = status === "complained" || !!e?.complained;
  const bounceHard = !!e?.bounceHard;
  const bounceSoft = !bounceHard && !!e?.bounceSoft;
  const bounced = status === "bounced" || bounceHard || bounceSoft;
  return {
    delivered: status === "delivered" || complained || !!e?.delivered,
    bounced,
    bounceHard,
    bounceSoft,
    bounceUnknown: bounced && !bounceHard && !bounceSoft,
    complained,
    clicked: (e?.clicks ?? 0) > 0,
  };
}

/**
 * True when the recipient has opted out since: muted entirely by their own
 * choice (not a bounce/complaint suppression), muted for this campaign or
 * win-back, or withdrew the marketing consent.
 */
export function isUnsubscribedNow(user) {
  if (!user) return false;
  const prefs = user.email_prefs ?? {};
  if (prefs.all === false && !prefs.suppressed_reason) return true;
  if (prefs.all !== false && !s6MailPrefsAllow(prefs)) return true;
  return !hasWinbackConsent(user);
}

/**
 * The audience at send time. Click link first (exact), then last_seen if it
 * is still older than the send (exact), then the newest visit event before
 * the send (approximate). Returns {audience, source}.
 */
export function audienceAtSend({ user, sentAtMs, clickContent, visitTimesMs = [] }) {
  if (clickContent?.audience) return { audience: clickContent.audience, source: "click" };
  const lastSeen = toMs(user?.last_seen);
  if (lastSeen !== null && lastSeen <= sentAtMs) {
    return { audience: s6AudienceForDaysAway(Math.floor((sentAtMs - lastSeen) / DAY_MS)), source: "last_seen" };
  }
  let latest = null;
  for (const t of visitTimesMs) if (t <= sentAtMs && (latest === null || t > latest)) latest = t;
  if (latest !== null) {
    return { audience: s6AudienceForDaysAway(Math.floor((sentAtMs - latest) / DAY_MS)), source: "visit_event" };
  }
  if (lastSeen === null) return { audience: s6AudienceForDaysAway(null), source: "no_visit" };
  return { audience: UNKNOWN_AUDIENCE, source: "unknown" };
}

/**
 * Index activity rows by user and signal. Rows carry either user_id or
 * team_id (mapped through teams) plus `at`.
 * @returns {Map<string, Map<string, number[]>>} userId -> signal -> sorted times
 */
export function indexActivity({ activityRows = [], teams = [] }) {
  const userByTeam = new Map(teams.filter((t) => t?.id && t.user_id).map((t) => [t.id, t.user_id]));
  const index = new Map();
  for (const row of activityRows) {
    if (!ACTIVITY_SIGNALS.includes(row?.signal)) continue;
    const userId = row.user_id ?? userByTeam.get(row.team_id);
    const at = toMs(row.at);
    if (!userId || at === null) continue;
    let bySignal = index.get(userId);
    if (!bySignal) index.set(userId, (bySignal = new Map()));
    let times = bySignal.get(row.signal);
    if (!times) bySignal.set(row.signal, (times = []));
    times.push(at);
  }
  for (const bySignal of index.values()) for (const times of bySignal.values()) times.sort((a, b) => a - b);
  return index;
}

/**
 * Was there activity of this signal in (start, start + days]? null when that
 * window has not fully passed yet (the user is then left out of the count).
 */
export function activeWithin(times, startMs, days, nowMs) {
  const end = startMs + days * DAY_MS;
  if (nowMs < end) return null;
  return (times ?? []).some((t) => t > startMs && t <= end);
}

function emptyGroup(key) {
  const activity = {};
  for (const signal of ACTIVITY_SIGNALS) {
    activity[signal] = {};
    for (const d of REPORT_WINDOWS_DAYS) activity[signal][d] = { active: 0, eligible: 0 };
  }
  return {
    ...key,
    people: 0,
    sent: 0,
    delivered: 0,
    bounced: 0,
    bounceHard: 0,
    bounceSoft: 0,
    bounceUnknown: 0,
    complained: 0,
    unsubscribed: 0,
    clicked: 0,
    activity,
  };
}

function addActivity(group, bySignal, startMs, nowMs) {
  for (const signal of ACTIVITY_SIGNALS) {
    for (const d of REPORT_WINDOWS_DAYS) {
      const active = activeWithin(bySignal?.get(signal), startMs, d, nowMs);
      if (active === null) continue;
      group.activity[signal][d].eligible += 1;
      if (active) group.activity[signal][d].active += 1;
    }
  }
}

/**
 * Webhook health for the edition's sends.
 * @returns {{status: "ok"|"warn"|"fail"|"pending", due, withEvent, withoutProviderId, messages: string[]}}
 */
export function checkWebhookHealth({ sends = [], eventsByProvider = new Map(), nowMs, graceHours = WEBHOOK_GRACE_HOURS }) {
  const cutoff = nowMs - graceHours * HOUR_MS;
  const due = sends.filter((s) => (toMs(s.created_at) ?? Infinity) <= cutoff);
  const withoutProviderId = due.filter((s) => !s.provider_id).length;
  const withEvent = due.filter((s) => s.provider_id && (eventsByProvider.get(s.provider_id)?.count ?? 0) > 0).length;
  const messages = [];
  if (due.length === 0) {
    return { status: "pending", due: 0, withEvent: 0, withoutProviderId: 0, messages: [`Ingen afsendelser er ældre end ${graceHours} t endnu; webhooken kan ikke vurderes.`] };
  }
  if (withEvent === 0) {
    messages.push(
      `email_events har INGEN hændelser for ${due.length} afsendelser ældre end ${graceHours} t. ` +
        "Webhooken leverer ikke (eller afvises): bounces og klager når ikke databasen og bliver ikke spærret. Runbook §6.1."
    );
    return { status: "fail", due: due.length, withEvent, withoutProviderId, messages };
  }
  let status = "ok";
  const share = withEvent / due.length;
  if (share < WEBHOOK_MIN_EVENT_SHARE) {
    status = "warn";
    messages.push(`Kun ${withEvent} af ${due.length} afsendelser (ældre end ${graceHours} t) har mindst én hændelse i email_events.`);
  }
  if (withoutProviderId > 0) {
    status = "warn";
    messages.push(`${withoutProviderId} afsendelser mangler provider_id og kan ikke kobles til webhook-hændelser.`);
  }
  return { status, due: due.length, withEvent, withoutProviderId, messages };
}

/** Unique non-bot first-party visits per utm_campaign (traffic_events). */
export function summarizeTrafficUtm({ trafficRows = [], utmCampaign }) {
  const visits = new Set();
  let events = 0;
  for (const row of trafficRows) {
    if (row?.is_bot === true || row?.utm_campaign !== utmCampaign) continue;
    events += 1;
    if (row.visit_hash) visits.add(row.visit_hash);
  }
  return { utmCampaign, events, visits: visits.size };
}

function groupKeyString(k) {
  return `${k.audience}|${k.language}|${k.variant}`;
}

/**
 * The whole report.
 *
 * @param {object} args
 * @param {string} args.campaign
 * @param {string} args.edition
 * @param {object[]} args.emailLogRows   {user_id, email_type, dedupe_key, status, provider_id, created_at}
 * @param {object[]} args.emailEvents    {provider_id, type, payload, created_at}
 * @param {object[]} args.users          {id, email, last_seen, language, consent_preferences, email_prefs}
 * @param {object[]} args.teams          {id, user_id, name, is_ai, is_bank, is_test_account, is_frozen}
 * @param {object[]} [args.activityRows] {signal, user_id | team_id, at}
 * @param {object[]} [args.trafficRows]  {utm_campaign, visit_hash, is_bot}
 * @param {object[]|null} [args.posthogRows] [{utmContent, persons, sessions}] or null when not read
 * @param {Date} args.now
 */
export function buildCampaignReport({
  campaign,
  edition,
  emailLogRows = [],
  emailEvents = [],
  users = [],
  teams = [],
  activityRows = [],
  trafficRows = [],
  posthogRows = null,
  now,
  graceHours = WEBHOOK_GRACE_HOURS,
}) {
  const config = campaignConfig(campaign);
  const nowMs = toMs(now);
  if (nowMs === null) throw new Error("buildCampaignReport needs now");

  const userById = new Map(users.filter((u) => u?.id).map((u) => [u.id, u]));
  const { sends, failedUserIds } = campaignSends({ emailLogRows, campaign, edition });
  const eventsByProvider = foldEmailEvents(emailEvents);
  const activity = indexActivity({ activityRows, teams });
  const sendTimes = sends.map((s) => toMs(s.created_at)).filter((t) => t !== null);
  const firstSendMs = sendTimes.length ? Math.min(...sendTimes) : null;
  const lastSendMs = sendTimes.length ? Math.max(...sendTimes) : null;

  const groups = new Map();
  const audienceSources = {};
  const groupFor = (key) => {
    const id = groupKeyString(key);
    if (!groups.has(id)) groups.set(id, emptyGroup(key));
    return groups.get(id);
  };
  const noteSource = (source) => {
    audienceSources[source] = (audienceSources[source] ?? 0) + 1;
  };

  for (const send of sends) {
    const user = userById.get(send.user_id) ?? null;
    const sentAtMs = toMs(send.created_at) ?? firstSendMs;
    const events = send.provider_id ? eventsByProvider.get(send.provider_id) : undefined;
    const outcome = deliveryOutcome(send, events);
    const visitTimes = activity.get(send.user_id)?.get("login") ?? [];
    const { audience, source } = audienceAtSend({ user, sentAtMs, clickContent: events?.firstClickContent, visitTimesMs: visitTimes });
    noteSource(source);
    const group = groupFor({
      audience,
      language: s6MailLanguage(user?.language),
      variant: events?.firstClickContent?.variant || config.defaultVariant,
    });
    group.people += 1;
    group.sent += 1;
    for (const field of ["delivered", "bounced", "bounceHard", "bounceSoft", "bounceUnknown", "complained", "clicked"]) {
      if (outcome[field]) group[field] += 1;
    }
    if (isUnsubscribedNow(user)) group.unsubscribed += 1;
    addActivity(group, withLastSeen(activity.get(send.user_id), user), sentAtMs, nowMs);
  }

  const sorted = [...groups.values()].sort((a, b) => {
    const order = (g) => [
      [...S6_AUDIENCES, UNKNOWN_AUDIENCE].indexOf(g.audience),
      g.language,
      g.variant,
    ];
    const [x, y] = [order(a), order(b)];
    for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
  });

  const utmCampaign = `${config.utmCampaignPrefix}${edition}`;
  return {
    campaign,
    edition,
    generatedAt: new Date(nowMs).toISOString(),
    firstSendAt: firstSendMs === null ? null : new Date(firstSendMs).toISOString(),
    lastSendAt: lastSendMs === null ? null : new Date(lastSendMs).toISOString(),
    totals: { sent: sends.length, failedOnly: failedUserIds.length },
    audienceSources,
    groups: sorted,
    webhook: checkWebhookHealth({ sends, eventsByProvider, nowMs, graceHours }),
    utm: {
      traffic: summarizeTrafficUtm({ trafficRows, utmCampaign }),
      posthog: posthogRows,
    },
  };
}

/** users.last_seen is one more login point on top of the event rows. */
function withLastSeen(bySignal, user) {
  const lastSeen = toMs(user?.last_seen);
  if (lastSeen === null) return bySignal;
  const copy = new Map(bySignal ?? []);
  copy.set("login", [...(copy.get("login") ?? []), lastSeen]);
  return copy;
}

// ── rendering (private markdown, Danish) ───────────────────────────────

const SIGNAL_LABEL = {
  login: "Logget ind",
  training: "Sat træning",
  lineup: "Udtaget hold",
  season_race: "Kørt løb i sæsonen",
  pro_purchase: "Pro-køb",
};
const AUDIENCE_LABEL = { active: "Aktiv", dormant: "Sovende", away: "Væk", unknown: "Ukendt" };

function pct(part, whole) {
  if (!whole) return "–";
  return `${((part / whole) * 100).toFixed(1)} %`;
}

function cellRate(part, whole) {
  return whole ? `${part} (${pct(part, whole)})` : "–";
}

function groupLabel(g) {
  return `${AUDIENCE_LABEL[g.audience] ?? g.audience} · ${g.language.toUpperCase()} · ${g.variant.toUpperCase()}`;
}

/** Markdown for the private handoff file. */
export function renderCampaignReport(report) {
  const lines = [
    `# Kampagnerapport: ${report.campaign} / ${report.edition}`,
    "",
    `Hentet: ${report.generatedAt}. Første afsendelse: ${report.firstSendAt ?? "ingen"}. Sidste: ${report.lastSendAt ?? "ingen"}.`,
    `Sendt: ${report.totals.sent}. Kun fejlet (aldrig accepteret af Resend): ${report.totals.failedOnly}.`,
    "",
    `## Webhook-sundhed: ${report.webhook.status.toUpperCase()}`,
    "",
    `Afsendelser ældre end grænsen: ${report.webhook.due}. Med mindst én hændelse: ${report.webhook.withEvent}.`,
    ...report.webhook.messages.map((m) => `- ${m}`),
    "",
    "## Levering pr. gruppe",
    "",
    "| Gruppe | Sendt | Leveret | Bounce hård | Bounce blød | Bounce ukendt | Klage | Afmeldt | Klik (unik) |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const g of report.groups) {
    lines.push(
      `| ${groupLabel(g)} | ${g.sent} | ${cellRate(g.delivered, g.sent)} | ${cellRate(g.bounceHard, g.sent)} | ${cellRate(g.bounceSoft, g.sent)} | ${cellRate(g.bounceUnknown, g.sent)} | ${cellRate(g.complained, g.sent)} | ${cellRate(g.unsubscribed, g.sent)} | ${cellRate(g.clicked, g.sent)} |`
    );
  }
  for (const signal of ACTIVITY_SIGNALS) {
    lines.push("", `## ${SIGNAL_LABEL[signal]} efter mailen`, "");
    lines.push(`| Gruppe | Personer | ${REPORT_WINDOWS_DAYS.map((d) => `${d} d`).join(" | ")} |`);
    lines.push(`| --- | ---: | ${REPORT_WINDOWS_DAYS.map(() => "---:").join(" | ")} |`);
    for (const g of report.groups) {
      const cells = REPORT_WINDOWS_DAYS.map((d) => {
        const { active, eligible } = g.activity[signal][d];
        return eligible ? `${active}/${eligible} (${pct(active, eligible)})` : "ikke modent";
      });
      lines.push(`| ${groupLabel(g)} | ${g.people} | ${cells.join(" | ")} |`);
    }
  }
  lines.push("", "## Klik til spillet (UTM)", "");
  const t = report.utm.traffic;
  lines.push(`Egen trafik (traffic_events, uden bots), utm_campaign=${t.utmCampaign}: ${t.visits} besøg, ${t.events} hændelser.`);
  if (Array.isArray(report.utm.posthog)) {
    lines.push("", "| PostHog utm_content | Personer | Sessioner |", "| --- | ---: | ---: |");
    for (const row of report.utm.posthog) lines.push(`| ${row.utmContent || "(tom)"} | ${row.persons} | ${row.sessions} |`);
  } else {
    lines.push("PostHog: ikke læst (POSTHOG_PERSONAL_API_KEY eller POSTHOG_PROJECT_ID mangler).");
  }
  lines.push("", "## Kilder og forbehold", "");
  const src =
    Object.entries(report.audienceSources)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ") || "ingen";
  lines.push(`- Gruppe ved afsendelse: ${src}. click og last_seen er præcise, visit_event er et skøn.`);
  lines.push("- Afmeldt = slået fra nu (egen afmelding, kampagnen, win-back eller samtykket trukket); ingen tidsstempel findes.");
  lines.push("- Sat træning = seneste ændring ligger i vinduet; en tidligere ændring der siden er overskrevet ses ikke.");
  lines.push("- \"ikke modent\" = vinduet er ikke gået for nogen i gruppen endnu.");
  lines.push("- Alle der må få mailen har fået den; der er ingen kontrolgruppe, så tallene sammenligner grupperne indbyrdes, ikke mail mod ingen mail.");
  lines.push("");
  return lines.join("\n");
}
