// #2009 · Rytterkortet (v2): FM-agtig miniprofil, ÉN genbrugskomponent.
//
// Aabnes fra person-ikonet foran rytternavnet (components/rider/RiderNameIcon.tsx,
// koblet paa RiderLink): hover viser kortet, klik fastlaaser det, og paa mobil
// aabner et tryk det som bundark. Den gamle indpakning (default-eksporten)
// virker stadig for flader der vil give kortet ekstra kontekst via `extra`.
//
// Indhold (ejer 7/11): navn (Inter Tight, aldrig Bebas, TASTE P4), nation, hold,
// alder, spillets egne status-maerker (RiderBadges), ryttertype, rating, dette
// loeb (etape, samlet, troejer), vaerdi og kontrakt, sidste 5 uger, alle evner
// i profilens raekkefoelge og farver. Egne ryttere: ogsaa potentiale, form nu,
// traethed nu og planen for naeste etape (scouting-fog for alle andre).
//
// Modellen (lib/riderHoverCardModel.ts) afgoer hvad der vises; her hentes og
// tegnes kun. Alt hentes foerst naar kortet aabner, og huskes et minut.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import Portal from "./Portal.jsx";
import { XIcon, StarIcon, JerseyIcon } from "./icons/index.jsx";
import { buttonClass } from "./buttonStyles.js";
import { useModalA11y } from "../../hooks/useModalA11y.js";
import { useActiveSeasonYear } from "../../hooks/useActiveSeasonYear.js";
import { useMyTeamId } from "../../hooks/useMyTeamId.js";
import { Flag } from "../Flag.jsx";
import RiderTypeBadge from "../rider/RiderTypeBadge.jsx";
import RiderBadges from "../rider/RiderBadges.jsx";
import ScoutablePotentiale from "../rider/ScoutablePotentiale.jsx";
import { useScouting } from "../../lib/useScouting.js";
import { ABILITY_SELECT } from "../../lib/abilities.js";
import { statPlateStyle, statStyle } from "../../lib/statColor.js";
import { formatCz } from "../../lib/marketValues.js";
import { formatNumber } from "../../lib/intl.js";
import { seasonNumberFromReferenceYear } from "../../lib/riderAge.js";
import { injuryTimeLeft } from "../../lib/training.js";
import { roleLabelKey } from "../../lib/stageRoleVocabulary.ts";
import { fetchTeamOrders } from "../../lib/tacticsOrdersAdapter.js";
import { stageOrdersRecap } from "../stageOrders/stageOrdersRecap.ts";
import type { TeamOrdersContext } from "../stageOrders/stageOrdersRecap.ts";
import { reportActionFailure } from "../../lib/actionTelemetry.js";
import { deriveRaceStatus } from "../../lib/raceHubLogic.js";
import { supabase } from "../../lib/supabase.ts";
import {
  RECENT_WINDOW_DAYS, buildRiderHoverCardModel, canHover, placeHoverCard, summarizeRecentResults,
} from "../../lib/riderHoverCardModel.ts";
import type {
  HoverCardPlan, HoverCardRaceInput, HoverCardRecent, HoverCardRiderRow, JerseyDayType, RiderHoverCardModel,
} from "../../lib/riderHoverCardModel.ts";
import { RIDER_HOVER_CARD_FLAG_KEY, useRiderOverlaysEnabled } from "../rider/RiderNameIcon.tsx";

export { RIDER_HOVER_CARD_FLAG_KEY };
/** Bagudkompatibelt navn for kontakten (samme abonnement som ikonet). */
export const useRiderHoverCardEnabled = useRiderOverlaysEnabled;

const OPEN_DELAY_MS = 300;
const CLOSE_DELAY_MS = 150;
const CACHE_TTL_MS = 60_000;

// ── Data: hentes foerst naar kortet (eller menuen) aabner ────────────────────
// PostgREST-klienten er utypet i denne kodebase; svarene valideres af modellen.
type Loose = any;
const db = supabase as unknown as { from(table: string): Loose; auth: { getSession(): Promise<{ data: { session: { user?: { id?: string } } | null } }> } };

const RIDER_COLUMNS = [
  "id, firstname, lastname, birthdate, nationality_code, primary_type, secondary_type, team_id",
  "is_u25, is_retired, is_academy, salary, contract_end_season, market_value, best_role, best_role_rating",
  "team:team_id(id, name, manager_name, is_ai, is_bank)",
  ABILITY_SELECT,
  "rider_condition(form, fatigue, injured_until, injury_race_days_left)",
].join(", ");

export type RiderCardData = {
  row: HoverCardRiderRow;
  userId: string | null;
  market: { inAuction: boolean; listed: boolean };
  condition: { form: number | null; fatigue: number | null; injured: boolean };
  race: HoverCardRaceInput | null;
  recent: HoverCardRecent | null;
  onWatchlist: boolean | null;
  plan: HoverCardPlan | null;
};

async function settle<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T | null> {
  try {
    const res = await p;
    return res.error ? null : res.data;
  } catch {
    return null;
  }
}

async function loadPlan(raceId: string, riderId: string, nextStage: number): Promise<HoverCardPlan | null> {
  try {
    const ctx = (await fetchTeamOrders({ raceId })) as (TeamOrdersContext & { stagePlanEnabled?: boolean }) | null;
    if (!ctx) return null;
    const recap = stageOrdersRecap({ context: ctx, stageNumber: nextStage, riderIds: [riderId] });
    const r = recap?.riders.find((x) => x.riderId === riderId);
    if (!r) return null;
    return { role: r.role, tasks: r.plan, effort: r.effort };
  } catch {
    // catch-ok: planen er en ekstra linje; kortet vises uden den.
    return null;
  }
}

async function fetchRiderCard(riderId: string, viewerTeamId: string | null): Promise<RiderCardData | null> {
  let userId: string | null = null;
  try {
    const { data } = await db.auth.getSession();
    userId = data?.session?.user?.id ?? null;
  } catch {
    userId = null;
  }
  const since = new Date(Date.now() - RECENT_WINDOW_DAYS * 86_400_000).toISOString();
  const [rowRes, auctions, listings, entries, recentRows, watch] = await Promise.all([
    // pagination-safe: én raekke via primaernoeglen.
    Promise.resolve(db.from("riders").select(RIDER_COLUMNS).eq("id", riderId).maybeSingle()) as Promise<{ data: HoverCardRiderRow | null; error: unknown }>,
    settle<Array<{ id: string }>>(db.from("auctions").select("id").eq("rider_id", riderId).in("status", ["active", "extended"]).limit(1)),
    settle<Array<{ id: string }>>(db.from("transfer_listings").select("id").eq("rider_id", riderId).eq("status", "open").limit(1)),
    // pagination-safe: én rytter, kun startede loeb der ikke er afsluttet. Et loeb
    // staar som "scheduled" mens etaperne koerer; "live" afledes af fremdriften
    // (deriveRaceStatus, #1828), backenden skriver aldrig "active" (Codex-fund).
    settle<Array<{ race_id: string; race: Loose }>>(db.from("race_entries")
      .select("race_id, race:race_id!inner(id, name, race_type, stages, stages_completed, status)")
      .eq("rider_id", riderId).eq("race.status", "scheduled").gt("race.stages_completed", 0).limit(5)),
    // pagination-safe: én rytter, kun etape-resultater fra de sidste 5 uger.
    settle<Array<Record<string, unknown>>>(db.from("race_results")
      .select("race_id, stage_number, rank, imported_at")
      .eq("rider_id", riderId).eq("result_type", "stage").gte("imported_at", since)
      .order("imported_at", { ascending: false }).limit(200)),
    userId
      ? settle<Array<{ id: string }>>(db.from("rider_watchlist").select("id").eq("user_id", userId).eq("rider_id", riderId).limit(1))
      : Promise.resolve(null),
  ]);
  if (rowRes.error) throw rowRes.error;
  const row = rowRes.data;
  if (!row) return null;

  const condEmbed = (row as Record<string, unknown>).rider_condition as Loose;
  const cond = (Array.isArray(condEmbed) ? condEmbed[0] : condEmbed) ?? null;
  const entry = (entries ?? []).find((e) => e?.race
    && deriveRaceStatus(e.race.status, Number(e.race.stages_completed), Number(e.race.stages)) === "live");
  const race = entry?.race ?? null;

  let raceInput: HoverCardRaceInput | null = null;
  let plan: HoverCardPlan | null = null;
  if (race) {
    const completed = Number(race.stages_completed) || 0;
    const results = completed > 0
      // pagination-safe: én rytter, ét loeb, én etape (alle dag-typer).
      ? (await settle<Array<Record<string, unknown>>>(db.from("race_results")
        .select("result_type, stage_number, rank")
        .eq("race_id", race.id).eq("rider_id", riderId).eq("stage_number", completed).limit(20))) ?? []
      : [];
    raceInput = {
      raceId: String(race.id),
      raceName: race.name ?? null,
      raceType: race.race_type ?? null,
      stages: Number(race.stages) || null,
      stagesCompleted: completed,
      results,
    };
    const isOwn = viewerTeamId !== null && String(row.team_id ?? "") === String(viewerTeamId);
    const nextStage = completed + 1;
    if (isOwn && nextStage <= (Number(race.stages) || 1)) plan = await loadPlan(String(race.id), String(row.id), nextStage);
  }

  return {
    row: { ...row, rider_condition: undefined },
    userId,
    market: { inAuction: (auctions ?? []).length > 0, listed: (listings ?? []).length > 0 },
    condition: {
      form: cond?.form ?? null,
      fatigue: cond?.fatigue ?? null,
      injured: cond?.injured_until ? injuryTimeLeft(cond).count > 0 : false,
    },
    race: raceInput,
    recent: recentRows ? summarizeRecentResults(recentRows) : null,
    onWatchlist: userId ? (watch ?? []).length > 0 : null,
    plan,
  };
}

const cardCache = new Map<string, { at: number; promise: Promise<RiderCardData | null> }>();

/** Rytterens kort-data (delt af kortet og hoejreklik-menuen). */
export function loadRiderCard(riderId: string, viewerTeamId: string | null): Promise<RiderCardData | null> {
  const key = `${riderId}|${viewerTeamId ?? ""}`;
  const hit = cardCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise;
  const promise = fetchRiderCard(riderId, viewerTeamId);
  // En fejl huskes ikke: naeste aabning proever igen.
  promise.catch(() => cardCache.delete(key));
  cardCache.set(key, { at: Date.now(), promise });
  return promise;
}

export function forgetRiderCard(riderId: string) {
  for (const key of cardCache.keys()) if (key.startsWith(`${riderId}|`)) cardCache.delete(key);
}

/** Oenskeliste til/fra med samme raekker som rytterdatabasen (ingen ny backend). */
export async function setRiderWatchlist(userId: string, riderId: string, on: boolean): Promise<boolean> {
  const q = on
    ? db.from("rider_watchlist").insert({ user_id: userId, rider_id: riderId })
    : db.from("rider_watchlist").delete().eq("user_id", userId).eq("rider_id", riderId);
  const { error } = await q;
  if (error) {
    reportActionFailure("rider_watchlist_toggle", { reason: error.message, context: { riderId, op: on ? "insert" : "delete", surface: "rider_card" } });
    return false;
  }
  forgetRiderCard(riderId);
  return true;
}

type LoadState = { status: "loading" | "ready" | "error"; data: RiderCardData | null };

export function useRiderCardData(riderId: string): LoadState & { viewerTeamId: string | null; viewerResolved: boolean; reload: () => void } {
  const { teamId, resolved } = useMyTeamId() as { teamId: string | null; resolved: boolean };
  const viewerTeamId = teamId === null || teamId === undefined ? null : String(teamId);
  const [state, setState] = useState<LoadState>({ status: "loading", data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!resolved) return undefined;
    let alive = true;
    setState((s) => (s.data ? s : { status: "loading", data: null }));
    loadRiderCard(riderId, viewerTeamId).then(
      (data) => { if (alive) setState({ status: data ? "ready" : "error", data }); },
      () => { if (alive) setState({ status: "error", data: null }); },
    );
    return () => { alive = false; };
  }, [riderId, viewerTeamId, resolved, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, viewerTeamId, viewerResolved: resolved, reload };
}

// ── Indholdet (samme i popover og bundark) ───────────────────────────────────
const LABEL = "font-data text-3xs font-semibold uppercase tracking-widest text-cz-3";
const VALUE = "font-data text-sm font-semibold tabular-nums text-cz-1";

const JERSEY_VAR: Record<JerseyDayType, string> = {
  leader: "leader",
  points_day: "points",
  mountain_day: "mountain",
  young_day: "young",
};

function OwnPotential({ riderId }: { riderId: string }) {
  const scouting = useScouting();
  return <ScoutablePotentiale rider={{ id: riderId }} scouting={scouting} />;
}

function AbilityRow({ abilityKey, value }: { abilityKey: string; value: number | null }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center justify-between gap-2 py-0.5">
      <span className="min-w-0 truncate text-xs text-cz-2">{t(`rider:racePreview.derived.${abilityKey}`)}</span>
      {value === null ? (
        <span className="text-xs text-cz-3 tabular-nums">-</span>
      ) : (
        <span
          className="inline-flex min-w-[26px] justify-center rounded-cz px-1 text-2xs font-semibold tabular-nums"
          style={statStyle(value)}
          data-ability={abilityKey}
        >
          {value}
        </span>
      )}
    </li>
  );
}

function AbilityGroup({ group }: { group: RiderHoverCardModel["groups"][number] }) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0">
      <p className={`${LABEL} mb-1`}>{t(`rider:stats.categories.${group.key}`)}</p>
      <ul>
        {group.abilities.map((a) => <AbilityRow key={a.key} abilityKey={a.key} value={a.value} />)}
      </ul>
    </div>
  );
}

function Fact({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="min-w-0" data-rider-card-fact={testId}>
      <dt className={`${LABEL} mb-0.5`}>{label}</dt>
      <dd className="min-w-0 truncate text-xs text-cz-2">{children}</dd>
    </div>
  );
}

function RaceNow({ race }: { race: NonNullable<RiderHoverCardModel["race"]> }) {
  const { t } = useTranslation();
  const rank = (n: number | null) => (n === null ? "-" : formatNumber(n));
  const oneDay = race.stageCount === 1;
  return (
    <section className="mt-3 border-t border-cz-border pt-2.5" data-rider-card-race="">
      <p className={`${LABEL} mb-1 truncate`}>
        {t("common:riderHoverCard.thisRace")}{race.raceName ? ` · ${race.raceName}` : ""}
      </p>
      {race.stageNumber === null ? (
        <p className="text-xs text-cz-2">{t("common:riderHoverCard.notStarted")}</p>
      ) : (
        <dl className="flex flex-wrap items-end gap-x-5 gap-y-1">
          <div>
            <dt className="text-2xs text-cz-3">{oneDay ? t("common:riderHoverCard.result") : t("common:riderHoverCard.stage", { n: race.stageNumber })}</dt>
            <dd className={VALUE}>{rank(race.stageRank)}</dd>
          </div>
          {!oneDay && (
            <div>
              <dt className="text-2xs text-cz-3">{t("common:riderHoverCard.gc")}</dt>
              <dd className={VALUE}>{rank(race.gcRank)}</dd>
            </div>
          )}
          {race.jerseys.length > 0 && (
            <div className="flex items-center gap-1.5 pb-0.5">
              {race.jerseys.map((j) => (
                <span
                  key={j}
                  title={t(`races:detail.jersey.${j}`)}
                  aria-label={t(`races:detail.jersey.${j}`)}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-cz border border-cz-border"
                  style={{ background: `rgb(var(--jersey-${JERSEY_VAR[j]}-bg))`, color: `rgb(var(--jersey-${JERSEY_VAR[j]}-fg))` }}
                >
                  <JerseyIcon size={13} aria-hidden="true" />
                </span>
              ))}
            </div>
          )}
        </dl>
      )}
    </section>
  );
}

function PlanText({ plan }: { plan: HoverCardPlan | null }) {
  const { t } = useTranslation();
  if (!plan) return <>{t("common:riderHoverCard.noPlan")}</>;
  const roleKey = roleLabelKey(plan.role);
  const parts = [
    roleKey ? t(`races:${roleKey}`) : null,
    plan.tasks && plan.tasks.length
      ? plan.tasks.map((task) => t(`races:stagePlan.task.${task}`)).join(", ")
      : plan.effort ? t(`races:tacticsOrders.effort.${plan.effort}`) : null,
  ].filter(Boolean);
  return <>{parts.length ? parts.join(" · ") : t("common:riderHoverCard.noPlan")}</>;
}

export type CardActionHandlers = {
  watchBusy?: boolean;
  onToggleWatch?: () => void;
  onNavigate?: () => void;
};

function CardActions({ model, onWatchlist, handlers, sheet }: {
  model: RiderHoverCardModel; onWatchlist: boolean | null; handlers: CardActionHandlers; sheet: boolean;
}) {
  const { t } = useTranslation();
  const size = sheet ? "md" : "sm";
  const secondary = buttonClass({ variant: "secondary", size });
  return (
    <div className="mt-3 flex flex-wrap gap-2 border-t border-cz-border pt-3" data-rider-card-actions="">
      {/* Kortet ligger oven paa en side, der allerede har sin ene guld-knap: kun i
          bundarket (en selvstaendig flade) er "Aabn profil" den primaere handling. */}
      <Link to={`/riders/${model.id}`} onClick={handlers.onNavigate}
        className={sheet ? `${buttonClass({ variant: "primary", size, fullWidth: true })}` : secondary}>
        {t("common:riderHoverCard.openProfile")}
      </Link>
      {model.actions.watchlist && onWatchlist !== null && (
        <button type="button" className={secondary} disabled={handlers.watchBusy} onClick={handlers.onToggleWatch}
          aria-pressed={onWatchlist} data-rider-card-watch="">
          <StarIcon size={13} aria-hidden="true" />
          {onWatchlist ? t("common:riderMenu.watchlistRemove") : t("common:riderMenu.watchlistAdd")}
        </button>
      )}
      <Link to={`/compare?ids=${encodeURIComponent(model.id)}`} onClick={handlers.onNavigate} className={secondary}>
        {t("common:riderHoverCard.compare")}
      </Link>
      {model.actions.bid && (
        <Link to={`/riders/${model.id}`} onClick={handlers.onNavigate} className={secondary}>
          {t("common:riderHoverCard.bid")}
        </Link>
      )}
    </div>
  );
}

export function CardContent({ model, extra, titleId, honours, onWatchlist = null, handlers = {}, sheet = false }: {
  model: RiderHoverCardModel; extra?: ReactNode; titleId: string; honours?: ReactNode;
  onWatchlist?: boolean | null; handlers?: CardActionHandlers; sheet?: boolean;
}) {
  const { t } = useTranslation();
  const [physical, ...rest] = model.groups;
  const meta = [
    model.teamName ?? t("rider:header.freeAgent"),
    model.age !== null ? t("rider:header.ageYears", { age: model.age }) : null,
    model.nationalityCode ? model.nationalityCode.toUpperCase() : null,
  ].filter(Boolean);
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="font-data text-base font-bold leading-tight text-cz-1 wrap-break-word">
            {model.nationalityCode && <Flag code={model.nationalityCode} className="me-1.5 align-[-1px]" title={undefined} />}
            {model.name || "-"}
          </h2>
          <p className="mt-0.5 text-xs text-cz-2 tabular-nums">{meta.join(" · ")}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1" data-rider-card-badges="">
            {model.primaryType && <RiderTypeBadge primaryType={model.primaryType} secondaryType={model.secondaryType} />}
            <RiderBadges badges={model.badges} />
            {/* Plads til mestertroeje og talentmaerke (#7824 bygger dem). */}
            {honours}
          </div>
        </div>
        <div className="flex-none text-right">
          <p className={`${LABEL} mb-1`}>{t("rider:header.overall")}</p>
          {model.rating === null ? (
            <span className="font-data text-lg text-cz-3">-</span>
          ) : (
            <span
              className="inline-flex min-w-[38px] justify-center rounded-cz px-1.5 py-0.5 font-data text-lg font-semibold leading-tight tabular-nums"
              style={statPlateStyle(model.rating)}
              data-rider-hover-rating={model.rating}
            >
              {model.rating}
            </span>
          )}
        </div>
      </div>

      {model.race && <RaceNow race={model.race} />}

      <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-2 border-t border-cz-border pt-2.5">
        <Fact label={t("common:riderHoverCard.value")} testId="value">
          <span className="tabular-nums text-cz-1">{model.marketValue === null ? "-" : formatCz(model.marketValue)}</span>
        </Fact>
        <Fact label={t("common:riderHoverCard.contract")} testId="contract">
          {model.contractEndSeason === null ? (
            t("common:riderHoverCard.noContract")
          ) : (
            <span className="tabular-nums" title={model.salary === null ? undefined : t("common:riderHoverCard.perSeason", { salary: formatCz(model.salary) })}>
              {t("common:riderHoverCard.contractUntil", { season: model.contractEndSeason })}
            </span>
          )}
        </Fact>
        <Fact label={t("common:riderHoverCard.recent")} testId="recent">
          {model.recent === null ? "-" : (
            <span className="tabular-nums" title={`${t("common:riderHoverCard.raceDays")} · ${t("common:riderHoverCard.wins")} · ${t("common:riderHoverCard.podiums")}`}>
              <span className="text-cz-1">{formatNumber(model.recent.raceDays)}</span> {t("common:riderHoverCard.raceDays").toLowerCase()}
            </span>
          )}
        </Fact>
        {model.recent !== null && (
          <>
            <Fact label={t("common:riderHoverCard.wins")} testId="wins"><span className="tabular-nums text-cz-1">{formatNumber(model.recent.wins)}</span></Fact>
            <Fact label={t("common:riderHoverCard.podiums")} testId="podiums"><span className="tabular-nums text-cz-1">{formatNumber(model.recent.podiums)}</span></Fact>
            <div aria-hidden="true" />
          </>
        )}
      </dl>

      {model.own && (
        <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-2 border-t border-cz-border pt-2.5" data-rider-card-own="">
          <Fact label={t("common:riderHoverCard.form")} testId="form">
            <span className="tabular-nums text-cz-1">{model.own.form === null ? "-" : formatNumber(model.own.form)}</span>
          </Fact>
          <Fact label={t("common:riderHoverCard.fatigue")} testId="fatigue">
            <span className="tabular-nums text-cz-1">{model.own.fatigue === null ? "-" : formatNumber(model.own.fatigue)}</span>
          </Fact>
          {model.race && (
            <Fact label={t("common:riderHoverCard.nextStage")} testId="plan"><PlanText plan={model.own.plan} /></Fact>
          )}
        </dl>
      )}

      {model.showPotential && (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-cz-border pt-2.5" data-rider-hover-potential="">
          <span className={LABEL}>{t("rider:header.potential")}</span>
          <OwnPotential riderId={model.id} />
        </div>
      )}

      {extra && <div className="mt-3 border-t border-cz-border pt-2.5">{extra}</div>}

      <div className="mt-3 grid grid-cols-2 gap-x-5 border-t border-cz-border pt-2.5">
        {physical && <AbilityGroup group={physical} />}
        <div className="flex min-w-0 flex-col gap-3">
          {rest.map((g) => <AbilityGroup key={g.key} group={g} />)}
        </div>
      </div>

      <CardActions model={model} onWatchlist={onWatchlist} handlers={handlers} sheet={sheet} />
    </>
  );
}

function CardBody({ riderId, extra, titleId, sheet, onNavigate }: {
  riderId: string; extra?: ReactNode; titleId: string; sheet: boolean; onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const seasonYear = useActiveSeasonYear() as number | null;
  const { status, data, viewerTeamId, reload } = useRiderCardData(riderId);
  const [watchBusy, setWatchBusy] = useState(false);
  const [watchFailed, setWatchFailed] = useState(false);
  if (status === "loading" && !data) {
    return <p className="py-6 text-center text-xs text-cz-3">{t("common:actions.loading")}</p>;
  }
  const model = data ? buildRiderHoverCardModel(data.row, {
    viewerTeamId,
    seasonYear,
    activeSeasonNumber: seasonYear === null ? null : seasonNumberFromReferenceYear(seasonYear),
    market: data.market,
    condition: data.condition,
    race: data.race,
    recent: data.recent,
    plan: data.plan,
  }) : null;
  if (!model || !data) {
    return <p className="py-6 text-center text-xs text-cz-3">{t("common:riderHoverCard.loadError")}</p>;
  }
  const toggleWatch = async () => {
    if (!data.userId || watchBusy) return;
    setWatchBusy(true);
    setWatchFailed(false);
    const ok = await setRiderWatchlist(data.userId, model.id, !data.onWatchlist);
    setWatchBusy(false);
    if (ok) reload(); else setWatchFailed(true);
  };
  return (
    <>
      <CardContent model={model} extra={extra} titleId={titleId} onWatchlist={data.onWatchlist}
        handlers={{ watchBusy, onToggleWatch: toggleWatch, onNavigate }} sheet={sheet} />
      {watchFailed && <p role="alert" className="mt-2 text-xs text-cz-danger">{t("common:riderMenu.watchlistFailed")}</p>}
    </>
  );
}

// ── Desktop: popover ved ikonet ──────────────────────────────────────────────
function HoverPopover({
  anchor, riderId, extra, pinned, onEnter, onLeave, onClose,
}: {
  anchor: HTMLElement; riderId: string; extra?: ReactNode; pinned: boolean;
  onEnter: () => void; onLeave: () => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const titleId = `rider-hover-card-${riderId}`;

  const place = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const r = anchor.getBoundingClientRect();
    const next = placeHoverCard(r, { width: node.offsetWidth, height: node.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
    setPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : { top: next.top, left: next.left }));
  }, [anchor]);

  useLayoutEffect(() => { place(); });

  // Indholdet hentes efter aabning, saa kortet vokser: maal igen (Codex-fund).
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => place());
    ro.observe(node);
    return () => ro.disconnect();
  }, [place]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // Fastlaast kort foelger med naar siden ruller; et hover-kort lukker.
    // Rulning INDE i kortet (lavt vindue/zoom) maa ikke lukke det (Codex-fund).
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && ref.current?.contains(e.target)) return;
      if (pinned) place(); else onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (!pinned) return;
      const target = e.target as Node | null;
      if (target && (ref.current?.contains(target) || anchor.contains(target))) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose, pinned, place, anchor]);

  return (
    <Portal>
      <div
        ref={ref}
        role="dialog"
        aria-labelledby={titleId}
        data-testid="rider-hover-card"
        data-pinned={pinned ? "" : undefined}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        // Portalen sender klik op gennem React-traeet; de maa ikke naa linket eller raekken.
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
        className="fixed z-overlay w-[24rem] max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] overflow-y-auto overscroll-contain rounded-cz border border-cz-border bg-cz-card p-4 shadow-overlay"
      >
        {pinned && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common:actions.close")}
            className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-cz text-cz-3 transition-colors hover:bg-cz-subtle hover:text-cz-1"
          >
            <XIcon size={14} aria-hidden="true" />
          </button>
        )}
        <div className={pinned ? "pe-6" : undefined}>
          <CardBody riderId={riderId} extra={extra} titleId={titleId} sheet={false} onNavigate={onClose} />
        </div>
      </div>
    </Portal>
  );
}

// ── Mobil: bundark efter et tryk ─────────────────────────────────────────────
function TapSheet({ riderId, extra, onClose }: { riderId: string; extra?: ReactNode; onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useModalA11y(onClose, true);
  const titleId = `rider-hover-sheet-${riderId}`;
  return (
    <Portal>
      {/* Portalen sender klik op gennem React-traeet: luk, baggrund og indhold maa ikke naa raekkens klik (Codex-fund). */}
      <div className="fixed inset-0 z-modal flex items-end justify-center" onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
        <div className="cz-overlay-backdrop absolute inset-0 bg-black/60" aria-hidden="true" onClick={onClose} />
        <div
          ref={ref}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          data-testid="rider-hover-sheet"
          className="cz-overlay-panel relative w-full max-w-lg max-h-[85dvh] overflow-y-auto rounded-t-cz border-x border-b-0 border-t border-cz-border bg-cz-card px-4 pb-4 pt-4 shadow-overlay outline-hidden"
        >
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common:actions.close")}
            className="absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-cz text-cz-3 transition-colors hover:bg-cz-subtle hover:text-cz-1"
          >
            <XIcon size={18} aria-hidden="true" />
          </button>
          <div className="pe-8">
            <CardBody riderId={riderId} extra={extra} titleId={titleId} sheet onNavigate={onClose} />
          </div>
        </div>
      </div>
    </Portal>
  );
}

// ── Overlayet som ikonet aabner ──────────────────────────────────────────────
export type RiderCardOverlayProps = {
  riderId: string;
  anchor: HTMLElement;
  variant: "popover" | "sheet";
  pinned?: boolean;
  extra?: ReactNode;
  onEnter?: () => void;
  onLeave?: () => void;
  onClose: () => void;
};

export function RiderCardOverlay({ riderId, anchor, variant, pinned = false, extra, onEnter, onLeave, onClose }: RiderCardOverlayProps) {
  if (variant === "sheet") return <TapSheet riderId={riderId} extra={extra} onClose={onClose} />;
  return (
    <HoverPopover anchor={anchor} riderId={riderId} extra={extra} pinned={pinned}
      onEnter={onEnter ?? (() => {})} onLeave={onLeave ?? (() => {})} onClose={onClose} />
  );
}

// ── Indpakningen (bagudkompatibel): hover paa et vilkaarligt element ─────────
export type RiderHoverCardProps = {
  riderId: string | null | undefined;
  /** Ubrugt: viewerens hold slaas nu op centralt (useMyTeamId). Bevaret for kaldere. */
  viewerTeamId?: string | number | null;
  /** Ekstra kontekst i kortet (fx loebssidens plads, GC, troejer). */
  extra?: ReactNode;
  children: ReactNode;
};

export default function RiderHoverCard({ riderId, extra, children }: RiderHoverCardProps) {
  const enabled = useRiderOverlaysEnabled();
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const [mode, setMode] = useState<"closed" | "popover" | "sheet">("closed");
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const close = useCallback(() => { clearTimers(); setMode("closed"); }, [clearTimers]);
  const keepOpen = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const scheduleClose = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setMode((m) => (m === "popover" ? "closed" : m)), CLOSE_DELAY_MS);
  }, []);

  if (!enabled || !riderId) return <>{children}</>;

  const hoverDevice = () => canHover(typeof window === "undefined" ? null : window.matchMedia?.bind(window));
  // Wrapperen er display: contents (ingen egen boks), saa kortet maales mod navnet selv.
  const anchorNow = () => (wrapperRef.current?.firstElementChild as HTMLElement | null) ?? wrapperRef.current;
  // Kortet ligger i en portal, men React sender dets haendelser op gennem
  // wrapperen. Kun haendelser fra selve navnet maa aabne kortet.
  const fromTrigger = (target: EventTarget | null) => Boolean(wrapperRef.current && target instanceof Node && wrapperRef.current.contains(target));

  return (
    <span
      ref={wrapperRef}
      className="contents"
      data-rider-hover-trigger=""
      onMouseEnter={(e) => {
        if (!hoverDevice()) return;
        keepOpen();
        if (!fromTrigger(e.target) || mode === "popover" || openTimer.current) return;
        openTimer.current = setTimeout(() => {
          openTimer.current = null;
          setAnchor(anchorNow());
          setMode("popover");
        }, OPEN_DELAY_MS);
      }}
      onMouseLeave={() => { if (hoverDevice()) scheduleClose(); }}
    >
      {children}
      {mode !== "closed" && anchor && (
        <RiderCardOverlay riderId={String(riderId)} anchor={anchor} variant={mode === "sheet" ? "sheet" : "popover"}
          extra={extra} onEnter={keepOpen} onLeave={scheduleClose} onClose={close} />
      )}
    </span>
  );
}
