// RiderAbilityHistoryPro — Pro-lag OVENPÅ Udvikling-fanen (#4649, Pro v1.1 del B).
//
// Gråzone-dom (spec §6, ejer-besluttet 2026-06-26): "Pro-analytics afslører
// ALDRIG eksklusive fakta — kun rigere grafer/historik af data der allerede
// findes råt for gratis-spillere." Alle 15 evne-værdier vises allerede råt
// (nu-tilstand) på enhver scouting-/holdside for alle spillere — dette lag
// giver deres HISTORIK på tværs af sæsoner, ikke nye tal. Den eksisterende
// gratis Udvikling-fane (RiderDevelopmentTab, rating pr. type) står UÆNDRET
// over dette.
//
// #2806 (design-go 13/10 + ejer-beslutning 13/10):
// - Kræver AKTIV Pro (hasProFeatureAccess). Founder-status alene giver kun
//   mærket, ikke historikken. Backend håndhæver det samme (proRiderHistory.js).
// - Gratis spillere ser en kort opsalgsflade (ProUpsellSection) med en sekundær
//   knap til historik-fanen på /pro. Ingen guld, ingen modal.
// - Rækker og akse bor i components/pro/AbilityHistoryRows.tsx, så /pro-siden
//   tegner sit mærkede eksempel med de samme komponenter.
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
import { authHeaders } from "../../../lib/supabase.js";
import { apiFetch } from "../../../lib/apiFetch.ts"; // #5242: Retry-After-respekt + centraliseret 401-vej
import { useSubscription } from "../../../lib/useSubscription.js";
import { hasProFeatureAccess } from "../../../lib/pro/proAccess.ts";
import { ABILITY_CATEGORIES } from "../../../lib/abilities.js";
import { abilitySeries } from "../../../lib/proAbilityHistory.js";
import { AbilityRow, SeasonAxis } from "../../pro/AbilityHistoryRows.tsx";
import { ProUpsellSection } from "../../pro/ProUpsell.tsx";
import { SkeletonLines } from "../../ui/Skeleton.jsx";
import { Button, Section, SectionHeader, EmptyState, ErrorState, ChartLineIcon } from "../../ui";

const API = import.meta.env.VITE_API_URL;

export default function RiderAbilityHistoryPro({ riderId, myTeamId }) {
  const { t } = useTranslation("pro");
  const { t: tRider } = useTranslation("rider");
  const { isPro, isFounder, loading: subLoading, error: subError, reload: reloadSub } = useSubscription(myTeamId);
  const eligible = hasProFeatureAccess({ isPro, isFounder });
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
      <ProUpsellSection
        benefit="history"
        title={t("riderHistory.upsellTitle")}
        body={t("riderHistory.note")}
        cta={t("riderHistory.cta")}
      />
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
