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
// EJER-BESLUTNING 5/9 (dry-run i prod viste 3 FORSKELLIGE historier, ikke kun
// den usolgte auktion): "det der giver mening er vel at rytteren, hvis
// manageren har hentet dem til deres akademi, at de saa flyttes op til
// seniorholdet ... hvis altsaa det er fordi rytteren er blevet for gammel."
// Det er YOUTH_RULES §2.2's default-kaede (promovér → saelg → slip), og
// scriptet vaelger nu handling PR. RYTTER efter hvilken historie han bærer:
//
//   (a) grad-raekke 'sold' uden gennemfoert salg → auktionen blev aldrig til
//       noget → SLIP (releaseUnsoldGraduate, uaendret siden #4495 v1).
//   (b) grad-raekke 'promoted' men is_academy stadig true → promoveringen kom
//       ud af trit med rytter-raekken → FULDFOER den (completeStuckPromotion,
//       samme felter + cap-tjek som resolveGraduation's promote-gren).
//   (c) INGEN grad-raekke overhovedet → fik aldrig sit override-vindue →
//       default-kaeden (resolveNeverGraduated): promovér hvis plads+raad,
//       ellers saelg (graduate-auktion), ellers slip.
//
// Alle tre genbruger byggeklodser fra academyGraduation.js — ingen ny
// promoverings-/salgs-/frigivelses-implementation her.
//
// SAMME PRAEDIKAT BEGGE VEJE: baade dry-run og apply bruger
// stuckAcademyGraduates.findStuckAcademyGraduates uaendret. En dry-run der
// viser andre ryttere end den efterfoelgende apply er den vaerste fejlklasse i
// et reparations-script (laering 3/9), saa der findes ikke et andet, "hurtigt"
// udvaelgelses-query her — kun HANDLINGEN pr. rytter er ny.
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
import { releaseUnsoldGraduate, completeStuckPromotion, resolveNeverGraduated } from "../lib/academyGraduation.js";
import { getTeamMarketState } from "../lib/marketUtils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });

// Hvilken historie baerer rytteren, og dermed hvilket led i default-kaeden er
// relevant? Rangeret: en overskredet 'pending'-raekke (sweepet er selv gaaet i
// staa — udenfor de tre dokumenterede tilstande, se docblok) fanges FOER de
// tre almindelige, saa den aldrig fejlklassificeres som "ingen raekke".
function classifyState(candidate) {
  if (candidate.pendingGraduationId) return "pending_overdue";
  if (candidate.graduationStatuses.includes("sold")) return "sold_no_sale";
  if (candidate.graduationStatuses.includes("promoted")) return "promoted_incomplete";
  if (candidate.graduationStatuses.length === 0) return "no_graduation_row";
  return "unknown_history";
}

/**
 * REN planlaegning (DB injiceres) — hvilken handling ville hver fastlaast
 * rytter faa? Ingen writes (getMarketState laeser holdets plads/saldo, men
 * skriver intet). Testbar uden createClient.
 *
 * @param {{supabase:object, now?:Date, graceHours?:number, getMarketState?:Function}} args
 * @returns {Promise<{generated_at:string, season_number:number|null, academy_checked:number, grace_hours:number, total_candidates:number, never_offered:number, candidates:object[], by_team:object[]}>}
 */
export async function planRepair({ supabase, now = new Date(), graceHours = STUCK_GRADUATE_GRACE_HOURS, getMarketState = getTeamMarketState }) {
  const { seasonNumber, checked, stuck } = await findStuckAcademyGraduates(supabase, { now, graceHours });

  const byTeam = new Map();
  const candidates = [];
  for (const r of stuck) {
    byTeam.set(r.teamId, (byTeam.get(r.teamId) || 0) + 1);

    const state = classifyState(r);
    let action = "release";
    let reason = "auktionen blev aldrig til et salg";
    let hasRoom = null;
    let canAfford = null;

    if (state === "pending_overdue") {
      action = "manual_review";
      reason = "har en overskredet pending grad-raekke — det daglige sweep boer haandtere denne; undersoeg foerst hvorfor det ikke er koert";
    } else if (state === "unknown_history") {
      action = "manual_review";
      reason = "uventet kombination af grad-raekke-status — kraever manuelt eftersyn";
    } else if (state === "sold_no_sale") {
      action = "release";
      reason = "auktionen blev aldrig til et salg";
    } else {
      // promoted_incomplete ELLER no_graduation_row: begge kan ende i "promovér",
      // begge har brug for plads/raad-svaret til beslutningsgrundlaget.
      const marketState = await getMarketState(supabase, r.teamId);
      const cap = marketState?.squad_limits?.max ?? 30;
      const future = marketState?.future_count ?? marketState?.rider_count ?? 0;
      const balance = Number(marketState?.balance ?? 0);
      hasRoom = future + 1 <= cap;
      canAfford = balance >= 0;

      if (state === "promoted_incomplete") {
        action = hasRoom ? "promote" : "manual_review";
        reason = hasRoom
          ? "fuldfoerer en promovering der blev haengende"
          : "ingen plads i seniortruppen — kan ikke fuldfoeres automatisk, kraever ejer-beslutning";
      } else {
        // no_graduation_row: default-kaedens foerste to led (tredje, slip,
        // afgoeres foerst ved apply hvis salget udskydes af #4004-graensen).
        if (hasRoom && canAfford) {
          action = "promote";
          reason = "plads og raad — default-kaedens foerste led";
        } else {
          action = "sell";
          reason = !hasRoom
            ? "ingen plads i seniortruppen — default-kaedens andet led (saelg)"
            : "holdet har negativ saldo — default-kaedens andet led (saelg)";
        }
      }
    }

    candidates.push({
      rider_id: r.riderId,
      team_id: r.teamId,
      ai_team_id: r.aiTeamId,
      age: r.age,
      pending_graduation_id: r.pendingGraduationId,
      pending_deadline: r.pendingDeadline,
      graduation_statuses: r.graduationStatuses,
      state,
      action,
      has_room: hasRoom,
      can_afford: canAfford,
      reason,
    });
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
    candidates,
    by_team: [...byTeam.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([team_id, riders]) => ({ team_id, riders })),
  };
}

/**
 * Udfoer reparationen: handlingen pr. rytter afgoeres af plan.candidates[].state
 * (SAMME klassifikation som printHuman viste ejeren) — ikke af det planlagte
 * .action-felt alene, saa apply altid RE-verificerer plads/raad paa
 * skrivetidspunktet i stedet for at stole paa et tal fra planlaegningen
 * (samme "genkoerbar, ikke stale" moenster som resolveNeverGraduated selv
 * bruger internt). 'manual_review'-kandidater roeres aldrig automatisk.
 *
 * Idempotent — alle tre byggeklodser (releaseUnsoldGraduate,
 * completeStuckPromotion, resolveNeverGraduated) er conditional, saa en rytter
 * der imens er kommet videre ad en anden sti springes over med en aarsag i
 * stedet for at blive flyttet.
 *
 * @param {{supabase:object, plan:object, seasonNumber?:number, now?:Date, release?:Function, promote?:Function, resolveNever?:Function}} args
 */
export async function applyRepair({
  supabase, plan, seasonNumber = plan.season_number, now = new Date(),
  release = releaseUnsoldGraduate, promote = completeStuckPromotion, resolveNever = resolveNeverGraduated,
}) {
  const results = [];
  for (const c of plan.candidates) {
    if (c.action === "manual_review") {
      results.push({ rider_id: c.rider_id, team_id: c.team_id, outcome: "skipped", reason: c.reason });
      continue;
    }
    try {
      let outcome; let reason; let salary;
      if (c.state === "sold_no_sale") {
        const res = await release(supabase, { teamId: c.team_id, riderId: c.rider_id, now });
        outcome = res.released ? "released" : "skipped";
        reason = res.reason;
      } else if (c.state === "promoted_incomplete") {
        const res = await promote(supabase, { teamId: c.team_id, riderId: c.rider_id, seasonNumber, now });
        outcome = res.completed ? "promoted" : "skipped";
        reason = res.reason;
        salary = res.salary;
      } else if (c.state === "no_graduation_row") {
        const res = await resolveNever(supabase, { teamId: c.team_id, riderId: c.rider_id, seasonNumber, now });
        outcome = res.action;
        reason = res.reason;
        salary = res.salary;
      } else {
        outcome = "skipped";
        reason = "unhandled_state";
      }
      results.push({ rider_id: c.rider_id, team_id: c.team_id, outcome, reason, salary });
    } catch (err) {
      results.push({ rider_id: c.rider_id, team_id: c.team_id, outcome: "skipped", reason: err.message });
    }
  }

  const summary = { released: 0, promoted: 0, sold: 0, skipped: 0 };
  for (const r of results) {
    if (r.outcome === "released") summary.released++;
    else if (r.outcome === "promoted") summary.promoted++;
    else if (r.outcome === "sold") summary.sold++;
    else summary.skipped++;
  }
  return { ...summary, results };
}

const ACTION_LABEL = Object.freeze({
  release: "SLIP (fri agent)",
  promote: "PROMOVÉR (op til seniorholdet)",
  sell: "SAELG (opret graduate-auktion)",
  manual_review: "MANUEL GENNEMGANG (ingen automatisk handling)",
});

function printHuman(plan, { apply }) {
  console.log(`#4495 fastlaaste akademi-graduates — ${apply ? "APPLY" : "DRY-RUN (read-only)"} — ${plan.generated_at}`);
  console.log(`Saeson: ${plan.season_number ?? "ingen aktiv"}  ·  akademiryttere tjekket: ${plan.academy_checked}  ·  grace: ${plan.grace_hours}t\n`);

  if (plan.total_candidates === 0) {
    console.log("Ingen fastlaaste akademi-graduates. Intet at reparere.");
    return;
  }

  console.log(`  ${plan.total_candidates} rytter(e) paa ${plan.by_team.length} hold — handling vaelges pr. rytter efter YOUTH_RULES §2.2's default-kaede:\n`);
  for (const t of plan.by_team) {
    const riders = plan.candidates.filter((c) => c.team_id === t.team_id);
    console.log(`  hold ${t.team_id} — ${t.riders} rytter(e)`);
    for (const r of riders) {
      const room = r.has_room === null ? "" : `  ·  plads: ${r.has_room ? "ja" : "nej"}`;
      const afford = r.can_afford === null ? "" : `  ·  raad: ${r.can_afford ? "ja" : "nej"}`;
      console.log(`     - rytter ${r.rider_id}  alder ${r.age}  ·  tilstand: ${r.state}${room}${afford}`);
      console.log(`       → ${ACTION_LABEL[r.action] ?? r.action}  (${r.reason})`);
    }
  }
  console.log(`\nUdgange: SLIP = fri agent (team_id=NULL, is_academy=false, kontraktfelter nullet). PROMOVÉR = is_academy=false, kontrakt uaendret/healet som resolveGraduation. SAELG = ny senior-graduate-auktion, rytteren forbliver is_academy=true til auktionen afgoeres.`);
  const manualReview = plan.candidates.filter((c) => c.action === "manual_review");
  if (manualReview.length > 0) {
    console.log(
      `\n⚠️  ${manualReview.length} rytter(e) kraever manuel gennemgang FOER --apply (ingen plads, overskredet pending-raekke, eller uventet historik):\n` +
      manualReview.map((r) => `     - rytter ${r.rider_id} (hold ${r.team_id}): ${r.reason}`).join("\n")
    );
  }
  if (plan.never_offered > 0) {
    console.log(
      `\n${plan.never_offered} af de ${plan.total_candidates} har ALDRIG haft en grad-raekke, dvs. manageren fik aldrig\n` +
      `valget promovér/saelg/slip. De foelger nu default-kaeden (samme som ejeren beskrev 5/9) i stedet\n` +
      `for automatisk slip.`
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
      console.log(`\n${outcome.promoted} promoveret, ${outcome.sold} sat til salg, ${outcome.released} frigivet, ${outcome.skipped} sprunget over/kraever manuel gennemgang.`);
      for (const r of outcome.results.filter((x) => x.outcome === "skipped")) {
        console.log(`   ⏭  rytter ${r.rider_id}: ${r.reason}`);
      }
      console.log("Post-verify: koer scriptet igen med --dry-run — den skal vise 0 kandidater (bortset fra evt. manual_review-ryttere).");
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
