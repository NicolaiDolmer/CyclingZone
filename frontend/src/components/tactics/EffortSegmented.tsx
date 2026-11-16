// #8297 · Indsatsen på ÉN linje (ejer 16/11 på #7535): let til venstre, hård til højre,
// så rytterens række bliver ca. 44 px høj i stedet for en lodret liste. Bygget på kittets
// Segmented (hairline, 5 px radius, aktivt segment = guld-tekst på 10 % guld-flade).
//
// Trinnene og deres navne kommer ind udefra (etapens trin fra serveren, rollens ord for
// "protect"); et trin der modsiger rytterens ordrer i dag er gråt med grunden som titel.
import { Segmented } from "../race/stagePageV2/ui.ts";
import { effortSegments } from "./tacticsPanelModel.ts";

export interface EffortSegmentedProps {
  /** Gruppens navn for skærmlæsere, fx "Indsats for Rytter A". */
  label: string;
  /** Etapens trin (serverens valid_efforts, gennem effortsForStage). */
  steps: readonly string[];
  value: string;
  labelFor: (step: string) => string;
  /** Grunden (allerede oversat) til at et trin ikke kan vælges i dag, ellers null. */
  blockedReason?: (step: string) => string | null;
  disabled?: boolean;
  onPick: (step: string) => void;
  /** Fuld bredde (telefonens kort): segmenterne deler linjen ligeligt. */
  fill?: boolean;
}

export default function EffortSegmented({ label, steps, value, labelFor, blockedReason, disabled = false, onPick, fill = false }: EffortSegmentedProps) {
  const options = effortSegments(steps).map((step) => {
    const reason = step === value ? null : blockedReason?.(step) ?? null;
    return { value: step, label: labelFor(step), title: reason ?? undefined, disabled: disabled || reason != null };
  });
  return (
    <Segmented
      label={label}
      value={value}
      onChange={(next) => { if (!disabled) onPick(next); }}
      options={options}
      className={`max-w-full ${fill ? "flex w-full [&>button]:min-w-0 [&>button]:flex-1 [&>button]:px-1 [&>button]:leading-tight" : "[&>button]:whitespace-nowrap"}`}
    />
  );
}
