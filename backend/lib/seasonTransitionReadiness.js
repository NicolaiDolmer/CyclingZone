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
 * Gaten håndhæves i POST /api/admin/season-transition (routes/api.js).
 * Cron, relaunch-orchestratoren (#1103) og scripts/executeSeasonTransition.js
 * kalder transitionToNextSeason direkte og er bevidst ugatede.
 */

export async function assessTransitionReadiness({ supabase, fromSeasonId } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!fromSeasonId) throw new Error("fromSeasonId required");

  const [windowRes, auctionsRes, racesRes] = await Promise.all([
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
  ]);

  if (windowRes.error) throw new Error(`Kunne ikke læse transfervindue: ${windowRes.error.message}`);
  if (auctionsRes.error) throw new Error(`Kunne ikke tælle auktioner: ${auctionsRes.error.message}`);
  if (racesRes.error) throw new Error(`Kunne ikke tælle løb: ${racesRes.error.message}`);

  const win = windowRes.data;
  const activeAuctions = auctionsRes.count || 0;
  const unfinishedRaces = racesRes.count || 0;

  const windowClosed = Boolean(win && win.status === "closed" && win.closed_at);
  const windowDetail = !win
    ? "Intet transfervindue fundet for sæsonen, deadline-cyklussen er ikke kørt"
    : win.status !== "closed"
      ? `Vinduet har status '${win.status}'`
      : !win.closed_at
        ? "Vinduet er aldrig lukket via deadline-cyklussen (closed_at mangler)"
        : null;

  const checks = {
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
