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
// numbered-step rows from "B"): a navy (#1B2A4A) band with the brand wordmark
// as a small hosted PNG (#2853 follow-up 2026-09-08, replacing the system-font
// "CYCLING ZONE" text that stood here) and a short gold
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

import { WORDMARK_FILENAME } from "./emailWordmarkAsset.js";

export const TEMPLATE_TYPES = Object.freeze(["welcome", "day1", "race_digest"]);

const DASHBOARD_URL = "https://cyclingzone.org/dashboard";
const RESULTS_URL = "https://cyclingzone.org/resultater";
const DISCORD_URL = "https://discord.gg/ykysBrWUyC";

const NAVY = "#1B2A4A";
const GOLD = "#C9A227";
const PAGE_BG = "#f4f4f4";
const CARD_BG = "#ffffff";
const TEXT = "#1a1a1a";
const TEXT_SUB = "#5a5a5a";
const TEXT_MUTED = "#767676";
// House radius (docs/design/TASTE.md, docs/design/PAGE_TEMPLATES.md): 5px on
// every button and card corner, in the app and here.
const RADIUS = "5px";

// The wordmark in the navy band (#2853, layout lock's "wordmark som lille
// PNG"). It is a 2x raster of frontend/public/brand/wordmark-ondark.svg built
// by scripts/build-email-wordmark.mjs, hosted from the same origin as the
// site. A PNG and not the SVG we already host because Gmail, Outlook.com and
// the Outlook apps all refuse SVG in <img>. The file is transparent, not a
// baked-in navy plate: Outlook on Windows dark mode repaints the band behind
// the image to slate grey, and a baked-in navy square then showed up as a
// visible dark box on top of the lighter band (owner report 8/9). The band's
// own navy lives on the surrounding <td bgcolor>, not the image, so a
// transparent mark always sits on whatever colour that td ends up painted.
// The filename carries the PNG's own content hash (WORDMARK_FILENAME, written
// by the build script) because a stable URL is not enough: when 8/9's
// transparency fix shipped, prod served the new bytes but Outlook's image
// proxy kept showing the old plate — /brand/* is sent with a week-long
// Cache-Control. A hashed name makes every version its own immutable URL, so
// a new mark can never be masked by a cached old one, and mails already in an
// inbox keep resolving the image they were sent with.
const WORDMARK_URL = `https://cyclingzone.org/brand/${WORDMARK_FILENAME}`;
const WORDMARK_WIDTH = 92;
const WORDMARK_HEIGHT = 22;

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

// Dark-mode lock (#2853, owner saw the Outlook.com/hotmail dark render 8/9).
// Two clients repaint a light email on their own:
//
//   1. Outlook.com and the Outlook mobile apps rewrite the message, and while
//      doing so they copy every <style> rule and prefix the copy with
//      [data-ogsc] (elements whose colour they changed) or [data-ogsb]
//      (background changed). Re-stating our colours behind those two prefixes
//      is the only hook that survives their rewrite — inline styles alone are
//      exactly what they overwrite, which is why navy came out slate grey and
//      gold came out olive.
//   2. Apple Mail honours the color-scheme/supported-color-schemes meta tags
//      and leaves a light-only mail alone; the prefers-color-scheme block is
//      the belt to that braces, for clients that read the media query but not
//      the meta tags.
//
// Both lists are generated from the same table so a colour can never drift
// between them. Every element that carries a colour also carries the matching
// cz-* class; the inline style stays as the baseline for clients that strip
// <style> entirely (Gmail's non-Gmail-account app), and bgcolor="" is the
// third layer for the ones that also drop background shorthand.
// Each entry is [selectors, declarations]. Selectors are a list, not a comma
// string, because the [data-ogsc]/[data-ogsb] prefix has to be distributed
// over EVERY selector in a group — prefixing only the first would leave the
// rest applying unconditionally.
const COLOR_LOCKS = [
  [[".cz-page"], `background-color:${PAGE_BG} !important;`],
  [[".cz-card"], `background-color:${CARD_BG} !important;`],
  [[".cz-band"], `background-color:${NAVY} !important;`],
  [[".cz-eyebrow"], `color:${GOLD} !important;`],
  [[".cz-body"], `background-color:${CARD_BG} !important;color:${TEXT} !important;`],
  // The per-template paragraphs and result lists carry no class of their own
  // (their copy is locked, their markup is not this module's to decorate), so
  // they are locked by descendant selector. The two exceptions below are given
  // a two-class selector on purpose: .cz-body .cz-sub beats .cz-body p, so the
  // grey step subtext and the grey footer keep their own greys.
  [[".cz-text", ".cz-body p", ".cz-body li"], `color:${TEXT} !important;`],
  [[".cz-sub", ".cz-body .cz-sub"], `color:${TEXT_SUB} !important;`],
  [[".cz-muted", ".cz-body .cz-muted", ".cz-body .cz-muted a"], `color:${TEXT_MUTED} !important;`],
  [[".cz-btn"], `background-color:${GOLD} !important;color:${NAVY} !important;`],
  [[".cz-btn-label"], `color:${NAVY} !important;`],
  [
    [".cz-btn-outline"],
    `background-color:${CARD_BG} !important;border-color:${NAVY} !important;color:${NAVY} !important;`,
  ],
  [[".cz-btn-outline-label"], `color:${NAVY} !important;`],
  [[".cz-step-num"], `background-color:${NAVY} !important;`],
  [[".cz-step-num-text"], `color:${CARD_BG} !important;`],
];

const COLOR_LOCK_CSS = [
  `:root{color-scheme:light;supported-color-schemes:light;}`,
  COLOR_LOCKS.map(
    ([selectors, declarations]) =>
      `${selectors.map((selector) => `[data-ogsc] ${selector},[data-ogsb] ${selector}`).join(",")}{${declarations}}`
  ).join(""),
  `@media (prefers-color-scheme:dark){${COLOR_LOCKS.map(
    ([selectors, declarations]) => `${selectors.join(",")}{${declarations}}`
  ).join("")}}`,
].join("");

// A gold, dark-text button — the ONE primary CTA per mail (house design rule:
// one gold primary action per view, mirrored here for email since
// docs/design/TASTE.md's "one gold primary button" applies to player-facing
// surfaces generally, not just app pages). The label colour is stated twice,
// on the <a> and on an inner <span>, because Outlook.com's dark mode recolours
// link text on the anchor and leaves a nested span alone — without the span
// the label came out white on gold instead of navy on gold.
function primaryButtonHtml(url, label) {
  return `<a class="cz-btn" href="${escapeHtml(url)}" style="display:inline-block;padding:12px 28px;background:${GOLD};background-color:${GOLD};border-radius:${RADIUS};color:${NAVY};font-weight:700;text-decoration:none;font-size:14px;"><span class="cz-btn-label" style="color:${NAVY};text-decoration:none;">${escapeHtml(label)}</span></a>`;
}

// The shared secondary CTA (Discord): navy outline on white, same 5px radius,
// same doubled label colour for the same reason as the primary button.
function outlineButtonHtml(url, label) {
  return `<a class="cz-btn-outline" href="${escapeHtml(url)}" style="display:inline-block;padding:9px 20px;background:${CARD_BG};background-color:${CARD_BG};border:1px solid ${NAVY};border-radius:${RADIUS};color:${NAVY};font-weight:600;text-decoration:none;font-size:13px;"><span class="cz-btn-outline-label" style="color:${NAVY};text-decoration:none;">${escapeHtml(label)}</span></a>`;
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
  const lang = normalizeLanguage(language);
  const copy = copyFor(lang);
  return `<!doctype html>
<html lang="${lang}" style="color-scheme:light;supported-color-schemes:light;">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <style>${COLOR_LOCK_CSS}</style>
  </head>
  <body class="cz-page" bgcolor="${PAGE_BG}" style="margin:0;padding:0;background:${PAGE_BG};background-color:${PAGE_BG};color-scheme:light;supported-color-schemes:light;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" class="cz-page" bgcolor="${PAGE_BG}" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE_BG};background-color:${PAGE_BG};padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" class="cz-card" bgcolor="${CARD_BG}" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${CARD_BG};background-color:${CARD_BG};">
            <tr>
              <td class="cz-band" bgcolor="${NAVY}" style="background:${NAVY};background-color:${NAVY};padding:20px 24px;">
                <table role="presentation" class="cz-band" bgcolor="${NAVY}" width="100%" cellpadding="0" cellspacing="0" style="background:${NAVY};background-color:${NAVY};">
                  <tr>
                    <td valign="middle" style="line-height:0;font-size:0;"><img src="${WORDMARK_URL}" alt="Cycling Zone" width="${WORDMARK_WIDTH}" height="${WORDMARK_HEIGHT}" style="display:block;border:0;outline:none;text-decoration:none;width:${WORDMARK_WIDTH}px;height:${WORDMARK_HEIGHT}px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;letter-spacing:1px;line-height:${WORDMARK_HEIGHT}px;color:#ffffff;text-transform:uppercase;"></td>
                    <td align="right" valign="middle" class="cz-eyebrow" style="font-size:11px;font-weight:700;letter-spacing:1px;color:${GOLD};text-transform:uppercase;">${escapeHtml(eyebrow)}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="cz-body" bgcolor="${CARD_BG}" style="background:${CARD_BG};background-color:${CARD_BG};padding:32px 24px;color:${TEXT};font-size:15px;line-height:1.55;">
                ${bodyHtml}
                <p class="cz-text" style="margin:32px 0 12px;color:${TEXT};">${escapeHtml(copy.discordLine)}</p>
                <p style="margin:0 0 32px;">${outlineButtonHtml(DISCORD_URL, copy.discordButton)}</p>
                <p class="cz-text" style="margin:0;font-weight:700;color:${TEXT};">Dolmer, Cycling Zone</p>
                <p class="cz-muted" style="margin:24px 0 0;font-size:12px;color:${TEXT_MUTED};">
                  ${escapeHtml(copy.unsubLine)}
                  <a class="cz-muted" href="${escapeHtml(unsubscribeUrl)}" style="color:${TEXT_MUTED};">${escapeHtml(copy.unsubLinkText)}</a>.
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
          <table role="presentation" class="cz-step-num" bgcolor="${NAVY}" cellpadding="0" cellspacing="0" width="28" style="background:${NAVY};background-color:${NAVY};border-radius:50%;">
            <tr><td align="center" style="width:28px;height:28px;font-size:13px;font-weight:700;"><span class="cz-step-num-text" style="color:${CARD_BG};">${index + 1}</span></td></tr>
          </table>
        </td>
        <td valign="top" style="padding:0 0 16px;">
          <p class="cz-text" style="margin:0;font-weight:700;color:${TEXT};">${escapeHtml(step.title)}</p>
          <p class="cz-sub" style="margin:2px 0 0;color:${TEXT_SUB};font-size:13px;">${escapeHtml(step.sub)}</p>
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
