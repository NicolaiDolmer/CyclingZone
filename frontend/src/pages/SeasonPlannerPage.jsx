// Season Planner (spec §3/§5) — dediker­et cockpit-side (/planner). Master-canvas
// (rytter-lanes m. form-kurver + trækbare peaks) + kontekst-skuffe (race/rytter) +
// mobilt stakket spor. Launch-gated: mens peak_planner_enabled er 'off' viser siden
// en tom-state (samme kill-switch-mønster som Scouting/Facilities).
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageLoader, EmptyState, ErrorState, Section, Button, StarIcon, GripVerticalIcon } from "../components/ui";
import { usePlanner } from "../lib/usePlanner";
import MasterCanvas from "../components/planner/MasterCanvas";
import MobileLanes from "../components/planner/MobileLanes";
import PlannerDrawer from "../components/planner/PlannerDrawer";
import PlannerRaceList from "../components/planner/PlannerRaceList";

function LegendItem({ children }) {
  return <span className="flex items-center gap-1.5">{children}</span>;
}

// #2849 bølge 6 — DEN ene editoriale sidehoved-recipe for denne side (ejer-
// godkendt undtagelse fra app-standard PageHeader, se PAGE_TEMPLATES.md-note).
// Renderes identisk i disabled/error/happy-path, så der kun findes ÉN
// font-display-fortolkning på siden (audit-fund: var 38/22/20px tre steder).
function PlannerPageHead({ t, right }) {
  return (
    <div className="flex justify-between items-end border-b-[1.5px] border-cz-1 pb-[10px] mb-4 gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-[38px] leading-none">{t("page.title")}</h1>
        <p className="mt-[2px] text-xs text-cz-2">{t("page.subtitle")}</p>
      </div>
      {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
    </div>
  );
}

export default function SeasonPlannerPage() {
  const { t } = useTranslation("planner");
  // #2518: sæson-vælger (S1/S2/...) — null = backend defaulter til aktiv sæson.
  const [seasonNumber, setSeasonNumber] = useState(null);
  const planner = usePlanner(seasonNumber);
  const { enabled, loading, error, season, availableSeasons, riders, races, maxPerRider, today, leadupDays, busy } = planner;

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
  // #2455: acceptér et assistent-forslag = samme createPeak-kald som en manuel
  // peak (forslaget har ingen egen DB-id); nulstil er et separat sæson-scoped write.
  const onAcceptSuggestion = (riderId, raceId) => runMutation(() => planner.acceptSuggestion(riderId, raceId));
  const onDismissSuggestion = (riderId) => runMutation(() => planner.dismissSuggestions(riderId), t("assistant.resetDone"));

  if (loading) return <PageLoader />;

  // #2849 bølge 6 — audit-fund "L/E/F ✓/✓/÷": board-hentningen havde ingen
  // fejl-gren (kun tavs "beholder tidligere state" i usePlanner). Kanonisk
  // ErrorState + secondary retry, samme mønster som CalendarPage.
  if (error) {
    return (
      <div className="mx-auto max-w-[1600px]">
        <PlannerPageHead t={t} />
        <ErrorState
          title={t("error.title")}
          description={t("error.description")}
          action={<Button size="sm" variant="secondary" onClick={() => planner.refresh()}>{t("error.retry")}</Button>}
        />
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="mx-auto max-w-[1600px]">
        <PlannerPageHead t={t} />
        <EmptyState title={t("empty.title")} description={t("empty.description")} />
      </div>
    );
  }

  const hasRiders = (riders || []).length > 0;
  // #2455: mens der findes MINDST ét uaccepteret assistent-forslag, erstatter
  // "assistenten har udkastet..."-banneret det gamle "planlæg din første
  // peak"-nudge — ellers ser manageren begge (modstridende) beskeder på én gang.
  const hasSuggestions = (riders || []).some((r) => (r.peaks || []).some((p) => p.isSuggestion));
  const totalRealPeaks = (riders || []).reduce((n, r) => n + (r.peaks || []).filter((p) => !p.isSuggestion).length, 0);
  // #2518: sæsonen findes (er oprettet), men kalenderen (#2449) er ikke genereret
  // endnu — vis en forklarende tom-state i stedet for det generiske "ingen
  // ryttere"-empty-state (holdet HAR ryttere, sæsonen mangler bare et program).
  const seasonNotReady = seasonNumber != null && !season;

  return (
    <div className="mx-auto max-w-[1600px]">
      <PlannerPageHead
        t={t}
        right={
          <>
            {/* #2518: sæson-vælger — kun vist når der findes mere end én oprettet
                sæson, så managere kan planlægge mod S2's program FØR den starter. */}
            {(availableSeasons || []).length > 1 && (
              <div className="flex border border-cz-border rounded-cz overflow-hidden text-2xs">
                {availableSeasons.map((s) => (
                  <button
                    key={s.id}
                    className={`px-3 py-1.5 ${(seasonNumber ?? season?.number) === s.number ? "bg-cz-sidebar text-cz-body" : "bg-transparent text-cz-2 hover:bg-cz-subtle"}`}
                    onClick={() => setSeasonNumber(s.number)}
                  >{t("seasonMenu.option", { number: s.number })}</button>
                ))}
              </div>
            )}
            <div className="flex border border-cz-border rounded-cz overflow-hidden text-2xs">
              {["mine", "all"].map((f) => (
                <button
                  key={f}
                  className={`px-3 py-1.5 ${filter === f ? "bg-cz-sidebar text-cz-body" : "bg-transparent text-cz-2 hover:bg-cz-subtle"}`}
                  onClick={() => setFilter(f)}
                >{t(`filter.${f}`)}</button>
              ))}
            </div>
          </>
        }
      />

      {toast && (
        <div className={`mb-3 text-xs px-3 py-2 rounded-cz border ${toast.kind === "error" ? "border-cz-accent-t text-cz-accent-t" : "border-cz-border text-cz-1 bg-cz-subtle"}`} role="status">
          {toast.text}
        </div>
      )}

      {seasonNotReady && (
        <EmptyState title={t("seasonNotReady.title", { number: seasonNumber })} description={t("seasonNotReady.description")} />
      )}

      {!seasonNotReady && !hasRiders && <EmptyState title={t("empty.title")} description={t("empty.description")} />}

      {/* #2455: assistenten har allerede udkastet form-programmerne — banneret
          gør forslagene OPDAGELIGE (issue-krav 3), i stedet for det gamle
          tomme-lærred-nudge (som kun vises hvis der reelt intet er, hverken
          ægte eller foreslået — fx ingen fremtidige egen-divisions-løb endnu). */}
      {hasRiders && hasSuggestions && (
        // #2849 bølge 6: border-color sat via inline style, ikke className —
        // Tailwind's kompilerede rækkefølge lader .border-cz-border (Card's
        // default) vinde over en tilføjet .border-cz-accent-t-klasse uanset
        // className-strengens rækkefølge (verificeret i dist-bundlen); inline
        // style er den eneste cascade-sikre override uden at røre Card selv.
        <Section borderClass="border-cz-accent-t" className="mb-[14px] bg-cz-subtle">
          <div className="flex items-start gap-2">
            <StarIcon size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-cz-accent-t" />
            <div>
              <p className="text-[15px] font-semibold text-cz-1">{t("assistant.bannerTitle")}</p>
              <p className="mt-1 text-[13px] text-cz-2">{t("assistant.bannerBody")}</p>
            </div>
          </div>
        </Section>
      )}

      {hasRiders && !hasSuggestions && totalRealPeaks === 0 && (
        <Section className="mb-[14px] bg-cz-subtle">
          <p className="text-[15px] font-semibold text-cz-1">{t("firstRun.title")}</p>
          <p className="mt-1 text-[13px] text-cz-2">{t("firstRun.body", { max: maxPerRider })}</p>
          <p className="mt-1 text-2xs text-cz-3">{t("firstRun.cta")}</p>
        </Section>
      )}

      {hasRiders && (
        <div className="flex flex-col gap-[14px]">
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
              onCreatePeak={onCreatePeak}
            />
          </div>

          {/* Mobil stakket spor */}
          <div className="md:hidden">
            <MobileLanes
              riders={riders} races={races} filter={filter} today={today}
              selectedRaceId={selected?.mode === "race" ? selected.id : null}
              selectedRiderId={selected?.mode === "rider" ? selected.id : null}
              onSelectRace={(id) => setSelected({ mode: "race", id })}
              onSelectRider={(id) => setSelected({ mode: "rider", id })}
            />
          </div>

          {/* Legende */}
          <div className="hidden md:flex flex-wrap gap-x-4 gap-y-1.5 text-3xs text-cz-2">
            <LegendItem><svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" stroke="rgb(var(--accent-t))" strokeWidth="1.5" strokeDasharray="3 2" /></svg>{t("legend.potential")}</LegendItem>
            <LegendItem><svg width="22" height="10" aria-hidden="true"><rect x="0" y="1" width="22" height="8" fill="var(--text-1)" opacity="0.16" /><line x1="0" y1="1.5" x2="22" y2="1.5" stroke="var(--text-1)" strokeWidth="1.5" /></svg>{t("legend.realized")}</LegendItem>
            <LegendItem><svg width="18" height="12" aria-hidden="true"><rect x="2" y="1" width="14" height="10" fill="var(--text-1)" opacity="0.09" /></svg>{t("legend.block")}</LegendItem>
            <LegendItem><span className="w-2 h-2 rounded-full" style={{ background: "rgb(var(--accent))", border: "1px solid rgb(var(--accent-t))" }} />{t("legend.token")}</LegendItem>
            <LegendItem><GripVerticalIcon size={13} className="text-cz-accent-t" aria-hidden="true" />{t("legend.drag")}</LegendItem>
          </div>

          {/* #2568: scannbar sæson-løbs-liste — den kanoniske "hvilke løb, hvornår"-
              flade (tidslinjen er for tæt til løbs-navne). Vist på begge viewports. */}
          <PlannerRaceList
            riders={riders} races={races} filter={filter} today={today}
            selectedRaceId={selected?.mode === "race" ? selected.id : null}
            onSelectRace={(id) => setSelected({ mode: "race", id })}
          />

          {/* Kontekst-skuffe */}
          {(selectedRace || selectedRider) && (
            <PlannerDrawer
              mode={selectedRace ? "race" : "rider"}
              race={selectedRace} rider={selectedRider}
              riders={riders} races={races} maxPerRider={maxPerRider} months={months} today={today}
              busy={busy}
              onClose={() => setSelected(null)}
              onCreatePeak={onCreatePeak}
              onRemovePeak={onRemovePeak}
              onAccept={onAccept}
              onAcceptSuggestion={onAcceptSuggestion}
              onDismissSuggestion={onDismissSuggestion}
            />
          )}
        </div>
      )}
    </div>
  );
}
