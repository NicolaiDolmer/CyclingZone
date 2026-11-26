import { useTranslation } from "react-i18next";
import { isWholeDaySession, type ProgramEffort } from "../../../lib/trainingPrograms.ts";

const LEVELS = ["easy", "normal", "hard"] as const;

export default function ProgramPassSelect({
  session, effort, sessionOrder, sessionLabel, effortLevels, label, className, testId, disabled, onChange,
}: {
  session: string | null;
  effort?: ProgramEffort | null;
  sessionOrder: readonly string[];
  sessionLabel: (session: string) => string;
  effortLevels: boolean;
  label: string;
  className: string;
  testId?: string;
  disabled?: boolean;
  onChange: (session: string, effort?: ProgramEffort | null) => void;
}) {
  const { t } = useTranslation("training");
  const sessions = session && !sessionOrder.includes(session) ? [...sessionOrder, session] : sessionOrder;
  const trainable = sessions.filter((value) => !isWholeDaySession(value));
  const effortLabel = effort && effortLevels && !isWholeDaySession(session) ? t(`dayPanel.level_${effort}`) : null;
  const value = session && effortLabel ? `${session}:${effort}` : session ?? "";
  return (
    <select value={value} aria-label={label} data-testid={testId} disabled={disabled} className={className}
      title={session ? [sessionLabel(session), effortLabel].filter(Boolean).join(" · ") : undefined}
      onChange={(event) => {
        const [next, level] = event.target.value.split(":");
        const explicit = LEVELS.find((item) => item === level);
        onChange(next, effortLevels && !isWholeDaySession(next) ? explicit ?? null : undefined);
      }}>
      {!session && <option value="" disabled>–</option>}
      {sessions.map((item) => <option key={item} value={item}>{sessionLabel(item)}</option>)}
      {effortLevels && LEVELS.map((level) => (
        <optgroup key={level} label={t(`dayPanel.level_${level}`)}>
          {trainable.map((item) => (
            <option key={item} value={`${item}:${level}`}>{sessionLabel(item)} · {t(`dayPanel.level_${level}`)}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
