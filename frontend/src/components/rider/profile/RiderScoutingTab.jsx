// RiderScoutingTab — Scouting-fanen på rytterprofilen (#1543 Fase 1).
//
// Viser den server-beregnede scouting-rapport (GET /api/riders/:id/scouting-report):
//   • Scout verdict — klart sprog ("Din spejders vurdering" / "Talentspejder-
//     rapport"), confidence-chip og 4 understøttende faktorer. Ingen jargon.
//   • Potentiale pr. ryttertype — nuværende rating + skraveret LOFT-BÅND pr. type.
//     Loftet er ALTID et bånd (#1543 beslutning 3: ingen når 100% præcision, heller
//     ikke på egne ryttere — beslutning 4).
//   • Røverkøb? — markedsværdi vs. modellens forventede værdi; kun sammenligningen
//     og en one-line read, INGEN verdict-label (design-SSOT).
// Rå potentiale/ability_caps findes ALDRIG i klienten (#1162) — alt er bånd.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PotentialeStars from "../../PotentialeStars";
import { SearchIcon } from "../../ui";
import { getSession } from "../../../lib/supabase";
import { formatCz } from "../../../lib/marketValues";

const API = import.meta.env.VITE_API_URL;

// Samme spektrum-orden som Overblik-radarens akser (flade spurtere → klatrere).
const TYPE_ORDER = [
  "sprinter", "puncheur", "brostensrytter", "baroudeur",
  "rouleur", "tt", "gc", "climber",
];

const CONFIDENCE_STYLE = {
  high: "bg-cz-success-bg text-cz-success border-cz-success/30",
  medium: "bg-cz-subtle text-cz-2 border-cz-border",
  low: "bg-cz-warning-bg text-cz-warning border-cz-warning/30",
};

function SectionCard({ children }) {
  return (
    <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
      {children}
    </div>
  );
}

function Eyebrow({ children }) {
  return (
    <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-cz-accent-t">
      {children}
    </span>
  );
}

// Én ryttertype-række: navn · bar (nu-fyld + skraveret loft-bånd) · nu / loft-tal.
function TypeRow({ typeKey, now, ceilLo, ceilHi, label }) {
  const pct = (v) => `${Math.max(0, Math.min(99, v)) / 0.99}%`;
  return (
    <div className="flex items-center gap-3" data-type={typeKey}>
      <span className="w-[110px] flex-shrink-0 text-[12px] text-cz-2 truncate">{label}</span>
      <div className="relative flex-1 h-[7px] rounded-full bg-cz-subtle overflow-hidden" aria-hidden="true">
        <div className="absolute inset-y-0 left-0 bg-cz-accent rounded-full" style={{ width: pct(now) }} />
        <div
          className="absolute inset-y-0 bg-cz-accent/25 border-x border-cz-accent/50"
          style={{ left: pct(ceilLo), width: `calc(${pct(ceilHi)} - ${pct(ceilLo)})` }}
        />
      </div>
      <span className="w-[86px] flex-shrink-0 text-right font-mono tabular-nums text-[11.5px]">
        <span className="text-cz-1 font-bold">{now}</span>
        <span className="text-cz-3"> · {ceilLo}–{ceilHi}</span>
      </span>
    </div>
  );
}

export default function RiderScoutingTab({ rider, scouting }) {
  const { t } = useTranslation("rider");
  const { t: tTypes } = useTranslation("riderTypes");
  const [report, setReport] = useState(null);   // null = loader, ellers payload
  const [failed, setFailed] = useState(false);
  // #2465: scout() returnerer eksplicit {ok, error} — handlingen koster CZ$, så en
  // fejl (fuld kapacitet, ikke nok CZ$, netværk) skal vises, ikke forsvinde stille.
  const [scoutError, setScoutError] = useState(null);

  const riderId = rider?.id;
  const {
    maxLevel, scout, scoutingId, slots, levels,
    scoutSystemEnabled, jobCapacity, jobActiveCount, jobConfig, pendingFor,
  } = scouting;
  // Scout-niveauet kan også stige via hero'ens scout-knap (useScouting er delt
  // side-state) — genindlæs rapporten når niveauet ændrer sig, uanset hvor der
  // blev scoutet fra.
  const hookLevel = levels?.[riderId] ?? 0;
  // #2244: mens job-modellen er 'on' er der ingen slots — en aktiv målrettet
  // opgave på DENNE rytter blokerer knappen ("Spejderen arbejder"), uanset
  // holdets samlede kapacitet (det håndteres af knap-disable nedenfor).
  const pending = scoutSystemEnabled ? pendingFor?.(riderId) : undefined;

  const load = useCallback(async () => {
    if (!riderId) return;
    try {
      const { data } = await getSession();
      const token = data?.session?.access_token;
      if (!token) { setFailed(true); return; }
      const res = await fetch(`${API}/api/riders/${riderId}/scouting-report`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("report_failed");
      setReport(await res.json());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [riderId]);

  useEffect(() => { setReport(null); load(); }, [load]);
  useEffect(() => { if (hookLevel > 0) load(); }, [hookLevel, load]);

  const level = report?.level ?? 0;
  const remaining = scoutSystemEnabled ? Math.max(0, jobCapacity - jobActiveCount) : (slots?.remaining ?? 0);
  const busy = scoutingId === riderId;
  const canScout = remaining > 0 && level < maxLevel && !busy && !pending;

  const handleScout = async () => {
    if (!canScout) return;
    setScoutError(null);
    const r = await scout(riderId);
    if (r?.ok) {
      // Job-model: niveauet ændrer sig først når opgaven modner (dagens sweep) —
      // genindlæs IKKE rapporten her (intet nyt at vise endnu). Legacy-model:
      // slot-brug ændrer niveauet med det samme → genindlæs.
      if (!scoutSystemEnabled) load();
    } else {
      setScoutError(r?.error || "failed");
    }
  };

  // #2244: job-model-knappen viser opgavens pris fra jobConfig i GET /scouting/me
  // (SSOT: backend scoutEngine.SCOUT_JOB_CONFIG.target); fallbacks dækker kun
  // vinduet før første fetch.
  // TONE: "Send scout"/"Send spejder"-copy er plain/factual v1 — ejer-tone-session
  // for scouting-job-copy er stadig åben (spec §Åbne detaljer); review pending.
  const TARGET_JOB_DAYS = jobConfig?.targetDaysPerLevel ?? 3;
  const TARGET_JOB_COST = jobConfig?.targetCostPerLevel ?? 1000;

  const scoutButton = (labelKey) => {
    if (pending) {
      return (
        <span className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-cz border border-cz-border text-cz-2 whitespace-nowrap">
          <SearchIcon size={13} aria-hidden="true" className="flex-shrink-0" />
          {t("scouting.pendingJob", { days: pending.days })}
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={handleScout}
        disabled={!canScout}
        title={remaining <= 0 ? t("scouting.noSlots") : t("scouting.scoutTitle")}
        className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-cz border border-cz-border text-cz-1 hover:bg-cz-subtle disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
      >
        <SearchIcon size={13} aria-hidden="true" className="flex-shrink-0" />
        {busy
          ? t("scouting.scouting")
          : scoutSystemEnabled
            ? t("scouting.sendScoutJob", { days: TARGET_JOB_DAYS, cost: TARGET_JOB_COST })
            : t(labelKey)}
        {!scoutSystemEnabled && slots && <span className="text-cz-3 font-mono text-[10.5px]">{slots.remaining}/{slots.total}</span>}
      </button>
    );
  };

  if (failed) {
    return (
      <SectionCard>
        <p className="text-cz-2 text-[12.5px] m-0">{t("profile.scouting.loadFailed")}</p>
      </SectionCard>
    );
  }
  if (!report) {
    return (
      <SectionCard>
        <p className="text-cz-3 text-[12.5px] m-0">{t("profile.scouting.loading")}</p>
      </SectionCard>
    );
  }

  // FØR: uscoutet, ikke-egen rytter — intet potentiale, kun invitationen.
  if (report.hidden) {
    return (
      <SectionCard>
        <Eyebrow>{t("profile.scouting.eyebrowOther")}</Eyebrow>
        <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mt-2">
          {t("profile.scouting.notScoutedTitle")}
        </h3>
        <p className="text-cz-2 text-[12.5px] leading-[1.55] mt-2 mb-3 max-w-prose">
          {t("profile.scouting.notScoutedBody")}
        </p>
        {scoutButton("scouting.scout")}
        {scoutError && (
          <p role="alert" className="mt-2 text-[11px] text-cz-danger">
            {t([`profile.scouting.scoutErrors.${scoutError}`, "profile.scouting.scoutFailed"])}
          </p>
        )}
      </SectionCard>
    );
  }

  const { verdict, types, stars, value, own } = report;
  const orderedTypes = TYPE_ORDER
    .map((key) => types?.find((x) => x.key === key))
    .filter(Boolean);

  return (
    <div className="space-y-3">
      {/* EFTER: verdict-kortet — spejderens vurdering i klart sprog. */}
      <SectionCard>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <Eyebrow>{t(own ? "profile.scouting.eyebrowOwn" : "profile.scouting.eyebrowOther")}</Eyebrow>
            <div className="flex items-center gap-2.5 mt-2 flex-wrap">
              <h3 className="font-display text-[21px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0">
                {verdict ? t(`profile.scouting.headline_${verdict.headlineKey}`) : t("profile.scouting.capsMissingTitle")}
              </h3>
              {verdict && (
                <span className={`text-[10px] font-mono font-bold uppercase tracking-[0.08em] px-2 py-0.5 rounded-cz border ${CONFIDENCE_STYLE[verdict.confidence] ?? CONFIDENCE_STYLE.medium}`}>
                  {t(`profile.scouting.confidence_${verdict.confidence}`)}
                </span>
              )}
            </div>
          </div>
          <div className="text-right">
            <span className="block font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-cz-3">
              {t("profile.scouting.potentialLabel")}
            </span>
            <div className="mt-1">
              {stars ? (
                <PotentialeStars range={stars} birthdate={rider.birthdate} />
              ) : (
                <PotentialeStars value={null} />
              )}
            </div>
            {!own && (
              <span className="block text-[10px] font-mono text-cz-3 mt-0.5" title={t("scouting.levelTitle")}>
                {level}/{maxLevel}
              </span>
            )}
          </div>
        </div>
        {verdict && (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-3.5 pt-3 border-t border-cz-border list-none p-0 m-0">
            {verdict.factorKeys.map((k) => (
              <li key={k} className="flex items-start gap-2 text-[12px] text-cz-2">
                <span className="text-cz-success mt-px flex-shrink-0" aria-hidden="true">✓</span>
                {t(`profile.scouting.factor_${k}`)}
              </li>
            ))}
          </ul>
        )}
        {!own && level < maxLevel && (
          <div className="mt-3.5 pt-3 border-t border-cz-border flex items-center gap-3 flex-wrap">
            <p className="text-cz-3 text-[12px] m-0">{t("profile.scouting.rescoutHint")}</p>
            {scoutButton("scouting.rescout")}
            {scoutError && (
              <p role="alert" className="text-[11px] text-cz-danger w-full m-0">
                {t([`profile.scouting.scoutErrors.${scoutError}`, "profile.scouting.scoutFailed"])}
              </p>
            )}
          </div>
        )}
      </SectionCard>

      {/* Potentiale pr. ryttertype — nu + skraveret loft-bånd. */}
      {orderedTypes.length > 0 && (
        <SectionCard>
          <div className="flex items-baseline justify-between gap-2 mb-3">
            <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0">
              {t("profile.scouting.typesTitle")}
            </h3>
            <span className="text-[10.5px] text-cz-3">{t("profile.scouting.typesSubtitle")}</span>
          </div>
          <div className="space-y-2">
            {orderedTypes.map((row) => (
              <TypeRow key={row.key} typeKey={row.key} now={row.now} ceilLo={row.ceilLo} ceilHi={row.ceilHi}
                label={tTypes(`types.${row.key}`)} />
            ))}
          </div>
          <p className="text-cz-3 text-[10.5px] mt-3 mb-0">{t("profile.scouting.typesLegend")}</p>
        </SectionCard>
      )}

      {report.capsMissing && (
        <SectionCard>
          <p className="text-cz-2 text-[12.5px] m-0">{t("profile.scouting.capsMissingBody")}</p>
        </SectionCard>
      )}

      {/* Røverkøb? — sammenligning + one-line read, ingen verdict-label.
          Skjules når markedsværdi == modelværdi (tautologi — market_value ER
          i dag modelbaseret for ryttere uden auktions-drift; kortet siger så
          intet. Får reel signalværdi når expected bliver potentiale-justeret
          i Fase 2/3). */}
      {value && value.expected !== value.market && (
        <SectionCard>
          <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mb-3">
            {t("profile.scouting.valueTitle")}
          </h3>
          <div className="grid grid-cols-2 gap-3 max-w-[420px]">
            <div>
              <span className="block font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-cz-3">
                {t("profile.scouting.valueMarket")}
              </span>
              <span className="block font-display text-[19px] text-cz-1 mt-0.5">{formatCz(value.market)}</span>
            </div>
            <div>
              <span className="block font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-cz-3">
                {t("profile.scouting.valueExpected")}
              </span>
              <span className="block font-display text-[19px] text-cz-1 mt-0.5">{formatCz(value.expected)}</span>
            </div>
          </div>
          <p className="text-cz-2 text-[12px] mt-2.5 mb-0 max-w-prose">
            {t(value.expected > (value.market ?? 0)
              ? "profile.scouting.valueReadAbove"
              : "profile.scouting.valueReadBelow")}
          </p>
        </SectionCard>
      )}
    </div>
  );
}
