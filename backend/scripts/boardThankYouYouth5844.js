// backend/scripts/boardThankYouYouth5844.js
// #5844 — "A thank-you from the board" / "Tak fra bestyrelsen" (ejer-design 28/9).
// 10 akademi-TILBUD (5 U23-alder + 5 junior-alder) til hvert aktivt menneskehold.
// Logikken bor i backend/lib/academyBoardGift.js; dette script er kun CLI + rapport.
//
// Tilstande:
//   (default)              dry-run mod prod (read-only; skriver INTET i DB)
//   --snapshot <fil.json>  dry-run mod et read-only prod-udtræk (se nedenfor), uden DB-klient
//   --apply --owner-go     SKRIVER: claim + ryttere + tilbud + indbakke-besked pr. hold.
//                          Kun efter ejerens ordrette "kør" på dry-run-tallene.
//
// Øvrige flag:
//   --top-min <tier>       talent-garantiens potentiale-gulv (default 3 = øverste ~9 %)
//   --nation-profile <m>   all (default, godkendt design) | exclude-fill-tail (uden startholdets auto-fyld)
//   --team <uuid>          begræns til ét hold (gentageligt) — til en prøvekørsel
//   --report-dir <dir>     default docs/snapshots/5844 (gitignored: PRIVAT, committes aldrig)
//   --json                 print rå JSON i stedet for tekst
//
// Kørsel:
//   railway run --service CyclingZone -- node scripts/boardThankYouYouth5844.js
//   railway run --service CyclingZone -- node scripts/boardThankYouYouth5844.js --apply --owner-go
//
// Snapshot-format (--snapshot): { season:{id,number,start_date}, claimedTeamIds:[...],
//   teams:[{ id, is_ai, is_bank, is_frozen, is_test_account, retired_at, parked_at,
//            league_division_id, nations:{ "DK": 12, ... }, u23: n, junior: n }] }
// Navne-dedup mod hele rytter-DB'en sker ikke i snapshot-tilstand (kun internt i kuldet);
// det påvirker kun navnene, ikke tal/fordelinger.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import {
  BOARD_GIFT_BATCH,
  BOARD_GIFT_EXPIRY_DAYS,
  BOARD_GIFT_TOP_TALENT_MIN,
  BOARD_GIFT_TOTAL,
  isBoardGiftRecipient,
  planBoardGift,
  runBoardThankYouGift,
  summarizeBoardGiftRun,
} from "../lib/academyBoardGift.js";
import { referenceYearForSeason } from "../lib/academyIntake.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPORT_DIR = join(__dirname, "..", "..", "docs", "snapshots", "5844");

export function parseArgs(argv) {
  const args = { apply: false, ownerGo: false, json: false, snapshot: null, topMin: BOARD_GIFT_TOP_TALENT_MIN, nationProfile: "all", teams: [], reportDir: DEFAULT_REPORT_DIR };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--owner-go") args.ownerGo = true;
    else if (a === "--dry-run") args.apply = false;
    else if (a === "--json") args.json = true;
    else if (a === "--snapshot") args.snapshot = argv[++i];
    else if (a === "--top-min") args.topMin = Number(argv[++i]);
    else if (a === "--team") args.teams.push(argv[++i]);
    else if (a === "--nation-profile") args.nationProfile = argv[++i];
    else if (a === "--report-dir") args.reportDir = argv[++i];
    else throw new Error(`ukendt flag: ${a}`);
  }
  if (args.apply && args.snapshot) throw new Error("--apply kan ikke kombineres med --snapshot");
  return args;
}

/** Apply-gaten: --apply alene er aldrig nok. */
export function applyRefusals(args) {
  const refusals = [];
  if (args.apply && !args.ownerGo) refusals.push("--apply kræver --owner-go (ejerens ordrette \"kør\")");
  return refusals;
}

/** Dry-run fra et read-only prod-udtræk (ingen DB-klient). */
export function planFromSnapshot(snapshot, { topTalentMin = BOARD_GIFT_TOP_TALENT_MIN, nationProfileMode = "all", onlyTeamIds = [] } = {}) {
  const season = snapshot.season;
  let recipients = (snapshot.teams ?? []).filter(isBoardGiftRecipient);
  if (onlyTeamIds.length > 0) recipients = recipients.filter((t) => onlyTeamIds.includes(t.id));
  const profiles = new Map(recipients.map((t) => {
    const expand = (dict) => {
      const out = [];
      for (const [code, n] of Object.entries(dict ?? {})) for (let i = 0; i < n; i++) out.push(code);
      return out;
    };
    return [t.id, {
      nations: expand(t.nations),
      nationsExclFillTail: expand(t.nationsExclFillTail ?? t.nations),
      u23: t.u23 ?? 0,
      junior: t.junior ?? 0,
    }];
  }));
  return {
    ...planBoardGift({
      season,
      referenceYear: referenceYearForSeason(season),
      recipients,
      profiles,
      claimed: new Set(snapshot.claimedTeamIds ?? []),
      existingNames: new Set(),
    }, { topTalentMin, nationProfileMode }),
    source: "snapshot",
    snapshotTakenAt: snapshot.takenAt ?? null,
  };
}

function pct(n, d) {
  return d === 0 ? "0 %" : `${((100 * n) / d).toFixed(1)} %`;
}

/** Markdown-rapport. Indeholder hold-id'er, aldrig holdnavne. PRIVAT (gitignored). */
export function renderReport(run, summary, { generatedAt = new Date().toISOString() } = {}) {
  const lines = [];
  lines.push(`# #5844 · Tak fra bestyrelsen · ${run.dryRun ? "DRY-RUN" : "APPLY"}`);
  lines.push("");
  lines.push(`> PRIVAT rapport (gitignored). Må ikke citeres med tal/hold i GitHub-kommentarer.`);
  lines.push("");
  lines.push(`- Genereret: ${generatedAt}${run.source === "snapshot" ? ` · kilde: read-only prod-udtræk ${run.snapshotTakenAt ?? ""}` : " · kilde: prod (read-only)"}`);
  lines.push(`- Sæson: S${run.seasonNumber} (referenceår ${run.referenceYear}) · batch \`${run.batch}\` · seed ${run.seed}`);
  lines.push(`- Talent-gulv: potentiale ≥ ${run.topTalentMin} · nationsprofil: \`${run.nationProfileMode}\` · frist ${BOARD_GIFT_EXPIRY_DAYS} dage · signing-fee 0`);
  lines.push("");
  lines.push("## Modtagere og tilbud");
  lines.push("");
  lines.push("| Tal | Værdi |");
  lines.push("|---|---:|");
  lines.push(`| Modtager-hold (filter) | ${summary.recipients} |`);
  lines.push(`| Hold der får kuldet nu | ${summary.planned} |`);
  lines.push(`| Allerede claimet (springes over) | ${summary.alreadyClaimed} |`);
  lines.push(`| Tilbud i alt | ${summary.offers} |`);
  lines.push(`| Tilbud pr. hold | ${summary.offersPerTeam.join(", ") || "-"} (mål ${BOARD_GIFT_TOTAL}) |`);
  lines.push(`| U23-alder / junior-alder | ${summary.bySquad.u23} / ${summary.bySquad.junior} |`);
  lines.push("");
  lines.push("## Plads i trupperne (loft U23 12 · junior 10, håndhæves ved signing)");
  lines.push("");
  lines.push("| Tal | Hold |");
  lines.push("|---|---:|");
  lines.push(`| Ingen ledig U23-plads | ${summary.teamsNoU23Slot} |`);
  lines.push(`| Ingen ledig junior-plads | ${summary.teamsNoJuniorSlot} |`);
  lines.push(`| Ingen ledig plads i nogen af dem | ${summary.teamsNoSlotAtAll} |`);
  lines.push(`| Under 10 ledige pladser i alt | ${summary.teamsFewerThan10Slots} |`);
  lines.push("");
  lines.push("## Kvalitet (potentiale-fordeling)");
  lines.push("");
  lines.push("| Potentiale | Antal | Andel |");
  lines.push("|---:|---:|---:|");
  for (const [p, n] of summary.potentials) lines.push(`| ${p.toFixed(1)} | ${n} | ${pct(n, summary.offers)} |`);
  lines.push("");
  lines.push(`- Hold med mindst ét talent ≥ ${run.topTalentMin}: **${summary.teamsWithTopTalent} af ${summary.planned}**`);
  lines.push(`- "Serious prospect" (≥ 4.5): ${summary.serious}`);
  lines.push("");
  lines.push("## Nationalitet");
  lines.push("");
  lines.push(`- Hold på normal fordeling (for få ryttere til en profil): ${summary.nationProfileFallback}`);
  lines.push(`- Gns. andel af et holds tilbud fra holdets egne top-3-nationer: ${pct(summary.avgShareFromTeamTopNations, 1)}`);
  lines.push("");
  lines.push("| Nation | Tilbud | Andel |");
  lines.push("|---|---:|---:|");
  for (const [code, n] of summary.nations.slice(0, 25)) lines.push(`| ${code} | ${n} | ${pct(n, summary.offers)} |`);
  if (summary.nations.length > 25) lines.push(`| (${summary.nations.length - 25} andre) | ${summary.nations.slice(25).reduce((s, [, n]) => s + n, 0)} | |`);
  lines.push("");
  lines.push("## Pr. hold (id, ingen navne)");
  lines.push("");
  lines.push("| Hold-id | Status | U23 nu/ledig | Junior nu/ledig | Top-nationer | Tilbud (trup:nation:pot) |");
  lines.push("|---|---|---|---|---|---|");
  for (const t of run.teams) {
    const nat = t.nationProfile ? t.nationProfile.map((n) => `${n.code}×${n.count}`).join(" ") : "normal";
    const offers = t.offers.map((o) => o.riderId ?? `${o.squad === "u23" ? "U" : "J"}:${o.nationality}:${o.potentiale}`).join(" ");
    lines.push(`| \`${t.teamId}\` | ${t.status} | ${t.squadCounts.u23}/${t.freeSlots.u23} | ${t.squadCounts.junior}/${t.freeSlots.junior} | ${nat} | ${offers} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function writeReport(dir, run, summary) {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 17);
  const kind = `${run.dryRun ? "dry-run" : "apply"}-${run.nationProfileMode}`;
  const mdPath = join(dir, `${kind}-${stamp}.md`);
  const jsonPath = join(dir, `${kind}-${stamp}.json`);
  writeFileSync(mdPath, renderReport(run, summary));
  writeFileSync(jsonPath, JSON.stringify({ summary, run }, null, 2));
  return { mdPath, jsonPath };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const refusals = applyRefusals(args);
  if (refusals.length > 0) {
    for (const r of refusals) console.error(`AFVIST: ${r}`);
    process.exit(2);
  }
  try {
    let run;
    if (args.snapshot) {
      const snapshot = JSON.parse(readFileSync(args.snapshot, "utf8"));
      run = planFromSnapshot(snapshot, { topTalentMin: args.topMin, nationProfileMode: args.nationProfile, onlyTeamIds: args.teams });
    } else {
      const dotenv = await import("dotenv");
      dotenv.config({ path: join(__dirname, "../.env"), quiet: true });
      const { createClient } = await import("@supabase/supabase-js");
      const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
      if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        console.error("SUPABASE_URL / SUPABASE_SERVICE_KEY mangler (kør via `railway run` eller backend/.env).");
        process.exit(2);
      }
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
      run = await runBoardThankYouGift(supabase, {
        dryRun: !args.apply,
        topTalentMin: args.topMin,
        nationProfileMode: args.nationProfile,
        onlyTeamIds: args.teams,
        log: (m) => console.log(m),
      });
    }
    const summary = summarizeBoardGiftRun(run);
    const paths = writeReport(args.reportDir, run, summary);
    if (args.json) console.log(JSON.stringify(summary, null, 2));
    else {
      console.log(`${run.dryRun ? "DRY-RUN" : "APPLY"} · batch ${BOARD_GIFT_BATCH}`);
      console.log(`Modtagere ${summary.recipients} · får kuldet ${summary.planned} · allerede claimet ${summary.alreadyClaimed} · tilbud ${summary.offers}`);
      console.log(`Rapport (privat): ${paths.mdPath}`);
    }
    const failed = run.teams.filter((t) => String(t.status).startsWith("failed"));
    if (failed.length > 0) console.error(`${failed.length} hold fejlede — se rapporten`);
    process.exit(failed.length > 0 ? 1 : 0);
  } catch (error) {
    console.error(error.message || error);
    process.exit(2);
  }
}
