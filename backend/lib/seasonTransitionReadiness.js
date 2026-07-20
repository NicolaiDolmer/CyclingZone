/**
 * #1346 — Readiness-gate for manuel sæson-transition.
 * =====================================================
 * Genbruger auto-cron'ens "wrapped window"-semantik (seasonAutoTransition.js):
 * den afgående sæsons seneste transfervindue skal være lukket via deadline-
 * cyklussen (status='closed' OG closed_at sat — et racing-window født af
 * transitionToNextSeason har closed_at=null og tæller IKKE), final whistle
 * sendt og squad enforcement kørt. Dertil: ingen aktive auktioner og alle
 * sæsonens løb afviklet (ejer-beslutning 12/6: kritisk check).
 *
 * #2361 — season_end_completed: transitionToNextSeason (season-transition) og
 * processSeasonEnd ("Afslut sæson") er TO adskilte manuelle admin-handlinger.
 * Kører man transition på en stadig-AKTIV sæson, springes board-eval,
 * payDivisionBonuses og processDivisionEnd (op/nedrykning) HELT over —
 * irreversibelt, fordi season-end bagefter afviser en allerede completed
 * sæson. processSeasonEnd sætter seasons.status='completed' som sidste skridt
 * (economyEngine.js, EFTER divisionsbonus + op/nedrykning), så
 * status==='completed' er et robust signal på at season-end faktisk er kørt.
 * Season 0 er undtaget (FIRST_PROMOTION_RELEGATION_SEASON=1): der findes intet
 * season-end-skridt for sæson 0, og 0→1-transitionen kræver fromSeason
 * status='active'.
 *
 * Gaten håndhæves i POST /api/admin/season-transition (routes/api.js).
 * Cron, relaunch-orchestratoren (#1103) og scripts/executeSeasonTransition.js
 * kalder transitionToNextSeason direkte og er bevidst ugatede (executeSeasonTransition.js
 * logger dog et eksplicit season-end-verificeret JA/NEJ-warn, #2361).
 */

import { FIRST_PROMOTION_RELEGATION_SEASON } from "./economyConstants.js";

export async function assessTransitionReadiness({ supabase, fromSeasonId } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!fromSeasonId) throw new Error("fromSeasonId required");

  const [windowRes, auctionsRes, racesRes, seasonRes] = await Promise.all([
    supabase
      .from("transfer_windows")
      .select("id, status, closed_at, final_whistle_sent_at, squad_enforcement_completed_at")
      .eq("season_id", fromSeasonId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("auctions")
      .select("id", { count: "exact", head: true })
      .in("status", ["active", "extended"]),
    supabase
      .from("races")
      .select("id", { count: "exact", head: true })
      .eq("season_id", fromSeasonId)
      .neq("status", "completed"),
    supabase
      .from("seasons")
      .select("id, number, status")
      .eq("id", fromSeasonId)
      .maybeSingle(),
  ]);

  if (windowRes.error) throw new Error(`Kunne ikke læse transfervindue: ${windowRes.error.message}`);
  if (auctionsRes.error) throw new Error(`Kunne ikke tælle auktioner: ${auctionsRes.error.message}`);
  if (racesRes.error) throw new Error(`Kunne ikke tælle løb: ${racesRes.error.message}`);
  if (seasonRes.error) throw new Error(`Kunne ikke læse sæson: ${seasonRes.error.message}`);
  if (!seasonRes.data) throw new Error(`Sæson ${fromSeasonId} findes ikke`);

  const win = windowRes.data;
  const activeAuctions = auctionsRes.count || 0;
  const unfinishedRaces = racesRes.count || 0;
  const season = seasonRes.data;
  // #2361: for sæson 0 er der intet season-end-skridt at vente på (0→1-transitionen
  // kræver status='active' — den bliver aldrig 'completed' inden transition).
  const seasonEndRequired = season.number >= FIRST_PROMOTION_RELEGATION_SEASON;
  const seasonEndCompleted = !seasonEndRequired || season.status === "completed";

  const windowClosed = Boolean(win && win.status === "closed" && win.closed_at);
  const windowDetail = !win
    ? "Intet transfervindue fundet for sæsonen, deadline-cyklussen er ikke kørt"
    : win.status !== "closed"
      ? `Vinduet har status '${win.status}'`
      : !win.closed_at
        ? "Vinduet er aldrig lukket via deadline-cyklussen (closed_at mangler)"
        : null;

  const checks = {
    season_end_completed: {
      ok: seasonEndCompleted,
      critical: true,
      detail: seasonEndCompleted
        ? null
        : `Sæson ${season.number} er stadig '${season.status}' — kør 'Afslut sæson' (season-end) FØRST, ellers springes op/nedrykning + divisionsbonusser over`,
    },
    window_closed: { ok: windowClosed, critical: true, detail: windowDetail },
    final_whistle_sent: {
      ok: Boolean(win?.final_whistle_sent_at),
      critical: true,
      detail: win?.final_whistle_sent_at ? null : "final_whistle_sent_at mangler på vinduet",
    },
    squad_enforcement_completed: {
      ok: Boolean(win?.squad_enforcement_completed_at),
      critical: true,
      detail: win?.squad_enforcement_completed_at ? null : "squad_enforcement_completed_at mangler på vinduet",
    },
    no_active_auctions: {
      ok: activeAuctions === 0,
      critical: true,
      detail: activeAuctions === 0 ? null : `${activeAuctions} aktive/forlængede auktioner`,
    },
    all_races_completed: {
      ok: unfinishedRaces === 0,
      critical: true,
      detail: unfinishedRaces === 0 ? null : `${unfinishedRaces} løb er ikke afviklet (status er ikke 'completed')`,
    },
  };

  const failed_critical = Object.entries(checks)
    .filter(([, c]) => c.critical && !c.ok)
    .map(([key]) => key);

  return { ready: failed_critical.length === 0, checks, failed_critical };
}

// Admin-vendte strenge samlet her — filen er EXEMPT i i18n-leak-guarden:
// admin-UI er DA-only-konvention (ikke player-facing), og admin_log er internt.
export const TRANSITION_BLOCKED_ERROR = "Sæson-transition blokeret: readiness-gaten er rød";

export function formatForceOverrideDescription(failedCritical) {
  return `Sæson-transition FORCED med rød readiness-gate (${failedCritical.join(", ")})`;
}
