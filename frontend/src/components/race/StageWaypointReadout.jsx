import { useTranslation } from "react-i18next";
import RiderLink from "../RiderLink.jsx";
import { passageResultsForWaypoint } from "../../lib/raceStagePassages.js";

// Sub-4 (#2448): detaljen for det valgte waypoint. To tilstande, ikke to
// komponenter: "AT STAKE" før etapen er kørt, "RESULT" når Sub-2 har skrevet
// passage-rækker. Manglende rækker er den NORMALE tilstand før løbet — aldrig
// en fejl-flade (samme ærlig-degraderings-regel som DnfSection/WhyPanel i
// RaceDetailPage.jsx).
const TOP_N = 3;

export default function StageWaypointReadout({ waypoint, passages, stageNumber }) {
  const { t } = useTranslation("races");
  if (!waypoint) return null;

  const results = passageResultsForWaypoint(passages, stageNumber, waypoint.kind, waypoint.index).slice(0, TOP_N);

  const title = waypoint.kind === "kom"
    ? waypoint.name || t("detail.route.waypoint.climb", { cat: waypoint.category })
    : waypoint.kind === "sprint"
      ? t("detail.route.waypoint.sprint")
      : t("detail.route.waypoint.finish");

  const meta = waypoint.kind === "kom"
    ? `${t("detail.route.waypoint.climb", { cat: waypoint.category })} · ${t("detail.route.waypoint.kmMark", { km: waypoint.km })} · ${t("detail.route.waypoint.gradient", { length: Number(waypoint.length_km).toFixed(1), gradient: Number(waypoint.avg_gradient).toFixed(1) })}`
    : t("detail.route.waypoint.kmMark", { km: waypoint.km });

  return (
    <div className="border-t border-cz-border mt-2 pt-2 flex justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <p className="text-cz-1 text-sm font-semibold truncate">{title}</p>
        <p className="text-cz-2 text-[11px] font-mono">{meta}</p>
      </div>
      <div className="text-end min-w-[9rem]">
        <p className="text-cz-3 text-[9px] uppercase tracking-wider font-semibold mb-0.5">
          {results.length ? t("detail.route.result") : t("detail.route.atStake")}
        </p>
        {results.length ? (
          <ul>
            {results.map((r) => (
              <li key={`${r.rider_id}-${r.passage_rank}`} className="text-cz-1 text-[11px] leading-relaxed">
                {r.passage_rank}.{" "}
                <RiderLink id={r.rider_id} className="hover:text-cz-accent-t transition-colors">
                  {r.rider_name || "—"}
                </RiderLink>{" "}
                <span className="text-cz-2 font-mono">
                  {r.points > 0 && `${r.points}p`}
                  {r.points > 0 && r.bonus_seconds > 0 && " · "}
                  {r.bonus_seconds > 0 && t("detail.route.bonusSeconds", { count: r.bonus_seconds })}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-cz-2 text-[11px] font-mono">
            {waypoint.kind === "kom"
              ? t("detail.route.komPoints", { count: waypoint.points })
              : t("detail.route.greenPoints", { count: waypoint.points })}
            {waypoint.bonus > 0 && ` · ${t("detail.route.bonusSeconds", { count: waypoint.bonus })}`}
          </p>
        )}
      </div>
    </div>
  );
}
