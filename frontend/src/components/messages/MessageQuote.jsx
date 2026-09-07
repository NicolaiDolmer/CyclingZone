import { Link } from "react-router";
import { ExchangeIcon, GavelIcon } from "../ui";
import { formatNumber } from "../../lib/intl";

// #3200 · Den citerede handel på den første besked fra "Skriv til modparten".
// Kun tal begge parter i forvejen kan se: rytter, beløb, dato. Ingen skjulte
// tal (fog of war) — backendens normalizeMessageContext kaster resten væk.
const KIND_ICON = {
  transfer_offer: ExchangeIcon,
  auction: GavelIcon,
};

// Der findes ingen /auctions/:id-rute — auktioner bor på listesiden, og
// tilbud på /transfers. Citatet linker derfor til fladen, ikke til et
// deep link der ville ende i en 404.
const KIND_LINK = {
  transfer_offer: () => "/transfers",
  auction: () => "/auctions",
};

export default function MessageQuote({ context, t }) {
  if (!context?.kind) return null;
  const Icon = KIND_ICON[context.kind];
  const to = KIND_LINK[context.kind]?.(context.refId);

  return (
    <div className="mb-2 border-s-2 border-cz-border ps-3">
      <div className="flex items-center gap-1.5 font-data text-2xs uppercase tracking-[.08em] text-cz-3">
        {Icon && <Icon size={12} aria-hidden="true" />}
        <span>{t(`quote.${context.kind}`)}</span>
      </div>
      <div className="mt-0.5 text-xs text-cz-2">
        {context.riderName && <span className="font-semibold text-cz-1">{context.riderName}</span>}
        {context.riderName && context.amount != null && <span aria-hidden="true"> · </span>}
        {context.amount != null && (
          <span className="tabular-nums">{t("quote.amount", { amount: formatNumber(context.amount) })}</span>
        )}
      </div>
      {to && (
        <Link to={to} className="mt-0.5 inline-block text-2xs text-cz-3 underline underline-offset-2 transition-colors hover:text-cz-accent-t">
          {t("quote.open")}
        </Link>
      )}
    </div>
  );
}
