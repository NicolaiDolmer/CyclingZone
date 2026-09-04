#!/usr/bin/env node
// #4495 · Reparation: giv de akademiryttere der sidder fast over graduerings-
// alderen den udgang de skulle have haft.
//
// BAGGRUND: en graduate-auktion uden bud havde ingen udgang. Rytteren blev
// liggende hos saelgeren med is_academy=true (uden for senior-cappen) mens
// grad-raekken allerede var stemplet 'sold' — hverken solgt, promoveret, sluppet
// eller fri agent. Maalt i prod 31/8: 8 ryttere paa 22-23 aar paa 6 hold.
// Rod-aarsagen er lukket i samme PR (academyGraduation.releaseUnsoldGraduate,
// kaldt fra auctionFinalization's no-bid-gren) — dette script rydder op efter
// de raekker der allerede naaede at laase sig fast.
//
// SAMME PRAEDIKAT BEGGE VEJE: baade dry-run og apply bruger
// stuckAcademyGraduates.findStuckAcademyGraduates. En dry-run der viser andre
// ryttere end den efterfoelgende apply er den vaerste fejlklasse i et
// reparations-script (laering 3/9), saa der findes ikke et andet, "hurtigt"
// udvaelgelses-query her.
//
// SAMME UDGANG SOM MOTOREN: apply kalder releaseUnsoldGraduate — praecis den
// funktion finalization nu bruger. Ingen egen politik.
//
// Usage:
//   node backend/scripts/repairStuckAcademyGraduates.js --dry-run          # default, READ-ONLY
//   node backend/scripts/repairStuckAcademyGraduates.js --dry-run --json
//   node backend/scripts/repairStuckAcademyGraduates.js --apply --owner-go # KRAEVER EJER-GO
//
// --apply skriver mod prod og er bevidst gated bag BEGGE flag. Uden --owner-go
// afviser scriptet at koere. Koer ALDRIG --apply uden et eksplicit go paa netop
// de ryttere dry-run'en har vist ejeren (feedback_explicit_go_per_prod_step).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role)
// Exit: 0 = ok (0 kandidater eller apply lykkedes), 1 = kandidater fundet i dry-run,
//       2 = kald-/konfigurationsfejl.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findStuckAcademyGraduates, STUCK_GRADUATE_GRACE_HOURS } from "../lib/stuckAcademyGraduates.js";
import { releaseUnsoldGraduate } from "../lib/academyGraduation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });

/**
 * REN planlaegning (DB injiceres) — hvilke ryttere ville blive frigivet?
 * Ingen writes. Testbar uden createClient.
 *
 * @param {{supabase:object, now?:Date, graceHours?:number}} args
 * @returns {Promise<{generated_at:string, season_number:number|null, academy_checked:number, grace_hours:number, total_candidates:number, candidates:object[], by_team:object[]}>}
 */
export async function planRepair({ supabase, now = new Date(), graceHours = STUCK_GRADUATE_GRACE_HOURS }) {
  const { seasonNumber, checked, stuck } = await findStuckAcademyGraduates(supabase, { now, graceHours });

  const byTeam = new Map();
  for (const r of stuck) {
    byTeam.set(r.teamId, (byTeam.get(r.teamId) || 0) + 1);
  }

  return {
    generated_at: now.toISOString(),
    season_number: seasonNumber,
    academy_checked: checked,
    grace_hours: graceHours,
    total_candidates: stuck.length,
    // Ryttere der ALDRIG fik en grad-raekke har heller aldrig faaet deres
    // override-vindue. Tallet skal staa oeverst i beslutningsgrundlaget, ikke
    // gemmes i en detalje-linje — se advarslen i printHuman.
    never_offered: stuck.filter((r) => r.graduationStatuses.length === 0).length,
    candidates: stuck.map((r) => ({
      rider_id: r.riderId,
      team_id: r.teamId,
      ai_team_id: r.aiTeamId,
      age: r.age,
      pending_graduation_id: r.pendingGraduationId,
      pending_deadline: r.pendingDeadline,
      graduation_statuses: r.graduationStatuses,
    })),
    by_team: [...byTeam.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([team_id, riders]) => ({ team_id, riders })),
  };
}

/**
 * Udfoer reparationen: samme udgang som finalization giver en usolgt graduate.
 * Idempotent — releaseUnsoldGraduate er conditional, saa en rytter der imens er
 * kommet videre ad en anden sti springes over med en aarsag i stedet for at
 * blive flyttet.
 *
 * @param {{supabase:object, plan:object, now?:Date, release?:Function}} args
 */
export async function applyRepair({ supabase, plan, now = new Date(), release = releaseUnsoldGraduate }) {
  const results = [];
  for (const c of plan.candidates) {
    const res = await release(supabase, { teamId: c.team_id, riderId: c.rider_id, now });
    results.push({ rider_id: c.rider_id, team_id: c.team_id, ...res });
  }
  return {
    released: results.filter((r) => r.released).length,
    skipped: results.filter((r) => !r.released).length,
    results,
  };
}

function printHuman(plan, { apply }) {
  console.log(`#4495 fastlaaste akademi-graduates — ${apply ? "APPLY" : "DRY-RUN (read-only)"} — ${plan.generated_at}`);
  console.log(`Saeson: ${plan.season_number ?? "ingen aktiv"}  ·  akademiryttere tjekket: ${plan.academy_checked}  ·  grace: ${plan.grace_hours}t\n`);

  if (plan.total_candidates === 0) {
    console.log("Ingen fastlaaste akademi-graduates. Intet at reparere.");
    return;
  }

  console.log(`  ${plan.total_candidates} rytter(e) paa ${plan.by_team.length} hold:\n`);
  for (const t of plan.by_team) {
    const riders = plan.candidates.filter((c) => c.team_id === t.team_id);
    console.log(`  hold ${t.team_id} — ${t.riders} rytter(e)`);
    for (const r of riders) {
      const grad = r.pending_graduation_id
        ? `pending grad-raekke ${r.pending_graduation_id} (deadline ${String(r.pending_deadline).slice(0, 10)})`
        : r.graduation_statuses.length
          ? `grad-raekker: ${r.graduation_statuses.join(", ")}`
          : "INGEN grad-raekke — fik aldrig et override-vindue";
      console.log(`     - rytter ${r.rider_id}  alder ${r.age}  ·  ${grad}`);
    }
  }
  console.log(`\nUdgang ved --apply: fri agent (team_id=NULL, is_academy=false, kontraktfelter nullet) — samme udgang som en usolgt graduate-auktion nu giver.`);
  if (plan.never_offered > 0) {
    console.log(
      `\n⚠️  ${plan.never_offered} af de ${plan.total_candidates} har ALDRIG haft en grad-raekke, dvs. manageren fik aldrig\n` +
      `    valget promovér/saelg/slip. At frigive dem tager en rytter af holdet uden at manageren\n` +
      `    har haft sit vindue. Det er en EJER-BESLUTNING (fri agent vs. gen-aabn graduerings-vinduet\n` +
      `    vs. lad staa) — traef den paa denne liste FOER --apply.`
    );
  }
  if (!apply) {
    console.log("Ingen skrivning foretaget. Koer med --apply --owner-go EFTER eksplicit ejer-go.");
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const JSON_OUT = args.includes("--json");
  const APPLY = args.includes("--apply");
  const OWNER_GO = args.includes("--owner-go");

  if (APPLY && !OWNER_GO) {
    console.error("--apply kraever ogsaa --owner-go. Koer dry-run, vis ejeren listen, og faa et eksplicit go foerst.");
    process.exit(2);
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(2);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  try {
    const plan = await planRepair({ supabase });

    if (APPLY) {
      printHuman(plan, { apply: true });
      const outcome = await applyRepair({ supabase, plan });
      console.log(`\n${outcome.released} rytter(e) frigivet, ${outcome.skipped} sprunget over.`);
      for (const r of outcome.results.filter((x) => !x.released)) {
        console.log(`   ⏭  rytter ${r.rider_id}: ${r.reason}`);
      }
      console.log("Post-verify: koer scriptet igen med --dry-run — den skal vise 0 kandidater.");
      process.exit(0);
    }

    if (JSON_OUT) console.log(JSON.stringify(plan, null, 2));
    else printHuman(plan, { apply: false });
    process.exit(plan.total_candidates > 0 ? 1 : 0);
  } catch (error) {
    console.error(error?.message || error);
    process.exit(2);
  }
}
