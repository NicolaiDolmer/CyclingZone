// Email templates for the transactional retention loop (#2725): welcome (D0),
// day1 nudge (D1), race_digest (come-back mail, #4650). English only for v2 —
// the frontend's i18n locale (users.language) is not consulted here because
// the backend has no equivalent copy catalogue for transactional email today;
// a Danish variant is a follow-up PR once this English copy has shipped
// (tracked in docs/drafts/mailtekster-2853-v2-dolmer-2026-09-02.md's "DA pr.
// modtager" line, not blocking this PR).
//
// #2853 v2 (owner tone session 2026-09-02): copy + layout locked verbatim in
// docs/drafts/mailtekster-2853-v2-dolmer-2026-09-02.md — DO NOT reword
// without going back to the owner. Hybrid layout (owner pick: band+footer
// from "A", numbered-step rows from "B"): a navy (#1B2A4A) band with a text
// wordmark ("CYCLING ZONE", ZONE in gold — no image file in this PR) and a
// short gold eyebrow, a white body, one gold primary CTA button, a shared
// Discord outline CTA + line ("Come say hi on Discord, I read everything"),
// and the signature "Dolmer, Cycling Zone" — all rendered once by wrapHtml/
// wrapText so every template only supplies its own paragraphs + primary CTA.
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
// templates and live here, once.
function wrapHtml({ eyebrow, bodyHtml, unsubscribeUrl }) {
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
                <p style="margin:32px 0 12px;">Something broken or confusing? Come say hi on Discord, I read everything.</p>
                <p style="margin:0 0 32px;"><a href="${escapeHtml(DISCORD_URL)}" style="display:inline-block;padding:9px 20px;border:1px solid ${NAVY};color:${NAVY};font-weight:600;text-decoration:none;font-size:13px;">Join the Discord</a></p>
                <p style="margin:0;font-weight:700;">Dolmer, Cycling Zone</p>
                <p style="margin:24px 0 0;font-size:12px;color:#767676;">
                  You are receiving this because you have a Cycling Zone account.
                  <a href="${escapeHtml(unsubscribeUrl)}" style="color:#767676;">Unsubscribe from these emails</a>.
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

function wrapText({ bodyText, unsubscribeUrl }) {
  return [
    bodyText,
    "Something broken or confusing? Come say hi on Discord, I read everything.",
    `Join the Discord: ${DISCORD_URL}`,
    "Dolmer, Cycling Zone",
    `You are receiving this because you have a Cycling Zone account. Unsubscribe from these emails: ${unsubscribeUrl}`,
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

/**
 * D0 welcome email, sent shortly after signup.
 * @param {{teamName: string, unsubscribeUrl: string}} args
 */
export function buildWelcomeEmail({ teamName, unsubscribeUrl }) {
  const name = escapeHtml(teamName) || "your team";
  const plainName = teamName || "your team";
  const subject = "Your team is on the start line";
  const dashboardUrl = withEmailUtm(DASHBOARD_URL, "welcome");

  const steps = [
    { title: "Bid on a rider you like", sub: "You learn the market by losing an auction or two." },
    { title: "Sign a young rider", sub: "Your academy already has riders waiting. You can sign one today." },
    { title: "Training and lineup", sub: "Set the week's training, and pick who starts your next race." },
  ];

  const bodyHtml = `
    <p style="margin:0 0 16px;">Hi,</p>
    <p style="margin:0 0 16px;">Welcome to Cycling Zone, and thanks for creating ${name}. Come and go as you like, the season runs regardless. Your team takes part in races automatically. You do not have to do anything for that, but your riders ride better when you do.</p>
    ${welcomeStepsHtml(steps)}
    <p style="margin:0 0 8px;">${primaryButtonHtml(dashboardUrl, "Open your dashboard")}</p>
  `.trim();

  const bodyText = [
    "Hi,",
    `Welcome to Cycling Zone, and thanks for creating ${plainName}. Come and go as you like, the season runs regardless. Your team takes part in races automatically. You do not have to do anything for that, but your riders ride better when you do.`,
    [
      "1. Bid on a rider you like",
      "   You learn the market by losing an auction or two.",
      "2. Sign a young rider",
      "   Your academy already has riders waiting. You can sign one today.",
      "3. Training and lineup",
      "   Set the week's training, and pick who starts your next race.",
    ].join("\n"),
    `Open your dashboard: ${dashboardUrl}`,
  ].join("\n\n");

  return {
    subject,
    html: wrapHtml({ eyebrow: "START LINE", bodyHtml, unsubscribeUrl }),
    text: wrapText({ bodyText, unsubscribeUrl }),
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
 * @param {{teamName: string, hasResults: boolean, unsubscribeUrl: string}} args
 */
export function buildDay1Email({ teamName, hasResults, unsubscribeUrl }) {
  const name = escapeHtml(teamName) || "Your team";
  const plainName = teamName || "Your team";
  const dashboardUrl = withEmailUtm(DASHBOARD_URL, "day1");
  const eyebrow = "DAY 1";

  if (hasResults) {
    const subject = "Day 1: your riders have already raced";
    const bodyHtml = `
      <p style="margin:0 0 16px;">Hi,</p>
      <p style="margin:0 0 16px;">${name} raced while you were away. The results are up. Have a look at who did well and who did not, and check the auctions closing today before someone else takes the rider you wanted.</p>
      <p style="margin:0 0 8px;">${primaryButtonHtml(dashboardUrl, "Open your dashboard")}</p>
    `.trim();

    const bodyText = [
      "Hi,",
      `${plainName} raced while you were away. The results are up. Have a look at who did well and who did not, and check the auctions closing today before someone else takes the rider you wanted.`,
      `Open your dashboard: ${dashboardUrl}`,
    ].join("\n\n");

    return {
      subject,
      html: wrapHtml({ eyebrow, bodyHtml, unsubscribeUrl }),
      text: wrapText({ bodyText, unsubscribeUrl }),
    };
  }

  const subject = "Day 1: your first race is on the calendar";
  const bodyHtml = `
    <p style="margin:0 0 16px;">Hi,</p>
    <p style="margin:0 0 16px;">${name}'s first race is on the calendar and runs by itself. Today: check the auctions closing tonight, and pick your own lineup for the first race. If you do nothing, the assistant fills the gaps, but your own picks are better.</p>
    <p style="margin:0 0 8px;">${primaryButtonHtml(dashboardUrl, "Open your dashboard")}</p>
  `.trim();

  const bodyText = [
    "Hi,",
    `${plainName}'s first race is on the calendar and runs by itself. Today: check the auctions closing tonight, and pick your own lineup for the first race. If you do nothing, the assistant fills the gaps, but your own picks are better.`,
    `Open your dashboard: ${dashboardUrl}`,
  ].join("\n\n");

  return {
    subject,
    html: wrapHtml({ eyebrow, bodyHtml, unsubscribeUrl }),
    text: wrapText({ bodyText, unsubscribeUrl }),
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
 * @param {{teamName: string, results: Array<{riderName: string, rank: number|null, raceName: string}>, unsubscribeUrl: string}} args
 */
export function buildRaceDigestEmail({ teamName, results, unsubscribeUrl }) {
  const name = escapeHtml(teamName) || "Your team";
  const plainName = teamName || "Your team";
  const subject = `${plainName} raced while you were away`;
  const rows = Array.isArray(results) ? results.filter((r) => r && r.riderName && r.raceName) : [];
  const resultsUrl = withEmailUtm(RESULTS_URL, "race_digest");

  const linesHtml = rows.length
    ? `<ul style="margin:0 0 24px;padding-left:20px;">${rows
        .map((r) => {
          const rider = escapeHtml(r.riderName);
          const race = escapeHtml(r.raceName);
          const line = r.rank != null ? `${rider}: rank ${escapeHtml(r.rank)} in ${race}` : `${rider}: results in ${race}`;
          return `<li style="margin-bottom:6px;">${line}</li>`;
        })
        .join("")}</ul>`
    : `<p style="margin:0 0 24px;">Your team's results since your last visit are ready.</p>`;

  const linesText = rows.length
    ? rows
        .map((r) =>
          r.rank != null
            ? `${r.riderName}: rank ${r.rank} in ${r.raceName}`
            : `${r.riderName}: results in ${r.raceName}`
        )
        .join("\n")
    : "Your team's results since your last visit are ready.";

  const bodyHtml = `
    <p style="margin:0 0 16px;">Hi,</p>
    <p style="margin:0 0 16px;">${name} raced while you were away. Best results since your last visit:</p>
    ${linesHtml}
    <p style="margin:0 0 8px;">${primaryButtonHtml(resultsUrl, "See all results")}</p>
  `.trim();

  const bodyText = [
    "Hi,",
    `${plainName} raced while you were away. Best results since your last visit:`,
    linesText,
    `See all results: ${resultsUrl}`,
  ].join("\n\n");

  return {
    subject,
    html: wrapHtml({ eyebrow: "WELCOME BACK", bodyHtml, unsubscribeUrl }),
    text: wrapText({ bodyText, unsubscribeUrl }),
  };
}

export function buildLoopEmail(type, data) {
  if (type === "welcome") return buildWelcomeEmail(data);
  if (type === "day1") return buildDay1Email(data);
  if (type === "race_digest") return buildRaceDigestEmail(data);
  throw new Error(`buildLoopEmail: unknown type "${type}"`);
}
