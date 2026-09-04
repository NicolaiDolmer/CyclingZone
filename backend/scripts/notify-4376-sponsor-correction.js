// backend/scripts/notify-4376-sponsor-correction.js
// #4376 · Engangs-indbakkebesked til ALLE menneskelige managers om
// sponsor-divisions-tillæg-korrektionen (ejer-go 4/9 aften).
//
//   node scripts/notify-4376-sponsor-correction.js          # DRY-RUN (default — ingen writes)
//   node scripts/notify-4376-sponsor-correction.js --live   # APPLY (sender notifikationerne)
//
// KØR ALDRIG --live mod prod uden ejer-godkendelse. Ejeren/orkestratoren kører
// --live selv, EFTER at have inspiceret dry-run-outputtet (antal modtagere +
// fordeling pr. sprog + eksempelbesked pr. sprog) og bekræftet at det matcher
// forventningen.
//
// Type: "admin_notice" — samme type som notifyTransition3746.mjs,
// notifyRetirement2748.mjs og feedbackInbox.js bruger til engangs-
// admin-beskeder uden metadata/related_id-krav. Frontend renderer typen
// generisk (InboxIcon, uden link — "beskeden ER indholdet"), se
// frontend/src/pages/NotificationsPage.jsx TYPE_CONFIG.admin_notice
// (kommentar #2842: "svar på spillerens egen feedback-indsendelse ...
// beskeden ER indholdet, og der findes ingen side at sende spilleren hen
// til") og NOTIFICATION_TYPES i backend/lib/notificationTypes.js (typen er
// allerede i notifications_type_check — ingen migration nødvendig).
//
// Modtagere: samme menneske-manager-diskriminator som resten af motoren
// (is_ai=false, is_bank=false, is_frozen=false, is_test_account=false,
// user_id IS NOT NULL) — se kommentaren i backend/lib/seasonTransitionNotice.js
// ("Samme menneske-manager-diskriminator som resten af motoren ... se
// getSquadSnapshot/emitContractExpiringNotifications/DashboardPage.jsx").
//
// Sprog: users.language ('da' -> DA-tekst, alt andet inkl. mangler -> EN-tekst
// efterfulgt af DA-tekst i samme besked, adskilt af tom linje) — samme
// EN/DA-kontrakt som backend/lib/emailWelcomeSweep.js, emailDay1Sweep.js,
// emailRaceDigestSweep.js bruger for users.language (#2853 DA follow-up).
// Forskellen her: brugere UDEN 'da' får ikke ren EN — de får EN+DA i samme
// besked (jf. opgavens krav), fordi vi ikke kender deres sprog med sikkerhed
// og "in-app-brev" tåler begge sprog i én besked bedre end en engangs-mail.
//
// Idempotent: notifyUser dedup'er på (type, title, message, related_id=null)
// inden for 24t (RECENT_DUPLICATE_WINDOW_MS, notificationService.js) — en
// gentagen --live-kørsel samme dag spammer ikke.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { notifyUser as defaultNotifyUser } from "../lib/notificationService.js";
import { captureException } from "../lib/sentry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SPONSOR_CORRECTION_TYPE = "admin_notice";

const TITLE_EN = "Your sponsor deal got a division top-up";
const MESSAGE_EN =
  "Sponsor deals were priced against the division you were in when you signed, and never moved with you. " +
  "From now on, a team riding above its deal's division gets a top-up as its own line every season start. " +
  "Today I paid that top-up for this season. A few promoted teams had their deal auto-renewed against the new " +
  "division by mistake; I lowered it to what other promoted teams got and pulled back the difference, and they " +
  "get the same top-up as everyone else. Relegated teams keep the deal they signed. You can see the lines on " +
  "your finance page. This was my mistake, not yours.";

const TITLE_DA = "Din sponsoraftale har fået et divisions-tillæg";
const MESSAGE_DA =
  "Sponsoraftaler blev prissat efter den division du stod i da du skrev under, og fulgte aldrig med. Fra nu af " +
  "får et hold der kører over sin aftales division et tillæg som egen linje ved hver sæsonstart. I dag har jeg " +
  "udbetalt tillægget for denne sæson. Nogle få oprykkere fik ved en fejl fornyet aftalen mod den nye division; " +
  "den er sat ned til det andre oprykkere fik, og forskellen er trukket tilbage, og de får samme tillæg som alle " +
  "andre. Nedrykkere beholder den aftale de skrev under på. Du kan se posterne på din økonomiside. Fejlen var " +
  "min, ikke din.";

/**
 * #4376 · Ren funktion: vælg title/message ud fra users.language.
 * 'da' -> ren DA. Alt andet (inkl. null/undefined/ukendt kode) -> EN-tekst
 * efterfulgt af DA-tekst i samme besked, adskilt af en tom linje (opgavens
 * krav, da vi ikke kender sproget med sikkerhed for disse brugere).
 *
 * @param {string|null|undefined} language — users.language
 */
export function buildSponsorCorrectionMessage(language) {
  if (language === "da") {
    return { title: TITLE_DA, message: MESSAGE_DA };
  }
  return {
    title: TITLE_EN,
    message: `${MESSAGE_EN}\n\n${MESSAGE_DA}`,
  };
}

/**
 * #4376 · Ren funktion: filtrér+map rå teams+users-rækker til modtagere.
 * Menneske-manager-diskriminator: is_ai=false, is_bank=false,
 * is_frozen=false, is_test_account=false, user_id IS NOT NULL. Distinct på
 * user_id (en bruger med flere hold får kun ét kald — notifyUser dedup'er
 * ellers automatisk, men dette holder dry-run-tallene rene).
 *
 * @param {Array<{id:number,user_id:string,is_ai:boolean,is_bank:boolean,is_frozen:boolean,is_test_account:boolean}>} teams
 * @param {Map<string,string|null>} languageByUserId — user_id -> users.language
 */
export function selectHumanManagerRecipients(teams, languageByUserId) {
  const seen = new Set();
  const recipients = [];
  for (const team of teams) {
    if (team.is_ai || team.is_bank || team.is_frozen || team.is_test_account) continue;
    if (!team.user_id) continue;
    if (seen.has(team.user_id)) continue;
    seen.add(team.user_id);
    recipients.push({
      userId: team.user_id,
      language: languageByUserId.get(team.user_id) ?? null,
    });
  }
  return recipients;
}

async function defaultFetchRecipients({ supabase }) {
  const teams = await fetchAllRows(() =>
    supabase
      .from("teams")
      .select("id, user_id, is_ai, is_bank, is_frozen, is_test_account")
      .eq("is_ai", false)
      .eq("is_bank", false)
      .eq("is_frozen", false)
      .eq("is_test_account", false)
      .not("user_id", "is", null)
      .order("id")
  );

  const userIds = [...new Set(teams.map((t) => t.user_id))];
  const languageByUserId = new Map();
  if (userIds.length > 0) {
    const users = await fetchAllRows(() =>
      supabase.from("users").select("id, language").in("id", userIds).order("id")
    );
    for (const u of users) languageByUserId.set(u.id, u.language ?? null);
  }

  return selectHumanManagerRecipients(teams, languageByUserId);
}

/**
 * #4376 · Byg (og valgfrit send) sponsor-korrektions-varslet til alle
 * berørte menneske-managers. dryRun (default true) sender INTET — returnerer
 * blot statistik + eksempler pr. sprog, så orkestratoren kan verificere antal
 * FØR --live.
 */
export async function emitSponsorCorrectionNotice({
  supabase,
  dryRun = true,
  notify = defaultNotifyUser,
  fetchRecipients = defaultFetchRecipients,
}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const recipients = await fetchRecipients({ supabase });
  const daCount = recipients.filter((r) => r.language === "da").length;
  const otherCount = recipients.length - daCount;

  const stats = {
    dryRun,
    recipients: recipients.length,
    byLanguage: { da: daCount, other: otherCount },
    delivered: 0,
    deduped: 0,
    failed: 0,
    sampleDa: null,
    sampleOther: null,
  };

  const daSample = recipients.find((r) => r.language === "da");
  if (daSample) stats.sampleDa = buildSponsorCorrectionMessage(daSample.language);
  const otherSample = recipients.find((r) => r.language !== "da");
  if (otherSample) stats.sampleOther = buildSponsorCorrectionMessage(otherSample.language);

  if (dryRun) return stats;

  for (const r of recipients) {
    const { title, message } = buildSponsorCorrectionMessage(r.language);
    try {
      const res = await notify({
        supabase,
        userId: r.userId,
        type: SPONSOR_CORRECTION_TYPE,
        title,
        message,
        relatedId: null,
      });
      if (res?.delivered) stats.delivered += 1;
      else if (res?.deduped) stats.deduped += 1;
    } catch (err) {
      stats.failed += 1;
      console.error(`  ❌ sponsor-korrektions-varsel fejlede (bruger ${r.userId}):`, err?.message || err);
      captureException(err, { tags: { flow: "notifications", stage: "sponsor-correction-4376" }, userId: r.userId });
    }
  }

  return stats;
}

if (process.argv[1] && process.argv[1].endsWith("notify-4376-sponsor-correction.js")) {
  dotenv.config({ path: join(__dirname, "../.env"), quiet: true });
  const dryRun = !process.argv.includes("--live"); // default: dry-run
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("FEJL: Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  console.log(`=== Sponsor-korrektion indbakkebesked ${dryRun ? "(DRY-RUN)" : "(LIVE)"} (#4376) ===`);
  emitSponsorCorrectionNotice({ supabase, dryRun })
    .then((stats) => {
      console.log("OK:", JSON.stringify({
        dryRun: stats.dryRun,
        recipients: stats.recipients,
        byLanguage: stats.byLanguage,
        delivered: stats.delivered,
        deduped: stats.deduped,
        failed: stats.failed,
      }, null, 2));
      if (stats.sampleDa) {
        console.log("\nEksempelbesked (DA):");
        console.log(`  ${stats.sampleDa.title}`);
        console.log(`  ${stats.sampleDa.message}`);
      }
      if (stats.sampleOther) {
        console.log("\nEksempelbesked (EN+DA fallback):");
        console.log(`  ${stats.sampleOther.title}`);
        console.log(`  ${stats.sampleOther.message}`);
      }
      process.exit(0);
    })
    .catch((err) => { console.error("FEJL:", err.message); process.exit(1); });
}
