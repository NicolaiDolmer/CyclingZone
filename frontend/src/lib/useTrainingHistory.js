// useTrainingHistory — træningsrapport-historik (#1533).
//
// Henter de seneste ~30 dages daglige trænings-kørsler for det indloggede holds
// EGNE ryttere direkte fra training_day_runs (RLS: SELECT kun for holdets ejer,
// indeks på (team_id, tick_date DESC)). Ingen ny datamodel — al historik er
// allerede persisteret af daily-training-engine (én report JSONB pr. dag).
//
// Spejler useTraining-formen (loading + refresh), men er en ren SELECT-hook uden
// mutationer. Bruges af TrainingPage (historik-liste) + rytterprofilen
// (per-rytter-udsnit via riderHistoryFromRuns).

import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";
import { getAuthedUser } from "./getAuthedUser.js";
import { copenhagenDayKey } from "./raceCentre.js";
import { seasonReceiptState, seasonReceiptView, SEASON_RECEIPT_UNKNOWN } from "./trainingReport.js";

// Vinduet historikken dækker (dage tilbage). Matcher idx_training_day_runs_team_date.
export const HISTORY_DAYS = 30;

// Dansk ISO-dato (YYYY-MM-DD) for "nu minus N dage". tick_date er en DATE-kolonne,
// så vi sammenligner mod en ren dato-streng (ingen klokkeslæt).
function sinceDate(days, now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// #4293: kvitteringens tilstand, klar til at sættes. Datoen udledes på
// KALENDERDAGS-aksen (Europe/Copenhagen, samme akse som tick_date, jf.
// docs/CALENDAR_RULES.md §0) — ikke browserens og ikke UTC's: 2026-08-27T22:00Z
// ER 28/8 kl. 00:00 i København, så en UTC-baseret "i dag" ville vise sæsonen
// som ikke-begyndt de første to timer af dens egen første dag.
//
// copenhagenDayKey kaster aldrig (kontrakt + test i raceCentre.js: en zone
// runtime'en ikke kender giver null, ikke RangeError), så et opslag her kan
// ikke rive resten af refresh() med sig. Fallbacken er UTC-dagen, samme kilde
// som 30-dages-vinduet.
//
//   seasonRuns : sæsonens hentede dage, eller null når hentningen fejlede
function receiptState(activeStart, seasonRuns) {
  const today = copenhagenDayKey(Date.now()) ?? sinceDate(0);
  return seasonReceiptView(seasonReceiptState(activeStart, today), seasonRuns);
}

export function useTrainingHistory() {
  const [runs, setRuns] = useState([]);     // [{ tick_date, executed_by, bonus_applied, report }] — seneste 30 dage
  const [seasonRuns, setSeasonRuns] = useState([]); // samme form, men kun dage i den AKTIVE sæson (#3709 trin 1)
  const [seasonStart, setSeasonStart] = useState(null); // "YYYY-MM-DD" | null
  // #4293: "unknown" | "notStarted" | "noDays" | "running" — se
  // seasonReceiptState + seasonReceiptView. En sæson kan være `active` med en
  // start_date i FREMTIDEN (interregnum mellem to sæsoner), og en kørende sæson
  // kan endnu ikke have en eneste træningsdag. Ingen af de to tilstande fandtes
  // før: begge blev vist som et målt "+0".
  const [seasonState, setSeasonState] = useState(SEASON_RECEIPT_UNKNOWN);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const user = await getAuthedUser();
      if (!user) { setRuns([]); setSeasonRuns([]); setSeasonState(SEASON_RECEIPT_UNKNOWN); return; }
      const { data: myTeam } = await supabase
        .from("teams")
        .select("id")
        .eq("user_id", user.id)
        .single();
      if (!myTeam) { setRuns([]); setSeasonRuns([]); setSeasonState(SEASON_RECEIPT_UNKNOWN); return; }

      // #3709 trin 1: kvitteringens enhed er point pr. SÆSON, så vinduet skal
      // kende sæsonstarten. Sæson 1 kørte 34 dage (22/6 til 26/7, målt 14/8), så
      // 30-dages-vinduet kan i sig selv være kortere end sæsonen. Vi henter
      // derfor fra det TIDLIGSTE af de to datoer og deler resultatet bagefter,
      // så `runs` beholder sin 30-dages-kontrakt (TrainingHistory + profilens
      // 30-dages-trend siger begge "30 dage") mens `seasonRuns` er sæsonen.
      const { data: season, error: seasonError } = await supabase
        .from("seasons")
        .select("start_date")
        .eq("status", "active")
        .maybeSingle();
      // En manglende/fejlende sæson må ikke fabrikere et sæsontal: seasonStart
      // bliver null, seasonAbilityGains returnerer null, og fladen viser en
      // afventende tilstand i stedet for et opfundet "+0".
      const activeStart = !seasonError && season?.start_date ? String(season.start_date) : null;
      setSeasonStart(activeStart);

      const windowStart = sinceDate(HISTORY_DAYS);
      const since = activeStart && activeStart < windowStart ? activeStart : windowStart;

      // RLS begrænser allerede til egne hold; team_id-filteret holder query'et
      // på det aktive hold (samme indeks (team_id, tick_date DESC)).
      const { data, error } = await supabase
        .from("training_day_runs")
        .select("tick_date, executed_by, bonus_applied, report")
        .eq("team_id", myTeam.id)
        .gte("tick_date", since)
        .order("tick_date", { ascending: false });
      if (!error) {
        const rows = data ?? [];
        const seasonRows = activeStart ? rows.filter((r) => String(r.tick_date) >= activeStart) : [];
        setRuns(rows.filter((r) => String(r.tick_date) >= windowStart));
        setSeasonRuns(seasonRows);
        // Tilstanden afgøres FØRST her, EFTER at dagene er sat: en kørende
        // sæson uden en eneste træningsdag (sæsonens første morgen, før dagens
        // tick) er ikke et målt "+0", men en sæson der lige er begyndt. Se
        // seasonReceiptView.
        setSeasonState(receiptState(activeStart, seasonRows));
      } else {
        // Fejlet hentning: vi ved intet om sæsonens dage, så tilstanden må ikke
        // blive til et nul. receiptState(…, null) falder til "unknown" for en
        // kørende sæson og lader "notStarted" stå (den er ren dato).
        setSeasonState(receiptState(activeStart, null));
      }
    } catch {
      /* netværk — behold tidligere state */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { runs, seasonRuns, seasonStart, seasonState, loading, refresh };
}
