import { useTranslation } from "react-i18next";

// #5075 (spillerforslag @cybersimon 9/9): Stats-fanen under Mit hold manglede
// den til-/fravalg af akademiryttere som Trup-fanen (SquadTab, #1929) allerede
// havde. I stedet for at bygge en ny variant i Stats-fanen er selve kontrollen
// UDTRUKKET herfra (samme markup som SquadTab's tidligere lokale toolbar-JSX)
// og state'en (showSeniors/showAcademy) LØFTET op i TeamPage, så begge faner
// deler ÉN kilde til sandhed — flip i den ene fane følger med til den anden.
// Genbrug FØRST (ejer-reglen): ingen ny tekst, ingen ny visuel variant.
export default function AcademySquadFilter({
  showSeniors,
  showAcademy,
  onToggleSeniors,
  onToggleAcademy,
  seniorCount,
  academyCount,
}) {
  const { t } = useTranslation("team");

  // Samme grundbetingelse som den oprindelige SquadTab-toolbar: kun synlig når
  // holdet faktisk har akademiryttere at filtrere på. Undtagelsen (CodeRabbit,
  // #5075): har manageren skjult seniorer OG akademiet siden er tømt (frigivet/
  // graduate-flyttet ryttere), skal kontrollen blive stående — ellers er der
  // ingen vej tilbage til at slå seniorerne til igen uden en side-reload.
  if (!(academyCount > 0) && !(seniorCount > 0 && !showSeniors)) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-cz-3 select-none">{t("squad.filter.label")}</span>
      <button type="button" onClick={onToggleSeniors} aria-pressed={showSeniors}
        className={`px-3 py-1.5 text-xs font-medium rounded-cz border transition-colors duration-150 ${showSeniors ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30" : "bg-cz-card text-cz-3 border-cz-border hover:text-cz-1"}`}>
        {t("squad.filter.seniors", { count: seniorCount })}
      </button>
      <button type="button" onClick={onToggleAcademy} aria-pressed={showAcademy}
        className={`px-3 py-1.5 text-xs font-medium rounded-cz border transition-colors duration-150 ${showAcademy ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30" : "bg-cz-card text-cz-3 border-cz-border hover:text-cz-1"}`}>
        {t("squad.filter.academy", { count: academyCount })}
      </button>
    </div>
  );
}
