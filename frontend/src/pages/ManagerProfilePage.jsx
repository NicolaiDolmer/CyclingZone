import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import RiderLink from "../components/RiderLink";
import { supabase } from "../lib/supabase";
import { ageBadgeKey } from "../lib/riderAge";
import OnlineBadge from "../components/OnlineBadge";
import { formatNumber, formatDate } from "../lib/intl";
import { ABILITY_STATS, ABILITY_SHORT, flattenAbilities } from "../lib/abilities";
import { statStyle } from "../lib/statColor";
import {
  Card,
  CategoryTag,
  StatusBadge,
  EmptyState,
  Tabs,
  TabList,
  Tab,
  TabPanel,
  Table,
  Tr,
  Th,
  Td,
  ProgressMeter,
  TrophyIcon,
  LockIcon,
  ChevronLeftIcon,
  InboxIcon,
  SettingsIcon,
  PageLoader,
} from "../components/ui";

const API = import.meta.env.VITE_API_URL;

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` };
}

function AchievementBadge({ achievement }) {
  const { t } = useTranslation("achievements");
  const isLocked = !achievement.unlocked;
  // i18n pr. achievement-id; DB-værdien (kanonisk engelsk) er fallback for badges
  // uden oversættelse endnu (#1103 — founder_badge er første tosprogede badge).
  const title = t(`${achievement.id}.title`, { defaultValue: achievement.title });
  const description = t(`${achievement.id}.description`, { defaultValue: achievement.description });
  return (
    <div className="group relative">
      <div className={`w-10 h-10 rounded-cz flex items-center justify-center border transition-all
        ${isLocked ? "bg-cz-subtle border-cz-border opacity-40 grayscale" : "bg-cz-accent/10 border-cz-accent/30"}`}>
        {isLocked && achievement.is_secret
          ? <LockIcon size={16} className="text-cz-3" />
          : <TrophyIcon size={18} className={isLocked ? "text-cz-3" : "text-cz-accent"} aria-hidden="true" />}
      </div>
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 bg-cz-subtle border border-cz-border rounded-cz px-3 py-2 w-44
        opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <p className="text-cz-1 text-xs font-bold">{isLocked && achievement.is_secret ? "???" : title}</p>
        {(!isLocked || !achievement.is_secret) && (
          <p className="text-cz-2 text-[10px] mt-0.5 leading-relaxed">{description}</p>
        )}
        {achievement.unlocked_at && (
          <p className="text-cz-accent-t/60 text-[9px] mt-1">
            {formatDate(achievement.unlocked_at)}
          </p>
        )}
      </div>
    </div>
  );
}

// #1008: progress mod næste mål for en låst, tæller-baseret achievement (fx "40/50").
// Backend sender kun progress for ikke-secret achievements der har en meningsfuld tæller.
function AchievementProgress({ achievement }) {
  const { t } = useTranslation("achievements");
  const { t: tTeam } = useTranslation("team");
  const title = t(`${achievement.id}.title`, { defaultValue: achievement.title });
  const { current, target } = achievement.progress;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-cz-2">{title}</span>
        <span className="font-data text-xs font-semibold tabular-nums text-cz-3">{current}/{target}</span>
      </div>
      <ProgressMeter value={current} max={target} ariaLabel={tTeam("manager.progressTowards", { title, current, target })} />
    </div>
  );
}

export default function ManagerProfilePage() {
  const { teamId } = useParams();
  const navigate   = useNavigate();
  const { t } = useTranslation("team");
  const { t: tCommon } = useTranslation("common");
  const { t: tRider } = useTranslation("rider");
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState("overview");
  const [myTeamId, setMyTeamId] = useState(null);

  const loadMyTeam = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: myTeam } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    if (myTeam) setMyTeamId(myTeam.id);
  }, []);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const h = await authHeaders();
      const res = await fetch(`${API}/api/managers/${teamId}`, { headers: h });
      const json = await res.json().catch(() => null);
      if (res.ok && json) setData(json);
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => { loadProfile(); loadMyTeam(); }, [loadProfile, loadMyTeam]);

  if (loading) return (
    <PageLoader />
  );
  if (!data) return (
    <div className="max-w-3xl mx-auto py-8">
      <EmptyState icon={<InboxIcon size={32} />} title={t("manager.notFound")} />
    </div>
  );

  const { team, user, riders: rawRiders, season_history, achievements, transfer_activity } = data;
  // #1529: backend leverer rytteren med nested rider_derived_abilities — flad evnerne
  // op på rytter-objektet så r.climbing osv. virker i render-cellerne nedenfor.
  const riders = (rawRiders || []).map(flattenAbilities);
  const unlockedCount = achievements.filter(a => a.unlocked).length;
  const isOwnProfile  = team.id === myTeamId;

  const achByCategory = achievements.reduce((acc, a) => {
    if (!acc[a.category]) acc[a.category] = [];
    acc[a.category].push(a);
    return acc;
  }, {});

  const TABS = [
    { key: "overview",     label: t("manager.tabOverview") },
    { key: "riders",       label: t("manager.tabRiders", { count: riders.length }) },
    { key: "season",       label: t("manager.tabSeason") },
    { key: "achievements", label: t("manager.tabAchievements", { unlocked: unlockedCount, total: achievements.length }) },
  ];

  return (
    <div className="max-w-3xl mx-auto">
      <button
        onClick={() => navigate(-1)}
        className="text-cz-3 hover:text-cz-1 text-sm mb-4 inline-flex items-center gap-1 transition-colors">
        <ChevronLeftIcon size={16} />{t("manager.back")}
      </button>

      {/* Header */}
      <Card className="p-5 mb-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-xl font-bold text-cz-1">{team.name}</h1>
              {isOwnProfile && (
                <CategoryTag className="text-cz-accent-t border-cz-accent/30 bg-cz-accent/10">{t("manager.yourTeam")}</CategoryTag>
              )}
            </div>
            <p className="text-cz-2 text-sm mb-3">
              {t("manager.managerPrefix")} <span className="text-cz-2">{user.username}</span>
              {" · "}{t("manager.division", { n: team.division })}
            </p>
            <OnlineBadge isOnline={user.is_online} lastSeen={user.last_seen} />
            {isOwnProfile && (
              <Link
                to="/profile"
                className="inline-flex items-center gap-1 mt-3 text-xs font-medium text-cz-3 hover:text-cz-1 transition-colors">
                <SettingsIcon size={13} />{t("manager.settingsLink")}
              </Link>
            )}
          </div>
          <div className="flex gap-3 ms-4">
            {/* Login-streak skjult per #1139 — ingen daglig login-tvang. Kosmetisk achievements bevares. */}
            <div className="bg-cz-subtle border border-cz-border rounded-cz px-4 py-3 text-center">
              <TrophyIcon size={20} className="mx-auto text-cz-accent" />
              <p className="text-cz-1 font-bold text-sm mt-1">{unlockedCount}</p>
              <p className="text-cz-3 text-[10px]">{t("manager.achievements")}</p>
            </div>
          </div>
        </div>

        {unlockedCount > 0 && (
          <div className="mt-4 pt-4 border-t border-cz-border">
            <p className="text-cz-3 text-[10px] uppercase tracking-wider mb-3">{t("manager.recentlyUnlocked")}</p>
            <div className="flex gap-2 flex-wrap">
              {achievements
                .filter(a => a.unlocked)
                .sort((a, b) => new Date(b.unlocked_at) - new Date(a.unlocked_at))
                .slice(0, 8)
                .map(a => <AchievementBadge key={a.id} achievement={a} />)}
            </div>
          </div>
        )}
      </Card>

      {/* Tabs */}
      <Tabs value={tab} onChange={setTab}>
        <TabList label={team.name} className="mb-4">
          {TABS.map(tabItem => (
            <Tab key={tabItem.key} value={tabItem.key}>{tabItem.label}</Tab>
          ))}
        </TabList>

        <TabPanel value="overview">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Card className="p-4 text-center">
                <p className="text-cz-3 text-[10px] uppercase tracking-wider mb-1">{tCommon("nav.item.riders")}</p>
                <p className="text-cz-1 font-bold text-xl">{riders.length}</p>
              </Card>
              <Card className="p-4 text-center">
                <p className="text-cz-3 text-[10px] uppercase tracking-wider mb-1">{t("manager.statSeasons")}</p>
                <p className="text-cz-1 font-bold text-xl">{season_history.length}</p>
              </Card>
              <Card className="p-4 text-center">
                <p className="text-cz-3 text-[10px] uppercase tracking-wider mb-1">{t("manager.statTransfers")}</p>
                <p className="text-cz-1 font-bold text-xl">{transfer_activity.length}</p>
              </Card>
            </div>
            <Card className="p-5">
              <h2 className="text-cz-1 font-semibold text-sm mb-4">{t("manager.recentTransfers")}</h2>
              {transfer_activity.length === 0 ? (
                <p className="text-cz-3 text-sm text-center py-4">{t("manager.noTransfers")}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {transfer_activity.map(tx => {
                    const isBuyer = tx.buyer_team?.id === teamId;
                    return (
                      <div key={tx.id} className="flex items-center justify-between py-2 border-b border-cz-border last:border-0">
                        <div>
                          <p className="text-cz-1 text-sm">{tx.rider?.firstname} {tx.rider?.lastname}</p>
                          <p className="text-cz-3 text-xs">
                            {isBuyer ? t("manager.boughtFrom") : t("manager.soldTo")}{" "}
                            <Link to={`/managers/${isBuyer ? tx.seller_team?.id : tx.buyer_team?.id}`}
                              className="text-cz-accent-t/70 hover:text-cz-accent-t">
                              {isBuyer ? tx.seller_team?.name : tx.buyer_team?.name}
                            </Link>
                          </p>
                        </div>
                        <span className={`font-mono font-bold text-sm ${isBuyer ? "text-cz-danger" : "text-cz-success"}`}>
                          {isBuyer ? "-" : "+"}{formatNumber(tx.offer_amount)} CZ$
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </TabPanel>

        <TabPanel value="riders">
          {riders.length === 0 ? (
            <EmptyState icon={<InboxIcon size={32} />} title={t("manager.noRiders")} />
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <thead><tr>
                  <Th>{t("manager.thRider")}</Th>
                  <Th numeric>{t("manager.thValue")}</Th>
                  {/* #1529: de 15 CZ-evner (delt config lib/abilities.js) erstatter de
                      hardkodede 3 PCM-stats (BJ/SP/TT). Korte labels = ingen i18n (#487). */}
                  {ABILITY_STATS.map(({ key }) => (
                    <Th key={key} numeric className="hidden sm:table-cell px-1.5">{ABILITY_SHORT[key]}</Th>
                  ))}
                </tr></thead>
                <tbody>
                  {riders.map(r => (
                    <Tr key={r.id} onClick={() => navigate(`/riders/${r.id}`)} className="cursor-pointer">
                      <Td>
                        <RiderLink id={r.id} stopPropagation
                          className="text-cz-1 text-sm hover:text-cz-accent-t transition-colors block">
                          {r.firstname} {r.lastname}
                        </RiderLink>
                        {/* #42: alders-badge afledt af alder (U23 <23, U25 23-24, ingen ≥25)
                            via ageBadgeKey — ikke rå is_u25, der også er true for U23. */}
                        {(() => {
                          const ageTier = ageBadgeKey(r);
                          return ageTier ? (
                            <span className="text-[9px] bg-cz-subtle border border-cz-border text-cz-2 px-1.5 py-0.5 rounded-cz">{tRider(`header.${ageTier}`)}</span>
                          ) : null;
                        })()}
                      </Td>
                      <Td numeric className="text-cz-accent-t">{formatNumber(r.market_value)}</Td>
                      {ABILITY_STATS.map(({ key }) => (
                        <Td key={key} numeric className="hidden sm:table-cell px-1.5">
                          <span className="inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded"
                            style={statStyle(r[key] ?? 0)}>
                            {r[key] ?? "—"}
                          </span>
                        </Td>
                      ))}
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </TabPanel>

        <TabPanel value="season">
          {season_history.length === 0 ? (
            <EmptyState icon={<InboxIcon size={32} />} title={t("manager.noSeasonHistory")} />
          ) : (
            <Card className="overflow-hidden">
              <Table>
                <thead><tr>
                  <Th>{t("manager.thSeason")}</Th>
                  <Th className="text-center">{t("manager.thDivision")}</Th>
                  <Th numeric>{t("manager.thPoints")}</Th>
                  <Th numeric>{t("manager.thRank")}</Th>
                </tr></thead>
                <tbody>
                  {season_history.map(s => (
                    <Tr key={s.id}>
                      <Td>
                        {t("manager.seasonNumber", { n: s.season?.number })}
                        {/* #1095: markér igangværende sæson, så historik ikke forveksles med nutid */}
                        {s.season?.status === "active" && (
                          <StatusBadge state="live" emphasis className="ms-2">
                            {t("manager.seasonOngoing")}
                          </StatusBadge>
                        )}
                      </Td>
                      <Td className="text-center text-cz-2">{t("manager.divisionShort", { n: s.division })}</Td>
                      <Td numeric className="text-cz-accent-t">{formatNumber(s.total_points)}</Td>
                      <Td numeric>
                        {s.final_rank === 1
                          ? <span className="inline-flex items-center justify-end gap-1 text-cz-accent-t font-bold"><TrophyIcon size={14} />#1</span>
                          : <span className="text-cz-2">#{s.final_rank || "—"}</span>}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </TabPanel>

        <TabPanel value="achievements">
          <div className="space-y-4">
            {Object.entries(achByCategory).map(([cat, achs]) => {
              const inProgress = achs.filter(a => a.progress);
              return (
                <Card key={cat} className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-cz-1 font-semibold text-sm capitalize">{cat}</h2>
                    <span className="text-cz-3 text-xs">{achs.filter(a => a.unlocked).length}/{achs.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {achs.map(a => <AchievementBadge key={a.id} achievement={a} />)}
                  </div>
                  {inProgress.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-cz-border space-y-3">
                      <p className="text-cz-3 text-[10px] uppercase tracking-wider">{t("manager.inProgress")}</p>
                      {inProgress.map(a => <AchievementProgress key={a.id} achievement={a} />)}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </TabPanel>
      </Tabs>
    </div>
  );
}
