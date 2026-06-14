import { trackClass, fillClass, clampPercent } from "./progressStyles.js";

// Hairline-track + accent-fyld (spec B2). Glidende bredde-overgang (cz-progress-fill,
// reduced-motion-aware). Valgfri label + tabular-tal-procent.
export default function ProgressMeter({
  value = 0,
  max = 100,
  tone = "accent",
  label,
  showValue = false,
  ariaLabel,
  className = "",
  trackClassName = "",
  ...rest
}) {
  const pct = clampPercent(value, max);
  return (
    <div className={className} {...rest}>
      {(label || showValue) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          {label ? <span className="text-xs font-medium text-cz-2">{label}</span> : <span />}
          {showValue && (
            <span className="font-data text-xs font-semibold tabular-nums text-cz-1">{Math.round(pct)}%</span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={ariaLabel ?? label}
        className={trackClass({ className: trackClassName })}
      >
        <div className={fillClass({ tone })} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
