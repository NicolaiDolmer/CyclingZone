// Renders the four #2853 v2 / #4650 retention-loop email templates to static
// HTML files with example data, so the owner can review the rendered layout
// before this PR merges (task brief step 4 — rendering evidence). This is a
// one-off local aid, not a test and not wired into cron/CI.
//
// Usage: node backend/scripts/renderEmailPreviews.js

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildWelcomeEmail,
  buildDay1Email,
  buildRaceDigestEmail,
} from "../lib/emailTemplates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../../docs/drafts/mail-render-2026-09-02");

// Example unsubscribe URL — same shape emailUnsubUrl.js produces, but with an
// obviously-fake token (this is a static rendering aid, no real user data).
const UNSUBSCRIBE_URL = "https://cyclingzone.org/api/email/unsubscribe?token=example-preview-token";

const pages = [
  {
    file: "welcome.html",
    template: buildWelcomeEmail({ teamName: "Fjordkraft Racing", unsubscribeUrl: UNSUBSCRIBE_URL }),
  },
  {
    file: "day1-results.html",
    template: buildDay1Email({ teamName: "Fjordkraft Racing", hasResults: true, unsubscribeUrl: UNSUBSCRIBE_URL }),
  },
  {
    file: "day1-no-results.html",
    template: buildDay1Email({ teamName: "Fjordkraft Racing", hasResults: false, unsubscribeUrl: UNSUBSCRIBE_URL }),
  },
  {
    file: "digest.html",
    template: buildRaceDigestEmail({
      teamName: "Fjordkraft Racing",
      results: [
        { riderName: "Mikkel Bjerg", rank: 2, raceName: "GP Frederiksberg" },
        { riderName: "Asbjorn Kragh Andersen", rank: 5, raceName: "Post Danmark Rundt, etape 3" },
        { riderName: "Julie Leth", rank: 1, raceName: "Ladies Tour, etape 1" },
      ],
      unsubscribeUrl: UNSUBSCRIBE_URL,
    }),
  },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const { file, template } of pages) {
    const dest = path.join(OUT_DIR, file);
    await writeFile(dest, template.html, "utf8");
    console.log(`wrote ${dest}`);
    console.log(`  subject: ${template.subject}`);
  }
  console.log(`\nDone. Open the files in ${OUT_DIR} in a browser to review.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
