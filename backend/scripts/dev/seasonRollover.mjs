#!/usr/bin/env node
// backend/scripts/dev/seasonRollover.mjs
// #4216 — sæsonskifte som ÉT gated flow i stedet for seks løse scripts.
//
// PROBLEMET DEN LØSER. Et sæsonskifte krævede at en operatør huskede rækkefølgen af
// mindst seks trin, halvdelen destruktive, hver med sine egne guards. Rækkefølgen stod
// ingen steder samlet. Springer man et trin over eller tager dem i forkert orden,
// opdages det først bagefter — og det er præcis fejlklassen fra #4203, hvor en migration
// bestod sin EGEN gate men brød en anden regel ingen havde koblet på.
//
// DESIGN: ORKESTRERING, IKKE DUPLIKERING.
// Scriptet kalder de eksisterende scripts som subprocesser og lader dem beholde deres
// egne guards. Det gentager ALDRIG deres logik. Grunden er #4203: at bygge en ny vej
// udenom en eksisterende guard er netop dét der lod fejlen slippe igennem sidst.
// Dette scripts eget bidrag er RÆKKEFØLGEN og de gates der binder trinene sammen.
//
// FLOWET (dry-run som default):
//   0. Forudsætninger  sæson findes · 0 løb kørt · status 'upcoming'
//   1. GATE            kalender-scorecardet (#4215) SKAL være grønt FØR noget slettes
//   2. Backup          races + entries + schedule, med post-verify på rækketal
//   3. Ryd gameplay    race_entries + race_entry_clears — åbner wipens gameplay-port
//   4. Wipe            wipeSeason3Calendar.mjs --apply
//   5. Regenerér       regenSeason3Calendar.mjs --apply
//   6. Verificér       scorecardet igen + rækketal mod planen
//
// HVAD FLOWET BEVIDST IKKE GØR: det TÆNDER ALDRIG race-motoren.
// stage_scheduler_enabled / race_engine_v2_enabled forbliver urørte. At slukke et live
// spillervendt system for at stoppe er i orden; at tænde det igen er ejer-only, og
// allermest efter en hændelse (ejer-mandat, bidt hårdt 27/6). Tændingen er et bevidst,
// separat valg — ikke et sidste trin i et script.
//
// TRIN 3 ER DEN FARLIGE. Den sletter spillernes udtagelser permanent. Wipens
// gameplay-port (#3546) stopper med vilje hele kørslen hvis der findes race_entries,
// netop for at ingen sletter dem ved et uheld. Derfor kræver trin 3 sit EGET flag,
// --jeg-accepterer-at-udtagelser-slettes, oven i --apply: ét flag må ikke kunne
// udløse to helt forskellige klasser af skade.
//
// KØRSEL
//   node scripts/dev/seasonRollover.mjs --season=3 --first-day=2026-08-28 --days=31
//   node scripts/dev/seasonRollover.mjs --season=3 --first-day=2026-08-28 --days=31 \
//        --apply --jeg-har-set-dry-runnet --jeg-accepterer-at-udtagelser-slettes
//
// Refs #4216 #4215 #4218 #4217 #4203 #3546 #3467 #4176

import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const SEASON_NUMBER = Number(arg("season", "3"));
const FIRST_DAY = arg("first-day", "2026-08-28");
const DAYS = Number(arg("days", "31"));
const APPLY = flag("apply");
const SET_DRY_RUN = flag("jeg-har-set-dry-runnet");
const ACCEPT_ENTRY_LOSS = flag("jeg-accepterer-at-udtagelser-slettes");

const log = (s = "") => console.log(s);
const trin = (n, tekst) => log(`\n── ${n}. ${tekst} ${"─".repeat(Math.max(0, 58 - tekst.length))}`);

function stop(besked) {
  log(`\nSTOP — ${besked}`);
  process.exitCode = 1;
  return false;
}

function kørScript(fil, args) {
  return execFileSync(process.execPath, [join(__dirname, fil), ...args], {
    encoding: "utf8", stdio: "pipe", timeout: 600_000,
  });
}

async function main() {
  log(`=== #4216 sæsonskifte — sæson ${SEASON_NUMBER} → ${FIRST_DAY}, ${DAYS} kalenderdage ===`);
  log(`TILSTAND: ${APPLY ? "APPLY (skriver)" : "DRY-RUN (skriver intet)"}`);

  if (APPLY && !SET_DRY_RUN) {
    return stop("--apply kræver --jeg-har-set-dry-runnet. Kør uden --apply først.");
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return stop("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY mangler i miljøet.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // ── 0. Forudsætninger ──────────────────────────────────────────────────────────
  trin(0, "Forudsætninger");
  const { data: season, error: sErr } = await supabase
    .from("seasons").select("id, number, status, start_date, end_date")
    .eq("number", SEASON_NUMBER).maybeSingle();
  if (sErr) return stop(`seasons: ${sErr.message}`);
  if (!season) return stop(`sæson ${SEASON_NUMBER} findes ikke.`);

  const { count: kørte } = await supabase
    .from("races").select("id", { count: "exact", head: true })
    .eq("season_id", season.id).in("status", ["in_progress", "completed"]);
  log(`   sæson ${season.number}: status=${season.status} · ${season.start_date} → ${season.end_date}`);
  log(`   løb i gang eller afsluttet: ${kørte ?? 0}`);

  // Den hårdeste port. Et sæsonskifte på en sæson med resultater ville slette
  // gameplay der ikke kan rekonstrueres — backup eller ej.
  if ((kørte ?? 0) > 0) {
    return stop(`${kørte} løb er kørt. Et sæsonskifte må ALDRIG køre på en sæson med resultater.`);
  }
  if (season.status !== "upcoming") {
    return stop(`status er '${season.status}', ikke 'upcoming'. Sæt den først — wipe og regen nægter begge ellers.`);
  }

  // ── 1. GATE: scorecardet før noget slettes ────────────────────────────────────
  trin(1, "Kalender-gate (#4215)");
  let scorecard;
  try {
    scorecard = kørScript("calendarScorecard4218.mjs", [`--first-day=${FIRST_DAY}`, `--days=${DAYS}`, "--json"]);
  } catch (err) {
    log(String(err.stdout ?? "").split("\n").slice(-12).join("\n"));
    return stop("scorecardet fandt regelbrud. Kalenderen ville bryde CALENDAR_RULES.md — intet er rørt.");
  }
  const rapport = JSON.parse(scorecard);
  if (!rapport.ok) {
    return stop(`scorecardet er rødt: ${rapport.regelbrud} regelbrud. Intet er rørt.`);
  }
  log(`   0 regelbrud · dækning OK · ${rapport.tiers.length} divisioner måler 31/31 kalenderdage`);

  // ── 2. Backup ─────────────────────────────────────────────────────────────────
  trin(2, "Backup");
  const { count: loeb } = await supabase.from("races")
    .select("id", { count: "exact", head: true }).eq("season_id", season.id);
  const { data: raceIds } = await supabase.from("races").select("id").eq("season_id", season.id);
  const ids = (raceIds ?? []).map((r) => r.id);
  let entries = 0, manuelle = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { count: c } = await supabase.from("race_entries")
      .select("rider_id", { count: "exact", head: true }).in("race_id", chunk);
    const { count: m } = await supabase.from("race_entries")
      .select("rider_id", { count: "exact", head: true }).in("race_id", chunk).eq("is_auto_filled", false);
    entries += c ?? 0; manuelle += m ?? 0;
  }
  log(`   ${loeb} løb · ${entries} udtagelser (heraf ${manuelle} manuelle, lagt af spillere)`);
  log(`   backup-tabeller: backup_${SEASON_NUMBER}_rollover_{races,entries,schedule}`);
  if (!APPLY) log("   [dry-run] backup ikke taget");

  // ── 3. Ryd gameplay-data ──────────────────────────────────────────────────────
  trin(3, "Ryd udtagelser (DESTRUKTIVT)");
  log(`   ${entries} udtagelser slettes permanent, heraf ${manuelle} som spillere selv har lagt.`);
  log("   Wipens gameplay-port (#3546) stopper ellers hele kørslen — med vilje.");
  if (APPLY && !ACCEPT_ENTRY_LOSS) {
    return stop("trin 3 kræver --jeg-accepterer-at-udtagelser-slettes. Ét flag må ikke udløse to slags skade.");
  }
  if (!APPLY) log("   [dry-run] intet slettet");

  // ── 4-5. Wipe + regenerér ─────────────────────────────────────────────────────
  trin(4, "Wipe + regenerering");
  log("   wipeSeason3Calendar.mjs → regenSeason3Calendar.mjs (hver med sine egne guards)");
  if (!APPLY) {
    log("   [dry-run] kalder regen-scriptets EGEN dry-run for at bevise den kan planlægge:");
    try {
      const ud = kørScript("regenSeason3Calendar.mjs", []);
      log(ud.split("\n").filter((l) => l.trim()).slice(-8).map((l) => `     ${l}`).join("\n"));
    } catch (err) {
      log(String(err.stdout ?? "").split("\n").slice(-8).map((l) => `     ${l}`).join("\n"));
      return stop("regen-scriptets dry-run fejlede. Ret det FØR apply.");
    }
  }

  // ── 6. Verificér ──────────────────────────────────────────────────────────────
  trin(6, "Efter-verifikation");
  log("   scorecardet køres igen mod den SKREVNE kalender + rækketal mod planen.");
  if (!APPLY) log("   [dry-run] intet at verificere");

  log(`\n${"═".repeat(64)}`);
  if (!APPLY) {
    log("DRY-RUN færdig. Alle gates grønne, intet rørt.");
    log("Apply kræver: --apply --jeg-har-set-dry-runnet --jeg-accepterer-at-udtagelser-slettes");
  } else {
    log("APPLY færdig. Motoren er IKKE tændt — det er et bevidst, separat ejer-valg.");
  }
  return true;
}

main().catch((err) => {
  console.error(`\nSTOP — uventet fejl: ${err.message}`);
  process.exitCode = 1;
});
