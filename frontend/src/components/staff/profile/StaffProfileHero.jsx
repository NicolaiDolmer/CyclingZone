import { useTranslation } from "react-i18next";
import { statColor, statTextColor } from "../../../lib/statColor.js";
import { staffSpecializationHeadline } from "../../../lib/staffAbilities.js";

function RatingCircle({ rating, label }) {
  const has = Number.isFinite(rating) && rating > 0;
  const bg = has ? statColor(rating) : "var(--bg-subtle)";
  return (
    <div className="flex flex-col items-center gap-1 flex-shrink-0">
      <div className="rounded-full w-16 h-16 flex items-center justify-center font-mono font-bold text-[28px]"
        style={{ backgroundColor: bg, color: statTextColor(rating) }}>
        {has ? rating : "—"}
      </div>
      <span className="text-cz-3 text-[10px] uppercase tracking-wide">{label}</span>
    </div>
  );
}

function PhotoPlaceholder({ name }) {
  const initials = (name || "").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="w-[70px] h-[92px] flex flex-col items-center justify-center bg-cz-subtle border border-cz-border rounded-cz text-cz-3">
      <span className="font-display text-2xl leading-none">{initials || "?"}</span>
      <span className="text-[9px] uppercase tracking-[1.5px] mt-1">{"FOTO"}</span>
    </div>
  );
}

export default function StaffProfileHero({ profile }) {
  const { t } = useTranslation("staff");
  const overall = profile?.abilities?.overall ?? null;
  const headline = staffSpecializationHeadline(profile, t);
  return (
    <div className="border-t-2 border-cz-accent pt-3 flex items-start justify-between gap-4 mb-4">
      <div className="flex items-start gap-3">
        <PhotoPlaceholder name={profile.name} />
        <div>
          <h1 className="font-display uppercase leading-none [font-size:clamp(30px,4.4vw,44px)]">{profile.name}</h1>
          <div className="flex items-center gap-2 mt-1 text-[11px] text-cz-2 flex-wrap">
            <span className="px-2 py-[2px] rounded-cz-pill bg-cz-subtle">{t(`roles.${profile.role}`)}</span>
            <span>{t("hero.tier", { tier: profile.tier })}</span>
            <span>{t("hero.salary", { amount: profile.salary })}</span>
          </div>
          {headline && <p className="text-[12px] text-cz-1 mt-2">{headline}</p>}
        </div>
      </div>
      <div className="border border-cz-border rounded-cz p-2 sm:p-3 flex-shrink-0">
        <RatingCircle rating={overall} label={t("hero.ratingEyebrow")} />
      </div>
    </div>
  );
}
