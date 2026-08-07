#!/usr/bin/env node
// backend/scripts/buildSeasonCalendar.js
// #3295: byg en sæsons kalender MANUELT og gate-beskyttet, før cutoveren.
//
//   node scripts/buildSeasonCalendar.js --season 3 --first-day 2026-08-24            # DRY-RUN
//   node scripts/buildSeasonCalendar.js --season 3 --first-day 2026-08-24 --apply    # skriver
//
// HVORFOR SCRIPTET FINDES (ejer-valg 6/8, SEASON_CUTOVER_RUNBOOK.md punkt 1):
// S3-kalenderen findes ikke, og der var to veje: (A) byg den manuelt i god tid, eller
// (B) lad sæson-transitionen bygge den som fase 17 (`auto_calendar_enabled='on'`).
// Ejeren valgte A, fordi B's kode-sti ALDRIG er kørt i en live cutover — fejler den kl. 03
// den 23/8, står spillerne uden kalender. Der fandtes intet dedikeret "byg ny sæson"-CLI;
// kun reparations-scripts (repair2251Tier4GrandTours.js / repair2276Div4Cascade.js), som
// begge kalder materializeTierCalendars direkte. Dette script er den manglende vej.
//
// SIKKERHED — hvad scriptet nægter at gøre:
//   · DRY-RUN er default. --apply er det ENESTE der skriver.
//   · Kalender-invarianter (#2251/#2276/#3327/#3328) skal være rene. Ingen override.
//   · Realisme-båndene (#2755/#2769/#3347) skal være grønne. Ingen override.
//   · Kompositionen (#3295) skal ramme K-B, både på SÆSON-AGGREGATET og PR. TIER (#3469,
//     leverance 4 — en tier kunne før forsvinde i sæson-gennemsnittet). Hver af de to
//     niveauer har sit EGET override-flag (--allow-composition-drift hhv.
//     --allow-tier-composition-drift), fordi det er balance-målsætninger, ikke
//     korrekthedsinvarianter, og afvigelsen printes så tydeligt at ingen kan overse hvad
//     de accepterede.
//   · Første løbsdag SKAL være i fremtiden — resolveCalendarFrom kaster ellers. Det er
//     guarden fra 27/6-blitzen, hvor en kalender materialiseret i fortiden fik
//     race-scheduleren til at afvikle en hel sæson på minutter.
//   · Idempotent: materializeTierCalendars dedup'er mod eksisterende (season, pulje,
//     pool_race). En gentaget kørsel tilføjer intet.
//
// EFTER APPLY kører scriptet en post-verify (rækketal pr. tier + at ingen etape er
// planlagt i fortiden) og printer den, så resultatet ikke skal tages på tro.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { materializeTierCalendars } from "../lib/tierCalendarMaterializer.js";
import { resolveCalendarFrom } from "../lib/calendarStartDate.js";
import { gatePlan } from "../lib/seasonCalendarGate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

export function seasonUuid(n) {
  return `00000000-0000-0000-0000-${Number(n).toString(16).padStart(12, "0")}`;
}

// #3469 (leverance 5): gatePlan flyttet til lib/seasonCalendarGate.js, så
// seasonTransition.js's forever-sti (fase 17, `auto_calendar_enabled`) kan køre PRÆCIS
// samme gate FØR den materialiserer med writes. Re-eksporteret uændret her, så CLI'en
// nedenfor og eksisterende kaldere/tests af `./buildSeasonCalendar.js` er upåvirkede.
export { gatePlan };

/** Post-verify EFTER apply: tæl det der faktisk står i DB, og fang etaper i fortiden. */
export async function postVerify({ supabase, seasonId }) {
  const { count: raceCount } = await supabase.from("races").select("id", { count: "exact", head: true }).eq("season_id", seasonId);
  const { data: races } = await supabase.from("races").select("id, league_division_id").eq("season_id", seasonId).limit(5000);
  const raceIds = (races || []).map((r) => r.id);

  let profileCount = 0, scheduleCount = 0, pastStages = 0;
  const nowIso = new Date().toISOString();
  for (let i = 0; i < raceIds.length; i += 200) {
    const chunk = raceIds.slice(i, i + 200);
    const { count: pc } = await supabase.from("race_stage_profiles").select("race_id", { count: "exact", head: true }).in("race_id", chunk);
    const { count: sc } = await supabase.from("race_stage_schedule").select("race_id", { count: "exact", head: true }).in("race_id", chunk);
    const { count: past } = await supabase.from("race_stage_schedule").select("race_id", { count: "exact", head: true }).in("race_id", chunk).lte("scheduled_at", nowIso);
    profileCount += pc ?? 0; scheduleCount += sc ?? 0; pastStages += past ?? 0;
  }

  const poolCounts = new Map();
  for (const r of races || []) poolCounts.set(r.league_division_id, (poolCounts.get(r.league_division_id) ?? 0) + 1);

  return { raceCount: raceCount ?? 0, profileCount, scheduleCount, pastStages, pools: [...poolCounts.entries()].sort((a, b) => a[0] - b[0]) };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argOf = (f) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; };
  const seasonNumber = Number(argOf("--season"));
  const firstDay = argOf("--first-day");
  const apply = process.argv.includes("--apply");
  const allowDrift = process.argv.includes("--allow-composition-drift");
  const allowTierDrift = process.argv.includes("--allow-tier-composition-drift");

  if (!Number.isInteger(seasonNumber) || seasonNumber < 1) {
    console.error("--season <N> kræves (heltal ≥ 1)"); process.exit(2);
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error("⚠ Missing SUPABASE creds"); process.exit(2); }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const seasonId = seasonUuid(seasonNumber);

  try {
    console.log(`\n=== Byg sæson ${seasonNumber}-kalender (${apply ? "APPLY — SKRIVER TIL PROD" : "DRY-RUN — skriver intet"}) ===`);
    console.log(`  season_id = ${seasonId}`);

    // `from` = dagen FØR første løbsdag. resolveCalendarFrom kaster hvis datoen ikke er
    // strengt i fremtiden (27/6-blitz-guarden) — vi fanger den ikke, den SKAL stoppe os.
    const from = resolveCalendarFrom({ firstRaceDate: firstDay || undefined });
    console.log(`  første løbsdag = ${firstDay || "(næste mandag)"} · from-anker = ${from.toISOString()}`);

    // Sæson-rækken skal findes: races.season_id har FK til seasons.id.
    const { data: seasonRow } = await supabase.from("seasons").select("id, number, status, start_date").eq("id", seasonId).maybeSingle();
    if (!seasonRow) {
      console.log(`  ⚠ sæson ${seasonNumber} findes ikke i seasons.`);
      if (!apply) {
        console.log(`     Ved --apply oprettes den med status='upcoming' og start_date = første løbsdag.`);
        console.log(`     Sæson-transitionen promoverer selv 'upcoming' → 'active' (insertSeasonIfMissing i seasonTransition.js),`);
        console.log(`     så pre-create kolliderer IKKE med cutoveren.`);
      }
    } else {
      console.log(`  sæson-række findes: status=${seasonRow.status} · start_date=${seasonRow.start_date}`);
      if (seasonRow.status === "active") {
        console.error(`\n❌ STOP: sæson ${seasonNumber} er allerede ACTIVE. At materialisere en kalender ind i en igangværende sæson er præcis 27/6-blitzens fejlklasse. Afbryder.`);
        process.exit(1);
      }
    }

    // 1) Planlæg (altid dry-run først — også når vi skal apply'e).
    const plan = await materializeTierCalendars({ supabase, seasonId, seasonStartDate: firstDay || null, from, dryRun: true, log: () => {} });
    const { blocking, compositionDrift, tierCompositionDrift, report } = gatePlan(plan, { allowTierCompositionDrift: allowTierDrift });

    console.log(`\n── Plan ──`);
    for (const t of plan.tiers) {
      console.log(`  tier ${t.tier}: ${t.totalGameDays}/${t.quota} game-days · ${t.pools.length} pulje(r) · ${t.pools.reduce((s, p) => s + p.selected, 0)} løb i alt${t.realismDraw?.attempt ? ` · realisme-gen-træk ${t.realismDraw.attempt}` : ""}`);
    }
    console.log(`\n── Komposition mod K-B ──`);
    for (const r of report.rows) {
      console.log(`  ${r.label.padEnd(9)} ${r.actual.toFixed(1).padStart(5)} %  mål ${String(r.target).padStart(2)} %  ${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(1)} pp  ${r.pass ? "OK" : "UDENFOR"}`);
    }
    console.log(`  (${report.season.raceDays} løbsdage)`);

    if (blocking.length) {
      console.error(`\n❌ BLOKERENDE (${blocking.length}) — kan ikke overrides:`);
      for (const b of blocking) console.error(`   · ${b}`);
      console.error(`\nAfbryder. Ret årsagen; disse gates beskytter spillet, ikke scriptet.`);
      process.exit(1);
    }
    if (compositionDrift.length) {
      console.warn(`\n⚠ KOMPOSITIONS-AFVIGELSE (${compositionDrift.length}):`);
      for (const c of compositionDrift) console.warn(`   · ${c}`);
      if (!allowDrift) {
        console.error(`\nAfbryder. Kør kalibreringen (scripts/calibrateCalendarComposition.js --plan ${seasonNumber}) eller`);
        console.error(`gentag med --allow-composition-drift hvis afvigelsen er bevidst accepteret.`);
        process.exit(1);
      }
      console.warn(`   → --allow-composition-drift sat: fortsætter MED ovenstående afvigelse.`);
    } else {
      console.log(`\n✅ Alle gates grønne: kalender-invarianter · realisme-bånd · etaperækkefølge · K-B-komposition.`);
    }
    if (tierCompositionDrift.length) {
      // #3469: kun nået hvis --allow-tier-composition-drift er sat (ellers er samme
      // brud allerede i `blocking` ovenfor og har stoppet scriptet).
      console.warn(`\n⚠ PR.-TIER KOMPOSITIONS-AFVIGELSE (${tierCompositionDrift.length}, lempet med --allow-tier-composition-drift):`);
      for (const c of tierCompositionDrift) console.warn(`   · ${c}`);
    }

    if (!apply) {
      console.log(`\nDRY-RUN slut — intet skrevet. Gentag med --apply for at bygge kalenderen.\n`);
      process.exitCode = 0;
    } else {
      if (!firstDay) { console.error("\n❌ --first-day YYYY-MM-DD kræves ved --apply (gæt aldrig sæsonens startdato)."); process.exit(2); }

      if (!seasonRow) {
        const { error } = await supabase.from("seasons").insert({ id: seasonId, number: seasonNumber, status: "upcoming", start_date: firstDay, end_date: null });
        if (error) throw new Error(`kunne ikke oprette sæson-rækken: ${error.message}`);
        console.log(`\n  ✓ sæson ${seasonNumber} oprettet med status='upcoming' (transitionen promoverer den til 'active').`);
      }

      console.log(`\n── APPLY ──`);
      const applied = await materializeTierCalendars({ supabase, seasonId, seasonStartDate: firstDay, from, dryRun: false, log: (m) => console.log(m) });
      console.log(`\n  ${applied.racesInserted} løb · ${applied.stageProfiles} etape-profiler · ${applied.stageSchedules} etape-tider indsat.`);

      console.log(`\n── POST-VERIFY ──`);
      const v = await postVerify({ supabase, seasonId });
      console.log(`  races=${v.raceCount} · race_stage_profiles=${v.profileCount} · race_stage_schedule=${v.scheduleCount}`);
      console.log(`  løb pr. pulje: ${v.pools.map(([d, n]) => `${d}:${n}`).join(" · ")}`);
      if (v.pastStages > 0) {
        console.error(`\n❌ ${v.pastStages} etape(r) er planlagt i FORTIDEN. Det er 27/6-blitzens tilstand — undersøg FØR race-scheduleren kører igen.`);
        process.exitCode = 1;
      } else if (v.raceCount === 0 || v.profileCount === 0) {
        console.error(`\n❌ Post-verify fandt 0 løb eller 0 profiler — apply gjorde ikke hvad den sagde.`);
        process.exitCode = 1;
      } else {
        console.log(`\n✅ Sæson ${seasonNumber}-kalenderen er bygget og verificeret. Ingen etape i fortiden.\n`);
        process.exitCode = 0;
      }
    }
  } catch (e) {
    console.error(`\n❌ ${e.message}`);
    console.error(e);
    process.exitCode = 2;
  }
}
