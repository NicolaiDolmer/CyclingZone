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
// Intentionens PUT er REPLACE for ALT over stages_completed — derfor sendes
// hele diffen for de redigerbare etaper, ikke kun den åbne. Et gem af etape 4
// må aldrig slette etape 5's intention.
//
// FOG OF WAR: ingen tal, ingen procenter, ingen loft-signaler. Trinnene kommer
// fra serverens `valid_efforts`, aldrig fra en hardkodet liste her.

import { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import i18n from "i18next";
import { authHeaders } from "../../lib/supabase"; // #4348: kanonisk kopi
import { profileLabelKey } from "../../lib/stageProfileConfig.js";
import { formatLocalTime } from "../../lib/intl.js";
import { LockIcon, CheckIcon, Button, Section, SectionHeader, SkeletonLines } from "../ui/index.js";
import {
  buildDraftMatrix,
  diffToOverrides,
  isDirty,
  overridesIndex,
  resolveCell,
} from "../../lib/stageRoleMatrixLogic.js";
import {
  DEFAULT_EFFORT,
  orderedEfforts,
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
} from "../../lib/tacticsPlan.js";
import { fetchTeamOrders, orderForStage, saveTacticsCard } from "../../lib/tacticsOrdersAdapter.js";
import { isStageLockedForTactics, firstOpenStage } from "../../lib/racePageTabs.js";

const API = import.meta.env.VITE_API_URL;

// Rollens navn i kolonnen. Ét sæt labels for hele fladen (tacticsOrders.roleLabel
// er SSOT'ens ord — "Domestique", ikke "Rider", jf. RACE_ENGINE_RULES §1).
const ROLE_KEY = {
  captain: "captain",
  sprint_captain: "sprint_captain",
  hunter: "hunter",
  helper: "helper",
  free_role: "free_role",
};
const roleKey = (role) => ROLE_KEY[role] || "helper";

function stageLockTime(scheduledAt) {
  if (!scheduledAt) return null;
  const d = new Date(scheduledAt);
  if (Number.isNaN(d.getTime())) return null;
  const weekday = new Intl.DateTimeFormat(i18n.language || "en", { weekday: "short" }).format(d);
  return `${weekday} ${formatLocalTime(d)}`;
}

// Chip: valgt intention (guld-tekst på tonet flade) vs. "ikke valgt" (stiplet
// hairline, dæmpet). To tilstande, ingen tredje.
function IntentionChip({ t, effort, isDefault, muted = false }) {
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
      {t(`intention.step.${effort}`)}
    </span>
  );
}

// Den udfoldede vælger: ét trin pr. linje, én sætning i ord, ingen tal.
function IntentionPicker({ t, riderName, scopeLabel, steps, value, disabled, onPick }) {
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
        return (
          <button
            key={step}
            type="button"
            disabled={disabled}
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
              {t(`intention.step.${step}`)}
            </span>
            <span className="text-xs text-cz-2 basis-full sm:basis-auto ps-[26px] sm:ps-0">
              {t(`intention.why.${step}`)}
            </span>
            {step === DEFAULT_EFFORT && (
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

function TogglePill({ label, ariaLabel, active, disabled, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-cz border px-2 py-1 text-3xs font-medium uppercase tracking-wide transition-colors flex-shrink-0 disabled:opacity-60 disabled:pointer-events-none
        ${active ? "border-cz-accent bg-cz-accent/10 text-cz-accent-t" : "border-cz-accent/40 text-cz-accent-t bg-transparent hover:bg-cz-accent/5"}`}
    >
      {/* Fluebenets plads reserveres altid: uden det skifter pillens BREDDE naar
          den slaas til, og hele knap-kolonnen hopper sidelaens. */}
      <CheckIcon size={10} aria-hidden="true" className={active ? "" : "invisible"} />
      {label}
    </button>
  );
}

export default function RaceTacticsTab({ raceId, profileByStage = {}, showOrders = true }) {
  const { t } = useTranslation("races");
  // null = henter, false = hentningen fejlede. At skelne dem er hele pointen:
  // en fejlet fetch maa ikke vises som "ingen taktik sat" (#2849).
  const [roles, setRoles] = useState(null);
  const [orders, setOrders] = useState(null);
  const [draftMatrix, setDraftMatrix] = useState({});
  const [initialMatrix, setInitialMatrix] = useState({});
  const [ordersByStage, setOrdersByStage] = useState({});
  const [initialOrdersByStage, setInitialOrdersByStage] = useState({});
  const [activeStage, setActiveStage] = useState(null);
  const [openRiderId, setOpenRiderId] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | saving | saved | error
  const [errorKey, setErrorKey] = useState(null);

  const load = useCallback(async () => {
    const headers = await authHeaders({ json: false });
    if (!headers) { setRoles(false); return; }
    let rolesBody = null;
    let orderCtx = null;
    try {
      const [rolesRes, orderResult] = await Promise.all([
        fetch(`${API}/api/races/${raceId}/stage-roles`, { headers }),
        fetchTeamOrders({ raceId }).catch(() => null),
      ]);
      if (!rolesRes.ok) { setRoles(false); return; }
      rolesBody = await rolesRes.json();
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
    for (const sn of stageNumbers) seededOrders[sn] = orderForStage(orderCtx, sn);

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
      return firstOpenStage(list);
    });
    // NB: status/errorKey nulstilles bevidst IKKE her — "Gemt"-kvitteringen
    // (sat af save() lige før den awaiter load()) må ikke overskrives.
  }, [raceId]);

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
  const steps = useMemo(() => orderedEfforts(roles?.valid_efforts), [roles?.valid_efforts]);
  const riders = useMemo(() => roles?.riders ?? [], [roles?.riders]);
  const lockedOverrides = useMemo(() => overridesIndex(roles?.overrides), [roles?.overrides]);

  const counts = useMemo(
    () => stageIntentionCounts({ matrix: draftMatrix, riders, stageNumber: activeStage }),
    [draftMatrix, riders, activeStage],
  );
  const untouched = useMemo(
    () => untouchedStages({ matrix: draftMatrix, riders, editableStages, exceptStage: activeStage }),
    [draftMatrix, riders, editableStages, activeStage],
  );

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
  const order = ordersByStage[activeStage] ?? orderForStage(orders, activeStage);
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

  function updateOrder(transform) {
    setOrdersByStage((cur) => ({ ...cur, [activeStage]: transform(cur[activeStage] ?? order) }));
    if (status !== "idle") setStatus("idle");
  }

  function copyToNextStage() {
    if (nextStage == null) return;
    setDraftMatrix((m) => copyStageIntentions({ matrix: m, fromStage: activeStage, toStage: nextStage, riders }));
    // Ordrerne kopieres med: "kopiér til etape N+1" skal flytte HELE dagens
    // plan, ikke halvdelen af den. Etapen der kopieres TIL skal stadig gemmes
    // selv (den er en anden etapes PUT).
    setOrdersByStage((cur) => ({ ...cur, [nextStage]: { ...(cur[activeStage] ?? order) } }));
    if (status !== "idle") setStatus("idle");
  }

  function openStage(stageNumber) {
    setActiveStage(stageNumber);
    setOpenRiderId(null);
  }

  async function save() {
    if (stageLocked) return;
    const headers = await authHeaders();
    if (!headers) return;
    setStatus("saving");
    setErrorKey(null);
    try {
      // 1) Intentionen: hele diffen for de redigerbare etaper (REPLACE-semantik).
      const overrides = diffToOverrides({ matrix: draftMatrix, riders });
      const res = await fetch(`${API}/api/races/${raceId}/stage-roles`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ overrides }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setErrorKey(body.error || "generic");
        return;
      }
      // 2) Ordrerne for DEN ÅBNE etape (endpointet er én-etape-scopet). Springes
      // over når ordre-halvdelen er gated væk — så gemmer fanen kun det
      // spilleren faktisk kunne se og røre.
      if (showOrders) await saveTacticsCard({ raceId, stage: activeStage, order });
      setStatus("saved");
      setOpenRiderId(null);
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

  const captain = riders.find((r) => baseRoleForRider(r) === "captain") || null;
  const plan = teamPlanKey(order.breakaway_stance, captain?.name ?? null);
  const teamHasSprintCaptain = hasSprintCaptain(riders.map((r) => ({ role: baseRoleForRider(r) })));
  const sprintCaptain = riders.find((r) => baseRoleForRider(r) === "sprint_captain") || null;
  const orderByRider = new Map((order.riders ?? []).map((r) => [r.rider_id, r]));
  const leadoutCount = (order.riders ?? []).filter((r) => r.leadout).length;

  // Én rytters intention på den åbne etape. Låste etaper har ingen draft-celle
  // (buildDraftMatrix dækker kun de redigerbare) — de læses direkte af de
  // gemte overrides, så "det du sendte dem ud med" er sandt.
  const effortFor = (rider) => (stageLocked
    ? resolveCell({ rider, stageNumber: activeStage, overridesMap: lockedOverrides }).effort
    : intentionFor({ matrix: draftMatrix, stageNumber: activeStage, riderId: rider.rider_id }));

  // Rene render-funktioner, IKKE nestede komponenter: en komponent defineret
  // inde i render remountes ved hver tastetryk-render (React ser en ny type),
  // hvilket ville lukke den udfoldede vaelger under fingeren.
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
    if (stageLocked) {
      return (
        <>
          <IntentionChip t={t} effort={effort} isDefault={isDefault} muted />
          <p className="mt-1 text-3xs text-cz-3">
            {isDefault
              ? t("intention.nothingSet")
              : isOneDay
                ? t("racePage.tactics.whatYouSetRaceDay", { today: t(`intention.today.${effort}`) })
                : t("racePage.tactics.whatYouSet", { number: activeStage, today: t(`intention.today.${effort}`) })}
          </p>
        </>
      );
    }
    return (
      <>
        <div className="flex items-center gap-2.5 flex-wrap">
          <IntentionChip t={t} effort={effort} isDefault={isDefault} />
          <button
            type="button"
            disabled={saving}
            aria-expanded={open}
            onClick={() => setOpenRiderId(open ? null : rider.rider_id)}
            className="text-xs font-medium text-cz-accent-t hover:underline disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {open ? t("intention.close") : t(isDefault ? "intention.setIntention" : "intention.change")}
          </button>
        </div>
        <p className="mt-1 text-3xs text-cz-3">
          {isDefault
            ? t("intention.nothingSet")
            : t("intention.line", {
                role: t(`intention.roleWord.${baseRoleForRider(rider)}`),
                today: t(`intention.today.${effort}`),
              })}
        </p>
      </>
    );
  }

  function renderOrdersCell(rider) {
    const id = rider.rider_id;
    const ro = orderByRider.get(id) || roleDefaultFor(orders?.defaultOrder, id);
    if (stageLocked || rider.abandoned) {
      return (
        <span className="inline-flex items-center gap-1 text-3xs text-cz-3">
          <LockIcon size={11} aria-hidden="true" />
          {t("racePage.tactics.locked")}
        </span>
      );
    }
    const isSprintCaptain = baseRoleForRider(rider) === "sprint_captain";
    return (
      <span className="flex flex-wrap items-center gap-2">
        <TogglePill
          label={t("tacticsOrders.tryBreak")}
          ariaLabel={t("tacticsOrders.tryBreakAria", { name: rider.name || "—" })}
          active={ro.try_break === true}
          disabled={saving}
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
              disabled={saving || isSprintCaptain}
              onClick={() => updateOrder((o) => toggleLeadout(o, id))}
            />
          </span>
        )}
      </span>
    );
  }

  return (
    <section data-testid="race-tactics-tab" className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
      <div className="px-4 py-3 border-b border-cz-border flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold text-cz-1 text-sm">{t("racePage.tactics.title")}</h2>
          <p className="text-cz-3 text-xs mt-0.5">{t(isOneDay ? "racePage.tactics.helpRaceDay" : "racePage.tactics.help")}</p>
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
              const isToday = stagesCompleted > 0 && sn === stagesCompleted + 1;
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
      {showOrders && (
      <div className="px-4 py-3 border-b border-cz-border grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <p className="text-3xs uppercase tracking-wide text-cz-3">{t("tacticsOrders.planLabel")}</p>
          <p className="text-xs text-cz-1 mt-0.5 leading-snug">{t(plan.key, plan.params)}</p>
        </div>
        <div>
          <p className="text-3xs uppercase tracking-wide text-cz-3 mb-1">{t("tacticsOrders.breakawayLabel")}</p>
          <div role="group" aria-label={t("tacticsOrders.breakawayAria")} className="flex rounded-cz border border-cz-border overflow-hidden w-fit">
            {BREAKAWAY_STANCES.map((stance) => (
              <button
                key={stance}
                type="button"
                disabled={stageLocked || saving}
                aria-pressed={order.breakaway_stance === stance}
                onClick={() => updateOrder((o) => setBreakawayStance(o, stance))}
                className={`px-2 py-1 text-3xs font-medium transition-colors disabled:opacity-60 disabled:pointer-events-none
                  ${order.breakaway_stance === stance ? "bg-cz-accent/10 text-cz-accent-t" : "bg-cz-card text-cz-2 hover:text-cz-1"}`}
              >
                {t(`tacticsOrders.breakaway.${stance}`)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-3xs uppercase tracking-wide text-cz-3">{t("tacticsOrders.leadout")}</p>
          <p className="text-xs text-cz-1 mt-0.5 leading-snug">
            {teamHasSprintCaptain
              ? t("racePage.tactics.sprintTrainRiders", { count: leadoutCount, name: sprintCaptain?.name || "—" })
              : t("racePage.tactics.sprintTrainNone")}
          </p>
        </div>
      </div>
      )}

      {/* Desktop: tabel. Under sm: stablede kort (samme indhold, ingen vandret
          scroll — siden må aldrig overflowe på mobil, #1834). */}
      <div className="hidden sm:block overflow-x-auto">
        <table data-sort-exempt="Taktik-listen foelger holdets udtagelses-raekkefoelge, ikke en sorterbar kolonne" className="w-full text-sm">
          <thead>
            <tr className="border-b border-cz-border">
              <th className="px-4 py-2 text-left font-medium text-xs uppercase tracking-wide text-cz-3">{t("intention.colRider")}</th>
              <th className="px-4 py-2 text-left font-medium text-xs uppercase tracking-wide text-cz-3">{t("intention.colRole")}</th>
              <th className="px-4 py-2 text-left font-medium text-xs uppercase tracking-wide text-cz-3">{intentionColumn}</th>
              {showOrders && <th className="px-4 py-2 text-left font-medium text-xs uppercase tracking-wide text-cz-3">{ordersColumn}</th>}
            </tr>
          </thead>
          <tbody>
            {riders.map((rider) => {
              const open = openRiderId === rider.rider_id && !rider.abandoned && !stageLocked;
              return [
                <tr key={rider.rider_id} className={`border-b border-cz-border ${open ? "" : "last:border-0"}`}>
                  <td className="px-4 py-2.5 align-top text-cz-1 font-medium">{rider.name || "—"}</td>
                  <td className="px-4 py-2.5 align-top">
                    <div className="text-cz-1 text-xs">{t(`tacticsOrders.roleLabel.${roleKey(baseRoleForRider(rider))}`)}</div>
                    <div className="text-3xs uppercase tracking-wider text-cz-3 mt-0.5">{roleScope}</div>
                  </td>
                  <td className="px-4 py-2.5 align-top">{renderIntentionCell(rider)}</td>
                  {showOrders && <td className="px-4 py-2.5 align-top">{renderOrdersCell(rider)}</td>}
                </tr>,
                open ? (
                  <tr key={`${rider.rider_id}-picker`} className="border-b border-cz-border last:border-0 bg-cz-subtle">
                    <td colSpan={showOrders ? 4 : 3} className="px-4 pb-3.5 pt-0">
                      <IntentionPicker
                        t={t}
                        riderName={rider.name}
                        scopeLabel={scopeLabel}
                        steps={steps}
                        value={effortFor(rider)}
                        disabled={saving}
                        onPick={(step) => pickIntention(rider.rider_id, step)}
                      />
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>

      <ul className="sm:hidden divide-y divide-cz-border">
        {riders.map((rider) => {
          const open = openRiderId === rider.rider_id && !rider.abandoned && !stageLocked;
          return (
            <li key={rider.rider_id} className="px-4 py-3">
              <div className="text-cz-1 font-medium text-sm">{rider.name || "—"}</div>
              <div className="mt-0.5 flex items-baseline gap-2 flex-wrap">
                <span className="text-xs text-cz-1">{t(`tacticsOrders.roleLabel.${roleKey(baseRoleForRider(rider))}`)}</span>
                <span className="text-3xs uppercase tracking-wider text-cz-3">{roleScope}</span>
              </div>
              <div className="mt-2">{renderIntentionCell(rider)}</div>
              {showOrders && <div className="mt-2">{renderOrdersCell(rider)}</div>}
              {open && (
                <div className="mt-2.5">
                  <IntentionPicker
                    t={t}
                    riderName={rider.name}
                    scopeLabel={scopeLabel}
                    steps={steps}
                    value={effortFor(rider)}
                    disabled={saving}
                    onPick={(step) => pickIntention(rider.rider_id, step)}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

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
  );
}
