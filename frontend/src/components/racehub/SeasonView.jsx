// Z1 v0 — Season-visningen på planlægnings-boardet (#1146, Planning Center
// fase 2 §2 Z1; A6 afgjort 21/8: kalender-fanen består, dette er den nye
// sæson-akse). Datolineal + løbs-bænde for HOLDETS EGEN pulje fra
// GET /api/races/calendar; klik på et løb åbner dets dag på det eksisterende
// dags-board (?day=, dansk kalenderdag-ordinal jf. backend/lib/seasonDay.js).
// Read-only: al redigering sker på dags-boardet. Rytter×løb-gitteret er P1.
//
// #4102: backend understøttede allerede ?season_number= + availableSeasons
// (B7 read-only-browsing), men UI'et havde ingen synlig indgang — kun URL.
// SeasonPicker gør sæson-skiftet synligt og klikbart; samme komponent viser
// "upcoming" FØR cutover og "previous" EFTER, uden egen gren (statusKey
// afledes af activeNumber, ikke af en hardkodet S2/S3-antagelse).
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { getSession } from "../../lib/supabase";
import { reportLoadFailure } from "../../lib/actionTelemetry.js";
import { Spinner, EmptyState, ErrorState, FlagIcon, Button } from "../ui";
import SeasonDayToggle from "./SeasonDayToggle.jsx";
import SeasonPicker, { neighborSeasons } from "./SeasonPicker.jsx";
import SeasonChangeoverNote from "./SeasonChangeoverNote.jsx";
import SeasonMatrix from "./SeasonMatrix.jsx";
import {
  seasonRange,
  spanToRect,
  dateToPct,
  buildWeekTicks,
  packLanes,
  padVisualSpan,
  bandsCoveringDay,
  nextFocusDayIso,
  seasonDayOrdinal,
} from "../../lib/seasonTimeline.js";

const API = import.meta.env.VITE_API_URL;

// Spejler backend/lib/boardConstants.js (MONUMENT_RACE_CLASSES) + grandTourRestDays
// (GRAND_TOUR_MIN_STAGES=15). race_class er sandheden; stages>=15 er GT-fallback.
const GT_CLASSES = new Set(["TourFrance", "GiroVuelta"]);
const isGrandTour = (e) => GT_CLASSES.has(e.raceClass) || (e.stages ?? 1) >= 15;
const isMonument = (e) => e.raceClass === "Monuments";

// Dagens danske kalenderdato — samme mønster som CalendarPage (visning er "nu",
// uafhængigt af motoren).
function copenhagenTodayISO() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

async function authHeaders() {
  const { data } = await getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : null;
}

/** Kalender-entries (egen pulje) → bænde til tidslinjen. Ren, testbar via props. */
export function entriesToBands(entries, ownPoolId) {
  return (entries || [])
    .filter((e) => e.poolId != null && e.poolId === ownPoolId)
    .map((e) => {
      const dates = (e.stageSchedule || []).map((s) => s.date).filter(Boolean).sort();
      const startDate = dates[0] ?? e.date;
      const endDate = dates[dates.length - 1] ?? e.date;
      if (!startDate) return null;
      return {
        id: e.id,
        name: e.name,
        stages: e.stages ?? 1,
        startDate,
        endDate,
        multiDay: (e.stages ?? 1) > 1,
        gt: isGrandTour(e),
        monument: isMonument(e),
        hasSelection: !!e.entered,
      };
    })
    .filter(Boolean);
}

export default function SeasonView({ onSwitchView }) {
  const { t, i18n } = useTranslation("races");
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // #4165: "kaldet fejlede" og "kalenderen er tom" er to forskellige tilstande.
  // Var `failed` et boolean, og auth-grenen satte den slet ikke - en manglende
  // session faldt igennem til EmptyState "ingen løb på kalenderen endnu", altså
  // en fejlet hentning tegnet som en legitim tom flade. Nu bærer den en kind, så
  // en udløbet session kan sige det med sine egne ord.
  // null | "auth" | "load"
  const [failed, setFailed] = useState(null);
  const [retryTick, setRetryTick] = useState(0);
  // #4102: sæson-listen + hvilken der er aktiv persisterer UD OVER den enkelte
  // fetch, så SeasonPicker'en ikke blinker væk mens en NY sæson hentes (den
  // hører til navigationen, ikke til det enkelte kalender-svar).
  const [seasonsMeta, setSeasonsMeta] = useState(null); // { availableSeasons, activeNumber } | null
  // #1146: sæsonmatrixens ugemte-ændringer-flag bobler op hertil, så et sæson-skift
  // eller et view-toggle-klik guardes (samme boardDirty-mønster som RaceHubBoard.jsx,
  // IKKE StrategyPage-mønsteret, som er kendt defekt — StrategyPage.jsx:114).
  const [matrixDirty, setMatrixDirty] = useState(false);
  const confirmLeaveMatrixIfDirty = () => !matrixDirty || window.confirm(t("matrix.leaveUnsaved"));

  // B7 (spec): næste sæson må browses read-only så snart kalenderen findes.
  // ?season=N viser en eksplicit sæson; er den ikke den aktive, er visningen
  // read-only (ingen dag-navigation — dags-boardet arbejder altid i den aktive).
  const seasonParam = Number.parseInt(params.get("season"), 10);

  useEffect(() => {
    let alive = true;
    (async () => {
      // #4165: spinneren tændes FØR session-tjekket. Lå den efter, var "Prøv
      // igen" på auth-grenen inert: retryTick genkørte effekten, men den satte
      // kun setFailed("auth") til den SAMME værdi, React bailede ud, og intet på
      // skærmen flyttede sig. Nu blinker spinneren, og sessionen bliver reelt
      // læst igen - er man logget ind i en anden fane imens, lander visningen.
      setLoading(true);
      setFailed(null);
      const headers = await authHeaders();
      if (!headers) {
        // #4165: returnerede tavst -> data blev ved med at være null, og
        // render-grenen nedenfor tegnede "ingen løb på kalenderen endnu".
        setFailed("auth");
        reportLoadFailure("racehub_season_view", { kind: "auth" });
        setLoading(false);
        return;
      }
      const qs = Number.isFinite(seasonParam) ? `?season_number=${seasonParam}` : "";
      try {
        const res = await fetch(`${API}/api/races/calendar${qs}`, { headers });
        if (!res.ok) {
          reportLoadFailure("racehub_season_view", { kind: "http", status: res.status });
          throw new Error("calendar_failed");
        }
        // #4165: parsningen har sin EGEN gren. Lå res.json() i den ydre try,
        // blev en malformet 200-krop tagget "network" i Sentry - altså en
        // server- eller proxy-fejl fejlmeldt som spillerens forbindelse, i netop
        // det signal triagen skal hvile på næste gang.
        let json;
        try {
          json = await res.json();
        } catch (cause) {
          reportLoadFailure("racehub_season_view", { kind: "parse", status: res.status, cause });
          // Sentinel-fejlen bærer den oprindelige parse-fejl som `cause`, så den
          // ydre catch kan kende grenen på message'en UDEN at tabe stakken.
          throw new Error("calendar_failed", { cause });
        }
        if (!alive) return;
        setData(json);
        const activeNumber = (json.availableSeasons || []).find((s) => s.status === "active")?.number ?? null;
        setSeasonsMeta({ availableSeasons: json.availableSeasons || [], activeNumber });
      } catch (cause) {
        // http- og parse-grenene har allerede rapporteret sig selv med deres
        // egen kind; kun ægte netværksfejl skal tælles som "network" her.
        if (cause?.message !== "calendar_failed") {
          reportLoadFailure("racehub_season_view", { kind: "network", cause });
        }
        if (alive) { setData(null); setFailed("load"); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [seasonParam, retryTick]);

  const todayIso = useMemo(() => copenhagenTodayISO(), []);

  const pickerSeasons = useMemo(
    () => neighborSeasons(seasonsMeta?.availableSeasons, seasonsMeta?.activeNumber),
    [seasonsMeta],
  );
  // Den sæson brugeren faktisk kigger på lige nu — server-svaret vinder når det
  // er der, ellers URL'ens ?season=, ellers den aktive (default-tilstand).
  const viewedSeasonNumber = data?.season?.number ?? (Number.isFinite(seasonParam) ? seasonParam : seasonsMeta?.activeNumber ?? null);

  function selectSeason(number) {
    if (!confirmLeaveMatrixIfDirty()) return;
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (seasonsMeta?.activeNumber != null && number === seasonsMeta.activeNumber) p.delete("season");
      else p.set("season", String(number));
      return p;
    }, { replace: true });
  }

  const model = useMemo(() => {
    if (!data?.season) return null;
    const bands = entriesToBands(data.entries, data.ownPoolId);
    if (!bands.length) return { empty: true };
    const rail = seasonRange(bands);
    // Boardets ?day=-akse er forankret i sæsonens TIDLIGSTE dato på tværs af
    // ALLE puljer (seasonDayAxis) — ikke egen pulje. Udled den af alle entries.
    let seasonFirstIso = null;
    for (const e of data.entries || []) {
      const d = e.stageSchedule?.[0]?.date ?? e.date;
      if (d && (seasonFirstIso == null || d < seasonFirstIso)) seasonFirstIso = d;
    }
    const packed = packLanes(padVisualSpan(bands, 2));
    // Baner med en subline-bærer (flerdages/monument) er høje; rene endags-baner lave.
    const laneHeights = [];
    for (const b of packed) {
      const h = (b.multiDay || b.monument) ? 44 : 28;
      laneHeights[b.lane] = Math.max(laneHeights[b.lane] || 0, h);
    }
    const laneTops = [];
    let y = 0;
    for (let i = 0; i < laneHeights.length; i++) { laneTops[i] = y; y += (laneHeights[i] || 28) + 8; }
    const focusIso = nextFocusDayIso(bands, todayIso);
    const focusBands = focusIso ? bandsCoveringDay(bands, focusIso) : [];
    const activeNumber = (data.availableSeasons || []).find((s) => s.status === "active")?.number ?? null;
    return {
      bands, packed, rail, seasonFirstIso, laneTops,
      areaHeight: Math.max(y - 8, 44),
      ticks: rail ? buildWeekTicks(rail.startIso, rail.endIso) : [],
      todayPct: rail ? dateToPct(todayIso, rail.startIso, rail.endIso) : null,
      focusIso,
      focusStats: {
        races: focusBands.length,
        saved: focusBands.filter((b) => b.hasSelection).length,
        open: focusBands.filter((b) => !b.hasSelection).length,
      },
      readOnly: activeNumber != null && data.season.number !== activeNumber,
      upcoming: activeNumber != null && data.season.number > activeNumber,
      division: (data.entries || []).find((e) => e.poolId === data.ownPoolId)?.division ?? null,
    };
  }, [data, todayIso]);

  const fmt = useMemo(() => {
    const locale = i18n.language?.startsWith("da") ? "da-DK" : "en-GB";
    const edge = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    const mid = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
    const asUtc = (iso) => new Date(`${iso}T00:00:00Z`);
    return {
      tick: (iso, isEdge) => (isEdge ? edge : mid).format(asUtc(iso)).replace(/\./g, "").toUpperCase(),
      panel: (iso) => edge.format(asUtc(iso)).replace(/\./g, ""),
      range: (iso) => mid.format(asUtc(iso)).replace(/\./g, ""),
    };
  }, [i18n.language]);

  // Klik på et løb → dets dag på dags-boardet. En igangværende GT åbner DAGENS
  // etape (klamp til [start, slut]), ikke løbets første dag.
  function openDay(iso) {
    if (!model || model.readOnly || !model.seasonFirstIso) return;
    if (!confirmLeaveMatrixIfDirty()) return;
    const ordinal = seasonDayOrdinal(iso, model.seasonFirstIso);
    if (!Number.isFinite(ordinal)) return;
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete("view");
      p.delete("season");
      p.set("day", String(ordinal));
      return p;
    }, { replace: true });
  }
  const clampToRunning = (b) => (b.startDate <= todayIso && todayIso <= b.endDate ? todayIso : b.startDate);
  const guardedSwitchView = (next) => { if (confirmLeaveMatrixIfDirty()) onSwitchView(next); };

  // Header-raden (toggle + evt. sæson-vælger) er den samme uanset loading/fejl/
  // tom-tilstand, så sæson-skiftet aldrig forsvinder mens en anden sæsons data hentes.
  const header = (
    <div className="mb-4 flex flex-wrap items-center gap-2.5">
      <SeasonDayToggle view="season" onChange={guardedSwitchView} />
      {pickerSeasons.length > 1 && (
        <SeasonPicker
          seasons={pickerSeasons}
          activeNumber={seasonsMeta?.activeNumber ?? null}
          current={viewedSeasonNumber}
          onSelect={selectSeason}
        />
      )}
    </div>
  );

  if (loading) return <div>{header}<div className="flex justify-center py-10"><Spinner size={20} /></div></div>;
  // #4165: fejl-grenen SKAL ligge før den tomme gren nedenfor, ellers bliver en
  // fejlet hentning igen tegnet som "ingen løb på kalenderen endnu".
  if (failed) {
    return (
      <div role="alert">
        {header}
        <ErrorState
          // #4165: uden title faldt ErrorState tilbage på sin hardkodede
          // engelske default ("Something went wrong"), så en dansk manager fik
          // engelsk overskrift over dansk brødtekst. De fire øvrige flader
          // sender alle en oversat titel - anatomien i PAGE_TEMPLATES.md
          // forudsætter den.
          title={t("seasonView.errorTitle")}
          description={failed === "auth" ? t("seasonView.errorSession") : t("seasonView.error")}
          action={
            <Button size="sm" variant="secondary" onClick={() => setRetryTick((n) => n + 1)}>
              {t("seasonView.retry")}
            </Button>
          }
        />
      </div>
    );
  }
  if (!data?.season || !model || model.empty) {
    return (
      <div>
        {header}
        <EmptyState icon={<FlagIcon size={24} />} title={t("seasonView.empty")} />
      </div>
    );
  }

  const { rail, packed, laneTops, areaHeight, ticks, todayPct, focusIso, focusStats } = model;

  const bandClasses = (b) => {
    if (b.monument) return "bg-cz-sidebar outline outline-2 outline-offset-1 outline-cz-accent";
    if (b.multiDay) return "bg-cz-sidebar";
    return b.hasSelection
      ? "border border-cz-accent/50 bg-cz-accent/10"
      : "border border-cz-border bg-cz-subtle";
  };
  const bandNameClasses = (b) => {
    if (b.monument) return "text-cz-accent";
    if (b.multiDay) return "text-cz-sidebar-1";
    return b.hasSelection ? "text-cz-1" : "text-cz-2";
  };

  return (
    <div>
      {/* Toggle + sæson-vælger + sæson-meta + klik-hint (jf. mockup) */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <SeasonDayToggle view="season" onChange={guardedSwitchView} />
          {pickerSeasons.length > 1 && (
            <SeasonPicker
              seasons={pickerSeasons}
              activeNumber={seasonsMeta?.activeNumber ?? null}
              current={viewedSeasonNumber}
              onSelect={selectSeason}
            />
          )}
          <span className="text-xs text-cz-2 truncate">
            {t("seasonView.meta", {
              season: data.season.number,
              division: t("seasonView.divisionLabel", { n: model.division ?? "?" }),
              count: model.bands.length,
              start: fmt.range(rail.startIso),
              end: fmt.range(rail.endIso),
            })}
          </span>
          {/* #4102: tydelig start-markering når man browser en kommende sæson read-only. */}
          {model.upcoming && (
            <span className="rounded-full border border-cz-accent/40 bg-cz-accent/10 px-2 py-0.5 font-data text-2xs font-semibold text-cz-accent-t whitespace-nowrap">
              {t("seasonView.startsOn", { date: fmt.panel(rail.startIso) })}
            </span>
          )}
        </div>
        <span className="font-data text-2xs text-cz-3">
          {model.readOnly ? t("seasonView.readOnlyHint") : t("seasonView.hint")}
        </span>
      </div>

      <div className="rounded-cz border border-cz-border bg-cz-card p-4 sm:p-5">
        {/* Vandret scroll i EGEN container på smalle skærme — aldrig side-scroll på body */}
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            {/* Datolineal med uge-ticks + TODAY-markør */}
            <div className="relative h-[26px] border-b border-cz-border" aria-hidden="true">
              {ticks.map((tick) => (
                <span
                  key={tick.iso}
                  className="absolute bottom-1.5 font-data text-3xs font-semibold tracking-[.06em] text-cz-3 whitespace-nowrap"
                  style={tick.edge === "end" ? { right: 0 } : { left: `${tick.pct}%`, transform: tick.edge === "start" ? "none" : "translateX(-50%)" }}
                >
                  {fmt.tick(tick.iso, !!tick.edge)}
                </span>
              ))}
              {todayPct != null && (
                <>
                  <span className="absolute -bottom-px h-2 w-0.5 bg-cz-accent" style={{ left: `${todayPct}%` }} />
                  <span className="absolute -bottom-4 font-data text-3xs font-bold tracking-[.1em] text-cz-accent-t" style={{ left: `${todayPct}%`, transform: "translateX(-50%)" }}>
                    {t("seasonView.today")}
                  </span>
                </>
              )}
            </div>

            {/* Løbs-bænde */}
            <div className="relative mt-5" style={{ height: `${areaHeight}px` }}>
              {todayPct != null && (
                <div className="absolute inset-y-0 w-px bg-cz-accent/60" style={{ left: `${todayPct}%` }} aria-hidden="true" />
              )}
              {packed.map((b) => {
                const rect = spanToRect(b.startDate, b.endDate, rail.startIso, rail.endIso);
                if (!rect) return null;
                const ordinal = seasonDayOrdinal(clampToRunning(b), model.seasonFirstIso);
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => openDay(clampToRunning(b))}
                    disabled={model.readOnly}
                    aria-label={t("seasonView.bandAria", { name: b.name, day: ordinal ?? "?" })}
                    className={`absolute rounded px-2 py-1 text-left overflow-hidden transition-opacity ${bandClasses(b)} ${model.readOnly ? "cursor-default" : "hover:opacity-85"}`}
                    style={{ left: `${rect.leftPct}%`, width: `${rect.widthPct}%`, top: `${laneTops[b.lane]}px` }}
                  >
                    <p className={`m-0 font-data text-3xs font-semibold truncate ${bandNameClasses(b)}`}>{b.name}</p>
                    {(b.multiDay || b.monument) && (
                      <p className="m-0 text-3xs truncate text-cz-sidebar-2">
                        {b.monument
                          ? t("seasonView.monument")
                          : t(b.gt ? "seasonView.stagesGt" : "seasonView.stagesOnly", { count: b.stages })}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Dag-panel: næste løbsdag der mangler dig (eller næste med løb) */}
            {focusIso && !model.readOnly && (
              <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-cz border border-cz-accent/50 bg-cz-accent/8 px-3.5 py-2.5">
                <span className="font-data text-2xs font-semibold text-cz-1">
                  {t("seasonView.dayPanel.title", {
                    day: seasonDayOrdinal(focusIso, model.seasonFirstIso) ?? "?",
                    date: fmt.panel(focusIso),
                  })}
                </span>
                <span className="text-xs text-cz-2">
                  {t("seasonView.dayPanel.meta", focusStats)}
                </span>
                <button
                  type="button"
                  onClick={() => openDay(focusIso)}
                  className="ms-auto font-data text-xs font-semibold text-cz-accent-t hover:underline"
                >
                  {t("seasonView.dayPanel.openBoard")}
                </button>
              </div>
            )}

            {/* Legend */}
            <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-cz-border pt-2.5">
              <span className="font-data text-3xs font-bold tracking-[.14em] text-cz-3">{t("seasonView.legend.label")}</span>
              <span className="flex items-center gap-1.5 text-2xs text-cz-2">
                <span className="inline-block h-3 w-3 rounded-sm bg-cz-sidebar" />{t("seasonView.legend.gt")}
              </span>
              <span className="flex items-center gap-1.5 text-2xs text-cz-2">
                <span className="inline-block h-3 w-3 rounded-sm bg-cz-sidebar outline outline-2 outline-offset-1 outline-cz-accent" />{t("seasonView.legend.monument")}
              </span>
              <span className="flex items-center gap-1.5 text-2xs text-cz-2">
                <span className="inline-block h-3 w-3 rounded-sm border border-cz-accent/50 bg-cz-accent/10" />{t("seasonView.legend.selected")}
              </span>
              <span className="flex items-center gap-1.5 text-2xs text-cz-2">
                <span className="inline-block h-3 w-3 rounded-sm border border-cz-border bg-cz-subtle" />{t("seasonView.legend.none")}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* #1146 P1: rytter × løbsdag-gitteret. Egen data-hentning/kladde/gem — Z1 v0's
          tidslinje ovenfor forbliver urørt. Read-only-tilstanden er indbygget i
          gitterets eget svar (samme sæson-aktiv-tjek som denne visning). */}
      <SeasonMatrix seasonNumber={data.season.number} onOpenDay={openDay} onDirtyChange={setMatrixDirty} />

      {/* #4124: sæsonskiftets tidslinje, kort + collapsible (fuld forklaring i Hjælp). */}
      <SeasonChangeoverNote className="mt-4" />
    </div>
  );
}
