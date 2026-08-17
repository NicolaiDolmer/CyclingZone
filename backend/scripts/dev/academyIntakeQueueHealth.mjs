// #3618-følgeforskning: READ-ONLY sundhedstjek af akademi-intake-køen.
//
// Baggrund: 17/8 blev "907 nye tilbud på 7 dage" (mod ~345/uge målt 10/8, jf.
// PR #3618) læst som at indstrømningen var tredoblet. Den reelle forklaring
// krævede 6 ad-hoc SQL-forespørgsler at grave frem: 637 af de 907 var ÉT
// engangs-kompensationskuld (#3576, kørt 10/8 for 9/8-hændelsen), ikke en
// tilbagevendende stigning. Den faktiske tilbagevendende indstrømning var kun
// vokset med holdtilvæksten (192→204 hold), og manager-svarraten var samtidig
// steget markant (~45/uge til ~148/uge). Ingen regression, ingen kode-fejl,
// men uden ét samlet værktøj skal den adskillelse gættes eller graves frem på
// ny hver gang nogen måler køen. Dette script er den adskillelse, gjort
// gentagelig: dagens kvote/mode (samme funktion som selve sweep'en bruger),
// sidste 7 dages ind/ud-strøm, og en dag-for-dag/hold-fordeling der flager
// dage med usædvanligt høj pr.-hold-gennemsnit (kompensations- eller
// incident-kuld) adskilt fra normal søndags-drip (~2/hold) og ny-hold-signup.
//
// Ingen --apply. Ingen writes nogen steder, kun SELECT.
//
//   infisical run --env=prod -- node backend/scripts/dev/academyIntakeQueueHealth.mjs
//   valgfrit: --days=21 (standard 14) for en længere dag-for-dag-fordeling
import { createClient } from "@supabase/supabase-js";
import {
  resolveDailyQuota,
  INTAKE_EXPIRY_BACKLOG_THRESHOLD,
  INTAKE_EXPIRY_STEADY_PER_DAY,
  INTAKE_EXPIRY_CATCHUP_PER_DAY,
  INTAKE_OFFER_EXPIRY_DAYS,
} from "../../lib/academyIntakeExpirySweep.js";
import { fetchAllRows } from "../../lib/supabasePagination.js";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE secrets (kør via: infisical run --env=prod -- node ...)");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const DAYS_BACK = Number(
  process.argv.find((a) => a.startsWith("--days="))?.split("=")[1] ?? 14
);

async function main() {
  const now = new Date();
  const cutoffIso = new Date(now.getTime() - INTAKE_OFFER_EXPIRY_DAYS * 86400000).toISOString();
  const sevenDaysAgoIso = new Date(now.getTime() - 7 * 86400000).toISOString();
  const windowStartIso = new Date(now.getTime() - DAYS_BACK * 86400000).toISOString();

  // 1) Status-totaler: hele tabellens tilstand. academy_intake har (langt) over
  //    1000 rækker, så et naivt .select() lyver stille (PostgREST-loftet).
  //    fetchAllRows er den kanoniske paginering (supabasePagination.js).
  const statusRows = await fetchAllRows(() =>
    sb.from("academy_intake").select("status").order("id")
  );
  const totals = {};
  for (const r of statusRows) totals[r.status] = (totals[r.status] ?? 0) + 1;

  // 2) Dagens kvote + mode: SAMME funktion som selve sweep'en kalder, så
  //    tallet her aldrig kan drifte fra hvad der faktisk kører i cron'en.
  const { quota, overdue } = await resolveDailyQuota(sb, cutoffIso);
  const mode = overdue > INTAKE_EXPIRY_BACKLOG_THRESHOLD ? "CATCHUP" : "STEADY";

  // 3) Sidste 7 dage: nye tilbud + hvad der forlod køen (udløb/signeret/afvist).
  const { count: new7d, error: new7dErr } = await sb
    .from("academy_intake")
    .select("id", { count: "exact", head: true })
    .gte("created_at", sevenDaysAgoIso);
  if (new7dErr) throw new Error(`new7d: ${new7dErr.message}`);

  const resolved7dRows = await fetchAllRows(() =>
    sb.from("academy_intake").select("status").gte("resolved_at", sevenDaysAgoIso).order("id")
  );
  const resolved7d = {};
  for (const r of resolved7dRows) resolved7d[r.status] = (resolved7d[r.status] ?? 0) + 1;

  // 4) Aktive menneskehold: samme filter som sundayIntakeTick/runAcademyIntake.
  const { count: activeTeams, error: teamsErr } = await sb
    .from("teams")
    .select("id", { count: "exact", head: true })
    .eq("is_ai", false).eq("is_bank", false).eq("is_frozen", false).eq("is_test_account", false);
  if (teamsErr) throw new Error(`activeTeams: ${teamsErr.message}`);

  // 5) Dag-for-dag/hold-fordeling: afslører batch-dage uden at nogen skal
  //    gætte. Søndags-drip er ~2/hold, ny-hold-signup varierer typisk under 5,
  //    et engangs-kompensationskuld ligger markant højere (fx #3576: op til 4/hold).
  const recentRows = await fetchAllRows(() =>
    sb.from("academy_intake").select("created_at, team_id").gte("created_at", windowStartIso).order("id")
  );
  const byDay = new Map();
  for (const r of recentRows) {
    const d = r.created_at.slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, { teams: new Set(), n: 0 });
    const bucket = byDay.get(d);
    bucket.teams.add(r.team_id);
    bucket.n += 1;
  }

  // ── Udskrift ─────────────────────────────────────────────────────────────
  console.log(`\n═══ Akademi-intake køe-sundhed: ${now.toISOString()} ═══\n`);
  console.log(`Status-totaler: ${JSON.stringify(totals)}`);
  console.log(`Aktive hold: ${activeTeams}`);
  console.log(
    `\nDagskvote lige nu: ${quota}/dag (${mode}), overmodne (>${INTAKE_OFFER_EXPIRY_DAYS}d): ${overdue} ` +
    `(katch-up-tærskel ${INTAKE_EXPIRY_BACKLOG_THRESHOLD})`
  );
  console.log(
    `Sidste 7 dage: ${new7d ?? 0} nye · ${resolved7d.expired ?? 0} udløbet · ` +
    `${resolved7d.signed ?? 0} signeret · ${resolved7d.rejected ?? 0} afvist`
  );

  const netWeek = (new7d ?? 0) - (resolved7d.expired ?? 0) - (resolved7d.signed ?? 0) - (resolved7d.rejected ?? 0);
  console.log(`Netto sidste 7 dage: ${netWeek >= 0 ? "+" : ""}${netWeek} (nye minus alle exits, negativt = køen dræner)`);

  console.log(`\nDag-for-dag (seneste ${DAYS_BACK} dage), ⚠ = pr.-hold-gennemsnit > 3 (sandsynligt engangs-/kompensationskuld):`);
  for (const [d, v] of [...byDay.entries()].sort()) {
    const perTeam = v.teams.size ? v.n / v.teams.size : 0;
    const flag = perTeam > 3 ? "  ⚠ batch?" : "";
    console.log(`  ${d}  ${String(v.n).padStart(4)} tilbud  ${String(v.teams.size).padStart(4)} hold  (${perTeam.toFixed(1)}/hold)${flag}`);
  }

  console.log(
    `\n(kvote-konstanterne, ${INTAKE_EXPIRY_STEADY_PER_DAY}/dag steady og ${INTAKE_EXPIRY_CATCHUP_PER_DAY}/dag catchup, ` +
    `er dokumenteret og begrundet i academyIntakeExpirySweep.js.)\n`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
