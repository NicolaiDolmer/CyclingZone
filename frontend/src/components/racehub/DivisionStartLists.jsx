// Race Hub Fase 5 (#1835 / S6) — read-only "andre divisioner". Henter
// GET /api/races/distribution/browse (egen pulje som default), viser pulje-vælger +
// PCS-style startlister (bruttotrupper). Ingen mutationer rammer denne flade.
// scope="division" → låst til egen tier; "others" → alle tiers.
import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { authHeaders, supabase } from "../../lib/supabase"; // #4348: kanonisk kopi
import ContextBand from "./ContextBand.jsx";
import PoolPicker from "./PoolPicker.jsx";
import StartListColumn from "./StartListColumn.jsx";
import { reportLoadFailure } from "../../lib/actionTelemetry.js";
import { Spinner, EmptyState, ErrorState, FlagIcon, LockIcon, Button } from "../ui";

const API = import.meta.env.VITE_API_URL;

export default function DivisionStartLists({ scope, onScopeChange }) {
  const { t } = useTranslation("races");
  const [params, setParams] = useSearchParams();
  const poolParam = params.get("pool");
  const dayParam = Number.parseInt(params.get("day"), 10);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // #4165: samme tavse degradering som RaceHubBoard havde - begge fejl-grene
  // returnerede uden state, og `!data?.enabled → null` tegnede en tom flade.
  const [loadError, setLoadError] = useState(null); // { kind, status? } | null
  // #4165: vælgerne (scope + pulje + dag) må OVERLEVE en fejlet hentning. Lå de
  // kun i success-grenen, var et fejlet pulje- eller dagsskift en blindgyde: den
  // eneste knap tilbage, "Prøv igen", gentager samme pool/day og dermed samme
  // fejl, og et faneskift i hubben rydder hverken ?scope eller ?pool. Skallen
  // holdes derfor uden for `data` og ryddes aldrig ved fejl (heller ikke af
  // retry'ets setData(null)). { pools, ownPoolId, currentDay, timeline } | null
  const [navShell, setNavShell] = useState(null);
  // #2795 — brugerens eget hold, til --me-ring-markeringen på rytterrækkerne i
  // StartListColumn. Uafhængig af browse-hentningen ovenfor: et fejlende/
  // langsomt team-opslag må aldrig blokere selve startlisterne.
  const [myTeamId, setMyTeamId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data: myTeam } = await supabase.from("teams").select("id").eq("user_id", user.id).maybeSingle();
      if (!cancelled) setMyTeamId(myTeam?.id ?? null);
    })();
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async (pool, day) => {
    const headers = await authHeaders();
    if (!headers) {
      setLoadError({ kind: "auth" });
      reportLoadFailure("racehub_browse", { kind: "auth" });
      setLoading(false);
      return;
    }
    const qs = new URLSearchParams();
    if (pool != null) qs.set("pool", pool);
    if (Number.isFinite(day)) qs.set("day", String(day));
    // Path som egen literal (query konkateneres separat) — holder endpointet matchbar
    // for feature-liveness-auditens frontend-scan.
    const base = `${API}/api/races/distribution/browse`;
    try {
      const res = await fetch(qs.toString() ? `${base}?${qs}` : base, { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setLoadError({ kind: "http", status: res.status });
        reportLoadFailure("racehub_browse", { kind: "http", status: res.status, reason: body?.error });
        return;
      }
      // #4165: egen gren for parsningen - ellers tagges en malformet 200-krop
      // som "network" og peger triagen mod spillerens forbindelse.
      let json;
      try {
        json = await res.json();
      } catch (cause) {
        setLoadError({ kind: "parse", status: res.status });
        reportLoadFailure("racehub_browse", { kind: "parse", status: res.status, cause });
        return;
      }
      setData(json);
      setNavShell({
        pools: json.pools || [],
        ownPoolId: json.ownPoolId ?? null,
        currentDay: json.currentDay ?? null,
        timeline: json.timeline ?? null,
      });
      setLoadError(null);
    } catch (cause) {
      setLoadError({ kind: "network" });
      reportLoadFailure("racehub_browse", { kind: "network", cause });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(poolParam, Number.isFinite(dayParam) ? dayParam : undefined); }, [load, poolParam, dayParam]);

  const retryLoad = () => {
    setLoading(true);
    setLoadError(null);
    // #4165: spinner-gaten nedenfor er `loading && !data`, så et retry med gamle
    // data i state ville springe BÅDE spinneren og fejl-grenen over og tegne den
    // FORRIGE puljes startlister under den nye markering - præcis den løgn
    // kommentaren ved fejl-grenen siger den undgår. Ryd dem, så retry'et viser
    // spinneren indtil det nye svar lander.
    setData(null);
    load(poolParam, Number.isFinite(dayParam) ? dayParam : undefined);
  };

  const setDay = (d) => { params.set("day", String(d)); setParams(params, { replace: true }); };
  const setPool = (id) => { params.set("pool", String(id)); params.delete("day"); setParams(params, { replace: true }); };

  if (loading && !data) return <div className="flex justify-center py-10"><Spinner size={20} /></div>;
  // #4165: fejl FØR flag-grenen - ellers tegnes en fejlet hentning som "slukket".
  // Vises også når der ligger gamle data: en fejlet pulje-/dagskift ville ellers
  // efterlade den FORRIGE puljes startlister under den nye markering, hvilket er
  // en løgn om hvad manageren kigger på.
  if (loadError) {
    // #4165: scope- og pulje-vælgerne bliver stående. Uden dem var fejl-fladen en
    // blindgyde - kun "Prøv igen", som gentager samme pulje og samme dag. Puljen
    // der markeres er den manageren BAD om (fra ?pool), ikke den forrige der
    // lykkedes: markeringen skal matche URL'en, mens fejlbeskeden forklarer at
    // dens indhold ikke kunne hentes.
    const shellPools = navShell?.pools || [];
    const requestedPool =
      (poolParam != null ? shellPools.find((p) => String(p.id) === String(poolParam)) : null)
      ?? shellPools.find((p) => p.id === navShell?.ownPoolId)
      ?? null;
    const shellOwnTier = shellPools.find((p) => p.id === navShell?.ownPoolId)?.tier ?? null;
    const navDay = Number.isFinite(dayParam) ? dayParam : (navShell?.currentDay ?? 1);
    return (
      <div>
        <ContextBand
          scope={scope}
          day={navDay}
          currentDay={navShell?.currentDay ?? null}
          timeline={navShell?.timeline ?? null}
          onScopeChange={onScopeChange}
          onDayChange={setDay}
        />
        <PoolPicker
          pools={shellPools}
          selected={requestedPool}
          ownPoolId={navShell?.ownPoolId ?? null}
          lockTier={scope === "division" ? shellOwnTier : null}
          onSelect={setPool}
        />
        <div role="alert" className="mx-auto max-w-xl py-6">
          <ErrorState
            title={t("browse.error.title")}
            description={loadError.kind === "auth" ? t("browse.error.session") : t("browse.error.body")}
            action={<Button variant="secondary" size="sm" onClick={retryLoad}>{t("browse.error.retry")}</Button>}
          />
        </div>
      </div>
    );
  }
  if (!data?.enabled) return null;

  const day = Number.isFinite(dayParam) ? dayParam : (data.focusDay ?? data.currentDay);
  const columns = data.columns || [];
  const ownTier = data.pools?.find((p) => p.id === data.ownPoolId)?.tier ?? null;
  const lockTier = scope === "division" ? ownTier : null;
  const poolName = data.pool ? (data.pool.label || t("browse.poolN", { n: data.pool.pool_index + 1 })) : null;

  return (
    <div data-testid="race-hub-browse">
      <ContextBand scope={scope} day={day} currentDay={data.currentDay} timeline={data.timeline} onScopeChange={onScopeChange} onDayChange={setDay} />
      <PoolPicker pools={data.pools || []} selected={data.pool} ownPoolId={data.ownPoolId} lockTier={lockTier} onSelect={setPool} />
      <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
        <h2 className="text-base font-bold text-cz-1">
          {data.pool ? t("browse.heading", { division: t("browse.division", { n: data.pool.tier }), pool: poolName }) : t("browse.headingGeneric")}
        </h2>
        <span className="inline-flex items-center gap-1.5 text-2xs text-cz-3 border border-cz-border rounded-full px-2.5 py-1">
          <LockIcon size={11} aria-hidden="true" /> {t("browse.readonly")}
        </span>
      </div>
      <p className="text-2xs text-cz-3 mb-3">{t("browse.horizonNote", { count: data.horizonDays })}</p>
      {columns.length === 0 ? (
        <EmptyState icon={<FlagIcon size={24} />} title={t("browse.empty")} />
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {columns.map((c) => <StartListColumn key={c.id} column={c} myTeamId={myTeamId} />)}
        </div>
      )}
    </div>
  );
}
