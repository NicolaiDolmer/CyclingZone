// #7717 · Hvorfor?-knappen ved en rytter: eet tryk folder een saetning ud under
// raekken. Saetningen kommer fra riderWhyModel.ts og baerer ord, aldrig tal.
// Knappen er en stille tekst-knap: kortets ene guld-knap er stadig taktikken.
import { useTranslation } from "react-i18next";
import type { RiderWhy, WhyPlace } from "../../lib/riderWhyModel.ts";
import { SkeletonLines } from "./stagePageV2/ui.ts";

function usePlaceText() {
  const { t } = useTranslation("races");
  return (place: WhyPlace): string => {
    switch (place.kind) {
      case "climb": return t("stagePageV2.why.where.climb", { name: place.name });
      case "sector": return t("stagePageV2.why.where.sector", { name: place.name });
      case "lastClimb": return t("stagePageV2.why.where.lastClimb");
      case "someClimb": return t("stagePageV2.why.where.someClimb");
      case "finale": return t("stagePageV2.why.where.finale");
      default: return "";
    }
  };
}

export function RiderWhyButton({ open, panelId, name, onToggle }: { open: boolean; panelId: string; name: string; onToggle: () => void }) {
  const { t } = useTranslation("races");
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={t("stagePageV2.why.buttonAria", { name })}
      onClick={onToggle}
      className="min-h-11 min-w-11 flex-none rounded-cz px-1.5 font-data sm:min-w-0 text-xs font-semibold text-cz-accent-t hover:underline"
    >
      <span aria-hidden="true" className="sm:hidden">?</span>
      <span className="hidden sm:inline">{t("stagePageV2.why.button")}</span>
    </button>
  );
}

/** Saetningen under raekken; `why` null = historien er ikke hentet endnu. */
export function RiderWhyLine({ id, why }: { id: string; why: RiderWhy | null }) {
  const { t } = useTranslation("races");
  const placeText = usePlaceText();
  let body = <SkeletonLines lines={1} />;
  if (why) {
    const main = t(`stagePageV2.why.main.${why.main}`, { where: placeText(why.where) });
    const lead = why.lead ? t(`stagePageV2.why.lead.${why.lead}`, { where: placeText(why.leadWhere) }) : null;
    const told = lead ? t("stagePageV2.why.withLead", { main, lead }) : t("stagePageV2.why.alone", { main });
    const companions = why.companions
      ? t(`stagePageV2.why.${why.companions.more ? "attackedWithMore" : "attackedWith"}`, { names: why.companions.names })
      : null;
    body = <>{companions ? `${told} ${companions}` : told}</>;
  }
  return (
    <div id={id} role="status" className={`mb-2 basis-full pl-[46px] text-sm leading-relaxed ${why?.known === false ? "text-cz-3" : "text-cz-2"}`}>
      {body}
    </div>
  );
}
