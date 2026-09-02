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

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { authHeaders } from "../../../lib/supabase.js";
import { useSubscription } from "../../../lib/useSubscription.js";
import { ABILITY_CATEGORIES, ABILITY_SHORT } from "../../../lib/abilities.js";
import { SkeletonLines } from "../../ui/Skeleton.jsx";
import { Button } from "../../ui";

const API = import.meta.env.VITE_API_URL;
const VB = { w: 120, h: 32, x0: 2, x1: 118, y0: 3, y1: 27 };

function Sparkline({ points, ceiling }) {
  if (points.length === 0) return null;
  const vals = points.map((p) => p.v);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(ceiling, ...vals);
  const span = Math.max(1, hi - lo);
  const xAt = (i) => (points.length === 1 ? (VB.x0 + VB.x1) / 2 : VB.x0 + (i / (points.length - 1)) * (VB.x1 - VB.x0));
  const yAt = (v) => VB.y1 - ((v - lo) / span) * (VB.y1 - VB.y0);
  const line = points.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.v).toFixed(1)}`).join(" ");
  const area = `${VB.x0},${VB.y1} ${line} ${VB.x1},${VB.y1}`;
  const last = points[points.length - 1];
  const ceilY = yAt(ceiling);
  return (
    <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="block w-full h-8" aria-hidden="true">
      <line x1={VB.x0} y1={ceilY.toFixed(1)} x2={VB.x1} y2={ceilY.toFixed(1)}
        stroke="var(--border)" strokeWidth="1" strokeDasharray="2 2" opacity="0.8" />
      <polygon points={area} fill="var(--bg-subtle)" />
      <polyline points={line} fill="none" stroke="var(--text-1)" strokeWidth="2" />
      <circle cx={xAt(points.length - 1).toFixed(1)} cy={yAt(last.v).toFixed(1)} r="2.3" fill="var(--text-1)" />
    </svg>
  );
}

function AbilityRow({ abilityKey, points, ceiling }) {
  const first = points[0]?.v ?? null;
  const last = points[points.length - 1]?.v ?? null;
  const delta = first != null && last != null ? last - first : null;
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

export default function RiderAbilityHistoryPro({ riderId, myTeamId }) {
  const { t } = useTranslation("pro");
  const { t: tRider } = useTranslation("rider");
  const navigate = useNavigate();
  const { isPro, isFounder, loading: subLoading } = useSubscription(myTeamId);
  const eligible = isPro || isFounder;
  const [state, setState] = useState({ status: "idle", seasons: [], ceiling: 99 });

  useEffect(() => {
    if (!eligible || !riderId) return;
    let cancelled = false;
    setState((s) => ({ ...s, status: "loading" }));
    (async () => {
      try {
        const h = await authHeaders();
        if (!h) { if (!cancelled) setState({ status: "error", seasons: [], ceiling: 99 }); return; }
        const res = await fetch(`${API}/api/pro/rider-history/${riderId}`, { headers: h });
        if (!res.ok) { if (!cancelled) setState({ status: "error", seasons: [], ceiling: 99 }); return; }
        const data = await res.json();
        if (!cancelled) setState({ status: "ready", seasons: data.seasons ?? [], ceiling: data.abilityCeiling ?? 99 });
      } catch {
        if (!cancelled) setState({ status: "error", seasons: [], ceiling: 99 });
      }
    })();
    return () => { cancelled = true; };
  }, [eligible, riderId]);

  if (subLoading) return null;

  if (!eligible) {
    return (
      <div className="bg-cz-card border border-cz-border border-l-2 border-l-cz-accent rounded-cz py-[15px] px-[17px]">
        <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mb-1.5">
          {t("riderHistory.title")}
        </h3>
        <p className="text-[12.5px] text-cz-2 leading-[1.55] mb-3">{t("riderHistory.note")}</p>
        <Button size="sm" variant="secondary" onClick={() => navigate("/pro")}>{t("riderHistory.cta")}</Button>
      </div>
    );
  }

  if (state.status === "idle" || state.status === "loading") {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-5">
        <SkeletonLines lines={4} />
      </div>
    );
  }

  if (state.status === "error" || state.seasons.length === 0) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
        <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mb-1.5">
          {t("riderHistory.title")}
        </h3>
        <p className="text-cz-3 text-xs">{t("riderHistory.empty")}</p>
      </div>
    );
  }

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1">
        <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0">
          {t("riderHistory.title")}
        </h3>
        <span className="text-3xs text-cz-3">{t("riderHistory.ceilingLegend")}</span>
      </div>
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
                points={state.seasons.map((s) => ({ season: s.season_number, v: s.abilities?.[key] ?? 0 }))}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
