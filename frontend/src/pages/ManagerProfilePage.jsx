import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router";
import { useTranslation } from "react-i18next";
import RiderLink from "../components/RiderLink";
import { supabase, authHeaders } from "../lib/supabase"; // #4348: kanonisk kopi
import { ageBadgeKey } from "../lib/riderAge";
import { useActiveSeasonYear } from "../hooks/useActiveSeasonYear.js";
import OnlineBadge from "../components/OnlineBadge";
import MessageManagerButton from "../components/messages/MessageManagerButton.jsx"; // #3200
import FounderMark from "../components/FounderMark.jsx";
import { formatNumber, formatDate } from "../lib/intl";
import { ABILITY_STATS, ABILITY_SHORT, flattenAbilities } from "../lib/abilities";
import { statStyle } from "../lib/statColor";
import { useSortState, sortRows } from "../lib/useTableSort.js";
import { buttonClass } from "../components/ui/buttonStyles.js";
import { initialsFrom } from "../components/ui/avatarStyles.js";
import { isValidDiscordSnowflake } from "../lib/discordHandle.js";
import {
  Card,
  CategoryTag,
  StatusBadge,
  EmptyState,
  ErrorState,
  Tabs,
  TabList,
  Tab,
  TabPanel,
  HeroStats,
  Table,
  Tr,
  Th,
  Td,
  ProgressMeter,
  Button,
  TrophyIcon,
  LockIcon,
  ChevronLeftIcon,
  InboxIcon,
  SettingsIcon,
  DiscordIcon,
  PageLoader,
  ToastViewport,
} from "../components/ui";

// Matches ToastViewport's default auto-dismiss duration (samme konstant som
// WatchlistPage/#2467).
const TOAST_DURATION_MS = 4000;

const API = import.meta.env.VITE_API_URL;

// Sorterbare kolonner i manager-profilens trup-tabel: navn (efternavn-først),
// markedsværdi + de 15 CZ-evner. Modul-konstant så hook-referencen er stabil.
const MANAGER_RIDER_ACCESSORS = {
  firstname: (r) => `${r.lastname ?? ""} ${r.firstname ?? ""}`.trim(),
  value: (r) => r.market_value ?? 0,
  ...Object.fromEntries(ABILITY_STATS.map(({ key }) => [key, (r) => r[key] ?? 0])),
};

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
          <p className="text-cz-2 text-3xs mt-0.5 leading-relaxed">{description}</p>
        )}
        {achievement.unlocked_at && (
          <p className="text-cz-accent-t/60 text-3xs mt-1">
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

// #2849 bølge 5 gav siden en lokal HeroStatBlock-kopi (ren flex +
// overflow-x-auto). #4628: opskriften bor nu i kittet (components/ui/HeroStats)
// og stabler i to kolonner på mobil — den lokale kopi klippede det fjerde tal
// helt væk på 375px (audit 2026-09, række #37).

export default function ManagerProfilePage() {
  const { teamId } = useParams();
  const navigate   = useNavigate();
  const { t } = useTranslation("team");
  const { t: tCommon } = useTranslation("common");
  const { t: tRider } = useTranslation("rider");
  // #3071: sæson-referenceår til alders-badget (se riderAge.js).
  const seasonYear = useActiveSeasonYear();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState("overview");
  const [myTeamId, setMyTeamId] = useState(null);
  // Trup-tabellen (Riders-fanen) sorteres klient-side; state ligger her øverst
  // fordi rytterne først udledes efter early-returns nedenfor.
  const riderSort = useSortState();
  // #5012: toast til "Copied"/"Kopieret"-feedbacken ved kopi af Discord-
  // brugernavnet (samme mønster som WatchlistPage's pushToast/dismissToast).
  const [toasts, setToasts] = useState([]);

  function dismissToast(id) {
    setToasts(prev => prev.filter(item => item.id !== id));
  }

  function pushToast(tone, title) {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts(prev => [...prev, { id, tone, title }]);
  }

  // #5012: klik på Discord-linjen kopierer brugernavnet til udklipsholderen
  // (bruges når vi IKKE har et gyldigt discord_id at linke direkte til, se
  // render-grenen nedenfor). Samme fejl-tavse mønster som SeasonRecapHero's
  // handleShare — nægtet clipboard-adgang (privat tilstand/rettigheder)
  // fejler bare uden synlig fejl, der er intet destruktivt at rulle tilbage.
  async function copyDiscordHandle(handle) {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(handle);
        pushToast("success", t("manager.discordCopied"));
      }
    } catch {
      // ingen synlig fejl — knappen forbliver bare uden bekræftelse
    }
  }

  const loadMyTeam = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    // #1792: udløbet/ugyldig session → user=null; stop før user.id (auth-flow redirecter til /login)
    if (!user) return;
    const { data: myTeam } = await supabase.from("teams").select("id").eq("user_id", user.id).maybeSingle();
    if (myTeam) setMyTeamId(myTeam.id);
  }, []);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const h = await authHeaders();
      // #4347/#4348: uden session gav kaldet før en 401, `json` blev fejlkroppen
      // og `data` forblev null — spilleren endte i fejl-tilstanden med retry-knap,
      // men først efter et unødvendigt kald. Nu springes kaldet over; samme
      // sluttilstand, uden 401'eren (finally sætter fortsat loading=false).
      if (!h) return;
      const res = await fetch(`${API}/api/managers/${teamId}`, { headers: h });
      const json = await res.json().catch(() => null);
      if (res.ok && json) setData(json);
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => { loadProfile(); loadMyTeam(); }, [loadProfile, loadMyTeam]);

  // Full-bleed-ruten (#2849 bølge 5: /managers/ i Layouts FULL_BLEED_PREFIXES)
  // får ingen Layout-padding — loading/fejl-grenene matcher derfor selv den
  // reviderede T3-kort-container (#2849 bølge 5c: hero er et kort, ikke et bånd).
  if (loading) return (
    <div className="max-w-5xl mx-auto pt-4 md:pt-6 px-4 md:px-8">
      <PageLoader />
    </div>
  );

  // #2849 bølge 5 audit-fund: fejl-tilstand manglede (404 og fetch-fejl kollapsede
  // begge til en stum EmptyState uden retry). Genbruger den eksisterende
  // loadProfile-fetch som retry-handler — ingen ny fejl-skelnende logik.
  if (!data) return (
    <div className="max-w-5xl mx-auto pt-4 md:pt-6 px-4 md:px-8">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-xs font-medium text-cz-2 hover:text-cz-1 transition-colors mb-3">
        <ChevronLeftIcon size={16} />{t("manager.back")}
      </button>
      <ErrorState
        description={t("manager.loadError.message")}
        action={<Button size="sm" variant="secondary" onClick={loadProfile}>{t("manager.loadError.retry")}</Button>}
      />
    </div>
  );

  const {
    team, user,
    riders: rawRiders,
    season_history: rawSeasonHistory,
    achievements: rawAchievements,
    transfer_activity: rawTransferActivity,
    forum_stats: rawForumStats,
  } = data;
  // #1529: backend leverer rytteren med nested rider_derived_abilities — flad evnerne
  // op på rytter-objektet så r.climbing osv. virker i render-cellerne nedenfor.
  const riders = (rawRiders || []).map(flattenAbilities);
  // #2876: achievements/season_history/transfer_activity guardes nu på samme måde
  // som riders — et 200-svar der mangler et af felterne (delvist svar eller en
  // fremtidig kontraktændring) skal degradere til en tom liste, ikke crashe hele
  // siden i error boundary. Backend leverer altid arrayet (evt. tomt, #2876), men
  // frontend skal ikke stole blindt på det.
  const season_history = rawSeasonHistory || [];
  const achievements = rawAchievements || [];
  const transfer_activity = rawTransferActivity || [];
  // #5000: traade + svar i forummet. Samme defensive guard som ovenfor — et
  // svar fra en aeldre backend (eller et AI-hold uden brugerkonto) skal vise 0,
  // ikke braekke heroet.
  const forumPostCount = rawForumStats?.total ?? 0;
  const sortedRiders = sortRows(riders, riderSort.sort ? MANAGER_RIDER_ACCESSORS[riderSort.sort] : null, riderSort.sortDir);
  const unlockedCount = achievements.filter(a => a.unlocked).length;
  const isOwnProfile  = team.id === myTeamId;
  const recentlyUnlocked = achievements
    .filter(a => a.unlocked)
    .sort((a, b) => new Date(b.unlocked_at) - new Date(a.unlocked_at))
    .slice(0, 8);

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

  // #2849 bølge 5 — hero stat-række: sidens nøgletal (trup, sæsoner, transfers,
  // achievements). Erstatter de tre duplikerede stat-mini-cards der tidligere
  // sad øverst i Overview-fanen.
  const statBlocks = [
    { label: tCommon("nav.item.riders"), value: String(riders.length) },
    { label: t("manager.statSeasons"), value: String(season_history.length) },
    { label: t("manager.statTransfers"), value: String(transfer_activity.length) },
    // #5000 (ejer-bestilling 7/9): forummet linker til denne profil — saa skal
    // profilen kunne svare paa "hvor aktiv er manageren i forummet".
    { label: t("manager.statForumPosts"), value: String(forumPostCount) },
    { label: t("manager.achievements"), value: `${unlockedCount}/${achievements.length}` },
  ];

  return (
    <div>
      {/* #2849 bølge 5c — ejer-revision 24/7: heroet er et KORT, ikke et
          full-bleed bånd (RiderProfileHero/RiderStatsPage er referenceimplementeringen).
          Back-linket ligger over kortet på sidens baggrund; kortet bærer selv
          guld-keylinen på topkanten. Layout-ruten er stadig full-bleed — siden
          ejer selv sine containere. Denne wrapper slutter FØR tab-panelerne —
          det er den ANDEN wrapper (nedenfor, `pt-5 ... pb-24 md:pb-16`) der er
          T3-søster-siderne (RaceDetailPage/RiderStatsPage/etc.) sin
          success-container-clearance mod Layout.jsx's fixede MobileQuickNav-
          bar; pb-24 her ville bare give et dobbelt, uønsket mellemrum mellem
          fane-listen og dens paneler (CodeRabbit-fund under denne PR). Den
          akutte fane-under-nav-fejl (manager-profile.spec.js, mobile-webkit)
          sad i HeroStats.jsx's 5-tal-gitter — se kommentaren der. */}
      <div className="max-w-5xl mx-auto pt-4 md:pt-6 px-4 md:px-8">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1 text-xs font-medium text-cz-2 hover:text-cz-1 transition-colors mb-3">
          <ChevronLeftIcon size={16} />{t("manager.back")}
        </button>

        <section className="bg-cz-card border border-cz-border border-t-2 border-t-cz-accent rounded-cz overflow-hidden px-4 md:px-6 pt-5 pb-5">
          <div className="flex items-start justify-between gap-4 flex-wrap sm:flex-nowrap">
            <div className="flex items-center gap-4 min-w-0">
              {/* Identitets-slot (managerkontoen bag holdet) — kvadratisk ramme m.
                  initialer, samme anatomi som rytterprofilens foto-slot. Ingen
                  "Photo"-label: en managerprofil er en spillerkonto, ikke en
                  fotoberettiget entitet (rytter/staff kan få rigtige fotos senere;
                  et hold har ingen ansigt at vente på). */}
              <div className="w-20 h-20 sm:w-24 sm:h-24 flex-none bg-cz-subtle border border-cz-border rounded-cz flex items-center justify-center">
                <span aria-hidden="true" className="font-display text-[26px] sm:text-[30px] leading-none text-cz-2">
                  {initialsFrom(team.name)}
                </span>
              </div>
              <div className="min-w-0">
                {/* Holdnavnet FØRST (ejer-runde 24/7: sidens vigtigste ord først;
                    tags/meta er metadata og sidder UNDER navnet). */}
                <h1 className="font-display text-[40px] leading-[.92] uppercase text-cz-1 break-words">{team.name}</h1>
                <div className="flex items-center gap-2 flex-wrap mt-2.5">
                  {isOwnProfile && (
                    <CategoryTag className="text-cz-accent-t border-cz-accent/30 bg-cz-accent/10">{t("manager.yourTeam")}</CategoryTag>
                  )}
                  {/* #5007: Founder-mærke — synligt for ALLE besøgende, samme mønster som ForumAuthorIdentity.jsx. */}
                  <FounderMark teamId={team.id} />
                  <span className="font-data text-2xs uppercase tracking-[.08em] text-cz-3">
                    {t("manager.managerPrefix")} {user?.username ?? t("manager.aiManaged")} · {t("manager.division", { n: team.division })}
                  </span>
                </div>
                {/* #2876 backwards-check: user kan være null (AI-styret hold, ingen
                    tilknyttet brugerkonto) — nås reelt via transfer-historikkens
                    køber/sælger-links. OnlineBadge forudsætter et user-objekt. */}
                {user && (
                  <div className="mt-2">
                    <OnlineBadge isOnline={user.is_online} lastSeen={user.last_seen} />
                  </div>
                )}
              </div>
            </div>
            {/* #3200: primær handling i heroens højre slot — bevidst HER og
                ikke i identitetsrækken ovenfor, hvor #5012/#5007 arbejder
                parallelt. Kun på fremmede profiler med en rigtig manager bag:
                et AI-styret hold (user === null) har ingen at skrive til. */}
            {isOwnProfile ? (
              <Link to="/profile" className={`${buttonClass({ variant: "secondary", size: "sm" })} flex-none`}>
                <SettingsIcon size={13} />{t("manager.settingsLink")}
              </Link>
            ) : user ? (
              <div className="flex-none">
                <MessageManagerButton
                  teamId={team.id}
                  managerName={user.username || team.name}
                  variant="primary"
                />
              </div>
            ) : null}
          </div>

          {/* #5012: Discord-kontaktlinje — separat fra identitets-rækken
              ovenfor (som #5007 rører ved) for at undgå diff-kollision mellem
              de to bølge-workers. Vises KUN når det valgfrie offentlige
              discord_handle-felt er udfyldt (Accept #1: "vises kun naar
              udfyldt") — det eksisterende discord_id (bot-DM-kobling, #2161)
              bruges udelukkende til at gøre klikket smartere (direkte link
              frem for kopi), aldrig til selv at afgøre synlighed. */}
          {user?.discord_handle && (
            <div className="mt-4 pt-4 border-t border-cz-border">
              {isValidDiscordSnowflake(user.discord_id) ? (
                <a
                  href={`https://discord.com/users/${user.discord_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t("manager.discordOpenAria", { handle: user.discord_handle })}
                  className="inline-flex items-center gap-2 font-mono text-sm text-cz-2 hover:text-cz-accent-t transition-colors"
                >
                  <DiscordIcon size={16} className="text-cz-discord shrink-0" aria-hidden="true" />
                  {user.discord_handle}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => copyDiscordHandle(user.discord_handle)}
                  aria-label={t("manager.discordCopyAria", { handle: user.discord_handle })}
                  className="inline-flex items-center gap-2 font-mono text-sm text-cz-2 hover:text-cz-accent-t transition-colors"
                >
                  <DiscordIcon size={16} className="text-cz-discord shrink-0" aria-hidden="true" />
                  {user.discord_handle}
                </button>
              )}
            </div>
          )}

          <HeroStats items={statBlocks} />
        </section>

        {/* Faner UNDER kortet på sidens baggrund — TabList bærer sin egen
            hairline-bundrule (tabsStyles.js); ingen bånd-fusion. */}
        <Tabs value={tab} onChange={setTab}>
          <TabList label={team.name} className="mt-5">
            {TABS.map(tabItem => (
              <Tab key={tabItem.key} value={tabItem.key}>{tabItem.label}</Tab>
            ))}
          </TabList>
        </Tabs>
      </div>

      <div className="max-w-5xl mx-auto pt-5 px-4 md:px-8 pb-24 md:pb-16">
        <Tabs value={tab} onChange={setTab}>
          <TabPanel value="overview">
            <div className="flex flex-col gap-[14px]">
              {/* #2917: kortet blev tidligere skjult helt når intet var låst op, så en
                  ny manager aldrig så at achievements fandtes. Nu står det med en
                  tomtilstand — samme tekst-mønster som "Ingen transfers" nedenfor.
                  Egen nøgle (noRecentAchievements): #2876's manager.noAchievements
                  hører til Achievements-FANENS EmptyState og har sin egen ordlyd. */}
              <Card className="p-5">
                <h2 className="text-cz-1 font-semibold text-sm mb-4">{t("manager.recentlyUnlocked")}</h2>
                {recentlyUnlocked.length === 0 ? (
                  <p className="text-cz-3 text-sm text-center py-4">{t("manager.noRecentAchievements")}</p>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    {recentlyUnlocked.map(a => <AchievementBadge key={a.id} achievement={a} />)}
                  </div>
                )}
              </Card>
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
                <Table data-sortable>
                  <thead><tr>
                    <Th sortKey="firstname" sort={riderSort.sort} sortDir={riderSort.sortDir} onSort={riderSort.handleSort}>{t("manager.thRider")}</Th>
                    <Th numeric sortKey="value" sort={riderSort.sort} sortDir={riderSort.sortDir} onSort={riderSort.handleSort}>{t("manager.thValue")}</Th>
                    {/* #1529: de 15 CZ-evner (delt config lib/abilities.js) erstatter de
                        hardkodede 3 PCM-stats (BJ/SP/TT). Korte labels = ingen i18n (#487). */}
                    {ABILITY_STATS.map(({ key }) => (
                      <Th key={key} numeric sortKey={key} sort={riderSort.sort} sortDir={riderSort.sortDir} onSort={riderSort.handleSort}
                        className="hidden sm:table-cell px-1.5">{ABILITY_SHORT[key]}</Th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {sortedRiders.map(r => (
                      <Tr key={r.id} onClick={() => navigate(`/riders/${r.id}`)} className="cursor-pointer">
                        <Td>
                          <RiderLink id={r.id} stopPropagation
                            className="text-cz-1 text-sm hover:text-cz-accent-t transition-colors block">
                            {r.firstname} {r.lastname}
                          </RiderLink>
                          {/* #42: alders-badge afledt af alder (U23 <23, U25 23-24, ingen ≥25)
                              via ageBadgeKey — ikke rå is_u25, der også er true for U23. */}
                          {(() => {
                            const ageTier = ageBadgeKey(r, seasonYear);
                            return ageTier ? (
                              <span className="text-3xs bg-cz-subtle border border-cz-border text-cz-2 px-1.5 py-0.5 rounded-cz">{tRider(`header.${ageTier}`)}</span>
                            ) : null;
                          })()}
                        </Td>
                        <Td numeric className="text-cz-accent-t">{formatNumber(r.market_value)}</Td>
                        {ABILITY_STATS.map(({ key }) => (
                          <Td key={key} numeric className="hidden sm:table-cell px-1.5">
                            <span className="inline-block min-w-[28px] text-center text-xs font-mono px-1 py-0.5 rounded-cz"
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
                <Table data-sort-exempt="Saeson-historik, kronologisk">
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
                        {/* #2917: kolonnen læste `s.final_rank` — den findes ikke i
                            season_standings (og ingen andre steder i koden), så
                            placeringen har altid vist "#—" for alle. Den rigtige
                            kolonne er rank_in_division (rangen i holdets pulje) —
                            samme tal sæson-achievements nu måles på. */}
                        <Td numeric>
                          {s.rank_in_division === 1
                            ? <span className="inline-flex items-center justify-end gap-1 text-cz-accent-t font-bold"><TrophyIcon size={14} />#1</span>
                            : <span className="text-cz-2">#{s.rank_in_division || "—"}</span>}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            )}
          </TabPanel>

          <TabPanel value="achievements">
            {/* #2876: tom achievements-liste (fx et delvist svar) skal vise en rigtig
                tom-tilstand, ikke et blankt panel — samme opskrift som Riders/Season-fanerne. */}
            {Object.keys(achByCategory).length === 0 ? (
              <EmptyState icon={<InboxIcon size={32} />} title={t("manager.noAchievements")} />
            ) : (
              <div className="flex flex-col gap-[14px]">
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
                          <p className="text-cz-3 text-3xs uppercase tracking-wider">{t("manager.inProgress")}</p>
                          {inProgress.map(a => <AchievementProgress key={a.id} achievement={a} />)}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </TabPanel>
        </Tabs>
      </div>

      <ToastViewport toasts={toasts} onDismiss={dismissToast} duration={TOAST_DURATION_MS} />
    </div>
  );
}
