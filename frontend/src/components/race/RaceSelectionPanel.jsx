// RaceSelectionPanel — managerens holdudtagelse til et kommende løb (#1307).
//
// Henter GET /api/races/:raceId/selection (ryttere + evt. eksisterende
// udtagelse) og gemmer via PUT. Renderer intet når race-engine-flaget er OFF
// eller løbet ikke længere er "scheduled" (backend sender enabled=false /
// race.status). Klient-validering spejler backendens snake_case-koder
// (raceSelectionLogic.js) så fejl vises FØR kaldet — samme fetch-mønster
// som useTraining (Bearer-token fra Supabase-session).

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { authHeaders } from "../../lib/supabase"; // #4348: kanonisk kopi
import { toggleRider, validateSelectionClient, partialSquadOutlook } from "../../lib/raceSelectionLogic.js";
import RiderTypeBadge from "../rider/RiderTypeBadge.jsx";
import FitBar from "../racehub/FitBar.jsx";
import HunterExplainer from "./HunterExplainer.jsx";
import RiderFitInsight from "./RiderFitInsight.jsx";
import { hunterBreakawayStrength } from "../../lib/roleHint.js";
// #3809: toggle mellem den nuværende kolonne-visning og rytternes evner —
// samme evne-config + farve-gradient som Mit Hold's "Evner"-tilstand (#2906),
// genbrugt her i stedet for en ny visning opfundet fra bunden.
import { ABILITY_STATS as STATS } from "../../lib/abilities.js";
import { statStyle } from "../../lib/statColor.js";
import {
  effectiveStageFit,
  bestFitRiderId,
  selectionComparator,
  selectionDefaultSortDir,
  SELECTION_SORT_KEYS,
  SELECTION_ABILITY_SORT_KEYS,
} from "../../lib/lineupInsight.js";
import SortTh from "../rider/RiderSortTh.jsx";
import { ArrowUpIcon, ArrowDownIcon, BlockedNote } from "../ui/index.js";
import RiderMiniProfileModal from "../rider/RiderMiniProfileModal.jsx";
import { useBlockedAction } from "../../lib/useBlockedAction.js";

const API = import.meta.env.VITE_API_URL;

// #2376: freeRoleIds er en additiv rolle (flere ryttere kan dele den) — round-trip er
// OBLIGATORISK (GET → state → PUT uændret, filtreret til ryttere stadig i truppen) så et
// gem fra dette panel ikke wiper free_role'r sat af boardet. Panelet har intet fuldt
// redigerings-UI for rollen (rollens editor er boardets rollekort); den vises kun som badge.
const EMPTY_SELECTION = { riderIds: [], captainId: null, sprintCaptainId: null, hunterId: null, freeRoleIds: [] };

export default function RaceSelectionPanel({
  raceId,
  selectedStageIndex = null,
  selectedStageBucket = null,
  selectedStageProfileType = null,
  selectedStageFinaleType = null,
}) {
  const { t } = useTranslation("races");
  // #3809: fulde evne-navne til kolonne-tooltips (samme mønster som TeamPage's
  // SquadTab tRider-brug til de forkortede kolonne-headers).
  const { t: tRider } = useTranslation("rider");
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(EMPTY_SELECTION);
  const [status, setStatus] = useState("idle"); // idle | saving | saved | error
  const [errorKey, setErrorKey] = useState(null);
  // #2637: rytter/løb-navne til den navngivne selection_rider_bound-besked (bug 3 —
  // fejlen skal sige HVEM/HVOR, ikke bare en opak kode). Sat af save() fra body.conflicts.
  const [errorDetail, setErrorDetail] = useState(null);
  const [touched, setTouched] = useState(false);
  // #1747: skjul-skadede-toggle. Default false (skadede vises dæmpet + deaktiveret)
  // så manageren stadig kan se hvem der er ude — toggler skjuler dem helt.
  const [hideInjured, setHideInjured] = useState(false);
  // #3809 (spillerforslag @zootne): knap der skifter mellem den nuværende
  // kolonne-visning ("current" — type/rutematch/form/træthed) og rytternes 15
  // evner ("abilities") — så manageren kan vurdere hvem der passer til etapen
  // uden at forlade siden. Samme to-tilstands-mønster som TeamPage's SquadTab
  // tableMode (#2906).
  const [viewMode, setViewMode] = useState("current");
  // #1951: klient-sortering af rytterlisten. Sortering er REN opt-in: default er
  // ingen aktiv nøgle, så listen står i backendens oprindelige rækkefølge indtil
  // manageren selv vælger en sortering (en auto-sort ved load ændrede den
  // dokumenterede default-rækkefølge ud over #1951's scope og brød
  // gem-udtagelses-smoke-testen). `sort: null` = uændret rækkefølge.
  const [sort, setSort] = useState({ sort: null, dir: "desc" });
  // #2180/#3310: status for Auto-select-assistenten (separat fra save()'s status,
  // så et fejlet assistent-kald ikke fejlagtigt viser den manuelle gem-fejlbesked).
  const [autoStatus, setAutoStatus] = useState("idle"); // idle | loading | error
  // #3520: rytteren hvis profil-popup er åben (klik på navn) — ren visning, rører
  // ALDRIG sel/udtagelsen. null = lukket. Checkboxen forbliver den ENESTE vælger.
  const [profileRider, setProfileRider] = useState(null);

  // #3012: useBlockedAction er et hook og SKAL kaldes ubetinget FØR panelets
  // tidlige returns (linje ~155/161 nedenfor) — ellers rules-of-hooks brydes på
  // renders hvor `data` endnu er null. Reason-beregningen guardes derfor selv
  // (data kan være null her), og den "rigtige" clientErrors genberegnes efter
  // returnsene nedenfor til selve visningen (touched-listen).
  const earlySaving = status === "saving";
  const earlyBusy = earlySaving || autoStatus === "loading";
  // `data?.size` og ikke bare `data`: flag-OFF-svaret (api.js: `{ enabled: false, race,
  // race_v3_enabled }`) har ingen `size`, og denne linje kører FOER den tidlige
  // return nedenfor. validateSelectionClient laeser `size.max` uden guard, saa et
  // bart `data` ville kaste TypeError og hvidskaerme siden i det oejeblik flaget slukkes.
  // Latent ogsaa foer #4295; lukket her fordi den er gratis at lukke.
  const earlyClientErrors = data?.size
    ? validateSelectionClient({ ...sel, size: data.size })
    : [];
  const earlySaveBlockReason = earlyClientErrors.length > 0
    ? t(`selection.errors.${earlyClientErrors[0]}`, { min: data?.size?.min, max: data?.size?.max })
    : null;
  const saveBlock = useBlockedAction(earlyBusy ? null : earlySaveBlockReason);

  // #3310: udtrukket til en genbrugelig loader — kaldes fra effekten ved raceId-skift
  // OG fra autoSelect() efter et vellykket assistent-kald, så panelet reflekterer den
  // nye trup uden en fuld sideindlæsning. En delt boolean-ref er IKKE nok her: hver
  // effect-kørsel ville nulstille den samme ref til false, så et forældet A-svar (race
  // A -> race B uden remount, samme route) kunne slippe forbi tjekket efter B's effect
  // allerede havde "un-cancelled" den. En monotont stigende generation løser det —
  // hvert kald indfanger sit eget generationsnummer FØR fetch'et, og sammenligner
  // EFTER: kun svaret for den seneste generation (effect-start ELLER unmount/skift)
  // får lov at skrive state. Dækker både effektens eget load og autoSelect()'s reload.
  const generationRef = useRef(0);
  const loadSelection = useCallback(async () => {
    // #3310 quality-fix: snapshottet SKAL tages FØR det første await (authHeaders()
    // kan reelt gå på netværk ved Supabase-token-refresh). Ellers kan et forældet
    // kald (race A) vågne EFTER raceId er skiftet til B og generationRef er steget,
    // læse det NYE tal som sit eget requestGeneration, og guarden matcher stadig —
    // race A's data overskriver race B's state. Se kommentaren ovenfor funktionen.
    const requestGeneration = generationRef.current;
    const headers = await authHeaders();
    if (!headers) return;
    try {
      const res = await fetch(`${API}/api/races/${raceId}/selection`, { headers });
      if (!res.ok) return;
      const body = await res.json();
      if (requestGeneration !== generationRef.current) return;
      setData(body);
      if (body.selection) {
        setSel({
          riderIds: body.selection.rider_ids ?? [],
          captainId: body.selection.captain_id ?? null,
          sprintCaptainId: body.selection.sprint_captain_id ?? null,
          hunterId: body.selection.hunter_id ?? null,
          freeRoleIds: body.selection.free_role_ids ?? [],
        });
      }
    } catch {
      /* netværk — panelet forbliver skjult */
    }
  }, [raceId]);

  useEffect(() => {
    generationRef.current += 1;
    setData(null);
    setStatus("idle");
    setErrorKey(null);
    setErrorDetail(null);
    setTouched(false);
    loadSelection();
    return () => { generationRef.current += 1; };
  }, [raceId, loadSelection]);

  // Flag OFF eller løbet ikke længere åbent → intet panel.
  if (!data?.enabled || data.race?.status !== "scheduled") return null;

  // #1954: løbet hører til en anden pulje/division end spillerens egen. Backend
  // afviser alligevel et gem (409 selection_wrong_pool), så vis en tydelig read-only
  // forklaring i stedet for et fuldt udtageligt panel der først fejler ved gem.
  if (data.eligible === false) {
    return (
      <section data-testid="race-selection-wrong-pool" className="bg-cz-card border border-cz-border rounded-cz px-4 py-3">
        <p className="text-sm font-semibold text-cz-1">{t("selection.wrongPool.title")}</p>
        <p className="text-xs text-cz-3 mt-0.5">{t("selection.wrongPool.note")}</p>
      </section>
    );
  }

  const { size, riders } = data;
  // #2265: ryttere bundet i et ANDET løb med overlappende in-game-dag-vindue (server-
  // beregnet). Bundne ryttere greyes + kan ikke tilføjes; er en bunden rytter allerede
  // valgt (fx efter en reschedule) vises en konflikt-markering, men han kan fjernes.
  const boundByRider = new Map((data.bound_riders || []).map((b) => [b.rider_id, b]));
  // #2376: free_role vises som badge (rollens editor er boardets rollekort, ikke dette
  // panel) — round-trip'et i save() sikrer at badge'n matcher hvad der reelt gemmes.
  const freeRoleSet = new Set(sel.freeRoleIds || []);
  // #4295: antal blokerer aldrig nedad. Klienten spejler nu backenden præcist (kun over
  // feltstørrelsen + kaptajn + rolle-overlap), så en delvis trup altid kan gemmes, også
  // ved en førstegangs-udtagelse, som var netop den tilstand "Ryd alt" efterlader.
  const clientErrors = validateSelectionClient({ ...sel, size });
  const selectedRiders = riders.filter((r) => sel.riderIds.includes(r.id));
  // S4: best-fit-nudge — den valgte rytter med højest rute-match til den valgte etape.
  const bestId = bestFitRiderId(riders, sel.riderIds, selectedStageIndex);
  // #3115 Gap 1b: udbruds-styrken for DENNE etape (spejler HunterExplainer) — beregnet
  // én gang her og sendt ned i RiderFitInsight pr. rytter, så den ikke genberegnes 30x.
  const breakawayStrength = hunterBreakawayStrength(selectedStageProfileType, selectedStageFinaleType);
  const atMax = sel.riderIds.length >= size.max;
  // #2637: løbet er "live" (0 < stages_completed < stages, status forbliver 'scheduled'
  // hele afviklingen, #1825) — trup-TILFØJELSER er frosset, men fjernelse er altid
  // tilladt. Bruges til at gråne ikke-valgte ryttere, så manageren ikke oplever et
  // forvirrende "gemt, men afvist" for et forsøg på at tilføje en ny rytter midt i løbet.
  const raceLive = (data.race?.stages_completed ?? 0) > 0;
  const errParams = { min: size.min, max: size.max };
  // #4295: den IKKE-blokerende afløser for #1906's hårde krav om en fuld trup. Nudgen
  // skal bygge på ryttere der er frie til NETOP dette løb, ikke på `availableCount`,
  // som er hele den raske trup og aldrig trækker bundne ryttere fra. Det var præcis den
  // utætte antagelse #4175's escape-ventil hvilede på, så ventilen udløste aldrig for et
  // hold med ryttere nok på papiret men ingen ledige til dagens løb. Hinten er ren
  // visning: den går ALDRIG i clientErrors, så Gem-knappen forbliver aktiv.
  const selectedIdSet = new Set(sel.riderIds);
  const freeLeft = riders.filter((r) => !r.injured && !boundByRider.has(r.id) && !selectedIdSet.has(r.id)).length;
  // Vises først når manageren har udtaget mindst én rytter: på et urørt panel er
  // "7 pladser står åbne" bare en gentagelse af undertekstens "udtag op til {max}".
  // `raceLive`: er løbet allerede i gang, top-fylder assistenten IKKE. raceEntryGenerator
  // fryser ethvert løb med stages_completed > 0 (#1825) og springer det over for alle hold.
  // Uden guarden ville hinten love et auto-fyld samtidig med at raceLiveNote lige ovenfor
  // siger at ingen nye ryttere kan tilføjes. To modstridende sætninger, og hinten er den falske.
  //
  // #4295: gulvet (6) gør at der nu er TO ting at sige om en delvis trup, og hvilken der
  // er sand afhænger af holdets frie ryttere. Reglen ligger ét sted (partialSquadOutlook),
  // så panelet og dagsboardets kolonne aldrig kan sige to forskellige ting om samme løb.
  // Linjen er ren visning: den går ALDRIG i clientErrors, så Gem-knappen forbliver aktiv.
  const outlook = partialSquadOutlook({
    selected: sel.riderIds.length, free: freeLeft, fieldMax: size.max, raceLive,
  });
  // #4295 opfølgning: en 0-valgt trup er IKKE det samme udsagn som en delvis trup — se
  // partialSquadOutlook. `emptySelection` vælger de to dedikerede sætninger i stedet for
  // "N pladser åbne", som ville være tomt/misvisende når intet er valgt endnu.
  const partialHint = outlook
    ? t(`selection.${outlook.kind === "willNotStart"
      ? (outlook.emptySelection ? "willNotStartEmpty" : "willNotStart")
      : outlook.kind === "assistantFills"
        ? (outlook.emptySelection ? "assistantFillsEmpty" : "partialHint")
        : "partialHintShort"}`, outlook)
    : null;
  const saving = status === "saving";
  // #3310 quality-fix: Auto-select kører en server-mutation (delete+insert) på samme
  // race_entries-rækker som et manuelt Gem. Uden dette gør en manuel toggle/klik MENS
  // auto-select's POST+reload stadig kører til et race mod loadSelection()'s
  // efterfølgende setSel() (sidste skriv vinder, ikke-deterministisk). Alle kontroller
  // der kan ændre/gemme udtagelsen låses derfor også under auto-select-loading, ikke
  // kun under saving.
  const busy = saving || autoStatus === "loading";
  // #1747: skjul skadede ryttere. En allerede-udtaget (skadet) rytter forbliver
  // synlig så manageren ikke mister overblikket over en ugyldig udtagelse.
  const injuredCount = riders.filter((r) => r.injured).length;
  const filteredRiders = hideInjured
    ? riders.filter((r) => !r.injured || sel.riderIds.includes(r.id))
    : riders;
  // #1951: sortering er opt-in. Ingen aktiv nøgle (sort.sort == null) → behold
  // backendens oprindelige rækkefølge. Først når manageren vælger en kolonne/
  // dropdown-nøgle sorteres en kopi (muter aldrig prop'en) via den delte comparator.
  const visibleRiders = sort.sort
    ? [...filteredRiders].sort(selectionComparator(sort.sort, sort.dir, selectedStageIndex))
    : filteredRiders;

  // #1951: header-klik (desktop) + dropdown (mobil) deler samme cyklus-konvention
  // som resten af rytter-tabellerne (klik aktiv nøgle = vend retning; klik ny
  // nøgle = nøglens default-retning). routeMatch-kolonnen viser "Suitability"
  // når ingen etape er valgt — sort-nøglen er den samme (effektivt fit falder
  // tilbage til løb-snittet).
  function handleSort(key) {
    setSort((s) => (s.sort === key
      ? { sort: key, dir: s.dir === "desc" ? "asc" : "desc" }
      : { sort: key, dir: selectionDefaultSortDir(key) }));
  }
  // Label for fit-kolonnen/sort-nøglen: rute-match når en etape er valgt, ellers
  // generel egnethed.
  const fitSortLabel = selectedStageIndex != null ? t("selection.routeMatch") : t("selection.suitability");

  function update(next) {
    setSel(next);
    if (!touched) setTouched(true);
    if (status !== "idle") setStatus("idle");
    if (errorKey) setErrorKey(null);
  }

  // <select> stringificerer values — slå tilbage til rytterens originale id-type.
  function riderIdFromValue(value) {
    const rider = riders.find((r) => String(r.id) === value);
    return rider ? rider.id : null;
  }

  function setRole(key, value) {
    update({ ...sel, [key]: riderIdFromValue(value) });
  }

  async function save() {
    const headers = await authHeaders();
    if (!headers) return;
    setStatus("saving");
    setErrorKey(null);
    setErrorDetail(null);
    // #3310 quality-fix: save() og autoSelect() deler statusvisningen nedenunder,
    // så et forældet resultat fra DEN ANDEN handler skal ryddes ved start af hver —
    // ellers kan et gammelt "Could not auto-select" stå tilbage ved siden af et
    // netop lykkedes manuelt Gem (og omvendt).
    if (autoStatus !== "idle") setAutoStatus("idle");
    // #2376: round-trip er OBLIGATORISK — panelet har intet UI til at ÆNDRE free_role,
    // men et gem herfra må ikke wipe free_role'r sat af boardet. Filtreret til ryttere
    // der stadig er i den (evt. lige nu redigerede) trup, så en fjernet rytter ikke
    // efterlader et forældet id i arrayet.
    const freeRoleIds = (sel.freeRoleIds || []).filter((id) => sel.riderIds.includes(id));
    try {
      const res = await fetch(`${API}/api/races/${raceId}/selection`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          rider_ids: sel.riderIds,
          captain_id: sel.captainId,
          sprint_captain_id: sel.sprintCaptainId,
          hunter_id: sel.hunterId,
          free_role_ids: freeRoleIds,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setErrorKey(body.error || "generic");
        // #2637 (bug 3): backend navngiver nu konflikten (rytter + løb) i stedet for en
        // opak kode — brug den førte konflikt til en klar, konkret besked.
        const conflict = Array.isArray(body.conflicts) ? body.conflicts[0] : null;
        setErrorDetail(conflict ? { rider: conflict.rider_name ?? "—", race: conflict.race_name ?? "—" } : null);
        return;
      }
      setStatus("saved");
      // Efter manuel gem er udtagelsen ikke længere assistentens.
      setData((d) => (d
        ? {
            ...d,
            selection: {
              rider_ids: sel.riderIds,
              captain_id: sel.captainId,
              sprint_captain_id: sel.sprintCaptainId,
              hunter_id: sel.hunterId,
              free_role_ids: freeRoleIds,
              is_auto_filled: false,
            },
          }
        : d));
    } catch {
      setStatus("error");
      setErrorKey("generic");
    }
  }

  // #2180/#3310: et-kliks assistent-udtagelse — samme motor som Race Hub's
  // dag-scopede "Auto-udfyld", skaleret til dette ene løb. Blokeres serverside (409)
  // hvis holdet allerede har en manuel entry; et rent auto-udfyldt felt overskrives.
  // Efter succes genindlæses panelet via loadSelection() så trup + roller + is_auto_filled
  // afspejler det assistenten netop gemte, uden en fuld sidegenindlæsning.
  async function autoSelect() {
    const headers = await authHeaders();
    if (!headers) return;
    setAutoStatus("loading");
    // #3310 quality-fix: ryd et evt. forældet manuelt gem-resultat (status/errorKey/
    // errorDetail) ved start af auto-select, af samme grund som ovenfor i save().
    if (status !== "idle") setStatus("idle");
    if (errorKey) setErrorKey(null);
    if (errorDetail) setErrorDetail(null);
    try {
      const res = await fetch(`${API}/api/races/${raceId}/selection/auto`, { method: "POST", headers });
      if (!res.ok) { setAutoStatus("error"); return; }
      await loadSelection();
      setAutoStatus("idle");
    } catch {
      setAutoStatus("error");
    }
  }

  return (
    <section data-testid="race-selection-panel" className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
      {/* Header: titel + tæller */}
      <div className="px-4 py-3 border-b border-cz-border flex flex-col sm:flex-row sm:items-center justify-between gap-1">
        <div>
          <h2 className="font-semibold text-cz-1 text-sm">{t("selection.title")}</h2>
          <p className="text-cz-3 text-xs">{t("selection.subtitle", errParams)}</p>
        </div>
        <span className="text-xs font-mono text-cz-2 whitespace-nowrap">
          {t("selection.count", { count: sel.riderIds.length, max: size.max })}
        </span>
      </div>

      {/* #3809: kolonne-tilstand — "Current" viser rutematch/form/træthed (dagens
          visning), "Abilities" viser de 15 evner (samme rå tal som Mit Hold's
          evne-tilstand). Segmenteret knap-bånd, samme mønster/styling som
          TeamPage's SquadTab tableMode-toggle (#2906). */}
      <div className="px-4 py-2 border-b border-cz-border flex justify-end">
        <div className="flex rounded-cz border border-cz-border overflow-hidden">
          {[
            { key: "current", label: t("selection.mode.current") },
            { key: "abilities", label: t("selection.mode.abilities") },
          ].map((m) => (
            <button key={m.key} type="button" onClick={() => setViewMode(m.key)} aria-pressed={viewMode === m.key}
              className={`px-3 py-1.5 text-xs font-medium transition-all
                ${viewMode === m.key
                  ? "bg-cz-accent/10 text-cz-accent-t"
                  : "bg-cz-card text-cz-2 hover:text-cz-1"}`}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* #1747: forklaring af egnethedstallet (det "uklare element") + skjul-skadede-toggle. */}
      <div className="px-4 py-2 border-b border-cz-border flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-cz-subtle">
        <p className="text-cz-3 text-2xs leading-snug">{t("selection.suitabilityHelp")}</p>
        {injuredCount > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-cz-2 whitespace-nowrap cursor-pointer self-start sm:self-auto">
            <input
              type="checkbox"
              checked={hideInjured}
              onChange={() => setHideInjured((v) => !v)}
              className="accent-cz-accent"
            />
            {t("selection.hideInjured")}
          </label>
        )}
      </div>

      {/* S4: delt "why this rider"-hint — kobler etapens terræn til dit stærkeste fit. */}
      {selectedStageBucket && bestId && (
        <p className="px-4 py-2 text-2xs leading-snug text-cz-2 bg-cz-subtle border-b border-cz-border">
          {t("selection.whyBest", {
            bucket: t(`strategy.buckets.${selectedStageBucket}`),
            name: riders.find((r) => r.id === bestId)?.name ?? "",
          })}
        </p>
      )}

      {data.selection?.is_auto_filled && (
        <p className="px-4 py-2 text-xs text-cz-2 bg-cz-subtle border-b border-cz-border">
          {t("selection.autoPicked")}
        </p>
      )}

      {/* #2637: løbet er live — forklar HVORFOR ikke-valgte ryttere er grånet, så
          fjernelse (fx af en skadet rytter) ikke fremstår som en generel lås. */}
      {raceLive && (
        <p className="px-4 py-2 text-xs text-cz-2 bg-cz-subtle border-b border-cz-border">
          {t("selection.raceLiveNote")}
        </p>
      )}

      {/* Rytterliste — responsivt. På mobil (<sm) en stablet liste: en 5-kolonne
          tabel kræver ~488px og tvinger en vandret scroll-container på 393px-
          viewporten. Under Playwrights Pixel 5 (isMobile) emulering skævvrider
          den overflow-container hit-testet på "Gem udtagelse"-knappen nedenunder,
          så klikket rammer en tabel-celle i stedet (#1834, frontend-smoke rød på
          CI). Stablede kort fjerner overflow'en helt + er bedre mobil-UX.
          Fra sm og op vises den klassiske tabel. */}
      {/* #1951: mobil-sortering — desktop sorterer via kolonne-headers, men på
          mobil er der ingen header-række. Denne kontrol eksponerer samme sort-
          nøgler og deler handleSort med tabellen (ingen ny sort-logik). */}
      <SelectionSortControl sort={sort} onSort={handleSort} fitLabel={fitSortLabel} t={t} viewMode={viewMode} tRider={tRider} />
      <ul className="sm:hidden divide-y divide-cz-border">
        {visibleRiders.map((rider) => {
          const checked = sel.riderIds.includes(rider.id);
          const bound = boundByRider.get(rider.id) ?? null;
          // #2265: en bunden, IKKE-valgt rytter kan ikke tilføjes; en bunden, VALGT rytter
          // beholder aktiv checkbox så konflikten kan løses ved at fjerne ham.
          // #2637: en skadet rytter må ALDRIG TILFØJES, men skal altid kunne FJERNES —
          // fjernelse er altid tilladt, kun tilføjelse valideres. Tidligere gjorde
          // `rider.injured` alene checkboxen disabled UANSET checked-state, så en
          // allerede-udtaget skadet rytter sad permanent fast i truppen (Discord-bug).
          const disabled = (rider.injured && !checked) || (bound && !checked) || (!checked && (atMax || raceLive)) || busy;
          const fitLabel = selectedStageIndex != null ? t("selection.routeMatch") : t("selection.suitability");
          return (
            <li key={rider.id} className={rider.injured || (bound && !checked) ? "opacity-60" : ""}>
              {/* #3520: checkboxen er den ENESTE vælger — labelen wrapper kun den, ikke
                  længere navnet (spillerforslag: navneklik skal åbne profil, ikke toggle). */}
              <div className="flex items-start gap-3 px-4 py-3">
                <label className={`flex items-center pt-0.5 shrink-0 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    aria-label={rider.name}
                    onChange={() => update(toggleRider(sel, rider.id, size.max))}
                    className="accent-cz-accent disabled:cursor-not-allowed"
                  />
                </label>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* #3520: navnet åbner rytterens profil-popup — påvirker IKKE sel. */}
                    <button
                      type="button"
                      onClick={() => setProfileRider(rider)}
                      aria-label={t("selection.riderProfile.viewProfile", { name: rider.name })}
                      className="text-cz-1 font-medium text-left hover:text-cz-accent-t hover:underline transition-colors"
                    >
                      {rider.name}
                    </button>
                    {rider.injured && (
                      <span className="text-3xs px-2 py-0.5 rounded-full bg-cz-danger/10 text-cz-danger border border-cz-danger/20">
                        {t("selection.injured")}
                      </span>
                    )}
                    {bound && (
                      <span className={`text-3xs px-2 py-0.5 rounded-full border ${checked
                        ? "bg-cz-danger/10 text-cz-danger border-cz-danger/20"
                        : "bg-cz-subtle text-cz-3 border-cz-border"}`}>
                        {t(checked ? "selection.boundConflict" : "selection.boundIn", { race: bound.bound_race_name ?? "" })}
                      </span>
                    )}
                    {checked && freeRoleSet.has(rider.id) && (
                      <span className="text-3xs px-2 py-0.5 rounded-full bg-cz-subtle text-cz-accent-t border border-cz-accent/30">
                        {t("selection.freeRole")}
                      </span>
                    )}
                    <RiderTypeBadge primaryType={rider.primaryType} secondaryType={rider.secondaryType} />
                  </div>
                  {/* #3809: mobil-listen viser enten dagens fit/form/træthed-linje,
                      eller (viewMode="abilities") et kompakt gitter med alle 15 evner. */}
                  {viewMode === "abilities" ? (
                    <div className="mt-1.5 grid grid-cols-3 gap-x-3 gap-y-1">
                      {STATS.map(({ key, label }) => (
                        <div key={key} className="flex items-center justify-between gap-1">
                          <span className="text-cz-3 uppercase text-3xs tracking-wide" title={tRider(`racePreview.derived.${key}`)}>{label}</span>
                          <span className="inline-block min-w-[22px] text-center text-2xs font-mono px-1 py-0.5 rounded"
                            style={statStyle(rider.abilities?.[key] || 0)}>
                            {rider.abilities?.[key] ?? "-"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-1.5 flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-cz-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-cz-3 uppercase text-3xs tracking-wide">{fitLabel}</span>
                        {rider.id === bestId && (
                          <span className="text-3xs uppercase tracking-wide text-cz-accent-t" title={t("selection.bestForStage")}>{t("selection.best")}</span>
                        )}
                        <FitBar score={effectiveStageFit(rider, selectedStageIndex)} />
                        <RiderFitInsight rider={rider} profileType={selectedStageProfileType} breakawayStrength={breakawayStrength} />
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="text-cz-3 uppercase text-3xs tracking-wide">{t("selection.form")}</span>
                        <span className="font-mono tabular-nums text-cz-2">{rider.form ?? "—"}</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="text-cz-3 uppercase text-3xs tracking-wide">{t("selection.fatigue")}</span>
                        <span className="font-mono tabular-nums text-cz-2">{rider.fatigue ?? "—"}</span>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="hidden sm:block overflow-x-auto">
        <table data-sortable className="w-full text-sm">
          <thead>
            {/* #1951: klikbare, sorterbare headers (delt SortTh + retnings-ikon). */}
            <tr className="border-b border-cz-border">
              <SortTh sortKey="name" sort={sort.sort} sortDir={sort.dir} onSort={handleSort}
                className="px-4 py-3 text-left font-medium text-xs uppercase">{t("selection.thRider")}</SortTh>
              <SortTh sortKey="primaryType" sort={sort.sort} sortDir={sort.dir} onSort={handleSort}
                className="px-4 py-3 text-left font-medium text-xs uppercase">{t("selection.type")}</SortTh>
              {/* #3809: "Abilities"-tilstanden erstatter rutematch/form/træthed med de
                  15 evne-kolonner (samme korte labels + tooltip-mønster som TeamPage's
                  SquadTab abilityColumns). #3898: kolonnerne er nu sorterbare — samme
                  SortTh + delte comparator som resten af panelet, evne-sort-værdien
                  hentes via selectionSortValue (lineupInsight.js), ikke en ny
                  sorterings-mekanisme. */}
              {viewMode === "abilities" ? (
                STATS.map(({ key, label }) => (
                  <SortTh key={key} sortKey={key} sort={sort.sort} sortDir={sort.dir} onSort={handleSort}
                    title={tRider(`racePreview.derived.${key}`)}
                    className="px-1.5 py-3 text-center font-medium text-3xs uppercase">
                    {label}
                  </SortTh>
                ))
              ) : (
                <>
                  <SortTh sortKey="routeMatch" sort={sort.sort} sortDir={sort.dir} onSort={handleSort}
                    className="px-4 py-3 text-right font-medium text-xs uppercase">{fitSortLabel}</SortTh>
                  <SortTh sortKey="form" sort={sort.sort} sortDir={sort.dir} onSort={handleSort}
                    className="px-4 py-3 text-right font-medium text-xs uppercase">{t("selection.form")}</SortTh>
                  <SortTh sortKey="fatigue" sort={sort.sort} sortDir={sort.dir} onSort={handleSort}
                    className="px-4 py-3 text-right font-medium text-xs uppercase">{t("selection.fatigue")}</SortTh>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {visibleRiders.map((rider) => {
              const checked = sel.riderIds.includes(rider.id);
              const bound = boundByRider.get(rider.id) ?? null;
              // #2637: se mobil-listen ovenfor — fjernelse af en allerede-udtaget skadet
              // rytter skal altid være muligt, kun tilføjelse af en NY skadet rytter blokeres.
              const disabled = (rider.injured && !checked) || (bound && !checked) || (!checked && (atMax || raceLive)) || busy;
              return (
                <tr key={rider.id} className={`border-b border-cz-border last:border-0 hover:bg-cz-subtle ${rider.injured || (bound && !checked) ? "opacity-60" : ""}`}>
                  <td className="px-4 py-2.5">
                    {/* #3520: checkboxen er den ENESTE vælger — labelen wrapper kun den. */}
                    <div className="flex items-center gap-2">
                      <label className={`flex items-center ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          aria-label={rider.name}
                          onChange={() => update(toggleRider(sel, rider.id, size.max))}
                          className="accent-cz-accent disabled:cursor-not-allowed"
                        />
                      </label>
                      {/* #3520: navnet åbner rytterens profil-popup — påvirker IKKE sel. */}
                      <button
                        type="button"
                        onClick={() => setProfileRider(rider)}
                        aria-label={t("selection.riderProfile.viewProfile", { name: rider.name })}
                        className="text-cz-1 font-medium text-left hover:text-cz-accent-t hover:underline transition-colors"
                      >
                        {rider.name}
                      </button>
                      {rider.injured && (
                        <span className="text-3xs px-2 py-0.5 rounded-full bg-cz-danger/10 text-cz-danger border border-cz-danger/20">
                          {t("selection.injured")}
                        </span>
                      )}
                      {bound && (
                        <span className={`text-3xs px-2 py-0.5 rounded-full border whitespace-nowrap ${checked
                          ? "bg-cz-danger/10 text-cz-danger border-cz-danger/20"
                          : "bg-cz-subtle text-cz-3 border-cz-border"}`}>
                          {t(checked ? "selection.boundConflict" : "selection.boundIn", { race: bound.bound_race_name ?? "" })}
                        </span>
                      )}
                      {checked && freeRoleSet.has(rider.id) && (
                        <span className="text-3xs px-2 py-0.5 rounded-full bg-cz-subtle text-cz-accent-t border border-cz-accent/30 whitespace-nowrap">
                          {t("selection.freeRole")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <RiderTypeBadge primaryType={rider.primaryType} secondaryType={rider.secondaryType} />
                  </td>
                  {viewMode === "abilities" ? (
                    STATS.map(({ key }) => (
                      <td key={key} className="px-1.5 py-2.5 text-center">
                        <span className="inline-block min-w-[24px] text-center text-xs font-mono px-1 py-0.5 rounded"
                          style={statStyle(rider.abilities?.[key] || 0)}>
                          {rider.abilities?.[key] ?? "-"}
                        </span>
                      </td>
                    ))
                  ) : (
                    <>
                      <td className="px-4 py-2.5 text-right">
                        <span className="inline-flex items-center gap-2 justify-end">
                          {rider.id === bestId && (
                            <span className="text-3xs uppercase tracking-wide text-cz-accent-t" title={t("selection.bestForStage")}>{t("selection.best")}</span>
                          )}
                          <FitBar score={effectiveStageFit(rider, selectedStageIndex)} />
                          <RiderFitInsight rider={rider} profileType={selectedStageProfileType} breakawayStrength={breakawayStrength} />
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-cz-2">{rider.form ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-cz-2">{rider.fatigue ?? "—"}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Roller + gem */}
      <div className="px-4 py-3 border-t border-cz-border space-y-3">
        <div className="flex flex-wrap gap-3">
          <RoleSelect
            label={t("selection.captain")}
            value={sel.captainId}
            riders={selectedRiders}
            emptyLabel="—"
            disabled={busy}
            onChange={(v) => setRole("captainId", v)}
          />
          <RoleSelect
            label={t("selection.sprintCaptain")}
            value={sel.sprintCaptainId}
            riders={selectedRiders}
            emptyLabel={t("selection.noRole")}
            disabled={busy}
            onChange={(v) => setRole("sprintCaptainId", v)}
          />
          <RoleSelect
            label={t("selection.hunter")}
            value={sel.hunterId}
            riders={selectedRiders}
            emptyLabel={t("selection.noRole")}
            disabled={busy}
            onChange={(v) => setRole("hunterId", v)}
          />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="space-y-0.5">
            {touched && clientErrors.map((code) => (
              <p key={code} className="text-xs text-cz-warning">
                {t(`selection.errors.${code}`, errParams)}
              </p>
            ))}
            {/* #4295: to grader af samme linje. Fylder assistenten pladserne, er det en
                neutral oplysning (text-cz-3). Stiller holdet slet ikke op, er det en
                konsekvens manageren skal se FØR han klikker Gem — text-cz-warning, samme
                sprog som "mangler ryttere"-chippen på brættet, ikke text-cz-danger: en
                delvis trup er stadig lovlig at gemme, det er ikke en fejl. */}
            {partialHint && (
              <p
                data-testid="selection-partial-hint"
                data-outlook={outlook.kind}
                className={`text-xs ${outlook.kind === "willNotStart" ? "text-cz-warning" : "text-cz-3"}`}
              >
                {partialHint}
              </p>
            )}
            {status === "error" && errorKey && (
              <p className="text-xs text-cz-danger">
                {/* #2637: en navngivet selection_rider_bound-fejl (rytter + løb) er langt
                    mere handlingsbar end den opake generiske besked. */}
                {errorKey === "selection_rider_bound" && errorDetail
                  ? t("selection.errors.selection_rider_bound_named", errorDetail)
                  : t([`selection.errors.${errorKey}`, "selection.errors.generic"], errParams)}
              </p>
            )}
            {status === "saved" && (
              <p className="text-xs text-cz-success">{t("selection.saved")}</p>
            )}
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            {autoStatus === "error" && (
              <span className="text-xs text-cz-danger">{t("selection.autoFillError")}</span>
            )}
            {/* #2180/#3310: sekundær stil — guld nr. 2 er ikke tilladt, Gem forbliver
                den primære handling. */}
            <button
              type="button"
              onClick={autoSelect}
              disabled={busy}
              className="px-4 py-2 rounded-lg border border-cz-border bg-transparent text-cz-1 text-sm font-medium hover:border-cz-3 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {t("selection.autoFill")}
            </button>
            <button
              type="button"
              onClick={saveBlock.guard(save)}
              disabled={busy}
              {...saveBlock.blockedProps}
              className="px-4 py-2 rounded-lg bg-cz-accent text-cz-on-accent text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {saving ? t("selection.saving") : t("selection.save")}
            </button>
          </div>
        </div>
        {/* #3012: den samme note vises altid (ikke kun efter `touched`) og bærer
            reasonId, så aria-describedby på Gem-knappen peger på et rigtigt
            element uanset om formen er rørt endnu. */}
        {saveBlock.blocked && (
          <BlockedNote id={saveBlock.reasonId} pulseKey={saveBlock.pulseKey} className="text-xs justify-end">
            {saveBlock.reason}
          </BlockedNote>
        )}
      </div>

      {/* S5 (Lag 3): forklar jæger-rollen + terræn-bevidst udbruds-styrke + bedste
          jæger-kandidater (rangeret efter aggression) fra den valgte trup. */}
      <HunterExplainer
        riders={selectedRiders}
        profileType={selectedStageProfileType}
        finaleType={selectedStageFinaleType}
        hunterId={sel.hunterId}
      />

      {/* #3520: rytterens profil-popup — åbnes af navneklikket ovenfor, ændrer ALDRIG
          sel/udtagelsen. Lukkes med Escape/klik-udenfor (useModalA11y i modalen selv). */}
      <RiderMiniProfileModal
        rider={profileRider}
        selectedStageIndex={selectedStageIndex}
        bound={profileRider ? (boundByRider.get(profileRider.id) ?? null) : null}
        fitLabel={fitSortLabel}
        onClose={() => setProfileRider(null)}
      />
    </section>
  );
}

// #1951: mobil-sort-kontrol. Eksponerer de samme nøgler som desktop-headerne
// (SELECTION_SORT_KEYS) + en retnings-toggle, og deler onSort med tabellen.
// #3898: i evne-visningen ("abilities") skifter nøgle-sættet til
// SELECTION_ABILITY_SORT_KEYS (navn/type + de 15 evner, samme korte labels
// som kolonne-headerne) — routeMatch/form/fatigue findes ikke som kort dér.
//
// Bevidst et segmenteret knap-bånd, IKKE et <select>: et native <select> har
// rolle "combobox", og holdudtagelses-smoke-testen finder kaptajn-vælgeren via
// `getByRole("combobox").first()`. En sort-dropdown her ville lægge sig FØR
// kaptajn-comboboxen og kapre `.first()`, så kaptajnen aldrig blev sat og
// gem-knappen forblev disabled. Knap-båndet sorterer lige så godt på mobil,
// matcher rytter-tabellernes retnings-toggle-styling og rører ikke combobox-
// rækkefølgen. Aktiv nøgle highlightes; retnings-toggle er kun aktiv når en
// nøgle er valgt (sortering er opt-in, default = oprindelig rækkefølge).
function SelectionSortControl({ sort, onSort, fitLabel, t, viewMode, tRider }) {
  const abilities = viewMode === "abilities";
  const sortKeys = abilities ? SELECTION_ABILITY_SORT_KEYS : SELECTION_SORT_KEYS;
  const abilityLabels = Object.fromEntries(STATS.map(({ key, label }) => [key, label]));
  const labels = abilities
    ? { name: t("selection.thRider"), primaryType: t("selection.type"), ...abilityLabels }
    : {
        name: t("selection.thRider"),
        primaryType: t("selection.type"),
        routeMatch: fitLabel,
        form: t("selection.form"),
        fatigue: t("selection.fatigue"),
      };
  const active = sort.sort != null;
  const dirAria = sort.dir === "desc" ? t("selection.sort.descAria") : t("selection.sort.ascAria");
  return (
    <div className="sm:hidden flex flex-col gap-2 px-4 py-3 border-b border-cz-border">
      <span className="block text-cz-3 text-3xs uppercase tracking-wider">{t("selection.sort.label")}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {sortKeys.map((key) => {
          const on = sort.sort === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSort(key)}
              aria-pressed={on}
              // #3898: evne-piller genbruger den fulde evne-navn-tooltip fra
              // kolonne-headerne (samme tRider-nøgle) — korte labels alene er
              // ikke selvforklarende ("Acc", "Pos") på en lille touch-pille.
              // name/primaryType har ingen racePreview.derived-nøgle, så de
              // undtages eksplicit i stedet for at slå en tom tooltip op.
              title={abilities && key !== "name" && key !== "primaryType" ? tRider(`racePreview.derived.${key}`) : undefined}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-cz border text-xs transition-colors ${
                on
                  ? "border-cz-accent bg-cz-accent/10 text-cz-1"
                  : "border-cz-border bg-cz-subtle text-cz-2 hover:text-cz-1"
              }`}
            >
              {labels[key]}
              {on && (sort.dir === "desc"
                ? <ArrowDownIcon size={12} aria-hidden="true" />
                : <ArrowUpIcon size={12} aria-hidden="true" />)}
            </button>
          );
        })}
        {active && (
          <button
            type="button"
            onClick={() => onSort(sort.sort)}
            aria-label={dirAria}
            title={dirAria}
            className="flex-shrink-0 flex items-center justify-center px-2.5 py-1 rounded-cz border border-cz-border bg-cz-subtle text-cz-2 hover:text-cz-1 transition-colors"
          >
            {sort.dir === "desc"
              ? <ArrowDownIcon size={14} aria-hidden="true" />
              : <ArrowUpIcon size={14} aria-hidden="true" />}
          </button>
        )}
      </div>
    </div>
  );
}

function RoleSelect({ label, value, riders, emptyLabel, disabled, onChange }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-cz-3">
      {label}
      <select
        value={value != null ? String(value) : ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="bg-cz-subtle border border-cz-border rounded px-2 py-1 text-xs text-cz-1 disabled:opacity-50 min-w-[160px]"
      >
        <option value="">{emptyLabel}</option>
        {riders.map((r) => (
          <option key={r.id} value={String(r.id)}>{r.name}</option>
        ))}
      </select>
    </label>
  );
}
