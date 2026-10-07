// #6150 · Beta-fanen (spec §3.5): følger kontakterne automatisk via
// roadmap_items.beta_since (triggere i spor 1). "In beta now" + "Coming to
// beta". Fanens ene guld-knap er "Join the beta" i første korts header; den
// fører til den eksisterende ansøgning under Indstillinger (#5259).
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { RoadmapItem } from "../../lib/roadmapModel.ts";
import { CategoryTag, EmptyState, Section, SectionHeader, SectionStack, StatusBadge } from "./roadmapUi.ts";
import { RowMeta, RowTitle, SkeletonRows, TitleCount, ROW, ROW_LIST } from "./RoadmapRows.tsx";
import { areaTitle, localTitle, shortDate } from "./roadmapFormat.ts";
import { buttonClass } from "../ui/buttonStyles.js";
import { CheckIcon, RocketIcon } from "../ui/index.js";

/** Spillerens forhold til beta-gruppen, som /api/me/beta-access udleder det. null = ukendt/udlogget. */
export type BetaState = "member" | "pending" | "rejected" | "none" | null;

export const BETA_APPLY_PATH = "/profile?tab=beta";

export interface BetaTabProps {
  loading: boolean;
  inBeta: RoadmapItem[];
  comingToBeta: RoadmapItem[];
  betaState: BetaState;
  isLoggedIn: boolean;
  isNew: (item: RoadmapItem) => boolean;
  onGoPlan: () => void;
}

function JoinAction({ betaState, isLoggedIn }: { betaState: BetaState; isLoggedIn: boolean }) {
  const { t } = useTranslation("roadmap");
  if (betaState === "member") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-cz-success">
        <CheckIcon size={13} aria-hidden="true" />
        {t("beta.member")}
      </span>
    );
  }
  if (betaState === "pending") {
    return <span className="text-xs font-medium text-cz-3">{t("beta.pending")}</span>;
  }
  return (
    <Link
      to={isLoggedIn ? BETA_APPLY_PATH : "/login"}
      className={buttonClass({ variant: "primary", size: "sm" })}
    >
      {t("beta.join")}
    </Link>
  );
}

export default function BetaTab({ loading, inBeta, comingToBeta, betaState, isLoggedIn, isNew, onGoPlan }: BetaTabProps) {
  const { t, i18n } = useTranslation("roadmap");
  const lang = i18n.language;
  const join = <JoinAction betaState={betaState} isLoggedIn={isLoggedIn} />;

  if (loading) {
    return (
      <Section aria-busy>
        <SectionHeader title={t("beta.inBeta")} action={join} />
        <SkeletonRows />
      </Section>
    );
  }

  if (inBeta.length === 0 && comingToBeta.length === 0) {
    const member = betaState === "member";
    return (
      <EmptyState
        icon={<RocketIcon size={26} aria-hidden="true" />}
        title={member ? t("empty.beta.memberTitle") : t("empty.beta.title")}
        description={t("empty.beta.description")}
        action={member ? (
          <button type="button" onClick={onGoPlan} className={buttonClass({ variant: "secondary", size: "sm" })}>
            {t("empty.beta.memberAction")}
          </button>
        ) : join}
      />
    );
  }

  return (
    <SectionStack>
      <Section>
        <SectionHeader
          title={<TitleCount label={t("beta.inBeta")} count={inBeta.length} />}
          action={join}
          className="mb-1"
        />
        <p className="mb-3 text-cz-3 text-xs">{t("beta.inBetaHint")}</p>
        <ul className={ROW_LIST}>
          {inBeta.map((item) => (
            <li key={item.id} className={`${ROW} flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3`}>
              <div className="sm:w-36 shrink-0 pt-0.5">
                {item.live_soon
                  ? <StatusBadge state="won">{t("beta.badgeSoon")}</StatusBadge>
                  : <StatusBadge state="closing">{t("beta.badgeInBeta")}</StatusBadge>}
              </div>
              <div className="min-w-0">
                <RowTitle isNew={isNew(item)} newLabel={t("labels.new")}>{localTitle(item, lang)}</RowTitle>
                <RowMeta>
                  {areaTitle(t, item.engine)} · {t("beta.since", { date: shortDate(item.beta_since, lang) })}
                </RowMeta>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {comingToBeta.length > 0 && (
        <Section>
          <SectionHeader title={<TitleCount label={t("beta.coming")} count={comingToBeta.length} />} />
          <ul className={ROW_LIST}>
            {comingToBeta.map((item) => (
              <li key={item.id} className={`${ROW} flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3`}>
                <div className="sm:w-36 shrink-0 pt-0.5">
                  <CategoryTag>{t("beta.badgeNext")}</CategoryTag>
                </div>
                <div className="min-w-0">
                  <RowTitle isNew={isNew(item)} newLabel={t("labels.new")}>{localTitle(item, lang)}</RowTitle>
                  <RowMeta>{areaTitle(t, item.engine)}</RowMeta>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </SectionStack>
  );
}
