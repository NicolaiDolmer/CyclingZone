// #5130 (ejer-direktiv 10/9): sweep der sender Discord-velkomstbeskeden.
//
// TIDSPUNKT (orkestrator-valg, se PR-body #5211): naar holdet er oprettet OG
// har rundet loebs-klar-taersklen (MIN_RIDERS_FOR_RACE, samme graense som
// squadBelowMinimumCheck.js/starterSquadAllocator.js) — dvs. den foerste
// draft er gennemfoert — ELLERS senest 24t efter oprettelse uanset
// trupstoerrelse (dette sweeps naeste tick fanger den fallback, ingen
// separat route-hook noedvendig).
//
// IDEMPOTENS + RACE-SIKRING (dedupe paa team_id) — haerdet 15/9 (CodeRabbit
// major, PR #5211, discordWelcomeSweep.js:105), og igen 15/9 efter et
// WAVE-FOLLOWUP-reviewfund: den foerste haerdningsrunde byttede
// raekkefoelgen om (notify() FOERST, markering af
// teams.discord_welcome_sent_at BAGEFTER) for at lukke crash-fejlvejen
// nedenfor, men fjernede dermed den eneste atomiske spaerre mod at to
// sweep-ticks BEGGE naar notify() for samme hold — uden at erstatte den, som
// haerdnings-letteren (docs/drafts/discord-welcome-copy-2026-09-15.md punkt
// 1) eksplicit kraevede. Denne runde genindfoerer race-sikringen, men som en
// separat claim-kolonne MED UDLOEB (letterens foerste forslag) i stedet for
// den gamle uendelige laas:
//
//   1. CLAIM (atomisk, med udloeb, defaultClaimTeam) — betinget UPDATE paa
//      teams.discord_welcome_claimed_at: WHERE discord_welcome_sent_at IS
//      NULL AND (claimed_at IS NULL ELLER aeldre end
//      DISCORD_WELCOME_CLAIM_LEASE_MS). .select() afsloerer om raekken reelt
//      blev opdateret (0 raekker = tabt kaploeb eller et andet, stadig
//      levende claim). To sweep-ticks der raekker frem til samme hold
//      SAMTIDIG kan derfor aldrig begge vinde claimet — Postgres' egen
//      raekke-laasning under UPDATE'en afgoer det, ikke applikationskoden.
//   2. NOTIFY derefter, MARK (sent_at) bagefter — uaendret fra forrige
//      haerdningsrunde. Doer processen MELLEM claim og notify()
//      (crash/OOM/deploy-genstart), er holdet IKKE tabt for evigt: claimet
//      bliver blot "koldt" naar DISCORD_WELCOME_CLAIM_LEASE_MS er udloebet,
//      og en SENERE tick maa saa genclaime og proeve igen. Selv-helende —
//      samme egenskab som var pointen med at bytte notify()/markering om,
//      men nu UDEN at give slip paa den atomiske race-sikring.
//
// notifyUser's EGEN 24t-dedup (matcher paa type + title + message +
// related_id, RECENT_DUPLICATE_WINDOW_MS i notificationService.js) staar
// stadig som et andet, uafhaengigt forsvarslag — men er ikke laengere DEN
// ENESTE ting der forhindrer to sweep-ticks i at sende dobbelt (den er
// selv et opslag+insert i to adskilte trin, ikke atomisk).
//
// SCHEMA-READINESS (CodeRabbit minor, PR #5211, discordWelcomeSweep.js:31,
// udvidet 15/9 til ogsaa at daekke claim-kolonnen): auto-migrate (#2642)
// koerer database/2026-09-14-5130-discord-welcome-sent-at.sql og
// database/2026-09-15-5130-discord-welcome-claimed-at.sql foerst ca. 180s
// EFTER deploy, og begge kolonner kan derfor mangle i op til 120s efter
// appen er live (cron'en der driver denne sweep starter efter 300s).
// Begge kolonner slaas op i SAMME initiale SELECT
// (defaultFetchCandidateTeams), saa isDiscordWelcomeSchemaPending fanger
// manglen for begge under ét og springer tick'en over med et log-varsel i
// stedet for at raabe stoej i Sentry i det vindue.

import { fetchAllRows, fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { applyHumanTeamFilter } from "./humanTeamFilter.js";
import { MIN_RIDERS_FOR_RACE } from "./marketUtils.js";
import { notifyUser as defaultNotifyUser } from "./notificationService.js";
import { buildDiscordWelcomeNotification } from "./discordWelcomeNotification.js";
import { captureException } from "./sentry.js";

export const DISCORD_WELCOME_FALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

// Claim-lease (WAVE-FOLLOWUP-fund 15/9, se filens toppkommentar): sweepen
// tikker hvert 5. minut (backend/cron.js) og behandler ét hold ad gangen med
// en simpel notify()+UPDATE — ikke race-simulering, saa en enkelt tick
// forventes at vaere faerdig med et hold paa sekunder. 10 minutter (2 ticks)
// giver rigeligt slaek foer en NY tick maa genclaime, uden at en reel
// crash-stall efterlader holdet koldt i lang tid.
export const DISCORD_WELCOME_CLAIM_LEASE_MS = 10 * 60 * 1000;

/**
 * Er fejlen "discord_welcome_sent_at ELLER discord_welcome_claimed_at findes
 * ikke endnu"? (udvidet 15/9 til ogsaa at daekke claim-kolonnen, se filens
 * toppkommentar). Samme recipe som isSelectionReminderMigrationPending
 * (selectionDeadlineReminder.js) og isMissingRetryColumnError
 * (emailRetrySweep.js): SQLSTATE + PostgRESTs egne schema-cache-koder
 * tjekkes foerst (stabile signal), beskeden er sidste vaern hvis koden
 * mangler i et fremtidigt driver-skift.
 */
export function isDiscordWelcomeSchemaPending(error) {
  if (!error) return false;
  const code = String(error.code ?? "");
  if (code === "42703" || code === "PGRST204" || code === "PGRST205") return true;
  return /discord_welcome_(sent|claimed)_at|schema cache/i.test(String(error.message ?? ""));
}

async function defaultFetchCandidateTeams({ supabase }) {
  // discord_welcome_claimed_at slaas op her (selv om kolonnen ikke bruges af
  // selve kandidat-filtret) saa en manglende kolonne opdages i SAMME
  // schema-readiness-guard som discord_welcome_sent_at, i stedet for at
  // fejle per-hold naar defaultClaimTeam foerst rammer den nede i loopet.
  // isDiscordWelcomeSchemaPending haandterer vinduet foer migrationen er
  // anvendt (samme moenster som discord_welcome_sent_at).
  return fetchAllRows(() =>
    applyHumanTeamFilter(
      // schema-columns-ok: discord_welcome_claimed_at tilfoejes af
      // database/2026-09-15-5130-discord-welcome-claimed-at.sql, applied
      // post-merge (#2642-rammer) — ikke i schema-snapshot.json paa PR-tid.
      supabase.from("teams").select("id, name, user_id, created_at, discord_welcome_claimed_at"),
    )
      .not("user_id", "is", null)
      .is("discord_welcome_sent_at", null)
      .order("id"),
  );
}

/**
 * Atomisk claim MED UDLOEB (WAVE-FOLLOWUP-fund 15/9, se filens
 * toppkommentar) — den race-sikring haerdnings-letterens punkt 1 kraevede
 * bevaret. Betinget UPDATE: kun ét kald kan nogensinde vinde for et givet
 * hold paa et givet tidspunkt, fordi Postgres' raekke-laasning under
 * UPDATE'en afgoer det, ikke applikationskoden. Et hold hvis claim er aeldre
 * end leaseMs regnes som koldt (en tidligere tick doede formentlig mellem
 * claim og notify) og kan genclaimes.
 *
 * @returns {Promise<boolean>} true hvis DETTE kald vandt claimet.
 */
async function defaultClaimTeam({ supabase, teamId, now, leaseMs }) {
  const staleCutoffIso = new Date(now.getTime() - leaseMs).toISOString();
  const { data, error } = await supabase
    .from("teams")
    .update({ discord_welcome_claimed_at: now.toISOString() })
    .eq("id", teamId)
    .is("discord_welcome_sent_at", null)
    .or(`discord_welcome_claimed_at.is.null,discord_welcome_claimed_at.lt.${staleCutoffIso}`)
    .select("id");
  if (error) throw error;
  return Boolean(data?.length);
}

// Samme filter + chunked-in-moenster som squadBelowMinimumCheck.js's
// defaultFetchActiveRiderCounts: akademi- og pensionerede ryttere taeller
// ikke mod loebs-klar trupstoerrelse.
async function defaultFetchActiveRiderCounts({ supabase, teamIds }) {
  if (!teamIds.length) return new Map();
  const rows = await fetchAllRowsChunkedIn(teamIds, (chunk) =>
    supabase
      .from("riders")
      .select("id, team_id")
      .in("team_id", chunk)
      .eq("is_academy", false)
      .eq("is_retired", false)
      .order("id"),
  );
  const counts = new Map();
  for (const row of rows) {
    counts.set(row.team_id, (counts.get(row.team_id) || 0) + 1);
  }
  return counts;
}

/**
 * Ren beslutningsfunktion (unit-testbar uden database): er holdet moden til
 * Discord-velkomstbeskeden lige nu?
 */
export function isDiscordWelcomeDue({
  team,
  activeRiders,
  now,
  minRiders = MIN_RIDERS_FOR_RACE,
  windowMs = DISCORD_WELCOME_FALLBACK_WINDOW_MS,
}) {
  if (!team?.created_at) return false;
  if ((activeRiders || 0) >= minRiders) return true;
  const createdAtMs = Date.parse(team.created_at);
  if (!Number.isFinite(createdAtMs)) return false;
  return now.getTime() - createdAtMs >= windowMs;
}

export async function runDiscordWelcomeSweep({
  supabase,
  now = new Date(),
  minRiders = MIN_RIDERS_FOR_RACE,
  windowMs = DISCORD_WELCOME_FALLBACK_WINDOW_MS,
  claimLeaseMs = DISCORD_WELCOME_CLAIM_LEASE_MS,
  notify = defaultNotifyUser,
  fetchCandidateTeams = defaultFetchCandidateTeams,
  fetchActiveRiderCounts = defaultFetchActiveRiderCounts,
  claimTeam = defaultClaimTeam,
  captureExceptionFn = captureException,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  let teams;
  try {
    teams = await fetchCandidateTeams({ supabase });
  } catch (err) {
    if (isDiscordWelcomeSchemaPending(err)) {
      console.warn(
        "[discord-welcome] discord_welcome_sent_at findes ikke endnu (migration ikke anvendt) — springer tick over",
      );
      return { candidates: 0, sent: 0, skipped: 0, failed: 0 };
    }
    throw err;
  }
  const stats = { candidates: teams.length, sent: 0, skipped: 0, failed: 0 };
  if (!teams.length) return stats;

  const counts = await fetchActiveRiderCounts({ supabase, teamIds: teams.map((t) => t.id) });

  for (const team of teams) {
    const activeRiders = counts.get(team.id) || 0;
    if (!isDiscordWelcomeDue({ team, activeRiders, now, minRiders, windowMs })) {
      stats.skipped += 1;
      continue;
    }
    try {
      // CLAIM foerst — atomisk, med udloeb (se filens toppkommentar). 0
      // raekker ramt betyder enten at en anden tick lige har vundet
      // kaploebet, eller at et andet claim stadig er levende (inden for
      // leaseMs) — begge er normale, ikke en fejl.
      const claimed = await claimTeam({ supabase, teamId: team.id, now, leaseMs: claimLeaseMs });
      if (!claimed) {
        stats.skipped += 1;
        continue;
      }

      // notify() DEREFTER — se filens toppkommentar for hvorfor denne
      // raekkefoelge (efter claimet) er selv-helende ved en process-crash,
      // mens det omvendte (markering foer notify, uden claim-udloeb) kunne
      // tabe et hold permanent.
      const payload = buildDiscordWelcomeNotification();
      const result = await notify({ supabase, userId: team.user_id, now, ...payload });
      if (!result?.delivered && !result?.deduped) {
        stats.skipped += 1;
        continue;
      }

      stats.sent += 1;

      // Ren bogfoering herfra: notifikationen ER skrevet (leveret eller
      // deduplikeret af notifyUser). Betinget paa IS NULL saa en tick der
      // taber loebet mod en anden ikke unoedvendigt overskriver
      // markeringen — men uanset udfald her er der INGEN dobbelt besked,
      // for det er notifyUser's egen dedup der garanterer det, ikke denne
      // UPDATE.
      const { error: markError } = await supabase
        .from("teams")
        .update({ discord_welcome_sent_at: now.toISOString() })
        .eq("id", team.id)
        .is("discord_welcome_sent_at", null);
      if (markError) {
        // Notifikationen ER leveret. En fejlet markering betyder KUN at
        // holdet fejlagtigt ses som kandidat igen naeste tick —
        // notifyUser's dedup fanger det uden en ny besked, og den tick
        // markerer saa korrekt. Ikke tabt data, men skal stadig raabe
        // hoejt frem for at fejle stille.
        captureExceptionFn(
          new Error(`discord-welcome: kunne ikke markere hold ${team.id} som sendt: ${markError.message}`),
          { tags: { cron: "discord-welcome", stage: "mark-failed" }, extra: { teamId: team.id } },
        );
      }
    } catch (err) {
      stats.failed += 1;
      console.error(`  ❌ discord-welcome-sweep fejlede for hold ${team.id}:`, err?.message || err);
      captureExceptionFn(err, { tags: { cron: "discord-welcome" }, extra: { teamId: team.id } });
    }
  }

  return stats;
}
