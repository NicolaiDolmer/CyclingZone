// ScoutingCentralPage — Scouting-central (#2244 Fase 3 Slice C): spejder-kort,
// opgavekø (aktive målrettede opgaver + missioner), start-mission-form og
// shortlist-feed (afsluttede missioner). Gated bag scout_system_enabled
// (kill-switch, ikke beta-gate) — useScoutingCentral rapporterer `enabled`
// fra samme flag som /api/scouting/me.
//
// Rytternavne (target-rytter + mission-shortlists) hentes lazily via
// GET /api/riders/:id — /api/scouting/central returnerer kun rider_id-referencer
// (aldrig potentiale), så et separat opslag er nødvendigt for visningsnavn.
// Kendt kontrakt-hul (flagget i Slice C-rapporten): ingen batch-endpoint findes,
// så dette er én GET pr. unikt rytter-id, cached i denne sides levetid.
//
// TONE: al copy i public/locales/{en,da}/scouting.json er plain/factual v1
// (spec-beslutning: verdict-tone-session med ejer FØR ship er stadig åben,
// jf. spec §Åbne detaljer) — review pending, ingen påstået lore/tone endnu.
import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { EmptyState, PageLoader, Button, Select } from "../components/ui";
import { getSession } from "../lib/supabase";
import { useScoutingCentral } from "../lib/useScoutingCentral";
import { daysUntil, missionCriteriaLabel } from "../lib/scoutingCentralDisplay";
import { getCountryName } from "../lib/countryUtils";
import { ISO2_TO_IOC } from "../lib/countryCodes";

const API = import.meta.env.VITE_API_URL;
const COUNTRY_CODES = Object.keys(ISO2_TO_IOC);

function SectionCard({ children, className = "" }) {
  return (
    <div className={`bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px] ${className}`}>
      {children}
    </div>
  );
}

function Eyebrow({ children }) {
  return (
    <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-cz-accent-t">
      {children}
    </span>
  );
}

// Lazy rytternavn-opslag: ét batch-kald (POST /api/riders/names) for nye ids,
// cached for sidens levetid.
function useRiderNames(ids) {
  const [names, setNames] = useState({});
  const requestedRef = useRef(new Set());

  useEffect(() => {
    const toFetch = (ids ?? []).filter((id) => id && !requestedRef.current.has(id));
    if (toFetch.length === 0) return;
    toFetch.forEach((id) => requestedRef.current.add(id));
    (async () => {
      const { data } = await getSession();
      const token = data?.session?.access_token;
      if (!token) return;
      const fetched = Object.fromEntries(toFetch.map((id) => [id, null]));
      try {
        const res = await fetch(`${API}/api/riders/names`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ids: toFetch }),
        });
        if (res.ok) {
          const { riders } = await res.json();
          for (const r of riders ?? []) fetched[r.id] = r.name ?? null;
        }
      } catch {
        // navne forbliver null → UI viser fallback-label
      }
      setNames((prev) => ({ ...prev, ...fetched }));
    })();
  }, [ids]);

  return names;
}

function ScoutCard({ scout, capacity, t }) {
  const isDefault = scout?.isDefault !== false;
  return (
    <SectionCard>
      <Eyebrow>{t("scoutCard.eyebrow")}</Eyebrow>
      {isDefault ? (
        <>
          <h3 className="font-display text-[21px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mt-2">
            {t("scoutCard.defaultTitle")}
          </h3>
          <p className="text-cz-2 text-[12.5px] leading-[1.55] mt-2 mb-0 max-w-prose">
            {t("scoutCard.defaultBody", { overall: scout?.overall ?? 40 })}
          </p>
        </>
      ) : (
        <>
          <h3 className="font-display text-[21px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mt-2">
            {scout.name}
          </h3>
          <p className="text-cz-2 text-[12.5px] mt-1 mb-0">
            {t("scoutCard.ratingLabel")}: <span className="font-mono text-cz-1">{scout.overall}</span>
          </p>
        </>
      )}
      <p className="text-cz-3 text-[11px] mt-3 pt-2.5 border-t border-cz-border mb-0">
        {t("scoutCard.capacityLabel", { capacity })}
      </p>
    </SectionCard>
  );
}

function ActiveQueue({ active, riderNames, onCancel, cancellingId, t }) {
  if (active.length === 0) {
    return (
      <SectionCard>
        <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mb-2">
          {t("queue.title")}
        </h3>
        <p className="text-cz-3 text-[12.5px] m-0">{t("queue.empty")}</p>
      </SectionCard>
    );
  }
  return (
    <SectionCard>
      <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mb-3">
        {t("queue.title")}
      </h3>
      <ul className="list-none p-0 m-0 space-y-2.5">
        {active.map((a) => {
          const days = daysUntil(a.ready_on);
          const label = a.kind === "target"
            ? (riderNames[a.rider_id] ?? t("queue.loadingRider"))
            : missionCriteriaLabel(a.mission_criteria, {
                translateScope: (s) => t(`mission.scope.${s}`),
                translateCountry: (code) => getCountryName(code),
              });
          return (
            <li key={a.id} className="flex items-center justify-between gap-3 flex-wrap border-t border-cz-border pt-2.5 first:border-0 first:pt-0">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-cz-3">
                  {t(a.kind === "target" ? "queue.kindTarget" : "queue.kindMission")}
                </span>
                <p className="text-cz-1 text-[13px] m-0 mt-0.5">{label}</p>
                <p className="text-cz-2 text-[11.5px] m-0 mt-0.5">
                  {days > 0 ? t("queue.reportIn", { days }) : t("queue.reportToday")}
                </p>
              </div>
              <Button
                variant="ghost" size="sm"
                loading={cancellingId === a.id}
                onClick={() => onCancel(a.id)}
              >
                {t("queue.cancel")}
              </Button>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

function MissionForm({ onSubmit, busy, t }) {
  const [scope, setScope] = useState("u23");
  const [country, setCountry] = useState(COUNTRY_CODES[0] ?? "dk");
  const [result, setResult] = useState(null);

  const needsCountry = scope === "country" || scope === "nm";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setResult(null);
    const criteria = needsCountry ? { scope, value: country } : { scope };
    const r = await onSubmit(criteria);
    setResult(r);
  };

  return (
    <SectionCard>
      <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mb-1">
        {t("mission.form.title")}
      </h3>
      <p className="text-cz-2 text-[11.5px] mt-1 mb-3">{t("mission.form.subtitle")}</p>
      <form onSubmit={handleSubmit} className="flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-cz-3 text-[10px] uppercase tracking-wider mb-1">{t("mission.form.scopeLabel")}</label>
          <Select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="u23">{t("mission.scope.u23")}</option>
            <option value="country">{t("mission.scope.country")}</option>
            <option value="nm">{t("mission.scope.nm")}</option>
          </Select>
        </div>
        {needsCountry && (
          <div>
            <label className="block text-cz-3 text-[10px] uppercase tracking-wider mb-1">{t("mission.form.countryLabel")}</label>
            <Select value={country} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRY_CODES.map((code) => (
                <option key={code} value={code}>{getCountryName(code)}</option>
              ))}
            </Select>
          </div>
        )}
        <Button type="submit" variant="primary" size="sm" loading={busy}>
          {t("mission.form.submit")}
        </Button>
      </form>
      <p className="text-cz-3 text-[10.5px] mt-2.5 mb-0">{t("mission.form.costNote")}</p>
      {result && !result.ok && (
        <p className="text-cz-warning text-[12px] mt-2 mb-0">
          {t(`error.${result.error}`, { defaultValue: t("error.failed") })}
        </p>
      )}
    </SectionCard>
  );
}

function ShortlistFeed({ completed, riderNames, t }) {
  const missions = completed.filter((c) => c.kind === "mission" && c.result?.shortlist?.length);
  if (missions.length === 0) {
    return (
      <SectionCard>
        <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mb-2">
          {t("shortlist.title")}
        </h3>
        <p className="text-cz-3 text-[12.5px] m-0">{t("shortlist.empty")}</p>
      </SectionCard>
    );
  }
  return (
    <SectionCard>
      <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mb-3">
        {t("shortlist.title")}
      </h3>
      <ul className="list-none p-0 m-0 space-y-3">
        {missions.slice(0, 10).map((m) => (
          <li key={m.id} className="border-t border-cz-border pt-2.5 first:border-0 first:pt-0">
            <p className="text-cz-3 text-[11px] font-mono uppercase tracking-[0.08em] m-0">
              {missionCriteriaLabel(m.mission_criteria, {
                translateScope: (s) => t(`mission.scope.${s}`),
                translateCountry: (code) => getCountryName(code),
              })}
            </p>
            <ul className="list-none p-0 m-0 mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
              {m.result.shortlist.map((riderId) => (
                <li key={riderId} className="text-cz-1 text-[13px]">
                  {riderNames[riderId] ?? t("queue.loadingRider")}
                  {riderId === m.result.top_rider_id && (
                    <span className="ms-1.5 text-[10px] font-mono uppercase tracking-[0.08em] text-cz-accent-t">
                      {t("shortlist.topFind")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

export default function ScoutingCentralPage() {
  const { t } = useTranslation("scouting");
  const navigate = useNavigate();
  const central = useScoutingCentral();
  const [cancellingId, setCancellingId] = useState(null);

  const targetRiderIds = central.active.filter((a) => a.kind === "target").map((a) => a.rider_id);
  const shortlistRiderIds = central.completed
    .filter((c) => c.kind === "mission")
    .flatMap((c) => c.result?.shortlist ?? []);
  const riderNames = useRiderNames([...new Set([...targetRiderIds, ...shortlistRiderIds])]);

  const handleCancel = useCallback(async (id) => {
    setCancellingId(id);
    await central.cancelAssignment(id);
    setCancellingId(null);
  }, [central]);

  if (central.loading) return <PageLoader />;
  if (!central.enabled) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <EmptyState title={t("empty.title")} description={t("empty.description")} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex justify-between items-end border-b-[1.5px] border-cz-1 pb-[10px] mb-4">
        <div>
          <h1 className="font-display text-[38px] leading-none">{t("page.title")}</h1>
          <p className="text-[12px] text-cz-2 mt-[2px]">{t("page.subtitle")}</p>
        </div>
        {central.scout?.id && (
          <button type="button" className="text-[12px] text-cz-2 hover:text-cz-1" onClick={() => navigate(`/staff/${central.scout.id}`)}>
            {t("scoutCard.viewProfile")} ›
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <ScoutCard scout={central.scout} capacity={central.capacity} t={t} />
        <ActiveQueue active={central.active} riderNames={riderNames} onCancel={handleCancel} cancellingId={cancellingId} t={t} />
        <MissionForm onSubmit={central.startMission} busy={central.busy} t={t} />
        <ShortlistFeed completed={central.completed} riderNames={riderNames} t={t} />
      </div>
    </div>
  );
}
