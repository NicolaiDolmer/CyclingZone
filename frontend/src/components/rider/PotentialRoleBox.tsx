import { useTranslation } from "react-i18next";

// #6853 / #5764 (løsning B): den lille typeboks ved potentiale-tallet. Den siger
// hvilken rolle tallet gælder, fordi tallet altid er rollen med det højeste
// potentiale (serverens valg, se lib/potentialDisplay6853.ts). Rollens navn står
// i boksen, så den kan læses uden hover på mobil; tooltip'en giver hele navnet
// og tallet.
//
// Samme chip-anatomi og neutrale farve som BestRoleTag (TASTE: alle piller har
// samme form, guld er rationeret til det naturlige type-badge).
type Props = {
  role: string | null | undefined;
  lo: number;
  hi: number | null;
  variant?: "short" | "full";
  className?: string;
};

export default function PotentialRoleBox({ role, lo, hi, variant = "short", className = "" }: Props) {
  const { t } = useTranslation();
  if (!role) return null;
  const full = t(`riderTypes:types.${role}`);
  const text = variant === "short" ? "text-3xs" : "text-xs";
  const pad = variant === "short" ? "px-1.5 py-0.5" : "px-2 py-1";
  return (
    <span
      className={`inline-flex items-center rounded font-medium leading-none whitespace-nowrap bg-cz-2/10 text-cz-2 ${text} ${pad} ${className}`}
      title={t("rider:scouting.potentialBandTitle", { role: full, lo, hi })}
      aria-label={full}
      data-potential-role={role}
    >
      {variant === "short" ? t(`riderTypes:short.${role}`) : full}
    </span>
  );
}
