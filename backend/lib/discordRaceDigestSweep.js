// #3400 · Daily Discord DM digest for race_result/stage_result.
//
// PROBLEM (#3400): discordNotifier.js's DM coverage was 3/36 notification
// types (auction_won/board/watchlist) — excluding race_result/stage_result,
// which are 57% of all notification volume, from the ONE live out-of-app
// channel (32/196 managers have linked Discord). This sweep mirrors those two
// notification types to DM, using the SAME narrative headline
// (raceNarrativeNotification.js, #3399) — never "Race result is in".
//
// Digest, not per-event (AC: "max 1 DM per manager per day"): a stage race's
// catch-up scheduler can run several stages in one tick (#2090's "maks 5
// etaper/dag"), so a naive per-event DM would spam a manager on a busy day.
// This sweep runs ONCE per Copenhagen calendar day (its own hour window,
// independent of emailRaceDigestSweep.js's 19:00 — separate channels, neither
// gates the other) and collapses that whole day's results into ONE DM.
//
// Hard cap survives restarts: discord_race_digest_log (UNIQUE (user_id,
// digest_date), see its migration's header) is the persisted dedupe anchor —
// mirrors email_log's role for the email digest. An in-memory-only guard
// (like cron.js's stageSchedulerSeenKeys) would reset on every Railway
// redeploy and could let a second digest through on the same calendar day;
// unacceptable for a hard "no spam" AC.
//
// Opt-out (AC: "respekteres"): filtered upfront via users.discord_id +
// discord_dm_enabled (same master-switch discordDmRecipient.js enforces) —
// checked BEFORE building any narrative, so an unlinked/opted-out manager
// costs no extra query. notifyRaceResultDigestDM (discordNotifier.js) applies
// the SAME check again downstream (defense in depth, same double-check shape
// as isDmTypeEnabled elsewhere in that module).

import { fetchAllRows } from "./supabasePagination.js";
import { copenhagenHour, copenhagenDateString, copenhagenMidnightUTC } from "./copenhagenTime.js";
import { notifyRaceResultDigestDM } from "./discordNotifier.js";
import { buildRaceResultNarrative, buildStageResultNarrative, buildPersonalResultText, capitalize } from "./raceNarrativeNotification.js";
import { captureException } from "./sentry.js";

export const DISCORD_DIGEST_HOUR_COPENHAGEN = 20; // separate hour from the 19:00 email digest — independent channels

const RACES_URL = "https://cyclingzone.org/races";

// Not paginated via a single-race bound (unlike raceNarrativeNotification.js's
// slices) — a busy division day can span MANY races, so this uses fetchAllRows
// with a stable .order("id"), same shape as emailRaceDigestSweep.js's
// defaultFetchDigestRows. Restricted to result_type IN ('gc','stage') — the
// two types raceNarrativeNotification.js's headline-builders understand
// (final result / per-stage result); 'leader'/'points_day'/etc. rows are
// running-classification noise for THIS digest's purpose.
async function defaultFetchDigestRows({ supabase, sinceIso }) {
  return fetchAllRows(() =>
    supabase
      .from("race_results")
      .select(
        "race_id, stage_number, result_type, team:team_id!inner(user_id, is_ai, is_bank, is_frozen, is_test_account), race:race_id!inner(id, name)"
      )
      .gte("imported_at", sinceIso)
      .in("result_type", ["gc", "stage"])
      .eq("team.is_ai", false)
      .eq("team.is_bank", false)
      .eq("team.is_frozen", false)
      .eq("team.is_test_account", false)
      .not("rank", "is", null)
      .order("id")
  );
}

async function defaultFetchDiscordEligibleUserIds({ supabase, userIds }) {
  if (!userIds.length) return new Set();
  const { data, error } = await supabase
    .from("users")
    .select("id, discord_id, discord_dm_enabled")
    .in("id", userIds);
  if (error) throw new Error(`discord-race-digest eligibility lookup: ${error.message}`);
  return new Set((data || []).filter((u) => u.discord_id && u.discord_dm_enabled !== false).map((u) => u.id));
}

async function defaultFetchAlreadySentUserIds({ supabase, userIds, digestDate }) {
  if (!userIds.length) return new Set();
  const { data, error } = await supabase
    .from("discord_race_digest_log")
    .select("user_id")
    .eq("digest_date", digestDate)
    .in("user_id", userIds);
  if (error) throw new Error(`discord-race-digest dedupe-check: ${error.message}`);
  return new Set((data || []).map((r) => r.user_id));
}

async function defaultLogDigestSent({ supabase, userId, digestDate, itemCount }) {
  const { error } = await supabase
    .from("discord_race_digest_log")
    .insert({ user_id: userId, digest_date: digestDate, item_count: itemCount });
  if (error) throw error;
}

/**
 * Byg ÉN linje for ét dagens-item — narrativ rubrik + personligt resultat når
 * begge findes, ellers en ærligt degraderet generisk linje (aldrig opdigtet).
 * Slutter altid med et direkte link til løbssiden (AC: "link direkte til
 * løbssiden").
 */
export function buildDigestItemLine({ headlineText, personalText, raceName, stageLabel = "", raceId }) {
  const url = `${RACES_URL}/${raceId}`;
  if (headlineText && personalText) return `${headlineText}. ${capitalize(personalText)}. ${url}`;
  if (personalText) return `${raceName}${stageLabel}. ${capitalize(personalText)}. ${url}`;
  return `${raceName}${stageLabel}: results are in. ${url}`;
}

/**
 * Byg embed-description + fields for et sæt dagens-items. Ét item => linjen
 * ER beskrivelsen (mest narrativ, mest almindelige tilfælde: én manager, ét
 * løb). Flere items (etapeløbs-indhentning/flere løb samme dag) => en kort
 * fælles intro + ét felt pr. item, så ingen historie drukner i de andre.
 */
export function buildDigestDescriptionAndFields(items) {
  if (!items.length) return { description: "", fields: [] };
  if (items.length === 1) return { description: items[0].line, fields: [] };
  return {
    description: "Your results from today:",
    fields: items.map((it) => ({ name: it.label, value: it.line, inline: false })),
  };
}

export async function runDiscordRaceDigestSweep({
  supabase,
  now = new Date(),
  fetchRows = defaultFetchDigestRows,
  fetchEligibleUserIds = defaultFetchDiscordEligibleUserIds,
  fetchAlreadySentUserIds = defaultFetchAlreadySentUserIds,
  logDigestSent = defaultLogDigestSent,
  // #3399: samme narrativ-byggere som notificationService.js/emailRaceDigestSweep.js
  // (injicérbare for test; ærlig degradering til en generisk linje ved null).
  fetchRaceNarrative = buildRaceResultNarrative,
  fetchStageNarrative = buildStageResultNarrative,
  sendDigestDM = notifyRaceResultDigestDM,
  captureExceptionFn = captureException,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  if (copenhagenHour(now) !== DISCORD_DIGEST_HOUR_COPENHAGEN) {
    return { candidates: 0, sent: 0, skipped: 0, failed: 0, skippedReason: "outside_hour_window" };
  }

  const sinceIso = copenhagenMidnightUTC(now).toISOString();
  const rows = await fetchRows({ supabase, sinceIso });

  // Gruppér til (userId -> Map(groupKey -> item)). groupKey dedup'er flere
  // rækker for SAMME (race, resultType[, stageNumber]) — fx flere ryttere fra
  // samme hold i samme etape giver kun ÉT item, ikke ét pr. rytter.
  const itemsByUser = new Map();
  for (const row of rows || []) {
    const userId = row.team?.user_id;
    const raceId = row.race?.id;
    if (!userId || !raceId) continue;
    const stageNumber = row.result_type === "stage" ? (row.stage_number ?? null) : null;
    const key = `${raceId}:${row.result_type}:${stageNumber ?? ""}`;
    if (!itemsByUser.has(userId)) itemsByUser.set(userId, new Map());
    const perUser = itemsByUser.get(userId);
    if (!perUser.has(key)) {
      perUser.set(key, { raceId, raceName: row.race?.name ?? "your race", resultType: row.result_type, stageNumber });
    }
  }

  const userIds = [...itemsByUser.keys()];
  if (!userIds.length) return { candidates: 0, sent: 0, skipped: 0, failed: 0 };

  const [eligibleUserIds, alreadySentUserIds] = await Promise.all([
    fetchEligibleUserIds({ supabase, userIds }),
    fetchAlreadySentUserIds({ supabase, userIds, digestDate: copenhagenDateString(now) }),
  ]);

  const copenhagenDate = copenhagenDateString(now);
  const narrativeCache = new Map();
  const getNarrative = ({ raceId, raceName, resultType, stageNumber }) => {
    const key = `${raceId}:${resultType}:${stageNumber ?? ""}`;
    if (!narrativeCache.has(key)) {
      const p = resultType === "gc"
        ? fetchRaceNarrative({ supabase, race: { id: raceId, name: raceName } })
        : fetchStageNarrative({ supabase, race: { id: raceId, name: raceName }, stageNumber });
      narrativeCache.set(key, Promise.resolve(p).catch(() => null));
    }
    return narrativeCache.get(key);
  };

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const [userId, perUser] of itemsByUser) {
    if (!eligibleUserIds.has(userId) || alreadySentUserIds.has(userId)) { skipped += 1; continue; }
    try {
      const items = [];
      for (const group of perUser.values()) {
        const narrative = await getNarrative(group);
        const personalText = buildPersonalResultText(narrative?.ranksByUser?.get(userId));
        const stageLabel = group.stageNumber != null ? ` (stage ${group.stageNumber})` : "";
        items.push({
          label: `${group.raceName}${stageLabel}`,
          line: buildDigestItemLine({
            headlineText: narrative?.headlineText ?? null,
            personalText,
            raceName: group.raceName,
            stageLabel,
            raceId: group.raceId,
          }),
        });
      }

      const { description, fields } = buildDigestDescriptionAndFields(items);
      const title = items.length === 1 ? items[0].label : "Today's races";
      await sendDigestDM({ userId, title, description, fields });
      sent += 1;

      try {
        await logDigestSent({ supabase, userId, digestDate: copenhagenDate, itemCount: items.length });
      } catch (logErr) {
        // #3400: DM'en er allerede sendt — en fejlende log-insert må ALDRIG
        // se ud som en fejlet levering (samme lære som emailService.js's
        // sent-log-fejlhåndtering). Risikoen ved en tabt logrække er højst en
        // ekstra digest ved næste tick samme dag, aldrig en tabt notifikation.
        console.error(`  ⚠️  discord-race-digest-log insert fejlede for bruger ${userId} (DM ER sendt):`, logErr?.message || logErr);
        captureExceptionFn(logErr, { tags: { cron: "discord-race-digest", stage: "log-insert" }, extra: { userId } });
      }
    } catch (err) {
      failed += 1;
      console.error(`  ❌ discord-race-digest fejlede for bruger ${userId}:`, err?.message || err);
      captureExceptionFn(err, { tags: { cron: "discord-race-digest" }, extra: { userId } });
    }
  }

  return { candidates: itemsByUser.size, sent, skipped, failed };
}
