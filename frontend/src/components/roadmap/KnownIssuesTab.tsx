// #6150 · Known issues (spec §3.3, billede known-issues-to-grupper.png): ét
// fælles områdefilter over to kort. "Confirmed" = fejl ejeren selv har set
// eller fundet årsagen til; "Reported, being checked" = meldt ind, ikke
// bekræftet, og teksten lover ingen ændring. Spilleren ser kun sit eget tryk.
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { issueAreaCounts, type KnownIssue, type KnownIssueUpdate } from "../../lib/roadmapModel.ts";
import { Button, CategoryTag, CollapsibleSection, EmptyState, Section, SectionHeader, SectionStack, Segmented, StatusBadge } from "./roadmapUi.ts";
import { RowMeta, SkeletonRows, TitleCount, ROW, ROW_LIST } from "./RoadmapRows.tsx";
import { areaTitle, localBody, localTitle, shortDate } from "./roadmapFormat.ts";
import { AlertTriangleIcon } from "../ui/index.js";

export interface KnownIssuesTabProps {
  loading: boolean;
  confirmed: KnownIssue[];
  checking: KnownIssue[];
  recentlyFixed: KnownIssue[];
  recentlyDismissed: KnownIssue[];
  updatesByIssue: Map<string, KnownIssueUpdate[]>;
  reports: Set<string>;
  reportError: Set<string>;
  canReport: boolean;
  onToggleReport: (issue: KnownIssue) => void;
  /** Tom tilstand: åbner feedback-fladen (eller login for udloggede). */
  emptyAction: ReactNode;
}

function IssueBadge({ issue }: { issue: KnownIssue }) {
  const { t } = useTranslation("roadmap");
  const label = t(`issues.status.${issue.status}`);
  if (issue.status === "confirmed") return <StatusBadge state="closing">{label}</StatusBadge>;
  if (issue.status === "fixing") return <StatusBadge state="info">{label}</StatusBadge>;
  if (issue.status === "fixed") return <StatusBadge state="won">{label}</StatusBadge>;
  return <CategoryTag>{label}</CategoryTag>;
}

function Updates({ updates }: { updates: KnownIssueUpdate[] }) {
  const { t, i18n } = useTranslation("roadmap");
  if (updates.length === 0) return null;
  const [latest, ...older] = updates;
  const line = (u: KnownIssueUpdate) => (
    <li key={u.id} className="flex gap-3 text-xs leading-relaxed">
      <span className="w-12 shrink-0 font-data tabular-nums text-cz-3">{shortDate(u.created_at, i18n.language)}</span>
      <span className="text-cz-2">{localBody(u, i18n.language)}</span>
    </li>
  );
  return (
    <div className="mt-2">
      <ul className="flex flex-col gap-1">{line(latest)}</ul>
      {older.length > 0 && (
        <details className="mt-1 group">
          <summary className="cursor-pointer list-none text-xs text-cz-3 hover:text-cz-1">
            {t("issues.earlierUpdates", { count: older.length })}
          </summary>
          <ul className="mt-1 flex flex-col gap-1">{older.map(line)}</ul>
        </details>
      )}
    </div>
  );
}

export default function KnownIssuesTab(props: KnownIssuesTabProps) {
  const { t, i18n } = useTranslation("roadmap");
  const lang = i18n.language;
  const [area, setArea] = useState("all");
  const { loading, confirmed, checking, recentlyFixed, recentlyDismissed } = props;

  if (loading) {
    return (
      <SectionStack>
        <Section aria-busy><SectionHeader title={t("issues.confirmed")} /><SkeletonRows /></Section>
        <Section aria-busy><SectionHeader title={t("issues.checking")} /><SkeletonRows /></Section>
      </SectionStack>
    );
  }

  if (confirmed.length === 0 && checking.length === 0 && recentlyFixed.length === 0 && recentlyDismissed.length === 0) {
    return (
      <EmptyState
        icon={<AlertTriangleIcon size={26} aria-hidden="true" />}
        title={t("empty.issues.title")}
        description={t("empty.issues.description")}
        action={props.emptyAction}
      />
    );
  }

  const counts = issueAreaCounts([...confirmed, ...checking]);
  const activeArea = area === "all" || counts.some((c) => c.key === area) ? area : "all";
  const inArea = (list: KnownIssue[]) => (activeArea === "all" ? list : list.filter((i) => i.area === activeArea));
  const options = [
    { value: "all", label: <span>{t("issues.all")} <span className="tabular-nums">{confirmed.length + checking.length}</span></span> },
    ...counts.map((c) => ({ value: c.key, label: <span>{areaTitle(t, c.key)} <span className="tabular-nums">{c.count}</span></span> })),
  ];

  const row = (issue: KnownIssue, buttonLabel: string, meta: string, withButton: boolean) => {
    const reported = props.reports.has(issue.id);
    return (
      <li key={issue.id} className={`${ROW} flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4`}>
        <div className="flex-1 min-w-0">
          <IssueBadge issue={issue} />
          <div className="mt-1 text-cz-1 text-sm leading-relaxed">{localTitle(issue, lang)}</div>
          <RowMeta>{areaTitle(t, issue.area)} · {meta}</RowMeta>
          <Updates updates={props.updatesByIssue.get(issue.id) ?? []} />
        </div>
        {withButton && props.canReport && (
          <div className="flex flex-col items-start sm:items-end gap-1 shrink-0">
            <Button variant="secondary" size="sm" aria-pressed={reported} onClick={() => props.onToggleReport(issue)}>
              {reported ? t("issues.reported") : buttonLabel}
            </Button>
            <div aria-live="polite" className="min-h-[1rem]">
              {props.reportError.has(issue.id) && <span className="text-cz-danger text-xs">{t("issues.reportError")}</span>}
            </div>
          </div>
        )}
      </li>
    );
  };
  const updatedMeta = (i: KnownIssue) => t("issues.updated", { date: shortDate(i.updated_at, lang) });

  const confirmedShown = inArea(confirmed);
  const checkingShown = inArea(checking);

  return (
    <SectionStack>
      {counts.length > 1 && (
        <div className="max-w-full overflow-x-auto">
          <Segmented label={t("issues.areaLabel")} value={activeArea} onChange={setArea} options={options} className="w-max" />
        </div>
      )}

      <Section>
        <SectionHeader
          title={<TitleCount label={t("issues.confirmed")} count={confirmedShown.length} />}
          className="mb-1"
        />
        <p className="mb-2 text-cz-3 text-xs">{t("issues.confirmedHint")}</p>
        {confirmedShown.length > 0 && (
          <ul className={ROW_LIST}>{confirmedShown.map((i) => row(i, t("issues.affectsMe"), updatedMeta(i), true))}</ul>
        )}
      </Section>

      <Section>
        <SectionHeader
          title={<TitleCount label={t("issues.checking")} count={checkingShown.length} />}
          className="mb-1"
        />
        <p className="mb-2 text-cz-3 text-xs">{t("issues.checkingHint")}</p>
        {checkingShown.length > 0 && (
          <ul className={ROW_LIST}>{checkingShown.map((i) => row(i, t("issues.seeToo"), t("issues.reportedByPlayers"), true))}</ul>
        )}
        {recentlyDismissed.length > 0 && (
          <CollapsibleSection className="mt-3" title={t("issues.dismissed")} meta={<span className="tabular-nums">{recentlyDismissed.length}</span>}>
            <ul className={ROW_LIST}>{recentlyDismissed.map((i) => row(i, "", updatedMeta(i), false))}</ul>
          </CollapsibleSection>
        )}
      </Section>

      {recentlyFixed.length > 0 && (
        <CollapsibleSection title={t("issues.fixed")} meta={<span className="tabular-nums">{recentlyFixed.length}</span>}>
          <ul className={ROW_LIST}>{recentlyFixed.map((i) => row(i, "", updatedMeta(i), false))}</ul>
        </CollapsibleSection>
      )}
    </SectionStack>
  );
}
