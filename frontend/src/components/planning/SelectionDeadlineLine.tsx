import { useTranslation } from "react-i18next";
import { AlertTriangleIcon } from "../ui/icons";
import { deadlineCountdown, hasHeaderDeadline, pickHeaderRace, REMINDER_TEXT_TONE_CLASS, type SelectionReminder } from "../../lib/selectionReminder.ts";

// #8069 T01 (TASTE F3): fristen paa Planlaegning er EN linje i sidehovedet
// ("Trup mangler · om 12 t"), ikke en boks mellem hovedet og fanerne. Samme
// server-tal og toner som SelectionDeadlineReminder (#4983); linjen viser den
// naermeste frist, og loebene staar i fanen lige under. Komponenten regner intet
// selv ud over at vaelge den tidligste frist blandt serverens loeb (ved roed tone:
// blandt de roede).
export default function SelectionDeadlineLine({ reminder }: { reminder: SelectionReminder }) {
  const { t } = useTranslation("races");
  if (!hasHeaderDeadline(reminder)) return null;
  const tone = reminder.tone as "warning" | "urgent";
  // Ved roed tone: det tidligste ROEDE loeb (Codex-review #8317), se pickHeaderRace.
  const soonest = pickHeaderRace(reminder);
  if (!soonest) return null;
  const { unit, value } = deadlineCountdown(soonest.hours_until);
  const when = unit === "past" ? t("selectionReminder.deadlinePassed") : t(`selectionReminder.in.${unit}`, { count: value });
  return (
    <span role="status" className={`inline-flex items-center gap-1.5 font-semibold tabular-nums ${REMINDER_TEXT_TONE_CLASS[tone]}`}>
      <AlertTriangleIcon size={13} aria-hidden="true" className="shrink-0" />
      {tone === "urgent" ? t("selectionReminder.titleUrgent") : t("selectionReminder.title")} · {when}
    </span>
  );
}
