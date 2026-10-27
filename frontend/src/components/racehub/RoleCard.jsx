// Race Hub S5 (Lag 3) — klikbart rolle-kort, afløser rolle-dropdownen i RaceColumn.
// Viser rolle-titel + profil-bevidst hint (hvorfor rollen passer terrænet). Editorial,
// ingen rounded-2xl/glow/emoji/gradient. Hint-nøgler kommer fra roleHint (ren helper).
// #6912: jæger-kortets "Breakaway odds"-chip er fjernet; den kom fra en fast tabel,
// ikke fra motoren for netop det løb og felt.
import { useTranslation } from "react-i18next";
import { roleHint } from "../../lib/roleHint.js";

/** @param {{ role: any, active: any, onClick: any, terrainBucket: any, disabled?: boolean, profileType?: any, finaleType?: any }} props  profileType/finaleType ignoreres (#6912 S7 A) */
export default function RoleCard({ role, active, onClick, terrainBucket, disabled = false }) {
  const { t } = useTranslation("races");
  const hint = roleHint(role, terrainBucket);
  if (!hint) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`text-left rounded-cz border px-3 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        active
          ? "border-cz-accent bg-cz-accent/10"
          : "border-cz-border bg-cz-card hover:border-cz-accent/50 hover:bg-cz-subtle"
      }`}
    >
      <span className={`block text-xs font-semibold ${active ? "text-cz-accent-t" : "text-cz-1"}`}>
        {t(hint.titleKey)}
      </span>
      <p className="text-2xs leading-snug text-cz-3 mt-0.5">{t(hint.descKey)}</p>
    </button>
  );
}
