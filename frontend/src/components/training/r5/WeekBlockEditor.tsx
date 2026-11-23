import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../ui/Button.jsx";
import Select from "../../ui/Select.jsx";
import { ChevronUpIcon, ChevronDownIcon, LockIcon } from "../../ui/icons/index.jsx";
import type { ProgramWeekDays } from "../../../lib/trainingPrograms.ts";
import {
  draftCellSession, moveWeekBlock, weekPlacement, type Draft, type WeekBlock,
} from "./programR5Model.ts";

export default function WeekBlockEditor({
  dayKeys, today, closed, days, draft, changes, racesFor, settledToday, active, disabled, dayLabel, sessionLabel, onChange,
}: {
  dayKeys: readonly string[];
  today: string;
  closed: boolean;
  days: ProgramWeekDays;
  draft: Draft;
  changes: Record<string, WeekBlock>;
  racesFor: (weekday: string) => number[];
  settledToday?: Record<number, number | null>;
  active: boolean;
  disabled: boolean;
  dayLabel: (weekday: string) => string;
  sessionLabel: (session: string) => string;
  onChange: (weekday: string, block: WeekBlock) => void;
}) {
  const { t } = useTranslation("trainingR5", { keyPrefix: "programR5.weekPriority" });
  const [weekday, setWeekday] = useState(today);
  const current = days[weekday];
  const saved = changes[weekday] ?? {
    slots: Array.from({ length: 5 }, (_, index) => draftCellSession(days, draft, weekday, index) ?? "rest"),
    lockSlot: current?.lockSlot ?? null,
    slotEfforts: current?.slotEfforts?.slice(),
  };
  const block = {
    ...saved,
    slots: saved.slots.map((session, index) => draft[`${weekday}:${index}`] ?? session),
  };
  const editable = !disabled && !(weekday === today && closed);
  const races = racesFor(weekday);
  const dropped = active || changes[weekday]
    ? weekPlacement(block.lockSlot, races, weekday === today ? settledToday : undefined).taken
    : races;

  return (
    <section className="mt-3 rounded-cz border border-cz-border bg-cz-card" aria-label={t("title")} data-testid="program-r5-week-priority">
      <header className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <h3 className="text-sm font-semibold text-cz-1">{t("title")}</h3>
        <Select value={weekday} className="min-h-11 w-auto" aria-label={t("day")}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setWeekday(event.target.value)}>
          {dayKeys.map((day) => <option key={day} value={day}>{dayLabel(day)}</option>)}
        </Select>
      </header>
      <ol>
        {block.slots.map((session, index) => (
          <li key={index} className="flex min-w-0 flex-wrap items-center gap-2 border-t border-cz-border px-3 py-1">
            <span className="font-data text-xs tabular-nums text-cz-2">{index + 1}</span>
            <span className="min-w-24 flex-1 text-xs text-cz-1">{sessionLabel(session)}</span>
            <Button variant="ghost" size="sm" disabled={!editable || index === 0}
              onClick={() => onChange(weekday, moveWeekBlock(block, index, index - 1))} aria-label={t("up", { n: index + 1 })}>
              <ChevronUpIcon size={14} aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="sm" disabled={!editable || index === block.slots.length - 1}
              onClick={() => onChange(weekday, moveWeekBlock(block, index, index + 1))} aria-label={t("down", { n: index + 1 })}>
              <ChevronDownIcon size={14} aria-hidden="true" />
            </Button>
            <Button variant={block.lockSlot === index ? "secondary" : "ghost"} size="sm" disabled={!editable}
              aria-label={t("lock", { n: index + 1 })} aria-pressed={block.lockSlot === index}
              onClick={() => onChange(weekday, { ...block, lockSlot: block.lockSlot === index ? null : index })}>
              <LockIcon size={14} aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ol>
      <p className="flex flex-wrap gap-2 border-t border-cz-border px-3 py-2 text-xs text-cz-2" data-testid="program-r5-races-took">
        <span className="font-semibold text-cz-1">{t("taken")}</span>
        {dropped.length ? dropped.map((index: number) => <s key={index}>{sessionLabel(block.slots[index])}</s>) : "–"}
      </p>
    </section>
  );
}
