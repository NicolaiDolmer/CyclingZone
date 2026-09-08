// #4943 · Diagram-primitiver til admin-fladen med spørgeskema-resultater.
//
// HVORFOR RÅ SVG/CSS OG IKKE RECHARTS: recharts er allerede en dep og bruges i
// vækst-dashboardet, men den er bygget til tidsserier med akser, tooltips og
// legender. Her er hvert diagram enten en vandret bar-liste (fordelinger) eller
// et enkelt kvadrant-plot, og begge er 20 linjer SVG. Et chart-bibliotek ville
// tilføje en ResponsiveContainer-remount pr. fane og et lag styling der ikke
// kan følge PAGE_TEMPLATES (hairline, 5px radius, tabular figures).
//
// FARVER: én kulør plus neutral blæk. Guld (--accent) bærer det primære tal,
// --text-2/--text-3 bærer det sekundære. ALDRIG en regnbue: rækkerne er ikke
// kategorier der skal skelnes, de er den samme størrelse målt flere gange
// (docs/design/TASTE.md §3, guld er rationeret).

/** Klemmer en bredde til 0-100 så en dårlig værdi ikke kan sprænge layoutet. */
function widthPct(value, max) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

/** Tal med dansk gruppering og tabular figures overalt (PAGE_TEMPLATES). */
export function fmtInt(value) {
  return value == null ? "—" : new Intl.NumberFormat("da-DK").format(value);
}

/** Gennemsnit/score med én decimal; null bliver til en tankestreg. */
export function fmtNum(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("da-DK", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function fmtPct(value) {
  return value == null ? "—" : `${new Intl.NumberFormat("da-DK", { maximumFractionDigits: 1 }).format(value)} %`;
}

/**
 * KPI-flise. Ikke `HeroStats`: det er T3-hero-primitiven, og det her er et
 * gitter af tal på en T2-flade.
 */
export function StatTile({ label, value, sub = null, testId = null }) {
  return (
    <div className="rounded-cz border border-cz-border bg-cz-card p-4" data-testid={testId}>
      <p className="text-2xs uppercase tracking-[.08em] text-cz-3">{label}</p>
      <p className="mt-1 font-data text-[22px] font-bold tabular-nums text-cz-1">{value}</p>
      {sub && <p className="mt-1 text-xs text-cz-3 tabular-nums">{sub}</p>}
    </div>
  );
}

/**
 * Vandret bar-liste: én række pr. valg, sorteret af kalderen.
 * `items`: [{ key, label, value, valueLabel, meta }]
 */
export function BarList({ items, max = null, emptyLabel = null, testId = null }) {
  const ceiling = max ?? items.reduce((top, item) => Math.max(top, item.value ?? 0), 0);
  if (!items.length) {
    return <p className="text-[13px] text-cz-3">{emptyLabel}</p>;
  }
  return (
    <ul className="flex flex-col gap-2.5" data-testid={testId}>
      {items.map((item) => (
        <li key={item.key}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 text-[13px] text-cz-1">{item.label}</span>
            <span className="shrink-0 font-data text-xs font-semibold tabular-nums text-cz-1">
              {item.valueLabel}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 grow overflow-hidden rounded-cz bg-cz-subtle">
              <div className="h-full bg-cz-accent" style={{ width: `${widthPct(item.value, ceiling)}%` }} />
            </div>
            {item.meta && (
              <span className="shrink-0 font-data text-3xs uppercase tracking-[.06em] text-cz-3 tabular-nums">
                {item.meta}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * To tynde bars i én tabelcelle (idé over vigtighed). Guld = idé (spørgsmålets
 * første akse), neutral blæk = vigtighed, så de kan skelnes uden farvesyn.
 */
export function DualBar({ primary, secondary, max = 5, primaryTitle, secondaryTitle }) {
  return (
    <span className="inline-flex w-[86px] flex-col gap-1 align-middle">
      <span className="h-1.5 w-full overflow-hidden rounded-cz bg-cz-subtle" title={primaryTitle}>
        <span className="block h-full bg-cz-accent" style={{ width: `${widthPct(primary, max)}%` }} />
      </span>
      <span className="h-1.5 w-full overflow-hidden rounded-cz bg-cz-subtle" title={secondaryTitle}>
        <span className="block h-full bg-cz-2" style={{ width: `${widthPct(secondary, max)}%` }} />
      </span>
    </span>
  );
}

/**
 * Lodrette dag-bars (svar over tid). CSS og ikke SVG: en SVG der strækkes til
 * kortets bredde (preserveAspectRatio="none") skalerer også teksten, og
 * dato-etiketterne blev trukket ud af form. Flex-kolonner rammer den samme
 * figur med skarpe etiketter i alle bredder.
 * `data`: [{ date, started, completed }]
 */
export function DayBars({ data, height = 128, label, emptyLabel }) {
  if (!data.length) return <p className="text-[13px] text-cz-3">{emptyLabel}</p>;

  const top = Math.max(1, ...data.map((day) => day.started));
  // Højst 12 etiketter: derover overlapper de på 375 px.
  const labelEvery = Math.max(1, Math.ceil(data.length / 12));

  return (
    <div role="img" aria-label={label}>
      {/* Søjlen har et loft på 44 px: med fire dage ville en ren flex-1-søjle
          fylde en fjerdedel af kortet og læse som et fladeareal, ikke som en bar. */}
      <div className="flex items-stretch gap-1.5 border-b border-cz-border" style={{ height }}>
        {data.map((day) => (
          <div key={day.date} className="flex min-w-0 flex-1 items-end justify-center">
            <div
              className="relative w-full max-w-[44px] bg-cz-accent/30"
              style={{ height: `${Math.max((day.started / top) * 100, day.started > 0 ? 2 : 0)}%` }}
              title={`${day.date}: ${day.started} / ${day.completed}`}
            >
              <span
                className="absolute inset-x-0 bottom-0 block bg-cz-accent"
                style={{ height: day.started > 0 ? `${(day.completed / day.started) * 100}%` : 0 }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {data.map((day, index) => (
          <span
            key={day.date}
            className="min-w-0 flex-1 text-center font-data text-3xs tabular-nums text-cz-3"
          >
            {index % labelEvery === 0 ? `${day.date.slice(8)}/${day.date.slice(5, 7)}` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Kvadrant-plot: idé på x, vigtighed på y, midterlinjer ved skalaens midte (3).
 * Øverste højre hjørne er "byg det her". Navnet står i title-elementet, så
 * musen kan læse en prik uden at 20 etiketter skal ligge oven i hinanden.
 * `points`: [{ key, label, x, y, n, rank }]
 */
export function QuadrantChart({ points, axisXLabel, axisYLabel, cornerLabel }) {
  const min = 1;
  const max = 5;
  const pad = 12;
  const span = 100 - pad * 2;
  const toX = (value) => pad + ((value - min) / (max - min)) * span;
  const toY = (value) => pad + span - ((value - min) / (max - min)) * span;
  const mid = 3;

  // Kvadratisk med vilje og derfor bredde-begrænset: de to akser er den samme
  // skala, og et strakt plot ville få en 4,0 på den ene akse til at se større
  // ud end en 4,0 på den anden.
  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label={cornerLabel}
      className="mx-auto block w-full max-w-[540px]"
      style={{ aspectRatio: "1 / 1" }}
    >
      {/* Kvadrant-flade øverst til højre: den eneste flade der er fyldt, fordi
          den er den eneste der betyder noget ved første øjekast. */}
      <rect
        x={toX(mid)} y={toY(max)} width={toX(max) - toX(mid)} height={toY(mid) - toY(max)}
        className="fill-cz-accent/[0.07]"
      />
      <line x1={toX(mid)} y1={toY(min)} x2={toX(mid)} y2={toY(max)} className="stroke-cz-border" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
      <line x1={toX(min)} y1={toY(mid)} x2={toX(max)} y2={toY(mid)} className="stroke-cz-border" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
      <line x1={toX(min)} y1={toY(min)} x2={toX(max)} y2={toY(min)} className="stroke-cz-2" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
      <line x1={toX(min)} y1={toY(min)} x2={toX(min)} y2={toY(max)} className="stroke-cz-2" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />

      {points.map((point) => (
        <g key={point.key}>
          <circle cx={toX(point.x)} cy={toY(point.y)} r="1.6" className="fill-cz-accent">
            <title>{`${point.label} · ${axisXLabel} ${point.x} · ${axisYLabel} ${point.y} · n=${point.n}`}</title>
          </circle>
          {point.rank != null && point.rank <= 5 && (
            <text
              x={toX(point.x) + 2.4}
              y={toY(point.y) + 1}
              className="fill-cz-2 font-data"
              style={{ fontSize: "3px" }}
            >
              {point.rank}
            </text>
          )}
        </g>
      ))}

      {/* Skala-ender, så en prik kan læses som "3,1 af 5" og ikke bare "midtfor". */}
      {[min, max].map((tick) => (
        <text key={`x-${tick}`} x={toX(tick)} y={toY(min) + 3.5} textAnchor="middle" className="fill-cz-3 font-data" style={{ fontSize: "3px" }}>
          {tick}
        </text>
      ))}
      {[min, max].map((tick) => (
        <text key={`y-${tick}`} x={toX(min) - 1.5} y={toY(tick) + 1} textAnchor="end" className="fill-cz-3 font-data" style={{ fontSize: "3px" }}>
          {tick}
        </text>
      ))}

      <text x={toX(max)} y={toY(min) + 7.5} textAnchor="end" className="fill-cz-3 font-data" style={{ fontSize: "3.2px" }}>
        {axisXLabel}
      </text>
      <text
        x={toX(min) - 4} y={toY(max)} textAnchor="start"
        className="fill-cz-3 font-data" style={{ fontSize: "3.2px" }}
        transform={`rotate(-90 ${toX(min) - 4} ${toY(max)})`}
      >
        {axisYLabel}
      </text>
      <text x={toX(max)} y={toY(max) - 2} textAnchor="end" className="fill-cz-3 font-data" style={{ fontSize: "3.2px" }}>
        {cornerLabel}
      </text>
    </svg>
  );
}
