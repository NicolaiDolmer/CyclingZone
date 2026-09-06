import { useTranslation, Trans } from "react-i18next";
import { TrophyIcon } from "../ui/icons/index.jsx";
import { formatNumber } from "../../lib/intl";

function formatCash(value) {
  const num = Number(value || 0);
  return `${formatNumber(num)} CZ$`;
}

// S-02e · Bonus-offer card (lag 6). Q-batch 1B Q14: maks 1/sæson, +200K mod ekstra-mål.
//
// #4557 · Flyttet UÆNDRET ud af BoardPage.jsx (kun `formatCash` fulgte med, den
// var en lokal hjælper). Den gamle bestyrelsesside importerer herfra og er
// visuelt uændret; Boardroom bruger sin egen mockup-tro stribe/blok mod de
// SAMME endpoints (components/board/bonusOfferApi.js).
export default function BonusOfferCard({ offer, onAccept, onDecline, busy }) {
  const { t } = useTranslation("board");
  if (!offer) return null;
  const goalLabel = offer.payload?.extra_goal_label || t("bonusOffer.defaultGoal");
  const bonus = offer.severity || 0;

  return (
    <div className="mt-5 rounded-cz p-5 border border-cz-success/40 bg-cz-success-bg">
      <div className="flex items-start gap-3">
        <TrophyIcon size={24} aria-hidden="true" className="flex-shrink-0 text-cz-success" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-cz-success">{t("bonusOffer.heading")}</p>
          <p className="text-cz-2 text-xs mt-2 leading-relaxed">
            <Trans
              i18nKey="board:bonusOffer.body"
              values={{ cash: formatCash(bonus), goal: goalLabel }}
              components={{
                bonus: <span className="font-mono font-bold text-cz-success" />,
                goal: <span className="font-medium text-cz-2" />,
              }}
            />
          </p>
          <p className="text-cz-3 text-xs mt-2 leading-relaxed">{t("bonusOffer.footer")}</p>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              disabled={busy}
              onClick={onAccept}
              className="px-3 py-2 rounded-cz bg-cz-success/20 hover:bg-cz-success/30 text-cz-success text-xs font-semibold border border-cz-success/40 disabled:opacity-50">
              {t("bonusOffer.accept")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onDecline}
              className="px-3 py-2 rounded-cz bg-cz-subtle hover:bg-cz-subtle/70 text-cz-2 text-xs font-medium border border-cz-border disabled:opacity-50">
              {t("bonusOffer.decline")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
