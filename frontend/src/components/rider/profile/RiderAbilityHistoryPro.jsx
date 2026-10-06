// RiderAbilityHistoryPro — Pro-lag OVENPÅ Udvikling-fanen (#4649, Pro v1.1 del B).
//
// Gråzone-dom (spec §6, ejer-besluttet 2026-06-26): "Pro-analytics afslører
// ALDRIG eksklusive fakta — kun rigere grafer/historik af data der allerede
// findes råt for gratis-spillere." Alle 15 evne-værdier vises allerede råt
// (nu-tilstand) på enhver scouting-/holdside for alle spillere — dette lag
// giver deres HISTORIK på tværs af sæsoner, ikke nye tal. Gratis spillere ser
// et kort med en Pro-note + knap til /pro; den eksisterende gratis Udvikling-
// fane (RiderDevelopmentTab, rating pr. type) står UÆNDRET over/under dette.
//
// BEVIDST INGEN rytter-specifikt "loft" pr. evne — developmentReport.js's
// egen kommentar forklarer hvorfor (ability_caps er invertérbar til det
// server-skjulte potentiale, #1162). Den stiplede linje her er den FASTE
// spilbrede skala-grænse (99, samme for alle), ikke et rytter-specifikt tal.
//
// Sparkline-opskrift (ejer-retning 2/9, TASTE.md P2 fork 5 valg A "monokrom
// streg"): 2px streg i --text-1, flad --bg-subtle-fyld under kurven,
// slutpunkt markeret, akse-labels text-3xs. Kurven skifter ALDRIG farve efter
// retning — deltaet ved siden af værdien bærer grøn/rød.
//
// #6286:
// - En evne der mangler i en sæson er et HUL i kurven (aldrig 0), og deltaet
//   regnes kun mellem rigtige værdier (lib/proAbilityHistory.js).
// - Sæsonaksen har labels (S1, S2 ...) under hver kategori.
// - Backend lægger rytterens nuværende evner ind som sidste punkt (live), så
//   kurven slutter i det tal profilen viser; en rytter uden historik får ét punkt.
// - Mens hold/abonnement indlæses vises intet (aldrig reklamen); fejl giver
//   ErrorState med "Try again"; skabelonens Section/typografi i stedet for
//   hårdkodede px-værdier.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { authHeaders } from "../../../lib/supabase.js";
import { apiFetch } from "../../../lib/apiFetch.ts"; // #5242: Retry-After-respekt + centraliseret 401-vej
import { useSubscription } from "../../../lib/useSubscription.js";
import { ABILITY_CATEGORIES, ABILITY_SHORT } from "../../../lib/abilities.js";
import {
  abilitySeries, abilityDelta, latestValue, seriesSegments, seasonAxisLabels, axisFraction,
} from "../../../lib/proAbilityHistory.js";
import { SkeletonLines } from "../../ui/Skeleton.jsx";
import { Button, Section, SectionHeader, EmptyState, ErrorState, ChartLineIcon } from "../../ui";

const API = import.meta.env.VITE_API_URL;
const VB = { w: 120, h: 32, x0: 2, x1: 118, y0: 3, y1: 27 };

const xAtIndex = (i, n) => VB.x0 + axisFraction(i, n) * (VB.x1 - VB.x0);

function Sparkline({ points, ceiling }) {
  const segments = seriesSegments(points);
  if (segments.length === 0) return <div className="h-8" aria-hidden="true" />;
  const n = points.length;
  const vals = segments.flat().map((p) => p.v);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(ceiling, ...vals);
  const span = Math.max(1, hi - lo);
  const yAt = (v) => VB.y1 - ((v - lo) / span) * (VB.y1 - VB.y0);
  const ceilY = yAt(ceiling);
  const lastSeg = segments[segments.length - 1];
  const last = lastSeg[lastSeg.length - 1];
  return (
    <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="block w-full h-8" aria-hidden="true">
      <line x1={VB.x0} y1={ceilY.toFixed(1)} x2={VB.x1} y2={ceilY.toFixed(1)}
        stroke="var(--border)" strokeWidth="1" strokeDasharray="2 2" opacity="0.8" />
      {segments.map((seg) => {
        const line = seg.map((p) => `${xAtIndex(p.i, n).toFixed(1)},${yAt(p.v).toFixed(1)}`).join(" ");
        const xFirst = xAtIndex(seg[0].i, n).toFixed(1);
        const xLast = xAtIndex(seg[seg.length - 1].i, n).toFixed(1);
        return seg.length > 1 ? (
          <g key={seg[0].i}>
            <polygon points={`${xFirst},${VB.y1} ${line} ${xLast},${VB.y1}`} fill="var(--bg-subtle)" />
            <polyline points={line} fill="none" stroke="var(--text-1)" strokeWidth="2" />
          </g>
        ) : (
          seg[0] !== last && (
            <circle key={seg[0].i} cx={xFirst} cy={yAt(seg[0].v).toFixed(1)} r="1.6" fill="var(--text-1)" />
          )
        );
      })}
      <circle cx={xAtIndex(last.i, n).toFixed(1)} cy={yAt(last.v).toFixed(1)} r="2.3" fill="var(--text-1)" />
    </svg>
  );
}

function AbilityRow({ abilityKey, points, ceiling }) {
  const last = latestValue(points);
  const delta = abilityDelta(points);
  return (
    <div className="flex items-center gap-3 py-2 border-t border-cz-border first:border-t-0">
      <div className="w-10 shrink-0 font-data text-2xs font-semibold uppercase text-cz-2">
        {ABILITY_SHORT[abilityKey]}
      </div>
      <div className="flex-1 min-w-0">
        <Sparkline points={points} ceiling={ceiling} />
      </div>
      <div className="w-9 shrink-0 text-right font-data text-xs font-bold tabular-nums text-cz-1">
        {last ?? "—"}
      </div>
      <div className={`w-11 shrink-0 text-right font-data text-3xs font-semibold tabular-nums ${
        delta > 0 ? "text-cz-success" : delta < 0 ? "text-cz-danger" : "text-cz-3"
      }`}>
        {delta == null ? "—" : delta > 0 ? `+${delta}` : delta}
      </div>
    </div>
  );
}

// Sæsonakse under en kategori: samme kolonner som AbilityRow, labels placeret
// på punkternes x-positioner i sparkline-kolonnen.
function SeasonAxis({ seasons, nowLabel }) {
  const n = seasons.length;
  const labels = seasonAxisLabels(seasons, { nowLabel });
  return (
    <div className="flex items-center gap-3 pt-1" aria-hidden="true">
      <div className="w-10 shrink-0" />
      <div className="relative flex-1 min-w-0 h-4">
        {labels.map(({ i, label }) => {
          const align = n <= 1 ? "-translate-x-1/2" : i === 0 ? "" : i === n - 1 ? "-translate-x-full" : "-translate-x-1/2";
          return (
            <span
              key={i}
              className={`absolute top-0 font-data text-3xs tabular-nums text-cz-3 whitespace-nowrap ${align}`}
              style={{ left: `${(xAtIndex(i, n) / VB.w) * 100}%` }}
            >
              {label}
            </span>
          );
        })}
      </div>
      <div className="w-9 shrink-0" />
      <div className="w-11 shrink-0" />
    </div>
  );
}

export default function RiderAbilityHistoryPro({ riderId, myTeamId }) {
  const { t } = useTranslation("pro");
  const { t: tRider } = useTranslation("rider");
  const navigate = useNavigate();
  const { isPro, isFounder, loading: subLoading, error: subError, reload: reloadSub } = useSubscription(myTeamId);
  const eligible = isPro || isFounder;
  const [state, setState] = useState({ status: "idle", seasons: [], ceiling: 99 });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!eligible || !riderId) return;
    let cancelled = false;
    setState((s) => ({ ...s, status: "loading" }));
    (async () => {
      try {
        const h = await authHeaders();
        if (!h) { if (!cancelled) setState({ status: "error", seasons: [], ceiling: 99 }); return; }
        const res = await apiFetch(`${API}/api/pro/rider-history/${riderId}`, { headers: h });
        // dækker også limited/unauthorized/networkError
        if (!res.ok) { if (!cancelled) setState({ status: "error", seasons: [], ceiling: 99 }); return; }
        const data = res.data ?? {};
        if (!cancelled) setState({ status: "ready", seasons: data.seasons ?? [], ceiling: data.abilityCeiling ?? 99 });
      } catch {
        if (!cancelled) setState({ status: "error", seasons: [], ceiling: 99 });
      }
    })();
    return () => { cancelled = true; };
  }, [eligible, riderId, attempt]);

  // Holdet er ikke kendt endnu, eller abonnementet indlæses: vis intet, aldrig reklamen.
  if (!myTeamId || subLoading) return null;

  const retryHistory = () => setAttempt((n) => n + 1);

  if (subError) {
    return (
      <ErrorState
        title={t("riderHistory.statusErrorTitle")}
        description={t("riderHistory.errorBody")}
        action={<Button size="sm" variant="secondary" onClick={reloadSub}>{t("riderHistory.retry")}</Button>}
      />
    );
  }

  if (!eligible) {
    return (
      <Section>
        <SectionHeader as="h3" title={t("riderHistory.title")} className="mb-2" />
        <p className="text-sm text-cz-2 mb-3">{t("riderHistory.note")}</p>
        <Button size="sm" variant="secondary" onClick={() => navigate("/pro")}>{t("riderHistory.cta")}</Button>
      </Section>
    );
  }

  if (state.status === "error") {
    return (
      <ErrorState
        title={t("riderHistory.errorTitle")}
        description={t("riderHistory.errorBody")}
        action={<Button size="sm" variant="secondary" onClick={retryHistory}>{t("riderHistory.retry")}</Button>}
      />
    );
  }

  if (state.status === "ready" && state.seasons.length === 0) {
    return (
      <EmptyState
        icon={<ChartLineIcon size={26} aria-hidden="true" />}
        title={t("riderHistory.emptyTitle")}
        description={t("riderHistory.empty")}
        action={<Button size="sm" variant="secondary" onClick={retryHistory}>{t("riderHistory.checkAgain")}</Button>}
      />
    );
  }

  return (
    <Section>
      <SectionHeader as="h3" title={t("riderHistory.title")} meta={t("riderHistory.ceilingLegend")} className="mb-1" />
      {state.status !== "ready" ? (
        <SkeletonLines lines={4} className="mt-3" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-5">
          {ABILITY_CATEGORIES.map((cat) => (
            <div key={cat.key}>
              <div className="font-data text-3xs font-bold uppercase tracking-[.08em] text-cz-3 mt-3 mb-0.5">
                {tRider(`stats.categories.${cat.key}`, cat.key)}
              </div>
              {cat.keys.map((key) => (
                <AbilityRow
                  key={key}
                  abilityKey={key}
                  ceiling={state.ceiling}
                  points={abilitySeries(state.seasons, key)}
                />
              ))}
              <SeasonAxis seasons={state.seasons} nowLabel={t("riderHistory.now")} />
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
