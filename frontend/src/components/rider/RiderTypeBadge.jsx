import { useTranslation } from "react-i18next";
import { RIDER_TYPE_KEYS } from "../../lib/riderTypeKeys";
import { useBestRoleDisplay } from "../../lib/useBestRoleDisplay.js";

// Ryttertype-badge (#49) — viser en rytters primær + sekundær type (top-2).
// Læser de persisterede riders.primary_type/secondary_type-kolonner (beregnet
// server-side af backfillRiderTypes.js) og slår labels op i `riderTypes`-ns.
// Frontend beregner IKKE typer selv.
//
// #5435 (D-049, spec §1.5): med rating-kontakten tændt ER badget anlægget —
// "Natural role / Naturlig rolle", født til og låst hele karrieren — mens
// ratingen ved siden af er bedste rolle NU. De to kan pege på hver sin rolle,
// og det er meningen. Detalje-størrelsen (md) får en synlig "NATURAL"-etiket;
// i tabeller (sm) bærer kolonne-overskriften ordet, og badget siger det i
// tooltip/aria, så rækkerne ikke bliver dobbelt så høje.
//
// Brug:
//   <RiderTypeBadge primaryType={r.primary_type} secondaryType={r.secondary_type} />
//   size: "sm" (tabel-rækker) | "md" (detalje-side). Returnerer null uden data.

const VALID = new Set(RIDER_TYPE_KEYS);

// #2888 (Discord 24/7): `stacked` sætter sekundærtypen på sin EGEN linje. To
// sammensatte typenavne ("Etapeløbsrytter / Bjergrytter") er ~180px på én
// nowrap-linje og var den enkeltkolonne der trak trup-tabellen bredest.
export default function RiderTypeBadge({ primaryType, secondaryType, size = "sm", stacked = false, className = "" }) {
  const { t } = useTranslation("riderTypes");
  const natural = useBestRoleDisplay();
  if (!primaryType || !VALID.has(primaryType)) return null;

  const primaryLabel = t(`types.${primaryType}`);
  const hasSecondary = secondaryType && VALID.has(secondaryType) && secondaryType !== primaryType;
  const secondaryLabel = hasSecondary ? t(`types.${secondaryType}`) : null;

  const ariaPrefix = natural ? "natural" : "badge";
  const full = hasSecondary
    ? t(`${ariaPrefix}.ariaLabel`, { primary: primaryLabel, secondary: secondaryLabel })
    : t(`${ariaPrefix}.ariaLabelSingle`, { primary: primaryLabel });

  const text = size === "sm" ? "text-3xs" : "text-xs";
  const pad = size === "sm" ? "px-1.5 py-0.5" : "px-2 py-1";
  // Synlig etiket kun i detalje-størrelsen (se header-kommentaren).
  const naturalTag = natural && size === "md" ? (
    <span
      className="font-data text-3xs font-semibold uppercase tracking-[.1em] text-cz-3"
      data-testid="rider-type-natural-label"
    >
      {t("natural.label")}
    </span>
  ) : null;

  if (stacked) {
    return (
      <span
        aria-label={full}
        title={full}
        className={`inline-flex flex-col items-start gap-px rounded font-medium leading-tight whitespace-nowrap ${text} ${pad} bg-cz-accent/10 text-cz-accent-t ${className}`}
      >
        {naturalTag}
        <span className={text}>{primaryLabel}</span>
        {secondaryLabel && <span className={`${text} text-cz-2`}>{secondaryLabel}</span>}
      </span>
    );
  }

  return (
    <span
      aria-label={full}
      title={full}
      className={`inline-flex items-center gap-1 rounded font-medium leading-none whitespace-nowrap ${text} ${pad} bg-cz-accent/10 text-cz-accent-t ${className}`}
    >
      {naturalTag}
      <span className={text}>{primaryLabel}</span>
      {secondaryLabel && (
        <>
          <span aria-hidden="true" className={`${text} text-cz-3`}>/</span>
          <span className={`${text} text-cz-2`}>{secondaryLabel}</span>
        </>
      )}
    </span>
  );
}
