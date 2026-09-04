// Email templates for the transactional retention loop (#2725): welcome (D0),
// day1 nudge (D1), race_digest (come-back mail, #4650). Localized on
// users.language (#2853 DA follow-up, 2026-09-03): 'da' renders the Danish
// copy below, anything else (including missing/unset) renders English. The
// caller (emailWelcomeSweep.js / emailDay1Sweep.js / emailRaceDigestSweep.js)
// reads users.language and passes it through as `language`; this module never
// queries the database itself.
//
// #2853 v2 (owner tone session 2026-09-02): EN copy + layout locked verbatim
// in docs/drafts/mailtekster-2853-v2-dolmer-2026-09-02.md — DO NOT reword
// without going back to the owner. The DA copy below is a follow-up
// translation of that same locked text (see the doc's "DA-oversaettelse"
// section added in this PR), faithful to the EN structure and placeholders,
// not a separate copy pass. Hybrid layout (owner pick: band+footer from "A",
// numbered-step rows from "B"): a navy (#1B2A4A) band with a text wordmark
// ("CYCLING ZONE", ZONE in gold — no image file in this PR) and a short gold
// eyebrow, a white body, one gold primary CTA button, a shared Discord
// outline CTA + line, and the signature "Dolmer, Cycling Zone" (unchanged in
// both languages, it is a name) — all rendered once by wrapHtml/wrapText so
// every template only supplies its own paragraphs + primary CTA.
//
// Tone: personal solo-dev voice ("Dolmer", not "the Cycling Zone team"), no
// marketing fluff, no em-dashes, no emoji, no "free forever", no invented
// features/numbers — every fact in a template is either static (URL, product
// name) or passed in by the caller from real data (team name, race results).
// Every template ends with an unsubscribe link line, required by CAN-SPAM/
// GDPR/CASL for every commercial/bulk email.

export const TEMPLATE_TYPES = Object.freeze(["welcome", "day1", "race_digest"]);

const DASHBOARD_URL = "https://cyclingzone.org/dashboard";
const RESULTS_URL = "https://cyclingzone.org/resultater";
const DISCORD_URL = "https://discord.gg/ykysBrWUyC";

const NAVY = "#1B2A4A";
const GOLD = "#C9A227";

// Only "da" renders Danish; everything else (undefined, "en", an unknown
// locale) falls back to English — same default-to-EN rule the frontend's
// i18n LanguageProvider uses for users.language.
function normalizeLanguage(language) {
  return language === "da" ? "da" : "en";
}

// Shared strings rendered once by wrapHtml/wrapText for every template
// (Discord line + button, unsubscribe footer, CTA button labels). Per-
// template subject/body copy lives in each build*Email function below.
const COPY = {
  en: {
    greeting: "Hi,",
    discordLine: "Something broken or confusing? Come say hi on Discord, I read everything.",
    discordButton: "Join the Discord",
    unsubLine: "You are receiving this because you have a Cycling Zone account.",
    unsubLinkText: "Unsubscribe from these emails",
    dashboardButton: "Open your dashboard",
    resultsButton: "See all results",
    fallbackTeamName: "your team",
    fallbackTeamNameCap: "Your team",
  },
  da: {
    greeting: "Hej,",
    discordLine: "Er noget i stykker eller uklart? Kom forbi Discord, jeg læser alt.",
    discordButton: "Deltag i Discord",
    unsubLine: "Du modtager denne mail fordi du har en Cycling Zone-konto.",
    unsubLinkText: "Afmeld disse mails",
    dashboardButton: "Åbn dit dashboard",
    resultsButton: "Se alle resultater",
    fallbackTeamName: "dit hold",
    fallbackTeamNameCap: "Dit hold",
  },
};

function copyFor(language) {
  return COPY[normalizeLanguage(language)];
}

// #2853: tag every CTA link with the SAME utm_source/utm_medium/utm_campaign
// parameter names the existing traffic_events/signup_attribution channel
// pipeline already reads (#4320 — see backend/lib/trafficChannel.js's
// resolveChannel + frontend/src/lib/attribution.js's UTM_KEYS). utm_source
// is always "email" (the channel), utm_medium/utm_campaign are the loop
// type (welcome/day1/race_digest) so each mail's clicks are distinguishable
// in the existing channel funnel without inventing a new tracking mechanism.
// The Discord CTA is deliberately NOT tagged — it leaves the funnel this
// pipeline measures.
function withEmailUtm(url, type) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}utm_source=email&utm_medium=${encodeURIComponent(type)}&utm_campaign=${encodeURIComponent(type)}`;
}

// Escapes the five HTML-significant characters. The double- and single-quote
// replacements are required because escapeHtml output is interpolated into
// double-quoted attribute values (e.g. href="..."), where an unescaped quote
// would let a value break out of the attribute (CodeQL js/incomplete-html-
// attribute-sanitization). &#39; is used for the apostrophe because the older
// &apos; entity is not reliably supported by all mail clients.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// A gold, dark-text button — the ONE primary CTA per mail (house design rule:
// one gold primary action per view, mirrored here for email since
// docs/design/TASTE.md's "one gold primary button" applies to player-facing
// surfaces generally, not just app pages).
function primaryButtonHtml(url, label) {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 28px;background:${GOLD};color:${NAVY};font-weight:700;text-decoration:none;font-size:14px;">${escapeHtml(label)}</a>`;
}

// Shared layout (#2853 v2, docs/drafts/mailtekster-2853-v2-dolmer-2026-09-02.md):
// max ~600px column, table-based, system font stack, minimal inline CSS (no
// external stylesheet, no web fonts — renders consistently across mail
// clients that strip <style> blocks). bodyHtml is template-specific (its own
// paragraphs + primary CTA button, and — welcome only — the numbered-step
// rows); the navy band, the Discord CTA line, the "Dolmer, Cycling Zone"
// signature and the unsubscribe footer are identical across all three
// templates and live here, once, localized via COPY[language].
function wrapHtml({ eyebrow, bodyHtml, unsubscribeUrl, language }) {
  const copy = copyFor(language);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;">
            <tr>
              <td style="background:${NAVY};padding:20px 24px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size:16px;font-weight:700;letter-spacing:1px;color:#ffffff;text-transform:uppercase;">CYCLING <span style="color:${GOLD};">ZONE</span></td>
                    <td align="right" style="font-size:11px;font-weight:700;letter-spacing:1px;color:${GOLD};text-transform:uppercase;">${escapeHtml(eyebrow)}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 24px;color:#1a1a1a;font-size:15px;line-height:1.55;">
                ${bodyHtml}
                <p style="margin:32px 0 12px;">${escapeHtml(copy.discordLine)}</p>
                <p style="margin:0 0 32px;"><a href="${escapeHtml(DISCORD_URL)}" style="display:inline-block;padding:9px 20px;border:1px solid ${NAVY};color:${NAVY};font-weight:600;text-decoration:none;font-size:13px;">${escapeHtml(copy.discordButton)}</a></p>
                <p style="margin:0;font-weight:700;">Dolmer, Cycling Zone</p>
                <p style="margin:24px 0 0;font-size:12px;color:#767676;">
                  ${escapeHtml(copy.unsubLine)}
                  <a href="${escapeHtml(unsubscribeUrl)}" style="color:#767676;">${escapeHtml(copy.unsubLinkText)}</a>.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function wrapText({ bodyText, unsubscribeUrl, language }) {
  const copy = copyFor(language);
  return [
    bodyText,
    copy.discordLine,
    `${copy.discordButton}: ${DISCORD_URL}`,
    "Dolmer, Cycling Zone",
    `${copy.unsubLine} ${copy.unsubLinkText}: ${unsubscribeUrl}`,
  ].join("\n\n");
}

// Welcome-only numbered steps, rendered as table rows (owner pick: rows, not
// an <ol>) — a navy circle number, a bold title, a grey subtext line.
function welcomeStepsHtml(steps) {
  const rows = steps
    .map(
      (step, index) => `
      <tr>
        <td width="36" valign="top" style="padding:0 12px 16px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="28" style="background:${NAVY};border-radius:50%;">
            <tr><td align="center" style="width:28px;height:28px;color:#ffffff;font-size:13px;font-weight:700;">${index + 1}</td></tr>
          </table>
        </td>
        <td valign="top" style="padding:0 0 16px;">
          <p style="margin:0;font-weight:700;">${escapeHtml(step.title)}</p>
          <p style="margin:2px 0 0;color:#5a5a5a;font-size:13px;">${escapeHtml(step.sub)}</p>
        </td>
      </tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">${rows}</table>`;
}

const WELCOME_STEPS = {
  en: [
    { title: "Bid on a rider you like", sub: "You learn the market by losing an auction or two." },
    { title: "Sign a young rider", sub: "Your academy already has riders waiting. You can sign one today." },
    { title: "Training and lineup", sub: "Set the week's training, and pick who starts your next race." },
  ],
  da: [
    { title: "Byd på en rytter du kan lide", sub: "Du lærer markedet at kende ved at tabe en auktion eller to." },
    { title: "Skriv en ung rytter under kontrakt", sub: "Dit akademi har allerede ryttere klar. Du kan skrive en under kontrakt i dag." },
    { title: "Træning og opstilling", sub: "Sæt ugens træning, og vælg hvem der starter dit næste løb." },
  ],
};

/**
 * D0 welcome email, sent shortly after signup.
 * @param {{teamName: string, unsubscribeUrl: string, language?: string}} args
 */
export function buildWelcomeEmail({ teamName, unsubscribeUrl, language }) {
  const lang = normalizeLanguage(language);
  const copy = copyFor(lang);
  const name = escapeHtml(teamName) || copy.fallbackTeamName;
  const plainName = teamName || copy.fallbackTeamName;
  const subject = lang === "da" ? "Dit hold er på startlinjen" : "Your team is on the start line";
  const eyebrow = lang === "da" ? "STARTLINJE" : "START LINE";
  const dashboardUrl = withEmailUtm(DASHBOARD_URL, "welcome");
  const steps = WELCOME_STEPS[lang];

  const intro =
    lang === "da"
      ? `Velkommen til Cycling Zone, og tak fordi du oprettede ${name}. Kom og gå som du vil, sæsonen kører uanset. Dit hold deltager i løb automatisk. Du behøver ikke gøre noget for det, men dine ryttere kører bedre, når du gør.`
      : `Welcome to Cycling Zone, and thanks for creating ${name}. Come and go as you like, the season runs regardless. Your team takes part in races automatically. You do not have to do anything for that, but your riders ride better when you do.`;
  const introPlain =
    lang === "da"
      ? `Velkommen til Cycling Zone, og tak fordi du oprettede ${plainName}. Kom og gå som du vil, sæsonen kører uanset. Dit hold deltager i løb automatisk. Du behøver ikke gøre noget for det, men dine ryttere kører bedre, når du gør.`
      : `Welcome to Cycling Zone, and thanks for creating ${plainName}. Come and go as you like, the season runs regardless. Your team takes part in races automatically. You do not have to do anything for that, but your riders ride better when you do.`;

  const bodyHtml = `
    <p style="margin:0 0 16px;">${copy.greeting}</p>
    <p style="margin:0 0 16px;">${intro}</p>
    ${welcomeStepsHtml(steps)}
    <p style="margin:0 0 8px;">${primaryButtonHtml(dashboardUrl, copy.dashboardButton)}</p>
  `.trim();

  const stepsText = steps
    .map((step, index) => `${index + 1}. ${step.title}\n   ${step.sub}`)
    .join("\n");

  const bodyText = [copy.greeting, introPlain, stepsText, `${copy.dashboardButton}: ${dashboardUrl}`].join("\n\n");

  return {
    subject,
    html: wrapHtml({ eyebrow, bodyHtml, unsubscribeUrl, language: lang }),
    text: wrapText({ bodyText, unsubscribeUrl, language: lang }),
  };
}

/**
 * D1 nudge email, sent 20-30h after signup for accounts that have not come back.
 *
 * Two truthful variants gated on hasResults (review fix, PR #2728):
 * production data shows only ~1/3 of new teams have race_results within
 * 24h, so claiming results exist for everyone would be an invented claim for
 * the other ~2/3 — the caller (emailDay1Sweep.js) checks race_results per
 * team and passes the real answer in.
 *
 * #2853 v2: the CTA is a single "Open your dashboard" link in both variants,
 * per the locked copy in docs/drafts/mailtekster-2853-v2-dolmer-2026-09-02.md
 * — the #3310/#3912 per-race/per-stage deep link this template used to build
 * from an optional latestRaceId/latestStageNumber is dropped along with it
 * (emailDay1Sweep.js no longer looks those columns up either).
 * @param {{teamName: string, hasResults: boolean, unsubscribeUrl: string, language?: string}} args
 */
export function buildDay1Email({ teamName, hasResults, unsubscribeUrl, language }) {
  const lang = normalizeLanguage(language);
  const copy = copyFor(lang);
  const name = escapeHtml(teamName) || copy.fallbackTeamNameCap;
  const plainName = teamName || copy.fallbackTeamNameCap;
  const dashboardUrl = withEmailUtm(DASHBOARD_URL, "day1");
  const eyebrow = lang === "da" ? "DAG 1" : "DAY 1";

  if (hasResults) {
    const subject = lang === "da" ? "Dag 1: dine ryttere har allerede kørt" : "Day 1: your riders have already raced";
    const line =
      lang === "da"
        ? `${name} kørte mens du var væk. Resultaterne er klar. Se hvem der klarede sig godt og hvem der ikke gjorde det, og tjek de auktioner der lukker i dag, før en anden tager den rytter du ville have.`
        : `${name} raced while you were away. The results are up. Have a look at who did well and who did not, and check the auctions closing today before someone else takes the rider you wanted.`;
    const linePlain =
      lang === "da"
        ? `${plainName} kørte mens du var væk. Resultaterne er klar. Se hvem der klarede sig godt og hvem der ikke gjorde det, og tjek de auktioner der lukker i dag, før en anden tager den rytter du ville have.`
        : `${plainName} raced while you were away. The results are up. Have a look at who did well and who did not, and check the auctions closing today before someone else takes the rider you wanted.`;

    const bodyHtml = `
      <p style="margin:0 0 16px;">${copy.greeting}</p>
      <p style="margin:0 0 16px;">${line}</p>
      <p style="margin:0 0 8px;">${primaryButtonHtml(dashboardUrl, copy.dashboardButton)}</p>
    `.trim();

    const bodyText = [copy.greeting, linePlain, `${copy.dashboardButton}: ${dashboardUrl}`].join("\n\n");

    return {
      subject,
      html: wrapHtml({ eyebrow, bodyHtml, unsubscribeUrl, language: lang }),
      text: wrapText({ bodyText, unsubscribeUrl, language: lang }),
    };
  }

  const subject = lang === "da" ? "Dag 1: dit første løb er på kalenderen" : "Day 1: your first race is on the calendar";
  const line =
    lang === "da"
      ? `${name}s første løb er på kalenderen og kører af sig selv. I dag: tjek de auktioner der lukker i aften, og vælg selv din opstilling til det første løb. Gør du ingenting, fylder assistenten hullerne, men dine egne valg er bedre.`
      : `${name}'s first race is on the calendar and runs by itself. Today: check the auctions closing tonight, and pick your own lineup for the first race. If you do nothing, the assistant fills the gaps, but your own picks are better.`;
  const linePlain =
    lang === "da"
      ? `${plainName}s første løb er på kalenderen og kører af sig selv. I dag: tjek de auktioner der lukker i aften, og vælg selv din opstilling til det første løb. Gør du ingenting, fylder assistenten hullerne, men dine egne valg er bedre.`
      : `${plainName}'s first race is on the calendar and runs by itself. Today: check the auctions closing tonight, and pick your own lineup for the first race. If you do nothing, the assistant fills the gaps, but your own picks are better.`;

  const bodyHtml = `
    <p style="margin:0 0 16px;">${copy.greeting}</p>
    <p style="margin:0 0 16px;">${line}</p>
    <p style="margin:0 0 8px;">${primaryButtonHtml(dashboardUrl, copy.dashboardButton)}</p>
  `.trim();

  const bodyText = [copy.greeting, linePlain, `${copy.dashboardButton}: ${dashboardUrl}`].join("\n\n");

  return {
    subject,
    html: wrapHtml({ eyebrow, bodyHtml, unsubscribeUrl, language: lang }),
    text: wrapText({ bodyText, unsubscribeUrl, language: lang }),
  };
}

/**
 * Race-digest "you were away" email (#4650). No longer a daily report — the
 * caller (emailRaceDigestSweep.js) only reaches this template for a manager
 * who has been absent 3+ days and has at least one result since their last
 * visit. `results` is already reduced to the manager's best (lowest rank)
 * placement per race since that visit — never invented, every line comes
 * straight from a race_results row the caller fetched.
 *
 * #2853 v2: the #3399 narrative-headline/"best moment" lead-in this template
 * used to render is dropped — the locked copy in
 * docs/drafts/mailtekster-2853-v2-dolmer-2026-09-02.md goes straight from the
 * greeting to the result lines, no room left for a headline paragraph.
 * @param {{teamName: string, results: Array<{riderName: string, rank: number|null, raceName: string}>, unsubscribeUrl: string, language?: string}} args
 */
export function buildRaceDigestEmail({ teamName, results, unsubscribeUrl, language }) {
  const lang = normalizeLanguage(language);
  const copy = copyFor(lang);
  const name = escapeHtml(teamName) || copy.fallbackTeamNameCap;
  const plainName = teamName || copy.fallbackTeamNameCap;
  const subject = lang === "da" ? `${plainName} kørte mens du var væk` : `${plainName} raced while you were away`;
  const rows = Array.isArray(results) ? results.filter((r) => r && r.riderName && r.raceName) : [];
  const resultsUrl = withEmailUtm(RESULTS_URL, "race_digest");

  // #4654 (Danish rank wording): "placering" is the term backend/lib's own
  // race-result notifications already use for this exact shape (see
  // frontend/public/locales/da/backendMessages.json's "Din bedste: {rider},
  // placering {position}." string) — reused here instead of inventing a new
  // Danish word ("plads") for the same concept.
  const noResultsLine =
    lang === "da" ? "Dit holds resultater siden dit sidste besøg er klar." : "Your team's results since your last visit are ready.";
  const introLine =
    lang === "da" ? `${name} kørte mens du var væk. Bedste resultater siden dit sidste besøg:` : `${name} raced while you were away. Best results since your last visit:`;
  const introLinePlain =
    lang === "da"
      ? `${plainName} kørte mens du var væk. Bedste resultater siden dit sidste besøg:`
      : `${plainName} raced while you were away. Best results since your last visit:`;

  const linesHtml = rows.length
    ? `<ul style="margin:0 0 24px;padding-left:20px;">${rows
        .map((r) => {
          const rider = escapeHtml(r.riderName);
          const race = escapeHtml(r.raceName);
          const line =
            r.rank != null
              ? lang === "da"
                ? `${rider}: placering ${escapeHtml(r.rank)} i ${race}`
                : `${rider}: rank ${escapeHtml(r.rank)} in ${race}`
              : lang === "da"
                ? `${rider}: resultater i ${race}`
                : `${rider}: results in ${race}`;
          return `<li style="margin-bottom:6px;">${line}</li>`;
        })
        .join("")}</ul>`
    : `<p style="margin:0 0 24px;">${noResultsLine}</p>`;

  const linesText = rows.length
    ? rows
        .map((r) =>
          r.rank != null
            ? lang === "da"
              ? `${r.riderName}: placering ${r.rank} i ${r.raceName}`
              : `${r.riderName}: rank ${r.rank} in ${r.raceName}`
            : lang === "da"
              ? `${r.riderName}: resultater i ${r.raceName}`
              : `${r.riderName}: results in ${r.raceName}`
        )
        .join("\n")
    : noResultsLine;

  const bodyHtml = `
    <p style="margin:0 0 16px;">${copy.greeting}</p>
    <p style="margin:0 0 16px;">${introLine}</p>
    ${linesHtml}
    <p style="margin:0 0 8px;">${primaryButtonHtml(resultsUrl, copy.resultsButton)}</p>
  `.trim();

  const bodyText = [copy.greeting, introLinePlain, linesText, `${copy.resultsButton}: ${resultsUrl}`].join("\n\n");

  return {
    subject,
    html: wrapHtml({ eyebrow: lang === "da" ? "VELKOMMEN TILBAGE" : "WELCOME BACK", bodyHtml, unsubscribeUrl, language: lang }),
    text: wrapText({ bodyText, unsubscribeUrl, language: lang }),
  };
}

export function buildLoopEmail(type, data) {
  if (type === "welcome") return buildWelcomeEmail(data);
  if (type === "day1") return buildDay1Email(data);
  if (type === "race_digest") return buildRaceDigestEmail(data);
  throw new Error(`buildLoopEmail: unknown type "${type}"`);
}
