import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../ui/Modal.jsx";
import Button from "../ui/Button.jsx";
import RiderLink from "../RiderLink.jsx";
import { Flag } from "../Flag.jsx";
import { formatCz } from "../../lib/marketValues.js";
import { formatDateTime } from "../../lib/intl.js";
import {
  formatHour,
  utcToGameWallClock,
  windowHoursForWallClock,
} from "../../lib/auctionEndTime.js";
import { resolveApiError } from "../../lib/apiError.js";
import {
  autoAcceptEnd,
  reviewAutoAcceptEnd,
  validAutoBid,
  validTiming,
  readAutoAcceptErrorBody,
} from "../../lib/autoAccept2176.ts";
import type { AuctionTiming, AutoListing } from "../../lib/autoAccept2176.ts";
import ConfirmRows from "./buyerCard8016/ConfirmRows.tsx";
import { useReloadBlock, RELOAD_BLOCK_REASONS } from "../../lib/reloadGate.js";
export type { AutoListing } from "../../lib/autoAccept2176.ts";
type Result = {
  ok: boolean;
  data?: unknown;
};
type Props = {
  listing: AutoListing;
  timingConfig: AuctionTiming;
  now: Date;
  getNow: () => Date;
  // #8016 variant B: beloeb og laengde vaelges paa koebers kort; dialogen er
  // bekraeftelsen og viser hvad der sker, foer pengene bindes.
  bid: number;
  duration: number;
  onCancel: () => void;
  onSubmit: (request: {
    expected_rider_id: string;
    expected_price: number;
    bid_amount: number;
    duration_minutes: number;
    expected_end_at: string;
  }) => Promise<Result>;
  onRefresh: () => Promise<AutoListing | null>;
  // Resultatbeskeden efter en startet auktion (siger at det blev en auktion).
  onDone: (text: string) => void;
};
const SHOWN_END = { dateStyle: "full", timeStyle: "short", timeZone: "Europe/Copenhagen" } as const;
export default function AutoAcceptAuctionDialog({
  listing,
  timingConfig,
  now,
  getNow,
  bid,
  duration,
  onCancel,
  onSubmit,
  onRefresh,
  onDone,
}: Props) {
  const { t } = useTranslation("transfers");
  // #8016: beloebet kommer nu fra kortet, saa fokus staar paa en knap og ikke i et
  // felt; bekraeftelsen skal selv holde et release-drevet reload ude (#5159 B1).
  useReloadBlock(true, RELOAD_BLOCK_REASONS.DIALOG);
  const [current, setCurrent] = useState<AutoListing | null>(listing);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  // Shown when the end time moved under the player's first click (no request is sent).
  const [endUpdated, setEndUpdated] = useState(false);
  const latch = useRef(false);
  // Owner 10/11 ("confirm again"): after a rejected end time the server's clock is adopted,
  // so the shown end keeps moving with real time and the next click matches the server.
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const serverNow = () => new Date(getNow().getTime() + clockOffsetMs);
  const [reviewedNow, setReviewedNow] = useState(now);
  const previewNow = new Date(Math.max(now.getTime() + clockOffsetMs, reviewedNow.getTime()));
  const minimum = Number(current?.auto_accept_price);
  const validBid = validAutoBid(bid, minimum);
  const valid = !!current && validTiming(timingConfig) && validBid;
  const end = validTiming(timingConfig) ? autoAcceptEnd(previewNow, timingConfig, duration) : null;
  const { openHour, closeHour } = windowHoursForWallClock(
    utcToGameWallClock(previewNow),
    timingConfig
  );
  const riderName = `${listing.rider.firstname} ${listing.rider.lastname}`;
  const dismiss = () => {
    if (!latch.current) onCancel();
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (latch.current || !valid || !current) return;
    const submittedAt = serverNow();
    if (!end) return;
    if (reviewAutoAcceptEnd(end, submittedAt, timingConfig, duration).changed) {
      // Refresh the visible Ends line, then require another explicit click.
      // No request or money commitment is made against an unseen end time.
      setReviewedNow(submittedAt);
      setEndUpdated(true);
      return;
    }
    latch.current = true;
    setPending(true);
    setError("");
    setEndUpdated(false);
    try {
      const result = await onSubmit({
        expected_rider_id: current.rider.id,
        expected_price: minimum,
        bid_amount: bid,
        duration_minutes: duration,
        expected_end_at: end.toISOString(),
      });
      if (result.ok) {
        onDone(
          t("buyerCard.doneAuction", {
            amount: formatCz(bid),
            rider: riderName,
            end: formatDateTime(end, SHOWN_END),
          })
        );
        onCancel();
        return;
      }
      const errorBody = readAutoAcceptErrorBody(result.data);
      setError(
        resolveApiError(
          errorBody,
          (key, params) => t(key, params as Record<string, unknown>),
          t("auth:error.connectionFailed")
        )
      );
      if (errorBody.errorCode === "auto_accept_end_changed") {
        // Adopt the server's clock and show the new end; no retry happens behind the player.
        const params = errorBody.errorParams as { serverNow?: unknown } | undefined;
        const at = typeof params?.serverNow === "string" ? new Date(params.serverNow) : null;
        if (at && Number.isFinite(at.getTime())) {
          setClockOffsetMs(at.getTime() - getNow().getTime());
          setReviewedNow(at);
        } else setReviewedNow(serverNow());
      }
      if (errorBody.errorCode === "auto_accept_price_changed") {
        // Refresh every displayed listing field. The amount stays the player's own:
        // below the new auto price the confirm button is disabled and the minimum is
        // shown; the player goes back to the card to change it. Never retry behind him.
        setCurrent(null);
        const refreshed = await onRefresh();
        setCurrent(refreshed);
      }
    } catch {
      setError(t("auth:error.connectionFailed"));
    } finally {
      latch.current = false;
      setPending(false);
    }
  }
  const length = { hours: Math.floor(duration / 60), minutes: duration % 60 };
  return (
    <Modal
      open
      title={undefined}
      description={undefined}
      footer={undefined}
      onClose={dismiss}
      closeLabel={t("buyerCard.back")}
      ariaLabelledby="auto-accept-title"
    >
      <form onSubmit={submit} className="space-y-4" aria-busy={pending} data-testid="buyer-auction-confirm">
        <h2 id="auto-accept-title" className="font-heading text-xl font-bold">
          {t("buyerCard.confirmTitleAuction")}
        </h2>
        <div
          className="flex items-center gap-2 text-sm font-semibold"
          onClickCapture={(event) => {
            if (latch.current) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          <Flag code={listing.rider.nationality_code} title={undefined} />
          {pending ? (
            <span aria-disabled="true">{riderName}</span>
          ) : (
            <RiderLink id={listing.rider.id}>{riderName}</RiderLink>
          )}
        </div>
        <ConfirmRows
          testId="buyer-auction-confirm-rows"
          rows={[
            { key: "kind", label: t("buyerCard.rowKind"), value: <strong>{t("buyerCard.kindAuction")}</strong> },
            { key: "amount", label: t("buyerCard.rowAmount"), value: formatCz(bid), numeric: true },
            { key: "length", label: t("buyerCard.rowLength"), value: t("buyerCard.length", length) },
            {
              key: "ends",
              label: t("autoAccept.ends"),
              value: end ? formatDateTime(end, SHOWN_END) : "",
              numeric: true,
            },
            { key: "tied", label: t("buyerCard.rowTied"), value: t("buyerCard.tiedAuction") },
          ]}
        />
        <p className="text-xs text-cz-3">
          {t("autoAccept.durationHint", { open: formatHour(openHour), close: formatHour(closeHour) })}
        </p>
        {current && !validBid && (
          <p role="alert" className="text-sm text-cz-danger" data-testid="auto-accept-minimum">
            {t("buyerCard.errorAuctionMinimum", {
              price: formatCz(Number.isFinite(minimum) ? minimum : listing.auto_accept_price),
            })}
          </p>
        )}
        {endUpdated && !error && (
          <p role="status" className="text-sm text-cz-2" data-testid="auto-accept-end-updated">
            {t("autoAccept.endUpdated")}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-cz-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-cz-border pt-4">
          <Button type="button" variant="secondary" disabled={pending} onClick={dismiss}>
            {t("buyerCard.back")}
          </Button>
          <Button type="submit" variant="primary" disabled={!valid || pending} loading={pending}>
            {t("buyerCard.startAuction")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
