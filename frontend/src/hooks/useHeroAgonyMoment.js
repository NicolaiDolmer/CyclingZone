import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { buildHeroAgonyMoment } from "../lib/heroAgonyMoment.js";

// Hero & Agony (#3397) — data-hentning for DIT holds seneste etape-moment-kort.
//
// Arkitektur-valg (dokumenteret i PR-body, jf. issuets "vælg mindste snit"):
// HELT client-side, INGEN nyt backend-endpoint. Tre bounded queries:
//   1) race_results, limit(1), find seneste (race_id, stage_number) MIT hold
//      har en 'stage'-række i — virker for BÅDE et afsluttet løb OG en
//      igangværende etapeløbs seneste kørte etape (i modsætning til
//      /api/dashboard/my-latest-result, som kun dækker HELE løb med
//      status='completed' — et andet, snævrere kontrakt, se dens kommentar
//      i backend/routes/api.js).
//   2) race_stage_moments for netop den (race_id, stage_number) — lille
//      rækkemængde pr. etape, ikke paginerings-behov (samme mønster som
//      RaceDetailPage.jsx's momentsPromise).
//   3) race_results for netop den (race_id, stage_number), ALLE result_type —
//      pagination-safe: bevisligt <1000 rækker for én etapes felt (#3331-audit,
//      samme begrundelse som backend/lib/notificationService.js's
//      defaultFetchStageParticipants).
// Alle tre er authenticated-læsbare via eksisterende RLS (race_results/
// race_stage_moments er public-read for alle authenticated) — ingen nye
// policies nødvendige.
//
// Degraderer ærligt: intet hold, ingen etape-deltagelse, eller en fejl et hvor
// som helst sted → { loading:false, moment:null, ... } — kortet renderer
// intet (samme "ingen død boks"-idiom som MyLatestResultCard/recentResults).
export default function useHeroAgonyMoment(teamId, teamName) {
  const [state, setState] = useState({
    loading: true, moment: null, race: null, stageNumber: null,
  });

  const load = useCallback(async () => {
    if (!teamId) {
      setState({ loading: false, moment: null, race: null, stageNumber: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    try {
      // #1: seneste etape MIT hold har et 'stage'-resultat i. .limit(1) gør
      // forespørgslen bounded (pagineringsvagten kræver limit/single/range på
      // det deny-listede race_results — se scripts/lint-pagination-guard.mjs).
      // Sekundært .order("id") er en ren determinisme-garanti: rækker fra
      // SAMME import-batch deler typisk imported_at til mikrosekundet, men de
      // hører uanset hvilken af dem der returneres til den SAMME (race_id,
      // stage_number) — så determinismen her er et hygiejne-valg, ikke en
      // korrekthedsbetingelse.
      const { data: participation, error: participationError } = await supabase
        .from("race_results")
        .select("race_id, stage_number, imported_at")
        .eq("team_id", teamId)
        .eq("result_type", "stage")
        .order("imported_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1);
      if (participationError) throw participationError;

      const latest = participation?.[0];
      if (!latest) {
        setState({ loading: false, moment: null, race: null, stageNumber: null });
        return;
      }

      const [raceRes, momentsRes, stageRowsRes] = await Promise.all([
        supabase.from("races").select("id, name, race_type, stages").eq("id", latest.race_id).maybeSingle(),
        // pagination-safe: race_id+stage_number-scoped — bounded af den
        // enkelte etapes feltstørrelse, verificeret max 117 rækker/etape
        // prod-audit 1/9 (#4566). IKKE samme shape som RaceDetailPage.jsx's
        // (tidligere) race_id-only momentsPromise, som ramte PostgREST's
        // 1.000-rækkers-loft på et 13-etapes løb — se #4566.
        supabase.from("race_stage_moments")
          .select("id, moment_key, params, significance, rider_ids, team_ids")
          .eq("race_id", latest.race_id)
          .eq("stage_number", latest.stage_number),
        // pagination-safe: one (race_id, stage_number) slice is bounded by that
        // race's field size — verified max 192 rows repo-wide (#3331 audit,
        // 2026-08-05), well under the 1000-row PostgREST cap. Same shape as
        // backend/lib/notificationService.js's defaultFetchStageParticipants.
        supabase.from("race_results")
          .select("result_type, rider_id, rider_name, team_id, rank, in_breakaway, breakaway_caught")
          .eq("race_id", latest.race_id)
          .eq("stage_number", latest.stage_number),
      ]);

      if (momentsRes.error) {
        console.warn("useHeroAgonyMoment: race_stage_moments fetch failed:", momentsRes.error.message);
      }
      if (stageRowsRes.error) throw stageRowsRes.error;

      const moment = buildHeroAgonyMoment({
        moments: momentsRes.data || [],
        stageResultRows: stageRowsRes.data || [],
        myTeamId: teamId,
        myTeamName: teamName ?? null,
      });

      setState({
        loading: false,
        moment,
        race: raceRes.data ?? null,
        stageNumber: latest.stage_number,
      });
    } catch (e) {
      // Kortet fejler bevidst stille på UI'en (samme idiom som
      // useForumHighlights/useTodayStages). console.warn, ikke
      // console.error: e2e-suitens collectBrowserErrors (fixtures.js)
      // eskalerer console.error til hård test-fejl, så en harmløs
      // netværksfejl her gjorde en flaky mobile-webkit-fejl til en falsk
      // rød suite. Refs #4309/#4305.
      console.warn("useHeroAgonyMoment failed:", e?.message || e);
      setState({ loading: false, moment: null, race: null, stageNumber: null });
    }
  }, [teamId, teamName]);

  useEffect(() => { load(); }, [load]);

  return state;
}
