import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import RiderLink from "../components/RiderLink";
import RacePointsPage from "./RacePointsPage";
import { dateTextToDayOfYear } from "../lib/raceCalendar";
import { computeExpectedRacePrize, formatExpectedPrize } from "../lib/expectedPrizeCalculator";
import {
  Card,
  Input,
  Select,
  Table,
  Tr,
  Th,
  Td,
  Tabs,
  TabList,
  Tab,
  EmptyState,
  Spinner,
  FlagIcon,
} from "../components/ui";
import { labelClass } from "../components/ui/fieldStyles.js";

// Labels resolves via t() ved render — se races-namespacet (resultType.*, classOption.*, status.*).
const RESULT_TYPES = [
  { key: "stage" },
  { key: "gc" },
  { key: "points" },
  { key: "mountain" },
  { key: "young" },
];

const RACE_CLASS_OPTIONS = [
  { value: "TourFrance" },
  { value: "GiroVuelta" },
  { value: "Monuments" },
  { value: "OtherWorldTourA" },
  { value: "OtherWorldTourB" },
  { value: "OtherWorldTourC" },
  { value: "ProSeries" },
  { value: "Class1" },
  { value: "Class2" },
];

const RACE_STATUS_OPTIONS = [
  { value: "completed" },
  { value: "active" },
  { value: "scheduled" },
];

const VALID_TABS = ["calendar", "library", "world", "points"];

export default function RacesPage() {
  const { t } = useTranslation("races");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialTab = VALID_TABS.includes(searchParams.get("tab"))
    ? searchParams.get("tab")
    : "calendar";

  const [races, setRaces] = useState([]);
  const [racePoints, setRacePoints] = useState([]);
  const [season, setSeason] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedRace, setSelectedRace] = useState(null);
  const [tab, setTab] = useState(initialTab);
  const [isAdmin, setIsAdmin] = useState(false);

  // Library state (lazy loaded når tab="library" åbnes første gang)
  const [libRaces, setLibRaces] = useState([]);
  const [libSeasons, setLibSeasons] = useState([]);
  const [libLoaded, setLibLoaded] = useState(false);
  const [libLoading, setLibLoading] = useState(false);
  const [libFilterSeason, setLibFilterSeason] = useState("");
  const [libFilterClass, setLibFilterClass] = useState("");
  const [libFilterStatus, setLibFilterStatus] = useState("");
  const [libSearch, setLibSearch] = useState("");

  // World pool state (Slice 09 — lazy load når tab="world" åbnes)
  const [worldPool, setWorldPool] = useState([]);
  const [worldSummary, setWorldSummary] = useState({});
  const [worldLoaded, setWorldLoaded] = useState(false);
  const [worldLoading, setWorldLoading] = useState(false);
  const [worldFilterClass, setWorldFilterClass] = useState("");

  // Tab → URL sync (deep-linkbar fra eksterne kilder, fx /races?tab=library)
  function changeTab(next) {
    setTab(next);
    if (next === "calendar") {
      searchParams.delete("tab");
    } else {
      searchParams.set("tab", next);
    }
    setSearchParams(searchParams, { replace: true });
  }

  async function loadAll() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: userData } = await supabase.from("users").select("role").eq("id", user.id).single();
    setIsAdmin(userData?.role === "admin");

    const [seasonRes, racesRes, racePointsRes] = await Promise.all([
      supabase.from("seasons").select("*").eq("status", "active").single(),
      supabase.from("races").select("*, results:race_results(id), pool_race:pool_race_id(date_text)").order("name"),
      supabase.from("race_points").select("race_class, result_type, rank, points"),
    ]);

    setSeason(seasonRes.data);
    setRaces(racesRes.data || []);
    setRacePoints(racePointsRes.data || []);
    setLoading(false);
  }

  async function loadWorld() {
    setWorldLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/race-pool`);
      const data = await res.json();
      setWorldPool(data.pool || []);
      setWorldSummary(data.summary || {});
      setWorldLoaded(true);
    } finally {
      setWorldLoading(false);
    }
  }

  async function loadLibrary() {
    setLibLoading(true);
    const [racesRes, seasonsRes] = await Promise.all([
      supabase
        .from("races")
        .select("id, name, race_type, race_class, stages, status, edition_year, pool_race:pool_race_id(date_text), season:season_id(id, number, status)")
        .order("name"),
      supabase
        .from("seasons")
        .select("id, number, status")
        .order("number", { ascending: false }),
    ]);
    setLibRaces(racesRes.data || []);
    setLibSeasons(seasonsRes.data || []);
    setLibLoaded(true);
    setLibLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    if (tab === "library" && !libLoaded && !libLoading) {
      loadLibrary();
    }
    if (tab === "world" && !worldLoaded && !worldLoading) {
      loadWorld();
    }
  }, [tab, libLoaded, libLoading, worldLoaded, worldLoading]);

  const filteredLibRaces = useMemo(() => {
    return libRaces.filter(r => {
      if (libFilterSeason && r.season?.id !== libFilterSeason) return false;
      if (libFilterClass && r.race_class !== libFilterClass) return false;
      if (libFilterStatus && r.status !== libFilterStatus) return false;
      if (libSearch && !r.name.toLowerCase().includes(libSearch.toLowerCase())) return false;
      return true;
    });
  }, [libRaces, libFilterSeason, libFilterClass, libFilterStatus, libSearch]);

  async function loadRaceResults(raceId) {
    const { data } = await supabase
      .from("race_results")
      .select("*, rider:rider_id(id, firstname, lastname, team:team_id(name))")
      .eq("race_id", raceId)
      .order("result_type")
      .order("rank");
    return data || [];
  }

  async function handleRaceClick(race) {
    setSelectedRace({ ...race, results: null, loading: true });
    const results = await loadRaceResults(race.id);
    setSelectedRace({ ...race, results, loading: false });
  }

  const racesByStatus = {
    upcoming: races
      .filter(r => !r.results?.length && r.status !== "completed")
      .sort((a, b) => dateTextToDayOfYear(a.pool_race?.date_text) - dateTextToDayOfYear(b.pool_race?.date_text)),
    completed: races.filter(r => r.results?.length > 0 || r.status === "completed"),
  };

  if (loading) return (
    <div className="flex justify-center py-16">
      <Spinner size={24} />
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-cz-1">{t("title")}</h1>
          <p className="text-cz-3 text-sm">
            {tab === "library"
              ? t("subtitle.library", { count: libRaces.length })
              : tab === "points"
              ? t("subtitle.points")
              : season
              ? t("subtitle.withSeason", { number: season.number, count: races.length })
              : t("subtitle.noSeasonWithCount", { count: races.length })}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onChange={changeTab} className="mb-5">
        <TabList label={t("title")}>
          {[
            { key: "calendar", label: t("tabs.calendar") },
            { key: "library", label: t("tabs.library") },
            { key: "world", label: t("tabs.world") },
            { key: "points", label: t("tabs.points") },
          ].map(tb => (
            <Tab key={tb.key} value={tb.key}>{tb.label}</Tab>
          ))}
        </TabList>
      </Tabs>

      {/* Calendar tab */}
      {tab === "calendar" && (
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            {/* Upcoming */}
            {racesByStatus.upcoming.length > 0 && (
              <div className="mb-5">
                <h2 className="text-cz-2 text-xs uppercase tracking-wider mb-3 font-semibold">{t("calendar.upcoming")}</h2>
                <div className="flex flex-col gap-2">
                  {racesByStatus.upcoming.map(race => {
                    const expectedPrize = computeExpectedRacePrize({
                      raceClass: race.race_class,
                      raceType: race.race_type,
                      stages: race.stages,
                      racePoints,
                    });
                    return (
                    <Card key={race.id} interactive
                      className={`p-4 cursor-pointer ${selectedRace?.id === race.id ? "border-cz-accent/40" : ""}`}
                      onClick={() => handleRaceClick(race)}>
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-cz-1 font-semibold text-sm">{race.name}</p>
                          <p className="text-cz-3 text-xs mt-0.5">
                            {race.race_type === "stage_race" ? t("raceType.stageRaceWithStages", { count: race.stages }) : t("raceType.oneDay")}
                          </p>
                        </div>
                        <div className="text-right">
                          {race.pool_race?.date_text && (
                            <p className="text-cz-3 text-xs">{race.pool_race.date_text}</p>
                          )}
                          {expectedPrize > 0 && (
                            <p className="text-cz-2 text-xs font-mono mt-0.5" title={t("calendar.expectedPoolTooltip")}>
                              {t("calendar.expectedPool", { amount: formatExpectedPrize(expectedPrize) })}
                            </p>
                          )}
                        </div>
                      </div>
                    </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Completed */}
            {racesByStatus.completed.length > 0 && (
              <div>
                <h2 className="text-cz-2 text-xs uppercase tracking-wider mb-3 font-semibold">{t("calendar.completed")}</h2>
                <div className="flex flex-col gap-2">
                  {racesByStatus.completed.map(race => (
                    <Card key={race.id} interactive
                      className={`p-4 cursor-pointer ${selectedRace?.id === race.id ? "border-cz-accent/40" : ""}`}
                      onClick={() => handleRaceClick(race)}>
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-cz-1 font-medium text-sm">{race.name}</p>
                          <p className="text-cz-3 text-xs mt-0.5">
                            {t("calendar.resultsImported", { count: race.results?.length || 0 })}
                          </p>
                        </div>
                        <span className="text-[9px] uppercase bg-cz-success-bg text-cz-success border border-cz-success/30 px-2 py-0.5 rounded-full">
                          {t("status.completed")}
                        </span>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {races.length === 0 && (
              <EmptyState
                icon={<FlagIcon size={28} />}
                title={t("empty.noRacesSeason")}
                description={isAdmin ? t("empty.addRaceAdmin") : null}
              />
            )}
          </div>

          {/* Race detail panel */}
          <div>
            {selectedRace ? (
              <Card className="p-5 sticky top-4">
                <h2 className="text-cz-1 font-bold text-base mb-1">{selectedRace.name}</h2>
                <p className="text-cz-3 text-xs mb-1">
                  {selectedRace.race_type === "stage_race" ? t("raceType.stages", { count: selectedRace.stages }) : t("raceType.oneDay")}
                  {selectedRace.pool_race?.date_text && ` · ${selectedRace.pool_race.date_text}`}
                </p>
                {(() => {
                  const expected = computeExpectedRacePrize({
                    raceClass: selectedRace.race_class,
                    raceType: selectedRace.race_type,
                    stages: selectedRace.stages,
                    racePoints,
                  });
                  return expected > 0 ? (
                    <p className="text-cz-2 text-xs font-mono mb-4" title={t("calendar.expectedPoolTooltip")}>
                      {t("calendar.expectedPool", { amount: formatExpectedPrize(expected) })}
                    </p>
                  ) : <div className="mb-4" />;
                })()}

                {selectedRace.loading && (
                  <div className="flex justify-center py-8">
                    <Spinner size={20} />
                  </div>
                )}

                {!selectedRace.loading && selectedRace.results?.length === 0 && (
                  <div className="text-center py-8 text-cz-3 text-sm">
                    <p>{t("calendar.noResultsYet")}</p>
                  </div>
                )}

                {!selectedRace.loading && selectedRace.results?.length > 0 && (
                  <div>
                    <Link to={`/races/${selectedRace.id}`}
                      className="inline-flex items-center gap-1 mb-4 text-xs font-medium text-cz-accent-t hover:underline">
                      {selectedRace.race_type === "stage_race" ? t("calendar.viewFullWithStages") : t("calendar.viewFull")}
                    </Link>
                    {RESULT_TYPES.map(rt => {
                      const rows = selectedRace.results.filter(r => r.result_type === rt.key).slice(0, 10);
                      if (!rows.length) return null;
                      return (
                        <div key={rt.key} className="mb-4">
                          <p className="text-cz-2 text-xs uppercase tracking-wider mb-2 font-semibold">{t(`resultType.${rt.key}`)}</p>
                          <table className="w-full text-xs">
                            <tbody>
                              {rows.map(r => (
                                <tr key={r.id} className="border-b border-cz-border last:border-0">
                                  <td className="py-1.5 w-6 text-cz-3 font-mono">#{r.rank}</td>
                                  <td className="py-1.5">
                                    <RiderLink id={r.rider?.id}
                                      className="cursor-pointer hover:text-cz-accent-t transition-colors block">
                                      <span className="text-cz-1">{r.rider?.firstname} {r.rider?.lastname}</span>
                                      <span className="text-cz-3 ms-2">{r.rider?.team?.name || t("common.free")}</span>
                                    </RiderLink>
                                  </td>
                                  <td className="py-1.5 text-right text-cz-success font-mono">
                                    {r.prize_money > 0 ? `+${r.prize_money}` : ""}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            ) : (
              <Card className="p-8 text-center text-cz-3 sticky top-4">
                <FlagIcon size={24} className="mx-auto mb-2 text-cz-3" />
                <p className="text-sm">{t("calendar.selectPrompt")}</p>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Library tab — alle løb på tværs af sæsoner med filtre */}
      {tab === "library" && (
        <div>
          {/* Filter bar */}
          <Card className="p-4 mb-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label htmlFor="lib-search" className={labelClass()}>{t("library.searchLabel")}</label>
              <Input id="lib-search" type="text" value={libSearch} onChange={e => setLibSearch(e.target.value)}
                placeholder={t("library.searchPlaceholder")} />
            </div>
            <div>
              <label htmlFor="lib-season" className={labelClass()}>{t("library.seasonLabel")}</label>
              <Select id="lib-season" value={libFilterSeason} onChange={e => setLibFilterSeason(e.target.value)}>
                <option value="">{t("library.allSeasons")}</option>
                {libSeasons.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.status === "active"
                      ? t("library.seasonOptionActive", { number: s.number })
                      : t("library.seasonOption", { number: s.number })}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="lib-class" className={labelClass()}>{t("library.classLabel")}</label>
              <Select id="lib-class" value={libFilterClass} onChange={e => setLibFilterClass(e.target.value)}>
                <option value="">{t("library.allClasses")}</option>
                {RACE_CLASS_OPTIONS.map(c => (
                  <option key={c.value} value={c.value}>{t(`classOption.${c.value}`)}</option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="lib-status" className={labelClass()}>{t("library.statusLabel")}</label>
              <Select id="lib-status" value={libFilterStatus} onChange={e => setLibFilterStatus(e.target.value)}>
                <option value="">{t("library.allStatuses")}</option>
                {RACE_STATUS_OPTIONS.map(s => (
                  <option key={s.value} value={s.value}>{t(`status.${s.value}`)}</option>
                ))}
              </Select>
            </div>
          </Card>

          {(libFilterSeason || libFilterClass || libFilterStatus || libSearch) && (
            <div className="flex items-center justify-between mb-3 px-1">
              <p className="text-cz-3 text-xs">
                {t("library.filteredCount", { filtered: filteredLibRaces.length, total: libRaces.length })}
              </p>
              <button
                onClick={() => {
                  setLibFilterSeason(""); setLibFilterClass(""); setLibFilterStatus(""); setLibSearch("");
                }}
                className="text-cz-accent-t text-xs hover:underline">
                {t("library.clearFilters")}
              </button>
            </div>
          )}

          {libLoading ? (
            <div className="flex justify-center py-16">
              <Spinner size={24} />
            </div>
          ) : filteredLibRaces.length === 0 ? (
            <EmptyState icon={<FlagIcon size={28} />} title={t("empty.noRacesMatch")} />
          ) : (
            <Card className="overflow-hidden">
              <Table className="text-sm">
                <thead>
                  <Tr className="hover:bg-transparent">
                    <Th>{t("library.thRace")}</Th>
                    <Th>{t("library.thSeason")}</Th>
                    <Th>{t("library.thClass")}</Th>
                    <Th>{t("library.thType")}</Th>
                    <Th>{t("library.thDate")}</Th>
                    <Th>{t("library.thStatus")}</Th>
                  </Tr>
                </thead>
                <tbody>
                  {filteredLibRaces.map(r => {
                    const classMeta = RACE_CLASS_OPTIONS.find(c => c.value === r.race_class);
                    const statusMeta = RACE_STATUS_OPTIONS.find(s => s.value === r.status);
                    return (
                      <Tr key={r.id}
                        onClick={() => navigate(`/race-archive/${encodeURIComponent(r.name)}`)}
                        className="cursor-pointer">
                        <Td className="text-cz-1 font-medium">{r.name}</Td>
                        <Td className="text-cz-2 text-xs">
                          {r.season ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); navigate(`/seasons/${r.season.id}`); }}
                              className="text-cz-accent-t hover:underline">
                              {t("library.seasonLink", { number: r.season.number })}
                            </button>
                          ) : "—"}
                        </Td>
                        <Td className="text-cz-2 text-xs">
                          {classMeta ? t(`classOption.${r.race_class}`) : (r.race_class ?? "—")}
                        </Td>
                        <Td className="text-cz-2 text-xs">
                          {r.race_type === "stage_race" ? t("raceType.stageRaceParen", { count: r.stages }) : t("raceType.oneDayShort")}
                        </Td>
                        <Td className="text-cz-2 text-xs">
                          {r.pool_race?.date_text || "—"}
                        </Td>
                        <Td className="text-xs">
                          <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] uppercase
                            ${r.status === "completed" ? "bg-cz-success-bg text-cz-success border-cz-success/30"
                              : r.status === "active" ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                              : "bg-cz-subtle text-cz-3 border-cz-border"}`}>
                            {statusMeta ? t(`status.${r.status}`) : r.status}
                          </span>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
      )}

      {/* Verdens-kalender tab (Slice 09) — read-only katalog af alle løb */}
      {tab === "world" && (
        <div>
          {worldLoading && <p className="text-cz-3 text-sm">{t("world.loading")}</p>}
          {!worldLoading && (
            <>
              <Card className="p-4 mb-4">
                <p className="text-cz-2 font-medium text-sm mb-3">
                  {t("world.totalRaces", { count: worldPool.length })}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
                  {RACE_CLASS_OPTIONS.map(opt => {
                    const s = worldSummary[opt.value];
                    if (!s || s.count === 0) return null;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setWorldFilterClass(worldFilterClass === opt.value ? "" : opt.value)}
                        className={`flex justify-between items-center px-3 py-2 rounded-lg border text-left transition-all
                          ${worldFilterClass === opt.value
                            ? "bg-cz-accent/10 border-cz-accent/30 text-cz-accent-t"
                            : "border-cz-border text-cz-2 hover:bg-cz-subtle"}`}
                      >
                        <span className="truncate">{t(`classOption.${opt.value}`)}</span>
                        <span className="text-cz-3 text-xs whitespace-nowrap ms-2">
                          {t("world.classSummary", { count: s.count, days: s.raceDays })}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {worldFilterClass && (
                  <p className="text-cz-3 text-xs mt-2">
                    {t("world.filteredOn", { class: t(`classOption.${worldFilterClass}`) })}{" "}
                    <button onClick={() => setWorldFilterClass("")} className="text-cz-accent-t underline">
                      {t("world.clearFilter")}
                    </button>
                  </p>
                )}
              </Card>

              <Card className="overflow-hidden">
                <Table className="text-sm">
                  <thead>
                    <Tr className="hover:bg-transparent">
                      <Th>{t("world.thRace")}</Th>
                      <Th>{t("world.thClass")}</Th>
                      <Th>{t("world.thType")}</Th>
                      <Th numeric>{t("world.thStages")}</Th>
                      <Th>{t("world.thDate")}</Th>
                    </Tr>
                  </thead>
                  <tbody>
                    {worldPool
                      .filter(r => !worldFilterClass || r.race_class === worldFilterClass)
                      .map(r => (
                        <Tr key={r.id}>
                          <Td className="text-cz-1">{r.name}</Td>
                          <Td className="text-cz-2">{r.race_class}</Td>
                          <Td className="text-cz-2">{r.race_type === "single" ? t("raceType.oneDayShort") : t("resultType.stage")}</Td>
                          <Td numeric className="text-cz-2">{r.stages}</Td>
                          <Td className="text-cz-3">{r.date_text || "—"}</Td>
                        </Tr>
                      ))}
                  </tbody>
                </Table>
              </Card>
            </>
          )}
        </div>
      )}

      {/* Point & præmier tab — embedder RacePointsPage som tab-indhold */}
      {tab === "points" && (
        <div className="-mt-2">
          <RacePointsPage />
        </div>
      )}
    </div>
  );
}
