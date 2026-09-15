// TrainingScoreSparkline — traeningsscorens kurve (#4851).
//
// Opskriften er LAAST i docs/design/TASTE.md:40 (fork 5, ejerens valg A
// "monokrom streg"): 2 px streg i `--text-1`, flad `--bg-subtle`-fyld under
// kurven, slutpunktet markeret. Kurven skifter ALDRIG farve efter retning —
// deltaet ved siden af tallet baerer groent/roedt, ikke stregen.
//
// Loebsdage har ingen score (spec §4.4: fladen skriver "loeb", ikke et tal), og
// kurven skal have et HUL dér. Punkterne tegnes derfor som sammenhaengende
// SEGMENTER, ikke som én polyline med interpolerede huller — en linje der
// fortsaetter hen over en loebsdag ville paastaa en maaling der ikke findes.

const VIEW_W = 100;
const VIEW_H = 28;
const PAD = 3;

// Sammenhaengende stykker af punkter der HAR et tal.
function segmentsOf(points) {
  const out = [];
  let current = [];
  points.forEach((p, i) => {
    if (Number.isFinite(p?.score)) current.push({ ...p, i });
    else if (current.length) { out.push(current); current = []; }
  });
  if (current.length) out.push(current);
  return out;
}

export default function TrainingScoreSparkline({ points, label, width = VIEW_W, height = VIEW_H }) {
  const list = Array.isArray(points) ? points : [];
  const segments = segmentsOf(list);
  if (segments.length === 0) return null;

  // Fast 1-99-akse. En auto-skaleret akse ville faa to helt forskellige uger til
  // at ligne hinanden — og scoren ER en absolut skala, ikke en relativ.
  const x = (i) => (list.length <= 1 ? width / 2 : PAD + (i / (list.length - 1)) * (width - 2 * PAD));
  const y = (score) => PAD + (1 - (Math.max(1, Math.min(99, score)) - 1) / 98) * (height - 2 * PAD);

  const last = segments[segments.length - 1][segments[segments.length - 1].length - 1];
  // Fyldet lukkes mod bunden pr. segment, saa hullet ogsaa er et hul i fyldet.
  const fillPaths = segments
    .filter((seg) => seg.length > 1)
    .map((seg) => {
      const line = seg.map((p) => `${x(p.i)},${y(p.score)}`).join(" L");
      return `M${x(seg[0].i)},${height} L${line} L${x(seg[seg.length - 1].i)},${height} Z`;
    });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
      className="block overflow-visible"
    >
      {fillPaths.map((d) => (
        <path key={d} d={d} className="fill-cz-subtle" />
      ))}
      {/* Et segment med ÉT punkt giver kun "M x,y", som SVG ikke tegner. Uden
          denne gren ville en maalt dag mellem to loebsdage forsvinde helt —
          hullet ville sluge selve maalingen. Den tegnes som en prik i stedet. */}
      {segments.map((seg) => (seg.length === 1 ? (
        <circle key={seg[0].date} cx={x(seg[0].i)} cy={y(seg[0].score)} r="2" className="fill-cz-1" />
      ) : (
        <path
          key={seg[0].date}
          d={`M${seg.map((p) => `${x(p.i)},${y(p.score)}`).join(" L")}`}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className="stroke-cz-1"
        />
      )))}
      <circle cx={x(last.i)} cy={y(last.score)} r="2.4" className="fill-cz-1" />
    </svg>
  );
}
