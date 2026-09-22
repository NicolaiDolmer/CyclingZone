// TrainingScoreSparkline — traeningsscorens kurve (#4851, #5486).
//
// Opskriften er LAAST i docs/design/TASTE.md:40 (fork 5, ejerens valg A
// "monokrom streg"): 2 px streg i `--text-1`, flad `--bg-subtle`-fyld under
// kurven, slutpunktet markeret. Kurven skifter ALDRIG farve efter retning —
// deltaet ved siden af tallet baerer groent/roedt, ikke stregen.
//
// Loebsdage har ingen score (spec §4.4: fladen skriver "loeb", ikke et tal).
// FOER #5486 tegnede kurven et HUL dér (sammenhaengende SEGMENTER med et brud
// per loebsdag). Ejeren (22/9, #5486) aendrede det: loebsdage skal udelades
// helt af SERIEN, saa kurven er ubrudt — ikke vise et hul, ikke vise 0. Derfor
// filtreres `points` gennem `filterTrainingScoreSpark` (lib/trainingScoreView.js)
// FOER x-aksen udregnes: en filtreret loebsdag optager intet slot, saa de
// tilbagevaerende dage tegnes som ÉN sammenhaengende linje. Filteret virker
// ens uanset `training_tick_per_race_day` (spec's flag), fordi det kun kigger
// paa om raekken HAR et tal — ikke paa hvordan raekken blev til.
//
// Hard rule 31: nye frontend-filer skrives i .ts/.tsx, saa filen faar fuld
// strict-daekning fra `frontend/tsconfig.json` med det samme.

import { filterTrainingScoreSpark } from "../../lib/trainingScoreView.js";

// Ét raat punkt fra API'et. `score` er NULLABLE, fordi en loebsdag faar en
// raekke uden tal (backend/lib/trainingScore.js, buildTrainingScoreView) —
// komponenten filtrerer dem selv vaek, se filterTrainingScoreSpark ovenfor.
export type TrainingScorePoint = {
  date: string;
  score: number | null;
  raceDay?: boolean;
};

const VIEW_W = 100;
const VIEW_H = 28;
const PAD = 3;

export default function TrainingScoreSparkline({ points, label, width = VIEW_W, height = VIEW_H }: {
  points: TrainingScorePoint[] | null | undefined;
  label?: string;
  width?: number;
  height?: number;
}) {
  const list = filterTrainingScoreSpark(points);
  if (list.length === 0) return null;

  // Fast 1-99-akse. En auto-skaleret akse ville faa to helt forskellige uger til
  // at ligne hinanden — og scoren ER en absolut skala, ikke en relativ.
  const x = (i: number) => (list.length <= 1 ? width / 2 : PAD + (i / (list.length - 1)) * (width - 2 * PAD));
  const y = (score: number) => PAD + (1 - (Math.max(1, Math.min(99, score)) - 1) / 98) * (height - 2 * PAD);

  const last = list[list.length - 1];
  // Ingen huller tilbage i den filtrerede liste, saa fyldet er ÉN flade under
  // hele kurven i stedet for et fyld pr. segment.
  const fillPath = list.length > 1
    ? `M${x(0)},${height} L${list.map((p, i) => `${x(i)},${y(p.score as number)}`).join(" L")} L${x(list.length - 1)},${height} Z`
    : null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
      className="block overflow-visible"
    >
      {fillPath && <path d={fillPath} className="fill-cz-subtle" />}
      {/* Kun ÉT maalt punkt i hele vinduet: "M x,y" alene tegner intet i SVG,
          saa punktet tegnes som en prik i stedet for en linje. */}
      {list.length === 1 ? (
        <circle cx={x(0)} cy={y(list[0].score as number)} r="2" className="fill-cz-1" />
      ) : (
        <path
          d={`M${list.map((p, i) => `${x(i)},${y(p.score as number)}`).join(" L")}`}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className="stroke-cz-1"
        />
      )}
      <circle cx={x(list.length - 1)} cy={y(last.score as number)} r="2.4" className="fill-cz-1" />
    </svg>
  );
}
