import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { formatNumber } from "../lib/intl";
import { buildSponsorIncomeBreakdown } from "../lib/sponsorIncomeBreakdown";
import Button from "./ui/Button.jsx";
import EmptyState from "./ui/EmptyState.jsx";
import ErrorState from "./ui/ErrorState.jsx";
import { SkeletonLines } from "./ui/Skeleton.jsx";
import { ChevronRightIcon, CoinIcon } from "./ui/icons/index.jsx";

const API = import.meta.env.VITE_API_URL;

// "Sponsor income"-sektion på Finance-siden (ejer-godkendt mockup 4/8): viser
// HVORFOR holdet får sponsorpenge, med en udfoldelig gruppering (fast base /
// løbsdage / bonusser). Bruger samme GET /api/sponsor/contract-endpoint som
// SponsorContractPanel (udvidet med `season.transactions`) — grupperings-/summerings-logikken
// selv er en ren funktion i lib/sponsorIncomeBreakdown.js (unit-testet der).
const RACE_DAYS_DEFAULT_LIMIT = 2;

function money(n) {
  return `${formatNumber(n || 0)} CZ$`;
}

function IncomeGroup({ title, total, expanded, onToggle, children, isEmpty }) {
  if (isEmpty) return null;
  return (
    <div className="border-t border-cz-border pt-3 mt-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          <ChevronRightIcon
            size={14}
            aria-hidden="true"
            className={`text-cz-3 flex-shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
          />
          <span className="text-cz-1 text-sm font-medium truncate">{title}</span>
        </span>
        <span className="font-data tabular-nums text-sm font-semibold text-cz-1 flex-shrink-0">
          {money(total)}
        </span>
      </button>
      {expanded && <div className="mt-2 ps-[22px]">{children}</div>}
    </div>
  );
}

function IncomeRow({ label, amount }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-cz-border last:border-0 gap-3">
      <p className="text-cz-2 text-xs min-w-0 truncate">{label}</p>
      <p className="font-data tabular-nums text-xs text-cz-1 flex-shrink-0">{money(amount)}</p>
    </div>
  );
}

export default function SponsorIncomeBreakdown() {
  const { t } = useTranslation("sponsor");
  const [contract, setContract] = useState(null);
  const [season, setSeason] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const toggleGroup = (key) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const [raceDaysShowAll, setRaceDaysShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${API}/api/sponsor/contract`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (alive) {
          setContract(body.contract ?? null);
          setSeason(body.season ?? null);
        }
      } catch (e) {
        console.error("SponsorIncomeBreakdown load failed", e);
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [reloadKey]);

  const breakdown = useMemo(
    () => buildSponsorIncomeBreakdown({
      contract,
      seasonNumber: season?.number ?? null,
      transactions: season?.transactions ?? [],
    }),
    [contract, season],
  );

  if (loading) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-5" role="status" aria-label={t("income.loading")}>
        <SkeletonLines lines={5} />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        title={t("income.errorTitle")}
        description={t("income.error")}
        action={
          <Button variant="secondary" size="sm" onClick={retry}>
            {t("income.retry")}
          </Button>
        }
      />
    );
  }

  const isEmpty = !contract || breakdown.total <= 0;

  if (isEmpty) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-5">
        <h2 className="text-cz-1 font-semibold text-sm mb-3">{t("income.title")}</h2>
        <EmptyState
          icon={<CoinIcon size={26} aria-hidden="true" />}
          title={t("income.empty.title")}
          description={t("income.empty.description")}
        />
      </div>
    );
  }

  const raceDayRows = breakdown.raceDays.rows;
  const raceDaysCollapsible = raceDayRows.length > RACE_DAYS_DEFAULT_LIMIT;
  const visibleRaceDayRows = raceDaysCollapsible && !raceDaysShowAll
    ? raceDayRows.slice(0, RACE_DAYS_DEFAULT_LIMIT)
    : raceDayRows;

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-5">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h2 className="text-cz-1 font-semibold text-sm">{t("income.title")}</h2>
        <span className="font-data text-2xs uppercase tracking-[.08em] text-cz-3">
          {breakdown.sponsorName
            ? t("income.meta", { sponsor: breakdown.sponsorName })
            : t("income.metaNoSponsor")}
        </span>
      </div>

      <div>
        <p className="text-cz-3 text-2xs uppercase tracking-wider mb-1">{t("income.totalLabel")}</p>
        <p className="font-data tabular-nums font-bold text-3xl text-cz-1">{money(breakdown.total)}</p>
        <p className="text-cz-3 text-xs mt-1">
          {t("income.split", { guaranteed: money(breakdown.guaranteed), earned: money(breakdown.earnedOnTop) })}
        </p>
      </div>

      {/* a. Fixed income */}
      <IncomeGroup
        title={t("income.group.fixed.title")}
        total={breakdown.fixed.total}
        expanded={expandedGroups.has("fixed")}
        onToggle={() => toggleGroup("fixed")}
        isEmpty={breakdown.fixed.rows.length === 0}
      >
        {breakdown.fixed.rows.map((row) => (
          <IncomeRow key={row.id} label={t("income.group.fixed.row")} amount={row.amount} />
        ))}
      </IncomeGroup>

      {/* b. Race days */}
      <IncomeGroup
        title={t("income.group.raceDays.title")}
        total={breakdown.raceDays.total}
        expanded={expandedGroups.has("raceDays")}
        onToggle={() => toggleGroup("raceDays")}
        isEmpty={raceDayRows.length === 0}
      >
        {visibleRaceDayRows.map((row) => (
          <IncomeRow
            key={row.raceId || row.createdAt}
            label={t("income.group.raceDays.row", {
              raceName: row.raceName || t("income.group.raceDays.unknownRace"),
              days: row.days ?? 0,
              rate: formatNumber(row.rate || 0),
            })}
            amount={row.amount}
          />
        ))}
        {raceDaysCollapsible && (
          <button
            type="button"
            onClick={() => setRaceDaysShowAll((v) => !v)}
            className="mt-2 text-xs font-medium text-cz-accent-t hover:underline"
          >
            {raceDaysShowAll
              ? t("income.group.raceDays.showLess")
              : t("income.group.raceDays.showAll", { count: raceDayRows.length })}
          </button>
        )}
      </IncomeGroup>

      {/* c. Bonuses */}
      <IncomeGroup
        title={t("income.group.bonuses.title")}
        total={breakdown.bonuses.total}
        expanded={expandedGroups.has("bonuses")}
        onToggle={() => toggleGroup("bonuses")}
        isEmpty={breakdown.bonuses.rows.length === 0 && !breakdown.bonuses.cap}
      >
        {breakdown.bonuses.rows.map((row) => {
          const label =
            row.kind === "stageWin" ? t("income.group.bonuses.stageWin", { raceName: row.raceName || t("income.group.raceDays.unknownRace") })
            : row.kind === "podium" ? t("income.group.bonuses.podium", { raceName: row.raceName || t("income.group.raceDays.unknownRace") })
            : row.kind === "signing" ? t("income.group.bonuses.signing")
            : row.kind === "objective" ? t("income.group.bonuses.objective")
            : t("income.group.bonuses.generic", { raceName: row.raceName || t("income.group.raceDays.unknownRace") });
          return <IncomeRow key={row.id} label={label} amount={row.amount} />;
        })}
        {breakdown.bonuses.cap && (
          <p className="text-cz-3 text-3xs mt-2">
            {t("income.group.bonuses.capLine", {
              used: formatNumber(breakdown.bonuses.cap.used),
              limit: formatNumber(breakdown.bonuses.cap.limit),
            })}
          </p>
        )}
      </IncomeGroup>

      <p className="text-cz-3 text-3xs mt-4 pt-3 border-t border-cz-border">
        {breakdown.hasBonusClauses ? t("income.footer.full") : t("income.footer.noBonuses")}
      </p>
    </div>
  );
}
