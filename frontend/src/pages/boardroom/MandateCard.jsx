import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Section, SectionHeader, EmptyState, ClipboardIcon, ChevronDownIcon, ChevronUpIcon, Button } from "../../components/ui";
import { appendDate, formatGoalValue, formatShortDate, formatWeekdayShortDate, resolveGoalTitle } from "./boardroomFormat.js";
import MonogramAvatar from "../../components/MonogramAvatar";
import { logEvent } from "../../lib/logEvent";
import StatusPill from "./StatusPill.jsx";
import { BonusOfferBlock, BonusAcceptedLine } from "./BonusOffer.jsx";

// Kvittering — den ENESTE detalje-visning (spec-princip 2 "kvittering for
// alt"). Ingen ny mekanik i denne slice: "Discuss target" er bevidst no-op
// (årsmødet er S-M2c), derfor render som disabled i stedet for en dead-link.
//
// #4570-afstemning: backend kan endnu ikke levere "Last movement" pr. mål
// (lastMovementAt er null indtil videre) — linjen udelades da HELT (aldrig
// en tom linje) i stedet for at vise en halvfærdig kvittering.
function GoalReceipt({ receipt, t }) {
  if (!receipt) return null;
  const hasLastMovement = Boolean(receipt.lastMovementKey && receipt.lastMovementAt);
  const lines = [
    <span key="counted">
      <span className="font-semibold text-cz-1">{t("boardroom.mandate.receipt.countedPrefix")}</span>{" "}
      {t(receipt.countedKey, receipt.countedParams || {})}
    </span>,
  ];
  if (hasLastMovement) {
    lines.push(
      <span key="lastMovement">
        <span className="font-semibold text-cz-1">{t("boardroom.mandate.receipt.lastMovementPrefix")}</span>{" "}
        {/* #5633 · Replikken er maalejerens egne ord (samme person som
            "Vaegtet af" nedenfor), saa den staar i anfoerselstegn. */}
        {appendDate(
          `“${t(receipt.lastMovementKey, receipt.lastMovementParams || {})}”`,
          formatWeekdayShortDate(receipt.lastMovementAt),
        )}
      </span>,
    );
  }
  lines.push(
    <span key="weightedBy">
      {t("boardroom.mandate.receipt.weightedByPrefix", { name: receipt.weightedByName })}{" "}
      {t(receipt.weightedByLineKey, {})}
    </span>,
  );
  return (
    <div className="ms-10 mb-[13px] rounded-cz bg-cz-subtle px-3.5 py-3">
      <p className="text-xs leading-relaxed text-cz-2">
        {lines.reduce((acc, line, i) => (i === 0 ? [line] : [...acc, <br key={`br-${i}`} />, line]), [])}
      </p>
      <p className="mt-2">
        <button type="button" disabled aria-disabled="true"
          className="text-xs font-medium text-cz-3 cursor-not-allowed"
          title={t("boardroom.mandate.discussTargetDisabledHint")}>
          {t("boardroom.mandate.discussTarget")}
        </button>
      </p>
    </div>
  );
}

function GoalRow({ goal, t, expanded, onToggle }) {
  const canExpand = Boolean(goal.receipt);
  const Chevron = expanded ? ChevronUpIcon : ChevronDownIcon;
  return (
    <div className="border-t border-cz-border">
      <div
        role={canExpand ? "button" : undefined}
        tabIndex={canExpand ? 0 : undefined}
        onClick={canExpand ? onToggle : undefined}
        onKeyDown={canExpand ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } } : undefined}
        className={`flex items-center justify-between gap-3 py-[13px] ${canExpand ? "cursor-pointer" : ""}`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <MonogramAvatar sizeClass="h-7 w-7" initials={goal.owner?.initials} initialsClass="text-2xs" />
          <div className="min-w-0">
            {/* #5633 · [text-wrap:balance] fordeler linjebrud jaevnt i stedet for
                at laegge et enkelt ord alene paa sidste linje ("Maaltitler
                brydes ujaevnt", spillerrapport). Ren CSS, ingen ny mekanik. */}
            <p className="text-[13.5px] font-medium leading-snug text-cz-1 [text-wrap:balance]">
              {resolveGoalTitle(t, goal)}
              {goal.isStretch && (
                <span className="ms-1.5 rounded-cz-pill border border-cz-border px-[7px] py-px align-middle text-3xs font-semibold uppercase tracking-[.08em] text-cz-accent-t">
                  {t("boardroom.mandate.stretch")}
                </span>
              )}
              {/* #4557 - et accepteret bonustilbuds ekstra-maal (goal.source ===
                  "bonus_offer", stemplet af accept-routen) baerer sin egen
                  maerkat: det er bestyrelsens koeb, ikke et strakt mandat-maal. */}
              {goal.isBonus && (
                <span className="ms-1.5 rounded-cz-pill border border-cz-border px-[7px] py-px align-middle text-3xs font-semibold uppercase tracking-[.08em] text-cz-accent-t">
                  {t("boardroom.mandate.bonus")}
                </span>
              )}
            </p>
            <p className="font-data text-2xs uppercase tracking-[.06em] tabular-nums text-cz-3">
              {t("boardroom.mandate.achievedTarget", {
                achieved: formatGoalValue(goal.achievedDisplay, goal.type),
                target: formatGoalValue(goal.targetDisplay, goal.type),
              })}
            </p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <StatusPill status={goal.status} t={t} />
          {canExpand && <Chevron size={14} aria-hidden="true" className="text-cz-3" />}
        </div>
      </div>
      {expanded && <GoalReceipt receipt={goal.receipt} t={t} />}
    </div>
  );
}

// #5632 · Afstand til et bonustilbud (lag 6) + sponsoreffekten (lag 1) —
// spillerrapport: begge var synlige i det gamle rum (BoardPage.jsx's
// PassiveModifierLine/BonusOfferProgressLine) men forsvandt helt i det nye
// Boardroom. SAMME i18n-nøgler genbruges her (transparency.*), ikke ny copy —
// kun layoutet er tilpasset det nye korts stil.
function PassiveModifierLine({ info, t }) {
  if (!info) return null;
  // #5632 · IKKE et genopdaget "+"-fortegn her: transparency.passiveModifier.
  // {strong_boost,boost}-strengene baerer allerede et bogstaveligt "+" foer
  // {pct} (begge sprog), saa et ekstra fortegn fra JS gav "++10%" i det gamle
  // rum (BoardPage.jsx's PassiveModifierLine, samme bug, out of scope her).
  // penalty/strong_penalty har intet bogstaveligt fortegn, og pct er allerede
  // negativt, saa "{pct}%" bliver korrekt "-10%" uden hjaelp.
  return (
    <p className="mb-1 text-2xs text-cz-3">
      {t(`transparency.passiveModifier.${info.band}`, { pct: info.pct })}
    </p>
  );
}

function BonusOfferProgressLine({ progress, t }) {
  if (!progress) return null;
  if (progress.eligible) {
    return <p className="mb-1 text-2xs font-medium text-cz-success">{t("transparency.bonusOfferEligible")}</p>;
  }
  if (!progress.satisfaction_ok) {
    return (
      <p className="mb-1 text-2xs text-cz-3">
        {t("transparency.bonusOfferSatisfactionGap", { threshold: progress.satisfaction_threshold })}
      </p>
    );
  }
  if (progress.goals_gap != null && progress.goals_gap > 0) {
    return (
      <p className="mb-1 text-2xs text-cz-3">
        {t("transparency.bonusOfferClose", { count: progress.goals_gap })}
      </p>
    );
  }
  return null;
}

// #5754 · Neutral pil til det FORESLAAEDE mandats maal-liste — samme anatomi
// som StatusPill (rounded-cz-pill, px-2.5 py-[3px], text-2xs font-semibold),
// bevidst IKKE en ny status i StatusPill.jsx (den fil ejes af en anden lane).
// Gaar aldrig gennem STATUS_TONE's success/warning/danger-palet: et foreslaaet
// maal er hverken paa/foran/bagud endnu — det er slet ikke underskrevet.
function ProposedPill({ t }) {
  return (
    <span className="inline-block flex-shrink-0 rounded-cz-pill bg-cz-subtle px-2.5 py-[3px] text-2xs font-semibold text-cz-3">
      {t("boardroom.mandate.proposed.pill")}
    </span>
  );
}

// #5754 · Skrivebeskyttet raekke for et FORESLAAET maal (GET /board/meeting,
// endnu ikke underskrevet). Genbruger resolveGoalTitle (samme titel-resolver
// som det underskrevne kort), men /board/meeting sender maalet i backendens
// RAA snake_case-form (label_key, race_scope, nationality_code — se
// meetingFormat.js's samme note) i stedet for boardRoom.js's camelCase. Uden
// dette map-lag ville resolveGoalTitle miste label_key (den laeser kun
// goal.labelKey) og et navngivet maal uden `type` (fx "Giv N akademiryttere en
// debut") ville falde tilbage til en raa DB-label i stedet for den oversatte
// titel. Ingen achieved/target-linje og intet kvitterings-chevron: mandatet er
// ikke i gang endnu, saa der er intet talt endnu at vise.
function ProposedGoalRow({ goal, t }) {
  const titleSource = { ...goal, labelKey: goal.labelKey ?? goal.label_key ?? null };
  return (
    <div className="flex items-center justify-between gap-3 border-t border-cz-border py-[13px]">
      <div className="flex min-w-0 items-center gap-3">
        <MonogramAvatar sizeClass="h-7 w-7" initials={goal.owner?.initials} initialsClass="text-2xs" />
        <p className="min-w-0 text-[13.5px] font-medium leading-snug text-cz-1 [text-wrap:balance]">
          {resolveGoalTitle(t, titleSource)}
        </p>
      </div>
      <ProposedPill t={t} />
    </div>
  );
}

export default function MandateCard({ mandate, bonusOffer = null, bonusOfferProgress = null, passiveModifier = null, proposedMeeting = null, onReload }) {
  const { t } = useTranslation("board");
  const navigate = useNavigate();
  // #5633 · Var et enkelt `expandedId` (kun ÉT maal ad gangen). Spillerønske:
  // fold flere ud, eller alle/ingen ad gangen — se Set-baseret expandedIds +
  // "Expand all"/"Collapse all" nedenfor.
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const toggleGoal = (goal) => {
    // #4557 (S-M2d) · instrumentering (#1141) uændret: fyrer kun ved AABNING,
    // ligger UDENFOR updateren (React.StrictMode dobbelt-kalder updaters, se
    // ret-runde #4732).
    if (!expandedIds.has(goal.id)) logEvent("board_receipt_opened", { goalStatus: goal.status, surface: "boardroom" });
    setExpandedIds((cur) => {
      const next = new Set(cur);
      if (next.has(goal.id)) next.delete(goal.id); else next.add(goal.id);
      return next;
    });
  };

  // #5754 · [board] Mandat-launch C (ejer-go 25/9 kl. 19:45, valg A, billede
  // pin 9): intet aktivt mandat mellem saesonskiftet og aarsmoedets
  // underskrift skal ikke laengere vise et tomt rum, naar bestyrelsen allerede
  // HAR et forslag klar (GET /board/meeting, gemt af BoardroomPage). Findes
  // intet forslag heller (proposedMeeting.available er false/mangler),
  // uaendret fallback til den kanoniske EmptyState.
  const proposedMandate = proposedMeeting?.available ? proposedMeeting.mandate : null;
  if (!mandate && proposedMandate) {
    const proposedGoals = proposedMandate.goals || [];
    return (
      <Section>
        <SectionHeader
          title={t("boardroom.mandate.proposed.cardTitle", { season: proposedMandate.seasonNumber })}
          meta={t("boardroom.mandate.proposed.meta")}
        />
        <div>
          {proposedGoals.map((goal) => (
            <ProposedGoalRow key={goal.goalKey ?? goal.id} goal={goal} t={t} />
          ))}
        </div>
        <div className="mt-3.5 border-t border-cz-border pt-3.5">
          <Button variant="secondary" size="sm" onClick={() => navigate("/board/meeting")}>
            {t("boardroom.header.enterMeetingCta")}
          </Button>
        </div>
      </Section>
    );
  }

  if (!mandate) {
    return (
      <Section>
        <SectionHeader title={t("boardroom.mandate.cardTitleGeneric")} />
        <EmptyState
          icon={<ClipboardIcon size={26} aria-hidden="true" />}
          title={t("boardroom.mandate.empty.title")}
          description={t("boardroom.mandate.empty.description")}
        />
      </Section>
    );
  }

  const goals = mandate.goals || [];
  // #5633 · Kun maal MED en kvittering kan foldes ud (samme regel som
  // GoalRow's `canExpand`) — "Expand all" skal ikke laade tom for maal uden
  // en receipt, og vises kun naar der reelt er noget at folde ud/ind.
  const expandableGoalIds = goals.filter((g) => g.receipt).map((g) => g.id);
  const allExpanded = expandableGoalIds.length > 0
    && expandableGoalIds.every((id) => expandedIds.has(id));

  return (
    <Section>
      <SectionHeader
        title={t("boardroom.mandate.cardTitle", { season: mandate.seasonNumber })}
        meta={t("boardroom.mandate.goalsMeta", { count: goals.length, date: formatShortDate(mandate.signedAt) })}
      />
      {expandableGoalIds.length > 1 && (
        <div className="-mt-2 mb-2 flex justify-end">
          <button
            type="button"
            onClick={() => setExpandedIds(allExpanded ? new Set() : new Set(expandableGoalIds))}
            className="text-2xs font-medium text-cz-accent-t transition-colors hover:underline"
          >
            {t(allExpanded ? "boardroom.mandate.collapseAll" : "boardroom.mandate.expandAll")}
          </button>
        </div>
      )}
      <div>
        {goals.map((goal) => (
          <GoalRow
            key={goal.id}
            goal={goal}
            t={t}
            expanded={expandedIds.has(goal.id)}
            onToggle={() => toggleGoal(goal)}
          />
        ))}
      </div>

      {/* #5632 · afstand til NÆSTE tilbud + sponsoreffekten, lige over det
          eksisterende tilbud/striben (samme rækkefølge som det gamle rum). */}
      <div className="mt-3.5 border-t border-cz-border pt-3">
        <PassiveModifierLine info={passiveModifier} t={t} />
        <BonusOfferProgressLine progress={bonusOfferProgress} t={t} />
      </div>

      {/* #4557 - bonustilbuddet i fuld laengde (lag 6). Striben paa overblikket
          fører hertil; begge rammer de samme to endpoints. */}
      <BonusOfferBlock offer={bonusOffer} seasonNumber={mandate.seasonNumber} onResolved={onReload} />
      <BonusAcceptedLine offer={bonusOffer} className="mt-3.5 border-t border-cz-border pt-3" />
    </Section>
  );
}
