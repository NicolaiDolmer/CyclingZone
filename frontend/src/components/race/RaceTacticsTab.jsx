// RaceTacticsTab — løbssidens Taktik-fane (#4613, variant A godkendt 6/9).
//
// Afløser to separate kort der stod under hinanden på den gamle løbsside:
// intentions-fladen (#4632, RaceIntentionPanel) og taktik-ordre-kortet (#4246,
// TacticsCard). De havde hver sin etape-forståelse, hver sin gem-knap og hver
// sin overskrift — to guld-knapper på samme skærm og to steder at sætte "hvad
// skal han i dag". Fanen har nu:
//
//   · ÉN etape-vælger øverst. Kørte/låste etaper kan åbnes, men er read-only
//     ("det du sendte dem ud med") — aldrig et gem på en etape der er startet.
//   · Holdplanen (kaptajn, udbrud, sprint-tog) for den åbne etape.
//   · Én række pr. rytter med BÅDE dagens intention og dagens ordrer, under
//     samme etape.
//   · ÉN guld-knap, "Gem etape N", der gemmer begge dele for den åbne etape.
//     "Kopiér til etape N+1" er sekundær.
//
// To endpoints, ét gem:
//   GET/PUT /api/races/:raceId/stage-roles          → intentionen (alle etaper)
//   GET     /api/races/:raceId/team-orders          → ordrer + lås pr. etape
//   PUT     /api/races/:raceId/team-orders/:stage   → ordren for ÉN etape
//
// #6095: intentionens PUT erstatter KUN de etaper kladden har ændret (`stages`)
// og afvises med stage_roles_conflict, hvis en af dem er ændret et andet sted
// siden indlæsning. Et gem af etape 4 kan aldrig røre etape 5's intention, heller
// ikke fra en fane med en ældre kladde (Giro della Penisola 2/10).
//
// FOG OF WAR: ingen tal, ingen procenter, ingen loft-signaler. Trinnene kommer
// fra serverens `valid_efforts`, aldrig fra en hardkodet liste her.
//
// #4980 (spillerønske thelamba 7/9): ROLE-kolonnen er ikke længere ren visning.
// Efter #4613 kunne man ikke finde HVOR man skifter en rytters rolle — især
// midt i et etapeløb, når kaptajnen er styrtet. Kolonnen har nu en kompakt
// vælger med præcis de fem roller backenden kender. Rollen gælder stadig HELE
// løbet (ejer 6/9): et valg skrives på alle ULÅSTE etaper, aldrig kun den åbne,
// og en anden indehaver af en eksklusiv rolle (kaptajn / spurtkaptajn / jæger)
// demoteres i samme gem — ellers afviser serveren hele PUT'en med
// stage_roles_role_overlap. Ingen ny guld-knap: ændringen gemmes af fanens
// eksisterende "Gem etape N".
//
// #4979: etapeprofilen for den ÅBNE etape ligger i en tynd række over kortet
// (RaceStageProfileRow) — man skal kunne se hvad man sætter taktik til.
//
// #4992 (spillerønske egomadsen 7/9): ROUTE MATCH-kolonnen mellem ROLE og
// INTENTION viser hvor godt rytteren passer til DEN ÅBNE etape (0-100, samme
// FitBar som Hold-fanen/holdudtagelsen bruger). Tallet kommer fra stage-roles-
// svarets `stage_fit` — beregnet af serveren med samme terrainScore som fit,
// bare pr. etape — og skifter derfor når man klikker en anden etape. Kolonnen
// er den ENESTE sorterbare i fanen (Egos oprindelige ønske: "sortere i rute-
// match på de enkelte etaper"); uden et klik står listen i holdets udtagelses-
// rækkefølge som før, og sorteringen følger sidens konvention: første klik =
// bedst øverst, næste klik vender retningen.

//
// #6067: løb med regel-revisionen orders_gc_v1 (#5955/#5978) får tre ting, og
// legacy-løb er uændrede: en linje i hovedet der siger hvilke regler løbet
// bruger (før gem), jagt-stancen med de nye labels plus én linje om den
// begrænsede GC-reaktion, og én linje om at kaptajn/spurtkaptajn/hjælper kun
// går i morgenudbrud med "Forsøg udbrud". Ordre-halvdelen er preview-gated for
// legacy, men vises altid under orders_gc_v1: dér styrer ordrerne udbruddet.
// Revisionen læses direkte fra races (RLS: offentlig SELECT); en fejlet
// læsning betyder legacy, aldrig de nye regler. Prosaen bor i Hjælp.

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import i18n from "i18next";
import { authHeaders, supabase } from "../../lib/supabase"; // #4348: kanonisk kopi
import {
  breakawayStanceLabelKey,
  isOrdersGcRevision,
  ordersVisible,
  surfaceRaceRulesRevision,
} from "../../lib/ordersGcSurface.ts";
import { apiFetch } from "../../lib/apiFetch.ts"; // #5242: Retry-After-respekt + centraliseret 401-vej
import { profileLabelKey } from "../../lib/stageProfileConfig.js";
import { formatLocalTime } from "../../lib/intl.js";
import { relativeDayKey } from "../../lib/stageScheduleConfig.js";
import { LockIcon, CheckIcon, Button, Section, SectionHeader, SkeletonLines } from "../ui/index.js";
import SortableTh from "../ui/SortableTh.jsx";
import FitBar from "../racehub/FitBar.jsx";
import RaceStageProfileRow from "./RaceStageProfileRow.jsx";
import { stageRouteMatch, routeMatchComparator } from "../../lib/lineupInsight.js";
import { useReloadBlock, RELOAD_BLOCK_REASONS } from "../../lib/reloadGate.js";
import {
  buildDraftMatrix,
  changedStages,
  diffToOverrides,
  isDirty,
  overridesIndex,
  resolveCell,
  applyRoleForRest,
  SELECTABLE_ROLES,
} from "../../lib/stageRoleMatrixLogic.js";
import {
  DEFAULT_EFFORT,
  effortsForStage,
  isIndividualTimeTrialProfile,
  effortForStage,
  withIndividualTimeTrialEfforts,
  intentionFor,
  setIntention,
  copyStageIntentions,
  nextEditableStage,
  stageIntentionCounts,
  untouchedStages,
  baseRoleForRider,
} from "../../lib/raceIntention.js";
import {
  BREAKAWAY_STANCES,
  hasSprintCaptain,
  roleDefaultFor,
  setBreakawayStance,
  teamPlanKey,
  toggleLeadout,
  toggleTryBreak,
  withIntentionEfforts,
} from "../../lib/tacticsPlan.js";
import { defaultOrderForStage, fetchTeamOrders, orderForStage, saveTacticsCard } from "../../lib/tacticsOrdersAdapter.js";
import { roadOrdersAvailable, withoutRoadOrders } from "../../lib/tacticsProfileGate.ts"; // #7317
import { isStageLockedForTactics } from "../../lib/racePageTabs.js";
import { tacticsStartStage } from "./stagePageV2/stagePageV2Model.ts"; // #6570
import StagePlanBoard from "./StagePlanBoard.tsx"; // #7003
import { stagePlanReplacesControls, withStagePlanFields, withoutStagePlans } from "./StagePlanModel.ts"; // #7003
import { blockedReasonKey, oppositeOrderError } from "../../lib/oppositeOrders.js"; // #7003 spec §3

const API = import.meta.env.VITE_API_URL;

// Rollens navn i kolonnen. Ét sæt labels for hele fladen (tacticsOrders.roleLabel
// er SSOT'ens ord — "Domestique", ikke "Rider", jf. RACE_ENGINE_RULES §1).
const ROLE_KEY = {
  captain: "captain",
  co_captain: "co_captain", // #7239
  luxury_helper: "luxury_helper", // #5982
  sprint_captain: "sprint_captain",
  hunter: "hunter",
  helper: "helper",
  free_role: "free_role",
};
const roleKey = (role) => ROLE_KEY[role] || "helper";

// #6746: trinnet "protect" hedder efter rollen (spec taktik-roller §3): Arbejd for
// hjælper/jæger, Følg angrebene for kaptajn, delt kaptajn og spurtkaptajn, Kør offensivt for fri rolle.
const PROTECT_VARIANT = { captain: "follow", co_captain: "follow", sprint_captain: "follow", free_role: "free" };
const protectText = (t, role, part) => t(`intention.byRole.protect.${PROTECT_VARIANT[role] || "work"}.${part}`);

function stageLockTime(scheduledAt) {
  if (!scheduledAt) return null;
  const d = new Date(scheduledAt);
  if (Number.isNaN(d.getTime())) return null;
  const weekday = new Intl.DateTimeFormat(i18n.language || "en", { weekday: "short" }).format(d);
  return `${weekday} ${formatLocalTime(d)}`;
}

// Chip: valgt intention (guld-tekst på tonet flade) vs. "ikke valgt" (stiplet
// hairline, dæmpet). To tilstande, ingen tredje.
function IntentionChip({ t, effort, isDefault, role, muted = false }) {
  if (isDefault) {
    return (
      <span className="inline-flex items-center rounded-full border border-dashed border-cz-border px-2.5 py-0.5 text-2xs font-medium text-cz-3 whitespace-nowrap">
        {t("intention.roleDefault")}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-2xs font-semibold whitespace-nowrap ${
      muted ? "border-cz-border bg-cz-subtle text-cz-2" : "border-cz-accent/30 bg-cz-accent/10 text-cz-accent-t"
    }`}>
      {effort === "protect" ? protectText(t, role, "step") : t(`intention.step.${effort}`)}
    </span>
  );
}

// Den udfoldede vælger: ét trin pr. linje, én sætning i ord, ingen tal.
function IntentionPicker({ t, riderName, role, scopeLabel, steps, value, disabled, onPick, timeTrial = false, blockedFor = /** @type {(step: string) => string | null} */ (() => null) }) {
  return (
    <div className="rounded-cz border border-cz-border bg-cz-card overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-3.5 py-2 border-b border-cz-border">
        <span className="text-xs font-semibold text-cz-1">
          {t("intention.pickerTitle", { name: riderName || "—", scope: scopeLabel })}
        </span>
        <span className="text-3xs text-cz-3 whitespace-nowrap">{t("intention.appliesToStageOnly")}</span>
      </div>
      {steps.map((step) => {
        const on = step === value;
        const blocked = on ? null : blockedFor(step); // #7003: et valg der modsiger dagens ordre
        return (
          <button
            key={step}
            type="button"
            disabled={disabled || !!blocked}
            title={blocked ? t(blocked) : undefined}
            aria-pressed={on}
            onClick={() => onPick(step)}
            className={`w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2 text-left border-b border-cz-border last:border-b-0 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              on ? "bg-cz-accent/10" : "hover:bg-cz-subtle"
            }`}
          >
            <span className="w-3.5 shrink-0 text-cz-accent-t">
              {on && <CheckIcon size={14} aria-hidden="true" />}
            </span>
            <span className={`text-xs sm:w-32 shrink-0 ${on ? "font-semibold text-cz-accent-t" : "font-medium text-cz-1"}`}>
              {step === "protect" ? protectText(t, role, "step") : t(`intention.step.${step}`)}
            </span>
            <span className="text-xs text-cz-2 basis-full sm:basis-auto ps-[26px] sm:ps-0">
              {step === "protect" ? protectText(t, role, "why") : step === "save" && timeTrial ? t("intention.whyItt.save") : t(`intention.why.${step}`)}
            </span>
            {blocked ? (
              <span className="text-3xs text-cz-3 basis-full sm:basis-auto ps-[26px] sm:ps-0 sm:ms-auto">{t(blocked)}</span>
            ) : step === DEFAULT_EFFORT && (
              <span className="text-3xs uppercase tracking-wider text-cz-3 sm:ms-auto whitespace-nowrap">
                {t("intention.roleDefaultTag")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// #4980: rolle-vælgeren. Samme grammatik som IntentionPicker (ét valg pr. linje,
// flueben til venstre, én sætning i ord) — to vælgere i samme kolonne-familie
// skal ikke se ud som to forskellige idéer. Forskellen står i hovedet og
// fodnoten: rollen gælder resten af løbet, intentionen kun den åbne etape.
//
// #6095 (beta, ejer 4/10): med `scopeChoice` vælger manageren først hvilke etaper
// valget gælder: "etape N og løbet ud" (forvalgt) eller "kun etape N". Tidligere
// etaper røres aldrig. Uden flaget: præcis den gamle vælger.
function RolePicker({ t, riderName, scopeNote, value, disabled, onPick, scopeChoice = false, scope = "rest", onScope, stageNumber, coCaptainOn = false, luxuryHelperOn = false }) {
  return (
    <div className="rounded-cz border border-cz-border bg-cz-card overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-3.5 py-2 border-b border-cz-border">
        <span className="text-xs font-semibold text-cz-1">
          {t("racePage.tactics.rolePickerTitle", { name: riderName || "—" })}
        </span>
        <span className="text-3xs text-cz-3 whitespace-nowrap">{scopeNote}</span>
      </div>
      {scopeChoice && (
        <div className="px-3.5 py-2.5 border-b border-cz-border">
          <div className="text-3xs uppercase tracking-wider text-cz-3 mb-1.5">{t("racePage.tactics.roleScopeLabel")}</div>
          <div role="radiogroup" aria-label={t("racePage.tactics.roleScopeLabel")} className="grid grid-cols-2 rounded-cz border border-cz-border overflow-hidden">
            {[
              ["rest", t("racePage.tactics.roleScopeRest", { number: stageNumber })],
              ["stage", t("racePage.tactics.roleScopeStageOnly", { number: stageNumber })],
            ].map(([key, label], i) => {
              const on = scope === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={disabled}
                  onClick={() => onScope?.(key)}
                  className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${i ? "border-l border-cz-border" : ""} ${
                    on ? "bg-cz-accent/10 font-semibold text-cz-accent-t" : "font-medium text-cz-2 hover:bg-cz-subtle"
                  }`}
                >
                  {on && <CheckIcon size={12} aria-hidden="true" />}
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {SELECTABLE_ROLES.map((role) => {
        if (role === "co_captain" && !coCaptainOn && value !== "co_captain") return null; // #7239
        if (role === "luxury_helper" && !luxuryHelperOn && value !== "luxury_helper") return null; // #5982
        const on = role === value;
        return (
          <button
            key={role}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onPick(role)}
            className={`w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2 text-left border-b border-cz-border last:border-b-0 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              on ? "bg-cz-accent/10" : "hover:bg-cz-subtle"
            }`}
          >
            <span className="w-3.5 shrink-0 text-cz-accent-t">
              {on && <CheckIcon size={14} aria-hidden="true" />}
            </span>
            <span className={`text-xs sm:w-32 shrink-0 ${on ? "font-semibold text-cz-accent-t" : "font-medium text-cz-1"}`}>
              {t(`tacticsOrders.roleLabel.${role}`)}
            </span>
            <span className="text-xs text-cz-2 basis-full sm:basis-auto ps-[26px] sm:ps-0">
              {t(`racePage.tactics.roleWhy.${role}`)}
            </span>
          </button>
        );
      })}
      <p className="px-3.5 py-2 border-t border-cz-border text-3xs text-cz-3">
        {t(scopeChoice ? "racePage.tactics.roleExclusiveNoteScoped" : "racePage.tactics.roleExclusiveNote")}
      </p>
    </div>
  );
}

function TogglePill({ label, ariaLabel, active, disabled, onClick, title }) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      aria-pressed={active}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-cz border px-2 py-1 text-3xs font-medium uppercase tracking-wide transition-colors shrink-0 disabled:opacity-60 disabled:pointer-events-none
        ${active ? "border-cz-accent bg-cz-accent/10 text-cz-accent-t" : "border-cz-accent/40 text-cz-accent-t bg-transparent hover:bg-cz-accent/5"}`}
    >
      {/* Fluebenets plads reserveres altid: uden det skifter pillens BREDDE naar
          den slaas til, og hele knap-kolonnen hopper sidelaens. */}
      <CheckIcon size={10} aria-hidden="true" className={active ? "" : "invisible"} />
      {label}
    </button>
  );
}

// #6570: initialStage = etapen etapeside 2.0's guld-knap naevner ("Set tactics
// for stage N"). Aaben etape → fanen aabner paa den; ellers dagens regel.
export default function RaceTacticsTab({ raceId, profileByStage = {}, showOrders: showOrdersProp = true, initialStage = null }) {
  const { t } = useTranslation("races");
  // #6067: løbets regel-revision, bundet til DET løb den er læst for. Et skift
  // af raceId kan derfor aldrig arve et andet løbs revision, og en fejlet
  // læsning er legacy: "legacy" indtil læsningen for netop dette løb siger andet.
  const [revisionRead, setRevisionRead] = useState({ raceId: null, revision: "legacy" });
  useEffect(() => {
    let active = true;
    const settle = (revision) => { if (active) setRevisionRead({ raceId, revision }); };
    supabase
      .from("races")
      .select("engine_rules_revision, stages_completed")
      .eq("id", raceId)
      .maybeSingle()
      .then(({ data, error }) => settle(error ? "legacy" : surfaceRaceRulesRevision(data?.engine_rules_revision, data?.stages_completed)),
        () => settle("legacy"));
    return () => { active = false; };
  }, [raceId]);
  const rulesRevision = revisionRead.raceId === raceId ? revisionRead.revision : "legacy";
  const ordersGc = isOrdersGcRevision(rulesRevision);
  const showOrders = ordersVisible({ showOrders: showOrdersProp, revision: rulesRevision });
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    // Keep an open tab's calendar labels current across Copenhagen midnight.
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  // null = henter, false = hentningen fejlede. At skelne dem er hele pointen:
  // en fejlet fetch maa ikke vises som "ingen taktik sat" (#2849).
  const [roles, setRoles] = useState(null);
  // #7003: typet efter fetchTeamOrders-svaret, saa checkJs kender felterne (fx stagePlanEnabled).
  const [orders, setOrders] = useState(/** @type {Awaited<ReturnType<typeof fetchTeamOrders>>} */ (null));
  const [draftMatrix, setDraftMatrix] = useState({});
  const [initialMatrix, setInitialMatrix] = useState({});
  const [ordersByStage, setOrdersByStage] = useState({});
  const [initialOrdersByStage, setInitialOrdersByStage] = useState({});
  const [activeStage, setActiveStage] = useState(null);
  const [openRiderId, setOpenRiderId] = useState(null);
  // #4980: rolle-vælgeren har sin EGEN åbne-rytter — to vælgere i samme række
  // må aldrig stå udfoldet samtidig, og et klik i den ene lukker den anden.
  const [openRoleRiderId, setOpenRoleRiderId] = useState(null);
  // #6095 (beta): "rest" = den åbne etape og løbet ud (forvalgt, ejer 4/10),
  // "stage" = kun den åbne etape. Nulstilles til "rest" når en vælger åbnes.
  const [roleScopeChoice, setRoleScopeChoice] = useState("rest");
  const [status, setStatus] = useState("idle"); // idle | saving | saved | error
  const [errorKey, setErrorKey] = useState(null);
  // #4992: rute-match-sorteringen. null = ingen sortering valgt → holdets
  // udtagelses-rækkefølge, præcis som før kolonnen fandtes (sortering er opt-in,
  // samme regel som holdudtagelses-panelet). Sat: "desc" | "asc".
  const [routeSortDir, setRouteSortDir] = useState(null);

  // #6462: etapeprofilerne (togets standard) i en ref, saa load ikke genskabes af en ny objekt-identitet.
  const profileByStageRef = useRef(profileByStage);
  useEffect(() => { profileByStageRef.current = profileByStage; }, [profileByStage]);
  const load = useCallback(async () => {
    const headers = await authHeaders({ json: false });
    if (!headers) { setRoles(false); return; }
    let rolesBody = null;
    let orderCtx = /** @type {Awaited<ReturnType<typeof fetchTeamOrders>>} */ (null); // #7003
    try {
      // #6462: togreglen for loebet kommer med team-orders-svaret (sprintTrainFlatOnly):
      // motorens revision, ogsaa for et loeb der endnu ikke er bundet.
      const [rolesRes, orderResult] = await Promise.all([
        apiFetch(`${API}/api/races/${raceId}/stage-roles`, { headers }),
        fetchTeamOrders({ raceId }).catch(() => null),
      ]);
      // #5242 (CodeRabbit-fund): et 2xx med tom/ikke-JSON krop giver apiFetch's
      // res.data:null — uden dette tjek ville rolesBody.stage_count nedenfor
      // (UDEN FOR denne try) kaste i stedet for at falde tilbage til roles:false.
      if (!rolesRes.ok || !rolesRes.data || typeof rolesRes.data !== "object") {
        setRoles(false);
        return;
      }
      rolesBody = rolesRes.data;
      orderCtx = orderResult;
    } catch {
      setRoles(false);
      return;
    }

    const stageCount = rolesBody.stage_count ?? orderCtx?.stageCount ?? 0;
    const stageNumbers = Array.from({ length: stageCount }, (_, i) => i + 1);
    const seeded = buildDraftMatrix({
      riders: rolesBody.riders,
      overrides: rolesBody.overrides,
      stageNumbers,
      stagesCompleted: rolesBody.stages_completed ?? 0,
    });
    const seededOrders = {};
    for (const sn of stageNumbers) seededOrders[sn] = orderForStage(orderCtx, sn, profileByStageRef.current[sn]?.profile_type);

    setRoles(rolesBody);
    setOrders(orderCtx);
    setDraftMatrix(seeded);
    setInitialMatrix(seeded);
    setOrdersByStage(seededOrders);
    setInitialOrdersByStage(seededOrders);
    setActiveStage((current) => {
      if (current != null && stageNumbers.includes(current)) return current;
      const list = orderCtx?.stages?.length
        ? orderCtx.stages
        : stageNumbers.map((sn) => ({ stage_number: sn, locked: sn <= (rolesBody.stages_completed ?? 0) }));
      return tacticsStartStage(list, initialStage);
    });
    // NB: status/errorKey nulstilles bevidst IKKE her — "Gemt"-kvitteringen
    // (sat af save() lige før den awaiter load()) må ikke overskrives.
  }, [raceId, initialStage]);

  useEffect(() => { load(); }, [load]);

  const stagesCompleted = roles?.stages_completed ?? 0;
  const stageCount = roles?.stage_count ?? 0;
  const stageNumbers = useMemo(
    () => Array.from({ length: stageCount }, (_, i) => i + 1),
    [stageCount],
  );
  const stageList = useMemo(() => {
    const byNumber = new Map((orders?.stages ?? []).map((s) => [s.stage_number, s]));
    return stageNumbers.map((sn) => {
      const meta = byNumber.get(sn);
      return {
        stage_number: sn,
        scheduled_at: meta?.scheduled_at ?? null,
        locked: meta
          ? meta.locked === true || orders?.raceCompleted === true
          : isStageLockedForTactics({ stageNumber: sn, stagesCompleted, raceCompleted: orders?.raceCompleted === true }),
      };
    });
  }, [stageNumbers, orders, stagesCompleted]);

  const editableStages = useMemo(
    () => stageList.filter((s) => !s.locked).map((s) => s.stage_number),
    [stageList],
  );
  const riders = useMemo(() => roles?.riders ?? [], [roles?.riders]);
  const lockedOverrides = useMemo(() => overridesIndex(roles?.overrides), [roles?.overrides]);

  // #4992: den rækkefølge BEGGE flader (tabel + mobil-liste) tegnes i. Uden en
  // valgt sortering er det holdets egen rækkefølge — listen må aldrig flytte sig
  // af sig selv, kun fordi manageren bad om det. Kopi, aldrig en mutation af
  // `riders` (den kommer fra svaret og læses også af holdplanen ovenfor).
  const visibleRiders = useMemo(
    () => (routeSortDir ? [...riders].sort(routeMatchComparator(activeStage, routeSortDir)) : riders),
    [riders, routeSortDir, activeStage],
  );

  const counts = useMemo(
    () => stageIntentionCounts({ matrix: draftMatrix, riders, stageNumber: activeStage }),
    [draftMatrix, riders, activeStage],
  );
  const untouched = useMemo(
    () => untouchedStages({ matrix: draftMatrix, riders, editableStages, exceptStage: activeStage }),
    [draftMatrix, riders, editableStages, activeStage],
  );

  // #5159 (B1): intentioner og rollevalg ligger i kladder indtil Gem, og Gem er
  // TO sekventielle skrivninger naar ordrevisningen er aktiv. Et release-drevet
  // reload maa hverken kassere kladden eller ramme ned MELLEM de to kald.
  // Beregnes her — foer de tidlige returns — fordi et hook skal kaldes
  // ubetinget; `dirty` nedenfor er den samme sandhed, blot stage-lock-filtreret
  // til knappens tilstand.
  const draftDirty =
    isDirty(draftMatrix, initialMatrix) ||
    (showOrders && JSON.stringify(ordersByStage) !== JSON.stringify(initialOrdersByStage));
  useReloadBlock(draftDirty || status === "saving", RELOAD_BLOCK_REASONS.DIRTY);

  if (roles === null) {
    return (
      <Section>
        <SectionHeader title={t("racePage.tactics.title")} />
        <SkeletonLines lines={6} />
      </Section>
    );
  }
  if (roles === false) {
    return (
      <Section>
        <SectionHeader title={t("racePage.tactics.title")} />
        <p className="text-xs text-cz-3">{t("racePage.tactics.loadError")}</p>
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={load}>{t("tacticsOrders.retry")}</Button>
        </div>
      </Section>
    );
  }
  // #5945: holdet står i startfeltet, men er under startgulvet og kan ikke fyldes op
  // (serverens start_outlook, samme regel som udtagelses-panelet). Så stiller det ikke
  // op, og en taktik-matrix for ryttere der aldrig starter ville bare lyve om at holdet
  // deltager. Banneret erstatter matrixen; teksten genbruger udtagelsens egen linje.
  if (roles.enabled && roles.start_outlook?.starts === false) {
    return (
      <Section>
        <SectionHeader title={t("racePage.tactics.title")} />
        <p role="status" data-testid="tactics-not-starting" className="text-xs text-cz-warning">
          {/* #6740: tre årsager, tre sætninger — afmeldt, kom ikke med ved start, under gulvet. */}
          {roles.start_outlook.reason === "did_not_start"
            ? t("racehub.column.didNotStartNote", { min: roles.start_outlook.min })
            : roles.start_outlook.reason === "withdrawn"
              ? t("racehub.column.withdrawnNote")
              : t("selection.willNotStart", { min: roles.start_outlook.min })}
        </p>
      </Section>
    );
  }
  // Flag OFF, eller holdet har ingen ryttere i løbet.
  if (!roles.enabled || riders.length === 0 || activeStage == null) {
    return (
      <Section>
        <SectionHeader title={t("racePage.tactics.title")} />
        <p className="text-xs text-cz-3">{t("tacticsOrders.empty")}</p>
      </Section>
    );
  }

  const isOneDay = stageCount <= 1;
  const saving = status === "saving";
  const activeMeta = stageList.find((s) => s.stage_number === activeStage) ?? { locked: false, scheduled_at: null };
  const stageLocked = activeMeta.locked;
  /** #7332: etapens profiltype (null for en ukendt/uvalgt etape). */
  const profileTypeOfStage = (stageNumber) => (stageNumber == null ? null : profileByStage[stageNumber]?.profile_type ?? null);
  const order = ordersByStage[activeStage] ?? orderForStage(orders, activeStage, profileByStage[activeStage]?.profile_type);
  const initialOrder = initialOrdersByStage[activeStage];
  const ordersDirty = JSON.stringify(order) !== JSON.stringify(initialOrder);
  const dirty = !stageLocked && (isDirty(draftMatrix, initialMatrix) || (showOrders && ordersDirty));
  const nextStage = nextEditableStage({ editableStages, stageNumber: activeStage });
  const lockTime = stageLockTime(activeMeta.scheduled_at);

  function pickIntention(riderId, effort) {
    setDraftMatrix((m) => setIntention({ matrix: m, stageNumber: activeStage, riderId, effort }));
    setOpenRiderId(null);
    if (status !== "idle") setStatus("idle");
  }

  // #4980: rollen skrives på ALLE ulåste etaper (den gælder resten af løbet),
  // ikke kun den åbne — og aldrig på en låst/kørende etape: `editableStages`
  // er netop de etaper vælgeren må røre. Gemmes af fanens eksisterende
  // "Gem etape N" sammen med intentionen (samme PUT, samme diff).
  function pickRole(riderId, role) {
    // #6095 (beta): med etape-valget rammer et rollevalg aldrig etaper FØR den
    // åbne. Uden flaget: uændret #4980-adfærd (alle ulåste etaper).
    const stages = roles?.role_scope_choice === true && stageCount > 1
      ? (roleScopeChoice === "stage" ? [activeStage] : editableStages.filter((sn) => sn >= activeStage))
      : editableStages;
    setDraftMatrix((m) => applyRoleForRest({ matrix: m, riderId, role, stages }));
    setOpenRoleRiderId(null);
    if (status !== "idle") setStatus("idle");
  }

  function updateOrder(transform) {
    setOrdersByStage((cur) => ({ ...cur, [activeStage]: transform(cur[activeStage] ?? order) }));
    if (status !== "idle") setStatus("idle");
  }

  function copyToNextStage() {
    if (nextStage == null) return;
    // #7332: en enkeltstart som maal faar aldrig grupetto/protect (bliver Kør roligt).
    setDraftMatrix((m) => copyStageIntentions({ matrix: m, fromStage: activeStage, toStage: nextStage, riders, fromProfileType: profileTypeOfStage(activeStage), toProfileType: profileTypeOfStage(nextStage) }));
    // Ordrerne kopieres med: "kopiér til etape N+1" skal flytte HELE dagens
    // plan, ikke halvdelen af den. Etapen der kopieres TIL skal stadig gemmes
    // selv (den er en anden etapes PUT).
    setOrdersByStage((cur) => ({ ...cur, [nextStage]: withoutStagePlans(cur[activeStage] ?? order) })); // #7003: planen haenger paa ruten
    if (status !== "idle") setStatus("idle");
  }

  // #4992: samme cyklus-konvention som resten af sidens sorterbare kolonner
  // (klik på den aktive nøgle vender retningen). Første klik = bedst øverst,
  // fordi et højt rute-match er "godt" — samme default som holdudtagelsens
  // rute-match-kolonne (selectionDefaultSortDir: numerisk starter desc).
  function toggleRouteSort() {
    setRouteSortDir((dir) => (dir === "desc" ? "asc" : "desc"));
  }

  function openStage(stageNumber) {
    setActiveStage(stageNumber);
    setOpenRiderId(null);
    setOpenRoleRiderId(null);
  }

  async function save() {
    if (stageLocked) return;
    const headers = await authHeaders();
    if (!headers) return;
    setStatus("saving");
    setErrorKey(null);
    try {
      // 1) Intentionen. #6095: serveren erstatter KUN `stages` (de etaper denne
      // kladde har ændret), og kun hvis ingen andre har ændret dem siden load.
      // Hele kladden sendes stadig i `overrides`, så en ny frontend mod en
      // backend fra før #6095 (deploy-vinduet) opfører sig som før, ikke værre.
      const stages = changedStages(draftMatrix, initialMatrix).filter((sn) => editableStages.includes(sn));
      if (stages.length) {
        // #7332: en enkeltstart gemmes aldrig med grupetto/protect fra fladen (bliver "save").
        const overrides = diffToOverrides({ matrix: withIndividualTimeTrialEfforts({ matrix: draftMatrix, profileByStage }), riders });
        // "empty" = serverens EMPTY_STAGE_VERSION for en etape uden rækker.
        const baseVersions = Object.fromEntries(stages.map((sn) => [sn, roles?.stage_versions?.[sn] ?? "empty"]));
        const res = await apiFetch(`${API}/api/races/${raceId}/stage-roles`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ overrides, stages, base_versions: baseVersions }),
        });
        const body = res.data || {};
        if (!res.ok) {
          // Ændret i en anden fane/enhed: hent den nyeste udgave i stedet for at
          // overskrive den. Kladden kasseres; beskeden beder om at tjekke + gemme.
          if (body.error === "stage_roles_conflict") await load();
          setStatus("error");
          setErrorKey(body.error || "generic");
          return;
        }
      }
      // 2) Ordrerne for DEN ÅBNE etape (endpointet er én-etape-scopet). Springes
      // over når ordre-halvdelen er gated væk — så gemmer fanen kun det
      // spilleren faktisk kunne se og røre.
      // #6647: ordren bærer intentionens indsats, aldrig rollens "normal".
      // #7003: med etapeplanen foelger indsatsen opgaven (planens felter vinder over intentionen).
      if (showOrders) await saveTacticsCard({ raceId, stage: activeStage, order: withoutRoadOrders(withIntentionEfforts(order, (riderId) => effortForStage(intentionFor({ matrix: draftMatrix, stageNumber: activeStage, riderId }), profileTypeOfStage(activeStage))), profileTypeOfStage(activeStage)), stagePlan: orders?.stagePlanEnabled === true });
      setStatus("saved");
      setOpenRiderId(null);
      setOpenRoleRiderId(null);
      await load();
    } catch (err) {
      setStatus("error");
      setErrorKey(err?.message || "generic");
    }
  }

  const scopeLabel = isOneDay
    ? t("intention.raceDayLower")
    : t("intention.stageLower", { number: activeStage });
  const intentionColumn = isOneDay
    ? t("intention.colIntentionRaceDay")
    : t("intention.colIntention", { number: activeStage });
  const ordersColumn = isOneDay
    ? t("racePage.tactics.colOrdersRaceDay")
    : t("racePage.tactics.colOrders", { number: activeStage });
  const routeMatchColumn = isOneDay
    ? t("racePage.tactics.colRouteMatchRaceDay")
    : t("racePage.tactics.colRouteMatch", { number: activeStage });
  const roleScope = isOneDay ? t("intention.thisRace") : t("intention.allRace");
  // Samme terraen-ord som hero'ens TERRAIN-blok. Bucket-navnet ("Flat" for en
  // rolling etape) staar side om side med hero'ens finere label paa den samme
  // skaerm nu hvor begge er synlige, og to ord for een etape laeses som en fejl.
  const stageProfileType = profileByStage[activeStage]?.profile_type;
  const toolbarNote = stageLocked
    ? (isOneDay
      ? t("racePage.tactics.lockedRaceDay")
      : lockTime
        ? t("racePage.tactics.lockedStage", { number: activeStage, time: lockTime })
        : t("racePage.tactics.lockedStageNoTime", { number: activeStage }))
    : profileByStage[activeStage]
      ? `${t(`detail.${profileLabelKey(stageProfileType)}`)}. ${t("intention.notSetNote")}`
      : t("intention.notSetNote");
  const footerLine = isOneDay
    ? t("intention.footerRaceDay", counts)
    : t("intention.footer", { stage: activeStage, ...counts });
  // "etaperne 4 og 5" — ikke "4, 5". Sidste led bindes med sprogets eget ord,
  // saa linjen laeses som en saetning og ikke som en liste.
  const stageListText = untouched.length <= 1
    ? untouched.join("")
    : [untouched.slice(0, -1).join(", "), untouched[untouched.length - 1]].join(t("intention.listAnd"));
  const untouchedLine = untouched.length === 0
    ? null
    : t(untouched.length === 1 ? "intention.footerUntouchedOne" : "intention.footerUntouchedMany", { stages: stageListText });

  // #4980: rytterens EFFEKTIVE rolle på den åbne etape (override → basis-rolle),
  // ikke race_entries-rollen alene. Uden dette ville kolonnen, holdplanen og
  // sprint-tog-logikken vise den rolle han blev udtaget i, sekundet efter
  // spilleren har givet kaptajnbåndet til en anden. Låst etape læses af de
  // GEMTE overrides ("det du sendte dem ud med"), præcis som effortFor.
  const roleFor = (rider) => (stageLocked
    ? resolveCell({ rider, stageNumber: activeStage, overridesMap: lockedOverrides }).race_role
    : draftMatrix[activeStage]?.[rider.rider_id]?.race_role ?? baseRoleForRider(rider));

  const captain = riders.find((r) => roleFor(r) === "captain") || null;
  const plan = teamPlanKey(order.breakaway_stance, captain?.name ?? null);
  const teamHasSprintCaptain = hasSprintCaptain(riders.map((r) => ({ role: roleFor(r) })));
  const sprintCaptain = riders.find((r) => roleFor(r) === "sprint_captain") || null;
  const orderByRider = new Map((order.riders ?? []).map((r) => [r.rider_id, r]));
  // #7003: etapeplanen langs ruten (serverens svar: flag + femtrins-indsats + s5_profiles_v3).
  // Enkeltstart/holdtidskoersel beholder de almindelige indsats-kontroller.
  const stagePlanOn = showOrders && stagePlanReplacesControls(orders?.stagePlanEnabled === true, stageProfileType);
  const leadoutCount = ((stagePlanOn ? withStagePlanFields(order) : order).riders ?? []).filter((r) => r.leadout).length; // #7003: planens tog

  // Én rytters intention på den åbne etape. Låste etaper har ingen draft-celle
  // (buildDraftMatrix dækker kun de redigerbare) — de læses direkte af de
  // gemte overrides, så "det du sendte dem ud med" er sandt.
  // #7003 (spec §3): et indsatstrin der modsiger rytterens udbrud/tog i dag.
  const effortBlockedKey = (rider, step) => {
    const ro = orderByRider.get(rider.rider_id) || {};
    const roadOn = roadOrdersAvailable(stageProfileType); // #7317: skjulte vej-flag spaerrer aldrig en indsats paa tidskoersel
    return blockedReasonKey(step, { effort: effortFor(rider), try_break: roadOn && ro.try_break === true, leadout: roadOn && ro.leadout === true }, roleFor(rider), { teamHasSprintCaptain });
  };

  // #7332: paa en aaben enkeltstart vises grupetto/protect (gamle valg) som Kør roligt,
  // og vaelgeren har kun Kør roligt, Normal og Alt ud. En laast etape viser det der blev sendt.
  const effortFor = (rider) => (stageLocked
    ? resolveCell({ rider, stageNumber: activeStage, overridesMap: lockedOverrides }).effort
    : effortForStage(intentionFor({ matrix: draftMatrix, stageNumber: activeStage, riderId: rider.rider_id }), stageProfileType));
  const steps = effortsForStage(roles?.valid_efforts, stageProfileType);

  // #4980: rollen skrives fra den FØRSTE ulåste etape og løbet ud — noten i
  // vælgerens hoved siger det med det etapenummer det gælder fra, så et skift
  // midt i et etapeløb ikke kan læses som "kun i dag".
  // NB: hedder ikke firstOpenStage — det navn er en racePageTabs.js-hjaelper
  // (brugt af load() via tacticsStartStage); en lokal const med samme navn ville
  // forvirre og kunne skygge for den ved en senere direkte import.
  const firstEditableStage = editableStages.length ? editableStages[0] : activeStage;
  const roleScopeNote = isOneDay
    ? t("racePage.tactics.roleScopeRaceDay")
    : t("racePage.tactics.roleScope", { number: firstEditableStage });
  // #6095 (beta): manageren vælger selv "etape N og løbet ud" / "kun etape N".
  // Endagsløb har kun én etape, så valget giver ingen mening dér.
  const scopeChoice = roles.role_scope_choice === true && !isOneDay;
  // #7239: delt kaptajn tilbydes kun når holdet har en i udtagelsen. Udtagelsen er
  // gated til løb der kender rollen (sprint_leader_allowed), så det samme gælder her,
  // og en etape-rolle kan altid sættes tilbage til delt kaptajn.
  const coCaptainOn = riders.some((r) => baseRoleForRider(r) === "co_captain");
  // #5982: luksushjaelperen paa samme maade (holdet har en i udtagelsen = loebet kender rollen).
  const luxuryHelperOn = riders.some((r) => baseRoleForRider(r) === "luxury_helper");
  const rolePickerScope = scopeChoice
    ? {
      scopeNote: t("intention.stage", { number: activeStage }),
      scopeChoice: true,
      scope: roleScopeChoice,
      onScope: setRoleScopeChoice,
      stageNumber: activeStage,
      coCaptainOn,
      luxuryHelperOn,
    }
    : { scopeNote: roleScopeNote, coCaptainOn, luxuryHelperOn };

  // Rene render-funktioner, IKKE nestede komponenter: en komponent defineret
  // inde i render remountes ved hver tastetryk-render (React ser en ny type),
  // hvilket ville lukke den udfoldede vaelger under fingeren.
  function renderRoleCell(rider) {
    const role = roleFor(rider);
    const open = openRoleRiderId === rider.rider_id;
    // Låst etape og udgåede ryttere er ren visning: serveren afviser dem
    // alligevel (stage_roles_stage_locked / stage_roles_rider_abandoned), og
    // en knap der ikke kan bruges er værre end ingen knap. Uden en eneste
    // ulåst etape (sidste dag kørt) er der intet tilbage at sætte rollen på.
    const canEdit = !stageLocked && !rider.abandoned && editableStages.length > 0;
    return (
      <>
        <div className="text-cz-1 text-xs">{t(`tacticsOrders.roleLabel.${roleKey(role)}`)}</div>
        {/* #6095: med etape-valget kan rollen afvige pr. etape; "hele løbet" ville lyve. */}
        {!scopeChoice && <div className="text-3xs uppercase tracking-wider text-cz-3 mt-0.5">{roleScope}</div>}
        {canEdit && (
          <button
            type="button"
            disabled={saving}
            aria-expanded={open}
            aria-label={t("racePage.tactics.changeRoleAria", { name: rider.name || "—" })}
            onClick={() => { setOpenRoleRiderId(open ? null : rider.rider_id); setOpenRiderId(null); setRoleScopeChoice("rest"); }}
            className="mt-1 text-xs font-medium text-cz-accent-t hover:underline disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {open ? t("intention.close") : t("intention.change")}
          </button>
        )}
      </>
    );
  }

  // #4992: rute-match for den ÅBNE etape. Desktop bruger den delte FitBar
  // (bar + tal), præcis den samme visuelle grammatik som Hold-fanen og
  // holdudtagelsen — kolonnen skal læses som det samme signal, ikke som et nyt.
  // Mobil viser KUN tallet: baren ville koste bredde på en flade der aldrig må
  // scrolle vandret (#1834), og tallet er det man sorterer efter.
  function renderRouteMatchCell(rider, { numberOnly = false } = {}) {
    const score = stageRouteMatch(rider, activeStage);
    if (numberOnly) {
      return (
        <span className="font-data text-xs tabular-nums text-cz-2">
          {score == null ? "—" : score}
        </span>
      );
    }
    return <FitBar score={score} />;
  }

  function renderIntentionCell(rider) {
    if (rider.abandoned) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-cz-3">
          <LockIcon size={11} aria-hidden="true" />
          {t("intention.riderAbandoned")}
        </span>
      );
    }
    const effort = effortFor(rider);
    const isDefault = effort === DEFAULT_EFFORT;
    const open = openRiderId === rider.rider_id;
    const role = roleFor(rider);
    const todayText = effort === "protect" ? protectText(t, role, "today") : effort === "save" && isIndividualTimeTrialProfile(stageProfileType) ? t("intention.todayItt.save") : t(`intention.today.${effort}`);
    if (stageLocked) {
      return (
        <>
          <IntentionChip t={t} effort={effort} isDefault={isDefault} role={role} muted />
          <p className="mt-1 text-3xs text-cz-3">
            {isDefault
              ? t("intention.nothingSet")
              : isOneDay
                ? t("racePage.tactics.whatYouSetRaceDay", { today: todayText })
                : t("racePage.tactics.whatYouSet", { number: activeStage, today: todayText })}
          </p>
        </>
      );
    }
    return (
      <>
        <div className="flex items-center gap-2.5 flex-wrap">
          <IntentionChip t={t} effort={effort} isDefault={isDefault} role={role} />
          <button
            type="button"
            disabled={saving}
            aria-expanded={open}
            onClick={() => { setOpenRiderId(open ? null : rider.rider_id); setOpenRoleRiderId(null); }}
            className="text-xs font-medium text-cz-accent-t hover:underline disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {open ? t("intention.close") : t(isDefault ? "intention.setIntention" : "intention.change")}
          </button>
        </div>
        <p className="mt-1 text-3xs text-cz-3">
          {isDefault
            ? t("intention.nothingSet")
            : t("intention.line", {
                role: t(`intention.roleWord.${role}`),
                today: todayText,
              })}
        </p>
      </>
    );
  }

  function renderOrdersCell(rider) {
    const id = rider.rider_id;
    const ro = orderByRider.get(id) || roleDefaultFor(defaultOrderForStage(orders, profileByStage[activeStage]?.profile_type), id);
    if (stageLocked || rider.abandoned) {
      return (
        <span className="inline-flex items-center gap-1 text-3xs text-cz-3">
          <LockIcon size={11} aria-hidden="true" />
          {t("racePage.tactics.locked")}
        </span>
      );
    }
    // #7317: ingen udbrud/tog paa tidskoersel — forklaringen staar een gang over listen.
    if (!roadOrdersAvailable(stageProfileType)) return <span className="text-3xs text-cz-3" aria-hidden="true">—</span>;
    const isSprintCaptain = roleFor(rider) === "sprint_captain";
    // #7003 (spec §3): et valg der modsiger rytterens andre ordrer kan ikke slaas til.
    const riderState = { effort: effortFor(rider), try_break: ro.try_break === true, leadout: ro.leadout === true };
    const breakBlocked = blockedReasonKey("try_break", riderState, roleFor(rider), { teamHasSprintCaptain });
    // Tog-knappen vises kun paa et hold med spurtkaptajn (og aldrig for ham selv).
    const trainShown = teamHasSprintCaptain && !isSprintCaptain;
    const trainBlocked = trainShown ? blockedReasonKey("leadout", riderState, roleFor(rider), { teamHasSprintCaptain }) : null;
    const conflict = oppositeOrderError(riderState, roleFor(rider), { teamHasSprintCaptain });
    // En gemt modsaetning forklares med selve reglen; ellers hvorfor en knap er graa.
    const reason = conflict ? `intention.errors.${conflict}` : breakBlocked || trainBlocked;
    return (
      <span className="flex flex-wrap items-center gap-2">
        {conflict && (
          <span data-testid="opposite-orders-pick-one" className="text-3xs font-medium uppercase tracking-wide text-cz-warning">
            {t("tacticsOrders.pickOne")}
          </span>
        )}
        <TogglePill
          label={t("tacticsOrders.tryBreak")}
          ariaLabel={t("tacticsOrders.tryBreakAria", { name: rider.name || "—" })}
          active={ro.try_break === true}
          disabled={saving || !!breakBlocked}
          title={breakBlocked ? t(breakBlocked) : undefined}
          onClick={() => updateOrder((o) => toggleTryBreak(o, id))}
        />
        {/* Sprint-toget kan kun sættes når holdet har en spurt-kaptajn at køre
            for — og han kører aldrig i sit eget tog. Hans plads holdes åben
            (`invisible`), så knap-kolonnerne står lige ned gennem listen. */}
        {teamHasSprintCaptain && (
          <span
            className={isSprintCaptain ? "hidden sm:inline-flex sm:invisible" : "inline-flex"}
            aria-hidden={isSprintCaptain}
          >
            <TogglePill
              label={t("tacticsOrders.leadout")}
              ariaLabel={t("tacticsOrders.leadoutAria", { name: rider.name || "—" })}
              active={ro.leadout === true}
              disabled={saving || isSprintCaptain || !!trainBlocked}
              title={trainBlocked ? t(trainBlocked) : undefined}
              onClick={() => updateOrder((o) => toggleLeadout(o, id))}
            />
          </span>
        )}
        {reason && <span className="basis-full text-3xs text-cz-3">{t(reason)}</span>}
      </span>
    );
  }

  return (
    <>
      {/* #4979: profilen for den ABNE etape, over kortet. Rykker med etape-
          vaelgeren nedenfor, saa man ser hvad man saetter taktik til. */}
      <RaceStageProfileRow
        profile={profileByStage[activeStage]}
        stageLabel={isOneDay ? null : t("intention.stage", { number: activeStage })}
        hasClassifications={!isOneDay}
      />
    <section data-testid="race-tactics-tab" className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
      <div className="px-4 py-3 border-b border-cz-border flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold text-cz-1 text-sm">{t("racePage.tactics.title")}</h2>
          <p className="text-cz-3 text-xs mt-0.5">{t(isOneDay ? "racePage.tactics.helpRaceDay" : scopeChoice ? "racePage.tactics.helpScoped" : "racePage.tactics.help")}</p>
          {ordersGc && (
            <p data-testid="race-rules-revision" className="text-xs mt-1 text-cz-2">
              <span className="text-cz-3">{t("tacticsOrders.ordersGc.rulesLabel")}:</span>{" "}
              <span className="font-medium text-cz-1">{t("tacticsOrders.ordersGc.rulesName")}</span>
              {" · "}
              <Link to="/help?section=raceSelection" className="text-cz-accent-t hover:underline">
                {t("tacticsOrders.ordersGc.rulesHelp")}
              </Link>
            </p>
          )}
        </div>
        {!stageLocked && lockTime && !isOneDay && (
          <span className="font-data text-2xs text-cz-3 whitespace-nowrap tabular-nums">
            {t("racePage.tactics.stageMeta", { number: activeStage, time: lockTime })}
          </span>
        )}
      </div>

      {/* Etape-vælger: fanens egen toolbar inde i hairline-rammen. Låste etaper
          kan åbnes, men er read-only. Endagsløb har ingen vælger. */}
      <div className="px-4 py-2 border-b border-cz-border bg-cz-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="inline-flex rounded-cz border border-cz-border bg-cz-card overflow-x-auto max-w-full self-start">
          {isOneDay ? (
            <span className="px-3 py-1 text-xs font-semibold text-cz-accent-t bg-cz-accent/10 whitespace-nowrap">
              {t("intention.raceDay")}
            </span>
          ) : (
            stageList.map((s) => {
              const sn = s.stage_number;
              const on = sn === activeStage;
              // Next unfinished stage is not necessarily on today's calendar date (#5290).
              const isToday = Boolean(s.scheduled_at) && relativeDayKey(s.scheduled_at, new Date(nowMs)) === "today";
              return (
                <button
                  key={sn}
                  type="button"
                  disabled={saving}
                  aria-pressed={on}
                  // Eksplicit navn: sidens etape-stribe har ALLEREDE knapper der
                  // hedder "Etape 1". To kontroller med samme navn på samme side
                  // er tvetydigt for både skærmlæsere og tests.
                  aria-label={t(isToday ? "intention.stageTodayAria" : "intention.stageAria", { number: sn })}
                  onClick={() => openStage(sn)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs whitespace-nowrap border-s border-cz-border first:border-s-0 transition-colors ${
                    on
                      ? "bg-cz-accent/10 text-cz-accent-t font-semibold"
                      : s.locked
                        ? "text-cz-3 hover:text-cz-2"
                        : "text-cz-2 hover:text-cz-1"
                  }`}
                >
                  {s.locked && <LockIcon size={11} aria-hidden="true" />}
                  {isToday ? t("intention.stageToday", { number: sn }) : t("intention.stage", { number: sn })}
                </button>
              );
            })
          )}
        </div>
        <p className="text-xs text-cz-2">{toolbarNote}</p>
      </div>

      {/* Holdplanen for den åbne etape: hvem kører der ledes for, hvad gør
          holdet med udbruddet, og hvor mange kører sprint-tog. Preview-gated
          sammen med ordre-kolonnen — se TACTICS_V4_PREVIEW i RaceDetailPage. */}
      {showOrders && !roadOrdersAvailable(stageProfileType) && (
        <p data-testid="time-trial-no-road-orders" className="px-4 py-3 border-b border-cz-border text-xs text-cz-2">{t("tacticsOrders.timeTrialNoRoadOrders")}</p>
      )}
      {showOrders && roadOrdersAvailable(stageProfileType) && (
      <div className="px-4 py-3 border-b border-cz-border grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <p className="text-3xs uppercase tracking-wide text-cz-3">{t("tacticsOrders.planLabel")}</p>
          <p className="text-xs text-cz-1 mt-0.5 leading-snug">{t(plan.key, plan.params)}</p>
        </div>
        <div>
          <p className="text-3xs uppercase tracking-wide text-cz-3 mb-1">
            {t(ordersGc ? "tacticsOrders.ordersGc.stanceLabel" : "tacticsOrders.breakawayLabel")}
          </p>
          <div role="group" aria-label={t("tacticsOrders.breakawayAria")} className={`flex rounded-cz border border-cz-border overflow-hidden ${ordersGc ? "w-full" : "w-fit"}`}>
            {BREAKAWAY_STANCES.map((stance) => (
              <button
                key={stance}
                type="button"
                disabled={stageLocked || saving}
                aria-pressed={order.breakaway_stance === stance}
                onClick={() => updateOrder((o) => setBreakawayStance(o, stance))}
                className={`px-2 py-1 text-3xs font-medium transition-colors disabled:opacity-60 disabled:pointer-events-none
                  ${ordersGc ? "flex-1 leading-tight border-s border-cz-border first:border-s-0" : ""}
                  ${order.breakaway_stance === stance ? "bg-cz-accent/10 text-cz-accent-t" : "bg-cz-card text-cz-2 hover:text-cz-1"}`}
              >
                {t(breakawayStanceLabelKey(stance, rulesRevision))}
              </button>
            ))}
          </div>
          {ordersGc && (
            <p className="text-2xs text-cz-3 mt-1 leading-snug">{t("tacticsOrders.ordersGc.gcNote")}</p>
          )}
        </div>
        <div>
          <p className="text-3xs uppercase tracking-wide text-cz-3">{t("tacticsOrders.leadout")}</p>
          <p className="text-xs text-cz-1 mt-0.5 leading-snug">
            {teamHasSprintCaptain
              ? t("racePage.tactics.sprintTrainRiders", { count: leadoutCount, name: sprintCaptain?.name || "—" })
              : t("racePage.tactics.sprintTrainNone")}
          </p>
        </div>
        {ordersGc && (
          <p data-testid="orders-gc-break-note" className="sm:col-span-3 text-2xs text-cz-3 leading-snug">
            {t("tacticsOrders.ordersGc.breakNote")}
          </p>
        )}
      </div>
      )}

      {/* #7003: etapeplanen erstatter intentions- og ordre-kolonnerne, naar den er slaaet til. */}
      {stagePlanOn && (
        <StagePlanBoard
          t={t}
          raceId={raceId}
          activeStage={activeStage}
          isOneDay={isOneDay}
          riders={visibleRiders}
          roleFor={roleFor}
          order={order}
          onChangeOrder={updateOrder}
          profile={profileByStage[activeStage]}
          stageLocked={stageLocked}
          stageCompleted={activeStage <= stagesCompleted}
          saving={saving}
          teamHasSprintCaptain={teamHasSprintCaptain}
          renderRoleCell={renderRoleCell}
          rolePickerFor={(rider) => (openRoleRiderId === rider.rider_id && !rider.abandoned && !stageLocked
            ? <RolePicker t={t} riderName={rider.name} {...rolePickerScope} value={roleFor(rider)} disabled={saving} onPick={(role) => pickRole(rider.rider_id, role)} />
            : null)}
          onEditorOpen={() => setOpenRoleRiderId(null)}
          roleDefaultFor={(id) => roleDefaultFor(defaultOrderForStage(orders, profileByStage[activeStage]?.profile_type), id)}
          effortFor={effortFor}
          routeMatch={{
            label: routeMatchColumn,
            title: t("racePage.tactics.sortRouteMatch"),
            mobileLabel: t("selection.routeMatch"),
            sortDir: routeSortDir,
            onSort: toggleRouteSort,
            renderCell: renderRouteMatchCell,
          }}
        />
      )}
      {/* Desktop: tabel. Under sm: stablede kort (samme indhold, ingen vandret
          scroll — siden må aldrig overflowe på mobil, #1834). */}
      {!stagePlanOn && (
      <div className="hidden sm:block overflow-x-auto">
        {/* #4992: tabellen er sorterbar paa PRAECIS een kolonne (rute-match for
            den aabne etape). De oevrige headers er bevidst inaktive: rytter/
            rolle/intention/ordrer har ingen iboende orden manageren beder om. */}
        <table data-sortable className="w-full text-sm">
          <thead>
            <tr className="border-b border-cz-border">
              <th className="px-4 py-2 text-left font-medium text-xs uppercase tracking-wide text-cz-3">{t("intention.colRider")}</th>
              <th className="px-4 py-2 text-left font-medium text-xs uppercase tracking-wide text-cz-3">{t("intention.colRole")}</th>
              <SortableTh
                sortKey="routeMatch"
                sort={routeSortDir ? "routeMatch" : null}
                sortDir={routeSortDir}
                onSort={toggleRouteSort}
                title={t("racePage.tactics.sortRouteMatch")}
                className="px-4 py-2 text-left font-medium text-xs uppercase tracking-wide whitespace-nowrap"
              >
                {routeMatchColumn}
              </SortableTh>
              <th className="px-4 py-2 text-left font-medium text-xs uppercase tracking-wide text-cz-3">{intentionColumn}</th>
              {showOrders && <th className="px-4 py-2 text-left font-medium text-xs uppercase tracking-wide text-cz-3">{ordersColumn}</th>}
            </tr>
          </thead>
          <tbody>
            {visibleRiders.map((rider) => {
              const editable = !rider.abandoned && !stageLocked;
              const openIntention = openRiderId === rider.rider_id && editable;
              const openRole = openRoleRiderId === rider.rider_id && editable;
              const expanded = openIntention || openRole;
              return [
                <tr key={rider.rider_id} className={`border-b border-cz-border ${expanded ? "" : "last:border-0"}`}>
                  <td className="px-4 py-2.5 align-top text-cz-1 font-medium">{rider.name || "—"}</td>
                  <td className="px-4 py-2.5 align-top">{renderRoleCell(rider)}</td>
                  <td className="px-4 py-2.5 align-top">{renderRouteMatchCell(rider)}</td>
                  <td className="px-4 py-2.5 align-top">{renderIntentionCell(rider)}</td>
                  {showOrders && <td className="px-4 py-2.5 align-top">{renderOrdersCell(rider)}</td>}
                </tr>,
                expanded ? (
                  <tr key={`${rider.rider_id}-picker`} className="border-b border-cz-border last:border-0 bg-cz-subtle">
                    <td colSpan={showOrders ? 5 : 4} className="px-4 pb-3.5 pt-0">
                      {openRole ? (
                        <RolePicker
                          t={t}
                          riderName={rider.name}
                          {...rolePickerScope}
                          value={roleFor(rider)}
                          disabled={saving}
                          onPick={(role) => pickRole(rider.rider_id, role)}
                        />
                      ) : (
                        <IntentionPicker
                          t={t}
                          riderName={rider.name}
                          role={roleFor(rider)}
                          scopeLabel={scopeLabel}
                          steps={steps}
                          timeTrial={isIndividualTimeTrialProfile(stageProfileType)}
                          value={effortFor(rider)}
                          disabled={saving}
                          onPick={(step) => pickIntention(rider.rider_id, step)}
                          blockedFor={(step) => effortBlockedKey(rider, step)}
                        />
                      )}
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
      )}

      {!stagePlanOn && (
      <ul className="sm:hidden divide-y divide-cz-border">
        {visibleRiders.map((rider) => {
          const editable = !rider.abandoned && !stageLocked;
          const openIntention = openRiderId === rider.rider_id && editable;
          const openRole = openRoleRiderId === rider.rider_id && editable;
          return (
            <li key={rider.rider_id} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-cz-1 font-medium text-sm min-w-0 truncate">{rider.name || "—"}</span>
                {/* Kun tallet paa mobil — ingen bar, ingen vandret scroll. Det
                    korte ord raekker: etapen staar allerede i vaelgeren og i
                    profil-raekken lige ovenfor. */}
                <span className="flex items-baseline gap-1.5 whitespace-nowrap shrink-0">
                  <span className="text-3xs uppercase tracking-wider text-cz-3">{t("selection.routeMatch")}</span>
                  {renderRouteMatchCell(rider, { numberOnly: true })}
                </span>
              </div>
              <div className="mt-0.5">{renderRoleCell(rider)}</div>
              <div className="mt-2">{renderIntentionCell(rider)}</div>
              {showOrders && <div className="mt-2">{renderOrdersCell(rider)}</div>}
              {openRole && (
                <div className="mt-2.5">
                  <RolePicker
                    t={t}
                    riderName={rider.name}
                    {...rolePickerScope}
                    value={roleFor(rider)}
                    disabled={saving}
                    onPick={(role) => pickRole(rider.rider_id, role)}
                  />
                </div>
              )}
              {openIntention && (
                <div className="mt-2.5">
                  <IntentionPicker
                    t={t}
                    riderName={rider.name}
                    role={roleFor(rider)}
                    scopeLabel={scopeLabel}
                    steps={steps}
                    timeTrial={isIndividualTimeTrialProfile(stageProfileType)}
                    value={effortFor(rider)}
                    disabled={saving}
                    onPick={(step) => pickIntention(rider.rider_id, step)}
                    blockedFor={(step) => effortBlockedKey(rider, step)}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      )}

      {stageLocked ? (
        <p className="px-4 py-3 border-t border-cz-border text-3xs text-cz-3 flex items-center gap-1.5">
          <LockIcon size={12} aria-hidden="true" /> {t("tacticsOrders.lockedNote")}
        </p>
      ) : (
        <div className="px-4 py-3 border-t border-cz-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-xs text-cz-3 tabular-nums">
              {untouchedLine ? `${footerLine} · ${untouchedLine}` : footerLine}
            </p>
            {status === "error" && errorKey && (
              <p className="text-xs text-cz-danger">
                {t([`intention.errors.${errorKey}`, "intention.errors.generic"])}
              </p>
            )}
            {status === "saved" && <p className="text-xs text-cz-success">{t("intention.saved")}</p>}
            {status === "idle" && dirty && <p className="text-xs text-cz-2">{t("intention.unsaved")}</p>}
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            {nextStage != null && (
              <Button variant="secondary" size="sm" disabled={saving} onClick={copyToNextStage}>
                {t("intention.copyToStage", { number: nextStage })}
              </Button>
            )}
            <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={save}>
              {saving
                ? t("intention.saving")
                : isOneDay
                  ? t("intention.saveRaceDay")
                  : t("intention.save", { number: activeStage })}
            </Button>
          </div>
        </div>
      )}
    </section>
    </>
  );
}
