import { useTranslation } from "react-i18next";
import { riderBestRole } from "../../lib/riderRating.js";
import { useBestRoleDisplay } from "../../lib/useBestRoleDisplay.js";

// #5435 (D-049, spec §2): rollenavnet ved rating-tallet — "54 Climb" i en
// tabel, "54 Climber" på et kort. Tallet ER hans rating i den rolle, så de to
// hører sammen og står altid lige ved siden af hinanden.
//
// Renderer INTET når rating-kontakten er slukket (dagens visning), så den kan
// sættes ind ved siden af enhver rating-plade uden at flytte noget i dag.
//
// Props:
//   rider   rytter-objekt med fladede evner (samme som riderOverallRating får)
//   role    rolle-nøgle, hvis kaldet allerede kender den (springer beregningen over)
//   variant "short" (tabel-rækker, riderTypes.short.*) | "full" (kort, riderTypes.types.*)
// Pakker en eksisterende rating-plade ind: kontakten slukket → pladen PRÆCIS
// som før (ingen ekstra wrapper, så dagens snapshots står uændrede); tændt →
// pladen + rollen på én linje (på telefon under pladen, så den smalle tabel
// ikke skubber navnekolonnen sammen).
export function WithBestRole({ children, rider = null, role = null, variant = "short", className = "" }) {
  const on = useBestRoleDisplay();
  if (!on) return children;
  return (
    <span className={`inline-flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1.5 ${className}`}>
      {children}
      <BestRoleTag rider={rider} role={role} variant={variant} />
    </span>
  );
}

// #5435 opfølgning (ejer 22/9, efter PR #5501): badget skal se ud som
// RiderTypeBadge (samme chip-anatomi — TASTE §"Fire prioritetssignaler",
// alle piller på fladen skal have samme form), men i en NEUTRAL farve så det
// aldrig kan forveksles med det guld-farvede naturlig-rolle-badge. Guld er
// rationeret til RiderTypeBadge alene.
export default function BestRoleTag({ rider = null, role = null, variant = "short", className = "", testId = null }) {
  const { t } = useTranslation("riderTypes");
  const on = useBestRoleDisplay();
  if (!on) return null;
  const key = role ?? riderBestRole(rider ?? {}).role;
  if (!key) return null;
  const full = t(`types.${key}`);
  const text = variant === "short" ? "text-3xs" : "text-xs";
  const pad = variant === "short" ? "px-1.5 py-0.5" : "px-2 py-1";
  return (
    <span
      className={`inline-flex items-center rounded font-medium leading-none whitespace-nowrap bg-cz-2/10 text-cz-2 ${text} ${pad} ${className}`}
      title={t("bestRole.title", { role: full })}
      data-best-role={key}
      {...(testId ? { "data-testid": testId } : {})}
    >
      {variant === "short" ? t(`short.${key}`) : full}
    </span>
  );
}
