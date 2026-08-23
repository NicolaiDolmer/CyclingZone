import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { buildRaceCentreCards, copenhagenDayRange } from "../lib/raceCentre.js";
import {
  computeStageRaceStanding,
  entryCountFor,
  terrainGlyphBucket,
  todayStageWinner,
} from "../lib/dashboardTodayStages.js";

// #3915 — "Today's stages" dashboard strip: data-hentning for DIT holds
// etaper/løb i dag. SELVSTÆNDIG hook (kun teamId som input), samme
// selv-hentende arkitektur som useHeroAgonyMoment.js (#3397) — Dashboard-
// Page.jsx's diff for dette modul er derfor kun 1 import-linje + 1
// render-linje, uden at røre den eksisterende loadAll().
//
// Genbrug (ingen nyt backend-endpoint, ingen ny data-logik):
//   - Race Centre's egen "dagens etaper"-afledning (lib/raceCentre.js:
//     copenhagenDayRange + buildRaceCentreCards) — samme scheduled/live/
//     finished-tilstandsmaskine som race-centre-siden, ikke en parallel kopi.
//   - lib/dashboardTodayStages.js for de to nye visningsfelter (samlet
//     placering / vindernavn / antal tilmeldte) — alle wrapper omkring
//     allerede eksisterende race_results-afledninger.
//
// Bounded queries, alle scoped til DAGENS EGNE løb (typisk 0-2 rækker pr.
// tabel) — ingen N+1, samme forsigtighed som RaceCentrePage.jsx.
export default function useTodayStages(teamId) {
  const [state, setState] = useState({ loading: true, cards: [] });

  const load = useCallback(async () => {
    if (!teamId) { setState({ loading: false, cards: [] }); return; }
    setState((s) => ({ ...s, loading: true }));
    try {
      const now = Date.now();
      const range = copenhagenDayRange(now);
      if (!range) { setState({ loading: false, cards: [] }); return; }

      // 1) Dagens etape-slots på tværs af HELE spillet. Afgrænset på
      // scheduled_at → lille resultatsæt.
      // pagination-safe: afgrænset til ét døgns scheduled_at-vindue, samme
      // bound som RaceCentrePage.jsx (~10-20 rækker/dag på tværs af spillet).
      const { data: slotRows, error: slotError } = await supabase
        .from("race_stage_schedule")
        .select("race_id, stage_number, scheduled_at")
        .gte("scheduled_at", new Date(range.startMs).toISOString())
        .lt("scheduled_at", new Date(range.endMs).toISOString())
        .order("scheduled_at");
      if (slotError) throw slotError;

      const allRaceIds = [...new Set((slotRows || []).map((r) => r.race_id))];
      if (!allRaceIds.length) { setState({ loading: false, cards: [] }); return; }

      // 2) Hvilke af dagens løb er MINE? pagination-safe: dobbelt afgrænset —
      // ét hold (RLS-scoped team_id) OG kun dagens race_id'er (to cifre).
      const { data: entryRows, error: entryError } = await supabase
        .from("race_entries").select("race_id")
        .eq("team_id", teamId).in("race_id", allRaceIds);
      if (entryError) throw entryError;
      const enteredRaceIds = new Set((entryRows || []).map((e) => e.race_id));
      const ownRaceIds = allRaceIds.filter((id) => enteredRaceIds.has(id));
      if (!ownRaceIds.length) { setState({ loading: false, cards: [] }); return; }
      const ownSlotRows = (slotRows || []).filter((r) => enteredRaceIds.has(r.race_id));

      const [racesRes, profilesRes, resultsRes] = await Promise.all([
        // "races" er ikke deny-listet (ikke i scripts/lint-pagination-guard.mjs).
        supabase.from("races")
          .select("id, name, race_type, stages, stages_completed, status")
          .in("id", ownRaceIds),
        // pagination-safe: afgrænset til MINE dagens race_id'er (0-2 løb).
        // #3958 (ejer-mistanke bekræftet 23/8): tidligere hentede denne query KUN
        // profile_type → miniaturen var et generisk 6-vejrs kategori-piktogram
        // (TerrainGlyph), IKKE etapens ægte rutedata. Nu hentes de samme felter
        // StageProfileGraph/buildProfileSeries bruger overalt ellers, så dashboardets
        // "dagens etaper" viser SAMME rigtige rute som løbssiden (#4107/#4108).
        supabase.from("race_stage_profiles")
          .select("race_id, stage_number, profile_type, distance_km, elevation_gain_m, climbs, sectors")
          .in("race_id", ownRaceIds),
        // pagination-safe: afgrænset til MINE dagens race_id'er (0-2 løb) — hele
        // løbets leader/team/stage-rækker for de par løb er langt under 1000.
        supabase.from("race_results")
          .select("race_id, stage_number, result_type, rank, team_id, rider_name")
          .in("race_id", ownRaceIds)
          .in("result_type", ["leader", "team", "stage"]),
      ]);
      if (racesRes.error) throw racesRes.error;
      if (profilesRes.error) throw profilesRes.error;
      if (resultsRes.error) throw resultsRes.error;

      const raceById = new Map((racesRes.data || []).map((r) => [r.id, r]));
      const profileByKey = new Map(
        (profilesRes.data || []).map((p) => [`${p.race_id}:${p.stage_number}`, p])
      );
      const resultRows = resultsRes.data || [];

      const slots = ownSlotRows
        .map((row) => {
          const race = raceById.get(row.race_id);
          if (!race) return null;
          const profile = profileByKey.get(`${race.id}:${row.stage_number}`) || null;
          return {
            raceId: race.id,
            raceName: race.name,
            isStageRace: race.race_type === "stage_race",
            stageNumber: row.stage_number,
            totalStages: race.stages ?? 1,
            stagesCompleted: race.stages_completed ?? 0,
            scheduledMs: Date.parse(row.scheduled_at),
            profileType: profile?.profile_type || null,
            // #3958: den FULDE profil-række, så miniaturen kan tegne StageProfileGraph
            // (ægte rutedata) i stedet for kun at kende profile_type.
            profile,
          };
        })
        .filter(Boolean);

      // Genbruger Race Centres tilstandsmaskine (scheduled/live/finished) i
      // stedet for en parallel afledning — se lib/raceCentre.js.
      const built = buildRaceCentreCards(slots, { nowMs: now });
      if (!built.length) { setState({ loading: false, cards: [] }); return; }

      // 3) "antal ryttere tilmeldt" for endagsløb — ALLE holds entries (ikke
      // kun mine). pagination-safe: afgrænset til MINE dagens endagsløb (0-2).
      const oneDayRaceIds = [...new Set(built.filter((c) => !c.isStageRace).map((c) => c.raceId))];
      let entryRowsAll = [];
      if (oneDayRaceIds.length) {
        const { data, error } = await supabase.from("race_entries")
          .select("race_id").in("race_id", oneDayRaceIds);
        if (error) throw error;
        entryRowsAll = data || [];
      }

      const cards = built.map((c) => {
        const resultsForRace = resultRows.filter((r) => r.race_id === c.raceId);
        return {
          ...c,
          bucket: terrainGlyphBucket(c.profileType),
          standing: c.isStageRace ? computeStageRaceStanding(resultsForRace, teamId) : null,
          entryCount: c.isStageRace ? null : entryCountFor(entryRowsAll, c.raceId),
          winnerName: c.state === "finished" ? todayStageWinner(resultsForRace, c.raceId, c.stageNumber) : null,
        };
      });

      setState({ loading: false, cards });
    } catch (e) {
      console.error("useTodayStages failed:", e?.message || e);
      setState({ loading: false, cards: [] });
    }
  }, [teamId]);

  useEffect(() => { load(); }, [load]);
  // Minut-tick: samme idiom som RaceCentrePage/DashboardPage — holder
  // scheduled → live → finished-overgangen frisk uden en hård reload.
  useEffect(() => {
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  return state;
}
