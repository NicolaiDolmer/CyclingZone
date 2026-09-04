import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { supabase } from "../../lib/supabase";
import { racesForPool } from "../../lib/racesByPool";
import { sortRacesByDateDesc } from "../../lib/raceCalendarSort";
import { deriveRaceStatus } from "../../lib/raceHubLogic.js";
import { useSortState, sortRows } from "../../lib/useTableSort.js";
import { RACE_CLASS_OPTIONS, RACE_STATUS_OPTIONS } from "../../lib/raceFilterOptions.js";
import {
  Card, Input, Select, EmptyState, FlagIcon, Section, DataTable, SkeletonLines, ErrorState, Button,
  ChevronRightIcon,
} from "../ui";
import { labelClass } from "../ui/fieldStyles.js";

// #3102 etape 2 — løbs-arkivet (før: /races?tab=library). Kontrakten flytter de
// rene KIGGE-flader til Resultat-hubben; tabellen er uændret bortset fra at den
// nu ejer sin egen data-hentning (den lå før i RacesPage.loadLibrary + den
// delte myPoolId-state fra kalender-fanen).
//
// i18n bor fortsat i races-namespacet: nøglerne beskriver løb, ikke hubben, og
// en flytning ville efterlade 18 døde nøgler i races.json for ingen gevinst.

// Sorterbare kolonner (klient-side, delt useSortState/sortRows). Tekst-kolonner
// starter stigende; sæson (tal) starter faldende (nyeste først) via descFirstKeys.
const LIBRARY_ACCESSORS = {
  name: (r) => r.name,
  season: (r) => r.season?.number ?? 0,
  race_class: (r) => r.race_class ?? "",
  race_type: (r) => r.race_type ?? "",
  status: (r) => deriveRaceStatus(r.status, r.stages_completed, r.stages),
};
const LIBRARY_DESC_FIRST = new Set(["season"]);

export default function RaceArchiveTable() {
  const { t } = useTranslation("races");
  const navigate = useNavigate();

  const [races, setRaces] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [myPoolId, setMyPoolId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [filterSeason, setFilterSeason] = useState("");
  const [filterClass, setFilterClass] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");
  // #2081 (zootne, Discord 2/7): "hvad kørte jeg i dag" er lettere at finde når
  // listen er begrænset til egen pulje.
  const [myDivisionOnly, setMyDivisionOnly] = useState(false);

  const sort = useSortState({ descFirstKeys: LIBRARY_DESC_FIRST });

  async function loadAll() {
    setLoading(true);
    setLoadError(false);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const [racesRes, seasonsRes, myTeamRes] = await Promise.all([
        supabase
          .from("races")
          .select("id, name, race_type, race_class, stages, stages_completed, status, edition_year, league_division_id, pool_race:pool_race_id(date_text), season:season_id(id, number, status)")
          .order("name"),
        // #2763: sæson 0 (bogførings-sæson, 0 løb) filtreres ud af sæson-
        // vælgeren — samme diskriminator som #2600 (.gt("number", 0)).
        supabase
          .from("seasons")
          .select("id, number, status")
          .gt("number", 0)
          .order("number", { ascending: false }),
        // #1715: spillerens egen pulje driver "kun min division"-filteret.
        user
          ? supabase.from("teams").select("league_division_id").eq("user_id", user.id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      // #3102: den fejlede hoved-hentning surfacer nu som ErrorState med retry.
      // Før degraderede den tavst til "ingen løb matcher filtrene", som ser ud
      // som et tomt arkiv (samme klasse som #2849 bølge 3-fundene).
      if (racesRes.error) { setLoadError(true); return; }

      setRaces(racesRes.data || []);
      setSeasons(seasonsRes.data || []);
      setMyPoolId(myTeamRes.data?.league_division_id ?? null);
    } catch (e) {
      console.error("Race archive load failed:", e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  const filtered = useMemo(() => {
    const base = myDivisionOnly ? racesForPool(races, myPoolId) : races;
    const rows = base.filter(r => {
      if (filterSeason && r.season?.id !== filterSeason) return false;
      if (filterClass && r.race_class !== filterClass) return false;
      // Filtrér på den AFLEDTE status — det er den kolonnen viser. Med den rå
      // status matchede "Live" aldrig noget (deriveRaceStatus returnerer "live",
      // races.status gør ikke), og "Kommende" tog igangværende etapeløb med,
      // fordi de stadig står som scheduled i DB. Fejlen fulgte med fra
      // /races?tab=library; den er rettet her, ikke flyttet videre.
      if (filterStatus && deriveRaceStatus(r.status, r.stages_completed, r.stages) !== filterStatus) return false;
      if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
    // #2081: nyeste (afsluttede) løb først i stedet for alfabetisk.
    return sortRacesByDateDesc(rows);
  }, [races, filterSeason, filterClass, filterStatus, search, myDivisionOnly, myPoolId]);

  return (
    <div>
      {/* Filter bar */}
      <Card className="p-4 mb-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label htmlFor="lib-search" className={labelClass()}>{t("library.searchLabel")}</label>
          <Input id="lib-search" type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t("library.searchPlaceholder")} />
        </div>
        <div>
          <label htmlFor="lib-season" className={labelClass()}>{t("library.seasonLabel")}</label>
          <Select id="lib-season" value={filterSeason} onChange={e => setFilterSeason(e.target.value)}>
            <option value="">{t("library.allSeasons")}</option>
            {seasons.map(s => (
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
          <Select id="lib-class" value={filterClass} onChange={e => setFilterClass(e.target.value)}>
            <option value="">{t("library.allClasses")}</option>
            {RACE_CLASS_OPTIONS.map(c => (
              <option key={c.value} value={c.value}>{t(`classOption.${c.value}`)}</option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="lib-status" className={labelClass()}>{t("library.statusLabel")}</label>
          <Select id="lib-status" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">{t("library.allStatuses")}</option>
            {RACE_STATUS_OPTIONS.map(s => (
              <option key={s.value} value={s.value}>{t(`status.${s.value}`)}</option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="lib-my-division" className={labelClass()}>{t("library.myDivisionOnly")}</label>
          <label htmlFor="lib-my-division" className="flex items-center gap-2 h-10 px-1 cursor-pointer select-none">
            <input id="lib-my-division" type="checkbox" checked={myDivisionOnly}
              onChange={e => setMyDivisionOnly(e.target.checked)}
              className="rounded border-cz-border" />
            <span className="text-sm text-cz-2">{t("library.myDivisionOnly")}</span>
          </label>
        </div>
      </Card>

      {(filterSeason || filterClass || filterStatus || search || myDivisionOnly) && (
        <div className="flex items-center justify-between mb-3 px-1">
          <p className="text-cz-3 text-xs">
            {t("library.filteredCount", { filtered: filtered.length, total: races.length })}
          </p>
          <button
            onClick={() => {
              setFilterSeason(""); setFilterClass(""); setFilterStatus(""); setSearch(""); setMyDivisionOnly(false);
            }}
            className="text-cz-accent-t text-xs hover:underline">
            {t("library.clearFilters")}
          </button>
        </div>
      )}

      {loading ? (
        <Section><SkeletonLines lines={5} /></Section>
      ) : loadError ? (
        <Section role="alert">
          <ErrorState
            description={t("history.loadError.message")}
            action={<Button size="sm" variant="secondary" onClick={loadAll}>{t("history.loadError.retry")}</Button>}
          />
        </Section>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<FlagIcon size={28} aria-hidden="true" />} title={t("empty.noRacesMatch")} />
      ) : (
        <DataTable
          label={t("tabs.library")}
          rowKey={(r) => r.id}
          sort={sort.sort}
          sortDir={sort.sortDir}
          onSort={sort.handleSort}
          rows={sortRows(filtered, sort.sort ? LIBRARY_ACCESSORS[sort.sort] : null, sort.sortDir)}
          columns={[
            {
              key: "name",
              header: t("library.thRace"),
              sticky: true,
              sortKey: "name",
              // Kun navnet er klik-mål (DataTable understøtter ikke helrække-klik).
              render: (r) => (
                <button
                  type="button"
                  onClick={() => navigate(`/race-archive/${encodeURIComponent(r.name)}`)}
                  className="text-left hover:text-cz-accent-t transition-colors"
                >
                  {r.name}
                </button>
              ),
            },
            {
              key: "season",
              header: t("library.thSeason"),
              sortKey: "season",
              fold: true,
              foldValue: (r) => (r.season ? t("library.seasonLink", { number: r.season.number }) : "—"),
              render: (r) =>
                r.season ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(`/seasons/${r.season.id}`); }}
                    className="inline-flex items-center gap-0.5 text-cz-accent-t hover:underline">
                    {t("library.seasonLink", { number: r.season.number })}
                    <ChevronRightIcon size={12} aria-hidden="true" />
                  </button>
                ) : "—",
            },
            {
              key: "race_class",
              header: t("library.thClass"),
              sortKey: "race_class",
              fold: true,
              foldValue: (r) => classLabel(t, r),
              render: (r) => classLabel(t, r),
            },
            {
              key: "race_type",
              header: t("library.thType"),
              sortKey: "race_type",
              fold: true,
              foldValue: (r) => typeLabel(t, r),
              render: (r) => typeLabel(t, r),
            },
            {
              key: "status",
              header: t("library.thStatus"),
              sortKey: "status",
              render: (r) => {
                // Afled visnings-status (#1828): igangværende etapeløb vises "Live".
                const derived = deriveRaceStatus(r.status, r.stages_completed, r.stages);
                return (
                  <span className={`inline-block px-2 py-0.5 rounded-cz-pill border text-3xs uppercase
                    ${derived === "completed" ? "bg-cz-success-bg text-cz-success border-cz-success/30"
                      : derived === "live" ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                      : "bg-cz-subtle text-cz-3 border-cz-border"}`}>
                    {t(`status.${derived}`)}
                  </span>
                );
              },
            },
          ]}
        />
      )}
    </div>
  );
}

function classLabel(t, race) {
  const known = RACE_CLASS_OPTIONS.some(c => c.value === race.race_class);
  return known ? t(`classOption.${race.race_class}`) : (race.race_class ?? "—");
}

function typeLabel(t, race) {
  return race.race_type === "stage_race"
    ? t("raceType.stageRaceParen", { count: race.stages })
    : t("raceType.oneDayShort");
}
