import test from "node:test";
import assert from "node:assert/strict";
import {
  TEMPLATE_TYPES,
  buildWelcomeEmail,
  buildDay1Email,
  buildRaceDigestEmail,
  buildLoopEmail,
} from "./emailTemplates.js";

const EM_DASH = "—";
const UNSUB_URL = "https://cyclingzone.org/api/email/unsubscribe?token=abc.def";

function assertNoEmDash(template, label) {
  assert.ok(!template.subject.includes(EM_DASH), `${label} subject has no em-dash`);
  assert.ok(!template.html.includes(EM_DASH), `${label} html has no em-dash`);
  assert.ok(!template.text.includes(EM_DASH), `${label} text has no em-dash`);
}

function assertHasUnsubscribeLink(template) {
  assert.ok(template.html.includes(UNSUB_URL), "html contains the unsubscribe URL");
  assert.ok(template.text.includes(UNSUB_URL), "text contains the unsubscribe URL");
}

test("TEMPLATE_TYPES lists the three loop email types", () => {
  assert.deepEqual(TEMPLATE_TYPES, ["welcome", "day1", "race_digest"]);
});

test("welcome email: subject, dashboard link, unsubscribe link, no em-dash", () => {
  const t = buildWelcomeEmail({ teamName: "Team Velodrome", unsubscribeUrl: UNSUB_URL });
  assert.equal(t.subject, "Your team is on the start line");
  assert.ok(t.html.includes("Team Velodrome"));
  assert.ok(t.html.includes("https://cyclingzone.org/dashboard"));
  assert.ok(t.text.includes("https://cyclingzone.org/dashboard"));
  assertHasUnsubscribeLink(t);
  assertNoEmDash(t, "welcome");
});

test("welcome email falls back gracefully when teamName is missing", () => {
  const t = buildWelcomeEmail({ teamName: null, unsubscribeUrl: UNSUB_URL });
  assert.ok(t.html.includes("your team"));
  assert.ok(!t.html.includes("null"));
});

test("day1 email (hasResults=true): subject, dashboard link, unsubscribe link, no em-dash", () => {
  const t = buildDay1Email({ teamName: "Team Velodrome", hasResults: true, unsubscribeUrl: UNSUB_URL });
  assert.equal(t.subject, "Day 1: your first results are in");
  assert.ok(t.html.includes("Team Velodrome"));
  assert.ok(t.html.includes("already on the board"));
  assert.ok(t.html.includes("https://cyclingzone.org/dashboard"));
  assertHasUnsubscribeLink(t);
  assertNoEmDash(t, "day1 hasResults=true");
});

test("day1 email (hasResults=false): truthful variant, no invented results claim, no em-dash", () => {
  const t = buildDay1Email({ teamName: "Team Velodrome", hasResults: false, unsubscribeUrl: UNSUB_URL });
  assert.equal(t.subject, "Day 1: your first race is coming up");
  assert.ok(t.html.includes("Team Velodrome"));
  assert.ok(!t.html.includes("already on the board"), "must not claim results exist when they don't");
  assert.ok(!t.text.includes("already on the board"));
  assert.ok(t.html.includes("on the calendar"));
  assert.ok(t.html.includes("https://cyclingzone.org/dashboard"));
  assertHasUnsubscribeLink(t);
  assertNoEmDash(t, "day1 hasResults=false");
});

test("race_digest email: subject, results link, unsubscribe link, no em-dash", () => {
  const t = buildRaceDigestEmail({
    teamName: "Team Velodrome",
    results: [
      { riderName: "Jonas Vingegaard", rank: 3, raceName: "Vuelta a Andalucia" },
      { riderName: "Wout van Aert-ish", rank: 1, raceName: "GP Sample" },
    ],
    unsubscribeUrl: UNSUB_URL,
  });
  assert.equal(t.subject, "Race day: how your team did today");
  assert.ok(t.html.includes("Jonas Vingegaard"));
  assert.ok(t.html.includes("rank 3"));
  assert.ok(t.html.includes("Vuelta a Andalucia"));
  assert.ok(t.html.includes("https://cyclingzone.org/resultater"));
  assertHasUnsubscribeLink(t);
  assertNoEmDash(t, "race_digest");
});

test("race_digest email is purely data-driven: no results produces a generic (not invented) line", () => {
  const t = buildRaceDigestEmail({ teamName: "Team Velodrome", results: [], unsubscribeUrl: UNSUB_URL });
  assert.ok(t.html.includes("results from today are ready"));
  assert.ok(!/rank \d/.test(t.html), "no invented rank when there are no results");
});

test("race_digest email escapes rider/race names (no HTML injection from race_results data)", () => {
  const t = buildRaceDigestEmail({
    teamName: "Team <script>",
    results: [{ riderName: "<b>Rider</b>", rank: 1, raceName: "<i>Race</i>" }],
    unsubscribeUrl: UNSUB_URL,
  });
  assert.ok(!t.html.includes("<script>"));
  assert.ok(!t.html.includes("<b>Rider</b>"));
  assert.ok(t.html.includes("&lt;b&gt;Rider&lt;/b&gt;"));
});

test("unsubscribe URL is quote-escaped so a value cannot break out of the href attribute", () => {
  // The unsubscribe URL is the one caller-provided value that lands inside an
  // href="..." attribute. A double quote in it must be entity-encoded, or the
  // value could close the attribute and inject markup (CodeQL js/incomplete-
  // html-attribute-sanitization).
  const t = buildWelcomeEmail({
    teamName: "T",
    unsubscribeUrl: 'https://cyclingzone.org/u?token="><script>alert(1)</script>',
  });
  assert.ok(!t.html.includes('"><script>'), "attribute-breaking sequence must not survive");
  assert.ok(t.html.includes("&quot;&gt;&lt;script&gt;"), "quote and angle brackets are entity-encoded");
});

test("buildLoopEmail dispatches by type", () => {
  const welcome = buildLoopEmail("welcome", { teamName: "T", unsubscribeUrl: UNSUB_URL });
  assert.equal(welcome.subject, "Your team is on the start line");
  const day1 = buildLoopEmail("day1", { teamName: "T", hasResults: true, unsubscribeUrl: UNSUB_URL });
  assert.equal(day1.subject, "Day 1: your first results are in");
  const digest = buildLoopEmail("race_digest", { teamName: "T", results: [], unsubscribeUrl: UNSUB_URL });
  assert.equal(digest.subject, "Race day: how your team did today");
});

test("buildLoopEmail throws for an unknown type", () => {
  assert.throws(() => buildLoopEmail("nonexistent", {}));
});
