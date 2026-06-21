import { useTranslation } from "react-i18next";
import { formatNumber } from "../lib/intl";
import Modal from "./ui/Modal.jsx";

// #1663 · Sponsor-tilbuds-modal (præsentationel, henter ikke selv data).
// Vises fra Board-fladen (I-b). Forhandlingen sker her; valg propageres via
// onAccept(variant). Den rige header ligger i children, så aria-labelledby
// peger paa dens egen titel-h2 i stedet for primitivens title-prop.
export default function SponsorOfferModal({
  open,
  onClose,
  offers = [],
  pendingVariant = null,
  upcomingSeasonNumber,
  onAccept,
  accepting = false,
}) {
  const { t } = useTranslation("sponsor");

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      closeLabel={t("offers.choose")}
      ariaLabelledby="sponsor-offer-modal-title"
    >
      <div className="mb-4">
        <h2
          id="sponsor-offer-modal-title"
          className="font-display text-2xl leading-none tracking-[.01em] text-cz-1"
        >
          {t("offers.title")}
        </h2>
        <p className="mt-1.5 text-sm text-cz-2">
          {t("offers.subtitle", { season: upcomingSeasonNumber })}
        </p>
      </div>

      {offers.length === 0 ? (
        <p className="text-cz-3 text-sm">{t("offers.empty")}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {offers.map((offer) => {
            const selected = pendingVariant === offer.variant;
            return (
              <div
                key={offer.variant}
                className={`bg-cz-card border rounded-cz p-5 flex flex-col gap-3 ${
                  selected ? "border-cz-accent-t" : "border-cz-border"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-cz-1 font-semibold text-sm leading-tight">
                      {t(`variant.${offer.variant}`, { defaultValue: offer.variant })}
                    </p>
                    <p className="text-cz-3 text-xs mt-0.5 truncate">{offer.sponsorName}</p>
                  </div>
                  {selected && (
                    <span className="flex-shrink-0 px-2 py-0.5 rounded-full border border-cz-accent-t/40 text-cz-accent-t text-[10px] font-medium uppercase tracking-wider">
                      {t("offers.pending")}
                    </span>
                  )}
                </div>

                <dl className="flex flex-col gap-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-cz-3">{t("field.guaranteedBase")}</dt>
                    <dd className="font-mono text-cz-1">{formatNumber(offer.guaranteedBase)} CZ$</dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-cz-3">{t("field.perRaceDay")}</dt>
                    <dd className="font-mono text-cz-1">{formatNumber(offer.perRaceDayRate)} CZ$</dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-cz-3">{t("field.length")}</dt>
                    <dd className="font-mono text-cz-1">
                      {t("field.seasons", { count: offer.lengthSeasons })}
                    </dd>
                  </div>
                </dl>

                <button
                  type="button"
                  onClick={() => onAccept?.(offer.variant)}
                  disabled={accepting}
                  className="mt-auto py-2 bg-cz-accent text-cz-on-accent text-sm font-semibold rounded-cz hover:brightness-110 disabled:opacity-50 transition-all"
                >
                  {t("offers.choose")}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
