#!/usr/bin/env node
// backend/scripts/dev/gateStatus5405.mjs
//
// #5405 — FOER/EFTER-toerkoersel for de tre nye bjergloeb + reservations-aendringen.
//
// HVORFOR ET EGET SCRIPT. Paa det tidspunkt PR'en skal bedoemmes, findes de tre nye loeb
// endnu IKKE i prod: migrationen (database/2026-09-20-5405-tre-nye-bjergloeb.sql) applies
// foerst af auto-migrate.yml EFTER merge. En almindelig
// `buildSeasonCalendar.js --season 4` fra denne branch ville derfor maale de haevede
// reservationer UDEN den forsyning de er dimensioneret til — altsaa den ene halvdel af
// indgrebet, hvilket er praecis den maaling der ikke betyder noget.
//
// Scriptet koerer derfor to toerkoersler mod prod-kataloget i samme proces:
//   FOER   produktionens reservationer som de var foer #5405, uden ekstra katalog-raekker
//   EFTER  TIER_ARCHETYPE_RESERVATIONS som de staar i koden nu + de tre nye raekker lagt
//          ind i en KOPI af kataloget via #3295's extraCatalogRows (dry-run-stien, som
//          selv kaster en fejl hvis nogen proever at bruge den uden dryRun)
//
// SKRIVER ALDRIG. Ingen --apply, ingen mutation af den frosne reservations-tabel (den
// klones), ingen S4-generering. Efter merge + migration er dette script overfloedigt:
// saa er `buildSeasonCalendar.js --season 4 --first-day <dato>` (UDEN --uniform-tilt,
// ejer-beslutning 3/9) den rigtige maaling, og DEN er den der gaelder foer en generering.
//
// Brug:
//   infisical run --env=prod -- node scripts/dev/gateStatus5405.mjs --season 4 --first-day 2026-09-28
//   ... --json   maskinlaesbart (fulde tal; de hoerer til i balance-internals/, ikke i repoet)
//
// Refs #5405 #3295 #4103

import { createClient } from "@supabase/supabase-js";
import { materializeTierCalendars } from "../../lib/tierCalendarMaterializer.js";
import { resolveCalendarFrom, resolveSeasonWindow, SEASON_RACE_DAYS_DEFAULT } from "../../lib/calendarStartDate.js";
import { quotasForRaceDays, seasonUuid } from "../buildSeasonCalendar.js";
import { scoreCalendarPlan, alleBrud, scorecardGateGroups } from "../../lib/calendarScorecardReport.js";
import { TIER_ARCHETYPE_RESERVATIONS } from "../../lib/tierCalendarGuarantees.js";
import { buildExternalId } from "../../lib/racePoolImport.js";

// Reservations-tabellen som den saa ud FOER #5405 (main @ 20/9). Hardkodet med vilje:
// "foer" skal vaere et fast referencepunkt, ikke noget der aendrer sig naar koden goer.
const RESERVATIONER_FOER_5405 = Object.freeze({
  1: { itt_classic: 1, cobbled_classic: 6, cobbled_tour: 1 },
  2: { summit_tour: 2, cobbled_tour: 1, itt_classic: 1, hilly_tour: 2, cobbled_classic: 5 },
  3: { summit_tour: 3, cobbled_tour: 1, itt_classic: 1, hilly_tour: 1, cobbled_classic: 4 },
  4: { summit_tour: 2, cobbled_tour: 1, itt_classic: 2, hilly_tour: 2, balanced_week: 2 },
});

// PRAECIS de tre raekker database/2026-09-20-5405-tre-nye-bjergloeb.sql indsaetter.
// external_id udledes som seed-importen goer det (buildExternalId), saa parcours her er
// det samme parcours raekkerne faar naar migrationen har koert.
const NYE_LOEB = Object.freeze([
  { name: "Volta Galega", country: "Spain", date_text: "14/4 - 18/4" },
  { name: "Rundfahrt der Hohen Tauern", country: "Austria", date_text: "9/7 - 13/7" },
  { name: "Volta Portuguesa", country: "Portugal", date_text: "6/8 - 10/8" },
].map((r) => {
  const external_id = buildExternalId(r.name, r.date_text);
  return Object.freeze({
    ...r, external_id,
    // Deterministisk pseudo-uuid — KUN gyldig i dry-run. Prod faar sit eget uuid ved
    // insert. id indgaar alene som tiebreaker i udvaelgelsens raekkefoelge, ikke i
    // parcours-seeden (den er external_id).
    id: `ffffffff-0000-4000-8000-${external_id.slice(0, 12)}`,
    race_class: "ProSeries", race_type: "stage_race", stages: 5, terrain_archetype: "summit_tour",
  });
}));

function klonMed(overrides) {
  const out = {};
  for (const [tier, cfg] of Object.entries(overrides)) out[tier] = { ...cfg };
  return out;
}

const argv = process.argv.slice(2);
const argOf = (flag, fallback = null) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const seasonNumber = Number(argOf("--season", "4"));
const firstDay = argOf("--first-day", "2026-09-28");
const asJson = argv.includes("--json");

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (koer via infisical run --env=prod)");
  process.exit(2);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const from = resolveCalendarFrom({ firstRaceDate: firstDay });
const firstRaceDay = new Date(from.getTime() + 86_400_000).toISOString().slice(0, 10);
const window = resolveSeasonWindow({ firstRaceDay, raceDays: SEASON_RACE_DAYS_DEFAULT[seasonNumber] ?? null });
const realDays = window.raceDays;
const quotas = quotasForRaceDays(realDays);

async function koer({ reservationer, extra }) {
  const plan = await materializeTierCalendars({
    supabase, seasonId: seasonUuid(seasonNumber), seasonStartDate: firstRaceDay, from,
    dryRun: true, log: () => {}, realDays, quotas,
    useUniformTierTilt: false, // ejer-beslutning 3/9: S4 maales UDEN --uniform-tilt
    archetypeReservations: klonMed(reservationer),
    extraCatalogRows: extra,
  });
  const planTiers = plan.planTiers ?? [];
  const rapport = scoreCalendarPlan({
    tierPlans: planTiers,
    profilesByTier: new Map(planTiers.map((t) => [t.tier, t.profilesByPoolRaceId ?? new Map()])),
    archetypeByPoolRace: plan.archetypeByPoolRace ?? new Map(),
    firstRaceDay, realDays,
  });
  const gates = scorecardGateGroups(rapport);
  const brud = alleBrud(rapport);
  const tiers = {};
  for (const t of rapport.tiers ?? []) {
    const viol = t.uniformViol ?? [];
    tiers[t.tier] = {
      bjergIMaal: !viol.some((v) => /bjerg|high_mountain/i.test(v)),
      enkeltstartIMaal: !viol.some((v) => /itt|enkeltstart/i.test(v)),
      uniformAfvigelser: viol.length,
      quotaHit: t.quotaHit,
      pct: t.uniform?.pct ?? null, // kun med i --json; hoerer til i balance-internals/
      viol, // ditto — de indeholder maalte procenter
    };
  }
  return {
    tiers,
    blokerende: gates.blocking?.length ?? 0,
    applyBlokerende: gates.applyBlocking?.length ?? 0,
    uniformAfvigelser: gates.uniformDrift?.length ?? 0,
    finaleAfvigelser: gates.finaleDrift?.length ?? 0,
    roede: Array.isArray(brud) ? brud.length : null,
  };
}

const foer = await koer({ reservationer: RESERVATIONER_FOER_5405, extra: [] });
const efter = await koer({ reservationer: TIER_ARCHETYPE_RESERVATIONS, extra: NYE_LOEB.map((r) => ({ ...r })) });

if (asJson) {
  console.log(JSON.stringify({ seasonNumber, firstRaceDay, realDays, quotas, foer, efter }, null, 2));
} else {
  const ja = (b) => (b ? "i maal" : "UDENFOR");
  console.log(`S${seasonNumber}, foerste loebsdag ${firstRaceDay}, ${realDays} loebsdage — UDEN --uniform-tilt\n`);
  console.log("division | bjergdage foer -> efter | enkeltstart foer -> efter | uniforme afvigelser foer -> efter");
  for (const tier of [1, 2, 3, 4]) {
    const a = foer.tiers[tier]; const b = efter.tiers[tier];
    if (!a || !b) { console.log(`D${tier} | (ingen plan)`); continue; }
    console.log(
      `D${tier}       | ${ja(a.bjergIMaal)} -> ${ja(b.bjergIMaal)}`
      + ` | ${ja(a.enkeltstartIMaal)} -> ${ja(b.enkeltstartIMaal)}`
      + ` | ${a.uniformAfvigelser} -> ${b.uniformAfvigelser}`,
    );
  }
  console.log(`\nblokerende fund        ${foer.blokerende} -> ${efter.blokerende}`);
  console.log(`apply-blokerende fund  ${foer.applyBlokerende} -> ${efter.applyBlokerende}`);
  console.log(`uniforme afvigelser    ${foer.uniformAfvigelser} -> ${efter.uniformAfvigelser}`);
  console.log(`finale-afvigelser      ${foer.finaleAfvigelser} -> ${efter.finaleAfvigelser}`);
  console.log(`roede punkter i alt    ${foer.roede} -> ${efter.roede}`);
  console.log(`kvote ramt eksakt      ${[1, 2, 3, 4].map((t) => `D${t} ${efter.tiers[t]?.quotaHit}`).join(" · ")}`);
}
