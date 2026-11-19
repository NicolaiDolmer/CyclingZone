// #5841 · Udgave-skiftet, variant A (ejer 16/11, skitse-PR #8291): to små menuer "Pool X" og
// "Season N" øverst til højre i løbshovedet, med vinder og forspring pr. udgave i menuen, og
// "Back to your race" når man ser en anden pulje end holdets. Kalenderkortets række
// "Runs in N pools" med en knap pr. pulje bor også her (V6PoolButtons).
//
// Kun under race_page_v6: switchen monteres af RacePageV6 (v6-chunket), og kalenderkortet viser
// rækken kun når kontakten er tændt. Slukket = intet ændret.
//
// Nøglen er pool_race_id (+ season_id): én læsning af løbets række, én af alle rækker med samme
// pool_race_id, og (pagineret) rank 1-2 i "stage"/"gc" for de udgaver plus holdets egne
// tilmeldinger. Ingen ny tabel, intet nyt endpoint. Alt regnes i v6EditionSwitchModel.ts.
//
// Menuen tegnes i en portal med fast position (hovedkortet klipper med overflow-hidden), samme
// mønster som SeasonMatrixCellPopover/LanguageSwitcher: flyttes ved scroll og resize, lukker ved
// klik udenfor, Escape og Tab. Ingen guld her: sidens ene guld-knap står i talrækken.
//
// Teksterne står i navnerummet "calendar", som er route-gatet (ikke inlinet i første
// indlæsning, scripts/i18n-check-namespace-inline.mjs); switchen tegner intet før det er klar.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { supabase } from "../../../lib/supabase.ts";
import { fetchAllRows } from "../../../lib/supabasePagination.js";
import { formatRelativeTime } from "../../../lib/intl.js";
import { raceArchiveHref } from "../../../lib/racePeek.ts";
import { menuClass, menuItemClass } from "../../ui/menuStyles.js";
import { ChevronDownIcon, ChevronRightIcon } from "./v6Ui.ts";
import {
  buildEditionSwitch, formatMargin, nextMenuFocus, poolLetter,
  type EditionRaceRow, type EditionResultRow, type EditionSummary, type EditionSwitchModel,
} from "./v6EditionSwitchModel.ts";

type Translate = (key: string, opts?: Record<string, unknown>) => string;

const EDITION_COLUMNS = "id, name, race_type, season_id, league_division_id, status, stages, stages_completed, season:season_id(number, status), division:league_division_id(tier, pool_index, label)";

interface EditionData {
  raceId: string;
  editions: EditionRaceRow[];
  results: EditionResultRow[];
  ownRaceIds: Set<string>;
}

async function loadEditions(raceId: string, myTeamId: string | null): Promise<EditionData | null> {
  const { data: self, error } = await supabase.from("races").select("id, pool_race_id").eq("id", raceId).maybeSingle();
  if (error || !self?.pool_race_id) return null;
  // pagination-safe: én række pr. pulje pr. sæson for ét katalogløb (få dusin), stabil orden.
  const editions = (await fetchAllRows(() => supabase.from("races").select(EDITION_COLUMNS)
    .eq("pool_race_id", self.pool_race_id as string).order("id"))) as EditionRaceRow[];
  const ids = editions.map((e) => e.id);
  if (ids.length < 2) return { raceId, editions, results: [], ownRaceIds: new Set() };
  const [results, entries] = await Promise.all([
    fetchAllRows(() => supabase.from("race_results")
      .select("race_id, stage_number, result_type, rank, rider_name, finish_time, rider:rider_id(firstname, lastname)")
      .in("race_id", ids).in("result_type", ["stage", "gc"]).lte("rank", 2).order("id")) as Promise<EditionResultRow[]>,
    myTeamId
      ? fetchAllRows(() => supabase.from("race_entries").select("race_id").eq("team_id", myTeamId).in("race_id", ids).order("race_id")) as Promise<{ race_id: string }[]>
      : Promise.resolve([] as { race_id: string }[]),
  ]);
  return { raceId, editions, results, ownRaceIds: new Set(entries.map((e) => e.race_id)) };
}

function useEditionSwitch(raceId: string | null, myTeamId: string | null, hideResults: boolean): EditionSwitchModel | null {
  const [data, setData] = useState<EditionData | null>(null);
  useEffect(() => {
    if (!raceId) return undefined;
    let alive = true;
    loadEditions(raceId, myTeamId)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData(null); /* catch-ok: uden svar intet skift, siden er som i dag */ });
    return () => { alive = false; };
  }, [raceId, myTeamId]);
  return useMemo(() => (data && data.raceId === raceId
    ? buildEditionSwitch({ currentRaceId: raceId, editions: data.editions, results: data.results, ownRaceIds: data.ownRaceIds, hideResults })
    : null), [data, raceId, hideResults]);
}

/** Linje 2 i et menupunkt: vinder (eller seneste etapes vinder) og forspring. */
function summaryText(s: EditionSummary, t: Translate): string {
  if (s.kind === "upcoming") return t("editions.upcoming");
  if (s.kind === "unknown") return t("editions.unknown");
  if (s.kind === "progress") return t("editions.progressLine", { done: s.done, total: s.total });
  const who = s.kind === "won" ? t("editions.wonLine", { name: s.name }) : t("editions.stageLine", { stage: s.stage, name: s.name });
  if (s.marginSec == null) return who;
  return `${who}, ${s.marginSec === 0 ? t("editions.sameTime") : t("editions.ahead", { gap: formatMargin(s.marginSec) })}`;
}

interface MenuItem { key: string; to: string; current: boolean; title: ReactNode; detail: string; aside?: string | null }

// #8303 (skitse A): holdets markoer er det godkendte "You"-maerke (samme som v6-startlisten, e41453f8c).
const YOU_MARK = "flex-none rounded-cz bg-cz-1 px-1.5 py-0.5 font-data text-3xs font-bold uppercase tracking-[.08em] text-cz-body";
const POOL_CHIP = "flex-none rounded-cz border border-cz-border bg-cz-subtle px-1.5 py-0.5 font-data text-3xs font-bold uppercase tracking-[.08em] text-cz-2";

const GAP = 6;
const PANEL_WIDTH = 304;

function EditionMenu({ label, ariaLabel, heading, foot, footLink = null, items }: {
  label: ReactNode; ariaLabel: string; heading: string; foot: string; footLink?: { to: string; label: string } | null; items: MenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number | null; bottom: number | null; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const menuId = useRef(`v6-edition-menu-${Math.random().toString(36).slice(2, 8)}`).current;

  const close = useCallback((focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  const reposition = useCallback(() => {
    const anchor = triggerRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const width = Math.min(PANEL_WIDTH, window.innerWidth - 2 * GAP);
    const left = Math.min(Math.max(GAP, r.right - width), window.innerWidth - width - GAP);
    // Codex-fund: på en lav skærm (liggende telefon, otte puljer) må menuen aldrig gå ud over
    // kanten. Den åbner opad, hvis der er mere plads over, og ruller indvendigt i det der er.
    const below = window.innerHeight - r.bottom - 2 * GAP;
    const above = r.top - 2 * GAP;
    const panelH = panelRef.current?.scrollHeight ?? 0;
    const up = panelH > below && above > below;
    setCoords({ left, top: up ? null : r.bottom + GAP, bottom: up ? window.innerHeight - r.top + GAP : null, maxHeight: Math.max(120, up ? above : below) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return undefined;
    const start = Math.max(0, items.findIndex((i) => i.current));
    itemRefs.current[start]?.focus();
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open, items, close]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") { e.preventDefault(); close(true); return; }
    if (e.key === "Tab") { close(false); return; }
    const index = itemRefs.current.findIndex((el) => el === document.activeElement);
    const next = nextMenuFocus(index, items.length, e.key);
    if (next != null) { e.preventDefault(); itemRefs.current[next]?.focus(); }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-cz border border-cz-border bg-cz-card px-2.5 py-1 text-xs font-medium text-cz-1 transition-colors hover:bg-cz-subtle focus-visible:outline-2 focus-visible:outline-cz-accent [@media(max-width:640px),(pointer:coarse)]:min-h-11"
      >
        {label}
        <ChevronDownIcon size={12} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          id={menuId}
          role="menu"
          aria-label={ariaLabel}
          onKeyDown={onKeyDown}
          data-race-editions-menu
          style={{
            position: "fixed",
            left: coords?.left ?? -9999,
            top: coords ? coords.top ?? undefined : -9999,
            bottom: coords?.bottom ?? undefined,
            maxHeight: coords?.maxHeight,
            overflowY: "auto",
            overscrollBehavior: "contain",
            width: Math.min(PANEL_WIDTH, typeof window === "undefined" ? PANEL_WIDTH : window.innerWidth - 2 * GAP),
          }}
          className={`z-dropdown ${menuClass()}`}
        >
          <p className="m-0 px-2.5 pt-1 pb-1.5 font-data text-3xs font-bold uppercase tracking-[.12em] text-cz-3">{heading}</p>
          {items.map((item, i) => (
            <Link
              key={item.key}
              ref={(el) => { itemRefs.current[i] = el; }}
              to={item.to}
              role="menuitem"
              aria-current={item.current ? "page" : undefined}
              onClick={() => close(false)}
              className={`${menuItemClass({ active: item.current })} items-start justify-between`}
            >
              <span className="min-w-0">
                <span className="block font-medium">{item.title}</span>
                <span className="block font-data text-2xs tabular-nums text-cz-2">{item.detail}</span>
              </span>
              {item.aside && <span className="shrink-0 font-data text-xs font-semibold tabular-nums text-cz-1">{item.aside}</span>}
            </Link>
          ))}
          <p className="m-0 mt-1 flex items-center justify-between gap-3 border-t border-cz-border px-2.5 pt-1.5 pb-1 text-2xs text-cz-3">
            <span>{foot}</span>
            {footLink && (
              <Link to={footLink.to} role="menuitem" onClick={() => close(false)} className="inline-flex shrink-0 items-center gap-0.5 font-medium text-cz-1 hover:underline">
                {footLink.label}
                <ChevronRightIcon size={11} aria-hidden="true" />
              </Link>
            )}
          </p>
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * #8303 (skitse A): linjen naar man ser en anden pulje: maerket "Pool X", hvor holdet koerer og
 * hvornaar holdets naeste etape laaser, og "Back to your race". Laasetiden er holdets egen
 * (race_stage_schedule for holdets udgave, naeste etape); mangler raekken, staar saetningen uden.
 */
function OtherPoolLine({ other, currentLetter, tr }: {
  other: NonNullable<EditionSwitchModel["ownElsewhere"]>; currentLetter: string; tr: Translate;
}) {
  const [lockAt, setLockAt] = useState<string | null>(null);
  useEffect(() => {
    setLockAt(null);
    if (other.nextStage == null) return undefined;
    let alive = true;
    supabase.from("race_stage_schedule").select("scheduled_at").eq("race_id", other.raceId).eq("stage_number", other.nextStage).maybeSingle()
      .then(({ data }) => { if (alive) setLockAt(typeof data?.scheduled_at === "string" ? data.scheduled_at : null); },
        () => { /* catch-ok: uden laasetid staar saetningen uden den */ });
    return () => { alive = false; };
  }, [other.raceId, other.nextStage]);
  const when = lockAt && new Date(lockAt).getTime() > Date.now() ? formatRelativeTime(lockAt) : "";
  const params = { own: other.letter ?? "?", tier: other.tier ?? "?", stage: other.nextStage ?? "?", when };
  const text = when
    ? tr(other.sameTier ? "editions.otherPoolLock" : "editions.otherDivisionLock", params)
    : tr(other.sameTier ? "editions.otherPool" : "editions.otherDivision", params);
  return (
    <p data-race-editions-other className="m-0 flex basis-full flex-wrap items-center gap-x-3 gap-y-1 text-xs text-cz-2">
      <span className={POOL_CHIP}>{tr("editions.poolOption", { letter: currentLetter })}</span>
      <span className="min-w-0 flex-1 max-sm:basis-full">{text}</span>
      <Link to={`/races/${other.raceId}`} className="inline-flex items-center gap-1 font-medium text-cz-1 underline-offset-2 hover:underline max-sm:ms-auto">
        {tr("editions.backToYours")}
        <ChevronRightIcon size={12} aria-hidden="true" />
      </Link>
    </p>
  );
}

/** Løbshovedets udgave-skift (række 1, til højre). Intet at skifte imellem = intet tegnet. */
/** `hideResults`: spoiler-skjoldet skjuler en kørt etape i løbet (#7859); menuerne viser da ingen vinder. */
export default function V6EditionSwitch({ raceId, myTeamId, hideResults = false }: { raceId: string | null; myTeamId?: string | number | null; hideResults?: boolean }) {
  const { t, ready } = useTranslation("calendar");
  const model = useEditionSwitch(raceId, myTeamId != null ? String(myTeamId) : null, hideResults);
  if (!ready || !model) return null;
  const tr = t as unknown as Translate;

  const poolItems: MenuItem[] = model.pools.map((p) => ({
    key: p.raceId,
    to: `/races/${p.raceId}`,
    current: p.current,
    title: <span className="inline-flex items-center gap-1.5">{tr("editions.poolOption", { letter: p.letter })}{p.own && <span className={YOU_MARK}>{tr("editions.you")}</span>}</span>,
    detail: summaryText(p.summary, tr),
  }));
  const seasonItems: MenuItem[] = model.seasons.map((s) => ({
    key: s.raceId,
    to: `/races/${s.raceId}`,
    current: s.current,
    title: <>{tr("editions.seasonOption", { number: s.seasonNumber ?? "?" })}{s.live && <span className="ms-1.5 text-2xs font-normal text-cz-3">· {tr("editions.now")}</span>}</>,
    detail: [
      s.tier != null ? tr("editions.divisionLine", { tier: s.tier }) : null,
      summaryText(s.summary, tr),
      s.ownLetter ? tr("editions.yourPoolThatSeason", { letter: s.ownLetter }) : null,
    ].filter(Boolean).join(" · "),
    aside: s.summary.kind === "won" ? s.summary.time : null,
  }));
  const ownPool = model.pools.find((p) => p.own) ?? null;
  const other = model.ownElsewhere;
  const historyLink = model.raceName ? { to: raceArchiveHref(model.raceName, model.raceType), label: tr("editions.raceHistory") } : null;

  return (
    <>
      {/* #8303 (skitse A): ser man en anden pulje, faar hovedets undertitel "· Division N · Pool X". */}
      {other && model.currentLetter && (
        <span data-race-editions-meta className="font-data text-2xs uppercase tracking-[.08em] tabular-nums text-cz-3">
          · {model.tier != null ? `${tr("editions.divisionLine", { tier: model.tier })} · ` : ""}{tr("editions.poolOption", { letter: model.currentLetter })}
        </span>
      )}
      {/* Telefon: menuerne til venstre under navnet (skitse A, 390). */}
      <div data-race-editions className="ms-auto flex items-center gap-2 max-sm:ms-0 max-sm:basis-full">
        {model.pools.length >= 2 && model.currentLetter && (
          <EditionMenu
            label={<>{tr("editions.poolTrigger", { letter: model.currentLetter })}{ownPool?.current && <span className={YOU_MARK}>{tr("editions.you")}</span>}</>}
            ariaLabel={tr("editions.poolMenuAria", { letter: model.currentLetter })}
            heading={tr("editions.poolHeading", { tier: model.tier ?? "?", count: model.pools.length })}
            foot={tr("editions.poolFoot")}
            items={poolItems}
          />
        )}
        {model.seasons.length >= 2 && model.currentSeasonNumber != null && (
          <EditionMenu
            label={tr("editions.seasonTrigger", { number: model.currentSeasonNumber })}
            ariaLabel={tr("editions.seasonMenuAria", { number: model.currentSeasonNumber })}
            heading={tr("editions.seasonHeading")}
            foot={tr("editions.seasonFoot")}
            footLink={historyLink}
            items={seasonItems}
          />
        )}
      </div>
      {other && model.currentLetter && (
        <OtherPoolLine other={other} currentLetter={model.currentLetter} tr={tr} />
      )}
    </>
  );
}

/**
 * Kalenderkortets række "Runs in N pools" med en knap pr. pulje (bag race_page_v6). `twins` er
 * puljetvillingerne fra calendarGrid.poolTwinsByRaceId (samme regel som kalenderens sammenlægning).
 */
export function V6PoolButtons({ twins, ownPoolId, hrefFor, onNavigate, t }: {
  twins: ReadonlyArray<{ id: string | number; poolId: string | number | null; poolIndex: number | null }> | null | undefined;
  ownPoolId?: string | number | null;
  hrefFor: (raceId: string | number) => string;
  onNavigate?: () => void;
  t: Translate;
}) {
  const buttons = (twins || []).map((tw) => ({ ...tw, letter: poolLetter(tw.poolIndex) })).filter((tw) => tw.letter != null);
  if (buttons.length < 2) return null;
  return (
    <div data-race-peek-pools className="flex items-start justify-between gap-4 py-2.5 last:pb-0">
      <dt className="shrink-0 text-cz-2">{t("editions.cardLabel")}</dt>
      <dd className="m-0 min-w-0 text-right">
        <span className="block text-cz-1">{t("editions.cardRuns", { count: buttons.length })}</span>
        <span className="mt-1.5 flex flex-wrap justify-end gap-1.5">
          {buttons.map((b) => {
            const own = ownPoolId != null && b.poolId === ownPoolId;
            return (
              <Link
                key={String(b.id)}
                to={hrefFor(b.id)}
                onClick={onNavigate}
                aria-label={t(own ? "editions.cardPoolOwnAria" : "editions.cardPoolAria", { letter: b.letter })}
                className={`inline-flex min-w-9 items-center justify-center gap-1 rounded-cz border border-cz-border px-2 py-1 font-data text-xs font-semibold tabular-nums transition-colors hover:bg-cz-subtle [@media(max-width:640px),(pointer:coarse)]:min-h-11 [@media(max-width:640px),(pointer:coarse)]:min-w-11 ${own ? "bg-cz-subtle text-cz-1" : "bg-cz-card text-cz-2"}`}
              >
                {b.letter}
                {own && <span aria-hidden="true">·</span>}
              </Link>
            );
          })}
        </span>
      </dd>
    </div>
  );
}
