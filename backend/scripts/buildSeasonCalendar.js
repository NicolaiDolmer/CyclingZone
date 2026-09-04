#!/usr/bin/env node
// backend/scripts/buildSeasonCalendar.js
// #3295: byg en sæsons kalender MANUELT og gate-beskyttet, før cutoveren.
//
//   node scripts/buildSeasonCalendar.js --season 4 --first-day 2026-09-28 --uniform-tilt          # DRY-RUN
//   node scripts/buildSeasonCalendar.js --season 4 --first-day 2026-09-28 --uniform-tilt --apply  # skriver
//
// HVORFOR SCRIPTET FINDES (ejer-valg 6/8, SEASON_CUTOVER_RUNBOOK.md punkt 1):
// S3-kalenderen fandtes ikke, og der var to veje: (A) byg den manuelt i god tid, eller
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
//   · §2's "løb hver kalenderdag i ALLE divisioner" (ejer-låst 25/8) skal være ren.
//     Ingen override — det er en ejer-regel, ikke et balance-mål.
//   · Kompositionen (#3295) skal ramme K-B, både på SÆSON-AGGREGATET og PR. TIER (#3469,
//     leverance 4 — en tier kunne før forsvinde i sæson-gennemsnittet). Hver af de to
//     niveauer har sit EGET override-flag (--allow-composition-drift hhv.
//     --allow-tier-composition-drift), fordi det er balance-målsætninger, ikke
//     korrekthedsinvarianter, og afvigelsen printes så tydeligt at ingen kan overse hvad
//     de accepterede. #4270 tilføjer to af samme slags: --allow-finale-drift (§7b's
//     finale-bånd) og --allow-uniform-target-drift (§6b's tre uniforme mål).
//   · Første løbsdag SKAL være i fremtiden — resolveCalendarFrom kaster ellers. Det er
//     guarden fra 27/6-blitzen, hvor en kalender materialiseret i fortiden fik
//     race-scheduleren til at afvikle en hel sæson på minutter.
//   · Sidste løbsdag SKAL være en søndag (§2, ejer-låst 23/8, #4131) — resolveSeasonWindow
//     kaster ellers og printer de lovlige længder.
//   · Idempotent: materializeTierCalendars dedup'er mod eksisterende (season, pulje,
//     pool_race). En gentaget kørsel tilføjer intet.
//
// #4270 — HVAD DER KOM TIL MED S4:
//   1. `--race-days` / `--last-day`: sæsonlængden UDLEDES af §2 i stedet for at arve
//      materializerens gamle default på 28 dage (og dermed kvoten 140/112/84/56, som
//      CALENDAR_RULES.md §1b udpeger som det forkerte af tre kvote-tal). Kvoten er
//      density × løbsdatoer, samme afledning som regenSeason3Calendar.mjs brugte til S3.
//   2. `--uniform-tilt`: slår §6b's pr.-division filler-tilt til (#4103, ejer-beslutning
//      31/8, "valg A" — bygget FRA-som-default netop så et menneske skal tænde den ved
//      den næste generering).
//   3. Dry-run kører HELE kalender-scorecardet (lib/calendarScorecardReport.js, samme kode
//      som CI's calendarScorecard4218.mjs) mod den PLANLAGTE kalender og printer grøn/rød
//      pr. regel pr. division. Før #4270 målte dry-runnet kun kompositionen.
//
// #4270 — EJERENS BESLUTNINGER 3/9 (se docs/CALENDAR_RULES.md §1, §1b, §2, §4, §5):
//   4. `--race-days` behøves ikke længere for en sæson med et EJER-VALGT vindue
//      (SEASON_RACE_DAYS_DEFAULT i calendarStartDate.js). S4 = 28 løbsdatoer.
//   5. TRE nye PLACERINGS-GATES, hårde krav UDEN override (calendarPlacementGates.js):
//        §1b  kvote-opfyldelse EKSAKT 100 % pr. division
//        §4   monument må ikke ligge inde i et GT's LØBSDAGS-spænd (#4203)
//        §1   mindste-overlap pr. division (#3329)
//      De stopper --apply, men lader dry-runnet køre til ende: dry-runnet er det eneste
//      sted man kan MÅLE hvor langt der er igen, og nogle af bruddene lukkes af kataloget
//      frem for af en regel (§5b).
//
// EFTER APPLY kører scriptet en post-verify (rækketal pr. tier + at ingen etape er
// planlagt i fortiden) og printer den, så resultatet ikke skal tages på tro.
//
// Refs #3295 #3469 #4270 #4176 #4203 #4215 #4288 #4557 #3329.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { materializeTierCalendars, TIER_DENSITY } from "../lib/tierCalendarMaterializer.js";
import { resolveCalendarFrom, resolveSeasonWindow, SEASON_RACE_DAYS_DEFAULT } from "../lib/calendarStartDate.js";
import { gatePlan } from "../lib/seasonCalendarGate.js";
import { scoreCalendarPlan, formatScorecard, scorecardGateGroups } from "../lib/calendarScorecardReport.js";
import { findNextSeason } from "../lib/seasonLookup.js";
import { ensureSeasonTransitionPlannedAt } from "../lib/seasonTransitionBoundary.js";

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

/** Kvoten pr. tier: density × løbsdatoer (CALENDAR_RULES.md §1b — den gyldige af de tre). */
export function quotasForRaceDays(raceDays, density = TIER_DENSITY) {
  return Object.fromEntries(Object.entries(density).map(([tier, d]) => [Number(tier), d * raceDays]));
}

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
  const raceDaysArg = argOf("--race-days");
  const lastDayArg = argOf("--last-day");
  const apply = process.argv.includes("--apply");
  const uniformTilt = process.argv.includes("--uniform-tilt");
  const allowDrift = process.argv.includes("--allow-composition-drift");
  const allowTierDrift = process.argv.includes("--allow-tier-composition-drift");
  const allowFinaleDrift = process.argv.includes("--allow-finale-drift");
  const allowUniformDrift = process.argv.includes("--allow-uniform-target-drift");

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
    // resolveCalendarFrom's `from` er dagen FØR dag 0; første løbsdag er dagen efter.
    const firstRaceDay = new Date(from.getTime() + 86_400_000).toISOString().slice(0, 10);

    // §2: længden UDLEDES (søndags-slut, løbsdatoer = slut − start + 1). Uden et eksplicit
    // valg foreslås den lovlige længde tættest på S3's 31 — se resolveSeasonWindow.
    // #4270 (ejer 3/9): en saeson med et EJER-VALGT vindue (SEASON_RACE_DAYS_DEFAULT) skal
    // ikke kraeve --race-days paa kommandolinjen. S4 = 28. Alle andre saesoner faar fortsat
    // et udledt forslag som skal bekraeftes eksplicit foer --apply.
    // Praecedens: --race-days > --last-day > ejer-valgt saesonvindue > udledt forslag.
    const seasonDefaultDays = SEASON_RACE_DAYS_DEFAULT[seasonNumber] ?? null;
    const explicitDays = raceDaysArg != null ? Number(raceDaysArg) : null;
    const window = resolveSeasonWindow({
      firstRaceDay,
      raceDays: explicitDays ?? (lastDayArg ? null : seasonDefaultDays),
      lastRaceDay: lastDayArg || null,
    });
    const realDays = window.raceDays;
    const quotas = quotasForRaceDays(realDays);

    console.log(`  første løbsdag = ${firstRaceDay}${firstDay ? "" : " (næste mandag)"} · from-anker = ${from.toISOString()}`);
    console.log(`\n── §2 sæsonvindue ──`);
    console.log(`  ${firstRaceDay} → ${window.lastRaceDay} · ${realDays} løbsdatoer · sidste dag er en søndag: OK`);
    if (explicitDays == null && !lastDayArg && seasonDefaultDays != null) {
      console.log(`  længden er sæson ${seasonNumber}'s EJER-VALGTE vindue (${seasonDefaultDays} løbsdatoer, docs/CALENDAR_RULES.md §2) — ikke et udledt forslag.`);
    }
    console.log(`  kvote pr. division (density × løbsdatoer, §1b): ${Object.entries(quotas).map(([t, q]) => `D${t} ${q}`).join(" · ")}`);
    if (window.derived) {
      console.log(`  ⚠ LÆNGDEN ER UDLEDT, IKKE VALGT. Lovlige længder for ${firstRaceDay}: ${window.candidates.map((c) => `${c.raceDays} (til ${c.lastRaceDay})`).join(" · ")}`);
      console.log(`     Forslaget er den der ligger tættest på S3's 31. Ejeren skal bekræfte — brug --race-days N eller --last-day YYYY-MM-DD.`);
    }
    console.log(`  §6b pr.-division filler-tilt (#4103): ${uniformTilt ? "TIL (--uniform-tilt)" : "FRA — sæt --uniform-tilt for at generere mod §6b's mål"}`);

    // Sæson-rækken skal findes: races.season_id har FK til seasons.id.
    const { data: seasonRow } = await supabase.from("seasons").select("id, number, status, start_date").eq("id", seasonId).maybeSingle();
    if (!seasonRow) {
      console.log(`\n  ⚠ sæson ${seasonNumber} findes ikke i seasons.`);
      if (!apply) {
        console.log(`     Ved --apply oprettes den med status='upcoming' og start_date = første løbsdag.`);
        console.log(`     Sæson-transitionen promoverer selv 'upcoming' → 'active' (insertSeasonIfMissing i seasonTransition.js),`);
        console.log(`     så pre-create kolliderer IKKE med cutoveren.`);
      }
    } else {
      console.log(`\n  sæson-række findes: status=${seasonRow.status} · start_date=${seasonRow.start_date}`);
      if (seasonRow.status === "active") {
        console.error(`\n❌ STOP: sæson ${seasonNumber} er allerede ACTIVE. At materialisere en kalender ind i en igangværende sæson er præcis 27/6-blitzens fejlklasse. Afbryder.`);
        process.exit(1);
      }
    }

    // #4557: årsmødet (proposeNextMandate) slår næste sæson op på `number` og springer
    // ALLE hold over hvis rækken mangler — uden at fejle. Rapportér tilstanden her, hvor
    // den kan ses, i stedet for at opdage den når mandaterne udebliver.
    const nextSeason = await findNextSeason({ supabase, currentNumber: seasonNumber - 1 });
    console.log(`  årsmødets næste-sæson-opslag (#4557): sæson ${nextSeason.number} ${nextSeason.found ? `findes (status=${nextSeason.season.status}) — mandater kan skrives` : "MANGLER — årsmødet springer alle hold over indtil rækken findes"}`);

    // 1) Planlæg (altid dry-run først — også når vi skal apply'e).
    const plan = await materializeTierCalendars({
      supabase, seasonId, seasonStartDate: firstRaceDay, from, dryRun: true, log: () => {},
      realDays, quotas, useUniformTierTilt: uniformTilt,
    });
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

    // #4270: HELE scorecardet mod den planlagte kalender — samme kode som CI's
    // calendarScorecard4218.mjs, men mod prods katalog og med den tilt der faktisk
    // ville blive brugt. Profilerne kommer fra materializeren selv, så scorecardet og
    // apply-stien aldrig kan måle hvert sit parcours.
    const profilesByTier = new Map(
      (plan.planTiers ?? []).map((t) => [t.tier, t.profilesByPoolRaceId ?? new Map()])
    );
    const rapport = scoreCalendarPlan({
      tierPlans: plan.planTiers ?? [],
      profilesByTier,
      archetypeByPoolRace: plan.archetypeByPoolRace ?? new Map(),
      firstRaceDay, realDays,
    });
    for (const line of formatScorecard(rapport, {
      heading: `SÆSON ${seasonNumber} — KALENDER-SCORECARD (planlagt, docs/CALENDAR_RULES.md §1-§7)`,
    })) console.log(line);

    const scorecardGates = scorecardGateGroups(rapport);
    blocking.push(...scorecardGates.blocking);

    // #4270 (ejer 3/9): de tre placerings-gates (§1b eksakt kvote, #4203 monument-i-GT,
    // #3329 mindste-overlap) er HAARDE krav uden override — men de stopper kun --apply.
    // Dry-runnet skal kunne koeres til ende, fordi det er det ENESTE sted man kan maale hvor
    // langt der er igen: nogle af dem lukkes af kataloget, ikke af en regel (§5b).
    const applyBlocking = scorecardGates.applyBlocking ?? [];
    if (applyBlocking.length) {
      console.error(`\n❌ PLACERINGS-GATES (${applyBlocking.length}) — hårde krav, ingen override:`);
      for (const b of applyBlocking) console.error(`   · ${b}`);
      if (apply) {
        console.error(`\nAfbryder. Ret årsagen; disse gates beskytter spillet, ikke scriptet.`);
        process.exit(1);
      }
      console.error(`   → dry-run fortsætter, så resten af scorecardet kan måles. Ved --apply stopper de.`);
    }

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
    // #4270: §7b og §6b er balance-MÅL som §6's komposition — hvert sit override-flag,
    // og afvigelsen printes fuldt ud, så ingen kan sætte flaget uden at se hvad de tog med.
    if (scorecardGates.finaleDrift.length) {
      console.warn(`\n⚠ FINALE-BÅND-AFVIGELSE (§7b, ${scorecardGates.finaleDrift.length}):`);
      for (const c of scorecardGates.finaleDrift) console.warn(`   · ${c}`);
      if (apply && !allowFinaleDrift) {
        console.error(`\nAfbryder. Gentag med --allow-finale-drift hvis afvigelsen er bevidst accepteret.`);
        process.exit(1);
      }
      if (allowFinaleDrift) console.warn(`   → --allow-finale-drift sat: fortsætter MED ovenstående afvigelse.`);
    }
    if (scorecardGates.uniformDrift.length) {
      console.warn(`\n⚠ UNIFORME MÅL-AFVIGELSE (§6b, ${scorecardGates.uniformDrift.length}):`);
      for (const c of scorecardGates.uniformDrift) console.warn(`   · ${c}`);
      if (apply && !allowUniformDrift) {
        console.error(`\nAfbryder. Kør igen med --uniform-tilt (hvis den ikke var sat), eller gentag med`);
        console.error(`--allow-uniform-target-drift hvis afvigelsen er bevidst accepteret (§5b: nogle af dem er katalog-lofter, ikke generator-fejl).`);
        process.exit(1);
      }
      if (allowUniformDrift) console.warn(`   → --allow-uniform-target-drift sat: fortsætter MED ovenstående afvigelse.`);
    }

    if (!apply) {
      console.log(`\nDRY-RUN slut — intet skrevet. Gentag med --apply for at bygge kalenderen.\n`);
      // Et dry-run med aabne placerings-gates maa ikke afslutte groent: forskellen paa
      // "intet brud" og "brud vi valgte at maale videre paa" skal vaere synlig i exit-koden.
      process.exitCode = applyBlocking.length ? 1 : 0;
    } else {
      if (!firstDay) { console.error("\n❌ --first-day YYYY-MM-DD kræves ved --apply (gæt aldrig sæsonens startdato)."); process.exit(2); }
      if (window.derived) {
        console.error("\n❌ Sæsonlængden er UDLEDT, ikke valgt. Ved --apply skal --race-days N eller --last-day YYYY-MM-DD sættes eksplicit");
        console.error("   (CALENDAR_RULES.md §2c: én regenerering pr. sæson — længden kan ikke rettes bagefter).");
        process.exit(2);
      }

      if (!seasonRow) {
        const { error } = await supabase.from("seasons").insert({ id: seasonId, number: seasonNumber, status: "upcoming", start_date: firstDay, end_date: null });
        if (error) throw new Error(`kunne ikke oprette sæson-rækken: ${error.message}`);
        console.log(`\n  ✓ sæson ${seasonNumber} oprettet med status='upcoming' (transitionen promoverer den til 'active').`);
      }

      // #4129: sæt/opdatér season_transition_planned_at eksplicit HER — samtidig
      // med at sæsonen oprettes/apply'es. Guarden (#4004) læste hidtil kun det
      // uskrevne start_date-gæt, fordi ingen kode nogensinde satte nøglen (kun
      // manuel SQL på selve cutover-aftenen, se issue #4129). Idempotent — se
      // ensureSeasonTransitionPlannedAt for hvornår den (ikke) overskriver.
      const transitionKeyResult = await ensureSeasonTransitionPlannedAt({
        supabase,
        seasonStartDate: seasonRow?.start_date ?? firstDay,
      });
      if (transitionKeyResult.updated) {
        console.log(`  ✓ season_transition_planned_at sat til ${transitionKeyResult.value} (#4129, årsag: ${transitionKeyResult.reason}).`);
      } else {
        console.log(`  · season_transition_planned_at ikke ændret (${transitionKeyResult.reason}).`);
      }

      console.log(`\n── APPLY ──`);
      const applied = await materializeTierCalendars({
        supabase, seasonId, seasonStartDate: firstDay, from, dryRun: false, log: (m) => console.log(m),
        realDays, quotas, useUniformTierTilt: uniformTilt,
      });
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
