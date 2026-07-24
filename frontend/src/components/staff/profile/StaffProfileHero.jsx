import { useTranslation } from "react-i18next";
import Avatar from "../../ui/Avatar.jsx";
import CategoryTag from "../../ui/CategoryTag.jsx";
import { staffSpecializationHeadline } from "../../../lib/staffAbilities.js";

// #2849 bølge 5 — T3 hero stat-blok (label 10px uppercase · value 20px/650
// data-font tabular). Spejler RaceDetailPage's HeroStatBlock (side-lokal
// helper, ikke delt på tværs af sider — se docs/design/PAGE_TEMPLATES.md §T3).
function HeroStatBlock({ label, value, last = false }) {
  return (
    <div className={`shrink-0 ${last ? "" : "pe-6 me-6 border-e border-cz-border"}`}>
      <div className="font-data text-[10px] font-semibold uppercase tracking-[.1em] text-cz-3 mb-1">{label}</div>
      <div className="font-data text-[20px] font-[650] leading-tight text-cz-1 tabular-nums whitespace-nowrap">{value}</div>
    </div>
  );
}

// #2849 bølge 5 — kanonisk T3-hero (bruges KUN af StaffProfilePage, se den
// side for full-bleed-båndets ejerskab af loading/fejl-grenene). Back-link
// → Avatar (lg, initialer, aldrig guld) → CategoryTag(rolle) + data-font
// meta-linje → navn i Bebas 40px ALL CAPS → stat-række (rating/tier/løn).
export default function StaffProfileHero({ profile, onBack }) {
  const { t } = useTranslation("staff");
  const overall = profile?.abilities?.overall ?? null;
  const hasRating = Number.isFinite(overall) && overall > 0;
  const headline = staffSpecializationHeadline(profile, t);

  const statBlocks = [
    { key: "rating", label: t("hero.ratingEyebrow"), value: hasRating ? overall : "—" },
    { key: "tier", label: t("hero.tierLabel"), value: String(profile.tier) },
    { key: "salary", label: t("hero.salaryLabel"), value: t("hero.salary", { amount: profile.salary }) },
  ];

  return (
    <div className="bg-cz-card border-b border-cz-border">
      <div className="max-w-5xl mx-auto pt-5 px-4 md:px-8">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs font-medium text-cz-2 hover:text-cz-1 transition-colors mb-3.5"
        >
          ‹ {t("back")}
        </button>
        <div className="flex items-start gap-3">
          <Avatar name={profile.name} size="lg" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <CategoryTag>{t(`roles.${profile.role}`)}</CategoryTag>
              {headline && (
                <span className="font-data text-[11px] uppercase tracking-[.08em] text-cz-3">{headline}</span>
              )}
            </div>
            <h1 className="font-display text-[40px] leading-[.92] uppercase text-cz-1 break-words">{profile.name}</h1>
          </div>
        </div>
        <div className="flex mt-5 pt-4 border-t border-cz-border overflow-x-auto">
          {statBlocks.map((b, i) => (
            <HeroStatBlock key={b.key} label={b.label} value={b.value} last={i === statBlocks.length - 1} />
          ))}
        </div>
      </div>
    </div>
  );
}
