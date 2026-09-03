import { useTranslation } from "react-i18next";
import MonogramAvatar from "../../components/MonogramAvatar";
import { resolveBoardCopy } from "../../lib/boardCopy";
import { resolveMeetingGoalOptionTitle, initialsFromName } from "./meetingFormat";

const CHOICES = ["easier", "keep", "stretch"];

function ChoicePill({ active, disabled, disabledReason, onClick, label }) {
  const base = "rounded-cz-pill border px-3 py-[5px] text-xs font-medium transition-colors duration-150";
  if (active) {
    return (
      <button type="button" onClick={onClick} className={`${base} border-cz-sidebar bg-cz-sidebar font-semibold text-cz-sidebar-1`}>
        {label}
      </button>
    );
  }
  if (disabled) {
    return (
      <button
        type="button"
        disabled
        aria-disabled="true"
        title={disabledReason}
        className={`${base} cursor-not-allowed border-cz-border bg-cz-card text-cz-3`}
      >
        {label}
      </button>
    );
  }
  return (
    <button type="button" onClick={onClick} className={`${base} border-cz-border bg-cz-card text-cz-2 hover:border-cz-3`}>
      {label}
    </button>
  );
}

// #4557 (S-M2c) · Én maal-raekke i "Proposed mandate"-kortet (spec §4.2,
// mockup AnnualMeeting.dc.html). Pille-raekke Easier/Keep/Stretch, inline
// medlems-reaktion ved Easier/Stretch, aldrig et doedt klik (#3012-klassen:
// en null-option vises deaktiveret MED forklaring, ikke skjult).
export default function MandateGoalRow({ goal, choice, onChoose, wouldExceedBudget }) {
  const { t } = useTranslation("board");
  const options = goal.options || {};
  const activeOption = options[choice] || options.keep;
  const title = resolveMeetingGoalOptionTitle(t, goal, activeOption);
  const keepTarget = options.keep?.target;

  const rewardText = choice === "keep"
    ? t("boardroom.meeting.mandate.reward", {
      bonus: activeOption?.satisfaction_bonus ?? 0,
      penalty: activeOption?.satisfaction_penalty ?? 0,
    })
    : t("boardroom.meeting.mandate.rewardWas", {
      bonus: activeOption?.satisfaction_bonus ?? 0,
      penalty: activeOption?.satisfaction_penalty ?? 0,
      was: keepTarget,
    });

  const reaction = choice === "easier" ? goal.reactions?.easier : choice === "stretch" ? goal.reactions?.stretch : null;
  const reactionQuote = reaction ? resolveBoardCopy(t, reaction.textKey, reaction.textFallback) : "";

  return (
    <div className="border-t border-cz-border py-[14px] first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <MonogramAvatar sizeClass="h-7 w-7" initials={goal.owner?.initials} initialsClass="text-2xs" />
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium text-cz-1">
              {title}
              {choice === "stretch" && (
                <span className="ms-1.5 rounded-cz-pill border border-cz-border px-[7px] py-px align-middle text-3xs font-semibold uppercase tracking-[.08em] text-cz-accent-t">
                  {t("boardroom.mandate.stretch")}
                </span>
              )}
            </p>
            <p className="font-data text-2xs uppercase tracking-[.06em] tabular-nums text-cz-3">{rewardText}</p>
          </div>
        </div>
        <div className="flex flex-shrink-0 gap-[6px]">
          {CHOICES.map((choiceKey) => {
            const option = options[choiceKey];
            const isKeep = choiceKey === "keep";
            const missingOption = !isKeep && !option;
            const budgetBlocked = !isKeep && !missingOption && choice !== choiceKey && wouldExceedBudget;
            const disabled = missingOption || budgetBlocked;
            const disabledReason = missingOption
              ? t(choiceKey === "easier" ? "boardroom.meeting.mandate.choiceDisabledEasier" : "boardroom.meeting.mandate.choiceDisabledStretch")
              : budgetBlocked
                ? t("boardroom.meeting.mandate.choiceDisabledBudget")
                : "";
            return (
              <ChoicePill
                key={choiceKey}
                choice={choiceKey}
                active={choice === choiceKey}
                disabled={disabled}
                disabledReason={disabledReason}
                onClick={() => onChoose(choiceKey)}
                label={t(`boardroom.meeting.mandate.choice.${choiceKey}`)}
              />
            );
          })}
        </div>
      </div>
      {reaction && reactionQuote && (
        <div className="ms-10 mt-[10px] flex items-center gap-[10px]">
          <MonogramAvatar navy sizeClass="h-6 w-6" initials={initialsFromName(reaction.memberName)} initialsClass="text-3xs" />
          <p className="text-[12.5px] text-cz-2">
            &ldquo;{reactionQuote}&rdquo; · {t("boardroom.meeting.mandate.reactionAttribution", {
              name: reaction.memberName,
              choice: t(`boardroom.meeting.mandate.choice.${choice}`).toLowerCase(),
            })}
          </p>
        </div>
      )}
    </div>
  );
}
