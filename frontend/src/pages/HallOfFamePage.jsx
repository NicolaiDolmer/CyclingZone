import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import TeamLink from "../components/TeamLink";
import { logEvent } from "../lib/logEvent";
import { formatNumber } from "../lib/intl";
import {
  TrophyIcon, LightningIcon, CrownIcon, PageLoader,
  PageHeader, Section, SectionHeader, DataTable, EmptyState, ErrorState, Button,
  Tabs, TabList, Tab,
} from "../components/ui";
import { SCROLLER, TABLE, tdClass, trClass } from "../components/ui/dataTableStyles.js";

const CATEGORIES = [
  { key: "most_points_season", Icon: TrophyIcon, unitKey: "points" },
  { key: "most_stage_wins_season", Icon: LightningIcon, unitKey: "wins" },
  { key: "most_div1_titles", Icon: CrownIcon, unitKey: "titles" },
];

// #1580: 2-farve-disciplin — niveau-tier mappes til en monokrom intensitet via
// cz-tekst-tokens (lav tier dæmpet, top tier guld) i stedet for 10 regnbue-hex.
const LEVEL_TITLES = [
  { min: 1,  max: 4,  key: "rookie",      cls: "text-cz-3" },
  { min: 5,  max: 9,  key: "amateur",     cls: "text-cz-3" },
  { min: 10, max: 14, key: "continental", cls: "text-cz-2" },
  { min: 15, max: 19, key: "pro",         cls: "text-cz-2" },
  { min: 20, max: 24, key: "proTeam",     cls: "text-cz-2" },
  { min: 25, max: 29, key: "worldTour",   cls: "text-cz-1" },
  { min: 30, max: 34, key: "monument",    cls: "text-cz-1" },
  { min: 35, max: 39, key: "gcContender", cls: "text-cz-accent-t" },
  { min: 40, max: 44, key: "grandTour",   cls: "text-cz-accent-t" },
  { min: 45, max: 50, key: "legend",      cls: "text-cz-accent-t" },
];

export function getLevelInfo(level) {
  return LEVEL_TITLES.find(l => level >= l.min && level <= l.max) || LEVEL_TITLES[0];
}

export default function HallOfFamePage() {
  const { t } = useTranslation("halloffame");
  const [records, setRecords] = useState({});
  const [standings, setStandings] = useState([]);
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("hof");

  async function loadAll() {
    setLoading(true);
    setError(null);
    const [hofRes, standingsRes, managersRes] = await Promise.all([
      supabase.from("hall_of_fame").select("*, team:team_id(id, name)").order("value", { ascending: false }),
      supabase.from("season_standings")
        .select("*, team:team_id(id, name, is_ai), season:season_id(number)")
        .order("total_points", { ascending: false }),
      supabase.from("teams")
        .select("id, name, division, manager_name, user:user_id(id, username, level, xp, role)")
        .eq("is_ai", false)
        .eq("is_test_account", false)
        .eq("is_frozen", false)
        .order("name"),
    ]);

    // #2849 bølge 3 (audit-fund): en fejlet fetch degraderede tidligere tavst til
    // tomme lister (|| []) — surfaces nu som canonical ErrorState med retry i
    // stedet. Ingen ændring af selve queries/aggregeringen.
    const failure = hofRes.error || standingsRes.error || managersRes.error;
    if (failure) {
      console.error("Hall of Fame load failed:", failure);
      setError(failure);
      setLoading(false);
      return;
    }

    // Group HoF by category
    const grouped = {};
    (hofRes.data || []).forEach(r => {
      if (!grouped[r.category]) grouped[r.category] = [];
      grouped[r.category].push(r);
    });
    setRecords(grouped);
    setStandings(standingsRes.data || []);
    // Flatten team + user data for managers tab
    setManagers((managersRes.data || [])
      .map(t => ({ ...t.user, team_id: t.id, team_name: t.name, team_division: t.division, manager_name: t.manager_name }))
      .filter(m => m.id && (m.manager_name || m.team_name))
      .sort((a, b) => (b.level || 1) - (a.level || 1) || (b.xp || 0) - (a.xp || 0)));
    setLoading(false);
  }

  useEffect(() => { loadAll(); logEvent("feature_hall_of_fame_opened"); }, []);

  // Calculate all-time stats from standings if no HoF records yet
  function getBestFromStandings(category) {
    if (records[category]?.length) return records[category].slice(0, 5);
    if (category === "most_points_season") {
      return standings
        .filter(s => !s.team?.is_ai)
        .sort((a, b) => b.total_points - a.total_points)
        .slice(0, 5)
        .map(s => ({
          team_name: s.team?.name,
          team: s.team,
          value: s.total_points || 0,
          season_number: s.season?.number,
        }));
    }
    if (category === "most_stage_wins_season") {
      return standings
        .filter(s => !s.team?.is_ai)
        .sort((a, b) => (b.stage_wins || 0) - (a.stage_wins || 0))
        .slice(0, 5)
        .map(s => ({
          team_name: s.team?.name,
          team: s.team,
          value: s.stage_wins || 0,
          season_number: s.season?.number,
        }));
    }
    return [];
  }

  // Division history from standings
  const divHistory = {};
  standings.filter(s => !s.team?.is_ai && s.division === 1).forEach(s => {
    const key = s.season?.number;
    if (!divHistory[key]) divHistory[key] = [];
    divHistory[key].push(s);
  });

  if (loading) return (
    <PageLoader />
  );

  // #2849 bølge 3 — manager-ranglisten er den eneste tabel her tæt nok på T2's
  // "dense wide data"-form (5 kolonner, egen kort-ramme) til at bruge den
  // kanoniske DataTable direkte: sticky navnekolonne + Titel foldes ind i
  // underlinjen ≤640px, Niveau/XP forbliver synlige og scroller vandret under
  // den pinnede kolonne i stedet for at presse siden bredere end 375px.
  const managerColumns = [
    {
      key: "name",
      header: t("thManager"),
      sticky: true,
      render: (m, i) => (
        <span className="inline-flex items-center gap-2">
          <span className="font-mono text-xs text-cz-3">#{i + 1}</span>
          <TeamLink id={m.team_id} className="text-cz-1 font-medium hover:text-cz-accent-t">
            {m.manager_name || m.team_name || "—"}
          </TeamLink>
        </span>
      ),
      subline: (m) => (m.manager_name && m.team_name && m.manager_name !== m.team_name ? m.team_name : null),
    },
    {
      key: "title",
      header: t("thTitle"),
      fold: true,
      foldValue: (m) => t(`level.${getLevelInfo(m.level || 1).key}`),
      render: (m) => {
        const levelInfo = getLevelInfo(m.level || 1);
        return (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full bg-cz-subtle ${levelInfo.cls}`}>
            {t(`level.${levelInfo.key}`)}
          </span>
        );
      },
    },
    {
      key: "level",
      header: t("thLevel"),
      numeric: true,
      render: (m) => {
        const levelInfo = getLevelInfo(m.level || 1);
        return <span className={`font-mono font-bold ${levelInfo.cls}`}>{m.level || 1}</span>;
      },
    },
    {
      key: "xp",
      header: t("thXp"),
      numeric: true,
      render: (m) => {
        const xpProgress = (m.xp || 0) % 100;
        return (
          <div className="flex items-center justify-end gap-2">
            <div className="w-16 bg-cz-subtle rounded-full h-1.5">
              <div className="h-1.5 rounded-full bg-cz-accent" style={{ width: `${Math.min(xpProgress, 100)}%` }} />
            </div>
            <span className="text-cz-2 font-mono text-xs">{m.xp || 0}</span>
          </div>
        );
      },
    },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <Tabs value={tab} onChange={setTab} className="mb-6">
        <TabList label={t("title")}>
          <Tab value="hof">{t("tabRecords")}</Tab>
          <Tab value="managers">{t("tabManagers")}</Tab>
          <Tab value="divhistory">{t("tabDivHistory")}</Tab>
        </TabList>
      </Tabs>

      {error ? (
        <ErrorState
          title={t("loadError")}
          action={<Button size="sm" variant="secondary" onClick={() => loadAll()}>{t("retry")}</Button>}
        />
      ) : (
        <>
          {/* Records tab — hver kategori er en kanonisk Section (T1-kort); rækkerne
              genbruger dataTableStyles' tdClass/trClass (samme 1px top-rule-recipe
              som T1's "row lists inside cards") inde i en overflow-x-scroller, så
              lange holdnavne aldrig presser siden bredere end 375px. */}
          {tab === "hof" && (
            <div className="flex flex-col gap-[14px]">
              {CATEGORIES.map(cat => {
                const entries = getBestFromStandings(cat.key);
                return (
                  <Section key={cat.key}>
                    <SectionHeader
                      title={
                        <span className="flex items-center gap-2">
                          <cat.Icon size={16} className="text-cz-accent-t" aria-hidden="true" />
                          {t(`categories.${cat.key}`)}
                        </span>
                      }
                    />
                    {entries.length === 0 ? (
                      <EmptyState icon={<cat.Icon size={26} aria-hidden="true" />} title={t("noRecords")} />
                    ) : (
                      <div className={SCROLLER}>
                        <table data-sort-exempt="Top-5 rekord-liste, iboende orden" className={TABLE}>
                          <tbody>
                            {entries.map((e, i) => (
                              <tr key={i} className={trClass(null)}>
                                <td className={`${tdClass({})} w-8`}>
                                  <span className={`font-mono font-bold text-sm
                                    ${i === 0 ? "text-cz-accent-t" : i === 1 ? "text-cz-2" : i === 2 ? "text-cz-warning/60" : "text-cz-3"}`}>
                                    #{i + 1}
                                  </span>
                                </td>
                                <td className={tdClass({})}>
                                  <TeamLink id={e.team?.id} className="text-cz-1 font-medium hover:text-cz-accent-t">
                                    {e.team_name || e.team?.name || "—"}
                                  </TeamLink>
                                  {e.season_number && (
                                    <p className="text-cz-3 text-xs">{t("season", { n: e.season_number })}</p>
                                  )}
                                </td>
                                <td className={tdClass({ numeric: true })}>
                                  <span className="font-bold text-lg text-cz-accent-t">
                                    {formatNumber(e.value)}
                                  </span>
                                  <span className="text-cz-3 text-xs ms-1">{t(`units.${cat.unitKey}`)}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Section>
                );
              })}
            </div>
          )}

          {/* Managers tab — kanonisk DataTable (T2-recipe: sticky navnekolonne,
              Titel foldes ind i underlinjen ≤640px). */}
          {tab === "managers" && (
            managers.length === 0 ? (
              <EmptyState title={t("noManagers")} />
            ) : (
              <DataTable
                label={t("tabManagers")}
                columns={managerColumns}
                rows={managers}
                rowKey={(m) => m.id}
              />
            )
          )}

          {/* Division history tab — samme Section+dataTableStyles-mønster som
              Records-tabbet ovenfor (en kanonisk kort pr. sæson). */}
          {tab === "divhistory" && (
            Object.keys(divHistory).length === 0 ? (
              <EmptyState
                icon={<TrophyIcon size={26} aria-hidden="true" />}
                title={t("noDivHistory")}
                description={t("noDivHistoryHint")}
              />
            ) : (
              <div className="flex flex-col gap-[14px]">
                {Object.entries(divHistory).sort((a, b) => parseInt(b[0]) - parseInt(a[0])).map(([season, entries]) => (
                  <Section key={season}>
                    <SectionHeader title={t("season", { n: season })} meta={t("division1")} />
                    <div className={SCROLLER}>
                      <table data-sort-exempt="Saeson-liste, iboende point-orden" className={TABLE}>
                        <tbody>
                          {entries.sort((a, b) => b.total_points - a.total_points).map((s, i) => (
                            <tr key={s.id} className={trClass(null)}>
                              <td className={`${tdClass({})} w-8`}>
                                <span className={`font-mono font-bold ${i === 0 ? "text-cz-accent-t" : "text-cz-2"}`}>
                                  #{i + 1}
                                </span>
                              </td>
                              <td className={tdClass({})}>
                                <TeamLink id={s.team?.id} className="text-cz-1 font-medium hover:text-cz-accent-t">
                                  {s.team?.name}
                                </TeamLink>
                              </td>
                              <td className={tdClass({ numeric: true })}>
                                <span className="text-cz-accent-t font-bold">{formatNumber(s.total_points)} {t("ptSuffix")}</span>
                              </td>
                              <td className={tdClass({ numeric: true })}>
                                <span className="text-cz-2 text-xs">{t("stageWins", { count: s.stage_wins || 0 })}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Section>
                ))}
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
