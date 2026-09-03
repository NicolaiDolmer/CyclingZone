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
const DISCORD_URL = "https://discord.gg/ykysBrWUyC";

function assertNoEmDash(template, label) {
  assert.ok(!template.subject.includes(EM_DASH), `${label} subject has no em-dash`);
  assert.ok(!template.html.includes(EM_DASH), `${label} html has no em-dash`);
  assert.ok(!template.text.includes(EM_DASH), `${label} text has no em-dash`);
}

function assertHasUnsubscribeLink(template) {
  assert.ok(template.html.includes(UNSUB_URL), "html contains the unsubscribe URL");
  assert.ok(template.text.includes(UNSUB_URL), "text contains the unsubscribe URL");
}

// #2853 v2: signature + Discord CTA are rendered by the shared wrapHtml/
// wrapText for EVERY template, not per-template copy — assert them once here
// and reuse across all three templates' tests instead of repeating.
function assertHasSharedFooter(template) {
  assert.ok(template.html.includes("Dolmer, Cycling Zone"), "html signed by Dolmer");
  assert.ok(template.text.includes("Dolmer, Cycling Zone"), "text signed by Dolmer");
  assert.ok(template.html.includes("Come say hi on Discord, I read everything."), "html has the Discord line");
  assert.ok(template.text.includes("Come say hi on Discord, I read everything."), "text has the Discord line");
  assert.ok(template.html.includes(DISCORD_URL), "html links to Discord");
  assert.ok(template.text.includes(DISCORD_URL), "text links to Discord");
}

test("TEMPLATE_TYPES lists the three loop email types", () => {
  assert.deepEqual(TEMPLATE_TYPES, ["welcome", "day1", "race_digest"]);
});

// ─── welcome ────────────────────────────────────────────────────────────────

test("welcome email: subject, dashboard link, unsubscribe link, shared footer, no em-dash", () => {
  const t = buildWelcomeEmail({ teamName: "Team Velodrome", unsubscribeUrl: UNSUB_URL });
  assert.equal(t.subject, "Your team is on the start line");
  assert.ok(t.html.includes("Team Velodrome"));
  assert.ok(t.html.includes("https://cyclingzone.org/dashboard"));
  assert.ok(t.text.includes("https://cyclingzone.org/dashboard"));
  assertHasUnsubscribeLink(t);
  assertHasSharedFooter(t);
  assertNoEmDash(t, "welcome");
});

test("welcome email falls back gracefully when teamName is missing", () => {
  const t = buildWelcomeEmail({ teamName: null, unsubscribeUrl: UNSUB_URL });
  assert.ok(t.html.includes("your team"));
  assert.ok(!t.html.includes("null"));
});

test("welcome email renders the three numbered steps as table rows, not a bare <ol>", () => {
  const t = buildWelcomeEmail({ teamName: "Team Velodrome", unsubscribeUrl: UNSUB_URL });
  assert.ok(!t.html.includes("<ol"), "steps are table rows per the locked layout, not a list");
  assert.ok(t.html.includes("Bid on a rider you like"));
  assert.ok(t.html.includes("Sign a young rider"));
  assert.ok(t.html.includes("Training and lineup"));
  assert.ok(t.text.includes("1. Bid on a rider you like"));
  assert.ok(t.text.includes("2. Sign a young rider"));
  assert.ok(t.text.includes("3. Training and lineup"));
});

test("welcome email band shows the CYCLING ZONE wordmark and the START LINE eyebrow", () => {
  const t = buildWelcomeEmail({ teamName: "T", unsubscribeUrl: UNSUB_URL });
  assert.ok(t.html.includes("CYCLING"));
  assert.ok(t.html.includes(">ZONE<"), "ZONE rendered in its own gold span");
  assert.ok(t.html.includes("START LINE"));
});

// ─── day1 ───────────────────────────────────────────────────────────────────

test("day1 email (hasResults=true): subject, dashboard link, unsubscribe link, shared footer, no em-dash", () => {
  const t = buildDay1Email({ teamName: "Team Velodrome", hasResults: true, unsubscribeUrl: UNSUB_URL });
  assert.equal(t.subject, "Day 1: your riders have already raced");
  assert.ok(t.html.includes("Team Velodrome"));
  assert.ok(t.html.includes("raced while you were away"));
  assert.match(t.html, /href="https:\/\/cyclingzone\.org\/dashboard\?utm_source=email&amp;utm_medium=day1&amp;utm_campaign=day1"/);
  assertHasUnsubscribeLink(t);
  assertHasSharedFooter(t);
  assertNoEmDash(t, "day1 hasResults=true");
});

test("day1 email (hasResults=false): truthful variant, no invented results claim, no em-dash", () => {
  const t = buildDay1Email({ teamName: "Team Velodrome", hasResults: false, unsubscribeUrl: UNSUB_URL });
  assert.equal(t.subject, "Day 1: your first race is on the calendar");
  assert.ok(t.html.includes("Team Velodrome"));
  assert.ok(!t.html.includes("raced while you were away"), "must not claim results exist when they don't");
  assert.ok(!t.text.includes("raced while you were away"));
  assert.ok(t.html.includes("on the calendar"));
  // Pin selve href'en, ikke bare en delstreng et vilkårligt sted i mailen:
  // includes("https://cyclingzone.org/dashboard") ville også passere hvis
  // URL'en kun stod som brødtekst, eller hvis CTA'en pegede på
  // https://cyclingzone.org/dashboard.angriber.dk. (CodeQL
  // js/incomplete-url-substring-sanitization flagede præcis det mønster.)
  assert.match(t.html, /href="https:\/\/cyclingzone\.org\/dashboard\?utm_source=email&amp;utm_medium=day1&amp;utm_campaign=day1"/);
  assertHasUnsubscribeLink(t);
  assertNoEmDash(t, "day1 hasResults=false");
});

test("day1 email no longer accepts a per-race deep link (#2853 v2 dropped #3310/#3912): CTA is always the dashboard", () => {
  const t = buildDay1Email({
    teamName: "Team X",
    hasResults: true,
    latestRaceId: "race-42", // ignored — extra unused arg, must not change the CTA
    latestStageNumber: 3,
    unsubscribeUrl: UNSUB_URL,
  });
  assert.match(t.html, /href="https:\/\/cyclingzone\.org\/dashboard\?utm_source=email&amp;utm_medium=day1&amp;utm_campaign=day1"/);
  assert.ok(!t.html.includes("/races/"));
});

// ─── race_digest ────────────────────────────────────────────────────────────

test("race_digest email: subject includes team name, results link, unsubscribe link, shared footer, no em-dash", () => {
  const t = buildRaceDigestEmail({
    teamName: "Team Velodrome",
    results: [
      { riderName: "Jonas Vingegaard", rank: 3, raceName: "Vuelta a Andalucia" },
      { riderName: "Wout van Aert-ish", rank: 1, raceName: "GP Sample" },
    ],
    unsubscribeUrl: UNSUB_URL,
  });
  assert.equal(t.subject, "Team Velodrome raced while you were away");
  assert.ok(t.html.includes("Best results since your last visit"));
  assert.ok(t.html.includes("Jonas Vingegaard"));
  assert.ok(t.html.includes("rank 3"));
  assert.ok(t.html.includes("Vuelta a Andalucia"));
  assert.ok(t.html.includes("https://cyclingzone.org/resultater"));
  assertHasUnsubscribeLink(t);
  assertHasSharedFooter(t);
  assertNoEmDash(t, "race_digest");
});

test("race_digest email falls back to a generic subject/name when teamName is missing", () => {
  const t = buildRaceDigestEmail({ teamName: null, results: [{ riderName: "R", rank: 1, raceName: "Race" }], unsubscribeUrl: UNSUB_URL });
  assert.equal(t.subject, "Your team raced while you were away");
  assert.ok(!t.html.includes("null"));
});

test("race_digest email is purely data-driven: no results produces a generic (not invented) line", () => {
  const t = buildRaceDigestEmail({ teamName: "Team Velodrome", results: [], unsubscribeUrl: UNSUB_URL });
  assert.ok(t.html.includes("results since your last visit are ready"));
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

test("race_digest email no longer renders a #3399 narrative headline (#2853 v2 dropped it): an ignored headline arg changes nothing", () => {
  const t = buildRaceDigestEmail({
    teamName: "Team Velodrome",
    results: [{ riderName: "Krogh", rank: 1, raceName: "GP Sample" }],
    headline: "Krogh takes the sprint", // ignored — extra unused arg
    unsubscribeUrl: UNSUB_URL,
  });
  assert.ok(!t.html.includes("Krogh takes the sprint"));
  assert.ok(!t.html.includes("Your best moment"));
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

// ─── #2853 · UTM on every CTA link (utm_source=email, medium/campaign=type) ─
// The Discord CTA deliberately carries no UTM — it leaves the funnel this
// tagging measures.

test("welcome email CTA carries utm_source=email&utm_medium=welcome&utm_campaign=welcome", () => {
  const t = buildWelcomeEmail({ teamName: "T", unsubscribeUrl: UNSUB_URL });
  assert.match(t.html, /href="https:\/\/cyclingzone\.org\/dashboard\?utm_source=email&amp;utm_medium=welcome&amp;utm_campaign=welcome"/);
  assert.match(t.text, /Open your dashboard: https:\/\/cyclingzone\.org\/dashboard\?utm_source=email&utm_medium=welcome&utm_campaign=welcome$/m);
});

test("race_digest email CTA carries utm_source=email&utm_medium=race_digest&utm_campaign=race_digest", () => {
  const t = buildRaceDigestEmail({ teamName: "T", results: [{ riderName: "R", rank: 1, raceName: "Race" }], unsubscribeUrl: UNSUB_URL });
  assert.match(t.html, /href="https:\/\/cyclingzone\.org\/resultater\?utm_source=email&amp;utm_medium=race_digest&amp;utm_campaign=race_digest"/);
  assert.match(t.text, /See all results: https:\/\/cyclingzone\.org\/resultater\?utm_source=email&utm_medium=race_digest&utm_campaign=race_digest$/m);
});

test("UTM query string is never present on the unsubscribe link or the Discord link, only on the primary CTA", () => {
  const t = buildWelcomeEmail({ teamName: "T", unsubscribeUrl: UNSUB_URL });
  assert.ok(!t.html.includes(`${UNSUB_URL}?utm`), "unsubscribe link must stay exactly what the caller passed in");
  assert.ok(!t.html.includes(`${DISCORD_URL}?utm`), "Discord link must stay untagged");
  assertHasUnsubscribeLink(t);
});

test("buildLoopEmail dispatches by type", () => {
  const welcome = buildLoopEmail("welcome", { teamName: "T", unsubscribeUrl: UNSUB_URL });
  assert.equal(welcome.subject, "Your team is on the start line");
  const day1 = buildLoopEmail("day1", { teamName: "T", hasResults: true, unsubscribeUrl: UNSUB_URL });
  assert.equal(day1.subject, "Day 1: your riders have already raced");
  const digest = buildLoopEmail("race_digest", { teamName: "T", results: [], unsubscribeUrl: UNSUB_URL });
  assert.equal(digest.subject, "T raced while you were away");
});

test("buildLoopEmail throws for an unknown type", () => {
  assert.throws(() => buildLoopEmail("nonexistent", {}));
});

// ─── #2853 DA follow-up (2026-09-03): users.language selects EN vs DA copy ──
// Faithful translation of the locked EN text in
// docs/drafts/mailtekster-2853-v2-dolmer-2026-09-02.md, added in this PR's
// "DA-oversaettelse" section. 'da' selects the Danish copy; any other value
// (including undefined/unset) falls back to English, matching the
// frontend's LanguageProvider default.

const EN_MARKERS = [
  "Hi,",
  "Open your dashboard",
  "See all results",
  "Join the Discord",
  "Something broken or confusing? Come say hi on Discord, I read everything.",
  "You are receiving this because you have a Cycling Zone account.",
  "Unsubscribe from these emails",
];

function assertNoEnglishResidue(template) {
  for (const marker of EN_MARKERS) {
    assert.ok(!template.html.includes(marker), `html must not contain English marker "${marker}"`);
    assert.ok(!template.text.includes(marker), `text must not contain English marker "${marker}"`);
  }
}

test("welcome email: language 'da' renders Danish subject, body, steps and shared footer, no em-dash, no English residue", () => {
  const t = buildWelcomeEmail({ teamName: "Team Velodrome", unsubscribeUrl: UNSUB_URL, language: "da" });
  assert.equal(t.subject, "Dit hold er på startlinjen");
  assert.ok(t.html.includes("Velkommen til Cycling Zone"));
  assert.ok(t.html.includes("Team Velodrome"));
  assert.ok(t.html.includes("Byd på en rytter du kan lide"));
  assert.ok(t.html.includes("Skriv en ung rytter under kontrakt"));
  assert.ok(t.html.includes("Træning og opstilling"));
  assert.ok(t.text.includes("1. Byd på en rytter du kan lide"));
  assert.ok(t.html.includes("Åbn dit dashboard"));
  assert.ok(t.html.includes("Er noget i stykker eller uklart? Kom forbi Discord, jeg læser alt."));
  assert.ok(t.html.includes("Deltag i Discord"));
  assert.ok(t.html.includes("Dolmer, Cycling Zone"));
  assert.ok(t.html.includes("Afmeld disse mails"));
  assertHasUnsubscribeLink(t);
  assertNoEmDash(t, "welcome da");
  assertNoEnglishResidue(t);
});

test("welcome email: language 'da' falls back to 'dit hold' when teamName is missing", () => {
  const t = buildWelcomeEmail({ teamName: null, unsubscribeUrl: UNSUB_URL, language: "da" });
  assert.ok(t.html.includes("dit hold"));
  assert.ok(!t.html.includes("null"));
});

test("welcome email: any language other than 'da' (including unset) renders the English copy", () => {
  const noLang = buildWelcomeEmail({ teamName: "T", unsubscribeUrl: UNSUB_URL });
  const unknownLang = buildWelcomeEmail({ teamName: "T", unsubscribeUrl: UNSUB_URL, language: "fr" });
  assert.equal(noLang.subject, "Your team is on the start line");
  assert.equal(unknownLang.subject, "Your team is on the start line");
});

test("day1 email: language 'da' renders the Danish copy for both hasResults variants, no em-dash, no English residue", () => {
  const withResults = buildDay1Email({ teamName: "Team Velodrome", hasResults: true, unsubscribeUrl: UNSUB_URL, language: "da" });
  assert.equal(withResults.subject, "Dag 1: dine ryttere har allerede kørt");
  assert.ok(withResults.html.includes("kørte mens du var væk"));
  assertNoEmDash(withResults, "day1 da hasResults=true");
  assertNoEnglishResidue(withResults);

  const noResults = buildDay1Email({ teamName: "Team Velodrome", hasResults: false, unsubscribeUrl: UNSUB_URL, language: "da" });
  assert.equal(noResults.subject, "Dag 1: dit første løb er på kalenderen");
  assert.ok(noResults.html.includes("første løb er på kalenderen"));
  assert.ok(!noResults.html.includes("kørte mens du var væk"), "must not claim results exist when they don't (DA)");
  assertNoEmDash(noResults, "day1 da hasResults=false");
  assertNoEnglishResidue(noResults);
});

test("race_digest email: language 'da' renders the Danish copy, uses 'placering' for rank, no em-dash, no English residue", () => {
  const t = buildRaceDigestEmail({
    teamName: "Team Velodrome",
    results: [{ riderName: "Jonas Vingegaard", rank: 3, raceName: "Vuelta a Andalucia" }],
    unsubscribeUrl: UNSUB_URL,
    language: "da",
  });
  assert.equal(t.subject, "Team Velodrome kørte mens du var væk");
  assert.ok(t.html.includes("Bedste resultater siden dit sidste besøg"));
  assert.ok(t.html.includes("placering 3 i Vuelta a Andalucia"));
  assert.ok(t.html.includes("Se alle resultater"));
  assertNoEmDash(t, "race_digest da");
  assertNoEnglishResidue(t);
});

test("race_digest email: language 'da' with no results uses the Danish generic line, not an invented one", () => {
  const t = buildRaceDigestEmail({ teamName: "Team Velodrome", results: [], unsubscribeUrl: UNSUB_URL, language: "da" });
  assert.ok(t.html.includes("Dit holds resultater siden dit sidste besøg er klar."));
  assert.ok(!/placering \d/.test(t.html), "no invented rank when there are no results (DA)");
});

test("race_digest email: language 'da' falls back to 'Dit hold' when teamName is missing", () => {
  const t = buildRaceDigestEmail({ teamName: null, results: [{ riderName: "R", rank: 1, raceName: "Race" }], unsubscribeUrl: UNSUB_URL, language: "da" });
  assert.equal(t.subject, "Dit hold kørte mens du var væk");
});

test("buildLoopEmail passes language through for all three types", () => {
  const welcome = buildLoopEmail("welcome", { teamName: "T", unsubscribeUrl: UNSUB_URL, language: "da" });
  assert.equal(welcome.subject, "Dit hold er på startlinjen");
  const day1 = buildLoopEmail("day1", { teamName: "T", hasResults: true, unsubscribeUrl: UNSUB_URL, language: "da" });
  assert.equal(day1.subject, "Dag 1: dine ryttere har allerede kørt");
  const digest = buildLoopEmail("race_digest", { teamName: "T", results: [], unsubscribeUrl: UNSUB_URL, language: "da" });
  assert.equal(digest.subject, "T kørte mens du var væk");
});
