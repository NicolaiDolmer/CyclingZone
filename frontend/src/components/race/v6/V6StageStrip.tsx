// #7778 udgave E (valg 20-22, ejer 15/11): etapestriben som løbshovedets bund.
//
// Én knap pr. etape: nummer, terræn (ikon + ord), tidspunkt, lille profil
// (StageStripV2's Mini) og en fodlinje (vinder og egen plads, "På vejen" eller
// planens tilstand: Gemt, Standardplan, Ikke gemt; v6StripCells i
// racePageV6Model.ts). Ingen kort i kortet: kun hairlines mellem cellerne. Den
// valgte etape har en mørk kant og aria-current="true", aldrig guld, og
// tilstanden står som et ord, aldrig som en farvet pille (valg 22).
//
// Modern Web Guidance (carousel, scrollability-affordance-hints): vandret
// rullecontainer med scroll-snap "proximity" (cellerne er valg, ikke slides),
// rigtige <button>-pile med aria-label som kantens opakke mærke med hairline
// (ingen gradient-fade, TASTE §3), og den valgte etape rulles ind i syne. Stilen
// bor i index.css (.v6-strip-*). Ægte roving tabindex (v6StripTabStop): ét
// tab-stop i striben; piletaster, Home og End flytter fokus; Enter og mellemrum vælger.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Mini } from "../stagePageV2/StageStripV2.tsx";
import type { StageProfile } from "../stagePageV2/stagePageV2Model.ts";
import { shortName } from "../stagePageV2/stagePageV2Model.ts";
import { TerrainTypeGlyph } from "../stagePageV2/ui.ts";
import { v6StripKeyTarget, v6StripTabStop, type V6PlanState, type V6StripCell } from "./racePageV6Model.ts";

/** Ordet for planens tilstand (racePageV6.strip.*; "Gemt" er ordet overalt, valg 7). */
const PLAN_STATE_KEY: Record<V6PlanState, string> = {
  saved: "racePageV6.strip.planSaved",
  default: "racePageV6.strip.planDefault",
  not_saved: "racePageV6.strip.planNotSaved",
};
import { ChevronLeftIcon, ChevronRightIcon } from "./v6Ui.ts";

export interface V6StageStripProps {
  cells: V6StripCell[];
  profileByStage: Record<number, StageProfile | null | undefined>;
  selected: number;
  onSelect: (n: number) => void;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function V6StageStrip({ cells, profileByStage, selected, onSelect }: V6StageStripProps) {
  const { t } = useTranslation("races");
  const listRef = useRef<HTMLDivElement | null>(null);
  const [more, setMore] = useState({ start: false, end: false });
  // Roving tabindex: etapen fokus sidst stod på i striben, husket sammen med det valg,
  // den hører til. Et nyt valg flytter derfor tab-stoppet med (uden en effekt).
  const [focus, setFocus] = useState<{ stage: number; selected: number } | null>(null);
  const setFocused = (stage: number) => setFocus({ stage, selected });
  const tabStop = v6StripTabStop(cells.map((c) => c.number), focus && focus.selected === selected ? focus.stage : null, selected);

  const measure = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const next = { start: el.scrollLeft > 1, end: el.scrollLeft < max - 1 };
    setMore((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return undefined;
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, cells.length]);

  // Den valgte etape rulles ind i syne, kun vandret i striben. Kun når cellen står
  // uden for synsfeltet, og kun når striben selv er synlig på skærmen, så et
  // etapeskift aldrig flytter siden lodret (samme hensyn som Tabs.jsx, #3200).
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-stage="${selected}"]`);
    if (!list || !el || list.scrollWidth <= list.clientWidth) return;
    const lr = list.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    if (er.left >= lr.left && er.right <= lr.right) return;
    if (lr.top < 0 || lr.bottom > window.innerHeight) return;
    el.scrollIntoView({ block: "nearest", inline: "nearest", container: "nearest" } as ScrollIntoViewOptions);
  }, [selected]);

  const page = (dir: -1 | 1) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.8), behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = Number((document.activeElement as HTMLElement | null)?.dataset?.stage);
    if (!Number.isFinite(current)) return;
    const target = v6StripKeyTarget(e.key, current, cells.length);
    if (target === null) return;
    e.preventDefault();
    setFocused(target);
    const btn = listRef.current?.querySelector<HTMLElement>(`[data-stage="${target}"]`);
    btn?.focus({ preventScroll: true });
    btn?.scrollIntoView({ block: "nearest", inline: "nearest", container: "nearest" } as ScrollIntoViewOptions);
  };

  if (cells.length < 2) return null;
  return (
    <div data-race-strip className="flex items-stretch border-t border-cz-border">
      <button type="button" className="v6-strip-nav border-e" aria-label={t("racePageV6.strip.earlier")} disabled={!more.start} onClick={() => page(-1)}>
        <ChevronLeftIcon size={16} aria-hidden="true" />
      </button>
      <div
        ref={listRef}
        role="group"
        aria-label={t("stagePageV2.stripAria")}
        className="v6-strip-scroller flex min-w-0 flex-1"
        onScroll={measure}
        onKeyDown={onKeyDown}
      >
        {cells.map((c) => {
          const active = c.number === selected;
          const profile = profileByStage[c.number] ?? null;
          return (
            <button
              key={c.number}
              type="button"
              data-stage={c.number}
              aria-current={active ? "true" : undefined}
              tabIndex={c.number === tabStop ? 0 : -1}
              onFocus={() => setFocused(c.number)}
              onClick={() => onSelect(c.number)}
              className={`v6-strip-cell min-w-[172px] flex-1 sm:min-w-[148px] border-e border-cz-border px-3 pt-2 pb-2 text-left last:border-e-0 cursor-pointer ${active ? "" : "hover:bg-cz-subtle"}`}
            >
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="sr-only">{t("stagePageV2.stripStage", { number: c.number })}</span>
                <span aria-hidden="true" className="font-data text-sm font-semibold tabular-nums text-cz-1">{c.number}</span>
                {c.profileType && (
                  <TerrainTypeGlyph profileType={c.profileType} size={14} showLabel className="min-w-0 gap-1" labelClassName="truncate text-xs text-cz-3" />
                )}
                {c.when && <span className="ms-auto ps-1 font-data text-xs tabular-nums text-cz-2">{c.when}</span>}
              </span>
              <Mini profile={profile} active={active} className="mt-1.5 mb-1 block h-[18px] w-full" />
              <span data-strip-foot={c.foot.kind} className="block truncate font-data text-xs tabular-nums text-cz-2">
                {c.foot.kind === "ridden" && (
                  c.foot.winner || c.foot.myRank != null
                    ? <>
                        {c.foot.winner && <span className="font-semibold text-cz-1">{shortName(c.foot.winner)}</span>}
                        {c.foot.winner && c.foot.myRank != null && " · "}
                        {c.foot.myRank != null && t("racePageV6.strip.you", { rank: c.foot.myRank })}
                      </>
                    : t("stagePageV2.stripRidden")
                )}
                {c.foot.kind === "on_road" && <span className="font-semibold uppercase tracking-[.07em] text-cz-1 text-3xs">{t("racePage.hero.chipRacing")}</span>}
                {c.foot.kind === "plan" && (
                  // Kun "Ikke gemt" står med vægt: det er den tilstand, der beder om en handling.
                  <span data-plan-state={c.foot.state} className={c.foot.state === "not_saved" ? "font-semibold text-cz-1" : undefined}>{t(PLAN_STATE_KEY[c.foot.state])}</span>
                )}
                {c.foot.kind === "none" && " "}
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" className="v6-strip-nav border-s" aria-label={t("racePageV6.strip.later")} disabled={!more.end} onClick={() => page(1)}>
        <ChevronRightIcon size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
