import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { PageLoader, EmptyState, Select, Checkbox, CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "../components/ui";
import TerrainGlyph from "../components/calendar/TerrainGlyph.jsx";
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
const LEGEND_BUCKETS = ["sprint", "hilly", "mountain", "itt"];
const TABS = ["mine", "all", "divisions"];

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

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` };
}

export default function CalendarPage() {
  const { t, i18n } = useTranslation("calendar");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("mine");
  const [division, setDivision] = useState(null); // null = all divisions
  const [mineOnly, setMineOnly] = useState(false);
  const [cursor, setCursor] = useState(null); // { year, month }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!API) { setLoading(false); return; }
        const res = await fetch(`${API}/api/races/calendar`, { headers: await authHeaders() });
        const json = await res.json();
        if (!alive) return;
        setData(json);
        // Default the division selector to the player's own division (tier).
        const ownTier = ownDivisionTier(json);
        if (ownTier != null) setDivision(ownTier);
        // Land on the first month that has races (most of the 60 days are empty).
        const months = monthsWithRaces(json.entries || []);
        const todayYM = copenhagenTodayISO().slice(0, 7);
        const monthForToday = months.find((m) => `${m.year}-${String(m.month).padStart(2, "0")}` === todayYM);
        setCursor(monthForToday || months[0] || ymOfToday());
      } catch {
        if (alive) setData(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const todayISO = useMemo(() => copenhagenTodayISO(), []);

  // The active division for filtering: tab "divisions" honours the dropdown; "mine"
  // pins to the player's own division; "all" shows every division.
  const activeDivision = useMemo(() => {
    if (tab === "all") return null;
    if (tab === "mine") return ownDivisionTier(data);
    return division; // "divisions" tab → dropdown value
  }, [tab, division, data]);

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
      mineOnly: effectiveMineOnly,
    });
  }, [allStageEvents, cursor, activeDivision, effectiveMineOnly]);

  const byDate = useMemo(() => groupStageEventsByDate(stageEvents), [stageEvents]);
  const weeks = useMemo(() => (cursor ? buildMonthGrid(cursor.year, cursor.month) : []), [cursor]);

  if (loading) return <PageLoader label={t("loadingAria")} />;

  if (!data?.season) {
    return (
      <div className="mx-auto max-w-4xl">
        <CalendarHeader t={t} season={null} division={division} onDivision={setDivision} data={data} />
        <EmptyState icon={<CalendarIcon size={32} aria-hidden="true" />} title={t("noSeason.title")} description={t("noSeason.desc")} />
      </div>
    );
  }

  const monthLabel = cursor ? formatMonth(cursor, i18n.language) : "";
  const divisionTree = data.divisions || [];

  return (
    <div className="mx-auto max-w-[1100px]">
      {/* Header-divisionsvælgeren skifter til Divisioner-tabben, så valget altid har en effekt
          (ellers var den virkningsløs på Mit hold / Alle hold — CodeRabbit #14). */}
      <CalendarHeader
        t={t}
        season={data.season}
        division={division}
        onDivision={(v) => { setDivision(v); setTab("divisions"); }}
        data={data}
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
        <div className="mb-4 flex items-center gap-2">
          <span className="text-xs uppercase tracking-[0.12em] text-cz-3">{t("divisionMenu.label")}</span>
          <Select
            size="sm"
            value={division ?? ""}
            onChange={(e) => setDivision(e.target.value === "" ? null : Number(e.target.value))}
            className="w-44"
          >
            <option value="">{t("divisionMenu.all")}</option>
            {divisionTree.map((d) => (
              <option key={d.division} value={d.division}>{t("division", { n: d.division })}</option>
            ))}
          </Select>
        </div>
      )}

      {/* Weekday header */}
      <div className="grid grid-cols-7 border-l border-t border-cz-border">
        {WEEKDAY_KEYS.map((k) => (
          <div key={k} className="border-r border-cz-border bg-cz-subtle px-2 py-1.5 text-center">
            <span className="font-data text-[10px] font-bold uppercase tracking-[0.14em] text-cz-3">{t(`weekday.${k}`)}</span>
          </div>
        ))}
      </div>

      {/* Month grid */}
      <div className="border-l border-cz-border">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7">
            {week.map((cell, ci) => (
              <DayCell key={ci} cell={cell} entries={cell ? byDate.get(cell.iso) : null} todayISO={todayISO} t={t} />
            ))}
          </div>
        ))}
      </div>

      {stageEvents.length === 0 && (
        <div className="mt-4">
          <EmptyState icon={<CalendarIcon size={28} aria-hidden="true" />} title={t("empty.title")} description={t("empty.desc")} />
        </div>
      )}

      {/* Legend + filter */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-cz-border pt-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="font-data text-[10px] font-bold uppercase tracking-[0.14em] text-cz-3">{t("legend.title")}</span>
          {LEGEND_BUCKETS.map((b) => (
            <span key={b} className="flex items-center gap-1.5 text-cz-2">
              <TerrainGlyph bucket={b} className="text-cz-2" />
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

// ── header ───────────────────────────────────────────────────────────────────

function CalendarHeader({ t, season, division, onDivision, data }) {
  const divisionTree = data?.divisions || [];
  const eyebrow = season
    ? (season.raceDaysTotal
        ? t("eyebrow", { number: season.number, days: season.raceDaysTotal })
        : t("eyebrowNoDays", { number: season.number }))
    : "";
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="font-data text-[11px] font-semibold uppercase tracking-[0.16em] text-cz-3">{eyebrow}</p>
        )}
        <h1 className="font-display text-[2.75rem] leading-[0.95] uppercase tracking-wide text-cz-1">{t("title")}</h1>
      </div>
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
  );
}

// ── day cell ─────────────────────────────────────────────────────────────────

function DayCell({ cell, entries, todayISO, t }) {
  if (!cell) {
    return <div className="border-b border-r border-cz-border bg-cz-subtle/40 min-h-[7rem]" aria-hidden="true" />;
  }
  const isToday = cell.iso === todayISO;
  const list = entries || [];
  const shown = list.slice(0, 4);
  const overflow = list.length - shown.length;

  return (
    <div
      className={`relative border-b border-r min-h-[7rem] p-1.5 transition-colors
        ${isToday ? "border-cz-1 border-2 -m-px z-10 bg-cz-card" : "border-cz-border bg-cz-card"}`}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className={`font-data text-xs tabular-nums ${isToday ? "font-bold text-cz-1" : "text-cz-3"}`}>{cell.day}</span>
        {isToday && (
          <span className="font-data text-[8px] font-bold uppercase tracking-[0.12em] text-cz-on-accent bg-cz-accent px-1 py-px rounded-[2px]">
            {t("today")}
          </span>
        )}
      </div>
      <div className="space-y-1">
        {shown.map((ev) => (
          <StageChip key={`${ev.raceId}:${ev.stage}`} ev={ev} t={t} />
        ))}
        {overflow > 0 && (
          <p className="px-0.5 text-[10px] text-cz-3">{t("moreRaces", { count: overflow })}</p>
        )}
      </div>
    </div>
  );
}

// ── stage chip ───────────────────────────────────────────────────────────────
// Én chip pr. etape: klikbar ind på løbets planlægningsside (?stage=N), med terræn-glyf,
// løbsnavn og en anden linje med "N. etape · HH:MM" (endagsløb: kun klokkeslæt).

function StageChip({ ev, t }) {
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
      className={`block rounded-[3px] border px-1.5 py-1 leading-tight transition-colors
        ${mine
          ? "border-cz-accent/40 bg-cz-accent/[0.07] hover:bg-cz-accent/[0.14]"
          : "border-cz-border bg-cz-subtle/50 opacity-80 hover:opacity-100 hover:bg-cz-subtle"}`}
    >
      <div className="flex items-center gap-1.5">
        <TerrainGlyph bucket={ev.terrain || "sprint"} width={18} height={10} className={mine ? "text-cz-1" : "text-cz-3"} />
        <span className={`truncate text-[11px] font-medium ${mine ? "text-cz-1" : "text-cz-2"}`}>{ev.name}</span>
      </div>
      {secondLine && (
        <p className={`mt-0.5 truncate text-[9px] tabular-nums ${mine ? "text-cz-accent-t font-medium" : "text-cz-3"}`}>
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
