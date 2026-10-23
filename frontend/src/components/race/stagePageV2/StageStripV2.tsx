// #6570 · Den sticky etapestribe: en miniature pr. etape, "Today" paa dagens
// etape, dit resultat paa koerte etaper og starttiden paa kommende. Striben
// ruller selv den valgte etape ind i synsfeltet (kun vandret, aldrig siden).
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { profileLabelKey } from "../../../lib/stageProfileConfig.js";
import { elevationSeries, profileScale, shortName, type StageProfile } from "./stagePageV2Model.ts";
import { TerrainTypeGlyph } from "./ui.ts";

export interface StripStage {
  number: number;
  profile: StageProfile | null;
  timeLabel: string | null;
  myBest: { rank: number; name: string } | null;
}

function Mini({ profile, active }: { profile: StageProfile | null; active: boolean }) {
  const path = useMemo(() => {
    const s = elevationSeries(profile);
    if (!s) return null;
    const D = s.kms[s.kms.length - 1] || 1;
    // Samme faste terraenskala som den store profil (#4107): en flad etape ser
    // flad ud ved siden af en bjergetape, i stedet for at fylde sin egen boks.
    const max = profileScale(profile, s).ceil;
    const step = Math.max(1, Math.floor(s.kms.length / 60));
    const pts: string[] = [];
    for (let i = 0; i < s.kms.length; i += step) pts.push(`L${((s.kms[i] / D) * 100).toFixed(2)},${(30 - (s.hs[i] / max) * 26).toFixed(2)}`);
    pts.push(`L100,${(30 - (s.hs[s.hs.length - 1] / max) * 26).toFixed(2)}`);
    return `M0,30 ${pts.join(" ")} L100,30 Z`;
  }, [profile]);
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="block h-7 w-full" aria-hidden="true">
      {path
        ? <path d={path} fill={active ? "rgb(var(--climb-grad-3))" : "var(--text-3)"} fillOpacity={active ? 0.9 : 0.35} />
        : <line x1={0} x2={100} y1={26} y2={26} stroke="var(--text-3)" strokeOpacity={0.5} strokeWidth={2} />}
    </svg>
  );
}

export interface StageStripV2Props {
  stages: StripStage[];
  selected: number;
  today: number | null;
  ridden: number;
  onSelect: (n: number) => void;
}

export default function StageStripV2({ stages, selected, today, ridden, onSelect }: StageStripV2Props) {
  const { t } = useTranslation("races");
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-stage="${selected}"]`);
    if (!list || !el || list.scrollWidth <= list.clientWidth) return;
    const left = el.offsetLeft - list.offsetLeft;
    const right = left + el.offsetWidth;
    if (left - 16 < list.scrollLeft) list.scrollLeft = Math.max(0, left - 16);
    else if (right + 16 > list.scrollLeft + list.clientWidth) list.scrollLeft = right + 16 - list.clientWidth;
  }, [selected]);

  if (stages.length < 2) return null;
  return (
    <div ref={listRef} className="flex gap-2 overflow-x-auto pb-0.5" role="group" aria-label={t("stagePageV2.stripAria")}>
      {stages.map((s) => {
        const active = s.number === selected;
        const isToday = s.number === today;
        const typeKey = s.profile ? profileLabelKey(s.profile.profile_type) : null;
        const resultLine = s.number <= ridden
          ? (s.myBest ? t("stagePageV2.stripResult", { name: shortName(s.myBest.name), rank: s.myBest.rank }) : t("stagePageV2.stripRidden"))
          : (s.timeLabel ?? "");
        return (
          <button
            key={s.number}
            type="button"
            data-stage={s.number}
            onClick={active ? undefined : () => onSelect(s.number)}
            aria-pressed={active}
            aria-label={t("stagePageV2.stripStage", { number: s.number })}
            className={`min-w-[112px] flex-1 rounded-cz border bg-cz-card px-2.5 py-2 text-left transition-colors ${active ? "border-cz-1" : "cursor-pointer border-cz-border hover:bg-cz-subtle"}`}
          >
            <span className="flex items-center justify-between gap-1.5 font-data text-2xs font-semibold text-cz-1">
              <span>{t("stagePageV2.stripStage", { number: s.number })}</span>
              {/* #6683: ét terræn-ikon pr. etape overalt, også på dagens etape. Dér står
                  "I dag"-mærket i stedet for ikonets tekst, så kortet ikke bliver for bredt. */}
              <span className="flex min-w-0 items-center gap-1">
                {typeKey && s.profile && <TerrainTypeGlyph profileType={s.profile.profile_type} size={16} showLabel={!isToday} className="min-w-0 gap-1" labelClassName="truncate text-3xs font-medium text-cz-3" />}
                {isToday && <span className="rounded-sm border border-cz-1 px-1 py-px text-3xs font-bold uppercase tracking-[.08em] text-cz-1">{t("stagePageV2.today")}</span>}
              </span>
            </span>
            <Mini profile={s.profile} active={active} />
            <span className="mt-1 block truncate font-data text-2xs tabular-nums text-cz-2">{resultLine}</span>
          </button>
        );
      })}
    </div>
  );
}
