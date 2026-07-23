import { useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import StageProfileGraph from "./StageProfileGraph.jsx";
import StageWaypointReadout from "./StageWaypointReadout.jsx";
import { hasRouteData, routeReadKeys, waypointsFor } from "../../lib/stageRouteProfile.js";
import { formatNumber } from "../../lib/intl.js";

// Sub-4 (#2448): kortet der samler stat-linje + race-read + graf + readout.
// GATEN: uden rutedata renderer den INTET — kaldstedet falder tilbage til
// #1484-piktogrammet (RaceDetailPage.jsx's lokale StageProfileCard/
// StageProfileSilhouette). Ingen syntetisk profil, ingen opfundne stigninger.
//
// "summit"/"valley" bruger --jersey-mountain-bg direkte (ingen cz-mountain
// Tailwind-token findes — #671 anti-drift: farven skal komme fra index.css'
// navngivne tokens, ikke en opfundet utility-klasse). "technical" har derimod
// en rigtig cz-accent-utility, så den kan blive en almindelig Tailwind-klasse.
const MOUNTAIN_TONE = { borderColor: "rgb(var(--jersey-mountain-bg) / 0.45)", color: "rgb(var(--jersey-mountain-bg))" };
const READ_TONE_STYLE = { summit: MOUNTAIN_TONE, valley: MOUNTAIN_TONE };
const READ_TONE_CLASS = { technical: "border-cz-accent/50 text-cz-accent-t" };

export default function StageProfileCard({ profile, stageLabel, passages = [], tier = "full", hasClassifications = true }) {
  const { t } = useTranslation("races");
  const waypoints = useMemo(() => waypointsFor(profile), [profile]);
  const reads = useMemo(() => routeReadKeys(profile), [profile]);
  const defaultWp = waypoints.length ? waypoints[waypoints.length - 1] : null;
  const [selected, setSelected] = useState(defaultWp);
  // Skift af etape skal nulstille valget — ellers hænger forrige etapes waypoint.
  useEffect(() => { setSelected(defaultWp); }, [defaultWp]);

  if (!hasRouteData(profile)) return null;
  const stageNumber = profile.stage_number ?? 1;

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-4">
      <div className="flex justify-between items-end gap-4 border-b border-cz-border pb-2 flex-wrap">
        <p className="text-cz-3 text-[10px] uppercase tracking-wider font-semibold">
          {stageLabel || t("detail.stageProfile.label")}
        </p>
        <div className="flex gap-4">
          <div className="text-end">
            <b className="block font-display text-xl text-cz-1 leading-none">{formatNumber(profile.distance_km)}</b>
            <span className="text-cz-3 text-[8px] tracking-widest">{t("detail.route.stats.km")}</span>
          </div>
          {profile.elevation_gain_m > 0 && (
            <div className="text-end">
              <b className="block font-display text-xl text-cz-1 leading-none">{formatNumber(profile.elevation_gain_m)}</b>
              <span className="text-cz-3 text-[8px] tracking-widest">{t("detail.route.stats.elevation")}</span>
            </div>
          )}
          {waypoints.some((w) => w.kind === "kom") && (
            <div className="text-end">
              <b className="block font-display text-xl text-cz-1 leading-none">
                {waypoints.filter((w) => w.kind === "kom").length}
              </b>
              <span className="text-cz-3 text-[8px] tracking-widest">{t("detail.route.stats.climbs")}</span>
            </div>
          )}
        </div>
      </div>

      {reads.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mt-2">
          {reads.map((r) => (
            <span key={r.key}
              className={`inline-flex flex-col gap-px px-2 py-1 border bg-cz-subtle rounded-cz text-[8.5px] font-semibold uppercase tracking-wider
                ${READ_TONE_CLASS[r.key] || "border-cz-border text-cz-2"}`}
              style={READ_TONE_STYLE[r.key]}>
              {t(`detail.route.read.${r.key}.label`, r.params)}
              <em className="not-italic font-mono text-[8px] normal-case tracking-normal text-cz-3">
                {t(`detail.route.read.${r.key}.note`, r.params)}
              </em>
            </span>
          ))}
        </div>
      )}

      <StageProfileGraph
        profile={profile}
        tier={tier}
        width={tier === "full" ? 900 : 430}
        height={tier === "full" ? 340 : 200}
        uid={`sp-${stageNumber}`}
        activeWaypoint={selected}
        onWaypointSelect={setSelected}
        hasClassifications={hasClassifications}
      />

      <StageWaypointReadout waypoint={selected} passages={passages} stageNumber={stageNumber} hasClassifications={hasClassifications} />
    </div>
  );
}
