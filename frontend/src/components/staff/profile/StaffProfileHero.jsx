import { useTranslation } from "react-i18next";
import CategoryTag from "../../ui/CategoryTag.jsx";
import { initialsFrom } from "../../ui/avatarStyles.js";
import { statPlateStyle } from "../../../lib/statColor.js";
import { staffSpecializationHeadline } from "../../../lib/staffAbilities.js";

// #2849 bølge 5c — T3 hero stat-blok (label 10px uppercase · value 20px/650
// data-font tabular). Spejler RiderProfileHero's HeroStat (side-lokal helper,
// ikke delt på tværs af sider — se docs/design/PAGE_TEMPLATES.md §T3).
function HeroStat({ label, value }) {
  return (
    <div className="min-w-0">
      <p className="font-data text-3xs font-semibold uppercase tracking-[.1em] text-cz-3 mb-1">{label}</p>
      <div className="font-data leading-tight text-cz-1 tabular-nums text-[20px] font-[650]">{value}</div>
    </div>
  );
}

// #2849 bølge 5c (T3-revision, ejer 24/7 — hero er et KORT, ikke et
// full-bleed bånd): bruges KUN af StaffProfilePage, som ejer selv kortets
// bg-cz-card + hairline + guld-keyline + rounded-cz, back-linket over
// kortet og action-rækken (injiceres via `actions`-prop, samme mønster som
// RiderProfileHero). Denne komponent ejer kun INDHOLDET: foto-slot →
// navn (Bebas, FØRST) → CategoryTag(rolle) + meta-linje UNDER navnet →
// stat-række (rating som farveplade / tier / løn) → valgfri action-række.
export default function StaffProfileHero({ profile, actions = null }) {
  const { t } = useTranslation("staff");
  const overall = profile?.abilities?.overall ?? null;
  const hasRating = Number.isFinite(overall) && overall > 0;
  const headline = staffSpecializationHeadline(profile, t);

  return (
    <>
      <div className="flex items-start gap-4 sm:gap-5 min-w-0">
        {/* Foto-slot (ejer-runde 24/7: samme anatomi som RiderProfileHero —
            kvadratisk ramme m. initialer, klar til rigtige fotos). */}
        <div className="mt-1 w-20 h-20 sm:w-24 sm:h-24 flex-none bg-cz-subtle border border-cz-border rounded-cz flex flex-col items-center justify-center gap-0.5">
          <span aria-hidden="true" className="font-display text-[26px] sm:text-[30px] leading-none text-cz-2">
            {initialsFrom(profile.name)}
          </span>
          <span className="font-data text-3xs uppercase tracking-[.14em] text-cz-3">{t("hero.photoFallback")}</span>
        </div>
        <div className="min-w-0">
          {/* Navnet øverst (ejer-feedback: sidens vigtigste ord først; tags er metadata) */}
          <h1 className="font-display text-[40px] leading-[.92] uppercase text-cz-1 break-words">{profile.name}</h1>

          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            <CategoryTag>{t(`roles.${profile.role}`)}</CategoryTag>
            {headline && (
              <span className="font-data text-2xs uppercase tracking-[.08em] text-cz-3">{headline}</span>
            )}
          </div>
        </div>
      </div>

      {/* Stat-række — HeroStat-anatomien (T3), 1px top rule. */}
      <div className="grid grid-cols-3 gap-x-6 gap-y-4 mt-5 pt-4 border-t border-cz-border">
        <HeroStat
          label={t("hero.ratingEyebrow")}
          value={hasRating ? (
            /* Farveplade (T3-spec): samme statColor-skala som ability-tallene,
               via den delte statPlateStyle (#2888/#2906). */
            <span
              className="inline-flex items-center justify-center min-w-[38px] h-[30px] px-2 rounded-cz"
              style={statPlateStyle(overall)}
            >
              {overall}
            </span>
          ) : "—"}
        />
        <HeroStat label={t("hero.tierLabel")} value={String(profile.tier)} />
        <HeroStat label={t("hero.salaryLabel")} value={t("hero.salary", { amount: profile.salary })} />
      </div>

      {/* Action-række — injiceres af parent (StaffProfilePage), samme mønster
          som RiderProfileHero: sidder efter en hairline-rule i kortets bund. */}
      {actions && <div className="mt-5 pt-5 border-t border-cz-border">{actions}</div>}
    </>
  );
}
