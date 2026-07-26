// Season Planner (spec §3/§5) — dediker­et cockpit-side (/planner). Master-canvas
// (rytter-lanes m. form-kurver + trækbare peaks) + kontekst-skuffe (race/rytter) +
// mobilt stakket spor. Launch-gated: mens peak_planner_enabled er 'off' viser siden
// en tom-state (samme kill-switch-mønster som Scouting/Facilities).
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageLoader, EmptyState, ErrorState, Section, Button, StarIcon, GripVerticalIcon, CalendarIcon, XIcon } from "../components/ui";
import { usePlanner } from "../lib/usePlanner";
import { nextPlannableSeason, effectivePlannerFilter } from "../components/planner/plannerShared";
import MasterCanvas from "../components/planner/MasterCanvas";
import MobileLanes from "../components/planner/MobileLanes";
import PlannerDrawer from "../components/planner/PlannerDrawer";
import PlannerRaceList from "../components/planner/PlannerRaceList";

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
  const { enabled, loading, error, season, availableSeasons, divisionPending, riders, races, maxPerRider, today, leadupDays, busy } = planner;

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

  if (loading) return <PageLoader />;

  // #2849 bølge 6 — audit-fund "L/E/F ✓/✓/÷": board-hentningen havde ingen
  // fejl-gren (kun tavs "beholder tidligere state" i usePlanner). Kanonisk
  // ErrorState + secondary retry, samme mønster som CalendarPage.
  if (error) {
    return (
      <div className="mx-auto max-w-6xl">
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
      <div className="mx-auto max-w-6xl">
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
    <div className="mx-auto max-w-6xl">
      <PlannerPageHead
        t={t}
        right={
          <>
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
          </>
        }
      />

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

      {/* #3018: "planlæg din første peak"-nudget lover noget man ikke kan gøre
          endnu, når divisionen ikke er afgjort — DivisionPendingNotice ovenfor
          er den rigtige besked i den tilstand. */}
      {hasRiders && !hasSuggestions && !divisionPending && totalRealPeaks === 0 && (
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
              filter={viewFilter}
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
              riders={riders} races={races} filter={viewFilter} today={today}
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
            riders={riders} races={races} filter={viewFilter} today={today}
            selectedRaceId={selected?.mode === "race" ? selected.id : null}
            onSelectRace={(id) => setSelected({ mode: "race", id })}
          />

          {/* Kontekst-skuffe */}
          {(selectedRace || selectedRider) && (
            <PlannerDrawer
              mode={selectedRace ? "race" : "rider"}
              race={selectedRace} rider={selectedRider}
              riders={riders} races={races} maxPerRider={maxPerRider} months={months} today={today}
              busy={busy} divisionPending={divisionPending}
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
