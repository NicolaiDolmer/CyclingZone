// Season Planner (spec §3/§5) — Formplan-fanen i Planlægnings-hubben (#3102
// etape 3; boede før på egen rute /planner, som redirecter til
// /planning?tab=form). Master-canvas (rytter-lanes m. form-kurver + trækbare
// peaks) + kontekst-skuffe (race/rytter) + mobilt stakket spor. Launch-gated:
// mens peak_planner_enabled er 'off' viser fanen en tom-state (samme
// kill-switch-mønster som Scouting/Facilities).
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { PageLoader, EmptyState, ErrorState, Section, Button, GripVerticalIcon, CalendarIcon, XIcon, Tabs, TabList, Tab, TabPanel } from "../components/ui";
import { usePlanner } from "../lib/usePlanner";
import { nextPlannableSeason, effectivePlannerFilter } from "../components/planner/plannerShared";
import { plannerStatusSummary, pendingSuggestionPairs, ridersWithSuggestions } from "../components/planner/plannerSquadModel";
import MasterCanvas from "../components/planner/MasterCanvas";
import MobileLanes from "../components/planner/MobileLanes";
import PlannerDrawer from "../components/planner/PlannerDrawer";
import PlannerSquad from "../components/planner/PlannerSquad";
import PlannerStatusLine from "../components/planner/PlannerStatusLine";
import PlannerAssistantCard from "../components/planner/PlannerAssistantCard";

// #3086: Squad er default — listen er indgangen, brættet er overblikket.
// #3102 etape 3: races-fanen er nedlagt (kontrakten) — den scannbare løbsliste
// var en tredje kopi af kalenderen, og hubbens Holdudtagelse-fane viser
// allerede sæsonens løb som board.
const PLANNER_TABS = ["squad", "season"];

function LegendItem({ children }) {
  return <span className="flex items-center gap-1.5">{children}</span>;
}

// #2883: tre testere rapporterede 25/7 at planneren var "låst til den aktive
// sæson" op mod S2-cutover 27/7. Sæson-vælgeren (#2518/#2556) understøtter reelt
// et vilkårligt sæsonnummer allerede — men den sad som to bare tal ("1"/"2") i et
// button-par visuelt identisk med "mine/alle"-filteret lige ved siden af, uden
// nogen forklarende tekst. Dette banner gør muligheden UMULIG at overse i stedet
// for at stole på at managere selv opdager/forstår sæson-vælgeren — den korteste
// vej fra "jeg kan ikke rigtigt få lov til det" (Discord-citat) til en synlig,
// ét-klik CTA. Session-scoped dismiss (ingen persistens — lav-frekvent nok).
function NextSeasonNudge({ t, nextSeason, onSwitch, onDismiss }) {
  return (
    <Section borderClass="border-cz-accent-t" className="mb-[14px] bg-cz-subtle">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <CalendarIcon size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-cz-accent-t" />
          <div>
            <p className="text-[15px] font-semibold text-cz-1">{t("nextSeasonBanner.title", { number: nextSeason.number })}</p>
            {/* #3018: den oprindelige body lovede "you can set peaks for it now",
                hvilket ikke er sandt for en sæson hvor divisionen først afgøres
                ved sæsonskiftet — netop det løfte fik thelamba til at åbne S2 og
                få den gamle divisions kalender. Vælg copy efter sæson-status. */}
            <p className="mt-1 text-[13px] text-cz-2">
              {t(nextSeason.status === "upcoming" ? "nextSeasonBanner.bodyUpcoming" : "nextSeasonBanner.body", { number: nextSeason.number })}
            </p>
            <button
              className="mt-2 text-3xs border border-cz-accent-t text-cz-accent-t rounded-cz px-2.5 py-1.5 hover:bg-cz-subtle"
              onClick={onSwitch}
            >{t("nextSeasonBanner.cta", { number: nextSeason.number })}</button>
          </div>
        </div>
        <button className="shrink-0 text-cz-2 hover:text-cz-1" aria-label={t("nextSeasonBanner.dismiss")} onClick={onDismiss}>
          <XIcon size={14} aria-hidden="true" />
        </button>
      </div>
    </Section>
  );
}

// #3018: holdets division for den valgte sæson er ikke afgjort endnu. thelamba
// 26/7: planlæggeren viste D3's kalender for S2 til et hold på vej op i D2 —
// fordi boardet markerede "mine løb" ud fra holdets NUVÆRENDE division uanset
// hvilken sæson man kiggede på. Målt mod prod samme dag: 140 af 156 managerhold
// lander i en anden pulje i S2, så den gamle division var forkert for ~90 %.
//
// Vi viser den sande tilstand frem for et gæt: divisionen afgøres ved
// sæsonskiftet (rangeringen kører på standings der stadig flytter sig), så
// planlæggeren siger det rent ud og viser hele kalenderen på tværs af divisioner
// i stedet for at udpege en forkert. Ingen dismiss-knap — det her er ikke en
// nudge man kan vælge fra, det er grunden til at brættet ser anderledes ud.
function DivisionPendingNotice({ t, seasonNumber }) {
  return (
    <Section borderClass="border-cz-accent-t" className="mb-[14px] bg-cz-subtle">
      <div className="flex items-start gap-2">
        <CalendarIcon size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-cz-accent-t" />
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-cz-1">{t("divisionPending.title", { number: seasonNumber })}</p>
          <p className="mt-1 text-[13px] text-cz-2">{t("divisionPending.body", { number: seasonNumber })}</p>
          <p className="mt-1 text-2xs text-cz-3">{t("divisionPending.hint", { number: seasonNumber })}</p>
        </div>
      </div>
    </Section>
  );
}

// #2849 bølge 6, ejer-feedback 25/7: containeren var flyttet til T2's 1600px-cap,
// fordi /planner står i Layouts WIDE_CONTENT_ROUTES. Men brættet er et SVG med fast
// viewBox (940 enheder), så det SKALERER med containeren i stedet for at vise mere:
// på en bred skærm voksede hver rytter-bane fra ~105px til ~149px, og man kunne se
// færre ryttere ad gangen, ikke flere. max-w-6xl er den bredde brættet er tegnet til.
// T2's cap er et loft, ikke et krav — en dataTABEL vinder på bredde, et fast-format
// bræt gør ikke.
export default function SeasonPlannerPage() {
  const { t } = useTranslation("planner");
  // #2518: sæson-vælger (S1/S2/...) — null = backend defaulter til aktiv sæson.
  const [seasonNumber, setSeasonNumber] = useState(null);
  const planner = usePlanner(seasonNumber);
  const { enabled, loading, error, season, availableSeasons, divisionPending, riders, races, maxPerRider, today, leadupDays, paybackDays, busy } = planner;

  // #3086: fanerne synkroniseres til URL'en (samme mønster som Finance/#986), så
  // et dybt link til fx Sæson lander rigtigt og en refresh ikke smider manageren
  // tilbage til Squad midt i en gennemgang. #3102 etape 3: param'en hedder
  // ?view= — ?tab= ejes af Planlægnings-hubben udenom (tab=form er denne flade).
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = PLANNER_TABS.includes(searchParams.get("view")) ? searchParams.get("view") : "squad";
  const setTab = (tab) =>
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("view", tab);
      return p;
    }, { replace: true });

  const [filter, setFilter] = useState("mine");
  // #3018: uden en afgjort division findes der ingen "mine løb" — tving hele
  // kalenderen frem i stedet for at lade default-filteret tegne et tomt bræt.
  const viewFilter = effectivePlannerFilter(filter, divisionPending);
  const [selected, setSelected] = useState(null); // { mode: "race"|"rider", id }
  const [toast, setToast] = useState(null); // { kind: "error"|"ok", text }
  // #2883 sæson-nudge: gemmer ID'et på den sæson der er afvist (ikke bare et bool),
  // så en SENERE sæson (fx S3, når den oprettes) stadig nudger selvom S2 er afvist.
  const [dismissedNudgeSeasonId, setDismissedNudgeSeasonId] = useState(null);

  const months = t("months", { returnObjects: true });

  useEffect(() => {
    if (!toast) return undefined;
    const h = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(h);
  }, [toast]);

  // #2883: den sæson der reelt er valgt lige nu (eksplicit klik ELLER backend-
  // defaultens aktive sæson, når intet er klikket endnu) — grundlaget for både
  // switcher-highlighten (uændret) og nudge-banneret (nyt).
  const viewingSeasonNumber = seasonNumber ?? season?.number ?? null;
  const nextSeason = useMemo(
    () => nextPlannableSeason(availableSeasons, viewingSeasonNumber),
    [availableSeasons, viewingSeasonNumber],
  );

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

  // #3086 "Accept all": ét bulk-kald frem for N enkelt-kald (limiteren tillader
  // 30 skriv/minut, en fuld trup kan have op mod 60 forslag). Serveren kan
  // springe enkelte par over (fx et løb der er blevet uskemalagt siden boardet
  // blev hentet) — så siger toasten hvad der rent faktisk landede i stedet for
  // at melde alt accepteret.
  const onAcceptAll = async () => {
    const pairs = pendingSuggestionPairs(riders);
    if (!pairs.length) return;
    const res = await planner.createPeaksBulk(pairs);
    if (!res.ok) { setToast({ kind: "error", text: errText(res.error) }); return; }
    const skipped = (res.skipped || []).length;
    setToast({
      kind: skipped ? "error" : "ok",
      text: skipped
        ? t("assistant.acceptedPartial", { created: res.created, skipped })
        : t("assistant.acceptedAll", { count: res.created }),
    });
  };

  if (loading) return <PageLoader />;

  // #2849 bølge 6 — audit-fund "L/E/F ✓/✓/÷": board-hentningen havde ingen
  // fejl-gren (kun tavs "beholder tidligere state" i usePlanner). Kanonisk
  // ErrorState + secondary retry, samme mønster som CalendarPage.
  // #4165: grenen skal blive liggende FØR `!enabled` nedenfor - ellers tegnes en
  // fejlet hentning igen som "feature ikke live endnu".
  if (error) {
    return (
      <div role="alert" className="mx-auto max-w-6xl">
        <ErrorState
          title={t("error.title")}
          description={error === "auth" ? t("error.session") : t("error.description")}
          action={<Button size="sm" variant="secondary" onClick={() => planner.refresh()}>{t("error.retry")}</Button>}
        />
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="mx-auto max-w-6xl">
        <EmptyState title={t("empty.title")} description={t("empty.description")} />
      </div>
    );
  }

  const hasRiders = (riders || []).length > 0;
  // #3086: assistent-forslagene er nu et HANDLINGSKORT ("Accept all"), ikke et
  // banner der kun beskriver. Det gamle firstRun-nudge er væk: med assistent-
  // først findes tilstanden "tomt bræt, ingen peaks" ikke, så nudget kunne aldrig
  // vises. Dets ene unikke spilregel (maks {max} peaks pr. rytter) er flyttet ind
  // i handlingskortet, ikke slettet.
  // #4212: en noPeak-anbefaling (#3088, intet targetRaceId) er ikke et forslag
  // "Accept all" kan udkaste — tæl den ikke med i handlingskortets antal.
  const suggestionCount = (riders || []).reduce((n, r) => n + (r.peaks || []).filter((p) => p.isSuggestion && p.targetRaceId).length, 0);
  const suggestionRiderCount = ridersWithSuggestions(riders);
  const statusSummary = plannerStatusSummary({ riders, today, leadupDays });
  // #2518: sæsonen findes (er oprettet), men kalenderen (#2449) er ikke genereret
  // endnu — vis en forklarende tom-state i stedet for det generiske "ingen
  // ryttere"-empty-state (holdet HAR ryttere, sæsonen mangler bare et program).
  const seasonNotReady = seasonNumber != null && !season;

  return (
    <div className="mx-auto max-w-6xl">
      {/* #3102 etape 3: kontrollerne boede i sidens eget editoriale sidehoved
          (PlannerPageHead); hubben ejer sidehovedet nu, så de står som en
          højrestillet kontrolrække — samme flytning som division-selecten i
          StandingsPage fik i #3104 etape C. */}
      <div className="mb-[14px] flex flex-wrap items-center justify-end gap-2">
        {/* #2518: sæson-vælger — kun vist når der findes mere end én oprettet
            sæson, så managere kan planlægge mod S2's program FØR den starter.
            #2883: eksplicit "Sæson"-label tilføjet — bare "1"/"2"-knapper ved
            siden af et VISUELT IDENTISK mine/alle-filter blev læst som ét
            filter-cluster, ikke som en sæson-switcher (tre testere rapporterede
            planneren som "låst" 25/7, selvom denne switcher allerede virkede). */}
        {(availableSeasons || []).length > 1 && (
          <div className="flex items-center gap-1.5">
            <span className="hidden sm:inline text-3xs text-cz-3 uppercase tracking-wide">{t("seasonMenu.label")}</span>
            <div className="flex border border-cz-border rounded-cz overflow-hidden text-2xs">
              {availableSeasons.map((s) => (
                <button
                  key={s.id}
                  className={`px-3 py-1.5 ${(seasonNumber ?? season?.number) === s.number ? "bg-cz-sidebar text-cz-body" : "bg-transparent text-cz-2 hover:bg-cz-subtle"}`}
                  onClick={() => setSeasonNumber(s.number)}
                >{t("seasonMenu.option", { number: s.number })}</button>
              ))}
            </div>
          </div>
        )}
        {/* #3018: mine/alle-filteret skjules når divisionen ikke er afgjort —
            "Mine løb" ville matche nul løb, og at tilbyde et valg der ikke
            findes er netop den slags flade testerne kaldte ubrugelig. */}
        {!divisionPending && (
          <div className="flex border border-cz-border rounded-cz overflow-hidden text-2xs">
            {["mine", "all"].map((f) => (
              <button
                key={f}
                className={`px-3 py-1.5 ${filter === f ? "bg-cz-sidebar text-cz-body" : "bg-transparent text-cz-2 hover:bg-cz-subtle"}`}
                onClick={() => setFilter(f)}
              >{t(`filter.${f}`)}</button>
            ))}
          </div>
        )}
      </div>

      {toast && (
        <div className={`mb-3 text-xs px-3 py-2 rounded-cz border ${toast.kind === "error" ? "border-cz-accent-t text-cz-accent-t" : "border-cz-border text-cz-1 bg-cz-subtle"}`} role="status">
          {toast.text}
        </div>
      )}

      {/* #3018: den ærlige tilstand når divisionen for den valgte sæson ikke er
          afgjort endnu. Vist FØR alt andet, så den aldrig kan læses som en
          fodnote til et bræt der ser ud til at være "din" kalender. */}
      {divisionPending && <DivisionPendingNotice t={t} seasonNumber={season?.number ?? seasonNumber} />}

      {/* #2883: proaktiv nudge mod en senere oprettet sæson (fx S2 op mod cutover)
          — vist UANSET pladsmangel/tom-state nedenfor, så beskeden aldrig kan
          overses af det generiske "ingen ryttere endnu"-empty-state. */}
      {nextSeason && nextSeason.id !== dismissedNudgeSeasonId && (
        <NextSeasonNudge
          t={t}
          nextSeason={nextSeason}
          onSwitch={() => { setSeasonNumber(nextSeason.number); setDismissedNudgeSeasonId(nextSeason.id); }}
          onDismiss={() => setDismissedNudgeSeasonId(nextSeason.id)}
        />
      )}

      {seasonNotReady && (
        <EmptyState title={t("seasonNotReady.title", { number: seasonNumber })} description={t("seasonNotReady.description")} />
      )}

      {!seasonNotReady && !hasRiders && <EmptyState title={t("empty.title")} description={t("empty.description")} />}

      {/* #3086: assistent-kortet står OVER fanerne sammen med status-linjen. Det
          er den ene handling der gør assistent-først reelt for en casual, og en
          knap gemt inde i en fane kan ikke udfylde den rolle. Forsvinder af sig
          selv når der ikke er flere uaccepterede forslag. */}
      {hasRiders && suggestionCount > 0 && (
        <PlannerAssistantCard
          suggestionCount={suggestionCount}
          riderCount={suggestionRiderCount}
          maxPerRider={maxPerRider}
          busy={busy}
          onAcceptAll={onAcceptAll}
        />
      )}

      {hasRiders && (
        <>
          {/* Status-linjen ligger UDEN FOR Tabs, så "N kræver handling" er synlig
              fra alle tre faner (ejer-krav 27/7). */}
          <PlannerStatusLine summary={statusSummary} />

          <Tabs value={activeTab} onChange={setTab}>
            <TabList label={t("page.title")} className="mb-[14px]">
              <Tab value="squad">{t("tabs.squad")}</Tab>
              <Tab value="season">{t("tabs.season")}</Tab>
            </TabList>

            {/* Squad — den nye arbejdsflade: listen ER input. */}
            <TabPanel value="squad">
              <PlannerSquad
                riders={riders} races={races} maxPerRider={maxPerRider} months={months}
                today={today} paybackDays={paybackDays} busy={busy} divisionPending={divisionPending}
                selectedRiderId={selected?.mode === "rider" ? selected.id : null}
                onCreatePeak={onCreatePeak}
                onRetarget={onRetarget}
                onRemovePeak={onRemovePeak}
                onSelectRider={(id) => setSelected({ mode: "rider", id })}
                onAcceptSuggestion={onAcceptSuggestion}
                onDismissSuggestion={onDismissSuggestion}
              />
            </TabPanel>

            {/* Season — brættet uændret, men med hele skærmen. Træk bevaret. */}
            <TabPanel value="season">
              {/* #3086: legenden er flyttet IND i bræt-kortet, og træk-instruktionen
                  op i kortets hoved. Den lå før som en løs stribe under kortet, hvor
                  den læste som en fodnote til noget andet. */}
              <div className="hidden overflow-hidden rounded-cz border border-cz-border bg-cz-card md:block">
                <div className="flex items-center justify-between gap-3 border-b border-cz-border px-4 py-2.5">
                  <span className="text-[13px] font-medium text-cz-1">{t("board.title")}</span>
                  <span className="flex items-center gap-1.5 text-3xs text-cz-2">
                    <GripVerticalIcon size={13} className="text-cz-accent-t" aria-hidden="true" />{t("legend.drag")}
                  </span>
                </div>
                <MasterCanvas
                  riders={riders} races={races} today={today} leadupDays={leadupDays}
                  filter={viewFilter}
                  selectedRaceId={selected?.mode === "race" ? selected.id : null}
                  selectedRiderId={selected?.mode === "rider" ? selected.id : null}
                  onSelectRace={(id) => setSelected({ mode: "race", id })}
                  onSelectRider={(id) => setSelected({ mode: "rider", id })}
                  onRetarget={onRetarget}
                  onCreatePeak={onCreatePeak}
                />
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-cz-border px-4 py-2.5 text-3xs text-cz-2">
                  <LegendItem><svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" stroke="rgb(var(--accent-t))" strokeWidth="1.5" strokeDasharray="3 2" /></svg>{t("legend.potential")}</LegendItem>
                  <LegendItem><svg width="22" height="10" aria-hidden="true"><rect x="0" y="1" width="22" height="8" fill="var(--text-1)" opacity="0.16" /><line x1="0" y1="1.5" x2="22" y2="1.5" stroke="var(--text-1)" strokeWidth="1.5" /></svg>{t("legend.realized")}</LegendItem>
                  <LegendItem><svg width="18" height="12" aria-hidden="true"><rect x="2" y="1" width="14" height="10" fill="var(--text-1)" opacity="0.09" /></svg>{t("legend.block")}</LegendItem>
                  <LegendItem><span className="w-2 h-2 rounded-full" style={{ background: "rgb(var(--accent))", border: "1px solid rgb(var(--accent-t))" }} />{t("legend.token")}</LegendItem>
                </div>
              </div>

              {/* Mobil stakket spor — uændret. */}
              <div className="md:hidden">
                <MobileLanes
                  riders={riders} races={races} filter={viewFilter} today={today}
                  selectedRaceId={selected?.mode === "race" ? selected.id : null}
                  selectedRiderId={selected?.mode === "rider" ? selected.id : null}
                  onSelectRace={(id) => setSelected({ mode: "race", id })}
                  onSelectRider={(id) => setSelected({ mode: "rider", id })}
                />
              </div>
            </TabPanel>

          </Tabs>

          {/* Kontekst-skuffe: ligger UNDER fanerne, så et valg truffet i Squad,
              Season eller Races åbner den samme skuffe det samme sted. */}
          {(selectedRace || selectedRider) && (
            <div className="mt-[14px]">
              <PlannerDrawer
                mode={selectedRace ? "race" : "rider"}
                race={selectedRace} rider={selectedRider}
                riders={riders} races={races} maxPerRider={maxPerRider} months={months} today={today}
                paybackDays={paybackDays}
                busy={busy} divisionPending={divisionPending}
                onClose={() => setSelected(null)}
                onCreatePeak={onCreatePeak}
                onRemovePeak={onRemovePeak}
                onAccept={onAccept}
                onAcceptSuggestion={onAcceptSuggestion}
                onDismissSuggestion={onDismissSuggestion}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
