import { useState } from "react";
import { useTranslation } from "react-i18next";
import AmountInput from "../../ui/AmountInput.jsx";
import Button from "../../ui/Button.jsx";
import { Segmented } from "../../ui/Segmented.jsx";
import { AlertTriangleIcon } from "../../ui/icons/index.jsx";
import { formatCz } from "../../../lib/marketValues.js";
import { retirementBidWarningTier } from "../../../lib/riderAge.js";
import BidConfirmDialog8016 from "./BidConfirmDialog8016.tsx";
import {
  checkChoice,
  initialChoice,
  issueMessage,
  primaryLabelKey,
  summaryFor,
} from "./buyerCardModel.ts";
import type { BuyerMode } from "./buyerCardModel.ts";

// #8016 variant B (ejer-go 15/11): koebers kort paa en transferliste med auto-pris.
// Eet kort med valget oeverst, eet beloebsfelt, en opsummering der siger hvad der
// sker, og een guld-knap hvis tekst foelger valget. Kun bag auto_accept_enabled
// (TransfersPage viser det kun, naar kontakten er taendt og listen har en
// auto-pris). Kaldene er de samme som foer: et bud gaar til POST /transfers/offer,
// en auktion aabner den eksisterende auktionsbekraeftelse.

export type BuyerListing = {
  id: string;
  asking_price: number;
  auto_accept_price: number;
  rider?: { id: string; firstname: string; lastname: string; birthdate?: string | null } | null;
};

export type AuctionDraft = { bid: number; duration: number };

type Props = {
  listing: BuyerListing;
  seasonYear: number | null | undefined;
  onOffer: (riderId: string | undefined, amount: number, message: string, doneText: string) => Promise<unknown>;
  onStartAuction: (listing: BuyerListing, draft: AuctionDraft) => void;
};

const FIELD =
  "block w-full min-h-11 rounded-cz border border-cz-border bg-cz-card px-3 py-2 text-cz-1 font-data tabular-nums text-base sm:text-sm focus:outline-hidden focus:border-cz-accent";

export default function BuyerCard8016({ listing, seasonYear, onOffer, onStartAuction }: Props) {
  // "auctions" hentes med her, saa pensions-advarslen i bud-bekraeftelsen er klar.
  const { t } = useTranslation(["transfers", "auctions"]);
  const autoPrice = Number(listing.auto_accept_price);
  const start = initialChoice(listing.asking_price, autoPrice);
  const [mode, setMode] = useState<BuyerMode>(start.mode);
  const [amount, setAmount] = useState<number | null>(start.amount);
  const [touched, setTouched] = useState(false);
  const [message, setMessage] = useState("");
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("30");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const riderName = listing.rider ? `${listing.rider.firstname} ${listing.rider.lastname}` : "";
  const id = `buyer-${listing.id}`;
  const check = checkChoice({ mode, amount, autoPrice, hours, minutes });
  // Et beloeb der hoerer til det andet valg vises straks; et tomt felt foerst naar det er roert.
  const showIssue = !!check.issue && (check.issue.code !== "empty" || touched);
  const issueText = check.issue
    ? (() => {
        const m = issueMessage(check.issue);
        return t(`transfers:${m.key}`, m.price === null ? {} : { price: formatCz(m.price) });
      })()
    : "";
  const summary = !check.issue && amount ? summaryFor({ mode, amount, hours, minutes }) : null;

  function submit() {
    if (check.issue || !amount) {
      setTouched(true);
      return;
    }
    if (mode === "bid") setConfirmOpen(true);
    else if (summary?.length) onStartAuction(listing, { bid: amount, duration: summary.length.hours * 60 + summary.length.minutes });
  }

  async function sendBid() {
    if (!amount || sending) return;
    setSending(true);
    try {
      await onOffer(
        listing.rider?.id,
        amount,
        message,
        t("transfers:buyerCard.doneBid", { amount: formatCz(amount), rider: riderName }),
      );
      setConfirmOpen(false);
    } finally {
      setSending(false);
    }
  }

  const segment = (title: string, terms: string) => (
    <span className="block py-0.5 text-left">
      <span className="block text-sm font-semibold">{title}</span>
      <span className="block text-2xs font-normal text-cz-2">{terms}</span>
    </span>
  );

  return (
    <div className="space-y-3" data-testid="buyer-card-8016">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-cz bg-cz-subtle px-3 py-2.5" data-testid="listing-auto-price">
        <div>
          <p className="text-2xs uppercase tracking-[.06em] text-cz-3">{t("transfers:autoAccept.autoPrice")}</p>
          <p className="font-data text-2xl font-bold tabular-nums text-cz-1">{formatCz(autoPrice)}</p>
        </div>
        <p className="min-w-48 flex-1 text-xs text-cz-2">{t("transfers:buyerCard.autoMeaning")}</p>
      </div>

      <Segmented
        label={t("transfers:buyerCard.choiceLabel")}
        value={mode}
        onChange={(next: BuyerMode) => setMode(next)}
        className="!flex w-full [&>button]:flex-1 [&>button+button]:border-l [&>button+button]:border-cz-border"
        options={[
          { value: "bid", label: segment(t("transfers:buyerCard.segBid"), t("transfers:buyerCard.segBidTerms")) },
          { value: "auction", label: segment(t("transfers:buyerCard.segAuction"), t("transfers:buyerCard.segAuctionTerms")) },
        ]}
      />

      <div>
        <label htmlFor={`${id}-amount`} className="mb-1 block text-xs font-semibold text-cz-1">
          {t(mode === "bid" ? "transfers:buyerCard.amountBid" : "transfers:buyerCard.amountAuction")}
        </label>
        <AmountInput
          id={`${id}-amount`}
          value={amount}
          placeholder={undefined}
          errorMessage={undefined}
          onValueChange={(value: number | null) => {
            setAmount(value);
            setTouched(true);
          }}
          aria-invalid={showIssue || undefined}
          aria-describedby={`${id}-check`}
          className={FIELD}
        />
        <div id={`${id}-check`} aria-live="polite">
          {showIssue && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-cz-danger" data-testid="buyer-card-error">
              <AlertTriangleIcon size={14} className="mt-px shrink-0" aria-hidden="true" />
              <span>{issueText}</span>
            </p>
          )}
          {showIssue && check.switchTo && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              fullWidth
              className="mt-2"
              onClick={() => setMode(check.switchTo as BuyerMode)}
            >
              {t(check.switchTo === "auction" ? "transfers:buyerCard.switchToAuction" : "transfers:buyerCard.switchToBid")}
            </Button>
          )}
        </div>
      </div>

      {mode === "bid" ? (
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t("transfers:transferCard.messagePlaceholder")}
          aria-label={t("transfers:transferCard.messagePlaceholder")}
          className="block w-full min-h-11 rounded-cz border border-cz-border bg-cz-card px-3 py-2 text-base text-cz-1 sm:text-sm focus:outline-hidden focus:border-cz-accent"
        />
      ) : (
        <fieldset>
          <legend className="mb-1 text-xs font-semibold text-cz-1">{t("transfers:autoAccept.duration")}</legend>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-cz-3">
              {t("transfers:autoAccept.hours")}
              <input
                id={`${id}-hours`}
                type="number"
                min="0"
                max="24"
                step="1"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                aria-invalid={check.issue?.code === "duration" || undefined}
                className={FIELD}
              />
            </label>
            <label className="text-xs text-cz-3">
              {t("transfers:autoAccept.minutes")}
              <input
                id={`${id}-minutes`}
                type="number"
                min="0"
                max="59"
                step="1"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                aria-invalid={check.issue?.code === "duration" || undefined}
                className={FIELD}
              />
            </label>
          </div>
          <p className="mt-1 text-xs text-cz-3">{t("transfers:buyerCard.lengthHint")}</p>
        </fieldset>
      )}

      {summary && (
        <p className="border-t border-cz-border pt-3 text-sm text-cz-1" data-testid="buyer-card-summary">
          {t(`transfers:${summary.key}`, {
            amount: formatCz(summary.amount),
            length: summary.length
              ? t("transfers:buyerCard.length", { hours: summary.length.hours, minutes: summary.length.minutes })
              : "",
          })}
        </p>
      )}

      <Button type="button" variant="primary" fullWidth disabled={!!check.issue || sending} onClick={submit}>
        {t(`transfers:${primaryLabelKey(mode)}`)}
      </Button>

      {confirmOpen && amount && (
        <BidConfirmDialog8016
          riderName={riderName}
          amount={amount}
          retirementTier={retirementBidWarningTier(listing.rider?.birthdate, seasonYear)}
          busy={sending}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={sendBid}
        />
      )}
    </div>
  );
}
