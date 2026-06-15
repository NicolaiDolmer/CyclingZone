import { useTranslation } from "react-i18next";
import { MountainIcon, FlagIcon } from "../ui/icons/index.jsx";

// Cykel-data-signatur til landing (#672). Det ene skarpe fingeraftryk der gør
// siden distinkt uden AI-slop: en ruteprofil (etape-silhuet med bjergfinale) +
// en afdæmpet samlet stilling med trøje-markører. Proof-of-concept med
// eksempeldata; struktureret så den kan skalere til ægte tal (managers online,
// live-auktioner) senere. Ingen glow, ingen gradient, ingen emoji.

// Ruteprofil-polyline (x 0-600, y hvor lavere = højere terræn). Rolling start,
// nedkørsel, og en afsluttende HC-stigning op til mål til højre.
const PROFILE = [
  [0, 116], [40, 112], [72, 120], [110, 99], [150, 107], [190, 92],
  [232, 122], [272, 126], [304, 118], [344, 129], [364, 121], [400, 92],
  [438, 70], [476, 54], [516, 39], [556, 28], [600, 24],
];
// Stigningen begynder her (x) — segmentet får accent-stroke + et HC-mærke.
const CLIMB_START_INDEX = 11;

const AREA_PATH =
  "M0,150 " +
  PROFILE.map(([x, y]) => `L${x},${y}`).join(" ") +
  " L600,150 Z";
const LINE_PATH = "M" + PROFILE.map(([x, y]) => `${x},${y}`).join(" L");
const CLIMB_PATH =
  "M" + PROFILE.slice(CLIMB_START_INDEX).map(([x, y]) => `${x},${y}`).join(" L");

// Eksempel-stilling. Fiktive ryttere + 3-bogstavs holdkoder (ingen IP).
// jersey: "yellow" = fører, "green" = point, "polka" = bjerg.
const CLASSIFICATION = [
  { pos: 1, rider: "M. Berg", team: "TVR", gap: "—", jersey: "yellow" },
  { pos: 2, rider: "L. Haas", team: "ORC", gap: "+0:34", jersey: null },
  { pos: 3, rider: "J. Voss", team: "ALP", gap: "+1:12", jersey: "green" },
  { pos: 4, rider: "R. Sand", team: "MER", gap: "+1:48", jersey: null },
  { pos: 5, rider: "T. Falk", team: "KBN", gap: "+2:05", jersey: "polka" },
];

// Trøje-markører via design-tokens (ingen rå hex — slop-ratchet #671). Gul = fører
// (accent), grøn = point (success), rød = bjerg (danger); labels bærer betydningen.
const JERSEY_CLASS = {
  yellow: "bg-cz-accent",
  green: "bg-cz-success",
  polka: "bg-cz-danger",
};

function JerseyChip({ jersey, label }) {
  if (!jersey) return <span className="inline-block w-2.5 h-3" aria-hidden="true" />;
  return (
    <span
      className={`inline-block w-2.5 h-3 rounded-[1.5px] ${JERSEY_CLASS[jersey]}`}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}

export default function RaceSignature() {
  const { t } = useTranslation("landing");

  const jerseyLabel = {
    yellow: t("signature.jerseyYellow"),
    green: t("signature.jerseyGreen"),
    polka: t("signature.jerseyPolka"),
  };

  return (
    <figure className="m-0 border border-cz-border bg-cz-card">
      {/* Header-stribe */}
      <figcaption className="flex items-center justify-between gap-3 border-b border-cz-border px-4 py-2.5">
        <span className="font-data text-[11px] uppercase tracking-[0.18em] text-cz-3">
          {t("signature.kicker")}
        </span>
        <span className="flex items-center gap-1.5 text-cz-2">
          <MountainIcon size={14} className="text-cz-accent-t" />
          <span className="font-data text-xs font-medium text-cz-1">{t("signature.stageTitle")}</span>
        </span>
      </figcaption>

      {/* Ruteprofil */}
      <div className="px-4 pt-4">
        <svg
          viewBox="0 0 600 150"
          className="w-full h-auto"
          preserveAspectRatio="none"
          role="img"
          aria-label={t("signature.stageTitle")}
        >
          {/* baseline */}
          <line x1="0" y1="149" x2="600" y2="149" className="stroke-cz-border" strokeWidth="1" />
          {/* terræn-silhuet */}
          <path d={AREA_PATH} className="fill-cz-accent/10" />
          <path d={LINE_PATH} className="fill-none stroke-cz-1/30" strokeWidth="1.5" />
          {/* afsluttende stigning fremhævet */}
          <path d={CLIMB_PATH} className="fill-none stroke-cz-accent-t" strokeWidth="2.5" strokeLinecap="round" />
          {/* mål-markør */}
          <line x1="600" y1="24" x2="600" y2="149" className="stroke-cz-1/25" strokeWidth="1" strokeDasharray="3 3" />
          <circle cx="600" cy="24" r="3" className="fill-cz-accent" />
        </svg>

        {/* Profil-metadata */}
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 border-t border-cz-border pt-3">
          <div className="flex items-center justify-between">
            <dt className="text-[11px] uppercase tracking-wider text-cz-3">{t("signature.distanceLabel")}</dt>
            <dd className="font-data text-xs font-semibold text-cz-1">{t("signature.distanceValue")}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-cz-3">
              <FlagIcon size={12} className="text-cz-3" />
              {t("signature.climbLabel")}
            </dt>
            <dd className="font-data text-xs font-semibold text-cz-1">{t("signature.climbValue")}</dd>
          </div>
        </dl>
      </div>

      {/* Samlet stilling */}
      <div className="mt-4 border-t border-cz-border px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-data text-[11px] uppercase tracking-[0.18em] text-cz-3">
            {t("signature.classificationTitle")}
          </span>
          <span className="font-data text-[11px] uppercase tracking-wider text-cz-3">{t("signature.gapHeader")}</span>
        </div>
        <ol className="flex flex-col">
          {CLASSIFICATION.map((row) => (
            <li
              key={row.pos}
              className="flex items-center gap-3 border-t border-cz-border/60 py-1.5 first:border-t-0"
            >
              <span className="font-data w-4 text-right text-xs tabular-nums text-cz-3">{row.pos}</span>
              <JerseyChip jersey={row.jersey} label={row.jersey ? jerseyLabel[row.jersey] : undefined} />
              <span className="flex-1 truncate text-sm text-cz-1">{row.rider}</span>
              <span className="font-data text-[11px] uppercase tracking-wider text-cz-3">{row.team}</span>
              <span
                className={
                  "font-data w-12 text-right text-xs tabular-nums " +
                  (row.pos === 1 ? "font-semibold text-cz-1" : "text-cz-2")
                }
              >
                {row.gap}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-2.5 text-[11px] leading-relaxed text-cz-3">{t("signature.sampleNote")}</p>
      </div>
    </figure>
  );
}
