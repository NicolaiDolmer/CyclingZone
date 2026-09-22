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

export default function BestRoleTag({ rider = null, role = null, variant = "short", className = "" }) {
  const { t } = useTranslation("riderTypes");
  const on = useBestRoleDisplay();
  if (!on) return null;
  const key = role ?? riderBestRole(rider ?? {}).role;
  if (!key) return null;
  const full = t(`types.${key}`);
  return (
    <span
      className={`text-cz-3 whitespace-nowrap ${variant === "short" ? "text-3xs uppercase tracking-[.06em]" : "text-xs"} ${className}`}
      title={t("bestRole.title", { role: full })}
      data-best-role={key}
    >
      {variant === "short" ? t(`short.${key}`) : full}
    </span>
  );
}
