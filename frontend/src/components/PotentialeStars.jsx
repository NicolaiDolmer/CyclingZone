const CURRENT_YEAR = new Date().getFullYear();

// Eksakt-stjerne (kendt potentiale): fuld / halv / tom.
function StarIcon({ type, color, emptyColor }) {
  if (type === "full")  return <span style={{ color }} className="leading-none select-none">★</span>;
  if (type === "empty") return <span style={{ color: emptyColor }} className="leading-none select-none">★</span>;
  return (
    <span className="relative inline-block leading-none select-none" style={{ color: emptyColor }}>
      ★
      <span className="absolute inset-0 overflow-hidden leading-none" style={{ width: "52%", color }}>★</span>
    </span>
  );
}

// Range-stjerne (scoutet estimat, #1138): en SIKKER guld-fyldning op til `lo` +
// en lysere "måske"-fyldning op til `hi`. Hver stjerne i dækker 0-6-skalaens
// interval [i-1, i]; fyld-fraktionen for en tærskel t er clamp(t-(i-1),0,1).
function RangeStar({ certain, uncertain, color, uncertainColor, emptyColor }) {
  return (
    <span className="relative inline-block leading-none select-none" style={{ color: emptyColor }}>
      ★
      {uncertain > 0 && (
        <span className="absolute inset-0 overflow-hidden leading-none"
          style={{ width: `${uncertain * 100}%`, color: uncertainColor }}>★</span>
      )}
      {certain > 0 && (
        <span className="absolute inset-0 overflow-hidden leading-none"
          style={{ width: `${certain * 100}%`, color }}>★</span>
      )}
    </span>
  );
}

const clamp01 = (n) => Math.max(0, Math.min(1, n));

export default function PotentialeStars({ value, range, label, birthdate, showValue = false, large = false }) {
  const age = birthdate ? CURRENT_YEAR - new Date(birthdate).getFullYear() : null;
  const isOld = age !== null && age >= 30;
  const color = isOld ? "#94a3b8" : "#e8c547";
  const uncertainColor = isOld ? "#cbd5e1" : "#f3e6a8"; // lysere variant af samme tone
  const emptyColor = "#e2e8f0";
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
          <RangeStar key={i} certain={s.certain} uncertain={s.uncertain}
            color={color} uncertainColor={uncertainColor} emptyColor={emptyColor} />
        ))}
        {label && <span className="ms-1.5 text-[10px] font-medium text-cz-3 whitespace-nowrap">{label}</span>}
      </span>
    );
  }

  // ── Eksakt (kendt) potentiale — uændret klassisk visning ──────────────────────
  if (value == null) return <span className="text-cz-3 text-xs">—</span>;

  const stars = [];
  for (let i = 1; i <= 6; i++) {
    if (value >= i) stars.push("full");
    else if (value >= i - 0.5) stars.push("half");
    else stars.push("empty");
  }

  return (
    <span className={`flex items-center gap-px flex-shrink-0 ${sizeClass}`}>
      {stars.map((type, i) => (
        <StarIcon key={i} type={type} color={color} emptyColor={emptyColor} />
      ))}
      {showValue && (
        <span className="ms-1 text-[10px] font-mono text-cz-3">{value}</span>
      )}
    </span>
  );
}
