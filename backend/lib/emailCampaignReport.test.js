import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_SIGNALS,
  REPORT_WINDOWS_DAYS,
  activeWithin,
  audienceAtSend,
  buildCampaignReport,
  campaignSends,
  checkWebhookHealth,
  deliveryOutcome,
  foldEmailEvents,
  indexActivity,
  isUnsubscribedNow,
  isVisitEvent,
  PRO_PURCHASE_EVENT_NAME,
  parseUtmContent,
  renderCampaignReport,
  summarizeTrafficUtm,
} from "./emailCampaignReport.js";
import { s6MailDedupeKey } from "./s6MailCampaign.js";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const SEND = Date.parse("2026-11-26T10:00:00.000Z");
const at = (days, hours = 0) => new Date(SEND + days * DAY_MS + hours * HOUR_MS).toISOString();
const CAMPAIGN = "s6_season";
const EDITION = "before-start";

function team(i, overrides = {}) {
  return { id: `team-${i}`, user_id: `user-${i}`, name: `Hold ${i}`, is_ai: false, is_bank: false, is_test_account: false, is_frozen: false, ...overrides };
}

function user(i, overrides = {}) {
  return {
    id: `user-${i}`,
    email: `m${i}@example.com`,
    last_seen: at(-3),
    language: "en",
    consent_preferences: { email_marketing: true },
    email_prefs: {},
    ...overrides,
  };
}

function send(i, overrides = {}) {
  return {
    id: i,
    user_id: `user-${i}`,
    email_type: CAMPAIGN,
    dedupe_key: s6MailDedupeKey(EDITION, `user-${i}`),
    status: "sent",
    provider_id: `re-${i}`,
    created_at: at(0),
    ...overrides,
  };
}

const ev = (i, type, data = {}, overrides = {}) => ({ provider_id: `re-${i}`, type, payload: { type, data }, created_at: at(0, 1), ...overrides });
const clickLink = (audience, variant = "a") =>
  `https://cyclingzone.org/training?utm_source=email&utm_medium=email&utm_campaign=s6-before-start&utm_content=${audience}-${variant}`;

// ── sends ───────────────────────────────────────────────────────────────

test("sends: only this edition's accepted rows count, one per user; failed-only users are listed apart", () => {
  const rows = [
    send(1),
    send(1, { id: 9, created_at: at(0, 3) }), // duplicate row for the same user: earliest wins
    send(2, { status: "delivered" }),
    send(3, { status: "failed", provider_id: null }),
    send(4, { status: "failed" }),
    send(4, { id: 10, status: "sent" }), // retried and accepted: not failed-only
    send(5, { status: "dry_run" }),
    send(6, { dedupe_key: "s6_season:started:user-6" }), // other edition
    send(7, { email_type: "winback", dedupe_key: "winback:user-7" }),
  ];
  const { sends, failedUserIds } = campaignSends({ emailLogRows: rows, campaign: CAMPAIGN, edition: EDITION });
  assert.deepEqual(sends.map((s) => [s.user_id, s.id]), [["user-1", 1], ["user-2", 2], ["user-4", 10]]);
  assert.deepEqual(failedUserIds, ["user-3"]);
});

// ── events and delivery outcome ─────────────────────────────────────────

test("utm_content: audience and variant from a click link; garbage is null", () => {
  assert.deepEqual(parseUtmContent(clickLink("dormant", "b")), { audience: "dormant", variant: "b" });
  assert.equal(parseUtmContent("https://cyclingzone.org/?utm_content=nobody-a"), null);
  assert.equal(parseUtmContent("not a url"), null);
  assert.equal(parseUtmContent(null), null);
});

test("events: delivered, hard and soft bounce, complaint and clicks fold per email id", () => {
  const folded = foldEmailEvents([
    ev(1, "email.sent"),
    ev(1, "email.delivered"),
    ev(1, "email.clicked", { click: { link: clickLink("away") } }),
    ev(1, "email.clicked", { click: { link: clickLink("active") } }),
    ev(2, "email.bounced", { bounce: { type: "Permanent", subType: "General" } }),
    ev(3, "email.bounced", { bounce: { type: "Transient", subType: "General" } }),
    ev(4, "email.delivered"),
    ev(4, "email.complained"),
    { provider_id: null, type: "email.received", payload: {} },
  ]);
  assert.equal(folded.size, 4);
  assert.deepEqual(folded.get("re-1"), { count: 4, delivered: true, bounceHard: false, bounceSoft: false, complained: false, clicks: 2, firstClickContent: { audience: "away", variant: "a" } });
  assert.equal(folded.get("re-2").bounceHard, true);
  assert.equal(folded.get("re-3").bounceSoft, true);
  assert.equal(folded.get("re-3").bounceHard, false);
  assert.equal(folded.get("re-4").complained, true);
});

test("outcome: status and events combine; a bounced status without an event is an unknown bounce", () => {
  assert.deepEqual(deliveryOutcome({ status: "sent" }, undefined), {
    delivered: false, bounced: false, bounceHard: false, bounceSoft: false, bounceUnknown: false, complained: false, clicked: false,
  });
  assert.equal(deliveryOutcome({ status: "delivered" }).delivered, true);
  assert.equal(deliveryOutcome({ status: "complained" }).delivered, true, "a complaint means it arrived");
  const unknown = deliveryOutcome({ status: "bounced" });
  assert.equal(unknown.bounced && unknown.bounceUnknown, true);
  const both = deliveryOutcome({ status: "bounced" }, { bounceHard: true, bounceSoft: true, clicks: 0 });
  assert.deepEqual([both.bounceHard, both.bounceSoft, both.bounceUnknown], [true, false, false], "hard wins over soft");
  assert.equal(deliveryOutcome({ status: "sent" }, { clicks: 1 }).clicked, true);
});

// ── unsubscribe ─────────────────────────────────────────────────────────

test("unsubscribe: own opt-out, campaign or win-back mute, or withdrawn consent; a bounce suppression is not", () => {
  assert.equal(isUnsubscribedNow(user(1)), false);
  assert.equal(isUnsubscribedNow(user(1, { email_prefs: { all: false } })), true);
  assert.equal(isUnsubscribedNow(user(1, { email_prefs: { s6_season: false } })), true);
  assert.equal(isUnsubscribedNow(user(1, { email_prefs: { winback: false } })), true);
  assert.equal(isUnsubscribedNow(user(1, { consent_preferences: { email_marketing: false } })), true);
  assert.equal(isUnsubscribedNow(user(1, { email_prefs: { all: false, suppressed_reason: "bounce" } })), false);
  assert.equal(isUnsubscribedNow(null), false);
});

// ── audience at send time ───────────────────────────────────────────────

test("audience: click link first, then last_seen before the send, then the newest visit before it", () => {
  const sentAtMs = SEND;
  assert.deepEqual(audienceAtSend({ user: user(1), sentAtMs, clickContent: { audience: "away" } }), { audience: "away", source: "click" });
  assert.deepEqual(audienceAtSend({ user: user(1, { last_seen: at(-20) }), sentAtMs }), { audience: "dormant", source: "last_seen" });
  // came back after the mail: last_seen is useless, the visit before the send decides
  const back = user(1, { last_seen: at(2) });
  assert.deepEqual(audienceAtSend({ user: back, sentAtMs, visitTimesMs: [Date.parse(at(-90)), Date.parse(at(-70)), Date.parse(at(1))] }), {
    audience: "away",
    source: "visit_event",
  });
  assert.deepEqual(audienceAtSend({ user: back, sentAtMs, visitTimesMs: [] }), { audience: "unknown", source: "unknown" });
  assert.deepEqual(audienceAtSend({ user: user(1, { last_seen: null }), sentAtMs }), { audience: "away", source: "no_visit" });
});

// ── activity windows ────────────────────────────────────────────────────

test("activity: window is (send, send + N days]; an unfinished window is null", () => {
  const times = [Date.parse(at(0)), Date.parse(at(2))];
  const now = Date.parse(at(5));
  assert.equal(activeWithin(times, SEND, 1, now), false, "an event exactly at the send is not after it");
  assert.equal(activeWithin(times, SEND, 3, now), true);
  assert.equal(activeWithin(times, SEND, 7, now), null, "7 days have not passed");
  assert.equal(activeWithin([Date.parse(at(3))], SEND, 3, now), true, "the window end is included");
});

test("activity index: team rows map to the manager; unknown signals and teams are dropped", () => {
  const index = indexActivity({
    teams: [team(1)],
    activityRows: [
      { signal: "training", team_id: "team-1", at: at(2) },
      { signal: "training", team_id: "team-1", at: at(1) },
      { signal: "login", user_id: "user-1", at: at(1) },
      { signal: "training", team_id: "team-x", at: at(1) },
      { signal: "nope", user_id: "user-1", at: at(1) },
      { signal: "login", user_id: "user-1", at: "not a date" },
    ],
  });
  assert.deepEqual(index.get("user-1").get("training"), [Date.parse(at(1)), Date.parse(at(2))]);
  assert.deepEqual(index.get("user-1").get("login"), [Date.parse(at(1))]);
  assert.equal(index.size, 1);
});

// ── webhook health ──────────────────────────────────────────────────────

test("webhook: sends past the grace with zero events fail loudly", () => {
  const sends = [send(1), send(2)];
  const health = checkWebhookHealth({ sends, eventsByProvider: new Map(), nowMs: Date.parse(at(0, 3)) });
  assert.equal(health.status, "fail");
  assert.equal(health.due, 2);
  assert.match(health.messages[0], /INGEN hændelser/);
});

test("webhook: too fresh to judge is pending, full coverage ok, partial or unlinkable is a warning", () => {
  const sends = [send(1), send(2)];
  assert.equal(checkWebhookHealth({ sends, eventsByProvider: new Map(), nowMs: Date.parse(at(0, 1)) }).status, "pending");
  const all = foldEmailEvents([ev(1, "email.delivered"), ev(2, "email.delivered")]);
  assert.equal(checkWebhookHealth({ sends, eventsByProvider: all, nowMs: Date.parse(at(1)) }).status, "ok");
  const half = foldEmailEvents([ev(1, "email.delivered")]);
  const warn = checkWebhookHealth({ sends, eventsByProvider: half, nowMs: Date.parse(at(1)) });
  assert.equal(warn.status, "warn");
  assert.equal(warn.withEvent, 1);
  const noId = checkWebhookHealth({ sends: [...sends, send(3, { provider_id: null })], eventsByProvider: all, nowMs: Date.parse(at(1)) });
  assert.equal(noId.status, "warn");
  assert.equal(noId.withoutProviderId, 1);
});

// ── traffic ─────────────────────────────────────────────────────────────

test("traffic: unique non-bot visits for the campaign's utm_campaign only", () => {
  const summary = summarizeTrafficUtm({
    utmCampaign: "s6-before-start",
    trafficRows: [
      { utm_campaign: "s6-before-start", visit_hash: "v1", is_bot: false },
      { utm_campaign: "s6-before-start", visit_hash: "v1", is_bot: false },
      { utm_campaign: "s6-before-start", visit_hash: "v2", is_bot: null },
      { utm_campaign: "s6-before-start", visit_hash: "v3", is_bot: true },
      { utm_campaign: "s6-started", visit_hash: "v4", is_bot: false },
    ],
  });
  assert.deepEqual(summary, { utmCampaign: "s6-before-start", events: 3, visits: 2 });
});

// ── the whole report ────────────────────────────────────────────────────

function fixture() {
  const teams = [1, 2, 3, 4, 5].map((i) => team(i));
  const users = [
    user(1, { last_seen: at(2) }), // came back after the mail; clicked
    user(2, { language: "da", last_seen: at(-20) }), // dormant, hard bounce
    user(3, { last_seen: at(-1), email_prefs: { all: false } }), // unsubscribed afterwards
    user(4, { last_seen: at(-3) }), // complaint
    user(5, { last_seen: at(-100) }), // never mailed (not in email_log)
  ];
  const emailLogRows = [
    send(1, { status: "delivered" }),
    send(2, { status: "bounced" }),
    send(3, { status: "delivered" }),
    send(4, { status: "complained" }),
  ];
  const emailEvents = [
    ev(1, "email.delivered"),
    ev(1, "email.clicked", { click: { link: clickLink("active") } }),
    ev(1, "email.clicked", { click: { link: clickLink("active") } }),
    ev(2, "email.bounced", { bounce: { type: "Permanent" } }),
    ev(3, "email.delivered"),
    ev(4, "email.delivered"),
    ev(4, "email.complained"),
  ];
  const activityRows = [
    { signal: "login", user_id: "user-1", at: at(-2) },
    { signal: "login", user_id: "user-1", at: at(0, 5) },
    { signal: "training", team_id: "team-1", at: at(2) },
    { signal: "lineup", team_id: "team-1", at: at(6) },
    { signal: "season_race", team_id: "team-1", at: at(8) },
    { signal: "pro_purchase", team_id: "team-3", at: at(0, 12) },
  ];
  return { teams, users, emailLogRows, emailEvents, activityRows };
}

test("report: every delivery count per group from fixtures", () => {
  const report = buildCampaignReport({ campaign: CAMPAIGN, edition: EDITION, ...fixture(), now: new Date(at(20)) });
  assert.equal(report.totals.sent, 4);
  assert.equal(report.firstSendAt, at(0));
  const byKey = Object.fromEntries(report.groups.map((g) => [`${g.audience}|${g.language}|${g.variant}`, g]));
  assert.deepEqual(Object.keys(byKey), ["active|en|a", "dormant|da|a"]);
  const active = byKey["active|en|a"];
  assert.deepEqual(
    [active.people, active.sent, active.delivered, active.bounced, active.bounceHard, active.complained, active.unsubscribed, active.clicked],
    [3, 3, 3, 0, 0, 1, 1, 1]
  );
  const dormant = byKey["dormant|da|a"];
  assert.deepEqual([dormant.sent, dormant.delivered, dormant.bounced, dormant.bounceHard, dormant.bounceSoft], [1, 0, 1, 1, 0]);
  assert.deepEqual(report.audienceSources, { click: 1, last_seen: 3 });
  assert.equal(report.webhook.status, "ok");
});

test("report: activity after 1/3/7/14 days per signal, last_seen counts as a login", () => {
  const report = buildCampaignReport({ campaign: CAMPAIGN, edition: EDITION, ...fixture(), now: new Date(at(20)) });
  const active = report.groups.find((g) => g.audience === "active");
  const row = (signal) => REPORT_WINDOWS_DAYS.map((d) => active.activity[signal][d].active);
  assert.deepEqual(row("login"), [1, 1, 1, 1], "user-1 logged in hours after the mail");
  assert.deepEqual(row("training"), [0, 1, 1, 1]);
  assert.deepEqual(row("lineup"), [0, 0, 1, 1]);
  assert.deepEqual(row("season_race"), [0, 0, 0, 1]);
  assert.deepEqual(row("pro_purchase"), [1, 1, 1, 1]);
  for (const signal of ACTIVITY_SIGNALS) for (const d of REPORT_WINDOWS_DAYS) assert.equal(active.activity[signal][d].eligible, 3);
});

test("report: windows that have not passed are left out, not counted as zero", () => {
  const report = buildCampaignReport({ campaign: CAMPAIGN, edition: EDITION, ...fixture(), now: new Date(at(4)) });
  const active = report.groups.find((g) => g.audience === "active");
  assert.equal(active.activity.login[3].eligible, 3);
  assert.equal(active.activity.login[7].eligible, 0);
  assert.match(renderCampaignReport(report), /ikke modent/);
});

test("report: no event for any send fails the webhook check", () => {
  const report = buildCampaignReport({ campaign: CAMPAIGN, edition: EDITION, ...fixture(), emailEvents: [], now: new Date(at(1)) });
  assert.equal(report.webhook.status, "fail");
});

test("report: payment webhooks are not visits, and a purchase is the completed-payment event", () => {
  assert.equal(isVisitEvent("checkout_completed"), false);
  assert.equal(isVisitEvent("checkout_started"), false);
  assert.equal(isVisitEvent("session_started"), true);
  assert.equal(PRO_PURCHASE_EVENT_NAME, "checkout_completed");
});

test("report: there is no control group; every group is a mailed group", () => {
  const report = buildCampaignReport({ campaign: CAMPAIGN, edition: EDITION, ...fixture(), now: new Date(at(20)) });
  assert.equal("control" in report.totals, false);
  assert.equal("holdoutFraction" in report, false);
  for (const g of report.groups) assert.ok(g.sent > 0, "every group holds mailed managers");
  assert.equal(/kontrol/i.test(renderCampaignReport(report).replace("ingen kontrolgruppe", "")), false);
});

test("report: no sends gives an empty report with a pending webhook, and unknown campaigns are refused", () => {
  const report = buildCampaignReport({ campaign: CAMPAIGN, edition: EDITION, teams: [team(1)], users: [user(1)], now: new Date(at(1)) });
  assert.equal(report.totals.sent, 0);
  assert.equal(report.webhook.status, "pending");
  assert.deepEqual(report.groups, []);
  assert.throws(() => buildCampaignReport({ campaign: "nope", edition: EDITION, now: new Date(at(1)) }), /unknown campaign/);
  assert.throws(() => buildCampaignReport({ campaign: CAMPAIGN, edition: EDITION }), /needs now/);
});

test("render: the private markdown holds counts, never addresses or ids", () => {
  const report = buildCampaignReport({
    campaign: CAMPAIGN,
    edition: EDITION,
    ...fixture(),
    trafficRows: [{ utm_campaign: "s6-before-start", visit_hash: "v1", is_bot: false }],
    posthogRows: [{ utmContent: "active-a", persons: 2, sessions: 3 }],
    now: new Date(at(20)),
  });
  const md = renderCampaignReport(report);
  assert.match(md, /Webhook-sundhed: OK/);
  assert.match(md, /\| Aktiv · EN · A \| 3 \|/);
  assert.match(md, /active-a \| 2 \| 3/);
  assert.equal(md.includes("@"), false);
  assert.equal(/user-\d|team-\d|re-\d/.test(md), false);
  assert.match(renderCampaignReport({ ...report, utm: { ...report.utm, posthog: null } }), /PostHog: ikke læst/);
});
