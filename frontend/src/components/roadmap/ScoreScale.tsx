// #6150: én 1-6-skala ("Good idea?" eller "Important to you?"). Den tidligere
// VoteAxis fra RoadmapPage.jsx flyttet ud, så Plan- og Vote-fanen deler den.
// Knapperne er 28 px på desktop og mindst 34 px på telefon (spec §3.6).
import { SCALE } from "../../lib/roadmapVoting.js";

export interface ScoreScaleProps {
  label: string;
  value: number | null | undefined;
  disabled?: boolean;
  onSelect: (value: number) => void;
}

export default function ScoreScale({ label, value, disabled = false, onSelect }: ScoreScaleProps) {
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
      <span className="text-cz-3 text-xs">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex gap-1">
        {(SCALE as number[]).map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            disabled={disabled}
            onClick={() => onSelect(n)}
            className={`min-w-[34px] min-h-[34px] sm:min-w-0 sm:min-h-0 sm:w-7 sm:h-7 rounded-cz font-data tabular-nums text-xs font-semibold border transition-colors disabled:opacity-50 ${
              value === n
                ? "bg-cz-accent text-cz-on-accent border-cz-accent"
                : "bg-transparent text-cz-2 border-cz-border hover:border-cz-accent"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
