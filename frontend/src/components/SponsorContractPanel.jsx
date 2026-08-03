import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { formatNumber } from "../lib/intl";
import Button from "./ui/Button.jsx";
import ErrorState from "./ui/ErrorState.jsx";
import { SkeletonLines } from "./ui/Skeleton.jsx";
import { CoinIcon, FlagIcon, PodiumIcon, TrophyIcon } from "./ui/icons/index.jsx";

const API = import.meta.env.VITE_API_URL;

// #1663/#2948 · Read-only sponsorkontrakt-panel paa Finance-fanen. Forhandlingen
// sker paa Board-fladen (SponsorOfferModal) — her vises den aktive kontrakt,
// dens bonusklausuler og hvad aftalen faktisk har indbragt (earnings pr. kilde).
// Henter selv sine data; cleanup via alive-flag.
function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-cz-border last:border-0">
      <p className="text-cz-2 text-xs">{label}</p>
      <p className="font-mono text-sm text-cz-1">{value}</p>
    </div>
  );
}

const CLAUSE_ICONS = {
  signing: CoinIcon,
  stage_win: TrophyIcon,
  podium: PodiumIcon,
  season_objective: FlagIcon,
};

export default function SponsorContractPanel() {
  const { t } = useTranslation("sponsor");
  const [contract, setContract] = useState(null);
  const [earnings, setEarnings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

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
          setEarnings(body.earnings ?? null);
        }
      } catch (e) {
        console.error("SponsorContractPanel load failed", e);
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [reloadKey]);

  if (loading) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-5" role="status" aria-label={t("contract.loading")}>
        <SkeletonLines lines={4} />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        title={t("contract.errorTitle")}
        description={t("contract.error")}
        action={
          <Button variant="secondary" size="sm" onClick={retry}>
            {t("contract.retry")}
          </Button>
        }
      />
    );
  }

  const clauses = (contract?.bonus_clauses || []).filter((c) => c.type !== "results_cap");
  const cap = (contract?.bonus_clauses || []).find((c) => c.type === "results_cap");

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-5">
      <h2 className="text-cz-1 font-semibold text-sm mb-3">{t("contract.title")}</h2>
      {!contract ? (
        <p className="text-cz-3 text-sm">{t("contract.none")}</p>
      ) : (
        <>
          <div className="mb-3">
            <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">{t("contract.sponsorName")}</p>
            <p className="text-cz-accent-t font-display text-2xl leading-none tracking-[.01em]">
              {contract.sponsor_name}
            </p>
            {contract.variant && (
              <p className="text-cz-3 text-xs mt-1">
                {t(`variant.${contract.variant}`, { defaultValue: "" })}
              </p>
            )}
          </div>
          <Row
            label={t("field.guaranteedBase")}
            value={`${formatNumber(contract.guaranteed_base)} CZ$`}
          />
          <Row
            label={t("field.perRaceDay")}
            value={`${formatNumber(contract.per_race_day_rate)} CZ$`}
          />
          <Row
            label={t("field.length")}
            value={t("field.seasons", { count: contract.length_seasons })}
          />

          {clauses.length > 0 && (
            <div className="mt-3">
              <p className="text-cz-3 text-xs uppercase tracking-wider mb-1.5">
                {t("contract.clausesTitle")}
              </p>
              <ul className="flex flex-col gap-1">
                {clauses.map((clause) => {
                  const Icon = CLAUSE_ICONS[clause.type] ?? CoinIcon;
                  const amount = formatNumber(clause.amount);
                  const text =
                    clause.type === "signing" ? t("clause.signing", { amount })
                    : clause.type === "stage_win" ? t("clause.stageWin", { amount })
                    : clause.type === "podium"
                      ? (cap
                        ? t("clause.podiumCapped", { amount, cap: formatNumber(cap.amount) })
                        : t("clause.podium", { amount }))
                    : clause.type === "season_objective"
                      // #3192: nye tilbud bruger "top_40pct"; allerede-tegnede kontrakter kan
                      // stadig bære det gamle "top_half" (frosset ved pick, uændret retroaktivt).
                      ? t(clause.objective === "top_40pct" ? "clause.seasonObjectiveTop40" : "clause.seasonObjective", { amount })
                    : null;
                  if (!text) return null;
                  return (
                    <li key={clause.type} className="flex items-start gap-1.5 text-xs text-cz-1">
                      <Icon size={13} className="mt-0.5 flex-shrink-0 text-cz-accent-t" aria-hidden="true" />
                      <span>{text}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {earnings && earnings.total > 0 && (
            <div className="mt-3">
              <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">
                {t("contract.earningsTitle")}
              </p>
              {earnings.base > 0 && (
                <Row label={t("contract.earningsBase")} value={`${formatNumber(earnings.base)} CZ$`} />
              )}
              {earnings.signing > 0 && (
                <Row label={t("contract.earningsSigning")} value={`${formatNumber(earnings.signing)} CZ$`} />
              )}
              {earnings.raceDays > 0 && (
                <Row label={t("contract.earningsRaceDays")} value={`${formatNumber(earnings.raceDays)} CZ$`} />
              )}
              {earnings.results > 0 && (
                <Row label={t("contract.earningsResults")} value={`${formatNumber(earnings.results)} CZ$`} />
              )}
              {earnings.objective > 0 && (
                <Row label={t("contract.earningsObjective")} value={`${formatNumber(earnings.objective)} CZ$`} />
              )}
              <Row label={t("contract.earningsTotal")} value={`${formatNumber(earnings.total)} CZ$`} />
            </div>
          )}

          <p className="text-cz-3 text-xs mt-3">
            {t("contract.runsThrough", { season: contract.expires_after_season })}
          </p>
        </>
      )}
    </div>
  );
}
