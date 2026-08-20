// #3858 (bølge 2 — Race Centre, mockup-kontrakt godkendt 17/8): ÉN kanonisk
// "i dag"-side. Dagens etaper som sendeflade, managerens egne løb først.
//
// Skabelon: T2 wide data (docs/design/PAGE_TEMPLATES.md) — full-bleed cappet på
// 1600px, kanonisk PageHeader, kanoniske section-cards, kanoniske loading/empty/
// error-tilstande. Ingen nye sidehoveder, bredder eller state-markup.
//
// DATA (ingen nye endpoints, ingen migration):
//   1. race_stage_schedule afgrænset til DAGENS scheduled_at-vindue — det er den
//      lille, præcise forespørgsel (dagens slots på tværs af hele spillet er
//      titalsstørrelse, ikke tusinder), i modsætning til "alle etaper for alle
//      løb" som ville ramme PostgREST's 1000-rækkers-loft (#3331).
//   2. races + league_divisions for de fundne race_id'er (navn, fremdrift, pulje).
//   3. race_entries (kun dagens løb) → hvilke løb er MINE.
//   4. race_results for dagens KØRTE etaper → top-3 + egen bedste.
//   5. Én tidslinje pr. LIVE-etape (useStageTimeline via LiveFilmLine) → film-
//      linjen. 404 = ingen tidslinje endnu (S3-forward-only) → kortet viser den
//      ærlige "etapen kører"-linje i stedet for en opfundet.
//
// LIVE er deterministisk afspilning (scheduled_at + forløbet tid), ikke realtime
// — issue-kontrakten forbyder websockets i v1. Et minut-tick driver både
// nedtælling og afspilnings-position.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import {
  Button,
  PageHeader,
  PageLoader,
  SectionHeader,
  EmptyState,
  ErrorState,
  CalendarIcon,
} from "../components/ui";
import RaceCentreCard from "../components/race/RaceCentreCard.jsx";
import { useStageTimeline } from "../hooks/useStageTimeline.js";
import { useRiderNames } from "../hooks/useRiderNames.js";
import { collectRiderIds, describeEvent } from "../lib/stageTimelineFilm.js";
import { RACE_TIMEZONE, formatCountdown } from "../lib/stageScheduleConfig.js";
import { isSquadSelectionMissing } from "../lib/raceSquadSelectionStatus.js";
import {
  buildRaceCentreCards,
  copenhagenDayRange,
  latestFilmEvent,
  ownBestResult,
  playbackKm,
  stagePodium,
} from "../lib/raceCentre.js";

const API = import.meta.env.VITE_API_URL;

// Etape-distance er ikke altid kendt (endagsløb uden profil-række). Uden en
// distance kan afspilningen stadig køre — vi normaliserer bare mod 100 "km",
// hvilket giver samme lineære fremdrift på meteret. Film-linjen kræver derimod
// en ÆGTE distance, ellers ville km-mærkerne blive sammenlignet mod en opfundet
// skala; derfor bruger LiveFilmLine tidslinjens egen finish-km.
const FALLBACK_PROGRESS_SCALE = 100;

// Film-linjen for ét LIVE-kort. Egen komponent fordi useStageTimeline er en hook
// (ét kald pr. etape) — de fleste dage er der 0-2 live-kort ad gangen.
function LiveFilmLine({ card, nowMs, riderNameById, children }) {
  const { timeline } = useStageTimeline(card.raceId, card.stageNumber);
  const events = timeline?.events;
  // #4026: podie-mappet (riderNameById-prop) dækker kun dagens FÆRDIGE etapers
  // top-3 — live-tidslinjens udbrydere/angribere findes typisk ikke dér, og
  // describeEvent viser aldrig rå id'er. Hent derfor navnene for præcis de
  // rider-ids tidslinjen refererer, og merge (tidslinje-opslag vinder intet
  // over podiet — samme navn begge steder, podiet er blot et subset).
  const timelineRiderIds = useMemo(() => collectRiderIds(events), [events]);
  const timelineNames = useRiderNames(timelineRiderIds);
  const mergedNames = useMemo(
    () => new Map([...timelineNames, ...(riderNameById || new Map())]),
    [timelineNames, riderNameById],
  );
  const finishKm = Array.isArray(events)
    ? events.reduce((max, e) => (Number.isFinite(e?.km) && e.km > max ? e.km : max), 0)
    : 0;
  const km = playbackKm({
    scheduledMs: card.scheduledMs,
    nowMs,
    distanceKm: finishKm || FALLBACK_PROGRESS_SCALE,
  });
  const event = finishKm ? latestFilmEvent(events, km) : null;
  const described = event ? describeEvent(event, { riderNameById: mergedNames }) : null;
  return children(described ? { ...described, km: event.km } : null);
}

export default function RaceCentrePage() {
  // races-namespacet bærer løbs-taksonomien OG film-event-teksterne (#3859),
  // som Race Centre genbruger ordret — ingen parallel oversættelse.
  const { t } = useTranslation("races");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [team, setTeam] = useState(null);
  const [cards, setCards] = useState([]);
  const [resultsBySlot, setResultsBySlot] = useState(() => new Map());
  // Map, ikke objekt: describeEvent/riderName (stageTimelineFilm.js) slår op med
  // `.get(id)` — samme kontrakt som RaceDetailPage giver StoryOfTheStageSection.
  const [riderNameById, setRiderNameById] = useState(() => new Map());
  const [selectionByRace, setSelectionByRace] = useState(() => ({}));
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) { setLoading(false); return; }

      const { data: teamData } = await supabase
        .from("teams").select("id, name, league_division_id").eq("user_id", user.id).single();
      setTeam(teamData || null);

      const now = Date.now();
      const range = copenhagenDayRange(now);
      if (!range) { setCards([]); setLoading(false); return; }

      // 1) Dagens etape-slots. Afgrænset på scheduled_at → lille resultatsæt.
      // pagination-safe: afgrænset til ét døgns scheduled_at-vindue. Hele spillet
      // afvikler ~10-20 etaper pr. dag (S2 = 1.148 etapedage over en sæson), så
      // rækketallet er to cifre, langt under PostgREST's 1000-loft.
      const { data: slotRows, error: slotError } = await supabase
        .from("race_stage_schedule")
        .select("race_id, stage_number, scheduled_at")
        .gte("scheduled_at", new Date(range.startMs).toISOString())
        .lt("scheduled_at", new Date(range.endMs).toISOString())
        .order("scheduled_at");
      if (slotError) throw slotError;

      const raceIds = [...new Set((slotRows || []).map((r) => r.race_id))];
      if (!raceIds.length) { setCards([]); setLoading(false); return; }

      // 2) Løbene bag slottene + puljeetiketter.
      const [racesRes, divisionsRes, entriesRes] = await Promise.all([
        supabase.from("races")
          .select("id, name, stages, stages_completed, status, race_type, league_division_id")
          .in("id", raceIds),
        supabase.from("league_divisions").select("id, tier, pool_index, label"),
        teamData?.id
          // pagination-safe: dobbelt afgrænset — ét hold (RLS-scoped team_id) OG
          // kun dagens løb (raceIds, to cifre). Højst dagens løb × løbstruppens
          // størrelse rækker.
          ? supabase.from("race_entries").select("race_id").eq("team_id", teamData.id).in("race_id", raceIds)
          : Promise.resolve({ data: [] }),
      ]);

      const raceById = new Map((racesRes.data || []).map((r) => [r.id, r]));
      const divisionById = new Map((divisionsRes.data || []).map((d) => [d.id, d]));
      const ownRaceIds = new Set((entriesRes.data || []).map((e) => e.race_id));

      const slots = (slotRows || [])
        .map((row) => {
          const race = raceById.get(row.race_id);
          if (!race) return null;
          const division = divisionById.get(race.league_division_id);
          return {
            raceId: race.id,
            raceName: race.name,
            stageNumber: row.stage_number,
            totalStages: race.stages ?? 1,
            stagesCompleted: race.stages_completed ?? 0,
            scheduledMs: Date.parse(row.scheduled_at),
            isOwn: ownRaceIds.has(race.id),
            divisionLabel: division
              ? (division.label || t("raceCentre.divisionLabel", { tier: division.tier, pool: (division.pool_index ?? 0) + 1 }))
              : null,
            stageLabel: (race.stages ?? 1) > 1
              ? t("raceCentre.stageLabel", { number: row.stage_number, total: race.stages })
              : t("raceCentre.oneDayLabel"),
          };
        })
        .filter(Boolean);

      const built = buildRaceCentreCards(slots, { nowMs: now });
      setCards(built);

      // 3) Resultater for dagens KØRTE etaper (live-i-vindue + færdige). Dobbelt
      // afgrænset (dagens løb × dagens etapenumre), så PostgREST-loftet aldrig
      // er i spil.
      const settled = built.filter((c) => c.state !== "upcoming" && c.stagesCompleted >= c.stageNumber);
      if (settled.length) {
        // pagination-safe: tredobbelt afgrænset — dagens løb × dagens etapenumre
        // × rank <= 3. Maks 3 rækker pr. kort, og kortene er dagens etaper.
        const { data: resultRows } = await supabase
          .from("race_results")
          .select("race_id, stage_number, result_type, rank, rider_id, rider_name, team_id")
          .in("race_id", [...new Set(settled.map((c) => c.raceId))])
          .in("stage_number", [...new Set(settled.map((c) => c.stageNumber))])
          .eq("result_type", "stage")
          .lte("rank", 3);
        const map = new Map();
        for (const row of resultRows || []) {
          const key = `${row.race_id}:${row.stage_number}`;
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(row);
        }
        setResultsBySlot(map);
        setRiderNameById(new Map((resultRows || []).map((r) => [r.rider_id, r.rider_name])));
      } else {
        setResultsBySlot(new Map());
        setRiderNameById(new Map());
      }

      // 4) Opstillings-status for egne KOMMENDE løb (samme kontrakt som
      // løbssidens RaceSelectionPanel — ingen parallel tælling, #3042).
      const token = session?.access_token;
      const upcomingOwn = built.filter((c) => c.state === "upcoming" && c.isOwn);
      if (token && upcomingOwn.length) {
        const entries = await Promise.all(upcomingOwn.map(async (c) => {
          try {
            const res = await fetch(`${API}/api/races/${c.raceId}/selection`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return null;
            const body = await res.json();
            if (!body || body.enabled === false || !Number.isFinite(body.size?.max)) return null;
            return [c.raceId, {
              selected: body.selection?.rider_ids?.length ?? 0,
              max: body.size.max,
              complete: !isSquadSelectionMissing(body),
            }];
          } catch { return null; }
        }));
        setSelectionByRace(Object.fromEntries(entries.filter(Boolean)));
      } else {
        setSelectionByRace({});
      }
    } catch (e) {
      console.error("Race Centre load failed:", e);
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  // Et minut-tick driver nedtælling + afspilnings-position. Sekunder er bevidst
  // udeladt (samme idiom som "Kommende løb"-kortet).
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const ownCards = cards.filter((c) => c.isOwn);
  const otherCards = cards.filter((c) => !c.isOwn);

  function renderCard(card) {
    const key = `${card.raceId}:${card.stageNumber}`;
    const rows = resultsBySlot.get(key) || [];
    const podium = stagePodium(rows, { ownTeamId: team?.id });
    const best = ownBestResult(rows, team?.id);
    const selection = selectionByRace[card.raceId] || null;
    const playbackPercent = Math.round(
      (playbackKm({
        scheduledMs: card.scheduledMs,
        nowMs,
        distanceKm: FALLBACK_PROGRESS_SCALE,
      }) / FALLBACK_PROGRESS_SCALE) * 100,
    );
    const common = {
      card,
      t,
      timeZone: RACE_TIMEZONE,
      playbackPercent,
      countdownLabel: formatCountdown(card.scheduledMs, nowMs, t),
      selection,
      podium,
      ownBest: best,
      hasFilm: card.state === "finished" && podium.length > 0,
    };
    if (card.state !== "live") return <RaceCentreCard key={key} {...common} />;
    return (
      <LiveFilmLine key={key} card={card} nowMs={nowMs} riderNameById={riderNameById}>
        {(filmLine) => <RaceCentreCard {...common} filmLine={filmLine} />}
      </LiveFilmLine>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] pb-16">
      <PageHeader
        title={t("raceCentre.title")}
        subtitle={t("raceCentre.subtitle")}
      />

      {/* Kortene ER sektionens indhold (samme mønster som resultathubbens
          "Seneste"-grid) — de stakker ikke inde i endnu et card. */}
      <SectionHeader title={t("raceCentre.yours.title")} />
      {loading ? (
        <PageLoader />
      ) : error ? (
        <ErrorState
          title={t("raceCentre.error.title")}
          description={t("raceCentre.error.body")}
          action={(
            <Button size="sm" variant="secondary" onClick={load}>
              {t("raceCentre.error.retry")}
            </Button>
          )}
        />
      ) : ownCards.length ? (
        <div className="grid gap-[14px] md:grid-cols-2 xl:grid-cols-3">
          {ownCards.map(renderCard)}
        </div>
      ) : (
        <EmptyState
          icon={<CalendarIcon size={26} aria-hidden="true" />}
          title={t("raceCentre.yours.emptyTitle")}
          description={t("raceCentre.yours.emptyBody")}
        />
      )}

      {/* "Around the divisions" — presse-lagets indgang. Kontrakten kræver den
          ikke i v1, men dataen er allerede hentet (dagens slots på tværs af
          spillet), så striben koster ét filter og ingen ekstra forespørgsel. */}
      {!loading && !error && otherCards.length > 0 && (
        <div className="mt-8">
          <SectionHeader title={t("raceCentre.divisions.title")} />
          <div className="grid gap-[14px] md:grid-cols-2 xl:grid-cols-3">
            {otherCards.map(renderCard)}
          </div>
        </div>
      )}
    </div>
  );
}
