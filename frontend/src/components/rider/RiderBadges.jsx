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
// Brug: <RiderBadges badges={[ageBadgeKey(rider, seasonYear), isInAuction && "auction"]} />
// (seasonYear = det aktive sæsons referenceår, #3071 — se riderAge.js/useActiveSeasonYear.js)
// Hver entry er en nøgle i BADGE_DEFS. Ukendte/falsy nøgler ignoreres, så
// kaldersiden kan bygge listen med betingelser.

const TONE = {
  info: "bg-cz-info-bg text-cz-info",
  accent: "bg-cz-accent/15 text-cz-accent-t",
  neutral: "bg-cz-subtle text-cz-2 border border-cz-border",
  success: "bg-cz-success-bg text-cz-success",
  danger: "bg-cz-danger-bg text-cz-danger",
  // #2943: samme amber warning-tone som auktionens "extended"-badge (inline
  // bg-cz-warning-bg/text-cz-warning) — advarsel, ikke blokering.
  warning: "bg-cz-warning-bg text-cz-warning",
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
  // #1929-redesign: akademi-badge — markerer off-cap-akademiryttere i badge-kolonnen
  // (afløser den inline "Academy"-tag), overalt hvor badge-kolonnen bruges.
  academy: { tone: "accent" },
  // #2943: pensions-risiko — rytteren er i eller lige før pensions-vinduet
  // (retirementRiskBadgeKey, riderAge.js). Advarsel til KØBEREN før bud, ikke
  // en blokering (jf. #2918/#2947, som guarder selve finaliseringen).
  retireRisk: { tone: "warning" },
  // #3097: kontrakt udløber ved næste sæsonskifte (contractExpiringBadgeKey,
  // riderAge.js) — den ANDEN af de to mekanikker squad-risk-spærren (#2748)
  // tæller som "i risiko" (retireRisk er den første). Samme warning-tone:
  // begge er advarsler om at rytteren tæller mod det sikre 8-antal, ikke en
  // blokering i sig selv.
  contractExpiring: { tone: "warning" },
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
        className={`inline-flex items-center justify-center text-3xs font-semibold uppercase tracking-wide leading-none px-1.5 py-0.5 rounded flex-shrink-0 ${TONE[def.tone]} ${className}`}
      >
        {label}
      </span>
    );
  });
}
