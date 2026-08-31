// #4296: RaceDaySpan - viser konflikten FØR klikket, ikke efter.
//
// Tre tilstande, tre forskellige mængder blæk:
//   INGEN OVERLAP  -> null. Ingen linje, ingen streg, intet ikon.
//   OVERLAP        -> neutral række (text-cz-2), navngiver modparten og de delte
//                     løbsdage, kan tappes. To løb der deler løbsdage er LOVLIGT.
//   CLASH          -> SAMME boks i bg-cz-danger-bg + text-cz-danger + AlertTriangleIcon,
//                     navngiver RYTTEREN. Først her er noget rent faktisk galt: en
//                     rytter står i begge løb i kladden, og Gem vil afvise det.
//
// HÅRD INVARIANT (raceHubLogic.js): dagtal her kommer UDELUKKENDE fra
// raceDayOverlaps/raceDayClashes' sharedStart/sharedEnd, som selv kun er bygget af
// game_day/game_day_end - aldrig af bindingWindow. Denne komponent regner ALDRIG
// selv "+ 1"; toDisplayRaceDay er eneste vej til et vist tal.
//
// LockIcon er bevidst fravalgt: i puljen betyder den "denne rytter er låst", her
// ville den betyde "disse løb overlapper", og det er ikke samme udsagn.
import { useTranslation } from "react-i18next";
import { ChevronRightIcon, ChevronDownIcon, AlertTriangleIcon } from "../ui";
import { toDisplayRaceDay, countDistinctClashRiders } from "../../lib/raceHubLogic.js";

function overlapLabel(t, o) {
  if (o.sharedStart == null) return t("racehub.popover.blockedReason", { race: o.name });
  const start = toDisplayRaceDay(o.sharedStart);
  const end = toDisplayRaceDay(o.sharedEnd);
  return end > start
    ? t("racehub.column.sharesDays", { start, end, race: o.name })
    : t("racehub.column.sharesDay", { day: start, race: o.name });
}

function overlapItemLabel(t, o) {
  if (o.sharedStart == null) return t("racehub.popover.blockedReason", { race: o.name });
  const start = toDisplayRaceDay(o.sharedStart);
  const end = toDisplayRaceDay(o.sharedEnd);
  return end > start
    ? t("racehub.column.sharesItemDays", { start, end, race: o.name })
    : t("racehub.column.sharesItem", { day: start, race: o.name });
}

function clashLabel(t, o, riderClashes, ridersById) {
  if (riderClashes.length === 1) {
    const day = toDisplayRaceDay(o.sharedStart);
    const rider = ridersById.get(riderClashes[0].riderId)?.name ?? "?";
    if (day != null) return t("racehub.column.clash", { rider, day });
  }
  return t("racehub.column.clashMany", { count: countDistinctClashRiders(riderClashes) });
}

export default function RaceDayOverlapRow({ overlaps = [], clashes = [], ridersById = new Map(), onFocusRace }) {
  const { t } = useTranslation("races");
  if (!overlaps.length) return null;

  const clashesByOther = new Map();
  for (const c of clashes) {
    if (!clashesByOther.has(c.otherId)) clashesByOther.set(c.otherId, []);
    clashesByOther.get(c.otherId).push(c);
  }
  const hasClash = clashesByOther.size > 0;

  const toneClass = (isClash) =>
    isClash
      ? "bg-cz-danger-bg text-cz-danger hover:bg-cz-danger-bg"
      : "text-cz-2 hover:bg-cz-subtle";

  if (overlaps.length === 1) {
    const o = overlaps[0];
    const riderClashes = clashesByOther.get(o.id) || [];
    const isClash = riderClashes.length > 0;
    const label = isClash ? clashLabel(t, o, riderClashes, ridersById) : overlapLabel(t, o);
    return (
      <button
        type="button"
        onClick={() => onFocusRace(o.id)}
        className={`w-full min-h-[32px] flex items-center justify-between gap-2 px-3 py-2 border-b border-cz-border text-start text-2xs tabular-nums ${toneClass(isClash)}`}
      >
        <span className="min-w-0 flex items-center gap-1">
          {isClash && <AlertTriangleIcon size={12} aria-hidden="true" className="shrink-0 mt-px" />}
          <span className="min-w-0 truncate">{label}</span>
        </span>
        <ChevronRightIcon size={13} aria-hidden="true" className="text-cz-3 shrink-0" />
      </button>
    );
  }

  // #4317: `clashes` er én post pr. (riderId, modløb)-par (findSelectionOverlaps).
  // En rytter i konflikt med 3 modløb giver 3 poster - tæl DISTINKTE ryttere, ikke par.
  const totalClashRiders = countDistinctClashRiders(clashes);
  const summaryLabel = hasClash
    ? t("racehub.column.clashMany", { count: totalClashRiders })
    : t("racehub.column.sharesMany", { count: overlaps.length });

  return (
    <details className="group border-b border-cz-border">
      <summary
        className={`min-h-[32px] flex items-center justify-between gap-2 px-3 py-2 cursor-pointer list-none text-2xs tabular-nums ${toneClass(hasClash)}`}
      >
        <span className="min-w-0 flex items-center gap-1">
          {hasClash && <AlertTriangleIcon size={12} aria-hidden="true" className="shrink-0 mt-px" />}
          <span className="min-w-0 truncate">{summaryLabel}</span>
        </span>
        <ChevronDownIcon size={13} aria-hidden="true" className="text-cz-3 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <ul>
        {overlaps.map((o) => {
          const riderClashes = clashesByOther.get(o.id) || [];
          const isClash = riderClashes.length > 0;
          const label = isClash ? clashLabel(t, o, riderClashes, ridersById) : overlapItemLabel(t, o);
          return (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => onFocusRace(o.id)}
                className={`w-full min-h-[32px] flex items-center justify-between gap-2 px-3 py-1.5 text-start text-2xs tabular-nums ${toneClass(isClash)}`}
              >
                <span className="min-w-0 flex items-center gap-1">
                  {isClash && <AlertTriangleIcon size={12} aria-hidden="true" className="shrink-0 mt-px" />}
                  <span className="min-w-0 truncate">{label}</span>
                </span>
                <ChevronRightIcon size={13} aria-hidden="true" className="text-cz-3 shrink-0" />
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
