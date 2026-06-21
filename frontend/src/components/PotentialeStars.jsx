import { useId } from "react";

const CURRENT_YEAR = new Date().getFullYear();

// Delt stjerne-geometri (samme path som ui/icons StarIcon) — renderes nu som
// SVG i stedet for ★-glyf, så potentiale-stjernerne deler stroke/fyld-system med
// resten af appen (#671 anti-drift). Farverne kommer fra cz-tokens (ingen rå hex).
const STAR_PATH =
  "M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 17l-5.3 2.6 1.1-6L3.4 9.4l6-.8z";

// Én stjerne med valgfri fraktioneret fyldning. `fill`-laget klippes vandret til
// `fillFraction` (0–1); et evt. `softFraction`-lag (lysere "måske"-tone) ligger
// under. `tone`/`softTone`/`emptyTone` er farve-strenge (rgb(var(--…))).
function Star({ fillFraction = 0, softFraction = 0, tone, softTone, emptyTone, idSuffix }) {
  const clipFull = `cz-star-full-${idSuffix}`;
  const clipSoft = `cz-star-soft-${idSuffix}`;
  return (
    <svg viewBox="0 0 24 24" className="w-[1em] h-[1em] flex-shrink-0" aria-hidden="true">
      <defs>
        <clipPath id={clipSoft}>
          <rect x="0" y="0" width={24 * softFraction} height="24" />
        </clipPath>
        <clipPath id={clipFull}>
          <rect x="0" y="0" width={24 * fillFraction} height="24" />
        </clipPath>
      </defs>
      {/* Tom-baggrund */}
      <path d={STAR_PATH} fill={emptyTone} />
      {/* "Måske"-lag (lysere tone) */}
      {softFraction > 0 && softTone && (
        <path d={STAR_PATH} fill={softTone} clipPath={`url(#${clipSoft})`} />
      )}
      {/* Sikker fyldning */}
      {fillFraction > 0 && (
        <path d={STAR_PATH} fill={tone} clipPath={`url(#${clipFull})`} />
      )}
    </svg>
  );
}

const clamp01 = (n) => Math.max(0, Math.min(1, n));

export default function PotentialeStars({ value, range, label, birthdate, large = false }) {
  // Unik pr. instans, så clipPath-id'er ikke kolliderer mellem flere stjerne-rækker
  // på samme side (SVG-id'er er dokument-globale). Sanitér useId's koloner.
  const uid = useId().replace(/:/g, "");
  const age = birthdate ? CURRENT_YEAR - new Date(birthdate).getFullYear() : null;
  const isOld = age !== null && age >= 30;
  // Token-baserede toner (ingen rå hex): gamle ryttere = neutral (text-3),
  // ellers brand-guld (accent). Lysere "måske"-tone = accent ved lav alpha.
  const tone = isOld ? "rgb(var(--div-3))" : "rgb(var(--accent))";
  const softTone = isOld ? "rgb(var(--div-3) / 0.45)" : "rgb(var(--accent) / 0.45)";
  const emptyTone = "rgb(var(--div-3) / 0.3)";
  const sizeClass = large ? "text-lg" : "text-sm";

  // ── Scoutet estimat-range (usikkert) ──────────────────────────────────────────
  if (range && range.lo != null && range.hi != null && range.lo !== range.hi) {
    const stars = [];
    for (let i = 1; i <= 6; i++) {
      const certain = clamp01(range.lo - (i - 1));
      const uncertain = clamp01(range.hi - (i - 1));
      stars.push({ certain, uncertain });
    }
    return (
      <span className={`flex items-center gap-px flex-shrink-0 ${sizeClass}`}>
        {stars.map((s, i) => (
          <Star key={i} idSuffix={`${uid}r${i}`} fillFraction={s.certain} softFraction={s.uncertain}
            tone={tone} softTone={softTone} emptyTone={emptyTone} />
        ))}
        {label && <span className="ms-1.5 text-[10px] font-medium text-cz-3 whitespace-nowrap">{label}</span>}
      </span>
    );
  }

  // ── Eksakt (kendt) potentiale — klassiske stjerner + valgfri kvalitativ label.
  // #1162/#1242: det rå tal vises ALDRIG (serveren sender det ikke længere);
  // 0,5-trins-stjernerne + label er den fulde indsigt.
  if (value == null) return <span className="text-cz-3 text-xs">—</span>;

  const stars = [];
  for (let i = 1; i <= 6; i++) {
    if (value >= i) stars.push(1);
    else if (value >= i - 0.5) stars.push(0.52);
    else stars.push(0);
  }

  return (
    <span className={`flex items-center gap-px flex-shrink-0 ${sizeClass}`}>
      {stars.map((fillFraction, i) => (
        <Star key={i} idSuffix={`${uid}e${i}`} fillFraction={fillFraction}
          tone={tone} emptyTone={emptyTone} />
      ))}
      {label && <span className="ms-1.5 text-[10px] font-medium text-cz-3 whitespace-nowrap">{label}</span>}
    </span>
  );
}
