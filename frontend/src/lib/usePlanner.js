// usePlanner — frontend-state for Season Planner-cockpittet (spec §3/§5).
//
// Kilde: GET /api/peak-plans/board (ét aggregat: enabled + sæson + holdets ryttere
// m. peaks/tq/status + kalender m. egnetheds-input + rival-neutralisering). Mens
// peak_planner_enabled er 'off' rapporterer board'et enabled:false og
// SeasonPlannerPage viser en tom-state — samme kill-switch-mønster som
// useScoutingCentral/useFacilities. Al mutation går gennem CRUD-endpointsene +
// accept-training; hver muterings-succes refresher board'et.
//
// #2455 assistent-forslag: rider.peaks kan indeholde `isSuggestion:true`-poster
// (RENT beregnet server-side, aldrig en ægte rider_peak_plans-række — se
// backend/lib/peakSuggestions.js). "Acceptér" en foreslået peak = samme
// createPeak-kald som en manuel peak (serveren genskaber præcis samme vindue,
// deterministisk); "nulstil til blank" er et separat sæson-scoped write.
import { useState, useEffect, useCallback } from "react";
import { getSession } from "./supabase.js";
import { reportLoadFailure } from "./actionTelemetry.js";

const API = import.meta.env.VITE_API_URL;

async function authHeaders() {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

// #3018: divisionPending = holdets division for DEN VALGTE sæson er ikke afgjort
// endnu (sæsonen er 'upcoming'; op/nedrykning sker ved sæsonskiftet). Så er intet
// løb markeret isMine, og siden viser en ærlig forklaring frem for den gamle
// divisions kalender. Default false → uændret adfærd for den aktive sæson.
const EMPTY = { season: null, availableSeasons: [], divisionPending: false, maxPerRider: 2, today: null, leadupDays: 14, paybackDays: 7, riders: [], races: [] };

// #2518: seasonNumber = null → backend defaulter til aktiv sæson (uændret
// adfærd); et eksplicit nummer (fra sæson-vælgeren i SeasonPlannerPage) lader
// manageren planlægge mod en ANDEN sæson (fx S2 før den starter, jf. #2449).
export function usePlanner(seasonNumber = null) {
  const [enabled, setEnabled] = useState(false);
  const [board, setBoard] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const headers = await authHeaders();
    // #4165: #2849 bølge 6 lukkede !res.ok og catch, men IKKE denne gren. Uden
    // session returnerede den tavst, så `error` blev ved med at være null og
    // `enabled` false - og SeasonPlannerPage tegnede "Sæsonplanlæggeren er ikke
    // live endnu". En fejlet hentning præsenteret som slukket feature er præcis
    // den fejlklasse #4165 handler om.
    if (!headers) {
      setError("auth");
      reportLoadFailure("season_planner_board", { kind: "auth" });
      setLoading(false);
      return;
    }
    try {
      const qs = seasonNumber != null ? `?season_number=${seasonNumber}` : "";
      const res = await fetch(`${API}/api/peak-plans/board${qs}`, { headers });
      // #2849 bølge 6: både !res.ok og netværks-catch returnerede tavst, så
      // `error` aldrig blev sat — planlæggeren degraderede til en tom side uden
      // besked (audit-fund F5, tavs degradering). Nu surfacer begge grene, så
      // sidens ErrorState + retry rent faktisk kan rendere.
      if (!res.ok) {
        reportLoadFailure("season_planner_board", { kind: "http", status: res.status });
        setError("http"); setLoading(false); return;
      }
      // #4165: parsningen har sin EGEN gren. Lå res.json() i den ydre try, blev
      // en malformet 200-krop rapporteret som "network" - spillerens forbindelse
      // - selvom fejlen kom fra serveren eller en proxy. Forkert triage i netop
      // det signal instrumenteringen er bygget til at bære.
      let data;
      try {
        data = await res.json();
      } catch (cause) {
        reportLoadFailure("season_planner_board", { kind: "parse", status: res.status, cause });
        setError("parse"); setLoading(false); return;
      }
      setEnabled(Boolean(data.enabled));
      if (data.enabled) {
        setBoard({
          season: data.season ?? null,
          availableSeasons: data.availableSeasons ?? [],
          divisionPending: Boolean(data.divisionPending),
          maxPerRider: data.maxPerRider ?? 2,
          today: data.today ?? null,
          leadupDays: data.leadupDays ?? 14,
          paybackDays: data.paybackDays ?? 7,
          riders: data.riders ?? [],
          races: data.races ?? [],
        });
      }
      setError(null);
    } catch (cause) {
      reportLoadFailure("season_planner_board", { kind: "network", cause });
      setError("network"); // behold tidligere board-state, men vis fejlen
    } finally {
      setLoading(false);
    }
  }, [seasonNumber]);

  useEffect(() => { refresh(); }, [refresh]);

  const mutate = useCallback(async (path, method, body) => {
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: "auth" };
    setBusy(true);
    try {
      const payload = (body || seasonNumber != null)
        ? { ...(body || {}), ...(seasonNumber != null ? { season_number: seasonNumber } : {}) }
        : undefined;
      const res = await fetch(`${API}/api/peak-plans${path}`, {
        method, headers, body: payload ? JSON.stringify(payload) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) return { ok: false, error: data.error || "failed", status: res.status };
      await refresh();
      return { ok: true, ...data };
    } catch {
      return { ok: false, error: "network" };
    } finally {
      setBusy(false);
    }
  }, [refresh, seasonNumber]);

  const createPeak = useCallback((riderId, targetRaceId) =>
    mutate("", "POST", { rider_id: riderId, target_race_id: targetRaceId }), [mutate]);
  const retargetPeak = useCallback((planId, targetRaceId) =>
    mutate(`/${planId}`, "PATCH", { target_race_id: targetRaceId }), [mutate]);
  const deletePeak = useCallback((planId) =>
    mutate(`/${planId}`, "DELETE"), [mutate]);
  const acceptTraining = useCallback((planId, week) =>
    mutate(`/${planId}/accept-training`, "POST", { week }), [mutate]);
  // #2455: acceptér et assistent-forslag = opret det som en ægte peak (samme
  // endpoint/vindue-snap som en manuel peak — forslaget HAR ingen egen DB-id).
  const acceptSuggestion = useCallback((riderId, targetRaceId) =>
    mutate("", "POST", { rider_id: riderId, target_race_id: targetRaceId }), [mutate]);
  const dismissSuggestions = useCallback((riderId) =>
    mutate("/dismiss-suggestions", "POST", { rider_id: riderId }), [mutate]);
  // #3086 "Accept all": ÉT kald frem for en løkke over createPeak. En fuld trup
  // kan have op mod 60 forslag, og marketWriteLimiter tillader 30 skriv i
  // minuttet — en klient-løkke ville fejle midtvejs og efterlade manageren med en
  // halvt accepteret plan. Serveren validerer hvert par efter samme regler som
  // enkelt-POST'en og rapporterer de sprungne i `skipped`.
  const createPeaksBulk = useCallback((pairs) =>
    mutate("/bulk", "POST", { plans: (pairs || []).map((p) => ({ rider_id: p.riderId, target_race_id: p.raceId })) }), [mutate]);

  return {
    enabled, ...board, loading, error, busy,
    refresh, createPeak, retargetPeak, deletePeak, acceptTraining,
    acceptSuggestion, dismissSuggestions, createPeaksBulk,
  };
}
