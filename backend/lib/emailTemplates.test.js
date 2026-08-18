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
  // Pin selve href'en, ikke bare en delstreng et vilkårligt sted i mailen:
  // includes("https://cyclingzone.org/dashboard") ville også passere hvis
  // URL'en kun stod som brødtekst, eller hvis CTA'en pegede på
  // https://cyclingzone.org/dashboard.angriber.dk. (CodeQL
  // js/incomplete-url-substring-sanitization flagede præcis det mønster.)
  assert.match(t.html, /href="https:\/\/cyclingzone\.org\/dashboard"/);
  assertHasUnsubscribeLink(t);
  assertNoEmDash(t, "day1 hasResults=false");
});

test("day1 med latestRaceId deep-linker CTA til løbssiden", () => {
  const t = buildDay1Email({ teamName: "Team X", hasResults: true, latestRaceId: "race-42", unsubscribeUrl: UNSUB_URL });
  assert.match(t.html, /href="https:\/\/cyclingzone\.org\/races\/race-42"/);
  // Plaintext-varianten har ingen href — pin hele CTA-linjen i stedet, så
  // URL'en skal stå alene og komplet til linjeslut.
  assert.match(t.text, /^See your results and auctions: https:\/\/cyclingzone\.org\/races\/race-42$/m);
  assertNoEmDash(t, "day1 latestRaceId");
  assertHasUnsubscribeLink(t);
});

test("day1 uden latestRaceId falder tilbage til dashboard-URL", () => {
  const t = buildDay1Email({ teamName: "Team X", hasResults: true, latestRaceId: null, unsubscribeUrl: UNSUB_URL });
  assert.match(t.html, /href="https:\/\/cyclingzone\.org\/dashboard"/);
});

// ─── #3912 · CTA deep-links to the specific stage's result ────────────────

test("day1 med latestRaceId og latestStageNumber deep-linker CTA til etapens resultat", () => {
  const t = buildDay1Email({
    teamName: "Team X",
    hasResults: true,
    latestRaceId: "race-42",
    latestStageNumber: 3,
    unsubscribeUrl: UNSUB_URL,
  });
  // Pin hele href'en (samme sanitization-begrundelse som testen ovenfor):
  // includes() ville også passere for en href med vores URL som præfiks på
  // et fremmed host.
  assert.match(t.html, /href="https:\/\/cyclingzone\.org\/races\/race-42\?stage=3"/);
  assert.match(t.text, /^See your results and auctions: https:\/\/cyclingzone\.org\/races\/race-42\?stage=3$/m);
  assertNoEmDash(t, "day1 latestStageNumber");
});

test("day1 med latestRaceId men uden latestStageNumber (single-day race/legacy data) falder tilbage til det rene løbslink", () => {
  const t = buildDay1Email({
    teamName: "Team X",
    hasResults: true,
    latestRaceId: "race-42",
    latestStageNumber: null,
    unsubscribeUrl: UNSUB_URL,
  });
  assert.match(t.html, /href="https:\/\/cyclingzone\.org\/races\/race-42"/);
  assert.ok(!t.html.includes("?stage="));
});

test("day1 ignorerer et ugyldigt latestStageNumber (0/negativt/ikke-heltal) i stedet for at bygge en korrupt URL", () => {
  for (const bad of [0, -1, 1.5, "3", NaN]) {
    const t = buildDay1Email({
      teamName: "Team X",
      hasResults: true,
      latestRaceId: "race-42",
      latestStageNumber: bad,
      unsubscribeUrl: UNSUB_URL,
    });
    assert.ok(!t.html.includes("?stage="), `latestStageNumber=${bad} must not produce a ?stage= param`);
  }
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

// ─── #3399 · narrative headline leads the digest ──────────────────────────

test("race_digest email: with headline, leads with the rubric + the manager's best moment, keeps the list", () => {
  const t = buildRaceDigestEmail({
    teamName: "Team Velodrome",
    results: [
      { riderName: "Jonas Vingegaard", rank: 3, raceName: "Vuelta a Andalucia" },
      { riderName: "Krogh", rank: 1, raceName: "GP Sample" },
    ],
    headline: "Krogh takes the sprint",
    unsubscribeUrl: UNSUB_URL,
  });
  assert.ok(t.html.includes("Krogh takes the sprint"), "leads with the narrative headline");
  assert.ok(t.html.includes("Your best moment: Krogh placed rank 1 in GP Sample"), "best (lowest-rank) result, not just the first list entry");
  assert.ok(t.html.includes("Jonas Vingegaard"), "the full results list is still present, not replaced");
  assert.ok(t.text.includes("Krogh takes the sprint"));
  assert.ok(t.text.includes("Your best moment: Krogh placed rank 1 in GP Sample"));
  assertNoEmDash(t, "race_digest with headline");
});

test("race_digest email: without headline (existing callers), renders exactly as before #3399", () => {
  const t = buildRaceDigestEmail({
    teamName: "Team Velodrome",
    results: [{ riderName: "Jonas Vingegaard", rank: 3, raceName: "Vuelta a Andalucia" }],
    unsubscribeUrl: UNSUB_URL,
  });
  assert.ok(!t.html.includes("Your best moment"), "no best-moment line without a headline (nothing invented)");
  assert.equal((t.html.match(/font-weight:600/g) || []).length, 1, "only the CTA link is bold — no extra headline paragraph rendered");
});

test("race_digest email: headline without any ranked result never invents a best-moment line", () => {
  const t = buildRaceDigestEmail({
    teamName: "Team Velodrome",
    results: [],
    headline: "Krogh takes the sprint",
    unsubscribeUrl: UNSUB_URL,
  });
  assert.ok(t.html.includes("Krogh takes the sprint"), "headline alone can still render");
  assert.ok(!t.html.includes("Your best moment"), "no results to point to => no invented best-moment line");
});

test("race_digest email: headline text is HTML-escaped", () => {
  const t = buildRaceDigestEmail({
    teamName: "Team",
    results: [{ riderName: "Rider", rank: 1, raceName: "Race" }],
    headline: "<script>alert(1)</script>",
    unsubscribeUrl: UNSUB_URL,
  });
  assert.ok(!t.html.includes("<script>alert(1)</script>"));
  assert.ok(t.html.includes("&lt;script&gt;"));
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
