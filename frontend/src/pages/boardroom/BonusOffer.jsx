import { useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { Button } from "../../components/ui";
import { formatNumber } from "../../lib/intl";
import { getBoardGoalLabel } from "../../lib/boardGoalLabel";
import { formatShortDate } from "./boardroomFormat";
import { postBonusOfferAction } from "../../components/board/bonusOfferApi.js";

// #4557 (overblik + faner) · Bonustilbuddet, lag 6 (BOARD_RULES §4).
//
// Tilbuddet havde intet hjem paa den nye Boardroom-side (ejer-noten "bonustilbud-
// hullet" paa #4557). Det bor nu to steder, samme raekke, samme endpoints:
//  · `BonusOfferStripe` — én stribe INDE i mandat-resuméet paa overblikket.
//  · `BonusOfferBlock`  — hele tilbuddet i Mandat-fanen (mockup 6/9).
// Begge kalder de EKSISTERENDE POST /board/bonus-offer/{accept,decline} via
// components/board/bonusOfferApi.js. Ingen ny mekanik, ingen ny rute.
//
// Guld-rationering (TASTE P3 / PAGE_TEMPLATES): sidens ene guld-knap er
// "Enter annual meeting" i sidehovedet, saa "Accept offer" er secondary og
// "Decline" er en quiet action begge steder.

export function formatCz(value) {
  return `${formatNumber(Number(value || 0))} CZ$`;
}

/** Ekstra-maalets titel gennem den kanoniske resolver (aldrig raa DB-dansk paa EN). */
export function resolveBonusGoalLabel(t, extraGoal) {
  const label = getBoardGoalLabel(t, {
    type: extraGoal?.type ?? null,
    target: extraGoal?.target ?? null,
    label: extraGoal?.label ?? "",
  });
  return label || t("bonusOffer.defaultGoal");
}

/**
 * Delt accept/afslag-tilstand. `onResolved` skal genhente Boardroom-payloaden,
 * saa striben forsvinder (afslag) eller skifter til kvitterings-linjen (accept).
 */
function useBonusOfferActions({ offer, onResolved }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run(action) {
    if (!offer?.id || busy) return;
    setBusy(true);
    setFailed(false);
    const { ok } = await postBonusOfferAction(action, offer.id);
    if (!ok) {
      setFailed(true);
      setBusy(false);
      return;
    }
    await onResolved?.();
    setBusy(false);
  }

  return { busy, failed, accept: () => run("accept"), decline: () => run("decline") };
}

function OfferActions({ busy, onAccept, onDecline, t }) {
  return (
    <div className="flex flex-shrink-0 items-center gap-3.5">
      <Button variant="secondary" size="sm" onClick={onAccept} loading={busy}>
        {t("bonusOffer.accept")}
      </Button>
      <button
        type="button"
        onClick={onDecline}
        disabled={busy}
        className="text-xs font-medium text-cz-accent-t transition-colors hover:underline disabled:opacity-50"
      >
        {t("bonusOffer.decline")}
      </button>
    </div>
  );
}

/** Overblikkets én-linjes stribe, inde i mandat-resumékortet. */
export function BonusOfferStripe({ offer, onResolved }) {
  const { t } = useTranslation("board");
  const { busy, failed, accept, decline } = useBonusOfferActions({ offer, onResolved });
  if (!offer || offer.status !== "active") return null;

  return (
    <div className="mt-3.5 rounded-cz border border-cz-border bg-cz-subtle px-3 py-2.5">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <p className="min-w-0 text-[13px] text-cz-2">
          <span className="font-medium text-cz-1">{t("boardroom.bonusOffer.lead")}</span>{" "}
          <span className="font-data font-semibold tabular-nums text-cz-success">+{formatCz(offer.amount)}</span>{" "}
          {t("boardroom.bonusOffer.stripeDetail", { goal: resolveBonusGoalLabel(t, offer.extraGoal) })}
        </p>
        <OfferActions busy={busy} onAccept={accept} onDecline={decline} t={t} />
      </div>
      {failed && <p className="mt-2 text-2xs text-cz-danger">{t("boardroom.bonusOffer.actionFailed")}</p>}
    </div>
  );
}

/** Mandat-fanens fulde tilbuds-blok (mockup 6/9, "Bonus offer from the board"). */
export function BonusOfferBlock({ offer, seasonNumber, onResolved }) {
  const { t } = useTranslation("board");
  const { busy, failed, accept, decline } = useBonusOfferActions({ offer, onResolved });
  if (!offer || offer.status !== "active") return null;

  return (
    <div className="mt-4 rounded-cz border border-cz-border bg-cz-subtle px-3.5 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13.5px] font-medium text-cz-1">{t("bonusOffer.heading")}</p>
        {seasonNumber != null && (
          <span className="font-data text-2xs uppercase tracking-[.08em] text-cz-3">
            {t("boardroom.bonusOffer.expires", { season: seasonNumber })}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-cz-2">
        <Trans
          i18nKey="board:bonusOffer.body"
          values={{ cash: formatCz(offer.amount), goal: resolveBonusGoalLabel(t, offer.extraGoal) }}
          components={{
            bonus: <span className="font-data font-semibold tabular-nums text-cz-success" />,
            goal: <span className="font-medium text-cz-1" />,
          }}
        />
      </p>
      <p className="mt-2 text-xs leading-relaxed text-cz-3">{t("bonusOffer.footer")}</p>
      <div className="mt-3">
        <OfferActions busy={busy} onAccept={accept} onDecline={decline} t={t} />
      </div>
      {failed && <p className="mt-2 text-2xs text-cz-danger">{t("boardroom.bonusOffer.actionFailed")}</p>}
    </div>
  );
}

/**
 * Kvitteringen efter accept. Vises baade paa overblikket og i Mandat-fanen, og
 * bygger KUN paa felter der findes: rækkens `resolved_at` + `severity`.
 * Ekstra-maalet selv dukker op som en almindelig maal-raekke med "Bonus"-maerkat
 * naar mandatet baerer det (`goal.source === "bonus_offer"`, se boardRoom.js).
 */
export function BonusAcceptedLine({ offer, className = "" }) {
  const { t } = useTranslation("board");
  if (!offer || offer.status !== "accepted") return null;
  return (
    <p className={`text-xs leading-relaxed text-cz-2 ${className}`.trim()}>
      {offer.acceptedAt
        ? t("boardroom.bonusOffer.acceptedOn", {
          date: formatShortDate(offer.acceptedAt),
          cash: formatCz(offer.amount),
        })
        : t("boardroom.bonusOffer.accepted", { cash: formatCz(offer.amount) })}
    </p>
  );
}
