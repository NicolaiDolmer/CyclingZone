#!/usr/bin/env node
// backend/scripts/dev/repairGameDayAxis4161.mjs
// #4161 — genskab in-game-aksen (`game_day`) i den AKTIVE sæsons kalender.
//
// HVAD DER GIK GALT: #4155-reparationen (PR #4158) skrev `game_day` som en ren dato-offset
// (`dato − start_date − 1`). Men `game_day` er IKKE kalenderdagen — det er den in-game dag
// der binder en rytter (raceBinding.js), og pakkeren lægger FLERE in-game-dage inden i hver
// kalenderdag, netop så divisionens tæthed kan afvikles uden at nogen in-game-dag bryder
// den ejer-låste `TIER_OVERLAP_CAP`. Målt på pakkerens eget Div 1-layout: 84-103 in-game-dage
// over 27-28 kalenderdage. Reparationen klappede dem ned til 27, og cap'en brød i ALLE fire
// divisioner (D1/D2: 4 samtidige løb mod cap 3 · D3/D4: 3 mod 2).
//
// HVAD DETTE SCRIPT GØR: `scheduled_at` blev ALDRIG rørt af #4155 og er stadig korrekt. Aksen
// kan derfor udledes af datoerne og tidsslottene alene (calendarGameDayRepair.js) — uden at
// flytte en eneste etape, uden at røre `races.scheduled_for`, og uden at genopbygge et eneste
// startfelt. Kun kolonnen `race_stage_schedule.game_day` skrives.
//
// HVORFOR DET ER SIKKERT FOR EKSISTERENDE HOLDUDTAGELSER: en bredere akse kan kun LØSNE
// bindingen (en rytter der før var låst til ét løb pr. kalenderdag kan nu køre ét løb pr.
// in-game-dag). Ingen eksisterende `race_entries`-række kan blive ugyldig af det. Scriptet
// verificerer det eksplicit før apply frem for at antage det.
//
// KØRSEL
//   dry-run (default, 100% read-only):
//     cd backend && infisical run --env=prod -- node scripts/dev/repairGameDayAxis4161.mjs
//   skrivning (KUN efter ejer-go):
//     cd backend && infisical run --env=prod -- node scripts/dev/repairGameDayAxis4161.mjs --apply --jeg-har-set-dry-runnet
//
// Refs #4161 #4162 #4159 #4155 #4169.

import { createClient } from "@supabase/supabase-js";
import { deriveGameDayAxis } from "../../lib/calendarGameDayRepair.js";
import { checkCalendarOverlapInvariants } from "../../lib/calendarOverlapInvariant.js";
import { TIER_OVERLAP_CAP } from "../../lib/calendarTierCaps.js";

const APPLY = process.argv.includes("--apply");
const CONFIRMED = process.argv.includes("--jeg-har-set-dry-runnet");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY"); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const dkDate = (iso) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(iso));

async function selectAll(table, select, apply, orderBy = "id") {
  const PAGE = 1000; const out = [];
  for (let from = 0; ; from += PAGE) {
    // #2974: eksplicit, unik sortering — uden den garanterer PostgREST ikke samme
    // raekkefoelge mellem to Range-requests, og sider kan overlappe eller mangle.
    let q = db.from(table).select(select).range(from, from + PAGE - 1).order(orderBy, { ascending: true });
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

function taelKonflikter(entries, gameDaysByRace) {
  const perRytter = new Map();
  for (const e of entries) {
    const gds = gameDaysByRace.get(e.race_id);
    if (!gds) continue;
    if (!perRytter.has(e.rider_id)) perRytter.set(e.rider_id, []);
    perRytter.get(e.rider_id).push(gds);
  }
  let n = 0;
  for (const spans of perRytter.values()) {
    for (let i = 0; i < spans.length; i++) {
      for (let j = i + 1; j < spans.length; j++) {
        for (const g of spans[i]) if (spans[j].has(g)) { n++; break; }
      }
    }
  }
  return n;
}

async function main() {
  const { data: seasons, error: sErr } = await db
    .from("seasons").select("id,number,status,start_date,race_days_completed,race_days_total")
    .eq("status", "active").limit(1);
  if (sErr) throw new Error(sErr.message);
  const season = seasons?.[0];
  if (!season) { console.error("Ingen aktiv sæson."); process.exit(1); }

  console.log(`\n#4161 game_day-akse-reparation — sæson ${season.number} (${season.status})`);
  console.log(`  start_date ${season.start_date} · løbsdage kørt ${season.race_days_completed}/${season.race_days_total}`);

  const races = await selectAll("races", "id,name,league_division_id,season_id,stages,status,stages_completed",
    (q) => q.eq("season_id", season.id));
  const divisions = (await db.from("league_divisions").select("id,tier,label")).data ?? [];
  const divById = new Map(divisions.map((d) => [d.id, d]));
  const raceById = new Map(races.map((r) => [r.id, r]));

  // Sikkerhedsport: aksen må kun omskrives så længe INGEN etape er afviklet. Er der kørt løb,
  // hænger resultater og bindinger på de nuværende værdier, og reparationen skal designes om
  // — ikke gennemtvinges.
  const koerte = races.filter((r) => (r.stages_completed ?? 0) > 0);
  if (koerte.length > 0 || (season.race_days_completed ?? 0) > 0) {
    console.log(`\n  [STOP] ${koerte.length} løb har kørte etaper (race_days_completed=${season.race_days_completed}).`);
    console.log("  Aksen må ikke omskrives under en igangværende sæson. Afbryder.");
    process.exit(1);
  }

  const allStages = await selectAll("race_stage_schedule", "race_id,stage_number,scheduled_at,game_day", undefined, "race_id");
  const mine = allStages.filter((s) => raceById.has(s.race_id));

  const byPool = new Map();
  for (const s of mine) {
    const pool = raceById.get(s.race_id).league_division_id;
    if (!byPool.has(pool)) byPool.set(pool, []);
    byPool.get(pool).push({ ...s, local_date: dkDate(s.scheduled_at) });
  }

  const updates = [];
  const rapport = [];
  for (const [poolId, rows] of byPool.entries()) {
    const div = divById.get(poolId);
    const tier = div?.tier;
    const cap = TIER_OVERLAP_CAP[tier] ?? 2;

    const foer = checkCalendarOverlapInvariants({ scheduleRows: rows, overlapCap: cap });
    const derived = deriveGameDayAxis({ scheduleRows: rows, overlapCap: cap });
    const efter = checkCalendarOverlapInvariants({ scheduleRows: derived.rows, overlapCap: cap });

    for (const r of derived.rows) if (r.old_game_day !== r.game_day) updates.push(r);

    rapport.push({
      pulje: div?.label ?? poolId, tier, cap,
      etaper: rows.length,
      gameDaysFoer: foer.gameDayCount, gameDaysEfter: derived.gameDayCount, kalenderdage: derived.dateCount,
      maxSamtidigeFoer: foer.maxOverlap, maxSamtidigeEfter: efter.maxOverlap,
      capBrudFoer: foer.overlapViolationCount, capBrudEfter: efter.overlapViolationCount,
      dubletterFoer: foer.stageRepeatViolationCount, dubletterEfter: efter.stageRepeatViolationCount,
      aendret: derived.changed,
    });
  }
  rapport.sort((a, b) => a.tier - b.tier || String(a.pulje).localeCompare(String(b.pulje)));

  console.log("\n  pulje                            tier cap etaper  game_days     kalender  max samtidige  cap-brud  ændret");
  for (const r of rapport) {
    console.log(
      `  ${String(r.pulje).padEnd(32)}${String(r.tier).padStart(4)}${String(r.cap).padStart(4)}` +
      `${String(r.etaper).padStart(7)}  ${String(r.gameDaysFoer).padStart(3)} → ${String(r.gameDaysEfter).padStart(3)}` +
      `${String(r.kalenderdage).padStart(13)}` +
      `${String(r.maxSamtidigeFoer).padStart(10)} → ${String(r.maxSamtidigeEfter)}` +
      `${String(r.capBrudFoer).padStart(9)} → ${String(r.capBrudEfter)}` +
      `${String(r.aendret).padStart(8)}`
    );
  }

  const restCap = rapport.reduce((s, r) => s + r.capBrudEfter, 0);
  const restDub = rapport.reduce((s, r) => s + r.dubletterEfter, 0);
  const dubFoer = rapport.reduce((s, r) => s + r.dubletterFoer, 0);
  console.log(`\n  I alt: ${updates.length} rækker får ny game_day.`);
  console.log(`  Etape-dubletter (2+ etaper af samme løb på én in-game-dag): før ${dubFoer} → efter ${restDub}.`);
  console.log(`  Cap-brud i alt: efter reparationen ${restCap}.`);
  console.log("  scheduled_at, races.scheduled_for og race_entries røres IKKE.");

  // Bindings-kontrol: ingen eksisterende udtagelse må blive ugyldig.
  const nyGameDay = new Map(updates.map((u) => [`${u.race_id}|${u.stage_number}`, u.game_day]));
  const entries = await selectAll("race_entries", "race_id,rider_id", undefined, "race_id");
  const mineEntries = entries.filter((e) => raceById.has(e.race_id));
  const foerNoegler = new Map(); const efterNoegler = new Map();
  for (const s of mine) {
    const gdEfter = nyGameDay.get(`${s.race_id}|${s.stage_number}`) ?? s.game_day;
    if (!foerNoegler.has(s.race_id)) { foerNoegler.set(s.race_id, new Set()); efterNoegler.set(s.race_id, new Set()); }
    foerNoegler.get(s.race_id).add(s.game_day);
    efterNoegler.get(s.race_id).add(gdEfter);
  }
  const konfliktFoer = taelKonflikter(mineEntries, foerNoegler);
  const konfliktEfter = taelKonflikter(mineEntries, efterNoegler);
  console.log(`  Udtagelser: ${mineEntries.length} · rytter-kollisioner på tværs af in-game-dage før ${konfliktFoer}, efter ${konfliktEfter}` +
    (konfliktEfter <= konfliktFoer ? "  [OK — reparationen strammer ikke]" : "  [ADVARSEL]"));

  if (!APPLY) {
    console.log("\n  DRY-RUN — intet skrevet. Kør med --apply --jeg-har-set-dry-runnet efter ejer-go.\n");
    return;
  }
  if (!CONFIRMED) { console.error("\n  --apply kræver også --jeg-har-set-dry-runnet. Intet skrevet.\n"); process.exit(1); }
  if (restCap > 0) { console.error(`\n  [STOP] Reparationen efterlader ${restCap} cap-brud. Intet skrevet.\n`); process.exit(1); }
  if (konfliktEfter > konfliktFoer) { console.error("\n  [STOP] Reparationen ville skabe nye bindings-konflikter. Intet skrevet.\n"); process.exit(1); }

  console.log(`\n  Skriver ${updates.length} rækker...`);
  let skrevet = 0;
  for (const u of updates) {
    const { error } = await db.from("race_stage_schedule")
      .update({ game_day: u.game_day }).eq("race_id", u.race_id).eq("stage_number", u.stage_number);
    if (error) throw new Error(`${u.race_id}/${u.stage_number}: ${error.message}`);
    skrevet++;
    if (skrevet % 200 === 0) console.log(`    ${skrevet}/${updates.length}`);
  }
  console.log(`  ${skrevet} rækker skrevet.`);

  // Post-verify mod DB, ikke mod hukommelsen.
  const efterDb = (await selectAll("race_stage_schedule", "race_id,stage_number,scheduled_at,game_day", undefined, "race_id"))
    .filter((s) => raceById.has(s.race_id));
  let brud = 0;
  for (const poolId of byPool.keys()) {
    const cap = TIER_OVERLAP_CAP[divById.get(poolId)?.tier] ?? 2;
    const poolRows = efterDb.filter((s) => raceById.get(s.race_id).league_division_id === poolId);
    const c = checkCalendarOverlapInvariants({ scheduleRows: poolRows, overlapCap: cap });
    brud += c.overlapViolationCount + c.stageRepeatViolationCount;
  }
  console.log(brud === 0 ? "  POST-VERIFY GRØN — 0 brud i databasen.\n" : `  POST-VERIFY RØD — ${brud} brud tilbage.\n`);
  if (brud > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(`[fatal] ${e.message}`); process.exit(1); });
