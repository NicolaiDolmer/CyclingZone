import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import RiderLink from "../components/RiderLink";
import RacePointsPage from "./RacePointsPage";
import { dateTextToDayOfYear } from "../lib/raceCalendar";
import { computeExpectedRacePrize, formatExpectedPrize } from "../lib/expectedPrizeCalculator";
import { formatDateTime } from "../lib/intl";
import {
  Card,
  Button,
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
  CheckIcon,
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

// timeAgo tager en t-funktion så strengene følger den aktive locale.
function timeAgo(t, dateStr) {
  if (!dateStr) return "—";
  const diff = new Date() - new Date(dateStr);
  const d = Math.floor(diff / 86400000);
  const h = Math.floor(diff / 3600000);
  if (d > 0) return t("timeAgo.days", { count: d });
  if (h > 0) return t("timeAgo.hours", { count: h });
  return t("timeAgo.now");
}

const VALID_TABS = ["calendar", "library", "world", "points", "submit", "approve"];

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
  const [userId, setUserId] = useState(null);
  const [pending, setPending] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState("");
  // submitMsgOk styrer banner-farven (success vs error). Tidligere udledt af om
  // den oversatte besked startede med "✅" — nu eksplicit flag, så kilden ikke
  // bærer et emoji-tegn (#671 anti-drift). Adfærd uændret: copy-strengene i
  // races.json beholder deres ✅/❌-præfiks.
  const [submitMsgOk, setSubmitMsgOk] = useState(false);

  // Upload state
  const [uploadRaceId, setUploadRaceId] = useState("");
  const [uploadStage, setUploadStage] = useState(1);
  const [uploadResultType, setUploadResultType] = useState("stage");
  const [editingRows, setEditingRows] = useState([]);

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

  useEffect(() => { loadAll(); }, []);

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

  useEffect(() => {
    if (tab === "library" && !libLoaded && !libLoading) {
      loadLibrary();
    }
    if (tab === "world" && !worldLoaded && !worldLoading) {
      loadWorld();
    }
  }, [tab, libLoaded, libLoading, worldLoaded, worldLoading]);

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

  const filteredLibRaces = useMemo(() => {
    return libRaces.filter(r => {
      if (libFilterSeason && r.season?.id !== libFilterSeason) return false;
      if (libFilterClass && r.race_class !== libFilterClass) return false;
      if (libFilterStatus && r.status !== libFilterStatus) return false;
      if (libSearch && !r.name.toLowerCase().includes(libSearch.toLowerCase())) return false;
      return true;
    });
  }, [libRaces, libFilterSeason, libFilterClass, libFilterStatus, libSearch]);

  async function loadAll() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    setUserId(user.id);
    const { data: userData } = await supabase.from("users").select("role").eq("id", user.id).single();
    setIsAdmin(userData?.role === "admin");

    const [seasonRes, racesRes, pendingRes, racePointsRes] = await Promise.all([
      supabase.from("seasons").select("*").eq("status", "active").single(),
      supabase.from("races").select("*, results:race_results(id), pool_race:pool_race_id(date_text)").order("name"),
      supabase.from("pending_race_results")
        .select("*, race:race_id(name), submitter:submitted_by(username)")
        .order("submitted_at", { ascending: false }),
      supabase.from("race_points").select("race_class, result_type, rank, points"),
    ]);

    setSeason(seasonRes.data);
    setRaces(racesRes.data || []);
    setPending(pendingRes.data || []);
    setRacePoints(racePointsRes.data || []);
    if (racesRes.data?.length) setUploadRaceId(racesRes.data[0].id);
    setLoading(false);
  }

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

  // Parse Excel file — XLSX loaded on demand to keep initial chunk small
  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const XLSX = await import("@e965/xlsx");
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(new Uint8Array(ev.target.result));
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
      // Expect columns: Rank, Rider Name (or Rider ID)
      const parsed = rows.slice(1).filter(r => r[0] && r[1]).map((r, i) => ({
        rank: parseInt(r[0]) || i + 1,
        rider_name: String(r[1] || "").trim(),
        rider_id: null,
        matched: false,
      }));
      setEditingRows(parsed.map(r => ({ ...r })));
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }

  // Match rider names to IDs
  async function matchRiders() {
    const updated = [...editingRows];
    for (let i = 0; i < updated.length; i++) {
      const parts = updated[i].rider_name.trim().split(" ");
      const lastname = parts[parts.length - 1];
      const { data } = await supabase.from("riders")
        .select("id, firstname, lastname")
        .ilike("lastname", `%${lastname}%`)
        .limit(3);
      if (data?.length === 1) {
        updated[i].rider_id = data[0].id;
        updated[i].matched = true;
        updated[i].matched_name = `${data[0].firstname} ${data[0].lastname}`;
      }
    }
    setEditingRows(updated);
  }

  async function submitResults() {
    if (!uploadRaceId) { setSubmitMsgOk(false); setSubmitMsg(t("submit.msgSelectRace")); return; }
    const unmatched = editingRows.filter(r => !r.rider_id);
    if (unmatched.length > 0) {
      setSubmitMsgOk(false);
      setSubmitMsg(t("submit.msgUnmatched", { count: unmatched.length }));
      return;
    }
    setSubmitting(true);
    const rows = editingRows.map(r => ({
      rider_id: r.rider_id,
      result_type: uploadResultType,
      rank: r.rank,
      stage_number: uploadStage,
    }));
    const { error } = await supabase.rpc("submit_race_results", {
      p_race_id: uploadRaceId,
      p_rows: rows,
    });
    if (error) {
      setSubmitMsgOk(false);
      setSubmitMsg(t("submit.msgError", { message: error.message }));
      setSubmitting(false);
      return;
    }
    setSubmitMsgOk(true);
    setSubmitMsg(t("submit.msgSubmitted"));
    setEditingRows([]);
    loadAll();
    setSubmitting(false);
  }

  async function approveSubmission(pendingId) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/approve-results`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ pending_id: pendingId }),
    });
    const data = await res.json();
    if (res.ok) {
      loadAll();
    } else {
      // #678: læk ikke rå backend-fejl i UI'et — log til konsol, vis venlig oversat besked.
      console.error("approve-results failed:", data.error);
      alert(t("approve.errorGeneric"));
    }
  }

  async function rejectSubmission(pendingId, note) {
    await supabase.from("pending_race_results")
      .update({ status: "rejected", admin_note: note, reviewed_at: new Date().toISOString(), reviewed_by: userId })
      .eq("id", pendingId);
    loadAll();
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
            { key: "submit", label: t("tabs.submit") },
            ...(isAdmin ? [{ key: "approve", label: t("tabs.approve", { count: pending.filter(p => p.status === "pending").length }) }] : []),
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
                          {race.edition_year && (
                            <p className="text-cz-accent-t text-xs font-mono mt-0.5">{t("common.edition", { year: race.edition_year })}</p>
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
                  {selectedRace.edition_year && ` · ${t("common.edition", { year: selectedRace.edition_year })}`}
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
                    <button onClick={() => changeTab("submit")}
                      className="mt-3 text-cz-accent-t text-xs hover:underline">
                      {t("calendar.submitCta")}
                    </button>
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
                          {r.edition_year ? t("common.edition", { year: r.edition_year }) : "—"}
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

      {/* Submit results tab */}
      {tab === "submit" && (
        <div className="max-w-2xl">
          <Card className="p-5 mb-4">
            <h2 className="text-cz-1 font-semibold text-sm mb-4">{t("submit.heading")}</h2>
            <p className="text-cz-3 text-xs mb-5 leading-relaxed">
              {t("submit.introBefore")} <span className="text-cz-2 font-mono">{t("submit.columnsHint")}</span>. {t("submit.introAfter")}
            </p>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div>
                <label htmlFor="submit-race" className={labelClass()}>{t("submit.raceLabel")}</label>
                <Select id="submit-race" value={uploadRaceId} onChange={e => setUploadRaceId(e.target.value)}>
                  {races.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              </div>
              <div>
                <label htmlFor="submit-stage" className={labelClass()}>{t("submit.stageLabel")}</label>
                <Input id="submit-stage" type="number" min={1} value={uploadStage}
                  onChange={e => setUploadStage(parseInt(e.target.value))} />
              </div>
              <div>
                <label htmlFor="submit-type" className={labelClass()}>{t("submit.typeLabel")}</label>
                <Select id="submit-type" value={uploadResultType} onChange={e => setUploadResultType(e.target.value)}>
                  {RESULT_TYPES.map(rt => <option key={rt.key} value={rt.key}>{t(`resultType.${rt.key}`)}</option>)}
                </Select>
              </div>
            </div>

            <label className="block cursor-pointer mb-4">
              <div className="border-2 border-dashed border-cz-border hover:border-cz-accent/40
                rounded-cz p-6 text-center transition-all">
                <p className="text-cz-3 text-sm">{t("submit.dropTitle")}</p>
                <p className="text-cz-3 text-xs mt-1">{t("submit.dropFormat")}</p>
              </div>
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileUpload} />
            </label>

            {editingRows.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-cz-2 text-xs">{t("submit.uploadedCount", { count: editingRows.length })}</p>
                  <button onClick={matchRiders}
                    className="px-3 py-1.5 bg-cz-info-bg0/10 text-cz-info border border-blue-500/20 rounded-lg text-xs hover:bg-cz-info-bg0/20">
                    {t("submit.autoMatch")}
                  </button>
                </div>

                <div className="bg-cz-subtle rounded-cz overflow-hidden mb-4 max-h-80 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-cz-card">
                      <tr className="border-b border-cz-border">
                        <th className="px-3 py-2 text-left text-cz-3 w-10">#</th>
                        <th className="px-3 py-2 text-left text-cz-3">{t("submit.thFromPcm")}</th>
                        <th className="px-3 py-2 text-left text-cz-3">{t("submit.thMatchedTo")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {editingRows.map((row, i) => (
                        <tr key={i} className="border-b border-cz-border">
                          <td className="px-3 py-2 text-cz-2 font-mono">{row.rank}</td>
                          <td className="px-3 py-2 text-cz-2">{row.rider_name}</td>
                          <td className="px-3 py-2">
                            {row.matched ? (
                              <span className="text-cz-success text-xs inline-flex items-center gap-1">
                                <CheckIcon size={12} /> {row.matched_name}
                              </span>
                            ) : (
                              <span className="text-cz-danger text-xs">{t("submit.notMatched")}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {submitMsg && (
                  <div role="status" className={`mb-3 px-4 py-2.5 rounded-cz text-sm border
                    ${submitMsgOk ? "bg-cz-success-bg text-cz-success border-cz-success/30" : "bg-cz-danger-bg text-cz-danger border-cz-danger/30"}`}>
                    {submitMsg}
                  </div>
                )}

                <Button variant="primary" fullWidth loading={submitting} onClick={submitResults}>
                  {submitting ? t("submit.submitting") : t("submit.submitCta")}
                </Button>
              </div>
            )}
          </Card>

          {/* My past submissions */}
          {pending.filter(p => p.submitted_by === userId).length > 0 && (
            <Card className="p-5">
              <h3 className="text-cz-1 font-semibold text-sm mb-3">{t("submit.mySubmissions")}</h3>
              <div className="flex flex-col gap-2">
                {pending.filter(p => p.submitted_by === userId).map(p => (
                  <div key={p.id} className="flex items-center justify-between py-2 border-b border-cz-border last:border-0">
                    <div>
                      <p className="text-cz-1 text-sm">{p.race?.name}</p>
                      <p className="text-cz-3 text-xs">{timeAgo(t, p.submitted_at)}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full border
                      ${p.status === "pending" ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30" :
                        p.status === "approved" ? "bg-cz-success-bg text-cz-success border-cz-success/30" :
                        "bg-cz-danger-bg text-cz-danger border-cz-danger/30"}`}>
                      {p.status === "pending" ? t("submission.pending") : p.status === "approved" ? t("submission.approved") : t("submission.rejected")}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Admin approve tab */}
      {tab === "approve" && isAdmin && (
        <div className="max-w-3xl">
          {pending.filter(p => p.status === "pending").length === 0 ? (
            <EmptyState icon={<CheckIcon size={28} />} title={t("approve.nonePending")} />
          ) : (
            <div className="flex flex-col gap-4">
              {pending.filter(p => p.status === "pending").map(p => (
                <PendingSubmission key={p.id} submission={p}
                  onApprove={() => approveSubmission(p.id)}
                  onReject={(note) => rejectSubmission(p.id, note)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PendingSubmission({ submission, onApprove, onReject }) {
  const { t } = useTranslation("races");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rejectNote, setRejectNote] = useState("");
  const [showReject, setShowReject] = useState(false);

  useEffect(() => {
    supabase.from("pending_race_result_rows")
      .select("*, rider:rider_id(firstname, lastname, team:team_id(name))")
      .eq("pending_id", submission.id)
      .order("rank")
      .then(({ data }) => { setRows(data || []); setLoading(false); });
  }, [submission.id]);

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-cz-1 font-semibold">{submission.race?.name}</p>
          <p className="text-cz-3 text-xs mt-0.5">
            {t("approve.submittedBy", { user: submission.submitter?.username, date: formatDateTime(submission.submitted_at) })}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={onApprove}
            className="px-3 py-1.5 bg-cz-success-bg text-cz-success border border-cz-success/30 rounded-lg text-xs hover:bg-cz-success-bg">
            {t("approve.approve")}
          </button>
          <button onClick={() => setShowReject(!showReject)}
            className="px-3 py-1.5 bg-cz-danger-bg text-cz-danger border border-cz-danger/30 rounded-lg text-xs hover:bg-cz-danger-bg">
            {t("approve.reject")}
          </button>
        </div>
      </div>

      {showReject && (
        <div className="flex gap-2 mb-4">
          <Input type="text" value={rejectNote} onChange={e => setRejectNote(e.target.value)}
            placeholder={t("approve.rejectPlaceholder")}
            aria-label={t("approve.rejectPlaceholder")}
            className="flex-1" />
          <Button variant="danger" onClick={() => onReject(rejectNote)}>
            {t("approve.send")}
          </Button>
        </div>
      )}

      {loading ? <div className="text-cz-3 text-sm">{t("common.loading")}</div> : (
        <div className="max-h-60 overflow-y-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-cz-border">
              <th className="py-1.5 text-left text-cz-3 w-8">#</th>
              <th className="py-1.5 text-left text-cz-3">{t("approve.thRider")}</th>
              <th className="py-1.5 text-left text-cz-3">{t("approve.thTeam")}</th>
              <th className="py-1.5 text-left text-cz-3">{t("approve.thType")}</th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-cz-border">
                  <td className="py-1.5 text-cz-2 font-mono">{r.rank}</td>
                  <td className="py-1.5 text-cz-1">{r.rider?.firstname} {r.rider?.lastname}</td>
                  <td className="py-1.5 text-cz-2">{r.rider?.team?.name || t("common.free")}</td>
                  <td className="py-1.5 text-cz-2">{r.result_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
