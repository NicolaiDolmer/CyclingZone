import { Link } from "react-router";
import { useTranslation } from "react-i18next";

const squadLinks = { u23: "/squads/u23", senior: "/team" };

type PromotionNotice = {
  squad: keyof typeof squadLinks;
  names: string[];
  overLimit: boolean;
};

export default function SeasonSquadPromotions({
  promotions, onOpenSquad,
}: {
  promotions?: PromotionNotice[];
  onOpenSquad: () => void;
}) {
  const { t, i18n } = useTranslation("notifications");
  if (!promotions?.length) return null;
  const nameList = new Intl.ListFormat(i18n.resolvedLanguage, { type: "conjunction" });

  return (
    <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-cz-2">
      {promotions.map(({ squad, names, overLimit }) => (
        <li key={squad}>
          <p>{t(`seasonPromotions.${squad}Moved`, { names: nameList.format(names) })}</p>
          {overLimit && (
            <Link
              to={squadLinks[squad]}
              className="text-cz-accent-t underline"
              onClick={(event) => {
                event.stopPropagation();
                onOpenSquad();
              }}
            >
              {t(`seasonPromotions.${squad}OverLimit`)}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
