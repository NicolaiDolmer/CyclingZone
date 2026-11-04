// #6150 · Plan-fanen (spec §3.1): det besluttede, i ejerens rækkefølge.
// #7666: grupperet efter horisont (denne uge, næste uge, denne sæson, næste
// sæson, 2027, senere), så spilleren kan se HVORNÅR noget kommer. Ugerne står
// med datoer. Det der bygges nu, står øverst i sin horisont med et "I gang"-
// eller "I beta"-mærke og har ingen skala; planlagte punkter har én
// ("Important to you?"). 2027 og senere ligger bag en fold.
import { useTranslation } from "react-i18next";
import {
  FOLDED_HORIZONS, planStage, weekRange,
  type PlanGroup, type RoadmapHorizon, type RoadmapItem, type RoadmapVote,
} from "../../lib/roadmapModel.ts";
import { CollapsibleSection, EmptyState, Section, SectionHeader, Button, StatusBadge } from "./roadmapUi.ts";
import ScoreScale from "./ScoreScale.tsx";
import { RowMeta, RowTitle, SaveNote, SkeletonRows, ROW, ROW_LIST } from "./RoadmapRows.tsx";
import { areaTitle, dateRange, localTitle, shortDate, type SaveState } from "./roadmapFormat.ts";
import { CheckIcon, ClipboardIcon } from "../ui/index.js";

export interface PlanTabProps {
  loading: boolean;
  /** Horisont-grupper efter filteret "kun ubedømte" (i gang/beta filtreres aldrig væk). */
  groups: PlanGroup[];
  /** Ejerens nummer pr. planlagt punkt (fra den ufiltrerede liste), så filteret ikke omnummererer. */
  rankById: Map<string, number>;
  /** Hvor mange besluttede punkter (i gang + planlagt) der findes i alt, før filteret. */
  decidedTotal: number;
  /** Hvor mange planlagte punkter der findes i alt, før filteret. */
  plannedTotal: number;
  onlyUnrated: boolean;
  votes: Map<string, RoadmapVote>;
  saveState: Record<string, SaveState>;
  canVote: boolean;
  isNew: (item: RoadmapItem) => boolean;
  onRate: (item: RoadmapItem, value: number) => void;
  onShowAll: () => void;
  onGoVote: () => void;
  /** Til ugernes datoer; kan fastlåses i tests og billeder. */
  now?: Date;
}

function StageBadge({ item }: { item: RoadmapItem }) {
  const { t } = useTranslation("roadmap");
  const stage = planStage(item);
  if (stage === "beta") {
    return item.live_soon
      ? <StatusBadge state="won">{t("beta.badgeSoon")}</StatusBadge>
      : <StatusBadge state="closing">{t("beta.badgeInBeta")}</StatusBadge>;
  }
  if (stage === "in_progress") return <StatusBadge state="info">{t("plan.badgeInProgress")}</StatusBadge>;
  return null;
}

export default function PlanTab(props: PlanTabProps) {
  const { t, i18n } = useTranslation("roadmap");
  const lang = i18n.language;
  const { loading, groups, decidedTotal, plannedTotal, onlyUnrated } = props;
  const now = props.now ?? new Date();

  if (loading) {
    return (
      <Section aria-busy>
        <SectionHeader title={t("plan.title")} />
        <SkeletonRows withScale />
      </Section>
    );
  }

  if (decidedTotal === 0) {
    return (
      <EmptyState
        icon={<ClipboardIcon size={26} aria-hidden="true" />}
        title={t("empty.planNone.title")}
        description={t("empty.planNone.description")}
        action={<Button variant="secondary" size="sm" onClick={props.onGoVote}>{t("empty.planNone.action")}</Button>}
      />
    );
  }

  const horizonDates = (horizon: RoadmapHorizon): string => {
    if (horizon === "this_week" || horizon === "next_week") {
      const { start, end } = weekRange(now, horizon === "this_week" ? 0 : 1);
      return dateRange(start, end, lang);
    }
    return "";
  };

  const renderRow = (item: RoadmapItem) => {
    const planned = item.status === "planned";
    const vote = props.votes.get(item.id);
    const state = props.saveState[item.id];
    const meta = planStage(item) === "beta" && item.beta_since
      ? `${areaTitle(t, item.engine)} · ${t("beta.since", { date: shortDate(item.beta_since, lang) })}`
      : areaTitle(t, item.engine);
    return (
      <li key={item.id} className={`${ROW} flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4`}>
        <div className="flex-1 min-w-0 flex gap-3">
          <span className="w-5 shrink-0 font-data tabular-nums text-xs text-cz-3 pt-0.5 text-right">
            {planned ? props.rankById.get(item.id) ?? "" : ""}
          </span>
          <div className="min-w-0">
            {!planned && <div className="mb-1"><StageBadge item={item} /></div>}
            <RowTitle isNew={props.isNew(item)} newLabel={t("labels.new")}>{localTitle(item, lang)}</RowTitle>
            <RowMeta>{meta}</RowMeta>
          </div>
        </div>
        {planned && props.canVote && (
          <div className="ps-8 sm:ps-0 sm:w-auto flex flex-col gap-1">
            <ScoreScale
              label={t("voting.importance")}
              value={vote?.importance_score}
              disabled={state === "saving"}
              onSelect={(n) => props.onRate(item, n)}
            />
            <SaveNote state={state} savedLabel={t("voting.saved")} errorLabel={t("voting.error")} />
          </div>
        )}
      </li>
    );
  };

  const near = groups.filter((g) => !FOLDED_HORIZONS.has(g.horizon));
  const far = groups.filter((g) => FOLDED_HORIZONS.has(g.horizon));
  const plannedVisible = groups.reduce((n, g) => n + g.items.filter((i) => i.status === "planned").length, 0);
  const allRated = onlyUnrated && plannedTotal > 0 && plannedVisible === 0;

  return (
    <Section>
      <SectionHeader title={t("plan.title")} meta={t("plan.plannedHint")} />
      <div className="flex flex-col gap-5">
        {near.map((g) => {
          const dates = horizonDates(g.horizon);
          return (
            <section key={g.horizon} aria-labelledby={`roadmap-horizon-${g.horizon}`}>
              <div className="flex items-baseline justify-between gap-3 pb-2 border-b border-cz-border">
                <h3 id={`roadmap-horizon-${g.horizon}`} className="text-sm font-semibold text-cz-1">
                  {t(`plan.horizon.${g.horizon}`)}
                  {dates && <span className="ms-2 font-data tabular-nums text-xs font-normal text-cz-3">{dates}</span>}
                </h3>
                <span className="font-data tabular-nums text-xs text-cz-3">{g.items.length}</span>
              </div>
              <ul className={ROW_LIST}>{g.items.map(renderRow)}</ul>
            </section>
          );
        })}

        {allRated && (
          <EmptyState
            icon={<CheckIcon size={26} aria-hidden="true" />}
            title={t("empty.plan.title")}
            description={t("empty.plan.description")}
            action={<Button variant="secondary" size="sm" onClick={props.onShowAll}>{t("empty.plan.action")}</Button>}
          />
        )}

        {far.map((g) => (
          <CollapsibleSection
            key={g.horizon}
            title={t(`plan.horizon.${g.horizon}`)}
            meta={<span className="tabular-nums">{g.items.length}</span>}
          >
            <ul className={ROW_LIST}>{g.items.map(renderRow)}</ul>
          </CollapsibleSection>
        ))}
      </div>
    </Section>
  );
}
