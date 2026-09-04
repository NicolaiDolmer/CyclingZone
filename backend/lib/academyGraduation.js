// Akademi-promotion-flow ved 22 (#932). Akademiryttere der passerer 21 ved
// sæson-skift sættes i pending-graduering; holdet vælger promover/sælg/slip i et
// override-vindue, ellers auto-resolverer sweepet (academyGraduationSweep.js) via
// default-kæden. Spec: docs/superpowers/specs/2026-06-18-academy-promotion-flow-design.md
//
// Determinisme: detektion er sæson-diskret (ageForSeason), idempotent via
// UNIQUE(rider_id, season_id) + status-gating. Fair-premium (#1142): ingen
// rigtige penge — promover/sælg/slip købes/udføres med in-game-økonomi.

import { ageForSeason } from "./riderProgressionEngine.js";
import { fetchAllRows } from "./supabasePagination.js";
import { notifyTeamOwner } from "./notificationService.js";
import { contractOnAcquirePatch } from "./contractSeed.js";
import { getTeamMarketState, calculateRiderMarketValue } from "./marketUtils.js";
import { calculateAuctionEnd, DEFAULT_AUCTION_CONFIG, FREE_AGENT_MIN_DURATION_HOURS, getAuctionSeasonBoundaryIssue } from "./auctionEngine.js";
import { fetchSeasonTransitionBoundary } from "./seasonTransitionBoundary.js";
import { clearFutureRaceEntriesSafe } from "./raceEntryCleanup.js";

export const GRADUATION = Object.freeze({
  GRADUATE_AGE: 22,   // alder hvor akademi-ophold slutter (MAX_AGE 21 + 1)
  DEADLINE_DAYS: 7,   // override-vindue i dage. SIM-STARTPUNKT — ejer-godkendes (scorecard).
});

const VALID_ACTIONS = new Set(["promote", "sell", "release"]);

/**
 * Slå den AKTUELLE pending graduerings-række op for (hold, rytter).
 *
 * #4484: academy_graduation er UNIQUE(rider_id, season_id) — én række pr.
 * rytter PR. SÆSON. En rytter der har været i akademiet over to sæsoner på
 * samme hold har derfor FLERE rækker, og et opslag på team_id+rider_id alene
 * rammer dem alle. PostgREST's maybeSingle() svarer da med en fejl + data=null,
 * hvilket alle fire kaldsteder læste som "ingen række":
 *   - resolveGraduation kastede 'not_pending' i evig løkke (graduerings-sweepet
 *     fejlede 23 gange på én nat, og manageren fik 409 på sin egen knap),
 *   - de tre best-effort-stier sprang stille deres oprydning over.
 *
 * Derfor: scope på status='pending' og tag den nyeste (den aktive sæsons).
 * Kaster ved DB-fejl — en fejlet SELECT må ikke maskere sig som "ingen række".
 */
export async function findPendingGraduation(supabase, { teamId, riderId } = {}) {
  const { data, error } = await supabase.from("academy_graduation")
    .select("id, status")
    .eq("team_id", teamId).eq("rider_id", riderId).eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`findPendingGraduation: ${error.message}`);
  return data ?? null;
}

export function isGraduateAge(age) {
  return Number.isFinite(age) && age >= GRADUATION.GRADUATE_AGE;
}

/**
 * Opret pending-graduerings-rows for akademiryttere der har passeret 21 i den
 * aktive (ny) sæson. Idempotent: rytter med eksisterende grad-row for season
 * skippes. deadline = now + GRADUATION.DEADLINE_DAYS. Kaldes i season-transition.
 *
 * @returns {Promise<{dryRun:boolean, graduates:number}>}
 */
export async function detectGraduates(supabase, { seasonId, seasonNumber, now = new Date(), dryRun = false, notify = notifyTeamOwner } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!seasonId || !Number.isFinite(seasonNumber)) throw new Error("detectGraduates: seasonId + seasonNumber required");

  const academy = await fetchAllRows(() =>
    supabase.from("riders")
      .select("id, team_id, firstname, lastname, birthdate")
      .eq("is_academy", true).eq("is_retired", false).order("id"));

  const existing = await fetchAllRows(() =>
    supabase.from("academy_graduation").select("rider_id").eq("season_id", seasonId).order("rider_id"));
  const alreadyRowed = new Set(existing.map((r) => r.rider_id));

  const deadline = new Date(now.getTime() + GRADUATION.DEADLINE_DAYS * 86_400_000).toISOString();
  let graduates = 0;
  for (const r of academy) {
    if (alreadyRowed.has(r.id)) continue;
    const age = ageForSeason(r.birthdate, seasonNumber);
    if (!isGraduateAge(age)) continue;
    if (dryRun) { graduates++; continue; }

    const { error } = await supabase.from("academy_graduation").insert({
      team_id: r.team_id, rider_id: r.id, season_id: seasonId, status: "pending", deadline,
    });
    if (error) throw new Error(`detectGraduates insert (${r.id}): ${error.message}`);

    await notify({
      supabase, teamId: r.team_id, type: "academy_graduation_ready", relatedId: r.id,
      title: "Academy graduation",
      message: `${r.firstname} ${r.lastname} has aged out of your academy. Promote, sell or release before the deadline.`,
      metadata: {
        titleCode: "notif.academyGraduationReady.title",
        messageCode: "notif.academyGraduationReady.message",
        titleParams: { name: `${r.firstname} ${r.lastname}` },
      },
    });
    graduates++;
  }
  return { dryRun, graduates };
}

/**
 * Udfør ét graduerings-udfald. action ∈ promote|sell|release.
 *
 * - promote: is_academy=false. #1309-kontrakt-invariant (#2881): kun en reelt
 *   kontraktløs rytter får en ny standard-kontrakt via contractOnAcquirePatch —
 *   en akademirytter der graduerer beholder næsten altid sin eksisterende
 *   kontrakt (arvet fra intake eller et tidligere akademi-ophold) UÆNDRET.
 *   Kræver ledig senior-plads (division-cap).
 * - sell:    opret senior-auktion (seller=hold, is_youth=false). Rytteren forbliver
 *   is_academy=true (uden for cap) indtil auktions-finalization afgør udfaldet.
 * - release: team_id=NULL, is_academy=false, salary/contract_length/
 *   contract_end_season=NULL (fri agent — #1309: kontrakter kun på ejede
 *   ryttere, ellers "arver" et senere erhvervelses-kald fejlagtigt akademi-
 *   kontrakten via contractOnAcquirePatch).
 *
 * @throws 'invalid_action' | 'not_pending' | 'rider_not_found' | 'squad_cap_violation'
 */
export async function resolveGraduation(supabase, {
  teamId, riderId, action, seasonNumber, now = new Date(),
  getMarketState = getTeamMarketState, auctionConfig, notify = notifyTeamOwner,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!VALID_ACTIONS.has(action)) throw new Error("invalid_action");

  // #2997-intentionen (fejl må ikke blive til sentinel-kast) bor i helperen:
  // findPendingGraduation kaster med ægte årsag ved læsefejl.
  const grad = await findPendingGraduation(supabase, { teamId, riderId });
  if (!grad) throw new Error("not_pending");

  const { data: rider, error: riderError } = await supabase.from("riders")
    .select("id, team_id, firstname, lastname, base_value, prize_earnings_bonus, current_production_value, market_value, salary, contract_length, contract_end_season")
    .eq("id", riderId).maybeSingle();
  if (riderError) throw new Error(`resolveGraduation rider lookup: ${riderError.message}`);
  if (!rider) throw new Error("rider_not_found");

  if (action === "promote") {
    const state = await getMarketState(supabase, teamId);
    const cap = state?.squad_limits?.max ?? 30;
    const future = state?.future_count ?? state?.rider_count ?? 0;
    if (future + 1 > cap) throw new Error("squad_cap_violation");

    // #2881/#1309: samme gate som academyTransfer.js promote() + al anden
    // erhvervelse — kun en rytter der reelt er kontraktløs (salary/end_season
    // == null, fx den sjældne healing-case) får en frisk standard-kontrakt.
    // En akademirytter der graduerer HAR næsten altid allerede en gyldig
    // kontrakt (fra intake eller et tidligere demote()-ophold) — den arves
    // UÆNDRET, regenerér ALDRIG (spec-beslutning 3 handlede om HVILKEN
    // løn-formel der bruges til en NY kontrakt, ikke om ubetinget overskrivning).
    const contractPatch = contractOnAcquirePatch(rider, seasonNumber);
    const { error } = await supabase.from("riders").update({
      is_academy: false,
      ...contractPatch,
    }).eq("id", riderId);
    if (error) throw new Error(`resolveGraduation promote update: ${error.message}`);
    await finishGraduation(supabase, { gradId: grad.id, status: "promoted", teamId, rider, now, action, notify });
    const salary = contractPatch.salary ?? rider.salary;
    return { riderId, action: "promoted", salary };
  }

  if (action === "sell") {
    const created = await createGraduateAuction(supabase, { teamId, rider, now, auctionConfig });
    // #4004: beregnede sluttid krydser sæson-transitionen — SPRING oprettelsen
    // over i dette kald i stedet for at oprette en auktion der ville sælge
    // rytteren på tal der flytter sig under salget. Grad-rækken forbliver
    // 'pending' (finishGraduation kaldes IKKE), så et senere kald (næste
    // sweep-run, eller manageren der prøver "sell" igen) opretter auktionen
    // naturligt, når sluttiden ikke længere krydser grænsen. Ingen
    // afvisnings-fejl, ingen kø — se createGraduateAuction.
    if (!created) return { riderId, action: "sell_deferred_season_boundary" };
    await finishGraduation(supabase, { gradId: grad.id, status: "sold", teamId, rider, now, action, notify });
    return { riderId, action: "sold" };
  }

  // release: fri agent — kontrakter kun på ejede ryttere (#1309), så salary/
  // contract_length/contract_end_season nulles her, samme mønster som
  // contractExpiryRelease.js/retirementRelease.js. Uden dette ville rytteren
  // stå som fri agent med en IKKE-null akademi-kontrakt, og et senere
  // contractOnAcquirePatch-kald (auktion/transfer) ville fejlagtigt "arve" den
  // stale kontrakt i stedet for at give en frisk (#2881-følgefund).
  const { error } = await supabase.from("riders")
    .update({
      team_id: null, is_academy: false,
      salary: null, contract_length: null, contract_end_season: null,
    }).eq("id", riderId);
  if (error) throw new Error(`resolveGraduation release update: ${error.message}`);
  // #1906 defense-in-depth: ryd rytterens fremtidige race_entries så de ikke hænger ved som ghost.
  await clearFutureRaceEntriesSafe({ supabase, riderId, label: "academy_release" });
  await finishGraduation(supabase, { gradId: grad.id, status: "released", teamId, rider, now, action, notify });
  return { riderId, action: "released" };
}

/**
 * Soft default: promover hvis ledig plads OG holdet ikke er i gæld → ellers sælg.
 * Manuel promovering (via ruten) har ingen gælds-guard — det er spillerens valg;
 * kun AUTO-defaulten er konservativ (lægger ikke løn-byrde på et hold i minus).
 * Usolgt salg → free agent håndteres i auktions-finalization.
 */
export async function defaultResolveGraduate(supabase, {
  teamId, riderId, seasonNumber, now = new Date(),
  getMarketState = getTeamMarketState, auctionConfig, notify = notifyTeamOwner,
} = {}) {
  const state = await getMarketState(supabase, teamId);
  const cap = state?.squad_limits?.max ?? 30;
  const future = state?.future_count ?? state?.rider_count ?? 0;
  const balance = Number(state?.balance ?? 0);
  const action = future + 1 <= cap && balance >= 0 ? "promote" : "sell";
  try {
    return await resolveGraduation(supabase, { teamId, riderId, action, seasonNumber, now, getMarketState, auctionConfig, notify });
  } catch (err) {
    if (action === "promote") {
      return await resolveGraduation(supabase, { teamId, riderId, action: "sell", seasonNumber, now, getMarketState, auctionConfig, notify });
    }
    throw err;
  }
}

/**
 * #4495 — UDGANGEN for en graduate-auktion der sluttede UDEN bud.
 *
 * Kontrakten har hele tiden staaet i createGraduateAuction's docblok: rytteren
 * forbliver `is_academy=true` (uden for cap) indtil auktions-finalization
 * saetter `is_academy=false` ved salg / **fri agent ved ingen bud**. Den anden
 * halvdel fandtes bare aldrig i koden: `graduatePatch` i auctionFinalization.js
 * saettes KUN paa vinder-stien, saa en auktion uden bud lukkede som 'completed'
 * uden at nogen roerte rytteren — han blev liggende hos saelgeren med
 * `is_academy=true`, mens grad-raekken allerede var stemplet 'sold'. Ingen sti
 * tilbage: hverken solgt, promoveret, sluppet eller fri agent (#4495, #4484).
 *
 * Udfaldet er det dokumenterede og foelger YOUTH_RULES §2.2's default-kaede
 * (promovér → saelg → slip): salget mislykkedes, saa rytteren SLIPPES. Samme
 * felter som resolveGraduation's release-gren, af samme #1309-grund (kontrakter
 * kun paa ejede ryttere — ellers "arver" et senere erhvervelses-kald
 * fejlagtigt akademi-kontrakten via contractOnAcquirePatch).
 *
 * IDEMPOTENT + GENKOERBAR: opdateringen er conditional (id + team_id +
 * is_academy=true), saa et gentaget kald — cron-retry, reparations-script der
 * koeres to gange, eller en rytter der imens er kommet videre ad en anden sti —
 * rammer 0 raekker og rapporterer `released:false` i stedet for at flytte en
 * rytter der ikke laengere er fanget.
 *
 * @param {object} supabase
 * @param {{teamId:string, riderId?:string, rider?:object, now?:Date, notify?:Function}} args
 * @returns {Promise<{released:boolean, riderId:string, reason?:string}>}
 */
export async function releaseUnsoldGraduate(supabase, {
  teamId, riderId, rider = null, now = new Date(), notify = notifyTeamOwner,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  const id = riderId ?? rider?.id;
  if (!teamId || !id) throw new Error("releaseUnsoldGraduate: teamId + riderId required");

  let target = rider;
  if (!target) {
    const { data, error } = await supabase.from("riders")
      .select("id, team_id, is_academy, firstname, lastname")
      .eq("id", id).maybeSingle();
    if (error) throw new Error(`releaseUnsoldGraduate rider lookup: ${error.message}`);
    target = data;
  }
  if (!target) return { released: false, riderId: id, reason: "rider_not_found" };
  if (target.is_academy !== true) return { released: false, riderId: id, reason: "not_academy" };
  if (target.team_id !== teamId) return { released: false, riderId: id, reason: "not_on_team" };

  const { data: updated, error } = await supabase.from("riders")
    .update({
      team_id: null, is_academy: false,
      salary: null, contract_length: null, contract_end_season: null,
    })
    .eq("id", id).eq("team_id", teamId).eq("is_academy", true)
    .select("id");
  if (error) throw new Error(`releaseUnsoldGraduate update: ${error.message}`);
  if ((updated ?? []).length === 0) return { released: false, riderId: id, reason: "already_resolved" };

  // #1906 defense-in-depth: samme oprydning som release-grenen — rytteren har
  // forladt holdet, saa hans fremtidige race_entries maa ikke haenge ved.
  await clearFutureRaceEntriesSafe({ supabase, riderId: id, label: "academy_unsold_graduate" });

  // Grad-raekken blev stemplet 'sold' i det oejeblik auktionen blev OPRETTET,
  // ikke da den blev afgjort (#4495 punkt 2). Salget skete aldrig, saa raekken
  // rettes til det der faktisk skete. Best-effort: en fejl her maa ikke rulle
  // en gennemfoert frigivelse tilbage — rytteren er allerede ude af akademiet.
  await restampSoldGraduationAsReleased(supabase, { teamId, riderId: id, now });

  await notify({
    supabase, teamId, type: "academy_graduated", relatedId: id,
    title: "Academy graduate released",
    message: `${target.firstname} ${target.lastname} drew no bids and left your academy as a free agent.`,
    metadata: {
      titleCode: "notif.academyGraduated.unsoldTitle",
      messageCode: "notif.academyGraduated.unsold",
      titleParams: { name: `${target.firstname} ${target.lastname}` },
    },
  });

  return { released: true, riderId: id };
}

// ─── interne helpers ──────────────────────────────────────────────────────────

// #4495: ret den 'sold'-stemplede grad-raekke til 'released' naar salget aldrig
// blev til noget. Nyeste raekke foerst — en rytter kan have grad-raekker i flere
// saesoner (UNIQUE(rider_id, season_id), #4484), og det er den seneste der
// hoerer til den netop afsluttede auktion. Best-effort som
// resolvePendingGraduationOnSale: log og fortsaet.
async function restampSoldGraduationAsReleased(supabase, { teamId, riderId, now }) {
  try {
    const { data, error } = await supabase.from("academy_graduation")
      .select("id")
      .eq("team_id", teamId).eq("rider_id", riderId).eq("status", "sold")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return;
    const { error: updErr } = await supabase.from("academy_graduation")
      .update({ status: "released", resolved_at: now.toISOString() })
      .eq("id", data.id);
    if (updErr) throw new Error(updErr.message);
  } catch (err) {
    // best-effort: restemplingen er en BOGFOERINGS-rettelse, ikke selve
    // udgangen. Rytteren er paa dette tidspunkt allerede frigivet (conditional
    // update bekraeftet), saa en fejl her maa ALDRIG kaste og rulle den
    // frigivelse tilbage — den logges for synlighed og fanges naeste gang af
    // ownershipInvariantWatch invariant G. Samme moenster som
    // resolvePendingGraduationOnSale nedenfor.
    console.error(`restampSoldGraduationAsReleased failed (${riderId}):`, err.message);
  }
}


async function finishGraduation(supabase, { gradId, status, teamId, rider, now, action, notify = notifyTeamOwner }) {
  const { error } = await supabase.from("academy_graduation")
    .update({ status, resolved_at: now.toISOString() }).eq("id", gradId);
  if (error) throw new Error(`finishGraduation update: ${error.message}`);
  const verb = action === "promote" ? "promoted to your senior squad"
    : action === "sell" ? "listed for transfer" : "released";
  await notify({
    supabase, teamId, type: "academy_graduated", relatedId: rider.id,
    title: "Academy graduate resolved",
    message: `${rider.firstname} ${rider.lastname} was ${verb}.`,
    metadata: {
      titleCode: "notif.academyGraduated.title",
      messageCode: `notif.academyGraduated.${action}`,
      titleParams: { name: `${rider.firstname} ${rider.lastname}` },
    },
  });
}

// Opret en senior-salgs-auktion for en graduate (spejler youthMarket.js, men med
// seller_team_id=holdet + is_youth=false). Rytteren forbliver is_academy=true til
// auktions-finalization (Task 6) sætter is_academy=false ved salg / free agent ved ingen bud.
// #4495: "free agent ved ingen bud" fandtes IKKE i koden før 5/9 — kun vinder-stien
// flippede flaget, så en usolgt graduate blev fanget i akademiet for evigt.
// Udgangen er nu releaseUnsoldGraduate ovenfor, kaldt fra auctionFinalization.js's
// no-bid-gren; vagten mod klassen er ownershipInvariantWatch invariant G.
//
// #4004: hvis den beregnede sluttid ville krydse sæson-transitionen, springes
// oprettelsen over (returnerer false, ingen insert, ingen fejl) i stedet for at
// sælge rytteren på tal der flytter sig under selve salget. Dette er en af de to
// "automatiserede FA-stier" PR-body'en dokumenterer som scope-afgrænset fra
// api.js's POST /auctions-guard (findes intet menneske at returnere en 400 til
// her — se resolveGraduation's kalder for hvordan "sælg igen senere" håndteres).
async function createGraduateAuction(supabase, { teamId, rider, now = new Date(), auctionConfig }) {
  const value = Math.max(1, calculateRiderMarketValue(rider));
  const cfg = auctionConfig || await resolveAuctionConfig(supabase);
  // #4004: free-agent-auktion (graduate sælges via "banken") — 12t-gulv, se
  // FREE_AGENT_MIN_DURATION_HOURS (auctionEngine.js).
  const calculatedEnd = calculateAuctionEnd(now, cfg, { minHours: FREE_AGENT_MIN_DURATION_HOURS });

  const seasonTransitionBoundary = await fetchSeasonTransitionBoundary(supabase);
  if (getAuctionSeasonBoundaryIssue(calculatedEnd, seasonTransitionBoundary)) {
    console.log(`createGraduateAuction: skipped rider ${rider.id} — calculated end ${calculatedEnd.toISOString()} crosses season transition boundary ${seasonTransitionBoundary.toISOString()}`);
    return false;
  }

  const { error } = await supabase.from("auctions").insert({
    rider_id: rider.id,
    seller_team_id: teamId,
    starting_price: value,
    current_price: value,
    current_bidder_id: null,
    min_increment: 1,
    calculated_end: calculatedEnd.toISOString(),
    is_youth: false,
  });
  if (error) throw new Error(`createGraduateAuction: ${error.message}`);
  return true;
}

async function resolveAuctionConfig(supabase) {
  // #2997: DEFAULT_AUCTION_CONFIG-fallbacken er designet til at dække en
  // MANGLENDE config-række (auctionEngine.js), ikke en fejlet læsning. Uden
  // `error` bundet blev de to tilfælde ens, og en graduate-auktion kunne få en
  // helt anden varighed end den konfigurerede — en kontrakt manageren ikke kan
  // rulle tilbage bagefter. PGRST116 = ingen række → behold fallbacken; alt
  // andet kaster, og da kaldet ligger FØR insert'et fejler vi lukket.
  const { data, error } = await supabase.from("auction_timing_config").select("*").eq("id", 1).single();
  if (error && error.code !== "PGRST116") {
    throw new Error(`resolveAuctionConfig: could not read auction_timing_config: ${error.message}`);
  }
  return data || DEFAULT_AUCTION_CONFIG;
}

/**
 * #2793 (bølge 3-følgefund): resolver en evt. PENDING academy_graduation-row
 * når en akademi-rytter forlader akademiet via et DIREKTE salg (auktion eller
 * transfermarked, #3845 åbnede begge veje for akademi-ryttere UDEN om det
 * almindelige graduerings-vindue). Kaldes fra auctionFinalization.js og
 * transferExecution.js's graduatePatch-sti, samme mønster som
 * academyTransfer.js's promote() allerede bruger for manuel promote.
 *
 * Uden dette ville en rytter der turnerede 22 (fik en pending grad-row,
 * status='pending', is_academy stadig true i override-vinduet) og DEREFTER
 * blev solgt direkte via #3845 efterlade rækken hængende som 'pending' —
 * academyGraduationSweep ville senere finde den efter deadline og forsøge at
 * auto-resolve (promote/sell) en rytter der allerede har skiftet ejer/status,
 * inkl. risikoen for at oprette en PHANTOM sælg-auktion (createGraduateAuction)
 * for en rytter sælgerens hold ikke længere ejer.
 *
 * Best-effort: en fejl her må ALDRIG vælte selve salget — pengene er allerede
 * flyttet og rytteren allerede overdraget på dette tidspunkt. Log og fortsæt.
 */
export async function resolvePendingGraduationOnSale(supabase, { teamId, riderId, now = new Date() } = {}) {
  if (!supabase?.from || !teamId || !riderId) return;
  try {
    // best-effort: en fejlet SELECT her er samme klasse fejl som resten af
    // funktionen (se docblok) — sluges bevidst af den ydre catch, aldrig kastet.
    const grad = await findPendingGraduation(supabase, { teamId, riderId });
    if (!grad) return;
    const { error } = await supabase.from("academy_graduation")
      .update({ status: "sold", resolved_at: now.toISOString() })
      .eq("id", grad.id);
    if (error) throw new Error(error.message);
  } catch (err) {
    // best-effort: se docblok — en fejl her må ALDRIG vælte det allerede
    // gennemførte salg, kun logges for synlighed.
    console.error(`resolvePendingGraduationOnSale failed (${riderId}):`, err.message);
  }
}
