const CURRENT_YEAR = new Date().getFullYear();

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

export default function PotentialeStars({ value, birthdate, showValue = false, large = false }) {
  if (value == null) return <span className="text-slate-300 text-xs">—</span>;

  const age = birthdate ? CURRENT_YEAR - new Date(birthdate).getFullYear() : null;
  const isOld = age !== null && age >= 30;
  const color = isOld ? "#94a3b8" : "#e8c547";
  const emptyColor = "#e2e8f0";

  const stars = [];
  for (let i = 1; i <= 6; i++) {
    if (value >= i) stars.push("full");
    else if (value >= i - 0.5) stars.push("half");
    else stars.push("empty");
  }

  return (
    <span className={`flex items-center gap-px flex-shrink-0 ${large ? "text-lg" : "text-sm"}`}>
      {stars.map((type, i) => (
        <StarIcon key={i} type={type} color={color} emptyColor={emptyColor} />
      ))}
      {showValue && (
        <span className="ml-1 text-[10px] font-mono text-slate-400">{value}</span>
      )}
    </span>
  );
}
