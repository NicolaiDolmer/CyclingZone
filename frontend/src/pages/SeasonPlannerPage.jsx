// Season Planner (spec §3/§5) — dediker­et cockpit-side (/planner). Master-canvas
// (rytter-lanes m. form-kurver + trækbare peaks) + kontekst-skuffe (race/rytter) +
// mobilt stakket spor. Launch-gated: mens peak_planner_enabled er 'off' viser siden
// en tom-state (samme kill-switch-mønster som Scouting/Facilities).
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageLoader, EmptyState } from "../components/ui";
import { usePlanner } from "../lib/usePlanner";
import MasterCanvas from "../components/planner/MasterCanvas";
import MobileLanes from "../components/planner/MobileLanes";
import PlannerDrawer from "../components/planner/PlannerDrawer";

function LegendItem({ children }) {
  return <span className="flex items-center gap-1.5">{children}</span>;
}

export default function SeasonPlannerPage() {
  const { t } = useTranslation("planner");
  const planner = usePlanner();
  const { enabled, loading, riders, races, maxPerRider, today, leadupDays, busy } = planner;

  const [filter, setFilter] = useState("mine");
  const [selected, setSelected] = useState(null); // { mode: "race"|"rider", id }
  const [toast, setToast] = useState(null); // { kind: "error"|"ok", text }

  const months = t("months", { returnObjects: true });

  useEffect(() => {
    if (!toast) return undefined;
    const h = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(h);
  }, [toast]);

  const selectedRace = useMemo(() => (selected?.mode === "race" ? (races || []).find((r) => r.id === selected.id) : null), [selected, races]);
  const selectedRider = useMemo(() => (selected?.mode === "rider" ? (riders || []).find((r) => r.id === selected.id) : null), [selected, riders]);

  // Ryd valg hvis entiteten forsvinder efter en refresh.
  useEffect(() => {
    if (selected?.mode === "race" && !selectedRace) setSelected(null);
    if (selected?.mode === "rider" && !selectedRider) setSelected(null);
  }, [selected, selectedRace, selectedRider]);

  const errText = (code) => t(`error.${code}`, { max: maxPerRider, defaultValue: t("error.generic") });

  const runMutation = async (fn, okText) => {
    const res = await fn();
    if (!res.ok) setToast({ kind: "error", text: errText(res.error) });
    else if (okText) setToast({ kind: "ok", text: okText });
    return res;
  };

  const onCreatePeak = (riderId, raceId) => runMutation(() => planner.createPeak(riderId, raceId));
  const onRetarget = (planId, raceId) => runMutation(() => planner.retargetPeak(planId, raceId));
  const onRemovePeak = (planId) => runMutation(() => planner.deletePeak(planId));
  const onAccept = (planId, week, rider) => runMutation(
    () => planner.acceptTraining(planId, week),
    t("drawer.rider.accepted", { week: week === "build" ? t("drawer.rider.build") : t("drawer.rider.taper"), name: rider?.lastname || "" }),
  );

  if (loading) return <PageLoader />;
  if (!enabled) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-6">
        <EmptyState title={t("empty.title")} description={t("empty.description")} />
      </div>
    );
  }

  const totalPeaks = (riders || []).reduce((n, r) => n + (r.peaks?.length || 0), 0);
  const hasRiders = (riders || []).length > 0;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex justify-between items-end border-b-[1.5px] border-cz-1 pb-[10px] mb-4 gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[38px] leading-none">{t("page.title")}</h1>
          <p className="text-[12px] text-cz-2 mt-[2px]">{t("page.subtitle")}</p>
        </div>
        <div className="flex border border-cz-border rounded-cz overflow-hidden text-[11px] shrink-0">
          {["mine", "all"].map((f) => (
            <button
              key={f}
              className={`px-3 py-1.5 ${filter === f ? "bg-cz-sidebar text-cz-body" : "bg-transparent text-cz-2 hover:bg-cz-subtle"}`}
              onClick={() => setFilter(f)}
            >{t(`filter.${f}`)}</button>
          ))}
        </div>
      </div>

      {toast && (
        <div className={`mb-3 text-[12px] px-3 py-2 rounded-cz border ${toast.kind === "error" ? "border-cz-accent-t text-cz-accent-t" : "border-cz-border text-cz-1 bg-cz-subtle"}`} role="status">
          {toast.text}
        </div>
      )}

      {!hasRiders && <EmptyState title={t("empty.title")} description={t("empty.description")} />}

      {hasRiders && totalPeaks === 0 && (
        <div className="mb-4 bg-cz-subtle border border-cz-border rounded-cz p-4">
          <div className="font-display text-[22px] leading-none text-cz-1">{t("firstRun.title")}</div>
          <p className="text-[12.5px] text-cz-2 mt-1.5">{t("firstRun.body", { max: maxPerRider })}</p>
          <p className="text-[11.5px] text-cz-3 mt-1.5">{t("firstRun.cta")}</p>
        </div>
      )}

      {hasRiders && (
        <>
          {/* Desktop master-canvas */}
          <div className="hidden md:block bg-cz-card border border-cz-border rounded-cz overflow-hidden">
            <MasterCanvas
              riders={riders} races={races} today={today} leadupDays={leadupDays}
              filter={filter}
              selectedRaceId={selected?.mode === "race" ? selected.id : null}
              selectedRiderId={selected?.mode === "rider" ? selected.id : null}
              onSelectRace={(id) => setSelected({ mode: "race", id })}
              onSelectRider={(id) => setSelected({ mode: "rider", id })}
              onRetarget={onRetarget}
            />
          </div>

          {/* Mobil stakket spor */}
          <div className="md:hidden">
            <MobileLanes
              riders={riders} races={races} filter={filter} today={today}
              onSelectRace={(id) => setSelected({ mode: "race", id })}
              onSelectRider={(id) => setSelected({ mode: "rider", id })}
            />
          </div>

          {/* Legende */}
          <div className="hidden md:flex flex-wrap gap-x-4 gap-y-1.5 mt-2 text-[10.5px] text-cz-2">
            <LegendItem><svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" stroke="rgb(var(--accent-t))" strokeWidth="1.5" strokeDasharray="3 2" /></svg>{t("legend.potential")}</LegendItem>
            <LegendItem><svg width="22" height="10" aria-hidden="true"><rect x="0" y="1" width="22" height="8" fill="var(--text-1)" opacity="0.16" /><line x1="0" y1="1.5" x2="22" y2="1.5" stroke="var(--text-1)" strokeWidth="1.5" /></svg>{t("legend.realized")}</LegendItem>
            <LegendItem><svg width="18" height="12" aria-hidden="true"><rect x="2" y="1" width="14" height="10" fill="var(--text-1)" opacity="0.09" /></svg>{t("legend.block")}</LegendItem>
            <LegendItem><span className="w-2 h-2 rounded-full" style={{ background: "rgb(var(--accent))", border: "1px solid rgb(var(--accent-t))" }} />{t("legend.token")}</LegendItem>
            <LegendItem><i className="ti ti-grip-vertical text-[13px] text-cz-accent-t" aria-hidden="true" />{t("legend.drag")}</LegendItem>
          </div>

          {/* Kontekst-skuffe */}
          {(selectedRace || selectedRider) && (
            <div className="mt-4">
              <PlannerDrawer
                mode={selectedRace ? "race" : "rider"}
                race={selectedRace} rider={selectedRider}
                riders={riders} races={races} maxPerRider={maxPerRider} months={months} today={today}
                busy={busy}
                onClose={() => setSelected(null)}
                onCreatePeak={onCreatePeak}
                onRemovePeak={onRemovePeak}
                onAccept={onAccept}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
