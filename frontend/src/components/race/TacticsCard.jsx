// TacticsCard — taktik-ordre-kortet (race engine v4, #4030/#4246), "Variant B" fra
// ejer-mockuppet 21/8 (docs/superpowers/specs/2026-08-21-race-tactics-orders-v1-design.md,
// §UI-anatomi). T2-kort UNDER lineup-kortet, på etape-niveau (T1-beslutningen).
//
// KOBLET PÅ DEN RIGTIGE KÆDE (#4246): kortet talte indtil nu med en hukommelses-
// mock uden netværk, så ejeren ikke kunne teste kæden på preview (audit 5/9). Al
// I/O går nu gennem lib/tacticsOrdersAdapter.js mod det live endpoint
// /api/races/:raceId/team-orders. Kortet er stadig gated til dev/preview
// (TACTICS_V4_PREVIEW i RaceDetailPage) indtil ejeren har set det og v4-flippet
// er taget — men det er nu ægte data bag gaten, ikke en attrap.
//
// ROLLEN ER STANDARDORDREN (ejer 2/9). Hver rytterrække viser
// "Standard: jæger · I dag: bliv i feltet": rollen fra holdudtagelsen, og kun de
// afvigelser spilleren har valgt for netop denne etape. Har han intet valgt,
// står der at rytteren kører sin rolle. Standardordren regnes af motorens egen
// kontrakt og kommer med i GET-svaret — fladen genopfinder den ikke.

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import i18n from "i18next";
import { fetchTacticsCard, saveTacticsCard } from "../../lib/tacticsOrdersAdapter.js";
import { useRiderNames } from "../../lib/useRiderNames.js";
import {
  BREAKAWAY_STANCES,
  DEFAULT_EFFORT_KEYS,
  effortCounts,
  hasSprintCaptain,
  isOrderLocked,
  riderIntentKeys,
  roleDefaultFor,
  setBreakawayStance,
  setRiderEffort,
  teamPlanKey,
  toggleLeadout,
  toggleTryBreak,
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

function EffortSegmented({ t, keys, value, disabled, onChange, ariaLabel }) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex rounded-cz border border-cz-border overflow-hidden flex-shrink-0">
      {keys.map((key) => (
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

function TogglePill({ label, ariaLabel, active, disabled, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-cz border px-2 py-1 text-3xs font-medium uppercase tracking-wide transition-colors flex-shrink-0 disabled:opacity-60 disabled:pointer-events-none
        ${active ? "border-cz-accent bg-cz-accent/10 text-cz-accent-t" : "border-cz-accent/40 text-cz-accent-t bg-transparent hover:bg-cz-accent/5"}`}
    >
      {/* Fluebenets plads reserveres altid: uden det skifter pillens BREDDE
          naar den slaas til, og hele knap-kolonnen hopper sidelaens. */}
      <CheckIcon size={10} aria-hidden="true" className={active ? "" : "invisible"} />
      {label}
    </button>
  );
}

export default function TacticsCard({ raceId, stage = 1 }) {
  const { t } = useTranslation("races");
  const [loaded, setLoaded] = useState(null); // fetchTacticsCard-svaret | null
  const [status, setStatus] = useState("idle"); // idle | saving | saved | error

  const load = useCallback(async () => {
    try {
      // `null` = henter, `false` = hentningen fejlede. At skelne dem er hele
      // pointen: en fejlet fetch maa ikke vises som en tom taktik (samme
      // silent-degradation-fund som RaceDetailPage's loadError, #2849).
      setLoaded(await fetchTacticsCard({ raceId, stage }));
    } catch {
      setLoaded(false);
    }
  }, [raceId, stage]);

  useEffect(() => { setLoaded(null); load(); }, [load]);

  const riderIds = useMemo(() => (loaded ? (loaded.riders ?? []).map((r) => r.rider_id) : []), [loaded]);
  const names = useRiderNames(riderIds);

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
  if (loaded === false) {
    return (
      <Section>
        <SectionHeader title={t("tacticsOrders.title")} />
        <p className="text-xs text-cz-3">{t("tacticsOrders.loadError")}</p>
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={load}>{t("tacticsOrders.retry")}</Button>
        </div>
      </Section>
    );
  }

  const { order, defaultOrder, riders, locksAt } = loaded;
  const locked = loaded.locked || isOrderLocked(locksAt);
  const busy = status === "saving";
  const effortKeys = loaded.effortKeys?.length ? loaded.effortKeys : DEFAULT_EFFORT_KEYS;
  const riderName = (id) => names[id] || t("tacticsOrders.riderFallback");
  const captain = riders.find((r) => r.race_role === "captain") || null;
  const plan = teamPlanKey(order.breakaway_stance, captain ? riderName(captain.rider_id) : null);
  const counts = effortCounts(order.riders, effortKeys);
  const orderByRider = new Map(order.riders.map((r) => [r.rider_id, r]));
  const teamHasSprintCaptain = hasSprintCaptain(riders.map((r) => ({ role: r.race_role })));

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
      await saveTacticsCard({ raceId, stage, order });
      setStatus("saved");
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
            {effortKeys.map((k) => `${counts[k] ?? 0} ${t(`tacticsOrders.effort.${k}`).toLowerCase()}`).join(" · ")}
          </p>
        </div>
      </div>

      {/* Rytter-rækker: navn + rolle, "Standard: X · I dag: Y", og dagens knapper. */}
      <div className="flex flex-col gap-3">
        {riders.map((rider) => {
          const id = rider.rider_id;
          const ro = orderByRider.get(id) || { effort: "normal", try_break: false, leadout: false };
          const base = roleDefaultFor(defaultOrder, id);
          const intent = riderIntentKeys(ro, base, ROLE_LABEL_KEY[rider.race_role] || "free_role");
          const name = riderName(id);
          return (
            <div key={id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
              <span className="min-w-0 flex flex-col gap-0.5">
                <span className="text-xs text-cz-1 truncate flex items-baseline gap-1.5">
                  {name}
                  <CategoryTag className="flex-shrink-0">
                    {t(`tacticsOrders.roleLabel.${ROLE_LABEL_KEY[rider.race_role] || "free_role"}`)}
                  </CategoryTag>
                </span>
                {/* #4246: rollen er standardordren, dagens valg er overlayet. */}
                <span className="text-3xs text-cz-3">
                  {t("tacticsOrders.standardPrefix", { role: t(intent.roleKey) })}
                  {". "}
                  {t("tacticsOrders.todayPrefix", {
                    today: intent.todayKeys.length
                      ? intent.todayKeys.map((k) => t(k)).join(", ")
                      : t("tacticsOrders.today.ridesRole"),
                  })}
                </span>
              </span>
              {/* Kontrollerne wrapper paa smalle skaerme i stedet for at skubbe
                  raekken ud over kortets kant (mobil 390: "Sprint train" laa
                  uden for viewporten og gav vandret scroll). */}
              <span className="flex flex-wrap items-center gap-2 w-full justify-start sm:w-auto sm:justify-end">
                <EffortSegmented
                  t={t}
                  keys={effortKeys}
                  value={ro.effort}
                  disabled={locked}
                  onChange={(effort) => updateOrder((o) => setRiderEffort(o, id, effort))}
                  ariaLabel={t("tacticsOrders.effortAria", { name })}
                />
                <TogglePill
                  label={t("tacticsOrders.tryBreak")}
                  ariaLabel={t("tacticsOrders.tryBreakAria", { name })}
                  active={ro.try_break}
                  disabled={locked}
                  onClick={() => updateOrder((o) => toggleTryBreak(o, id))}
                />
                {/* Sprint-toget kan kun sættes når holdet har en spurt-kaptajn
                    at køre for — og han kører aldrig i sit eget tog. Hans plads
                    holdes åben (`invisible`), så knap-kolonnerne står lige ned
                    gennem listen i stedet for at forskyde sig på hans række. */}
                {teamHasSprintCaptain && (
                  <span
                    className={rider.race_role === "sprint_captain" ? "hidden sm:inline-flex sm:invisible" : "inline-flex"}
                    aria-hidden={rider.race_role === "sprint_captain"}
                  >
                    <TogglePill
                      label={t("tacticsOrders.leadout")}
                      ariaLabel={t("tacticsOrders.leadoutAria", { name })}
                      active={ro.leadout}
                      disabled={locked || rider.race_role === "sprint_captain"}
                      onClick={() => updateOrder((o) => toggleLeadout(o, id))}
                    />
                  </span>
                )}
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
          {status === "error" && <span className="text-2xs text-cz-danger">{t("tacticsOrders.saveError")}</span>}
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
