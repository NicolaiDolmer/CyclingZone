import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../ui/Modal.jsx";
import Button from "../ui/Button.jsx";
import AmountInput from "../ui/AmountInput.jsx";
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
  durationMinutes,
  validAutoBid,
  validTiming,
  readAutoAcceptErrorBody,
} from "../../lib/autoAccept2176.ts";
import type { AuctionTiming, AutoListing } from "../../lib/autoAccept2176.ts";
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
  onCancel: () => void;
  onSubmit: (request: {
    expected_rider_id: string;
    expected_price: number;
    bid_amount: number;
    duration_minutes: number;
  }) => Promise<Result>;
  onRefresh: () => Promise<AutoListing | null>;
};
export default function AutoAcceptAuctionDialog({
  listing,
  timingConfig,
  now,
  getNow,
  onCancel,
  onSubmit,
  onRefresh,
}: Props) {
  const { t } = useTranslation("transfers");
  const [current, setCurrent] = useState<AutoListing | null>(listing);
  const [bid, setBid] = useState<number | null>(listing.auto_accept_price);
  const [hours, setHours] = useState("0"),
    [minutes, setMinutes] = useState("30");
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const latch = useRef(false);
  const [reviewedNow, setReviewedNow] = useState(now);
  const previewNow = new Date(Math.max(now.getTime(), reviewedNow.getTime()));
  const duration = durationMinutes(hours, minutes);
  const minimum = Number(current?.auto_accept_price);
  const validBid = validAutoBid(bid, minimum);
  const valid = !!current && validTiming(timingConfig) && duration !== null && validBid;
  const end =
    duration !== null && validTiming(timingConfig)
      ? autoAcceptEnd(previewNow, timingConfig, duration)
      : null;
  const { openHour, closeHour } = windowHoursForWallClock(
    utcToGameWallClock(previewNow),
    timingConfig
  );
  const dismiss = () => {
    if (!latch.current) onCancel();
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (latch.current || !valid || !current || bid === null || duration === null) return;
    const submittedAt = getNow();
    if (end && reviewAutoAcceptEnd(end, submittedAt, timingConfig, duration).changed) {
      // Refresh the visible Ends line, then require another explicit click.
      // No request or money commitment is made against an unseen end time.
      setReviewedNow(submittedAt);
      return;
    }
    latch.current = true;
    setPending(true);
    setError("");
    try {
      const result = await onSubmit({
        expected_rider_id: current.rider.id,
        expected_price: minimum,
        bid_amount: bid,
        duration_minutes: duration,
      });
      if (result.ok) {
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
      if (errorBody.errorCode === "auto_accept_price_changed") {
        // Refresh every displayed listing field. Another explicit submit is
        // required; never retry a changed money amount behind the player.
        setCurrent(null);
        const refreshed = await onRefresh();
        setCurrent(refreshed);
        setBid(refreshed?.auto_accept_price ?? null);
      }
    } catch {
      setError(t("auth:error.connectionFailed"));
    } finally {
      latch.current = false;
      setPending(false);
    }
  }
  return (
    <Modal
      open
      title={undefined}
      description={undefined}
      footer={undefined}
      onClose={dismiss}
      closeLabel={t("autoAccept.cancel")}
      ariaLabelledby="auto-accept-title"
    >
      <form onSubmit={submit} className="space-y-4" aria-busy={pending}>
        <h2 id="auto-accept-title" className="font-heading text-xl font-bold">
          {t("autoAccept.start")}
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
            <span aria-disabled="true">
              {listing.rider.firstname} {listing.rider.lastname}
            </span>
          ) : (
            <RiderLink id={listing.rider.id}>
              {listing.rider.firstname} {listing.rider.lastname}
            </RiderLink>
          )}
        </div>
        <div>
          <label htmlFor="auto-accept-bid" className="block text-sm mb-1">
            {t("autoAccept.bid")}
          </label>
          <AmountInput
            placeholder={undefined}
            errorMessage={undefined}
            id="auto-accept-bid"
            value={bid}
            onValueChange={setBid}
            disabled={pending || !current}
            aria-describedby="auto-accept-minimum"
            aria-invalid={!validBid || undefined}
            className="w-full min-h-11 rounded-cz border border-cz-border bg-cz-subtle px-3 py-2 font-mono tabular-nums"
          />
          <p id="auto-accept-minimum" className="text-xs text-cz-3 mt-1">
            {t("autoAccept.minimum", {
              price: formatCz(Number.isFinite(minimum) ? minimum : listing.auto_accept_price),
            })}
          </p>
        </div>
        <fieldset disabled={pending}>
          <legend className="text-sm mb-1">{t("autoAccept.duration")}</legend>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-cz-3">
              {t("autoAccept.hours")}
              <input
                id="auto-accept-hours"
                type="number"
                min="0"
                max="24"
                step="1"
                required
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                aria-describedby="auto-accept-duration-hint"
                aria-invalid={duration === null || undefined}
                className="block w-full min-h-11 rounded-cz border border-cz-border bg-cz-subtle px-3 py-2 font-mono text-cz-1 tabular-nums"
              />
            </label>
            <label className="text-xs text-cz-3">
              {t("autoAccept.minutes")}
              <input
                id="auto-accept-minutes"
                type="number"
                min="0"
                max="59"
                step="1"
                required
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                aria-describedby="auto-accept-duration-hint"
                aria-invalid={duration === null || undefined}
                className="block w-full min-h-11 rounded-cz border border-cz-border bg-cz-subtle px-3 py-2 font-mono text-cz-1 tabular-nums"
              />
            </label>
          </div>
          <p id="auto-accept-duration-hint" className="text-xs text-cz-3 mt-1">
            {t("autoAccept.durationHint", {
              open: formatHour(openHour),
              close: formatHour(closeHour),
            })}
          </p>
        </fieldset>
        <dl className="flex justify-between gap-3 border-t border-cz-border pt-3 text-sm">
          <dt>{t("autoAccept.ends")}</dt>
          <dd className="font-mono tabular-nums">
            {end
              ? formatDateTime(end, {
                  dateStyle: "full",
                  timeStyle: "short",
                  timeZone: "Europe/Copenhagen",
                })
              : "—"}
          </dd>
        </dl>
        <p className="text-xs text-cz-2">{t("autoAccept.binding")}</p>
        {error && (
          <p role="alert" className="text-sm text-cz-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-cz-border pt-4">
          <Button type="button" variant="secondary" disabled={pending} onClick={dismiss}>
            {t("autoAccept.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!valid || pending} loading={pending}>
            {t("autoAccept.start")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
