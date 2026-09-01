import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Section, SectionHeader, EmptyState, ClipboardIcon, ChevronDownIcon, ChevronUpIcon } from "../../components/ui";
import { formatShortDate, formatWeekdayShortDate } from "./boardroomFormat";

const STATUS_TONE = {
  on_track: "success",
  achieved: "success",
  at_risk: "warning",
  behind: "danger",
  failed: "danger",
};

const TONE_CLASS = {
  success: "text-cz-success bg-cz-success/[.08]",
  warning: "text-cz-warning bg-cz-warning/[.08]",
  danger: "text-cz-danger bg-cz-danger/[.08]",
};

function StatusPill({ status, t }) {
  const tone = STATUS_TONE[status] || "warning";
  return (
    <span className={`inline-block flex-shrink-0 rounded-cz-pill px-2.5 py-[3px] text-2xs font-semibold ${TONE_CLASS[tone]}`}>
      {t(`boardroom.status.${status}`, { defaultValue: status })}
    </span>
  );
}

function GoalOwnerAvatar({ initials }) {
  return (
    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-cz border border-cz-border bg-cz-subtle text-2xs font-semibold text-cz-2">
      {initials}
    </div>
  );
}

// Kvittering — den ENESTE detalje-visning (spec-princip 2 "kvittering for
// alt"). Ingen ny mekanik i denne slice: "Discuss target" er bevidst no-op
// (årsmødet er S-M2c), derfor render som disabled i stedet for en dead-link.
function GoalReceipt({ receipt, t }) {
  if (!receipt) return null;
  return (
    <div className="ms-10 mb-[13px] rounded-cz bg-cz-subtle px-3.5 py-3">
      <p className="text-xs leading-relaxed text-cz-2">
        <span className="font-semibold text-cz-1">{t("boardroom.mandate.receipt.countedPrefix")}</span>{" "}
        {t(receipt.countedKey, receipt.countedParams || {})}
        <br />
        <span className="font-semibold text-cz-1">{t("boardroom.mandate.receipt.lastMovementPrefix")}</span>{" "}
        {t(receipt.lastMovementKey, receipt.lastMovementParams || {})}
        {receipt.lastMovementAt ? `, ${formatWeekdayShortDate(receipt.lastMovementAt)}.` : ""}
        <br />
        {t("boardroom.mandate.receipt.weightedByPrefix", { name: receipt.weightedByName })}{" "}
        {t(receipt.weightedByLineKey, {})}
      </p>
      <p className="mt-2">
        <button type="button" disabled aria-disabled="true"
          className="text-xs font-medium text-cz-3 cursor-not-allowed"
          title={t("boardroom.mandate.discussTargetDisabledHint")}>
          {t("boardroom.mandate.discussTarget")}
        </button>
      </p>
    </div>
  );
}

function GoalRow({ goal, t, expanded, onToggle }) {
  const canExpand = Boolean(goal.receipt);
  const Chevron = expanded ? ChevronUpIcon : ChevronDownIcon;
  return (
    <div className="border-t border-cz-border">
      <div
        role={canExpand ? "button" : undefined}
        tabIndex={canExpand ? 0 : undefined}
        onClick={canExpand ? onToggle : undefined}
        onKeyDown={canExpand ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } } : undefined}
        className={`flex items-center justify-between gap-3 py-[13px] ${canExpand ? "cursor-pointer" : ""}`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <GoalOwnerAvatar initials={goal.owner?.initials} />
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium text-cz-1">
              {t(goal.labelKey, goal.labelParams || {})}
              {goal.isStretch && (
                <span className="ms-1.5 rounded-cz-pill border border-cz-border px-[7px] py-px align-middle text-3xs font-semibold uppercase tracking-[.08em] text-cz-accent-t">
                  {t("boardroom.mandate.stretch")}
                </span>
              )}
            </p>
            <p className="font-data text-2xs uppercase tracking-[.06em] tabular-nums text-cz-3">
              {t("boardroom.mandate.achievedTarget", { achieved: goal.achievedDisplay, target: goal.targetDisplay })}
            </p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <StatusPill status={goal.status} t={t} />
          {canExpand && <Chevron size={14} aria-hidden="true" className="text-cz-3" />}
        </div>
      </div>
      {expanded && <GoalReceipt receipt={goal.receipt} t={t} />}
    </div>
  );
}

export default function MandateCard({ mandate }) {
  const { t } = useTranslation("board");
  const [expandedId, setExpandedId] = useState(null);

  if (!mandate) {
    return (
      <Section>
        <SectionHeader title={t("boardroom.mandate.cardTitleGeneric")} />
        <EmptyState
          icon={<ClipboardIcon size={26} aria-hidden="true" />}
          title={t("boardroom.mandate.empty.title")}
          description={t("boardroom.mandate.empty.description")}
        />
      </Section>
    );
  }

  const goals = mandate.goals || [];

  return (
    <Section>
      <SectionHeader
        title={t("boardroom.mandate.cardTitle", { season: mandate.seasonNumber })}
        meta={t("boardroom.mandate.goalsMeta", { count: goals.length, date: formatShortDate(mandate.signedAt) })}
      />
      <div>
        {goals.map((goal) => (
          <GoalRow
            key={goal.id}
            goal={goal}
            t={t}
            expanded={expandedId === goal.id}
            onToggle={() => setExpandedId((cur) => (cur === goal.id ? null : goal.id))}
          />
        ))}
      </div>
    </Section>
  );
}
