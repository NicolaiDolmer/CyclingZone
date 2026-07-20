// Email templates for the transactional retention loop (#2725): welcome (D0),
// day1 nudge (D1), race_digest (daily). English only for v1 — the frontend's
// i18n locale (users.language) is not consulted here because the backend has
// no equivalent copy catalogue for transactional email today; adding a
// Danish variant is a follow-up once the owner has approved the English
// copy (tracked in the PR, not blocking #2725).
//
// Tone: personal solo-dev voice, no marketing fluff, no em-dashes, no emoji,
// no "free forever", no invented features/numbers — every fact in a template
// is either static (URL, product name) or passed in by the caller from real
// data (team name, race results). Every template ends with an unsubscribe
// link line, required by CAN-SPAM/GDPR/CASL for every commercial/bulk email.

export const TEMPLATE_TYPES = Object.freeze(["welcome", "day1", "race_digest"]);

const DASHBOARD_URL = "https://cyclingzone.org/dashboard";
const RESULTS_URL = "https://cyclingzone.org/resultater";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Shared layout: max ~600px column, system font stack, minimal inline CSS
// (no external stylesheet, no web fonts — renders consistently across mail
// clients that strip <style> blocks). bodyHtml/bodyText are the
// template-specific paragraphs; the signature + unsubscribe line are common
// to all three templates.
function wrapHtml({ bodyHtml, unsubscribeUrl }) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;">
            <tr>
              <td style="padding:32px 24px;color:#1a1a1a;font-size:15px;line-height:1.6;">
                ${bodyHtml}
                <p style="margin:32px 0 0;">Nicolai, Cycling Zone</p>
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
  return `${bodyText}\n\nNicolai, Cycling Zone\n\nYou are receiving this because you have a Cycling Zone account. Unsubscribe from these emails: ${unsubscribeUrl}`;
}

/**
 * D0 welcome email, sent shortly after signup.
 * @param {{teamName: string, unsubscribeUrl: string}} args
 */
export function buildWelcomeEmail({ teamName, unsubscribeUrl }) {
  const name = escapeHtml(teamName) || "your team";
  const subject = "Your team is on the start line";

  const bodyHtml = `
    <p style="margin:0 0 16px;">Hi,</p>
    <p style="margin:0 0 16px;">${name} is set up and ready to go.</p>
    <p style="margin:0 0 16px;">Here is what is already happening today: your riders race today or tomorrow automatically as part of the season calendar, and auctions for new riders are live right now.</p>
    <p style="margin:0 0 8px;">Three things worth doing in your first session:</p>
    <ol style="margin:0 0 16px;padding-left:20px;">
      <li style="margin-bottom:6px;">Place a bid on a rider in an open auction.</li>
      <li style="margin-bottom:6px;">Set your training plan for the week.</li>
      <li style="margin-bottom:6px;">Pick your race lineup.</li>
    </ol>
    <p style="margin:0 0 16px;"><a href="${escapeHtml(DASHBOARD_URL)}" style="color:#1a1a1a;font-weight:600;">Go to your dashboard</a></p>
  `.trim();

  const bodyText = [
    "Hi,",
    `${teamName || "Your team"} is set up and ready to go.`,
    "Here is what is already happening today: your riders race today or tomorrow automatically as part of the season calendar, and auctions for new riders are live right now.",
    "Three things worth doing in your first session:",
    "1. Place a bid on a rider in an open auction.",
    "2. Set your training plan for the week.",
    "3. Pick your race lineup.",
    `Go to your dashboard: ${DASHBOARD_URL}`,
  ].join("\n\n");

  return {
    subject,
    html: wrapHtml({ bodyHtml, unsubscribeUrl }),
    text: wrapText({ bodyText, unsubscribeUrl }),
  };
}

/**
 * D1 nudge email, sent 20-30h after signup for accounts that have not come back.
 * @param {{teamName: string, unsubscribeUrl: string}} args
 */
export function buildDay1Email({ teamName, unsubscribeUrl }) {
  const name = escapeHtml(teamName) || "Your team";
  const subject = "Day 1: your first results are in";

  const bodyHtml = `
    <p style="margin:0 0 16px;">Hi,</p>
    <p style="margin:0 0 16px;">${name} raced while you were away. Your results are already on the board.</p>
    <p style="margin:0 0 16px;">Worth checking today: your race results, and any auctions ending today that you might still want to bid on.</p>
    <p style="margin:0 0 16px;"><a href="${escapeHtml(DASHBOARD_URL)}" style="color:#1a1a1a;font-weight:600;">See your results and auctions</a></p>
  `.trim();

  const bodyText = [
    "Hi,",
    `${teamName || "Your team"} raced while you were away. Your results are already on the board.`,
    "Worth checking today: your race results, and any auctions ending today that you might still want to bid on.",
    `See your results and auctions: ${DASHBOARD_URL}`,
  ].join("\n\n");

  return {
    subject,
    html: wrapHtml({ bodyHtml, unsubscribeUrl }),
    text: wrapText({ bodyText, unsubscribeUrl }),
  };
}

/**
 * Daily race-digest email, sent for managers whose riders raced today.
 * @param {{teamName: string, results: Array<{riderName: string, rank: number|null, raceName: string}>, unsubscribeUrl: string}} args
 */
export function buildRaceDigestEmail({ teamName, results, unsubscribeUrl }) {
  const subject = "Race day: how your team did today";
  const rows = Array.isArray(results) ? results.filter((r) => r && r.riderName && r.raceName) : [];

  const linesHtml = rows.length
    ? `<ul style="margin:0 0 16px;padding-left:20px;">${rows
        .map((r) => {
          const rider = escapeHtml(r.riderName);
          const race = escapeHtml(r.raceName);
          const line = r.rank != null ? `${rider}: rank ${escapeHtml(r.rank)} in ${race}` : `${rider}: results in ${race}`;
          return `<li style="margin-bottom:6px;">${line}</li>`;
        })
        .join("")}</ul>`
    : `<p style="margin:0 0 16px;">Your team's results from today are ready.</p>`;

  const linesText = rows.length
    ? rows
        .map((r) =>
          r.rank != null
            ? `${r.riderName}: rank ${r.rank} in ${r.raceName}`
            : `${r.riderName}: results in ${r.raceName}`
        )
        .join("\n")
    : "Your team's results from today are ready.";

  const name = escapeHtml(teamName) || "Your team";
  const bodyHtml = `
    <p style="margin:0 0 16px;">Hi,</p>
    <p style="margin:0 0 16px;">${name}'s best results from today:</p>
    ${linesHtml}
    <p style="margin:0 0 16px;"><a href="${escapeHtml(RESULTS_URL)}" style="color:#1a1a1a;font-weight:600;">See all results</a></p>
  `.trim();

  const bodyText = [
    "Hi,",
    `${teamName || "Your team"}'s best results from today:`,
    linesText,
    `See all results: ${RESULTS_URL}`,
  ].join("\n\n");

  return {
    subject,
    html: wrapHtml({ bodyHtml, unsubscribeUrl }),
    text: wrapText({ bodyText, unsubscribeUrl }),
  };
}

export function buildLoopEmail(type, data) {
  if (type === "welcome") return buildWelcomeEmail(data);
  if (type === "day1") return buildDay1Email(data);
  if (type === "race_digest") return buildRaceDigestEmail(data);
  throw new Error(`buildLoopEmail: unknown type "${type}"`);
}
