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
const WORDMARK_URL = "https://cyclingzone.org/brand/wordmark-email.png";
const NAVY = "#1B2A4A";
const GOLD = "#C9A227";

// Escapes a literal string for use inside a RegExp (not a URL/host check -
// this only builds an exact-match pattern for fixture assertions below).
function escapeRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
  assert.match(
    template.html,
    new RegExp(`href="${escapeRegExp(DISCORD_URL)}"`),
    "html links to Discord",
  );
  assert.match(
    template.text,
    new RegExp(`:\\s${escapeRegExp(DISCORD_URL)}(?:\\s|$)`),
    "text links to Discord",
  );
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

test("welcome email band shows the wordmark image and the START LINE eyebrow", () => {
  const t = buildWelcomeEmail({ teamName: "T", unsubscribeUrl: UNSUB_URL });
  assert.ok(t.html.includes("START LINE"));
  assert.ok(
    t.html.includes(`src="${WORDMARK_URL}"`),
    "band uses the hosted brand wordmark PNG, not a system-font text logotype",
  );
  assert.ok(!t.html.includes(">ZONE<"), "the old text wordmark span is gone");
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

// ─── shell: dark-mode lock, wordmark, radius (#2853 follow-up 2026-09-08) ────
//
// The owner opened a test mail in Outlook.com (hotmail) dark mode and got a
// slate-grey band, olive buttons and white button labels: the client had
// repainted every colour we set inline. These tests pin the three defences
// that answer that (meta tags, [data-ogsc]/[data-ogsb] + prefers-color-scheme
// overrides, bgcolor attributes) plus the wordmark image and the 5px radius,
// once for every template and both languages, so a future edit to wrapHtml
// cannot quietly drop one of them.

function allTemplates() {
  return [
    ["welcome en", buildWelcomeEmail({ teamName: "T", unsubscribeUrl: UNSUB_URL })],
    ["welcome da", buildWelcomeEmail({ teamName: "T", unsubscribeUrl: UNSUB_URL, language: "da" })],
    ["day1 hasResults", buildDay1Email({ teamName: "T", hasResults: true, unsubscribeUrl: UNSUB_URL })],
    ["day1 noResults", buildDay1Email({ teamName: "T", hasResults: false, unsubscribeUrl: UNSUB_URL })],
    [
      "race_digest",
      buildRaceDigestEmail({
        teamName: "T",
        results: [{ riderName: "R", rank: 1, raceName: "Race" }],
        unsubscribeUrl: UNSUB_URL,
      }),
    ],
  ];
}

test("every template declares a light-only colour scheme in the head", () => {
  for (const [label, t] of allTemplates()) {
    assert.ok(t.html.includes('<meta name="color-scheme" content="light">'), `${label}: color-scheme meta`);
    assert.ok(
      t.html.includes('<meta name="supported-color-schemes" content="light">'),
      `${label}: supported-color-schemes meta`,
    );
    assert.ok(t.html.includes("color-scheme:light;supported-color-schemes:light;"), `${label}: root color-scheme`);
  }
});

test("every template ships the Outlook.com dark-mode overrides for band, buttons and body", () => {
  for (const [label, t] of allTemplates()) {
    assert.ok(
      t.html.includes(`[data-ogsc] .cz-band,[data-ogsb] .cz-band{background-color:${NAVY} !important;}`),
      `${label}: band stays navy in Outlook dark mode`,
    );
    assert.ok(
      t.html.includes(
        `[data-ogsc] .cz-btn,[data-ogsb] .cz-btn{background-color:${GOLD} !important;color:${NAVY} !important;}`,
      ),
      `${label}: primary button stays gold with a navy label`,
    );
    assert.ok(
      t.html.includes(`[data-ogsc] .cz-btn-label,[data-ogsb] .cz-btn-label{color:${NAVY} !important;}`),
      `${label}: inner label span locked`,
    );
    assert.ok(
      t.html.includes(`[data-ogsc] .cz-card,[data-ogsb] .cz-card{background-color:#ffffff !important;}`),
      `${label}: card stays white`,
    );
    // Every selector in a group must carry its own prefix; a bare ".cz-body p"
    // in the Outlook block would leak the override into light mode too.
    assert.ok(
      t.html.includes(
        `[data-ogsc] .cz-text,[data-ogsb] .cz-text,[data-ogsc] .cz-body p,[data-ogsb] .cz-body p,` +
          `[data-ogsc] .cz-body li,[data-ogsb] .cz-body li{color:#1a1a1a !important;}`,
      ),
      `${label}: multi-selector groups are prefixed per selector`,
    );
  }
});

test("every template ships a prefers-color-scheme dark block with the same colours", () => {
  for (const [label, t] of allTemplates()) {
    const media = t.html.match(/@media \(prefers-color-scheme:dark\)\{[\s\S]*?\}\}/);
    assert.ok(media, `${label}: has a prefers-color-scheme dark block`);
    const css = media[0];
    assert.ok(css.includes(`.cz-band{background-color:${NAVY} !important;}`), `${label}: band navy`);
    assert.ok(css.includes(`.cz-btn{background-color:${GOLD} !important;color:${NAVY} !important;}`), `${label}: button gold`);
    assert.ok(css.includes(`.cz-btn-label{color:${NAVY} !important;}`), `${label}: button label navy`);
    assert.ok(css.includes(`.cz-card{background-color:#ffffff !important;}`), `${label}: body stays white`);
  }
});

test("every coloured cell carries a bgcolor attribute next to the inline background", () => {
  for (const [label, t] of allTemplates()) {
    assert.ok(t.html.includes(`bgcolor="${NAVY}"`), `${label}: navy band has bgcolor`);
    assert.ok(t.html.includes('bgcolor="#ffffff"'), `${label}: white card has bgcolor`);
    assert.ok(t.html.includes('bgcolor="#f4f4f4"'), `${label}: page background has bgcolor`);
  }
});

test("the wordmark is an image with alt text and a styled fallback for blocked images", () => {
  for (const [label, t] of allTemplates()) {
    assert.ok(t.html.includes(`src="${WORDMARK_URL}"`), `${label}: hosted wordmark PNG`);
    assert.ok(t.html.includes('alt="Cycling Zone"'), `${label}: alt text`);
    assert.match(t.html, /<img src="[^"]+wordmark-email\.png" alt="Cycling Zone" width="\d+" height="\d+"/, `${label}: sized img`);
    // When the image is blocked the alt text inherits the img's own font
    // styles, so it still reads as an uppercase white logotype on the band.
    const img = t.html.match(/<img [^>]*wordmark-email\.png[^>]*>/)[0];
    assert.ok(img.includes("text-transform:uppercase"), `${label}: fallback text uppercased`);
    assert.ok(img.includes("color:#ffffff"), `${label}: fallback text readable on navy`);
    assert.ok(img.includes("font-weight:700"), `${label}: fallback text bold`);
  }
});

test("both buttons use the 5px house radius and keep a navy label on gold", () => {
  for (const [label, t] of allTemplates()) {
    const primary = t.html.match(/<a class="cz-btn"[^>]*>/)[0];
    assert.ok(primary.includes("border-radius:5px"), `${label}: primary button radius`);
    assert.ok(primary.includes(`background-color:${GOLD}`), `${label}: primary button gold`);
    assert.ok(primary.includes(`color:${NAVY}`), `${label}: primary button label navy`);
    assert.match(
      t.html,
      new RegExp(`<a class="cz-btn"[^>]*><span class="cz-btn-label" style="color:${NAVY};`),
      `${label}: primary label colour restated on an inner span`,
    );

    const outline = t.html.match(/<a class="cz-btn-outline"[^>]*>/)[0];
    assert.ok(outline.includes("border-radius:5px"), `${label}: Discord button radius`);
    assert.ok(outline.includes(`border:1px solid ${NAVY}`), `${label}: Discord button navy outline`);
    assert.match(
      t.html,
      new RegExp(`<a class="cz-btn-outline"[^>]*><span class="cz-btn-outline-label" style="color:${NAVY};`),
      `${label}: Discord label colour restated on an inner span`,
    );
  }
});

test("the shell changes did not touch the locked copy or the plain-text part", () => {
  const en = buildWelcomeEmail({ teamName: "Team Velodrome", unsubscribeUrl: UNSUB_URL });
  assert.ok(en.text.startsWith("Hi,"), "plain text still opens on the locked greeting");
  assert.ok(!en.text.includes("cz-"), "no markup leaked into the plain-text part");
  assert.ok(!en.text.includes("wordmark"), "no image reference in the plain-text part");
  assert.ok(en.html.includes("Welcome to Cycling Zone, and thanks for creating Team Velodrome."), "intro unchanged");
  const da = buildWelcomeEmail({ teamName: "Holdet", unsubscribeUrl: UNSUB_URL, language: "da" });
  assert.ok(da.html.includes("Velkommen til Cycling Zone, og tak fordi du oprettede Holdet."), "DA intro unchanged");
  assert.equal(da.html.includes('<html lang="da"'), true, "html lang follows the recipient language");
});
