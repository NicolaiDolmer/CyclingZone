// RiderPalmaresTab — Palmarès-fanen (#1997 S1, rytterside-fundament): den
// redigerede karriereside i ProCyclingStats-stil. Trofæskab (GC-sejre, etape-
// sejre, trøjer, trøjedage, podier) + karrieretotaler/win-rate øverst, derunder
// en sæson-for-sæson æresliste — kun resultater der tæller som palmarès (sejr/
// podie/etapesejr/trøje), med holdet ved hvert resultat (#1993-snapshot).
//
// Bevidst IKKE et duplikat af Resultater-fanen (RiderResultsTab): den fulde
// etape-for-etape-log med midterfelts-placeringer lever der. Palmarès er
// redaktionelt tætpakket — det der ville stå i en rytters CV, ikke en logfil.
//
// Datalag: lib/riderPalmares.js over de samme grupperede løb som Resultater-
// fanen (lib/riderResultsTab.js groupRiderRaces) — ingen dublet-fetch.

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { groupRiderRaces } from "../../../lib/riderResultsTab.js";
import { buildTrophyCase, careerTotals, seasonHonours } from "../../../lib/riderPalmares.js";
import { formatNumber } from "../../../lib/intl.js";

const DAY_TYPES = ["leader", "points_day", "mountain_day", "young_day"];

function achievementLabel(t, a) {
  switch (a.type) {
    case "gcWin":
      return t("profile.palmares.achievement.gcWin");
    case "raceWin":
      return t("profile.palmares.achievement.raceWin");
    case "podium":
      return t(`profile.palmares.achievement.podium${a.rank}`);
    case "stageWin":
      return t("profile.palmares.achievement.stageWin", { n: a.stage });
    case "jerseyWin":
      return t(`profile.palmares.achievement.jersey.${a.jersey}`);
    default:
      return null;
  }
}

function TeamBadge({ name, fallback }) {
  return (
    <span className="font-mono text-[10px] font-bold tracking-[0.03em] px-1.5 py-[1px] rounded bg-cz-subtle text-cz-2 whitespace-nowrap">
      {name ?? fallback}
    </span>
  );
}

function AchievementChip({ label, highlight = false }) {
  return (
    <span
      className={`font-mono text-[10.5px] font-semibold tracking-[0.02em] px-1.5 py-[2px] rounded whitespace-nowrap
        ${highlight ? "bg-cz-accent/10 text-cz-accent-t" : "bg-cz-subtle text-cz-2"}`}
    >
      {label}
    </span>
  );
}

export default function RiderPalmaresTab({ seasonRows, loadFailed = false }) {
  const { t } = useTranslation("rider");

  if (loadFailed) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-5">
        <p className="text-cz-3 text-center py-8">{t("profile.palmares.loadError")}</p>
      </div>
    );
  }

  const races = groupRiderRaces(seasonRows);

  if (races.length === 0) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-6 text-center">
        <h3 className="font-display text-lg tracking-[0.02em] uppercase text-cz-1 m-0 mb-1.5">
          {t("profile.palmares.emptyTitle")}
        </h3>
        <p className="text-cz-3 text-sm m-0">{t("profile.palmares.emptyBody")}</p>
      </div>
    );
  }

  const trophy = buildTrophyCase(races);
  const totals = careerTotals(races);
  const honours = seasonHonours(races);

  const trophyDefs = [
    { key: "gcWins", value: trophy.gcWins },
    { key: "oneDayWins", value: trophy.oneDayWins },
    { key: "stageWins", value: trophy.stageWins },
    { key: "jerseyWins", value: trophy.jerseyWins },
    { key: "jerseyDays", value: trophy.jerseyDays },
    { key: "podiums", value: trophy.podiums },
  ];
  // Trøjedage-breakdown: én linje pr. trøjetype med dage > 0, fuld sætning via
  // ICU-plural i i18n ("Leader jersey · 1 day" / "Førertrøje · 1 dag").
  const jerseyDayLines = DAY_TYPES
    .map((k) => ({ k, n: trophy.jerseyDaysByType[k] || 0 }))
    .filter((d) => d.n > 0);

  const totalDefs = [
    { key: "races", value: totals.totalRaces },
    { key: "winRate", value: `${formatNumber(totals.winRatePct)}%` },
    { key: "points", value: formatNumber(totals.points) },
    { key: "prize", value: `${formatNumber(totals.prize)} CZ$`, tone: "text-cz-success" },
  ];
  const tileLabel = "text-[10px] text-cz-3 uppercase tracking-[0.05em]";

  return (
    <div className="flex flex-col gap-[13px]">
      <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
        <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mb-3">
          {t("profile.palmares.trophyTitle")}
        </h3>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-3 gap-y-3">
          {trophyDefs.map((d) => (
            <div key={d.key}>
              <div className="font-mono tabular-nums text-xl font-bold text-cz-1">{d.value}</div>
              <div className={tileLabel}>{t(`profile.palmares.trophy.${d.key}`)}</div>
            </div>
          ))}
        </div>
        {jerseyDayLines.length > 0 && (
          <div className="mt-3 pt-3 border-t border-cz-border flex flex-col gap-1">
            {jerseyDayLines.map((d) => (
              <p key={d.k} className="m-0 text-[11px] text-cz-2 font-mono tabular-nums">
                {t(`profile.palmares.jerseyDayLine.${d.k}`, { n: d.n })}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
        <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mb-3">
          {t("profile.palmares.totalsTitle")}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-3">
          {totalDefs.map((d) => (
            <div key={d.key}>
              <div className={`font-mono tabular-nums text-xl font-bold ${d.tone ?? "text-cz-1"}`}>{d.value}</div>
              <div className={tileLabel}>{t(`profile.palmares.totals.${d.key}`)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
        <div className="py-2 px-4 border-b border-cz-border">
          <h3 className="font-display text-[15px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0">
            {t("profile.palmares.seasonHonoursTitle")}
          </h3>
        </div>
        {honours.map((entry, idx) => (
          <div key={entry.season} className={`px-4 py-3 ${idx > 0 ? "border-t border-cz-border" : ""}`}>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <h4 className="font-display text-[13px] leading-none tracking-[0.02em] uppercase text-cz-2 m-0">
                {t("season.row", { n: entry.season })}
              </h4>
              {entry.teamNames.length > 0 ? (
                entry.teamNames.map((name) => <TeamBadge key={name} name={name} fallback={t("profile.palmares.teamFallback")} />)
              ) : (
                <TeamBadge name={null} fallback={t("profile.palmares.teamFallback")} />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              {entry.races.map((race) => (
                <div key={race.raceId} className="flex items-start justify-between gap-2 flex-wrap min-h-[28px]">
                  {/* #2526: samme klikbar-løbsnavn-mønster som Resultater-fanen. */}
                  <Link
                    to={`/races/${race.raceId}`}
                    className="text-[12.5px] text-cz-1 font-semibold truncate hover:text-cz-accent-t transition-colors"
                  >
                    {race.name ?? t("results.fallbackDash")}
                  </Link>
                  <div className="flex items-center gap-1 flex-wrap justify-end">
                    {race.achievements.map((a, i) => (
                      <AchievementChip
                        key={i}
                        label={achievementLabel(t, a)}
                        highlight={a.type === "gcWin" || a.type === "raceWin"}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
