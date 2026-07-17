// RiderResultsTab — Resultater-fanen (#2000, PCS-stil): sæson-totaler øverst
// (Sejre · Løb · Top 5 · Trøjer · Ranking-point · Præmiepenge) med sæsonfilter,
// derunder resultat-tabellen. Etapeløb er udfoldelige: løbsrækken viser GC-linjen
// med chevron; klik folder etape-underrækker + Samlet (GC) ud.
//
// Datalag: lib/riderResultsTab.js over fetchAllRiderSeasonRows-rækkerne (ALLE
// rytterens resultater, paginerede — ikke kun de seneste 20). Terræn kommer fra
// race_pool.terrain_archetype (100 % dækning i prod, verificeret 2026-07-03);
// etapeløb viser "{n} etaper" i terræn-kolonnen som i handoff-prototypen.
//
// Token-only; parent remounter med key={rider.id} så filter/udfoldning nulstilles
// ved rytter-skift i switcheren.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { groupRiderRaces, racesForSeason, riderResultTotals, seasonsInRaces } from "../../../lib/riderResultsTab.js";
import { formatDate, formatNumber } from "../../../lib/intl.js";

// Mobil: Løb | Plac | Point | Præmie. Desktop: + Dato, Klasse, Terræn.
const GRID = "grid grid-cols-[minmax(0,1fr)_40px_44px_80px] sm:grid-cols-[80px_minmax(0,1fr)_78px_86px_48px_52px_96px] gap-2.5 px-4 items-center";
const DESKTOP_ONLY = "hidden sm:block";

function DateCell({ race, seasonLabel }) {
  const dateText = race.date ? formatDate(race.date, null, { day: "numeric", month: "short" }) : "-";
  return (
    <span className={`${DESKTOP_ONLY} font-mono tabular-nums text-[11px] text-cz-3 whitespace-nowrap`}>
      {seasonLabel ? `${seasonLabel} · ${dateText}` : dateText}
    </span>
  );
}

function PosCell({ rank, sub = false }) {
  return (
    <span className={`font-mono tabular-nums font-bold text-right ${sub ? "text-xs" : "text-[13px]"} ${rank === 1 ? "text-cz-accent-t" : sub ? "text-cz-2" : "text-cz-1"}`}>
      {rank ?? "-"}
    </span>
  );
}

function PrizeCell({ prize, sub = false }) {
  return (
    <span className={`font-mono tabular-nums text-right whitespace-nowrap ${sub ? "text-[11px]" : "text-[11.5px]"} ${prize > 0 ? "text-cz-success" : "text-cz-3"}`}>
      {prize > 0 ? `+${formatNumber(prize)}` : "-"}
    </span>
  );
}

function SubRow({ label, rank, points, prize }) {
  return (
    <div className={`${GRID} py-1.5 bg-cz-subtle`}>
      <span className="text-[11.5px] text-cz-2 truncate pl-5 sm:col-start-2">{label}</span>
      <span className={DESKTOP_ONLY} />
      <span className={DESKTOP_ONLY} />
      <PosCell rank={rank} sub />
      <span className="font-mono tabular-nums text-[11px] text-cz-3 text-right">{points > 0 ? formatNumber(points) : "-"}</span>
      <PrizeCell prize={prize} sub />
    </div>
  );
}

export default function RiderResultsTab({ seasonRows, loadFailed = false }) {
  const { t } = useTranslation("rider");
  const races = groupRiderRaces(seasonRows);
  const seasons = seasonsInRaces(races);
  // Default = nyeste sæson med resultater; null = Alle.
  const [season, setSeason] = useState(seasons.length > 0 ? seasons[0] : null);
  const [expanded, setExpanded] = useState({});

  // Fetch-fejl (også midt i pagineringen) vises eksplicit — tomme/trunkerede
  // totaler ville lyve om rytterens sæson (#1338-princippet).
  if (loadFailed) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-5">
        <p className="text-cz-3 text-center py-8">{t("profile.results.loadError")}</p>
      </div>
    );
  }

  if (races.length === 0) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-5">
        <p className="text-cz-3 text-center py-8">{t("results.empty")}</p>
      </div>
    );
  }

  const filtered = racesForSeason(races, season);
  const totals = riderResultTotals(filtered);
  const totalDefs = [
    { key: "wins", value: totals.wins },
    { key: "races", value: totals.races },
    { key: "top5", value: totals.top5 },
    { key: "jerseys", value: totals.jerseys },
    { key: "points", value: formatNumber(totals.points) },
    // Suffiks-konvention som resten af appen (formatCz/Historik): "1.490 CZ$".
    { key: "prize", value: `${formatNumber(totals.prize)} CZ$`, tone: "text-cz-success" },
  ];
  const th = "font-mono text-[9px] font-semibold uppercase tracking-[0.05em] text-cz-3";

  return (
    <div className="flex flex-col gap-[13px]">
      <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0">
            {t("profile.results.totalsTitle")}
          </h3>
          {/* Bevidst IKKE role="tablist": det ville love ARIA-tabs' tastaturkontrakt
              (piletaster + tabpanel). Et filter er en toggle-gruppe — aria-pressed. */}
          <div className="flex gap-1 bg-cz-subtle rounded-lg p-0.5" role="group" aria-label={t("profile.results.filterLabel")}>
            {[...seasons.map((n) => ({ n, label: t("season.row", { n }) })), { n: null, label: t("profile.results.filterAll") }].map((opt) => (
              <button
                key={opt.n ?? "all"}
                type="button"
                aria-pressed={season === opt.n}
                onClick={() => setSeason(opt.n)}
                className={`min-h-[44px] px-3.5 py-1 rounded-md text-[11.5px] font-semibold transition-colors
                  ${season === opt.n ? "bg-cz-card text-cz-1 border border-cz-border" : "border border-transparent text-cz-3 hover:text-cz-1"}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-3 gap-y-3">
          {totalDefs.map((d) => (
            <div key={d.key}>
              <div className={`font-mono tabular-nums text-xl font-bold ${d.tone ?? "text-cz-1"}`}>{d.value}</div>
              <div className="text-[10px] text-cz-3 uppercase tracking-[0.05em]">{t(`profile.results.totals.${d.key}`)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
        <div className={`${GRID} py-2 border-b border-cz-border`}>
          <span className={`${th} ${DESKTOP_ONLY}`}>{t("profile.results.table.date")}</span>
          <span className={th}>{t("profile.results.table.race")}</span>
          <span className={`${th} ${DESKTOP_ONLY}`}>{t("profile.results.table.class")}</span>
          <span className={`${th} ${DESKTOP_ONLY}`}>{t("profile.results.table.terrain")}</span>
          <span className={`${th} text-right`}>{t("profile.results.table.pos")}</span>
          <span className={`${th} text-right`}>{t("profile.results.table.points")}</span>
          <span className={`${th} text-right`}>{t("profile.results.table.prize")}</span>
        </div>

        {filtered.length === 0 ? (
          <p className="text-cz-3 text-center py-8">{t("profile.results.emptySeason")}</p>
        ) : (
          filtered.map((race) => {
            const isStageRace = race.raceType === "stage_race";
            const open = Boolean(expanded[race.raceId]);
            const terrainText = isStageRace
              ? t("profile.results.stagesCount", { n: race.stagesTotal })
              : race.terrain
                ? t(`profile.results.terrain.${race.terrain}`, { defaultValue: "-" })
                : "-";
            const row = (
              <>
                <DateCell race={race} seasonLabel={season == null && race.season != null ? t("profile.results.seasonShort", { n: race.season }) : null} />
                <span className="flex items-center gap-1.5 min-w-0">
                  {isStageRace && (
                    <span className={`text-[9px] text-cz-3 flex-shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`} aria-hidden="true">▸</span>
                  )}
                  {/* #2526: løbsnavnet linker til løbssiden ("se hvem der slog mig").
                      Etapeløbs-rækken er selv en <button> der toggler udfoldning —
                      stopPropagation her forhindrer at et link-klik ALSO toggler den. */}
                  <Link
                    to={`/races/${race.raceId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-[12.5px] text-cz-1 font-semibold truncate hover:text-cz-accent-t transition-colors"
                  >
                    {race.name ?? t("results.fallbackDash")}
                  </Link>
                </span>
                <span className={`${DESKTOP_ONLY} justify-self-start font-mono text-[10px] font-bold tracking-[0.03em] px-1.5 py-[1px] rounded bg-cz-subtle text-cz-2 whitespace-nowrap max-w-full overflow-hidden text-ellipsis`}>
                  {race.raceClass ?? "-"}
                </span>
                <span className={`${DESKTOP_ONLY} text-[11.5px] text-cz-2 whitespace-nowrap overflow-hidden text-ellipsis`}>{terrainText}</span>
                <PosCell rank={race.finalRank} />
                <span className="font-mono tabular-nums text-[11.5px] text-cz-2 text-right">{race.points > 0 ? formatNumber(race.points) : "-"}</span>
                <PrizeCell prize={race.prize} />
              </>
            );
            return (
              <div key={race.raceId} className="border-t border-cz-border first:border-t-0">
                {isStageRace ? (
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setExpanded((prev) => ({ ...prev, [race.raceId]: !prev[race.raceId] }))}
                    className={`${GRID} w-full min-h-[44px] py-2.5 text-left cursor-pointer hover:bg-cz-subtle/60 transition-colors motion-reduce:transition-none`}
                  >
                    {row}
                  </button>
                ) : (
                  <div className={`${GRID} min-h-[44px] py-2.5`}>{row}</div>
                )}
                {isStageRace && open && (
                  <div>
                    {race.stageRows.map((s) => (
                      <SubRow key={s.stage} label={t("profile.results.stageRow", { n: s.stage })} rank={s.rank} points={s.points} prize={s.prize} />
                    ))}
                    {race.finalRank != null && (
                      <SubRow label={t("profile.results.overallRow")} rank={race.finalRank} points={race.gcPoints} prize={race.gcPrize} />
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      <p className="m-0 text-[11px] text-cz-3">{t("profile.results.expandHint")}</p>
    </div>
  );
}
