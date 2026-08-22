// TacticsCard — taktik-ordre-kortet (race engine v4 v1, #4030), "Variant B" fra
// ejer-mockuppet 21/8 (docs/superpowers/specs/2026-08-21-race-tactics-orders-v1-design.md,
// §UI-anatomi). T2-kort UNDER lineup-kortet, på etape-niveau (T1-beslutningen).
//
// PREVIEW-KORT: orders-API'et bygges parallelt i et andet spor og findes ikke
// endnu. Al I/O går gennem lib/tacticsOrdersAdapter.js (mock nu, ét-linjes-skift
// til den rigtige endpoint ved integration — se den fils hoved-kommentar).
// Renderes derfor KUN i dev/preview (se TACTICS_V4_PREVIEW), aldrig i en rigtig
// produktions-build, indtil det er wired og ejer-godkendt visuelt.
//
// `riders` (de udtagne ryttere: id/name/role) sendes ind fra parent når den
// allerede har dem (lineup-kortet lige ovenfor); mangler prop'en bruger kortet
// et deterministisk mock-roster, så det også kan renderes helt isoleret.

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import i18n from "i18next";
import { fetchTacticsCard, saveTacticsCard, mockRosterFor } from "../../lib/tacticsOrdersAdapter.js";
import {
  BREAKAWAY_STANCES,
  EFFORT_KEYS,
  effortCounts,
  setRiderEffort,
  toggleTryBreak,
  setBreakawayStance,
  isOrderLocked,
  teamPlanKey,
} from "../../lib/tacticsPlan.js";
import { formatLocalTime } from "../../lib/intl.js";
import { Section, SectionHeader, Button, CategoryTag, LockIcon, CheckIcon, Skeleton } from "../ui/index.js";

const ROLE_LABEL_KEY = { captain: "captain", sprint_captain: "sprint_captain", hunter: "hunter", helper: "helper", free_role: "free_role" };

function lockMeta(t, locksAt, locked) {
  if (locked) return t("tacticsOrders.locked");
  if (!locksAt) return null;
  const d = new Date(locksAt);
  if (Number.isNaN(d.getTime())) return null;
  const weekday = new Intl.DateTimeFormat(i18n.language || "en", { weekday: "short" }).format(d);
  return t("tacticsOrders.locksAt", { time: `${weekday} ${formatLocalTime(d)}` });
}

function EffortSegmented({ t, value, disabled, onChange, ariaLabel }) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex rounded-cz border border-cz-border overflow-hidden flex-shrink-0">
      {EFFORT_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          disabled={disabled}
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={`px-2 py-1 text-3xs font-medium uppercase tracking-wide transition-colors disabled:opacity-60 disabled:pointer-events-none
            ${value === key ? "bg-cz-accent/10 text-cz-accent-t" : "bg-cz-card text-cz-3 hover:text-cz-1"}`}
        >
          {t(`tacticsOrders.effort.${key}`)}
        </button>
      ))}
    </div>
  );
}

function TryBreakToggle({ t, active, disabled, onClick, name }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      aria-label={t("tacticsOrders.tryBreakAria", { name })}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-cz border px-2 py-1 text-3xs font-medium uppercase tracking-wide transition-colors flex-shrink-0 disabled:opacity-60 disabled:pointer-events-none
        ${active ? "border-cz-accent bg-cz-accent/10 text-cz-accent-t" : "border-cz-accent/40 text-cz-accent-t bg-transparent hover:bg-cz-accent/5"}`}
    >
      {active && <CheckIcon size={10} aria-hidden="true" />}
      {t("tacticsOrders.tryBreak")}
    </button>
  );
}

export default function TacticsCard({ raceId, stage = 1, riders: ridersProp }) {
  const { t } = useTranslation("races");
  const [loaded, setLoaded] = useState(null); // { order, locksAt } | null
  const [status, setStatus] = useState("idle"); // idle | saving | saved | error

  const riders = ridersProp && ridersProp.length > 0 ? ridersProp : mockRosterFor(raceId, stage);
  const riderIds = riders.map((r) => r.id);
  const ridersKey = riderIds.join(",");

  const load = useCallback(async () => {
    const res = await fetchTacticsCard({ raceId, stage, riderIds: ridersKey ? ridersKey.split(",") : [] });
    setLoaded(res);
  }, [raceId, stage, ridersKey]);

  useEffect(() => { setLoaded(null); load(); }, [load]);

  if (!raceId) return null;
  if (loaded === null) {
    return (
      <Section>
        <SectionHeader title={t("tacticsOrders.title")} />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-5/6" />
        </div>
      </Section>
    );
  }

  const { order, locksAt } = loaded;
  const locked = isOrderLocked(locksAt);
  const busy = status === "saving";
  const captain = riders.find((r) => r.role === "captain") || null;
  const plan = teamPlanKey(order.breakaway_stance, captain?.name || null);
  const counts = effortCounts(order.riders);
  const orderByRider = new Map(order.riders.map((r) => [r.rider_id, r]));

  // `transform` regner altid på `cur.order` INDE i den funktionelle updater —
  // aldrig på render-scope'ets `order` direkte. To klik der lander i samme
  // batch (før en re-render, fx et hurtigt dobbeltklik på to forskellige
  // kontroller) ville ellers begge læse den samme forældede `order` og det
  // sidste klik overskriver/taber det første (verificeret manuelt: "Try the
  // break" + en effort-ændring i samme klik-batch mistede effort-ændringen).
  function updateOrder(transform) {
    setLoaded((cur) => ({ ...cur, order: transform(cur.order) }));
    setStatus("idle");
  }

  async function handleSave() {
    setStatus("saving");
    try {
      const res = await saveTacticsCard({ raceId, stage, order });
      setStatus(res?.ok ? "saved" : "error");
    } catch {
      setStatus("error");
    }
  }

  if (riders.length === 0) {
    return (
      <Section>
        <SectionHeader title={t("tacticsOrders.title")} />
        <p className="text-xs text-cz-3">{t("tacticsOrders.empty")}</p>
      </Section>
    );
  }

  return (
    <Section data-testid="tactics-card">
      <SectionHeader title={t("tacticsOrders.title")} meta={lockMeta(t, locksAt, locked)} />

      {/* Tre oversigtsfelter (spec §UI-anatomi): Team plan · Breakaway · Effort. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 pb-4 border-b border-cz-border">
        <div>
          <p className="text-3xs uppercase tracking-wide text-cz-3">{t("tacticsOrders.planLabel")}</p>
          <p className="text-xs text-cz-1 mt-0.5 leading-snug">{t(plan.key, plan.params)}</p>
        </div>
        <div>
          <p className="text-3xs uppercase tracking-wide text-cz-3 mb-1">{t("tacticsOrders.breakawayLabel")}</p>
          <div role="group" aria-label={t("tacticsOrders.breakawayAria")} className="flex rounded-cz border border-cz-border overflow-hidden w-fit">
            {BREAKAWAY_STANCES.map((stance) => (
              <button
                key={stance}
                type="button"
                disabled={locked}
                aria-pressed={order.breakaway_stance === stance}
                onClick={() => updateOrder((o) => setBreakawayStance(o, stance))}
                className={`px-2 py-1 text-3xs font-medium transition-colors disabled:opacity-60 disabled:pointer-events-none
                  ${order.breakaway_stance === stance ? "bg-cz-accent/10 text-cz-accent-t" : "bg-cz-card text-cz-2 hover:text-cz-1"}`}
              >
                {t(`tacticsOrders.breakaway.${stance}`)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-3xs uppercase tracking-wide text-cz-3">{t("tacticsOrders.effortLabel")}</p>
          <p className="text-xs text-cz-1 mt-0.5 font-data tabular-nums">
            {t("tacticsOrders.effortSummary", counts)}
          </p>
        </div>
      </div>

      {/* Rytter-rækker: navn + rolle + effort-segmenteret + "Try the break"-pill. */}
      <div className="flex flex-col gap-2">
        {riders.map((rider) => {
          const ro = orderByRider.get(rider.id) || { effort: "normal", try_break: false };
          return (
            <div key={rider.id} className="flex flex-wrap items-center justify-between gap-2 py-1">
              <span className="text-xs text-cz-1 min-w-0 truncate flex items-baseline gap-1.5">
                {rider.name}
                {rider.role && (
                  <CategoryTag className="flex-shrink-0">
                    {t(`tacticsOrders.roleLabel.${ROLE_LABEL_KEY[rider.role] || "helper"}`)}
                  </CategoryTag>
                )}
              </span>
              <span className="flex items-center gap-2 flex-shrink-0">
                <EffortSegmented
                  t={t}
                  value={ro.effort}
                  disabled={locked}
                  onChange={(effort) => updateOrder((o) => setRiderEffort(o, rider.id, effort))}
                  ariaLabel={t("tacticsOrders.effortAria", { name: rider.name })}
                />
                <TryBreakToggle
                  t={t}
                  active={ro.try_break}
                  disabled={locked}
                  onClick={() => updateOrder((o) => toggleTryBreak(o, rider.id))}
                  name={rider.name}
                />
              </span>
            </div>
          );
        })}
      </div>

      {locked ? (
        <p className="mt-4 pt-3 border-t border-cz-border text-3xs text-cz-3 flex items-center gap-1.5">
          <LockIcon size={12} aria-hidden="true" /> {t("tacticsOrders.lockedNote")}
        </p>
      ) : (
        <div className="mt-4 pt-3 border-t border-cz-border flex items-center justify-end gap-3">
          {status === "saved" && <span className="text-2xs text-cz-success">{t("tacticsOrders.saved")}</span>}
          {/* Sekundær knap (ikke guld) — lineup-kortets Gem er allerede holdets
              primære handling på denne side, jf. reglen om én guld-primær pr. view. */}
          <Button variant="secondary" size="sm" onClick={handleSave} loading={busy}>
            {t("tacticsOrders.save")}
          </Button>
        </div>
      )}
    </Section>
  );
}
