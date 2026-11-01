// #6570 · "Your day": det foerste efter en koert etape. Top 5 (mobil 3), dine ryttere med
// placering uanset plads, din bedste i det samlede + hullet, en forklarende
// linje og en milepael-linje. Stage/Overall skifter listerne.
//
// Linjen er afledt af resultatet (vinder, margin, din bedste) og ikke af
// loebsloggen: historien om HVORDAN etapen blev koert venter paa spor A's
// kontrakt (#6350), indtil da staar den nuvaerende film under Standings.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DAY_TOP_COUNT, DAY_TOP_COUNT_MOBILE, formatGap, yourDay, type DayRow, type DnfRowInput, type ResultRow } from "./stagePageV2Model.ts";
import { parseGapSeconds } from "../../../lib/raceLiveStandings.js";
import { Button, Flag, RiderLink, Section, Segmented, SkeletonLines } from "./ui.ts";

export interface CareerEvent { id: string | number; event_type: string; rider_id?: string | null; rider_name?: string | null; params?: { stageNumber?: number | null } | null }

const EVENT_LABEL_KEY: Record<string, string> = {
  maiden_win: "maidenWin",
  first_podium: "firstPodium",
  first_jersey: "firstJersey",
  club_milestone_win: "clubMilestoneWin",
};

function Rows({ rows, emptyText, mobileLimit }: { rows: DayRow[]; emptyText?: string; mobileLimit?: number }) {
  const { t } = useTranslation("races");
  if (!rows.length) return emptyText ? <p className="border-t border-cz-border py-2.5 text-sm text-cz-3">{emptyText}</p> : null;
  return (
    <ul>
      {rows.map((r, i) => (
        <li key={r.key} className={`min-h-11 items-center gap-2.5 border-t border-cz-border px-1 ${mobileLimit != null && i >= mobileLimit ? "hidden md:flex" : "flex"} ${r.mine ? "bg-cz-subtle" : ""}`}>
          <span className={`w-9 flex-none text-right font-data font-semibold tabular-nums ${r.status ? "text-2xs text-cz-3" : "text-sm text-cz-1"}`}
            title={r.status === "dns" ? t("detail.incidents.dnsTitle") : undefined}>
            {r.status === "dnf" ? t("detail.incidents.dnf") : r.status === "dns" ? t("detail.incidents.dns") : (r.rank ?? "-")}
          </span>
          {r.nation && <Flag code={r.nation} className="flex-none" />}
          {r.status ? (
            <span className="min-w-0 flex-1 py-1.5">
              <RiderLink id={r.riderId} className="block truncate text-sm font-semibold text-cz-1 hover:text-cz-accent-t">{r.name}</RiderLink>
              {r.reasonKey && <span className="block truncate text-xs text-cz-3">{t(`detail.incidents.${r.reasonKey}`)}</span>}
            </span>
          ) : (
            <RiderLink id={r.riderId} className="min-w-0 flex-1 truncate text-sm font-semibold text-cz-1 hover:text-cz-accent-t">{r.name}</RiderLink>
          )}
          {!r.status && <span className="w-16 flex-none text-right font-data text-xs tabular-nums text-cz-2">{r.gap ?? ""}</span>}
        </li>
      ))}
    </ul>
  );
}

export interface YourDayCardProps {
  /** #7330: etapens udgaaede (dnfRowsForStage); egne vises nederst i "Your riders". */
  dnfRows?: DnfRowInput[];
  results: ResultRow[];
  stageNumber: number;
  isStageRace: boolean;
  loaded: boolean;
  myTeamId: string | null;
  careerEvents: CareerEvent[];
  primaryAction: { label: string; onClick: () => void } | null;
  onOpenStandings: () => void;
}

export default function YourDayCard({ results, stageNumber, isStageRace, loaded, myTeamId, careerEvents, primaryAction, onOpenStandings, dnfRows = [] }: YourDayCardProps) {
  const { t } = useTranslation(["races", "dashboard"]);
  const [cls, setCls] = useState<"stage" | "gc">("stage");
  const stageDay = yourDay(results, stageNumber, myTeamId, "stage", dnfRows);
  // Endagsloeb kan have resultatet som gc-raekker alene.
  const effectiveCls = !isStageRace && !stageDay.top.length ? "gc" : cls;
  const day = effectiveCls === "stage" ? stageDay : yourDay(results, stageNumber, myTeamId, "gc", dnfRows);
  const winner = stageDay.winner ?? day.top[0] ?? null;
  const second = (stageDay.top.length ? stageDay.top : day.top)[1] ?? null;

  let why: string | null = null;
  // Kun et tidshul vi kan laese ("+M:SS") giver en linje; ukendt hul = ingen linje.
  if (winner && second && /^\+?\d+:\d{1,2}$/.test(second.gap ?? "")) {
    const margin = parseGapSeconds(second.gap);
    why = margin > 0
      ? t("stagePageV2.yourDay.whyGap", { winner: winner.name, gap: formatGap(margin), second: second.name })
      : t("stagePageV2.yourDay.whySame", { winner: winner.name, second: second.name });
  }
  const myBest = stageDay.mine[0] ?? null;
  let mineLine: string | null = null;
  if (myBest && myBest.rank === 1) mineLine = t("stagePageV2.yourDay.mineWon", { name: myBest.name });
  else if (myBest && myBest.rank) mineLine = t("stagePageV2.yourDay.mineLine", { name: myBest.name, rank: myBest.rank, gap: myBest.gap ?? "" });

  const milestones = careerEvents
    .filter((e) => (e.params?.stageNumber ?? (isStageRace ? null : 1)) === stageNumber)
    .slice(0, 2);

  return (
    <Section aria-label={isStageRace ? t("stagePageV2.yourDay.title", { number: stageNumber }) : t("stagePageV2.yourDay.titleOneDay")}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="m-0 flex-1 font-data text-[15px] font-semibold text-cz-1">
          {isStageRace ? t("stagePageV2.yourDay.title", { number: stageNumber }) : t("stagePageV2.yourDay.titleOneDay")}
        </h2>
        {isStageRace && (
          <Segmented
            label={t("stagePageV2.yourDay.classAria")}
            value={cls}
            onChange={(v) => setCls(v === "gc" ? "gc" : "stage")}
            options={[{ value: "stage", label: t("stagePageV2.yourDay.stage") }, { value: "gc", label: t("stagePageV2.yourDay.overall") }]}
          />
        )}
      </div>
      {!loaded ? <SkeletonLines lines={6} /> : (
        <>
          {(why || mineLine) && (
            <p className="m-0 mb-4 max-w-[72ch] text-[15px] leading-relaxed text-cz-1">{[why, mineLine].filter(Boolean).join(" ")}</p>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
            <div>
              <div className="mb-1 font-data text-2xs font-semibold uppercase tracking-[.14em] text-cz-3"><span className="md:hidden">{t("stagePageV2.yourDay.topN", { count: DAY_TOP_COUNT_MOBILE })}</span><span className="hidden md:inline">{t("stagePageV2.yourDay.topN", { count: DAY_TOP_COUNT })}</span></div>
              <Rows rows={day.top} mobileLimit={DAY_TOP_COUNT_MOBILE} />
            </div>
            <div>
              <div className="mb-1 font-data text-2xs font-semibold uppercase tracking-[.14em] text-cz-3">{t("stagePageV2.yourDay.yourRiders")}</div>
              <Rows rows={day.mine} emptyText={t("stagePageV2.yourDay.noRiders")} />
            </div>
          </div>
          {isStageRace && day.bestOverall && (
            <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-cz border border-cz-border px-3.5 py-2.5">
              <span className="font-data text-2xs font-semibold uppercase tracking-[.14em] text-cz-3">{t("stagePageV2.yourDay.bestOverall")}</span>
              <b className="font-data text-xl font-semibold tabular-nums text-cz-1">{`#${day.bestOverall.rank}`}</b>
              <span className="font-data text-sm tabular-nums text-cz-2">
                {day.bestOverall.gapToLeader
                  ? t("stagePageV2.yourDay.bestOverallGap", { name: day.bestOverall.name, gap: day.bestOverall.gapToLeader, leader: day.bestOverall.leaderName })
                  : t("stagePageV2.yourDay.bestOverallLeads", { name: day.bestOverall.name })}
              </span>
            </div>
          )}
          {milestones.map((e) => (
            <p key={e.id} className="m-0 mt-3 flex items-center gap-2 text-sm text-cz-2">
              <span className="inline-block h-2 w-2 flex-none rounded-full bg-cz-3" aria-hidden="true" />
              {`${t(`dashboard:cards.maidenWin.headline.${EVENT_LABEL_KEY[e.event_type] ?? "maidenWin"}`)}: ${e.rider_name ?? ""}`}
            </p>
          ))}
        </>
      )}
      <div className="mt-4 flex flex-wrap gap-2.5 border-t border-cz-border pt-4">
        {primaryAction && <Button variant="primary" size="sm" onClick={primaryAction.onClick}>{primaryAction.label}</Button>}
        <Button variant="secondary" size="sm" onClick={onOpenStandings}>{t("stagePageV2.cta.fullResult")}</Button>
      </div>
    </Section>
  );
}
