// #8298 · Wireframe v6c's små kontroller i taktik-rækken: rollen som knap, Easy | Medium |
// Hard på én linje, rutedelens dropdown med prisordet i farve, og "Extra orders"-chips.
// Kontrollerne ejer ingen regler: valgene og hvad der er spærret kommer fra værten.
import { useRef, useState, type ReactNode } from "react";
import { useDismiss } from "../ui/useDismiss.js";
import { ChevronDownIcon as ChevronDownIconJs } from "../ui/index.js";
import type { TaskCostWord } from "../race/tacticsReady7864.ts";
import { COST_CLASS } from "./TacticsRiderTable.tsx";
import { EFFORT_LEVELS, type EffortLevel } from "./tacticsV6cModel.ts";

type IconProps = { size?: number; className?: string; "aria-hidden"?: boolean | "true" };
const ChevronDownIcon = ChevronDownIconJs as unknown as (props: IconProps) => ReactNode;
const useDismissTyped = useDismiss as unknown as (ref: { current: HTMLElement | null }, onDismiss: () => void, active: boolean) => void;

const TRIGGER = "inline-flex h-7 max-w-full items-center gap-1.5 whitespace-nowrap rounded-cz border border-cz-border bg-cz-card px-2 text-xs text-cz-1 hover:bg-cz-subtle disabled:cursor-not-allowed disabled:opacity-60 [@media(max-width:640px),(pointer:coarse)]:h-11";

/** Rollen ER knappen ("Captain ▾"); et tryk åbner rollens vælger under rækken. */
export function RoleButton({ label, open, disabled, ariaLabel, onClick }: { label: string; open: boolean; disabled: boolean; ariaLabel: string; onClick: () => void }) {
  if (disabled) return <span className="text-xs text-cz-1">{label}</span>;
  return (
    <button type="button" aria-expanded={open} aria-label={ariaLabel} onClick={onClick} className={TRIGGER}>
      {label}
      <ChevronDownIcon size={11} aria-hidden="true" className={open ? "rotate-180" : ""} />
    </button>
  );
}

/**
 * Easy | Medium | Hard på én linje, let til venstre (ejer 16/11 + 17/11). Ingen lyser = rytteren
 * følger holdets plan; et tryk på den valgte knap igen sender ham tilbage dertil (onPick med
 * samme værdi). Samme udseende som kittets Segmented (hairline, aktiv = guld-tekst på 10 % guld).
 */
export function LevelSegmented({ label, value, labelFor, disabled, onPick, fill = false }: { label: string; value: EffortLevel | null; labelFor: (l: EffortLevel) => string; disabled: boolean; onPick: (l: EffortLevel) => void; fill?: boolean }) {
  return (
    <div role="group" aria-label={label} className={`inline-flex max-w-full overflow-hidden rounded-cz border border-cz-border bg-cz-card ${fill ? "flex w-full" : ""}`}>
      {EFFORT_LEVELS.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={value === l}
          disabled={disabled}
          onClick={() => onPick(l)}
          className={`border-s border-cz-border px-2 py-1 text-xs whitespace-nowrap transition-colors duration-150 first:border-s-0 disabled:cursor-not-allowed disabled:opacity-60 [@media(max-width:640px),(pointer:coarse)]:min-h-11 ${fill ? "min-w-0 flex-1" : ""} ${
            value === l ? "bg-cz-accent/10 font-semibold text-cz-accent-t" : "font-medium text-cz-2 hover:text-cz-1"
          }`}
        >
          {labelFor(l)}
        </button>
      ))}
    </div>
  );
}

export interface PickOption { value: string; label: string; cost: TaskCostWord | null }

/** Rutedelens opgave som dropdown: "Stay sheltered Easy ▾", prisordet i sin farve. */
export function PartPicker({ value, options, costLabel, ariaLabel, disabled, onPick }: { value: PickOption; options: PickOption[]; costLabel: (c: TaskCostWord) => string; ariaLabel: string; disabled: boolean; onPick: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useDismissTyped(ref, () => setOpen(false), open);
  const text = (o: PickOption) => (
    <>
      <span className="truncate">{o.label}</span>
      {o.cost && <span className={`font-semibold ${COST_CLASS[o.cost]}`}>{costLabel(o.cost)}</span>}
    </>
  );
  if (disabled) return <span className="inline-flex items-center gap-1.5 text-xs text-cz-1">{text(value)}</span>;
  return (
    <div ref={ref} className="relative inline-block max-w-full">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen((v) => !v)} className={TRIGGER}>
        {text(value)}
        <ChevronDownIcon size={11} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="cz-menu-panel absolute left-0 z-dropdown mt-1 min-w-full rounded-cz border border-cz-border bg-cz-elevated py-1">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value.value}
              onClick={() => { setOpen(false); if (o.value !== value.value) onPick(o.value); }}
              className={`flex w-full items-center justify-between gap-3 whitespace-nowrap px-2.5 py-1.5 text-left text-xs hover:bg-cz-subtle ${o.value === value.value ? "bg-cz-accent/10 text-cz-accent-t" : "text-cz-1"}`}
            >
              {text(o)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "Try the break" / "Sprint train": tændt = guld-tekst på 10 % guld; spærret = grå med grunden. */
export function ExtraChip({ label, on, disabled, reason, onToggle }: { label: string; on: boolean; disabled: boolean; reason: string | null; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      title={reason ?? undefined}
      onClick={onToggle}
      className={`inline-flex h-7 items-center whitespace-nowrap rounded-cz border px-2 text-xs transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 [@media(max-width:640px),(pointer:coarse)]:h-11 ${
        on ? "border-cz-accent bg-cz-accent/10 font-semibold text-cz-accent-t" : "border-cz-border bg-cz-card text-cz-1 hover:bg-cz-subtle"
      }`}
    >
      {label}
    </button>
  );
}
