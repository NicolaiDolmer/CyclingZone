import type { ComponentType, ReactNode } from "react";
import SegmentedBase from "../ui/Segmented.jsx";
import { CalendarIcon, TableIcon } from "../ui/icons/index.jsx";
import type { CalendarView } from "../../lib/calendarTable.ts";

// #6683: skifteren bor i sin egen fil, saa CalendarPage kan importere den
// statisk og hente selve tabellen (CalendarTable.tsx) foerst naar den bruges
// (ejer 25/10: kalenderens bundle maa ikke vokse).
type Translate = (key: string, opts?: Record<string, unknown>) => string;
interface SegmentedProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: ReactNode }[];
  className?: string;
}
type IconComponent = ComponentType<{ size?: number; "aria-hidden"?: boolean | "true" }>;

const Segmented = SegmentedBase as unknown as ComponentType<SegmentedProps>;

// "Kalender | Tabel" er den kanoniske Segmented (guld-tekst paa aktivt segment,
// ingen guld-knap). `full`: mobilens segment i fuld bredde oeverst (begge mockups).
export default function CalendarViewSwitch({ t, view, onChange, className = "", full = false }: {
  t: Translate;
  view: CalendarView;
  onChange: (next: CalendarView) => void;
  className?: string;
  full?: boolean;
}) {
  const item = (Icon: IconComponent, label: string) => (
    <span className="inline-flex items-center justify-center gap-1.5">
      <Icon size={14} aria-hidden="true" />
      {label}
    </span>
  );
  return (
    <div className={className} data-testid="calendar-view-switch">
      <Segmented
        label={t("view.label")}
        value={view}
        onChange={(next: string) => onChange(next === "table" ? "table" : "calendar")}
        className={full ? "w-full *:flex-1" : ""}
        options={[
          { value: "calendar", label: item(CalendarIcon, t("view.calendar")) },
          { value: "table", label: item(TableIcon, t("view.table")) },
        ]}
      />
    </div>
  );
}
