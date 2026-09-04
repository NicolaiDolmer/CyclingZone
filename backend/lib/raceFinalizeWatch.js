// #4147 — vagt for halvt afsluttede løb. READ-ONLY: den reparerer intet, den råber op.
//
// HVORFOR EN VAGT NÅR AFSLUTNINGEN ER GENOPTAGELIG: fordi genoptagelsen kan fejle, og
// fordi et løb kan være crashet mens flaget var slukket. 23/8 stod Gran Premio de
// Llanera division 9 med skrevne resultater, beregnede præmier og status='scheduled' —
// det blev ikke opdaget af nogen automatik, men ved en manuel gennemgang timer senere.
// Vagten er dét manuelle gennemsyn, hvert 15. minut.
//
// TRE FUND (alle tre er tilstande der ALDRIG er gyldige efter få minutter):
//
//   1. stuck_marker — races.finalize_state står stille i over 10 minutter. Afslutningen
//      begyndte og stoppede midtvejs. Kun når INTET levende stage-claim dækker etapen:
//      et claim yngre end STAGE_CLAIM_LEASE_MS betyder at en kørsel enten er i gang
//      eller er ved at blive overtaget af næste scheduler-tick — dét er systemet der
//      virker, ikke en hændelse.
//
//   2. results_without_status — alle etaper er kørt (stages_completed >= stages), men
//      status blev aldrig 'completed'. Præcis Llanera-tilstanden. Scheduleren har en
//      recovery-sti der tager denne på 5 minutter, så over 10 minutter betyder at
//      recoveryen SELV fejler — og så er tavshed det farligste vi kan levere.
//
//   3. completed_without_prize — løbet er færdigt, har præmie-berettigede rækker, men
//      prize_paid_at er stadig NULL længe efter. Kun relevant når auto-prize-sweepen er
//      tændt: er den slukket, er manuel udbetaling det tilsigtede, og et fund ville være
//      ren støj.
//
// IKKE DÆKKET (bevidst): "etape med race_results men uden race_simulation_runs" —
// enrichment-trinnet der aldrig kørte. Prod-målingen 4/9 fandt 34 sådanne etaper (S1:
// 29, S2: 4, S3: 1), men det kræver en aggregering pr. (løb, etape) over hele
// race_results, og de historiske fund er allerede kendte og ikke længere actionable.
// Trin-markeringen (raceFinalizeState.js) forhindrer at klassen opstår igen; sker det
// alligevel, fanges det som stuck_marker inden for 10 minutter.
//
// ALARMVEJ: Sentry med FAST fingerprint (["race-finalize-half-state"]) så alle fund
// samles i ÉT issue, plus opsAlertDedupe (edge-trigget + gulv) så en tilstand der ikke
// kan rette sig selv ikke fyrer 96 events i døgnet. Signaturen er sorterede
// "<type>:<race_id>"-par: kommer et nyt løb til, eller retter et sig, ændrer signaturen
// sig og vi alarmerer straks.

import { captureException as defaultCaptureException } from "./sentry.js";
import { buildAlertSignature, shouldAlertOnChange } from "./opsAlertDedupe.js";
import { loadSingleActiveSeason } from "./activeSeasonLookup.js";
import { isAutoPrizeEnabled as defaultIsAutoPrizeEnabled } from "./autoPrizeFlag.js";
import { STAGE_CLAIM_LEASE_MS } from "./adminSimulateRace.js";

export const RACE_FINALIZE_ALERT_KEY = "race-finalize-half-state";

/**
 * Hvor længe en halv tilstand må stå før den er en hændelse. 10 minutter er valgt
 * fordi scheduleren tikker hvert 5. minut: to hele ticks skal have haft chancen for
 * at rydde op, før vi kalder det et problem.
 */
export const HALF_FINALIZED_ALERT_AFTER_MS = 10 * 60 * 1000;

/**
 * Præmier har et længere gulv: auto-prize-sweepen tikker også hvert 5. minut, men
 * dens arbejde afhænger af rytterværdi-genberegning og kan lovligt tage flere ticks.
 * En time = 12 sweeps uden resultat, hvilket ikke længere kan forklares med travlhed.
 */
export const PRIZE_UNPAID_ALERT_AFTER_MS = 60 * 60 * 1000;

/** Re-alarmér én gang i døgnet så en uafklaret tilstand ikke forsvinder helt. */
export const RE_ALERT_AFTER_MS = 24 * 60 * 60 * 1000;

/** Loft på hvor mange løb vi slår detaljer op for — vagten må aldrig blive dyr. */
export const MAX_CANDIDATES = 25;

/**
 * PUR: hvilke løb med en markering har stået stille for længe, uden at et levende
 * stage-claim dækker dem?
 *
 * @param {Array<object>} races - rækker med { id, name, finalize_state, finalize_updated_at }
 * @param {Array<object>} claims - rækker fra race_stage_claims { race_id, stage_index, claimed_at }
 */
export function selectStuckMarkers(races = [], claims = [], { now = new Date(), thresholdMs = HALF_FINALIZED_ALERT_AFTER_MS, leaseMs = STAGE_CLAIM_LEASE_MS } = {}) {
  const nowMs = now.getTime();
  const liveClaims = new Set();
  for (const c of claims) {
    const at = Date.parse(c?.claimed_at);
    if (Number.isFinite(at) && nowMs - at < leaseMs) liveClaims.add(`${c.race_id}:${c.stage_index}`);
  }
  const out = [];
  for (const r of races) {
    if (!r?.finalize_state) continue;
    const updatedAt = Date.parse(r.finalize_updated_at);
    if (!Number.isFinite(updatedAt)) continue; // markering uden tidsstempel → kan ikke aldersvurderes
    const ageMs = nowMs - updatedAt;
    if (ageMs < thresholdMs) continue;
    const stageIndex = Number(r.finalize_state?.stage_index);
    if (Number.isFinite(stageIndex) && liveClaims.has(`${r.id}:${stageIndex}`)) continue; // en kørsel har den
    out.push({
      type: "stuck_marker",
      race_id: r.id,
      race_name: r.name ?? null,
      stage_number: r.finalize_state?.stage_number ?? null,
      done: Array.isArray(r.finalize_state?.done) ? r.finalize_state.done : [],
      stalled_minutes: Math.round(ageMs / 60000),
    });
  }
  return out;
}

/**
 * PUR: hvilke løb har kørt alle etaper uden at få status='completed'?
 * `lastStageAtByRace` er max(race_stage_schedule.scheduled_at) pr. løb — vores bedste
 * bud på "hvornår burde løbet være færdigt". Mangler tidspunktet (løb uden schedule),
 * medtages løbet: en manglende tidsangivelse må ikke kunne skjule en halv tilstand.
 */
export function selectResultsWithoutStatus(races = [], lastStageAtByRace = new Map(), { now = new Date(), thresholdMs = HALF_FINALIZED_ALERT_AFTER_MS } = {}) {
  const nowMs = now.getTime();
  const out = [];
  for (const r of races) {
    if (r?.status === "completed") continue;
    const stages = Number(r?.stages) || 1;
    const done = Number(r?.stages_completed) || 0;
    if (done < stages) continue; // løbet er stadig i gang — helt normalt
    const lastAt = Date.parse(lastStageAtByRace.get(r.id));
    if (Number.isFinite(lastAt) && nowMs - lastAt < thresholdMs) continue;
    out.push({
      type: "results_without_status",
      race_id: r.id,
      race_name: r.name ?? null,
      status: r.status ?? null,
      stages,
      stages_completed: done,
    });
  }
  return out;
}

/**
 * PUR: hvilke færdige løb mangler stadig deres præmieudbetaling?
 * `payableRowsByRace` tælles kun for kandidaterne (se runHalfFinalizedRaceWatch) —
 * et løb uden præmie-berettigede rækker udbetaler intet og er ikke et fund.
 */
export function selectCompletedWithoutPrize(races = [], lastStageAtByRace = new Map(), payableRowsByRace = new Map(), { now = new Date(), thresholdMs = PRIZE_UNPAID_ALERT_AFTER_MS } = {}) {
  const nowMs = now.getTime();
  const out = [];
  for (const r of races) {
    if (r?.status !== "completed") continue;
    if (r?.prize_paid_at) continue;
    if ((payableRowsByRace.get(r.id) ?? 0) <= 0) continue;
    const lastAt = Date.parse(lastStageAtByRace.get(r.id));
    if (Number.isFinite(lastAt) && nowMs - lastAt < thresholdMs) continue;
    out.push({
      type: "completed_without_prize",
      race_id: r.id,
      race_name: r.name ?? null,
      payable_rows: payableRowsByRace.get(r.id) ?? 0,
    });
  }
  return out;
}

/** PUR: én læsbar linje pr. fund, til Railway-logstrømmen. */
export function formatFindings(findings = []) {
  return findings.map((f) => {
    if (f.type === "stuck_marker") {
      return `[race-finalize-watch] løb ${f.race_id} (${f.race_name ?? "?"}) · etape ${f.stage_number ?? "?"} · afslutningen har stået stille i ${f.stalled_minutes} min · færdige trin: ${f.done.join(",") || "ingen"}`;
    }
    if (f.type === "results_without_status") {
      return `[race-finalize-watch] løb ${f.race_id} (${f.race_name ?? "?"}) · alle ${f.stages} etaper kørt, men status er stadig '${f.status}'`;
    }
    return `[race-finalize-watch] løb ${f.race_id} (${f.race_name ?? "?"}) · completed, men prize_paid_at er NULL trods ${f.payable_rows} præmie-berettigede rækker`;
  });
}

/**
 * I/O: kør vagten. Rører ingen løbsdata — eneste skrivning er dedupe-rækken i
 * ops_alert_state, præcis som de øvrige vagter.
 */
export async function runHalfFinalizedRaceWatch({
  supabase,
  now = new Date(),
  captureExceptionFn = defaultCaptureException,
  isAutoPrizeEnabled = defaultIsAutoPrizeEnabled,
  logger = console,
} = {}) {
  const empty = { findings: 0, alerted: false, byType: {} };

  // Fund 1 er globalt: en markering er per definition en igangværende afslutning, og
  // den kan sidde på et løb i en hvilken som helst sæson. Partial index på
  // (finalize_updated_at) WHERE finalize_state IS NOT NULL gør opslaget nærmest gratis.
  // schema-columns-ok: finalize_state/finalize_updated_at tilfoejes af
  // database/2026-09-04-4147-race-finalize-state.sql, som CI applier ved merge.
  // Snapshottet refreshes af ejer/orkestrator post-merge (#3586-kontrakten).
  const { data: markerRows, error: markerErr } = await supabase
    .from("races")
    .select("id, name, season_id, status, stages, stages_completed, finalize_state, finalize_updated_at")
    .not("finalize_state", "is", null)
    .limit(MAX_CANDIDATES);
  if (markerErr) {
    // Kolonnen findes måske endnu ikke (migrationen ikke kørt) — det er ikke en
    // hændelse værd at capture hver 15. minut, men vagten skal heller ikke tie helt:
    // vi fortsætter til fund 2/3, som ikke afhænger af markeringen.
    logger.warn?.(`[race-finalize-watch] finalize_state-opslag fejlede (fortsaetter uden fund 1): ${markerErr.message}`);
  }

  let stuck = [];
  if (markerRows?.length) {
    const { data: claims, error: claimsErr } = await supabase
      .from("race_stage_claims")
      .select("race_id, stage_index, claimed_at")
      .in("race_id", markerRows.map((r) => r.id));
    if (claimsErr) {
      // Fail-mod-for-meget: uden claim-data kan vi ikke vide om en genoptagelse er
      // paa vej, og vi undertrykker derfor INTET. En overfloedig alarm er billigere
      // end et fastlaast loeb ingen hoerer om (samme retning som opsAlertDedupe).
      logger.warn?.(`[race-finalize-watch] race_stage_claims-opslag fejlede - ingen undertrykkelse: ${claimsErr.message}`);
    }
    stuck = selectStuckMarkers(markerRows, claimsErr ? [] : (claims ?? []), { now });
  }

  // Fund 2 og 3 er afgrænset til den AKTIVE sæson: historiske sæsoner er lukkede
  // kapitler, og en alarm om et løb fra sæson 1 er ikke handlingsanvisende.
  const season = await loadSingleActiveSeason(supabase, { tag: "race-finalize-watch", captureExceptionFn });
  let resultsWithoutStatus = [];
  let completedWithoutPrize = [];
  if (season?.id) {
    const { data: races, error: racesErr } = await supabase
      .from("races")
      .select("id, name, status, stages, stages_completed, prize_paid_at")
      .eq("season_id", season.id);
    if (racesErr) {
      captureExceptionFn(new Error(`race-finalize-watch: races-opslag fejlede: ${racesErr.message}`), {
        tags: { cron: "race-finalize-watch" },
      });
      return empty;
    }

    const candidates = (races ?? []).filter(
      (r) =>
        (r.status !== "completed" && (Number(r.stages_completed) || 0) >= (Number(r.stages) || 1)) ||
        (r.status === "completed" && !r.prize_paid_at),
    );

    if (candidates.length) {
      const capped = candidates.slice(0, MAX_CANDIDATES);
      const ids = capped.map((r) => r.id);
      // #3331: `capped` er hard-capped til MAX_CANDIDATES løb, og et løb har maks 21
      // etaper (verificeret rækketal i GAME_INVARIANTS) → svaret kan ikke nå PostgRESTs
      // tavse 1000-rækkers-loft. Det eksplicitte .limit() gør bundetheden synlig frem
      // for at hvile på et argument, og følger med hvis MAX_CANDIDATES hæves.
      const { data: sched, error: schedErr } = await supabase
        .from("race_stage_schedule")
        .select("race_id, scheduled_at")
        .in("race_id", ids)
        .limit(MAX_CANDIDATES * 25);
      if (schedErr) {
        // Samme retning: uden sluttidspunkter falder alderskravet vaek, og alle
        // kandidater medtages. Fundene bliver stoejende, ikke tavse.
        logger.warn?.(`[race-finalize-watch] race_stage_schedule-opslag fejlede - alderskrav udelades: ${schedErr.message}`);
      }
      const lastStageAtByRace = new Map();
      for (const row of sched ?? []) {
        const prev = lastStageAtByRace.get(row.race_id);
        if (!prev || Date.parse(row.scheduled_at) > Date.parse(prev)) lastStageAtByRace.set(row.race_id, row.scheduled_at);
      }

      resultsWithoutStatus = selectResultsWithoutStatus(capped, lastStageAtByRace, { now });

      // Præmie-fundet kræver at auto-udbetalingen overhovedet er slået til: er den
      // slukket, ER manuel udbetaling det tilsigtede og et fund ville være ren støj.
      if (await isAutoPrizeEnabled(supabase)) {
        const prizeCandidates = capped.filter((r) => r.status === "completed" && !r.prize_paid_at);
        const payableRowsByRace = new Map();
        for (const r of prizeCandidates) {
          const { count } = await supabase
            .from("race_results")
            .select("id", { count: "exact", head: true })
            .eq("race_id", r.id)
            .gt("prize_money", 0)
            .not("team_id", "is", null);
          payableRowsByRace.set(r.id, count ?? 0);
        }
        completedWithoutPrize = selectCompletedWithoutPrize(prizeCandidates, lastStageAtByRace, payableRowsByRace, { now });
      }
    }
  }

  const findings = [...stuck, ...resultsWithoutStatus, ...completedWithoutPrize];
  const byType = {
    stuck_marker: stuck.length,
    results_without_status: resultsWithoutStatus.length,
    completed_without_prize: completedWithoutPrize.length,
  };
  if (!findings.length) {
    // Tomt fund SKAL stadig gennem dedupen: den nulstiller signaturen, så næste gang
    // det samme løb dukker op, ser den som en ÆNDRING og alarmerer med det samme.
    await shouldAlertOnChange({ supabase, alertKey: RACE_FINALIZE_ALERT_KEY, signature: "", now, captureExceptionFn });
    return empty;
  }

  const signature = buildAlertSignature(findings.map((f) => `${f.type}:${f.race_id}`));
  const { alert } = await shouldAlertOnChange({
    supabase,
    alertKey: RACE_FINALIZE_ALERT_KEY,
    signature,
    now,
    reAlertAfterMs: RE_ALERT_AFTER_MS,
    captureExceptionFn,
  });

  if (alert) {
    for (const line of formatFindings(findings)) logger.error?.(line);
    captureExceptionFn(
      new Error(`Halvt afsluttede loeb: ${findings.length} fund (${byType.stuck_marker} fastlaast markering, ${byType.results_without_status} uden status-flip, ${byType.completed_without_prize} uden praemieudbetaling)`),
      {
        tags: { cron: "race-finalize-watch", flow: "race-run" },
        // Fast fingerprint: ALLE fund samles i ÉT Sentry-issue. Uden det ville hver
        // ny løbs-id blive sit eget issue og triagen drukne i dubletter.
        fingerprint: [RACE_FINALIZE_ALERT_KEY],
        extra: { findings: findings.slice(0, 20), byType },
      },
    );
  }

  return { findings: findings.length, alerted: alert, byType };
}

export default runHalfFinalizedRaceWatch;
