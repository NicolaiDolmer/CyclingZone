import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { authHeaders } from "../lib/supabase"; // #4348: kanonisk kopi
import { reportLoadFailure } from "../lib/actionTelemetry.js";
import { PageLoader, EmptyState, ErrorState, Button, Select, Checkbox, Modal, CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "../components/ui";
import TerrainCodeGlyph from "../components/race/TerrainCodeGlyph";
import { densityForDivision } from "../lib/calendarTierDensity";
import {
  buildMonthGrid,
  expandStageEvents,
  filterStageEvents,
  groupStageEventsByDate,
  monthsWithRaces,
  stepMonth,
} from "../lib/calendarGrid.js";

const API = import.meta.env.VITE_API_URL;

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
// #2605: brosten har sin egen legend-post + glyf mellem sprint og hilly (spillerønske
// — brosten var tidligere umuligt at skelne fra en flad sprint-etape i kalenderen).
const LEGEND_BUCKETS = ["sprint", "cobbles", "hilly", "mountain", "itt", "ttt"];
const TABS = ["mine", "all", "divisions"];
// #4386: cellens loft var hardcodet til 4 uanset division, selvom D1 kører
// 5,0 etaper/løbsdag i snit (målt 29/8) — "+N more" var derfor dagligdags for
// D1-spillere. Loftet er nu divisionens egen density (TIER_DENSITY,
// docs/CALENDAR_RULES.md §1). Mobilens visning er UÆNDRET ved 3: cellen deler
// ikke plads med resten af siden på desktop, men på 375px er hver ekstra
// række en tabet skærm-højde, og "+N more" åbner allerede dagens FULDE
// program i modalen — loftet er en læsbarheds-afvejning, ikke skjult data.
const MOBILE_DAY_CAP = 3;

// Today in Europe/Copenhagen as "YYYY-MM-DD" — used to highlight the current day cell
// independent of the engine (the calendar is a read view, today is always "now").
function copenhagenTodayISO() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}


export default function CalendarPage() {
  const { t, i18n } = useTranslation(["calendar", "common"]);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  // #2849 bølge 3: kanonisk fejl-tilstand (states-sheet manglede en ÷ pr. audit'en).
  // #4165: var et boolean sat KUN fra catch'en, og hentningen tjekkede ikke
  // res.ok. Et 401 fra requireAuth har en gyldig JSON-krop, så res.json() lykkes,
  // `data` bliver {error:"Invalid token"}, og `!data?.season` tegnede så
  // tom-tilstanden "Ingen aktiv sæson" - en fejlet hentning der påstår noget
  // konkret og forkert om spillet. Nu bærer den en kind som de øvrige hub-flader.
  // { kind: "auth" | "http" | "parse" | "network", status? } | null
  const [loadError, setLoadError] = useState(null);
  const [retryTick, setRetryTick] = useState(0);
  // #4165: sæson-vælgeren skal OVERLEVE en fejlet hentning (samme grund som
  // SeasonView holder seasonsMeta uden for svaret). Uden den er fejl-fladen en
  // blindgyde: "Prøv igen" henter præcis den sæson der lige fejlede, og der er
  // ingen vej til en anden.
  const [seasonsMeta, setSeasonsMeta] = useState(null); // { availableSeasons } | null
  const [tab, setTab] = useState("mine");
  const [division, setDivision] = useState(null); // null = all divisions
  // #2756: pulje/gruppe-vælger inden for en division ("Division 2 A") — spillere
  // kunne før kun scoute en HEL tier, ikke en enkelt gruppe (Discord-feedback,
  // thelamba 20/7+19/7: "I couldn't select 'Division 2 A' calendar"). null = alle
  // puljer i den valgte tier. Nulstilles hver gang division skifter (changeDivision).
  const [pool, setPool] = useState(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [cursor, setCursor] = useState(null); // { year, month }
  // #2756: dagen der er foldet ud i "+N more"-modalen. null = lukket.
  const [expandedDayIso, setExpandedDayIso] = useState(null);
  // #2449: sæson-vælger (S1/S2/...) — null = ingen eksplicit valg endnu (backend
  // defaulter til den aktive sæson, uændret adfærd for gamle klienter).
  const [seasonNumber, setSeasonNumber] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!API) { setLoading(false); return; }
      setLoading(true);
      setLoadError(null);
      const headers = await authHeaders();
      if (!headers) {
        reportLoadFailure("calendar_page", { kind: "auth" });
        if (alive) { setData(null); setLoadError({ kind: "auth" }); setLoading(false); }
        return;
      }
      try {
        const qs = seasonNumber != null ? `?season_number=${seasonNumber}` : "";
        const res = await fetch(`${API}/api/races/calendar${qs}`, { headers });
        if (!res.ok) {
          // Krop-koden kommer med i telemetrien, ikke på skærmen.
          const body = await res.json().catch(() => ({}));
          reportLoadFailure("calendar_page", { kind: "http", status: res.status, reason: body?.error });
          if (alive) { setData(null); setLoadError({ kind: "http", status: res.status }); }
          return;
        }
        // Egen gren for parsningen - ellers tagges en malformet 200-krop som
        // "network" og peger triagen mod spillerens forbindelse.
        let json;
        try {
          json = await res.json();
        } catch (cause) {
          reportLoadFailure("calendar_page", { kind: "parse", status: res.status, cause });
          if (alive) { setData(null); setLoadError({ kind: "parse", status: res.status }); }
          return;
        }
        if (!alive) return;
        setData(json);
        setSeasonsMeta({ availableSeasons: json.availableSeasons || [] });
        // Default the division selector to the player's own division (tier).
        const ownTier = ownDivisionTier(json);
        if (ownTier != null) setDivision(ownTier);
        // Land on the first month that has races (most of the 60 days are empty).
        const months = monthsWithRaces(json.entries || []);
        const todayYM = copenhagenTodayISO().slice(0, 7);
        const monthForToday = months.find((m) => `${m.year}-${String(m.month).padStart(2, "0")}` === todayYM);
        setCursor(monthForToday || months[0] || ymOfToday());
      } catch (cause) {
        reportLoadFailure("calendar_page", { kind: "network", cause });
        if (alive) { setData(null); setLoadError({ kind: "network" }); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [seasonNumber, retryTick]);

  const retryLoad = () => {
    setLoading(true);
    setLoadError(null);
    setRetryTick((n) => n + 1);
  };

  const todayISO = useMemo(() => copenhagenTodayISO(), []);

  // The active division for filtering: tab "divisions" honours the dropdown; "mine"
  // pins to the player's own division; "all" shows every division.
  const activeDivision = useMemo(() => {
    if (tab === "all") return null;
    if (tab === "mine") return ownDivisionTier(data);
    return division; // "divisions" tab → dropdown value
  }, [tab, division, data]);

  // #2756: pulje-filteret virker kun sammen med en KONKRET division (samme regel
  // som Resultat-hubbens hasPoolSubtabs, #3197) — "Alle divisioner"/"Mit hold"/
  // "Alle hold" har ingen mening at snævre til én gruppe.
  const activePool = tab === "divisions" ? pool : null;

  // Division-vælger: nulstiller ALTID pulje-valget — en pulje fra forrige division
  // giver ikke mening under den nye (samme reset-regel som ResultaterPage #3197).
  function changeDivision(value) {
    setDivision(value === "" || value == null ? null : Number(value));
    setPool(null);
    setTab("divisions");
  }

  // "Mit hold"-tab is the strongest filter: only the player's own races. The legend
  // checkbox ("Mit holds løb") provides the same filter on the other tabs.
  const effectiveMineOnly = tab === "mine" || mineOnly;

  // Hver etape er sin egen kalender-event (på sin dag), så et etapeløb vises på hver dag det køres.
  const allStageEvents = useMemo(() => expandStageEvents(data?.entries || []), [data]);
  const stageEvents = useMemo(() => {
    if (!cursor) return [];
    return filterStageEvents(allStageEvents, {
      year: cursor.year,
      month: cursor.month,
      division: activeDivision,
      poolId: activePool,
      mineOnly: effectiveMineOnly,
    });
  }, [allStageEvents, cursor, activeDivision, activePool, effectiveMineOnly]);

  const byDate = useMemo(() => groupStageEventsByDate(stageEvents), [stageEvents]);
  const weeks = useMemo(() => (cursor ? buildMonthGrid(cursor.year, cursor.month) : []), [cursor]);
  // #4386: én division synligt (mine/en valgt division) -> dens egen density;
  // "alle divisioner" blander tiers i samme celle -> bredeste (D1's 5), se
  // calendarTierDensity.js.
  const dayCap = densityForDivision(activeDivision);

  if (loading) return <PageLoader label={t("loadingAria")} />;

  // #4165: sæson-listen overlever en fejlet hentning (seasonsMeta), så vælgeren
  // stadig er der at klikke på når svaret for én sæson fejler.
  const availableSeasons = data?.availableSeasons || seasonsMeta?.availableSeasons || [];
  // #2449: viser den viste sæsons nummer i vælgeren — det eksplicitte valg hvis
  // sat, ellers hvad serveren faldt tilbage til (aktiv sæson).
  const displaySeasonNumber = seasonNumber ?? data?.season?.number ?? null;
  const onSeasonChange = (n) => setSeasonNumber(n);

  // #4165: fejl-grenen ligger FØR tom-grenen. Rækkefølgen er bindende - ligger
  // den tomme først, tegnes en fejlet hentning igen som "Ingen aktiv sæson".
  // Sæson-vælgeren bliver stående, så fejlen ikke er en blindgyde.
  if (loadError) {
    return (
      <div>
        <CalendarControls
          t={t} division={division} onDivision={setDivision} data={data}
          availableSeasons={availableSeasons} seasonNumber={displaySeasonNumber} onSeasonChange={onSeasonChange}
        />
        <div role="alert">
          <ErrorState
            title={t("error.title")}
            description={loadError.kind === "auth" ? t("error.session") : t("error.description")}
            action={
              <Button size="sm" variant="secondary" onClick={retryLoad}>
                {t("error.retry")}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  if (!data?.season) {
    return (
      <div>
        <CalendarControls
          t={t} division={division} onDivision={setDivision} data={data}
          availableSeasons={availableSeasons} seasonNumber={displaySeasonNumber} onSeasonChange={onSeasonChange}
        />
        {seasonNumber != null ? (
          <EmptyState icon={<CalendarIcon size={32} aria-hidden="true" />} title={t("notGenerated.title", { number: seasonNumber })} description={t("notGenerated.desc")} />
        ) : (
          <EmptyState icon={<CalendarIcon size={32} aria-hidden="true" />} title={t("noSeason.title")} description={t("noSeason.desc")} />
        )}
      </div>
    );
  }

  const monthLabel = cursor ? formatMonth(cursor, i18n.language) : "";
  const divisionTree = data.divisions || [];
  // #2756: puljerne i den valgte division — kun til pulje-vælgeren.
  const tierPools = division != null ? (divisionTree.find((d) => d.division === division)?.pools || []) : [];

  const eyebrow = data.season
    ? (data.season.raceDaysTotal
        ? t("eyebrow", { number: data.season.number, days: data.season.raceDaysTotal })
        : t("eyebrowNoDays", { number: data.season.number }))
    : null;

  return (
    <div>
      {/* Header-divisionsvælgeren skifter til Divisioner-tabben, så valget altid har en effekt
          (ellers var den virkningsløs på Mit hold / Alle hold — CodeRabbit #14). */}
      <CalendarControls
        t={t}
        eyebrow={eyebrow}
        division={division}
        onDivision={changeDivision}
        data={data}
        availableSeasons={availableSeasons}
        seasonNumber={displaySeasonNumber}
        onSeasonChange={onSeasonChange}
      />

      {/* Tab group + month navigation */}
      <div className="mt-5 mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-cz-border pb-3">
        <div className="flex items-center gap-1" role="tablist" aria-label={t("title")}>
          {TABS.map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 text-sm transition-colors border-b-2 -mb-[calc(0.75rem+1px)]
                ${tab === key
                  ? "border-cz-accent text-cz-1 font-semibold"
                  : "border-transparent text-cz-2 hover:text-cz-1"}`}
            >
              {t(`tabs.${key}`)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCursor((c) => stepMonth(c, -1))}
            aria-label={t("prevMonth")}
            className="rounded-cz p-1.5 text-cz-2 hover:bg-cz-subtle hover:text-cz-1 transition-colors"
          >
            <ChevronLeftIcon size={18} aria-hidden="true" />
          </button>
          <span className="font-display text-lg uppercase tracking-wide text-cz-1 tabular-nums min-w-[8.5rem] text-center">
            {monthLabel}
          </span>
          <button
            type="button"
            onClick={() => setCursor((c) => stepMonth(c, 1))}
            aria-label={t("nextMonth")}
            className="rounded-cz p-1.5 text-cz-2 hover:bg-cz-subtle hover:text-cz-1 transition-colors"
          >
            <ChevronRightIcon size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Division dropdown only matters on the "divisions" tab */}
      {tab === "divisions" && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-[0.12em] text-cz-3">{t("divisionMenu.label")}</span>
          <Select
            size="sm"
            value={division ?? ""}
            onChange={(e) => changeDivision(e.target.value)}
            className="w-44"
          >
            <option value="">{t("divisionMenu.all")}</option>
            {divisionTree.map((d) => (
              <option key={d.division} value={d.division}>{t("division", { n: d.division })}</option>
            ))}
          </Select>
          {/* #2756: pulje/gruppe-vælger — kun vist når den valgte division reelt har
              mere end én pulje (samme hasPoolSubtabs-regel som Resultat-hubben,
              ResultaterPage.jsx #3197). "Alle divisioner" har ingen entydig
              pulje-liste, så vælgeren skjules der. */}
          {tierPools.length > 1 && (
            <Select
              size="sm"
              aria-label={t("poolMenu.label")}
              value={pool ?? ""}
              onChange={(e) => setPool(e.target.value === "" ? null : Number(e.target.value))}
              className="w-44"
            >
              <option value="">{t("poolMenu.all")}</option>
              {tierPools.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </Select>
          )}
        </div>
      )}

      {/* Wide grid content scrolls inside its own container — the page body must
          never scroll horizontally on mobile (7 columns need a real minimum width
          to stay legible; audit #2849 flagged this grid as missing an overflow-wrap). */}
      <div className="overflow-x-auto">
        <div className="min-w-[630px]">
          {/* Weekday header */}
          <div className="grid grid-cols-7 border-l border-t border-cz-border">
            {WEEKDAY_KEYS.map((k) => (
              <div key={k} className="border-r border-cz-border bg-cz-subtle px-2 py-1.5 text-center">
                <span className="font-data text-3xs font-bold uppercase tracking-[0.14em] text-cz-3">{t(`weekday.${k}`)}</span>
              </div>
            ))}
          </div>

          {/* Month grid */}
          <div className="border-l border-cz-border">
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7">
                {week.map((cell, ci) => (
                  <DayCell
                    key={ci}
                    cell={cell}
                    entries={cell ? byDate.get(cell.iso) : null}
                    todayISO={todayISO}
                    t={t}
                    onExpand={setExpandedDayIso}
                    dayCap={dayCap}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* #2756: "+N more" foldede før ikke ud — klik åbnede intet. Modalen viser
          dagens FULDE program (ikke kun overflowet), så listen matcher hvad
          cellen allerede viste øverst i stedet for at splitte den i to visninger. */}
      <DayDetailModal
        iso={expandedDayIso}
        events={expandedDayIso ? byDate.get(expandedDayIso) : null}
        onClose={() => setExpandedDayIso(null)}
        t={t}
        locale={i18n.language}
      />

      {stageEvents.length === 0 && (
        <div className="mt-4">
          <EmptyState icon={<CalendarIcon size={28} aria-hidden="true" />} title={t("empty.title")} description={t("empty.desc")} />
        </div>
      )}

      {/* Legend + filter */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-cz-border pt-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="font-data text-3xs font-bold uppercase tracking-[0.14em] text-cz-3">{t("legend.title")}</span>
          {LEGEND_BUCKETS.map((b) => (
            <span key={b} className="flex items-center gap-1.5 text-cz-2">
              <TerrainCodeGlyph bucket={b} width={22} height={13} className="text-cz-2" />
              <span className="text-xs">{t(`legend.${b}`)}</span>
            </span>
          ))}
        </div>
        {/* The "mine only" filter is redundant on the "mine" tab (already filtered). */}
        {tab !== "mine" && (
          <Checkbox
            id="cal-mine-only"
            checked={mineOnly}
            onChange={(e) => setMineOnly(e.target.checked)}
            label={t("filter.mine")}
            className="text-cz-2"
          />
        )}
      </div>
    </div>
  );
}

// ── controls ─────────────────────────────────────────────────────────────────
// #2849 bølge 3 — season/division-vælgerne levede tidligere INDE i den håndrullede
// editorial header; #3102 etape 3 (PR 3): siden er en fane i Planlægnings-hubben
// nu, hubben ejer h1'en (samme mønster som Formplan-fanen). Eyebrow'en
// ("Sæson N · X løbsdage") flyttede fra den nedlagte PageHeader-subtitle herind
// som venstre side af kontrolrækken; selects er T2's filterbar-slot
// (docs/design/PAGE_TEMPLATES.md).
function CalendarControls({ t, eyebrow = null, division, onDivision, data, availableSeasons = [], seasonNumber = null, onSeasonChange }) {
  const divisionTree = data?.divisions || [];
  if (!eyebrow && availableSeasons.length <= 1 && divisionTree.length === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <p className="text-[13px] text-cz-2">{eyebrow}</p>
      <div className="flex flex-wrap items-center gap-2">
        {/* #2449: sæson-vælger — kun vist når der findes mere end én oprettet sæson
            (S1/S2/...), så managers kan planlægge mod næste sæsons program FØR den starter. */}
        {availableSeasons.length > 1 && (
          <Select
            size="sm"
            value={seasonNumber ?? ""}
            onChange={(e) => onSeasonChange?.(e.target.value === "" ? null : Number(e.target.value))}
            className="w-24"
            aria-label={t("seasonMenu.label")}
          >
            {availableSeasons.map((s) => (
              <option key={s.id} value={s.number}>{t("seasonMenu.option", { number: s.number })}</option>
            ))}
          </Select>
        )}
        {/* Top-right division selector (mirrors the wireframe's "Division 1 ▾"). */}
        {divisionTree.length > 0 && (
          <Select
            size="sm"
            value={division ?? ""}
            onChange={(e) => onDivision(e.target.value === "" ? null : Number(e.target.value))}
            className="w-40"
            aria-label={t("divisionMenu.label")}
          >
            <option value="">{t("divisionMenu.all")}</option>
            {divisionTree.map((d) => (
              <option key={d.division} value={d.division}>{t("division", { n: d.division })}</option>
            ))}
          </Select>
        )}
      </div>
    </div>
  );
}

// ── day cell ─────────────────────────────────────────────────────────────────

function DayCell({ cell, entries, todayISO, t, onExpand, dayCap }) {
  if (!cell) {
    return <div className="border-b border-r border-cz-border bg-cz-subtle/40 min-h-[7rem]" aria-hidden="true" />;
  }
  const isToday = cell.iso === todayISO;
  const list = entries || [];
  // #4386: loftet er divisionens density (dayCap, 5/4/3/2), ikke det gamle
  // hardcodede 4 — men mobil holder sig til MOBILE_DAY_CAP uanset division
  // (se konstanten). Begge lister deler DOM: chips ud over mobil-loftet men
  // inden for dagCap er stadig i markup'et, bare skjult under sm (640px) via
  // CSS — samme tal cellen faktisk viser på desktop, ingen ekstra JS-viewport-
  // lytter. Cellens egen grid-min-width (630px) er allerede den samme
  // breakpoint som appens øvrige mobil-cutover (PAGE_TEMPLATES.md).
  const mobileCap = Math.min(dayCap, MOBILE_DAY_CAP);
  const shown = list.slice(0, dayCap);
  const desktopOverflow = list.length - shown.length;
  const mobileOverflow = list.length - Math.min(list.length, mobileCap);

  return (
    <div
      className={`relative border-b border-r min-h-[7rem] p-1.5 transition-colors
        ${isToday ? "border-cz-1 border-2 -m-px z-10 bg-cz-card" : "border-cz-border bg-cz-card"}`}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className={`font-data text-xs tabular-nums ${isToday ? "font-bold text-cz-1" : "text-cz-3"}`}>{cell.day}</span>
        {isToday && (
          <span className="font-data text-3xs font-bold uppercase tracking-[0.12em] text-cz-on-accent bg-cz-accent px-1 py-px rounded-cz">
            {t("today")}
          </span>
        )}
      </div>
      <div className="space-y-0.5">
        {shown.map((ev, i) => (
          <StageChip key={`${ev.raceId}:${ev.stage}`} ev={ev} t={t} className={i >= mobileCap ? "hidden sm:block" : undefined} />
        ))}
        {/* #2756: "+N more" var før statisk tekst — spillere kunne ikke se resten
            af dagens program uden at være i den division/pulje selv. Nu åbner den
            et dag-panel med hele dagens løb (Discord-feedback, thelamba 20/7).
            #4386: to knapper, én pr. breakpoint — kun den ene er nogensinde
            synlig (sm:hidden / hidden sm:block), begge åbner samme modal. */}
        {mobileOverflow > 0 && (
          <button
            type="button"
            onClick={() => onExpand(cell.iso)}
            className="sm:hidden block w-full px-0.5 text-start text-3xs text-cz-3 underline decoration-dotted transition-colors hover:text-cz-1"
          >
            {t("moreRaces", { count: mobileOverflow })}
          </button>
        )}
        {desktopOverflow > 0 && (
          <button
            type="button"
            onClick={() => onExpand(cell.iso)}
            className="hidden sm:block w-full px-0.5 text-start text-3xs text-cz-3 underline decoration-dotted transition-colors hover:text-cz-1"
          >
            {t("moreRaces", { count: desktopOverflow })}
          </button>
        )}
      </div>
    </div>
  );
}

// #2756: dag-detalje-modal — genbruger DialogSurface/Modal'et fra UI-kittet
// (PAGE_TEMPLATES.md forbyder ny modal-markup) og StageChip'en dagcellen
// allerede renderer, så listen ser identisk ud, bare fuld i stedet for afkortet.
function DayDetailModal({ iso, events, onClose, t, locale }) {
  const list = events || [];
  return (
    <Modal
      open={iso != null}
      onClose={onClose}
      title={iso ? formatDayLong(iso, locale) : ""}
      closeLabel={t("common:actions.close")}
      size="sm"
    >
      <div className="space-y-1.5">
        {list.map((ev) => (
          <StageChip key={`${ev.raceId}:${ev.stage}`} ev={ev} t={t} />
        ))}
      </div>
    </Modal>
  );
}

// ── stage chip ───────────────────────────────────────────────────────────────
// Én chip pr. etape: klikbar ind på løbets planlægningsside (?stage=N), med terræn-glyf,
// løbsnavn og en anden linje med "N. etape · HH:MM" (endagsløb: kun klokkeslæt).

function StageChip({ ev, t, className = "" }) {
  const mine = ev.isMine;
  const isStageRace = ev.raceType === "stage_race";
  const stageLabel = isStageRace ? t("chip.stageNum", { n: ev.stage }) : null;
  const secondLine = [stageLabel, ev.time].filter(Boolean).join(" · ");

  // Full name + meta is always the accessible name (visible name truncates hard in narrow cells).
  const a11yLabel = `${ev.name} · ${t(`terrain.${ev.terrain || "sprint"}`)}${secondLine ? ` · ${secondLine}` : ""}${ev.poolLabel ? ` · ${ev.poolLabel}` : ""}`;

  return (
    <Link
      to={`/races/${ev.raceId}${isStageRace ? `?stage=${ev.stage}` : ""}`}
      data-testid="calendar-race-chip"
      aria-label={t("chip.openRace", { name: ev.name })}
      title={a11yLabel}
      className={`block rounded-cz border px-1.5 py-0.5 leading-tight transition-colors
        ${mine
          ? "border-cz-accent/40 bg-cz-accent/[0.07] hover:bg-cz-accent/[0.14]"
          : "border-cz-border bg-cz-subtle/50 opacity-80 hover:opacity-100 hover:bg-cz-subtle"} ${className}`}
    >
      <div className="flex items-center gap-1.5">
        {/* #4143: bogstavkode-primitiv (delt med planlæggerens MasterCanvas) —
            en fuld mini-profil kræver rutedata pr. race, som kalenderens svar
            ikke henter (docs/CALENDAR_RULES.md, se lib/terrainCode.ts). */}
        <TerrainCodeGlyph bucket={ev.terrain || "sprint"} width={18} height={10} className={mine ? "text-cz-1" : "text-cz-3"} />
        <span className={`truncate text-2xs font-medium ${mine ? "text-cz-1" : "text-cz-2"}`}>{ev.name}</span>
      </div>
      {secondLine && (
        <p className={`mt-0.5 truncate text-3xs tabular-nums ${mine ? "text-cz-accent-t font-medium" : "text-cz-3"}`}>
          {secondLine}
        </p>
      )}
    </Link>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function ownDivisionTier(data) {
  if (!data) return null;
  const ownPool = data.ownPoolId;
  if (ownPool == null) return null;
  for (const d of data.divisions || []) {
    if ((d.pools || []).some((p) => p.id === ownPool)) return d.division;
  }
  return null;
}

function ymOfToday() {
  const iso = copenhagenTodayISO();
  return { year: +iso.slice(0, 4), month: +iso.slice(5, 7) };
}

function formatMonth({ year, month }, locale) {
  const label = new Intl.DateTimeFormat(locale || "en", {
    timeZone: "Europe/Copenhagen",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, 15)));
  return label.toUpperCase();
}

// #2756: dag-modalens titel. Bygger datoen fra "YYYY-MM-DD"-strengen selv (aldrig
// new Date(iso) — samme UTC-midnat-TZ-fælde calendarGrid.js's filhoved advarer om)
// og bruger middag-UTC som anker, så Europe/Copenhagen-projektionen aldrig kan
// rulle en dag frem/tilbage om sommertiden.
function formatDayLong(iso, locale) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(locale || "en", {
    timeZone: "Europe/Copenhagen",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}
