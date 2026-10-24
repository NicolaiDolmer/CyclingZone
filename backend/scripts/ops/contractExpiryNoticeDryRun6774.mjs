// #6774/#6855 · Tørkørsel af varslet om kontraktudløb før sæsonskiftet.
//
// Printer modtagertal og den fulde varsels-tekst (EN primær + DA), som peger
// på Kontrakter-fanen på Mit hold. Scriptet KAN IKKE sende: dryRun er hårdkodet
// true, og notify-funktionen kaster, hvis den nogensinde blev kaldt.
// Selve udsendelsen sker kun på ejerens "kør" (notifySeasonTransitionRisk.js
// --live), aldrig herfra.
//
// Læser kun (teams + riders + seasons). Holdnavne printes aldrig (repoet og
// logs er offentlige): eksemplerne vises som Hold A/B/C.
//
//   node backend/scripts/ops/contractExpiryNoticeDryRun6774.mjs
//
// Tallene (hvem der rammes) kommer fra emitSeasonTransitionRiskNotice
// (seasonTransitionNotice.js), præcis den funktion --live bruger, så
// tørkørsel og udsendelse ikke kan tælle forskelligt.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  emitSeasonTransitionRiskNotice,
  buildSeasonTransitionRiskNotification,
} from "../../lib/seasonTransitionNotice.js";
import { translate } from "../../lib/i18nServer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function refuseToSend() {
  throw new Error("contractExpiryNoticeDryRun6774: sending is disabled in this script");
}

function alias(i) {
  return `Hold ${String.fromCharCode(65 + (i % 26))}`;
}

function renderIn(language, payload) {
  const { titleCode, messageCode, messageParams } = payload.metadata;
  return {
    title: translate(titleCode, {}, { language }),
    message: translate(messageCode, messageParams, { language }),
  };
}

/**
 * Bygger tørkørsels-rapporten. Sender intet (dryRun: true + kastende notify).
 * `fetchTeamRiskRows` kan injiceres i tests; ellers bruges libbens egen.
 */
export async function buildDryRunReport({ supabase, activeSeasonNumber, fetchTeamRiskRows }) {
  const stats = await emitSeasonTransitionRiskNotice({
    supabase,
    activeSeasonNumber,
    dryRun: true,
    notify: refuseToSend,
    ...(fetchTeamRiskRows ? { fetchTeamRiskRows } : {}),
  });

  // Én tekst pr. variant, så ejeren ser alle tre formuleringer uanset hvilke
  // hold der tilfældigvis ligger i eksemplet.
  const variants = [
    { key: "both", counts: { expiringCount: 3, retirementRiskCount: 1 } },
    { key: "expiringOnly", counts: { expiringCount: 3, retirementRiskCount: 0 } },
    { key: "retirementOnly", counts: { expiringCount: 0, retirementRiskCount: 1 } },
  ].map(({ key, counts }) => {
    const payload = buildSeasonTransitionRiskNotification(counts);
    return { key, counts, en: renderIn("en", payload), da: renderIn("da", payload) };
  });

  return {
    activeSeasonNumber,
    recipients: stats.teamsAffected,
    totalExpiring: stats.totalExpiring,
    totalRetirementRisk: stats.totalRetirementRisk,
    sent: stats.delivered,
    samples: (stats.sample || []).map((s, i) => ({
      team: alias(i),
      expiringCount: s.expiringCount,
      retirementRiskCount: s.retirementRiskCount,
    })),
    variants,
    link: "/team?tab=contracts",
  };
}

function printReport(report) {
  console.log("=== Varsel om kontraktudløb (TØRKØRSEL, intet sendes) #6774 ===");
  console.log(`Aktiv sæson: ${report.activeSeasonNumber}`);
  console.log(`Modtagere (menneskehold med mindst én rytter i risiko): ${report.recipients}`);
  console.log(`Ryttere med udløbende kontrakt i alt: ${report.totalExpiring}`);
  console.log(`Ryttere i pensionsrisiko i alt: ${report.totalRetirementRisk}`);
  console.log(`Link i notifikationen: ${report.link}`);
  if (report.samples.length) {
    console.log("\nEksempler:");
    for (const s of report.samples) {
      console.log(`  ${s.team}: udløber=${s.expiringCount} pensionsrisiko=${s.retirementRiskCount}`);
    }
  }
  for (const v of report.variants) {
    console.log(`\n--- Variant: ${v.key} (eksempeltal ${JSON.stringify(v.counts)}) ---`);
    console.log(`EN  ${v.en.title}`);
    console.log(`    ${v.en.message}`);
    console.log(`DA  ${v.da.title}`);
    console.log(`    ${v.da.message}`);
  }
  console.log(`\nSendt: ${report.sent} (tørkørsel)`);
}

async function main() {
  const { default: dotenv } = await import("dotenv");
  const { createClient } = await import("@supabase/supabase-js");
  dotenv.config({ path: join(__dirname, "../../.env"), quiet: true });
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("FEJL: Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: season, error } = await supabase
    .from("seasons").select("number").eq("status", "active")
    .order("number", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`active season: ${error.message}`);
  const report = await buildDryRunReport({ supabase, activeSeasonNumber: season?.number ?? 1 });
  printReport(report);
}

if (process.argv[1] && process.argv[1].endsWith("contractExpiryNoticeDryRun6774.mjs")) {
  main().catch((err) => { console.error("FEJL:", err.message); process.exit(1); });
}
