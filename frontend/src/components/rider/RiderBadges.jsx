import { useTranslation } from "react-i18next";

// Centrale rytter-badges som korte tekst-labels (#837 — superseder #801's
// emoji-ikon+tooltip, som ejer-feedback 31. maj fandt uforståeligt). Hver badge
// er en kompakt, skanbar label (U23/U25/AI/IN/OUT + auktions-status) der nu
// bor i en egen tabelkolonne i stedet for inline i navne-cellen. Den fulde
// (oversatte) sætning bevares som title + aria-label, så hover/skærmlæser
// stadig giver fuld kontekst.
//
// Strenge: kort label i `rider`-ns under `badges.label.<key>` (EN + DA —
// fx incoming = EN "IN" / DA "IND"), fuld tooltip under `badges.<key>`.
//
// Brug: <RiderBadges badges={[ageBadgeKey(rider), isInAuction && "auction"]} />
// Hver entry er en nøgle i BADGE_DEFS. Ukendte/falsy nøgler ignoreres, så
// kaldersiden kan bygge listen med betingelser.

const TONE = {
  info: "bg-cz-info-bg0/20 text-cz-info",
  accent: "bg-cz-accent/15 text-cz-accent-t",
  neutral: "bg-cz-subtle text-cz-2 border border-cz-border",
  success: "bg-cz-success-bg text-cz-success",
  danger: "bg-cz-danger-bg text-cz-danger",
};

const BADGE_DEFS = {
  u23: { tone: "info" },
  u25: { tone: "info" },
  auction: { tone: "accent" },
  ai: { tone: "neutral" },
  incoming: { tone: "success" },
  outgoing: { tone: "danger" },
  self: { tone: "neutral" },
  bought: { tone: "success" },
  sold: { tone: "info" },
  // #1531: skade-badge — samme danger-tone som skade-chippen på rytterprofilen
  // (ConditionChips). Synlig i Status-kolonnen på eget hold + andres hold.
  injured: { tone: "danger" },
};

export default function RiderBadges({ badges = [], className = "" }) {
  const { t } = useTranslation("rider");
  const list = badges.filter((key) => BADGE_DEFS[key]);
  if (list.length === 0) return null;

  return list.map((key) => {
    const def = BADGE_DEFS[key];
    const label = t(`badges.label.${key}`);
    const full = t(`badges.${key}`);
    return (
      <span
        key={key}
        aria-label={full}
        title={full}
        className={`inline-flex items-center justify-center text-[10px] font-semibold uppercase tracking-wide leading-none px-1.5 py-0.5 rounded flex-shrink-0 ${TONE[def.tone]} ${className}`}
      >
        {label}
      </span>
    );
  });
}
