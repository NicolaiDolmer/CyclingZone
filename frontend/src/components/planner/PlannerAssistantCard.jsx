// Season Planner — assistent-handlingskortet (#3086; erstatter #2455's banner).
//
// Maskineriet var der allerede: boardet udkaster et helt form-program pr. rytter.
// Men det var pakket som et banner der beskrev noget, uden at kunne gøre noget,
// og en casual manager havde derfor stadig ingen ét-klik-vej til en færdig plan.
// Kortet siger tre ting og tilbyder ét greb: HVOR MANGE forslag der ligger,
// HVORFOR de løb blev valgt, og "Accept all".
//
// Kortet bærer også spilreglen fra det slettede firstRun-nudget ("hver rytter kan
// peake mod op til {max} løb"). Den sætning fandtes kun dér, og nudget kunne
// aldrig vises igen når assistenten udfylder brættet fra start — reglen flyttes
// derfor hertil frem for at forsvinde med den flade den stod på.
import { useTranslation } from "react-i18next";
import { Section, Button, StarIcon } from "../ui";

export default function PlannerAssistantCard({ suggestionCount, riderCount, maxPerRider, busy, onAcceptAll }) {
  const { t } = useTranslation("planner");
  return (
    <Section borderClass="border-cz-accent-t" className="mb-[14px] bg-cz-subtle">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <StarIcon size={16} aria-hidden="true" className="mt-0.5 hidden shrink-0 text-cz-accent-t sm:block" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-cz-1">
            {t("assistant.cardTitle", { peaks: suggestionCount, riders: riderCount })}
          </p>
          <p className="mt-1 text-[13px] text-cz-2">{t("assistant.cardWhy")}</p>
          <p className="mt-1.5 text-2xs text-cz-2">{t("assistant.cardRule", { max: maxPerRider })}</p>
        </div>
        <Button size="sm" className="shrink-0 self-start" disabled={busy} onClick={onAcceptAll}>
          {t("assistant.acceptAll")}
        </Button>
      </div>
    </Section>
  );
}
