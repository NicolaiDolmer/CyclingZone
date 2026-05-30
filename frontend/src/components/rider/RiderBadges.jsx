import { useTranslation } from "react-i18next";

// Centrale rytter-badges som kompakte ikon-chips med tilgængelig tooltip
// (title + aria-label, role="img"), så navne-cellen kun indeholder selve
// navnet (#801). Tidligere lå tekst-badges (U25, Auktion, AI, Indgående/
// Udgående, Selv/Købt/Solgt) spredt og duplikeret inline på 5 sider — nu ét
// sted med ensartet stil. Tooltip-teksten ligger i `rider`-namespacet under
// `badges.<key>` (EN + DA), så den er oversat og skærmlæser-tilgængelig.
//
// Brug: <RiderBadges badges={["u25", "auction"]} />
// Hver entry er en nøgle i BADGE_DEFS. Ukendte/falsy nøgler ignoreres, så
// kaldersiden kan bygge listen med betingelser:
//   badges={[rider.is_u25 && "u25", isInAuction && "auction"]}

const TONE = {
  info: "bg-cz-info-bg0/20 text-cz-info",
  accent: "bg-cz-accent/15 text-cz-accent-t",
  neutral: "bg-cz-subtle text-cz-2 border border-cz-border",
  success: "bg-cz-success-bg text-cz-success",
  danger: "bg-cz-danger-bg text-cz-danger",
};

const BADGE_DEFS = {
  u25: { icon: "🌱", tone: "info" },
  auction: { icon: "⚡", tone: "accent" },
  ai: { icon: "🤖", tone: "neutral" },
  incoming: { icon: "📥", tone: "success" },
  outgoing: { icon: "📤", tone: "danger" },
  self: { icon: "🔁", tone: "neutral" },
  bought: { icon: "🛒", tone: "success" },
  sold: { icon: "💰", tone: "info" },
};

export default function RiderBadges({ badges = [], className = "" }) {
  const { t } = useTranslation("rider");
  const list = badges.filter((key) => BADGE_DEFS[key]);
  if (list.length === 0) return null;

  return list.map((key) => {
    const def = BADGE_DEFS[key];
    const label = t(`badges.${key}`);
    return (
      <span
        key={key}
        role="img"
        aria-label={label}
        title={label}
        className={`inline-flex items-center justify-center text-[11px] leading-none px-1 py-0.5 rounded flex-shrink-0 ${TONE[def.tone]} ${className}`}
      >
        {def.icon}
      </span>
    );
  });
}
