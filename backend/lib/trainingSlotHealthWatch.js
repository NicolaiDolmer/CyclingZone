// Trænings-slot-vagt (#3639) — I/O-adapter + cron-entrypoint.
//
// Dagligt job: tæller hvor mange spiller-ejede ryttere der står i et
// træningsfokus uden hovedrum, persisterer én række pr. fokus i
// training_slot_health_daily, og alarmerer ops-webhooken når andelen bryder
// loftet eller springer på ét døgn.
//
// Hvorfor den findes: fejlen i #3639 var ikke at loftet fandtes — det er design.
// Fejlen var at INGEN målte hvor mange spillere der brændte en træningsdag på et
// fokus der ikke kunne rykke sig, så det tog uger og tre spillerrapporter at
// opdage. UI-rettelsen fortæller den enkelte spiller sandheden; denne vagt
// fortæller OS det, før spillerne når at opdage det næste gang et loft flytter sig.
//
// READ-ONLY mod spil-data: kun SELECT på riders/teams/training_plans/seasons/
// rider_derived_abilities (+ app_config-flaget og, på løbsdags-ticket,
// training_day_runs til G9-kadencen, #4848). Eneste skrivning er upsert til vagtens
// egne tabeller (training_slot_health_daily + ops_alert_state).
//
// Ren beregning ligger i trainingSlotHealth.js (unit-testet uden supabase-mock) —
// samme split som balanceDriftWatch.js/balanceDriftMetrics.js.

import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import {
  computeTrainingSlotHealth,
  evaluateSlotHealthAlert,
  typicalRaceDayTicksPerTeam,
  calendarDayEquivalents,
  TOTAL_FOCUS_KEY,
} from "./trainingSlotHealth.js";
import { withOpsMention } from "./opsWebhook.js";
import { isTrainingTickPerRaceDayEnabled } from "./trainingTickRaceDayFlag.js";
import { TRAINING_RACE_DAY_CONFIG, resolveRaceDayBudgetDivisor } from "./trainingRaceDayTick.js";

const ALERT_KEY = "training-slot-health"; // nøgle i ops_alert_state (edge-triggered dedup)

/**
 * #4848 (gate G9): kalenderdags-ækvivalenter træning mellem forrige snapshot og nu.
 *
 * Flag off ⇒ { trainingDays: 1 } UDEN et eneste opslag ud over flaget: kalenderdags-
 * ticket er det spring-loftet er kalibreret mod, så gaten er bit-identisk.
 *
 * Flag on ⇒ tæl løbsdags-ticks (training_day_runs med game_day) oprettet i
 * intervallet, tag medianen pr. hold, og omregn via budget-deleren (G1) til
 * kalenderdags-ækvivalenter. Samme `engineWrite`-læsning som sweepene: vagten skal
 * måle præcis den nøgle motoren faktisk skriver på.
 *
 * FEJL ⇒ { reliable: false }. Uden et pålideligt tick-tal kan spring-gaten ikke
 * evalueres ærligt (et rå spring over fem løbsdage er netop G9's falske alarm), så
 * kalderen dropper den for dette snapshot — andels-gaten kører uændret.
 *
 * @param {{supabase:object, since:string|null, now:Date, seasonNumber?:number|null}} args
 * @returns {Promise<{reliable:boolean, trainingDays?:number, raceDayTicks?:number, error?:string}>}
 */
export async function resolveTrainingDaysSincePrevious({ supabase, since, now, seasonNumber = null }) {
  const raceDayTickOn = await isTrainingTickPerRaceDayEnabled(supabase, { engineWrite: true });
  if (!raceDayTickOn) return { reliable: true, trainingDays: 1 };
  if (!since) return { reliable: false, error: "previous snapshot has no generated_at" };
  try {
    // PAGINERET (#3331-klassen): et døgn på løbsdags-ticket er hold × løbsdage
    // rækker, over PostgREST's 1.000-cap. `.order("id")` = stabil unik sortering.
    const rows = await fetchAllRows(() =>
      supabase
        .from("training_day_runs")
        // schema-columns-ok: game_day/season_id tilfoejes af database/2026-09-14-4846-training-tick-game-day.sql
        .select("id, team_id, season_id, game_day")
        .gt("created_at", since)
        .lte("created_at", now.toISOString())
        .not("game_day", "is", null)
        .order("id")
    );
    const raceDayTicks = typicalRaceDayTicksPerTeam(rows);
    const divisor = await resolveRaceDayBudgetDivisor({ seasonNumber });
    const trainingDays = calendarDayEquivalents({
      raceDayTicks,
      raceDayBudgetDivisor: divisor,
      legacyDaysPerSeason: TRAINING_RACE_DAY_CONFIG.legacyDaysPerSeason,
    });
    if (trainingDays == null) return { reliable: false, error: "invalid race-day divisor" };
    return { reliable: true, trainingDays, raceDayTicks };
  } catch (err) {
    return { reliable: false, error: err?.message ?? String(err) };
  }
}

// Hent alt vagten skal bruge for ÉN dag. Ingen klassifikation her.
// Returnerer computeTrainingSlotHealth()-inputtet.
export async function fetchSlotHealthInputs(supabase) {
  // Kun MENNESKE-ejede hold: AI-holdenes træning er motorens eget anliggende, og
  // et dødt AI-slot koster ingen spiller noget.
  const teams = await fetchAllRows(() => supabase.from("teams").select("id").eq("is_ai", false).order("id"));
  const teamIds = teams.map((t) => t.id);
  if (teamIds.length === 0) return { riders: [], planByRiderId: {}, abilityRows: [] };

  // #3030: .in()-lister chunkes — ~200 hold-ids og ~4.000 rytter-ids sprænger
  // ellers PostgREST-request-linjen (~430 UUID'er) og fejler UDEN statuskode.
  const riders = await fetchAllRowsChunkedIn(teamIds, (chunk) =>
    supabase
      .from("riders")
      .select("id, primary_type")
      .in("team_id", chunk)
      .eq("is_retired", false)
      .order("id")
  );
  const riderIds = riders.map((r) => r.id);
  if (riderIds.length === 0) return { riders: [], planByRiderId: {}, abilityRows: [] };

  // KUN den aktive sæsons planer — præcis samme afgrænsning som
  // deriveTrainingState/loadTrainingState bruger til fladen. En plan fra en
  // afsluttet sæson styrer ingenting og må ikke tælles som et slot.
  // Fejler dette opslag, ville planByRiderId stå tom, og HVER rytter ville falde
  // tilbage til smartDefaultFocus — vagten ville så måle en helt anden population
  // og persistere tallet som om det var sandt. Kast hellere: en manglende dag i
  // trenden er ærlig, en forkert dag er ikke.
  const { data: season, error: seasonErr } = await supabase
    .from("seasons")
    .select("id, number")
    .eq("status", "active")
    .maybeSingle();
  if (seasonErr) throw new Error(`active season lookup failed: ${seasonErr.message}`);
  const planByRiderId = {};
  if (season?.id) {
    const plans = await fetchAllRowsChunkedIn(riderIds, (chunk) =>
      supabase
        .from("training_plans")
        .select("rider_id, focus")
        .eq("season_id", season.id)
        .in("rider_id", chunk)
        .order("rider_id")
    );
    for (const p of plans) if (p.focus) planByRiderId[p.rider_id] = p.focus;
  }

  const abilityRows = await fetchAllRowsChunkedIn(riderIds, (chunk) =>
    supabase.from("rider_derived_abilities").select("*").in("rider_id", chunk).order("rider_id")
  );

  // seasonNumber følger med til G9-omregningen (#4848); computeTrainingSlotHealth
  // ignorerer feltet.
  return { riders, planByRiderId, abilityRows, seasonNumber: season?.number ?? null };
}

export async function runTrainingSlotHealthWatch({
  supabase,
  now = new Date(),
  sendWebhookFn,
  getOpsWebhookFn,
  captureExceptionFn,
} = {}) {
  // Dagens dato (UTC) — vagten måler en TILSTAND, ikke en afsluttet dags
  // hændelser, så den skal se bestanden som den er lige nu.
  const snapshotDate = now.toISOString().slice(0, 10);

  const inputs = await fetchSlotHealthInputs(supabase);
  const { rows, totals } = computeTrainingSlotHealth(inputs);

  // Forrige snapshot FØR upsert — ellers ville en genkørsel samme dag læse sin
  // egen række som "i går" og springet ville altid være nul.
  const { data: priorRows, error: priorErr } = await supabase
    .from("training_slot_health_daily")
    .select("snapshot_date, riders_in_training, dead_slots, partial_slots, generated_at")
    .eq("focus", TOTAL_FOCUS_KEY)
    .lt("snapshot_date", snapshotDate)
    .order("snapshot_date", { ascending: false })
    .limit(1);
  if (priorErr) {
    captureExceptionFn?.(new Error(`training_slot_health_daily fetch: ${priorErr.message}`), {
      tags: { cron: "training-slot-health-watch" },
    });
  }
  const previous = priorRows?.[0]
    ? {
        ridersInTraining: priorRows[0].riders_in_training,
        deadSlots: priorRows[0].dead_slots,
        partialSlots: priorRows[0].partial_slots,
      }
    : null;

  const generatedAt = now.toISOString();
  const payload = [...rows, { focus: TOTAL_FOCUS_KEY, ...totals }].map((r) => ({
    snapshot_date: snapshotDate,
    focus: r.focus,
    riders_in_training: r.ridersInTraining,
    dead_slots: r.deadSlots,
    partial_slots: r.partialSlots,
    generated_at: generatedAt,
  }));
  const { error: upsertErr } = await supabase
    .from("training_slot_health_daily")
    .upsert(payload, { onConflict: "snapshot_date,focus" });
  if (upsertErr) {
    captureExceptionFn?.(new Error(`training_slot_health_daily upsert: ${upsertErr.message}`), {
      tags: { cron: "training-slot-health-watch" },
      extra: { snapshotDate },
    });
  }

  // #4848 (G9): hvor meget træning ligger der mellem forrige snapshot og nu? Kun
  // relevant når der ER en pålidelig forrige række (ellers evalueres springet ikke).
  let jumpPrevious = priorErr ? null : previous;
  let trainingDays = 1;
  if (jumpPrevious) {
    const cadence = await resolveTrainingDaysSincePrevious({
      supabase,
      since: priorRows[0].generated_at ?? null,
      now,
      seasonNumber: inputs.seasonNumber ?? null,
    });
    if (cadence.reliable) {
      trainingDays = cadence.trainingDays;
    } else {
      jumpPrevious = null;
      captureExceptionFn?.(new Error(`training-slot-health cadence (race-day tick): ${cadence.error}`), {
        tags: { cron: "training-slot-health-watch" },
        extra: { snapshotDate },
      });
    }
  }

  // Uden en pålidelig forrige række kan spring-gaten ikke evalueres; andels-gaten
  // kan. evaluateSlotHealthAlert håndterer previous=null selv.
  const { shouldAlert, reasons, deadShare } = evaluateSlotHealthAlert(
    totals, jumpPrevious, undefined, { trainingDays }
  );

  // Edge-triggered dedup (#2730-mønsteret): alarmér kun når ÅRSAGS-sættet ændrer
  // sig, så en deploy-genstart ikke re-spammer en uændret vedvarende tilstand.
  const signature = shouldAlert ? reasons.join(" | ") : "";
  const { data: stateRow, error: stateErr } = await supabase
    .from("ops_alert_state")
    .select("signature")
    .eq("alert_key", ALERT_KEY)
    .maybeSingle();
  if (stateErr) {
    captureExceptionFn?.(new Error(`ops_alert_state read (training-slot-health): ${stateErr.message}`), {
      tags: { cron: "training-slot-health-watch" },
    });
    return { date: snapshotDate, totals, rows, alerted: false, trainingDays };
  }
  const changed = (stateRow?.signature ?? "") !== signature;

  if (shouldAlert && changed) {
    const url = getOpsWebhookFn ? await getOpsWebhookFn() : null;
    if (url && sendWebhookFn) {
      await sendWebhookFn(
        url,
        withOpsMention({
          embeds: [
            {
              title: "⚠️ Trænings-slot-vagt: fokus uden hovedrum stiger",
              description:
                `Spillere brænder træningsdage på fokus der ikke kan rykke sig (${snapshotDate}). ` +
                "Read-only vagt — ingen automatisk handling. Tjek om en loft-ændring lige er rullet.",
              color: 0xf39c12,
              fields: [
                { name: "Årsag", value: reasons.map((r) => `• ${r}`).join("\n") },
                {
                  name: "I dag",
                  value:
                    `${totals.deadSlots} helt døde · ${totals.partialSlots} delvist døde · ` +
                    `${totals.ridersInTraining} i træning (${(deadShare * 100).toFixed(1)} %)`,
                },
              ],
              timestamp: generatedAt,
            },
          ],
        })
      );
    }
  }

  if (changed) {
    const { error: stateUpsertErr } = await supabase.from("ops_alert_state").upsert(
      {
        alert_key: ALERT_KEY,
        signature,
        ...(shouldAlert ? { last_alerted_at: generatedAt } : {}),
        updated_at: generatedAt,
      },
      { onConflict: "alert_key" }
    );
    if (stateUpsertErr) {
      captureExceptionFn?.(new Error(`ops_alert_state upsert (training-slot-health): ${stateUpsertErr.message}`), {
        tags: { cron: "training-slot-health-watch" },
      });
    }
  }

  return { date: snapshotDate, totals, rows, alerted: shouldAlert && changed, trainingDays };
}
