import { timeoutSignal } from "../lib/timeoutSignal.ts";
import { supabase } from "../lib/supabase";
import { buildRaceCentreCards, copenhagenDayRange } from "../lib/raceCentre.js";
import {
  computeStageRaceStanding,
  entryCountFor,
  mergeStandingRowsByRace,
  todayStageWinner,
  carryKnownProfiles,
} from "../lib/dashboardTodayStages.js";
import { planRaceResultQueries } from "../lib/raceWinnerResultType.ts";

const TODAY_PROFILE_BASE_COLUMNS = "race_id, stage_number, profile_type, distance_km, elevation_gain_m, climbs, sectors";
// pagination-safe: filtreret paa MINE dagens race_id'er, hoejst en raekke pr. etape.
// elevation_profile staar endnu ikke i de genererede typer, derfor any-cast.
// #8152: profilen er valgfri og afventes sammen med vinder og tilmeldte, saa
// bibliotekets egne gentagelser ved 503 maa ikke forsinke dem. Kun dette opslag.
const readTodayProfiles = (cols, raceIds, signal) => /** @type {any} */ (supabase)
  .from("race_stage_profiles").select(cols).in("race_id", raceIds).abortSignal(signal).retry(false);
const TODAY_PROFILE_COLUMNS = `${TODAY_PROFILE_BASE_COLUMNS}, elevation_profile`;

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
// Afgrænsede forespørgsler, alle scoped til DAGENS EGNE løb (målt 23/9: højst
// 3 egne løb / 5 egne etaper pr. hold). Rækketallet er IKKE 0-2 pr. tabel —
// fx giver placerings-forespørgslen et helt felt — så hver forespørgsel
// dokumenterer sin egen grænse nedenfor. Samme forsigtighed som
// RaceCentrePage.jsx.
// #6494: the reader below is owned by the Query resource in data/todayStagesData.ts
// (key per viewer/team, minute refetch while mounted, cancellation on scope change).
// `publish` shows the presence decision (cards without enrichment) before the optional
// result enrichment finishes; `previousCards` is the cached strip, so known profiles,
// standings and winners survive a refresh. A failed read never throws: the strip fails
// quietly on the UI and keeps the cards it has.
/**
 * @param {{ teamId: string, signal: AbortSignal, previousCards: Array<any>, publish: (state: { loading: boolean, cards: Array<any> }) => void }} input
 * @returns {Promise<{ loading: boolean, cards: Array<any> }>}
 */
export async function readTodayStages({ teamId, signal: parentSignal, previousCards, publish }) {
    let request;
    let latest = { loading: true, cards: previousCards };
    const setState = (next) => {
      latest = typeof next === "function" ? next(latest) : next;
      if (!latest.loading) publish(latest);
    };
    const abortWithParent = () => request?.abort();
    parentSignal.addEventListener("abort", abortWithParent, { once: true });
    try {
      request = timeoutSignal(8000);
      if (parentSignal.aborted) request.abort();
      const { signal } = request;
      const now = Date.now();
      const range = copenhagenDayRange(now);
      if (!range) return { loading: false, cards: [] };

      // 1) Dagens etape-slots på tværs af HELE spillet. Afgrænset på
      // scheduled_at → lille resultatsæt.
      // pagination-safe: afgrænset til ét døgns scheduled_at-vindue, samme
      // bound som RaceCentrePage.jsx (~10-20 rækker/dag på tværs af spillet).
      const { data: slotRows, error: slotError } = await supabase
        .from("race_stage_schedule")
        .select("race_id, stage_number, scheduled_at")
        .gte("scheduled_at", new Date(range.startMs).toISOString())
        .lt("scheduled_at", new Date(range.endMs).toISOString())
        .order("scheduled_at").abortSignal(signal);
      if (slotError) throw slotError;

      const allRaceIds = [...new Set((slotRows || []).map((r) => r.race_id))];
      if (!allRaceIds.length) return { loading: false, cards: [] };

      // 2) Hvilke af dagens løb er MINE? pagination-safe: dobbelt afgrænset —
      // ét hold (RLS-scoped team_id) OG kun dagens race_id'er (to cifre).
      const { data: entryRows, error: entryError } = await supabase
        .from("race_entries").select("race_id")
        .eq("team_id", teamId).in("race_id", allRaceIds).abortSignal(signal);
      if (entryError) throw entryError;
      const enteredRaceIds = new Set((entryRows || []).map((e) => e.race_id));
      const ownRaceIds = allRaceIds.filter((id) => enteredRaceIds.has(id));
      if (!ownRaceIds.length) return { loading: false, cards: [] };
      const ownSlotRows = (slotRows || []).filter((r) => enteredRaceIds.has(r.race_id));

      // Profiles and result enrichment cannot delay the presence decision.
      const profilesPromise = (async () => {
        const first = await readTodayProfiles(TODAY_PROFILE_COLUMNS, ownRaceIds, signal);
        return first.error?.code === "42703"
          ? readTodayProfiles(TODAY_PROFILE_BASE_COLUMNS, ownRaceIds, signal) : first;
      })().catch(error => ({ data: null, error }));
      const racesRes = await supabase.from("races")
        .select("id, name, race_type, stages, stages_completed, status")
        .in("id", ownRaceIds).abortSignal(signal);
      if (racesRes.error) throw racesRes.error;

      const raceById = new Map((racesRes.data || []).map((r) => [r.id, r]));
      // #2230: decide whether a strip exists before fetching optional result
      // enrichment. An empty strip must not wait for winner/standing queries.
      const slots = ownSlotRows
        .map((row) => {
          const race = raceById.get(row.race_id);
          if (!race) return null;
          return {
            raceId: race.id,
            raceName: race.name,
            raceType: race.race_type,
            isStageRace: race.race_type === "stage_race",
            stageNumber: row.stage_number,
            totalStages: race.stages ?? 1,
            stagesCompleted: race.stages_completed ?? 0,
            scheduledMs: Date.parse(row.scheduled_at),
            profileType: null,
            // #3958: den FULDE profil-række, så miniaturen kan tegne StageProfileGraph
            // (ægte rutedata) i stedet for kun at kende profile_type.
            profile: null,
          };
        })
        .filter(Boolean);

      // Genbruger Race Centres tilstandsmaskine (scheduled/live/finished) i
      // stedet for en parallel afledning — se lib/raceCentre.js.
      const built = buildRaceCentreCards(slots, { nowMs: now });
      if (!built.length) return { loading: false, cards: [] };
      setState(previous => ({ loading: false, cards: built.map(card => {
        const known = previous.cards.find(c => c.raceId === card.raceId && c.stageNumber === card.stageNumber);
        const enriching = !known || known.state !== card.state || known.stagesCompleted !== card.stagesCompleted;
        return { ...known, ...card, profile: known?.profile ?? null, profileType: known?.profileType ?? null,
          standing: enriching ? null : known.standing, winnerName: enriching ? null : known.winnerName, enriching };
      }) }));

      // 2a) Vinderen af hver af MINE etaper i dag (#5589/#5601). Etapeløb
      // står under result_type 'stage' på etapens nummer, endagsløb under
      // 'gc' på stage_number 1 (motoren skriver aldrig 'stage' for endagsløb,
      // så et rent 'stage'-filter viste "No results" på alle 380 afsluttede
      // endagskort 23/9). planRaceResultQueries deler dagens egne etaper op i
      // højst to grupper, så et etapeløbs samlede 'gc'-vinder på sidste etape
      // aldrig hentes som etapevinder.
      const winnerGroups = planRaceResultQueries(
        ownSlotRows
          .filter((row) => raceById.has(row.race_id))
          .map((row) => ({
            raceId: row.race_id,
            raceType: raceById.get(row.race_id).race_type,
            stageNumber: row.stage_number,
          }))
      );
      const winnerPromise = Promise.all(
        winnerGroups.map((group) =>
          // Målt 23/9: den gamle, ubegrænsede forespørgsel ramte PostgREST's
          // 1.000-rækkers-loft for 92 af dagens 254 hold, så 69 hold manglede
          // vinderen på 205 kort (#5589).
          // pagination-safe: vinder-forespørgslen — MINE dagens race_id'er for
          // én løbstype × deres etapenumre × rank 1: højst én række pr. egen
          // etape i dag (#5589/#5601).
          supabase.from("race_results")
            .select("race_id, stage_number, result_type, rank, rider_name")
            .in("race_id", group.raceIds)
            .in("stage_number", group.stageNumbers)
            .eq("result_type", group.resultType)
            .eq("rank", 1).abortSignal(signal)
        )
      );

      // 2b) Samlet placering pr. EGET etapeløb med stages_completed > 0 — én
      // forespørgsel PR løb (ikke én fælles for alle løb), afgrænset til det
      // ene løb OG dets aktuelle etape. stages_completed skrives i samme
      // transaktion som resultatrækkerne (raceRunner.js:2999-3034); prod
      // 23/9: 13/13 kørende og 185/185 afsluttede løb stemmer. Hver
      // forespørgsel returnerer højst feltets størrelse (ryttere/hold),
      // langt under 1000, uanset hvor mange etaper løbet har kørt i alt (#5589).
      const standingRaces = (racesRes.data || []).filter(
        (r) => r.race_type === "stage_race" && (r.stages_completed ?? 0) > 0
      );
      // Vinder- og placerings-forespørgslerne afventes samlet, så vinder-
      // opslaget ikke lægger en ekstra runde oven i hentningen.
      const [profilesRes, winnerResults, standingResults] = await Promise.all([
        profilesPromise,
        winnerPromise,
        Promise.all(
          standingRaces.map((race) =>
            // pagination-safe: afgrænset til ÉT løb OG dets aktuelle etape
            // (stages_completed) — feltstørrelse (ryttere/hold), langt under
            // 1000, uafhængigt af hvor mange etaper løbet har kørt i alt (#5589).
            supabase.from("race_results")
              .select("race_id, stage_number, result_type, rank, team_id, finish_time")
              .eq("race_id", race.id)
              .eq("stage_number", race.stages_completed)
              .in("result_type", ["leader", "team_day", "team"]).abortSignal(signal)
          )
        ),
      ]);
      const profileByKey = new Map((profilesRes.data || []).map((p) => [`${p.race_id}:${p.stage_number}`, p]));
      for (const res of winnerResults) if (res.error) throw res.error;
      for (const res of standingResults) if (res.error) throw res.error;
      const winnerRows = winnerResults.flatMap((res) => res.data || []);
      const standingRowsByRace = mergeStandingRowsByRace(standingRaces, standingResults);

      // 3) "antal ryttere tilmeldt" for endagsløb — ALLE holds entries (ikke
      // kun mine). pagination-safe: afgrænset til MINE dagens endagsløb (0-2).
      const oneDayRaceIds = [...new Set(built.filter((c) => !c.isStageRace).map((c) => c.raceId))];
      let entryRowsAll = [];
      if (oneDayRaceIds.length) {
        const { data, error } = await supabase.from("race_entries")
          .select("race_id").in("race_id", oneDayRaceIds).abortSignal(signal);
        if (error) throw error;
        entryRowsAll = data || [];
      }

      const cards = built.map((c) => {
        const standingRows = standingRowsByRace.get(c.raceId) || [];
        return {
          ...c,
          profile: profileByKey.get(`${c.raceId}:${c.stageNumber}`) || null,
          profileType: profileByKey.get(`${c.raceId}:${c.stageNumber}`)?.profile_type || null,
          standing: c.isStageRace ? computeStageRaceStanding(standingRows, teamId) : null,
          entryCount: c.isStageRace ? null : entryCountFor(entryRowsAll, c.raceId),
          winnerName: c.state === "finished"
            ? todayStageWinner(winnerRows, { raceId: c.raceId, raceType: c.raceType, stageNumber: c.stageNumber })
            : null,
        };
      });

      // #8097: fejlede profil-kaldet, beholdes den kendte profil fra forrige hentning.
      setState((previous) => ({ loading: false, cards: carryKnownProfiles(cards, previous.cards, Boolean(profilesRes.error)) }));
    } catch (e) {
      // Kortet fejler bevidst stille på UI'en (samme idiom som
      // useForumHighlights/useHeroAgonyMoment). console.warn, ikke
      // console.error: e2e-suitens collectBrowserErrors (fixtures.js)
      // eskalerer console.error til hård test-fejl, så en harmløs
      // netværksfejl her gjorde en flaky mobile-webkit-fejl til en falsk
      // rød suite. Refs #4309/#4305.
      if (parentSignal.aborted) throw e;
      console.warn("useTodayStages failed:", e?.message || e);
      latest = { loading: false, cards: latest.cards.map(card => ({ ...card, detailsUnavailable: card.enriching || card.detailsUnavailable, enriching: false })) };
    } finally {
      request?.abort();
      parentSignal.removeEventListener("abort", abortWithParent);
    }
    return { ...latest, loading: false };
}
