import I18nReadyGate from "../I18nReadyGate.jsx";
import { useMemo } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  HeroStats,
  Tabs,
  TabList,
  Tab,
  Section,
  EmptyState,
  SkeletonLines,
  Select,
  StatusBadge,
  ChevronLeftIcon,
} from "../ui/index.js";
import { DataTable, ErrorState } from "./ui.ts";
import { editionDate, editionHref } from "./RaceLibrary.tsx";
import {
  useLibraryContext,
  useLibraryRequest,
  resolveLibraryScope,
  raceLibraryReader,
} from "../../hooks/useRaceLibrary.ts";
import { toDisplayRaceDay } from "../../lib/raceHubLogic.js";
import { formatNumber } from "../../lib/intl.js";
import type { RaceEditionSummary, LibraryProfile } from "../../lib/race-library/types.ts";
type Sector = { start_km: number; length_km: number };
function sectorsOf(profile: LibraryProfile | null): Sector[] {
  if (!Array.isArray(profile?.sectors)) return [];
  return profile.sectors.filter(
    (s): s is Sector =>
      Boolean(s) &&
      typeof s === "object" &&
      Number.isFinite(s.start_km) &&
      Number.isFinite(s.length_km) &&
      s.start_km >= 0 &&
      s.length_km > 0
  );
}
function recordedPoints(value: unknown, distance: number | null): string | null {
  if (!value || typeof value !== "object" || distance === null || distance <= 0) return null;
  const p = value as { v?: unknown; step_km?: unknown; h?: unknown };
  if (
    p.v !== 1 ||
    typeof p.step_km !== "number" ||
    p.step_km <= 0 ||
    !Array.isArray(p.h) ||
    p.h.length < 2 ||
    !p.h.every((h) => typeof h === "number" && Number.isFinite(h))
  )
    return null;
  const h = p.h as number[],
    low = Math.min(...h),
    high = Math.max(...h),
    span = Math.max(1, high - low);
  return h
    .map(
      (height, i) =>
        ((Math.min(i * (p.step_km as number), distance) / distance) * 800).toFixed(1) +
        "," +
        (100 - ((height - low) / span) * 85).toFixed(1)
    )
    .join(" ");
}
export default function RaceEdition() {
  return (
    <I18nReadyGate ns={["results", "races"]}>
      <RaceEditionContent />
    </I18nReadyGate>
  );
}
function RaceEditionContent() {
  const { t, i18n } = useTranslation(["results", "races"]);
  const { raceSlug } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const boot = useLibraryContext();
  const location = useLocation();
  const resolved = useMemo(() => {
    if (!boot.data) return { scope: null, error: null };
    try {
      return { scope: resolveLibraryScope(params, boot.data), error: null };
    } catch (error) {
      return { scope: null, error };
    }
  }, [params, boot.data]);
  const scope = resolved.scope;
  const seasons = boot.data?.seasons ?? [];
  const pools = boot.data?.pools ?? [];
  // React Router has already decoded the path segment. Never decode it a second time.
  const name = raceSlug ?? "";
  const explicitId = params.get("raceId");
  const candidates = useLibraryRequest(
    !scope || explicitId ? null : JSON.stringify(["name", name, scope]),
    (signal) => raceLibraryReader.findRaceByName(name, scope!, seasons, pools, signal)
  );
  const matchingCurrent = candidates.data?.filter((r) => r.seasonId === scope?.seasonId) ?? [];
  const candidate =
    matchingCurrent.length === 1
      ? matchingCurrent[0]
      : candidates.data?.length === 1
        ? candidates.data[0]
        : null;
  const detailScope =
    scope && candidate && !explicitId ? { ...scope, seasonId: candidate.seasonId } : scope;
  const raceId = explicitId ?? candidate?.id ?? null;
  const detail = useLibraryRequest(
    scope && raceId ? JSON.stringify(["edition", raceId, detailScope]) : null,
    (signal) => raceLibraryReader.getRaceEdition(raceId!, detailScope!, seasons, pools, signal)
  );
  const row = detail.data?.summary ?? null;
  const family = row ? { name: row.name, race_type: row.raceType } : null;
  const editions = useLibraryRequest(
    scope && family ? JSON.stringify(["family", family, scope]) : null,
    (signal) => raceLibraryReader.listRaceEditions(family!, scope!, seasons, pools, signal)
  );
  const tab =
    params.get("detail") === "editions"
      ? "editions"
      : params.get("detail") === "statistics"
        ? "statistics"
        : "route";
  const stats = useLibraryRequest(
    scope && family && tab === "statistics" ? JSON.stringify(["statistics", family, scope]) : null,
    (signal) => raceLibraryReader.listRaceStats(family!, scope!, seasons, pools, signal)
  );
  const rawReturn = params.get("returnTo");
  const back = rawReturn?.startsWith("/resultater?") ? rawReturn : "/resultater?tab=archive";
  const open = (edition: RaceEditionSummary) => {
    navigate(editionHref(edition, params, back), { state: location.state });
    window.scrollTo(0, 0);
  };
  const error = boot.error || resolved.error || candidates.error || detail.error;
  const busy = boot.loading || candidates.loading || detail.loading;
  const retry = () => {
    boot.reload();
    candidates.reload();
    detail.reload();
    editions.reload();
    stats.reload();
  };
  const choose = (
    <EmptyState
      title={t("library.chooseEdition")}
      description={t("library.chooseBody")}
      action={
        <Button variant="secondary" size="sm" onClick={() => navigate(back)}>
          {t("library.backLibrary")}
        </Button>
      }
    />
  );
  const candidateColumns = [
    {
      key: "name",
      header: t("library.race"),
      sticky: true,
      render: (r: RaceEditionSummary) => r.name,
    },
    {
      key: "season",
      header: t("library.season"),
      numeric: true,
      render: (r: RaceEditionSummary) => r.seasonNumber,
    },
    {
      key: "pool",
      header: t("library.pool"),
      render: (r: RaceEditionSummary) =>
        r.poolId === null
          ? t("library.shared")
          : (pools.find((p) => p.id === r.poolId)?.label ?? t("library.unknown")),
    },
    {
      key: "open",
      header: t("library.openShort"),
      render: (r: RaceEditionSummary) => (
        <Button variant="secondary" size="sm" className="min-h-11" onClick={() => open(r)}>
          {t("library.openSeason", { number: r.seasonNumber })}
        </Button>
      ),
    },
  ];
  const empty = (
    <EmptyState
      title={t("library.noEdition")}
      description={t("library.noEditionBody")}
      action={
        <Button variant="secondary" size="sm" onClick={() => navigate(back)}>
          {t("library.backLibrary")}
        </Button>
      }
    />
  );
  const requestedStage = Number(params.get("stage") ?? 1);
  const stageNumber =
    Number.isInteger(requestedStage) &&
    requestedStage >= 1 &&
    requestedStage <=
      (row?.stages ?? Math.max(1, ...(detail.data?.profiles.map((p) => p.stage_number) ?? [])))
      ? requestedStage
      : 1;
  const profile = detail.data?.profiles.find((p) => p.stage_number === stageNumber) ?? null;
  const schedule = detail.data?.schedule.find((p) => p.stage_number === stageNumber) ?? null;
  const sectors = sectorsOf(profile);
  const points = recordedPoints(profile?.elevation_profile, profile?.distance_km ?? null);
  const status = (r: RaceEditionSummary) => (
    <StatusBadge
      state={r.status === "completed" ? "success" : r.status === "live" ? "info" : "warning"}
    >
      {t("library.status." + r.status)}
    </StatusBadge>
  );
  return (
    <div className="mx-auto max-w-5xl">
      <Link
        to={back}
        state={{ libraryScroll: location.state?.libraryScroll }}
        className="mb-4 inline-flex items-center gap-1 text-xs text-cz-2 hover:text-cz-1"
      >
        <ChevronLeftIcon size={14} aria-hidden="true" />
        {t("library.backLibrary")}
      </Link>
      <Card className="border-t-2 border-t-cz-accent p-4 sm:p-6">
        <h1 className="font-display text-[40px] leading-[.92] uppercase text-cz-1 wrap-break-word">
          {row?.name ?? name}
        </h1>
        {row && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-cz-2">
            {status(row)}
            <span>{t("library.seasonOption", { number: row.seasonNumber })}</span>
            <span>
              {t("classOption." + row.raceClass, {
                ns: "races",
                defaultValue: row.raceClass ?? t("library.unknown"),
              })}
            </span>
          </div>
        )}
        {row && (
          <HeroStats
            items={[
              {
                label: t("library.date"),
                value: editionDate(row, i18n.language) || t("library.unknown"),
              },
              {
                label: t(row.status === "completed" ? "library.winner" : "library.distance"),
                value:
                  row.status === "completed"
                    ? (row.winner?.name ?? t("library.notRecorded"))
                    : row.distanceKm === null
                      ? t("library.unknown")
                      : formatNumber(row.distanceKm, { maximumFractionDigits: 0 }) + " km",
              },
              {
                label: t("library.stages"),
                value: row.stages === null ? t("library.unknown") : formatNumber(row.stages),
              },
              {
                label: t("library.raceDays"),
                value:
                  row.firstGameDay === null
                    ? t("library.unknown")
                    : row.lastGameDay !== null && row.lastGameDay !== row.firstGameDay
                      ? String(toDisplayRaceDay(row.firstGameDay)) +
                        " - " +
                        String(toDisplayRaceDay(row.lastGameDay))
                      : String(toDisplayRaceDay(row.firstGameDay)),
              },
            ]}
          />
        )}
        {row && tab === "route" && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-cz-border pt-4">
            <Select
              size="sm"
              value={stageNumber}
              aria-label={t("library.stage")}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setParams((previous) => {
                  const p = new URLSearchParams(previous);
                  p.set("stage", e.target.value);
                  return p;
                })
              }
            >
              {Array.from({ length: row.stages ?? detail.data?.profiles.length ?? 0 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {t("library.stage") + " " + (i + 1)}
                </option>
              ))}
            </Select>
            <span className="font-data text-xs tabular-nums text-cz-2">
              {schedule
                ? new Intl.DateTimeFormat(i18n.language, {
                    day: "numeric",
                    month: "short",
                    timeZone: "Europe/Copenhagen",
                  }).format(new Date(schedule.scheduled_at))
                : t("library.unknown")}
              {schedule?.game_day !== null && schedule?.game_day !== undefined
                ? " · " + t("library.raceDay") + " " + toDisplayRaceDay(schedule.game_day)
                : ""}
            </span>
            {row.status === "scheduled" && (
              <Button size="sm" onClick={() => navigate("/planning?tab=selection")}>
                {t("library.planning")}
              </Button>
            )}
          </div>
        )}
        {row?.status === "scheduled" && tab !== "route" && (
          <div className="mt-5 border-t border-cz-border pt-4">
            <Button size="sm" onClick={() => navigate("/planning?tab=selection")}>
              {t("library.planning")}
            </Button>
          </div>
        )}
        {busy && (
          <div className="mt-4" role="status" aria-label={t("library.loading")}>
            <SkeletonLines lines={4} />
          </div>
        )}
      </Card>
      <div className="mt-4">
        {error ? (
          <ErrorState
            description={t(resolved.error ? "library.scopeError" : "library.error")}
            action={
              <Button variant="secondary" size="sm" onClick={retry}>
                {t("library.retry")}
              </Button>
            }
          />
        ) : !busy && !row ? (
          candidates.data && candidates.data.length > 1 ? (
            <>
              <div className="mb-4">{choose}</div>
              <DataTable
                dense
                columns={candidateColumns}
                rows={candidates.data}
                rowKey={(r: RaceEditionSummary) => r.id}
                label={t("library.chooseEdition")}
                mobileDefaults={["season", "pool", "open"]}
              />
            </>
          ) : (
            empty
          )
        ) : (
          row && (
            <>
              <Tabs
                value={tab}
                onChange={(next: string) =>
                  setParams((previous) => {
                    const p = new URLSearchParams(previous);
                    p.set("detail", next);
                    return p;
                  })
                }
                className="mb-4"
              >
                <TabList label={row.name}>
                  <Tab value="route">{t("library.route")}</Tab>
                  <Tab value="editions">{t("library.editions")}</Tab>
                  <Tab value="statistics">{t("library.statistics")}</Tab>
                </TabList>
              </Tabs>
              {tab === "route" && !profile && (
                <EmptyState
                  title={t("library.missingProfile")}
                  description={t("library.missingProfileBody")}
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setParams((previous) => {
                          const p = new URLSearchParams(previous);
                          p.set("detail", "editions");
                          return p;
                        })
                      }
                    >
                      {t("library.editions")}
                    </Button>
                  }
                />
              )}
              {tab === "route" && profile && (
                <Section>
                  {profile && (
                    <>
                      <div className="mb-4 flex flex-wrap gap-5 font-data text-xs tabular-nums text-cz-2">
                        <span>
                          {t("library.distance") +
                            ": " +
                            (profile.distance_km === null
                              ? t("library.unknown")
                              : formatNumber(profile.distance_km) + " km")}
                        </span>
                        <span>
                          {t("library.elevation") +
                            ": " +
                            (profile.elevation_gain_m == null
                              ? t("library.unknown")
                              : formatNumber(profile.elevation_gain_m) + " m")}
                        </span>
                      </div>
                      {points ? (
                        <svg
                          viewBox="0 0 800 110"
                          className="w-full text-cz-1"
                          role="img"
                          aria-label={t("library.route")}
                        >
                          <polyline
                            points={points}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          />
                        </svg>
                      ) : (
                        <p className="mb-4 text-xs text-cz-3">{t("library.elevationMissing")}</p>
                      )}
                      {sectors.length > 0 && profile.distance_km !== null && (
                        <div className="border-t border-cz-border pt-4">
                          <h2 className="text-[15px] font-semibold text-cz-1">
                            {t("library.sectors")}
                          </h2>
                          <svg
                            viewBox="0 0 800 55"
                            className="mt-2 w-full text-cz-2"
                            role="img"
                            aria-label={t("library.sectors")}
                          >
                            <line
                              x1="0"
                              y1="26"
                              x2="800"
                              y2="26"
                              stroke="currentColor"
                              strokeWidth="1"
                            />
                            {sectors.map((sector, i) => (
                              <rect
                                key={i}
                                x={(sector.start_km / profile.distance_km!) * 800}
                                y={21}
                                width={(sector.length_km / profile.distance_km!) * 800}
                                height={10}
                                fill="currentColor"
                              />
                            ))}
                          </svg>
                          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
                            {sectors.map((sector, i) => (
                              <div key={i}>
                                <dt className="text-cz-3">
                                  {t("library.sectorStart") +
                                    " " +
                                    formatNumber(sector.start_km) +
                                    " km"}
                                </dt>
                                <dd className="font-data tabular-nums text-cz-1">
                                  {formatNumber(sector.length_km) + " km"}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      )}
                    </>
                  )}
                </Section>
              )}
              {tab === "editions" && (
                <DataTable
                  dense
                  columns={[
                    {
                      key: "season",
                      header: t("library.season"),
                      sticky: true,
                      render: (r: RaceEditionSummary) =>
                        t("library.seasonOption", { number: r.seasonNumber }),
                      subline: (r: RaceEditionSummary) =>
                        r.poolId === null
                          ? t("library.shared")
                          : (pools.find((p) => p.id === r.poolId)?.label ?? t("library.unknown")),
                    },
                    {
                      key: "date",
                      header: t("library.date"),
                      render: (r: RaceEditionSummary) =>
                        editionDate(r, i18n.language) || t("library.unknown"),
                    },
                    {
                      key: "result",
                      header: t("library.winner"),
                      render: (r: RaceEditionSummary) =>
                        r.status === "completed"
                          ? (r.winner?.name ?? t("library.notRecorded"))
                          : status(r),
                    },
                    {
                      key: "open",
                      header: t("library.openShort"),
                      render: (r: RaceEditionSummary) => (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="min-h-11 min-w-11"
                          aria-label={t("library.openSeason", { number: r.seasonNumber })}
                          onClick={() => open(r)}
                        >
                          {t("library.openShort")}
                        </Button>
                      ),
                    },
                  ]}
                  rows={editions.data ?? []}
                  rowKey={(r: RaceEditionSummary) => r.id}
                  label={t("library.editions")}
                  mobileDefaults={["date", "result", "open"]}
                  empty={
                    editions.error ? (
                      <ErrorState
                        description={t("library.error")}
                        action={
                          <Button size="sm" variant="secondary" onClick={editions.reload}>
                            {t("library.retry")}
                          </Button>
                        }
                      />
                    ) : (
                      <div className="p-5">
                        <SkeletonLines lines={4} />
                      </div>
                    )
                  }
                />
              )}
              {tab === "statistics" && (
                <DataTable
                  dense
                  columns={[
                    {
                      key: "name",
                      header: t("library.rider"),
                      sticky: true,
                      render: (r: { id: string; name: string }) => (
                        <Link to={"/riders/" + r.id} className="text-cz-1 hover:text-cz-accent-t">
                          {r.name}
                        </Link>
                      ),
                    },
                    { key: "gcWins", header: t("library.gcWins"), numeric: true },
                    { key: "stageWins", header: t("library.stageWins"), numeric: true },
                    { key: "podiums", header: t("library.podiums"), numeric: true },
                    { key: "points", header: t("library.points"), numeric: true },
                  ]}
                  rows={stats.data ?? []}
                  rowKey={(r: { id: string }) => r.id}
                  label={t("library.statistics")}
                  mobileDefaults={["wins", "podiums", "points"]}
                  empty={
                    stats.loading ? (
                      <div className="p-5">
                        <SkeletonLines lines={4} />
                      </div>
                    ) : stats.error ? (
                      <ErrorState
                        description={t("library.error")}
                        action={
                          <Button size="sm" variant="secondary" onClick={stats.reload}>
                            {t("library.retry")}
                          </Button>
                        }
                      />
                    ) : (
                      <EmptyState
                        title={t("library.noStats")}
                        description={t("library.noStatsBody")}
                        action={
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              setParams((previous) => {
                                const p = new URLSearchParams(previous);
                                p.set("detail", "editions");
                                return p;
                              })
                            }
                          >
                            {t("library.editions")}
                          </Button>
                        }
                      />
                    )
                  }
                />
              )}
            </>
          )
        )}
      </div>
    </div>
  );
}
