// #6150: én 1-6-skala ("Good idea?" eller "Important to you?"). Den tidligere
// VoteAxis fra RoadmapPage.jsx flyttet ud, så Plan- og Vote-fanen deler den.
// Knapperne er 28 px på desktop og mindst 34 px på telefon (spec §3.6).
// Skalaens venstrekant står fast (etiketten har fast bredde fra sm), så Vote-
// fanens rækker med og uden andet trin flugter (spec §3.2).
import { SCALE } from "../../lib/roadmapVoting.js";

export interface ScoreScaleProps {
  label: string;
  value: number | null | undefined;
  disabled?: boolean;
  onSelect: (value: number) => void;
}

const OPTION = "rounded-cz text-xs font-semibold border transition-colors disabled:opacity-50";
const OPTION_ON = "bg-cz-accent text-cz-on-accent border-cz-accent";
const OPTION_OFF = "bg-transparent text-cz-2 border-cz-border hover:border-cz-accent";

export interface DontKnowButtonProps {
  label: string;
  pressed: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

// #7788: ét Ved ikke pr. punkt, så knappen hører til rækken og ikke til en akse.
// Den fortrydes ved at vælge et tal. Fra sm flugter den med skalaens venstrekant.
export function DontKnowButton({ label, pressed, disabled = false, onSelect }: DontKnowButtonProps) {
  return (
    <div className="sm:ps-[7.5rem]">
      <button
        type="button"
        aria-pressed={pressed}
        disabled={disabled}
        onClick={pressed ? undefined : onSelect}
        className={`min-h-[34px] sm:min-h-0 sm:h-7 px-2.5 ${OPTION} ${pressed ? OPTION_ON : OPTION_OFF}`}
      >
        {label}
      </button>
    </div>
  );
}

export default function ScoreScale({ label, value, disabled = false, onSelect }: ScoreScaleProps) {
  return (
    <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
      {/* Fast etiket-bredde fra sm: skalaen starter i samme kolonne i alle
          rækker, uanset om "Important to you?" (den længste) står fremme. */}
      <span className="text-cz-3 text-xs sm:w-28 sm:shrink-0">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex gap-1">
        {(SCALE as number[]).map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            disabled={disabled}
            onClick={() => onSelect(n)}
            className={`min-w-[34px] min-h-[34px] sm:min-w-0 sm:min-h-0 sm:w-7 sm:h-7 font-data tabular-nums ${OPTION} ${value === n ? OPTION_ON : OPTION_OFF}`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
