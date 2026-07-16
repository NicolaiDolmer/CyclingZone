// Season Planner — kontekst-skuffe (spec §3B): race-fokus + rytter-fokus.
//
// Race-fokus: rute-profil (Option A glyf+linje, folder ud til Option B etape-strip
// på tap — ejer-valg 13/7) + egne ryttere rangeret efter egnethed (klient-side via
// riderSuitability) + rival-neutralisering + egnetheds-tooltip (profil → matchende
// evner). Rytter-fokus: evne-barer + foreslået build/taper-blok pr. peak m.
// "Auto-plan training" (accept-endpoint) + fjern-peak + vælg-mål-løb.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { riderSuitability } from "../../lib/suitability";
import { riderOverallRating } from "../../lib/riderRating";
import { statStyle } from "../../lib/statColor";
import { Flag } from "../Flag";
import RiderTypeBadge from "../rider/RiderTypeBadge";
import { formatOrdinalShort, statusMeta, riderShortName, dateToOrdinal } from "./plannerShared";

function StageMini({ terrain, summit }) {
  const ink = "var(--text-1)", gold = "rgb(var(--accent-t))";
  let body;
  if (terrain === "mountain") body = <path d="M0 26 L34 6 L66 20 L100 2 L100 28 L0 28 Z" fill={ink} opacity="0.72" />;
  else if (terrain === "hilly") body = <path d="M0 26 L20 14 L40 22 L60 12 L80 20 L100 14 L100 28 L0 28 Z" fill={ink} opacity="0.55" />;
  else if (terrain === "itt" || terrain === "ttt") body = <g><circle cx="50" cy="14" r="8" fill="none" stroke={ink} strokeWidth="2.2" /><line x1="50" y1="14" x2="58" y2="7" stroke={ink} strokeWidth="2.2" /></g>;
  else body = <rect x="0" y="21" width="100" height="6" fill={ink} opacity="0.42" />;
  return (
    <svg viewBox="0 0 100 28" width="100%" height="26" preserveAspectRatio="none" style={{ display: "block", margin: "2px 0" }} aria-hidden="true">
      {body}
      {summit && terrain !== "itt" && terrain !== "ttt" && <circle cx="100" cy={terrain === "mountain" ? 2 : 14} r="3.2" fill={gold} />}
    </svg>
  );
}

function RaceDrawer({ race, riders, maxPerRider, onCreatePeak, busy }) {
  const { t } = useTranslation("planner");
  const [showProfiles, setShowProfiles] = useState(false);
  const summary = race.profileSummary || { stages: race.stages ?? 1, summitFinishes: 0 };

  const ranked = (riders || [])
    .map((rd) => ({ rider: rd, ...riderSuitability(rd.abilities, race.demandVector) }))
    .sort((a, b) => b.score - a.score);
  const demands = ranked[0]?.contributions?.slice(0, 3) || [];

  // #2455: skeln mellem en ÆGTE peak og et endnu-uaccepteret assistent-forslag
  // her, så "Sæt peak" forbliver klikbart (= accept) for et forslag i stedet
  // for at falde tavst til den statiske "allerede topper her"-tekst.
  const peakingSet = new Set();
  const suggestingSet = new Set();
  for (const rd of riders || []) for (const p of rd.peaks || []) {
    if (p.targetRaceId !== race.id) continue;
    if (p.isSuggestion) suggestingSet.add(rd.id); else peakingSet.add(rd.id);
  }

  return (
    <div>
      <div className="flex justify-between items-start border-b border-cz-border pb-2 mb-3 gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <svg width="30" height="18" viewBox="0 0 30 18" aria-hidden="true" className="mt-0.5 shrink-0"><path d="M0 17 L7 5 L12 12 L18 2 L24 10 L30 6 L30 17 Z" fill="var(--text-1)" opacity="0.82" /></svg>
          <div className="min-w-0">
            <div className="font-display text-[20px] leading-none text-cz-1 truncate">{race.name}</div>
            <div className="text-[11px] text-cz-2 mt-0.5">{t("drawer.race.summary", { stages: summary.stages, summits: summary.summitFinishes })} · {t(`terrain.${race.terrain}`)}</div>
          </div>
        </div>
        <div className="text-right text-[10.5px] text-cz-2 shrink-0">
          {t("drawer.race.rivalThreat")}<br />
          <span className="font-mono text-[14px] text-cz-1">{t("drawer.race.rivalCount", { count: race.rivalPeakCount || 0 })}</span>
        </div>
      </div>

      {demands.length > 0 && (
        <div className="text-[10.5px] text-cz-3 mb-2">
          <span className="uppercase tracking-wide">{t("drawer.race.demands")}:</span>{" "}
          {demands.map((d, i) => <span key={d.ability}>{i > 0 ? " · " : ""}{d.ability.replace(/_/g, " ")}</span>)}
        </div>
      )}

      {race.stageProfiles?.length > 1 && (
        <>
          <button
            className="flex items-center gap-1.5 border border-cz-border rounded-cz px-2.5 py-1.5 text-[11px] text-cz-1 hover:bg-cz-subtle mb-2"
            aria-expanded={showProfiles} onClick={() => setShowProfiles((v) => !v)}
          >
            <i className="ti ti-chart-area-line text-[15px] text-cz-accent-t" aria-hidden="true" />
            {showProfiles ? t("drawer.race.hideProfiles") : t("drawer.race.viewProfiles")}
            <i className={`ti ti-chevron-${showProfiles ? "up" : "down"} text-[15px]`} aria-hidden="true" />
          </button>
          {showProfiles && (
            <div className="grid gap-1.5 mb-3" style={{ gridTemplateColumns: `repeat(${Math.min(6, race.stageProfiles.length)}, minmax(0, 1fr))` }}>
              {race.stageProfiles.slice(0, 12).map((s) => (
                <div key={s.stage} className={`rounded-cz p-1.5 text-center ${s.summit ? "bg-cz-subtle border border-cz-accent-t" : "bg-cz-body border border-cz-border"}`}>
                  <div className="font-mono text-[9px] text-cz-3">S{s.stage}</div>
                  <StageMini terrain={s.terrain} summit={s.summit} />
                  <div className={`text-[9px] ${s.summit ? "text-cz-accent-t" : "text-cz-2"}`}>{t(`terrain.${s.terrain}`)}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="text-[10.5px] text-cz-3 uppercase tracking-wide mb-1.5">{t("drawer.race.rankedTitle")}</div>
      <div className="flex flex-col gap-1.5">
        {ranked.map(({ rider, score, contributions }) => {
          const peaking = peakingSet.has(rider.id);
          const suggestingHere = suggestingSet.has(rider.id);
          // #2455: kun ÆGTE peaks tæller mod maks — et uaccepteret forslag må
          // ikke blokere manageren fra at acceptere (=oprette) det via denne knap.
          const realPeakCount = (rider.peaks || []).filter((p) => !p.isSuggestion).length;
          const maxed = realPeakCount >= maxPerRider;
          const top = contributions.slice(0, 2).map((c) => `${c.ability.replace(/_/g, " ")} ${c.value}`).join(" · ");
          return (
            <div key={rider.id} className="flex items-center gap-2.5">
              <span className="w-6 shrink-0 flex items-center justify-center">
                {rider.nationality ? <Flag code={rider.nationality} className="text-[12px]" /> : <span className="font-mono text-[9.5px] text-cz-2">—</span>}
              </span>
              <span className="text-[12px] text-cz-1 w-28 truncate" title={top}>{riderShortName(rider)}</span>
              <span className="flex-1 h-2 bg-cz-subtle rounded-sm overflow-hidden" title={top}>
                <span className="block h-full rounded-sm" style={{ width: `${score}%`, background: score > 70 ? "var(--text-1)" : score > 45 ? "var(--text-2)" : "var(--text-3)" }} />
              </span>
              <span className="font-mono text-[12px] text-cz-1 w-6 text-right">{score}</span>
              {peaking ? (
                <span className="text-[10px] text-cz-accent-t w-[74px] text-right">✓ {t("drawer.race.alreadyPeaking")}</span>
              ) : (
                <div className="flex flex-col items-end gap-0.5 w-[74px]">
                  {suggestingHere && <span className="text-[9px] text-cz-3">✦ {t("drawer.race.suggestedHere")}</span>}
                  <button
                    className="text-[10.5px] border border-cz-border rounded-cz px-2 py-1 hover:bg-cz-subtle disabled:opacity-40"
                    disabled={busy || maxed} onClick={() => onCreatePeak(rider.id, race.id)}
                  >{t("drawer.race.setPeak")}</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AbilityBars({ abilities }) {
  const entries = Object.entries(abilities || {}).map(([k, v]) => ({ k, v: Number(v) || 0 })).sort((a, b) => b.v - a.v).slice(0, 6);
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
      {entries.map(({ k, v }) => (
        <div key={k} className="flex items-center gap-2">
          <span className="text-[11px] text-cz-2 w-20 capitalize truncate">{k.replace(/_/g, " ")}</span>
          <span className="flex-1 h-1.5 bg-cz-subtle rounded-sm overflow-hidden"><span className="block h-full" style={{ width: `${v}%`, background: "var(--text-1)" }} /></span>
          <span className="font-mono text-[11px] text-cz-1 w-6 text-right">{v}</span>
        </div>
      ))}
    </div>
  );
}

function RiderDrawer({ rider, races, maxPerRider, months, today, onCreatePeak, onRemovePeak, onAccept, onAcceptSuggestion, onDismissSuggestion, busy }) {
  const { t } = useTranslation("planner");
  const ovr = riderOverallRating({ ...rider.abilities, primary_type: rider.primaryType });
  // #2455: kun ÆGTE peaks tæller mod maks — uaccepterede forslag fylder ikke
  // "pick a target race"-dropdownen op (den ville ellers ALDRIG vises for en
  // rytter assistenten allerede har foreslået to peaks til).
  const canAddPeak = (rider.peaks || []).filter((p) => !p.isSuggestion).length < maxPerRider;
  const todayOrd = dateToOrdinal(today);
  const targetable = (races || []).filter((r) => r.isMine && r.date
    && (todayOrd == null || (dateToOrdinal(r.date) ?? -Infinity) >= todayOrd)
    && !(rider.peaks || []).some((p) => p.targetRaceId === r.id))
    .sort((a, b) => (dateToOrdinal(a.date) || 0) - (dateToOrdinal(b.date) || 0));

  return (
    <div>
      <div className="flex justify-between items-center border-b border-cz-border pb-2 mb-3">
        <div>
          <div className="font-display text-[20px] leading-none text-cz-1">{riderShortName(rider)}</div>
          <div className="flex items-center gap-2 mt-1.5">
            {rider.primaryType && <RiderTypeBadge primaryType={rider.primaryType} secondaryType={rider.secondaryType} size="sm" />}
            {rider.nationality && <Flag code={rider.nationality} className="text-[14px]" />}
          </div>
        </div>
        {/* #2447: OVR-badge farvet efter statStyle (samme SSOT som auktioner/rytter-
            profil) i stedet for plain cz-1-tekst uden nogen farve-signal. */}
        <div className="text-right flex flex-col items-end gap-1">
          <span className="inline-flex items-center justify-center min-w-[34px] font-mono font-bold text-[16px] px-1.5 py-0.5 rounded" style={statStyle(ovr)}>{ovr}</span>
          <div className="text-[8px] text-cz-3 font-mono">{t("ovr.label")}</div>
        </div>
      </div>

      <div className="text-[10.5px] text-cz-3 uppercase tracking-wide mb-1.5">{t("drawer.rider.abilities")}</div>
      <AbilityBars abilities={rider.abilities} />

      <div className="mt-4 flex flex-col gap-3">
        {(rider.peaks || []).length === 0 && <div className="text-[11.5px] text-cz-2">{t("drawer.rider.noPeak")}</div>}
        {(rider.peaks || []).map((p) => {
          const meta = statusMeta(p.status);
          const block = p.suggestedTrainingBlock;
          const focus = block?.recommendedFocus;
          // #2455: et FORSLAG er hverken låst, redigerbart via accept-training
          // (ingen ægte plan-id endnu), eller fjernbart med den normale "Remove
          // peak" — det accepteres (→ opretter en ægte plan, samme knap-mønster
          // som RaceDrawer's "Sæt peak") eller nulstilles (helt program, ikke
          // ét peak ad gangen — matcher issue-krav "nulstille til blank").
          return (
            <div key={p.id} className={`border rounded-cz p-3 ${p.isSuggestion ? "border-dashed border-cz-accent-t" : "border-cz-border"}`}>
              <div className="flex justify-between items-center mb-1.5 gap-2">
                <div className="text-[12.5px] text-cz-1 font-medium flex items-center gap-1.5 min-w-0">
                  <span className="truncate">{t("drawer.rider.peakFor", { race: p.targetRaceName || "—" })}</span>
                  {p.isSuggestion && (
                    <span className="shrink-0 text-[9px] font-normal text-cz-accent-t border border-cz-accent-t rounded-full px-1.5 py-0.5">
                      ✦ {t("assistant.badge")}
                    </span>
                  )}
                </div>
                {p.isSuggestion ? (
                  <button className="shrink-0 text-[10.5px] text-cz-2 hover:text-cz-1 disabled:opacity-40" disabled={busy} onClick={() => onDismissSuggestion(rider.id)}>
                    {t("assistant.reset")}
                  </button>
                ) : (
                  <button className="shrink-0 text-[10.5px] text-cz-2 hover:text-cz-1 disabled:opacity-40" disabled={busy || p.locked} onClick={() => onRemovePeak(p.id)}>
                    <i className="ti ti-x text-[13px]" aria-hidden="true" /> {t("drawer.rider.removePeak")}
                  </button>
                )}
              </div>
              <div className="text-[10.5px] text-cz-2 mb-2">
                {t("drawer.rider.windowLabel", { start: formatOrdinalShort(dateToOrdinal(p.windowStart), months), end: formatOrdinalShort(dateToOrdinal(p.windowEnd), months) })}
                {/* #2447: "var(--text-accent-t, ...)" var en ikke-eksisterende CSS-var
                    (rigtig token er kanal-formatet --accent-t, brugt via rgb()) — den
                    faldt derfor altid tilbage til den neutrale --text-2, så "peak i
                    fare" aldrig fik sin advarselsfarve i noget tema. */}
                {!p.isSuggestion && <>{" · "}<span style={{ color: meta.tone === "warn" ? "rgb(var(--accent-t))" : undefined }}>{meta.glyph} {t(`status.${meta.key}`)}</span></>}
              </div>
              {p.isSuggestion && (
                <div className="text-[10.5px] text-cz-3 mb-2">
                  {t(p.suggestionReason === "registered" ? "assistant.reasonRegistered" : "assistant.reasonSuitability")}
                </div>
              )}
              {focus && <div className="text-[10.5px] text-cz-3 mb-2">{t("drawer.rider.focus", { focus: t(`focus.${focus}`, focus) })}</div>}
              {p.isSuggestion ? (
                <button className="text-[10.5px] border border-cz-accent-t text-cz-accent-t rounded-cz px-2.5 py-1.5 hover:bg-cz-subtle disabled:opacity-40" disabled={busy} onClick={() => onAcceptSuggestion(rider.id, p.targetRaceId)}>
                  <i className="ti ti-check text-[12px]" aria-hidden="true" /> {t("assistant.accept")}
                </button>
              ) : block && (
                <div className="flex gap-2 flex-wrap">
                  <button className="text-[10.5px] border border-cz-border rounded-cz px-2.5 py-1.5 hover:bg-cz-subtle disabled:opacity-40" disabled={busy} onClick={() => onAccept(p.id, "build", rider)}>
                    <i className="ti ti-arrow-up-right text-[12px]" aria-hidden="true" /> {t("drawer.rider.build")} · {t("drawer.rider.autoPlan")}
                  </button>
                  <button className="text-[10.5px] border border-cz-border rounded-cz px-2.5 py-1.5 hover:bg-cz-subtle disabled:opacity-40" disabled={busy} onClick={() => onAccept(p.id, "taper", rider)}>
                    <i className="ti ti-arrow-down-right text-[12px]" aria-hidden="true" /> {t("drawer.rider.taper")} · {t("drawer.rider.autoPlan")}
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {canAddPeak && targetable.length > 0 && (
          <label className="flex flex-col gap-1 mt-1">
            <span className="text-[10.5px] text-cz-3 uppercase tracking-wide">{t("drawer.rider.pickRace")}</span>
            <select
              className="bg-cz-card border border-cz-border rounded-cz px-2 py-1.5 text-[12px] text-cz-1"
              value="" disabled={busy}
              onChange={(e) => { if (e.target.value) onCreatePeak(rider.id, e.target.value); }}
            >
              <option value="">—</option>
              {targetable.map((r) => (
                <option key={r.id} value={r.id}>{formatOrdinalShort(dateToOrdinal(r.date), months)} · {r.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

export default function PlannerDrawer({ mode, race, rider, riders, races, maxPerRider, months, today, onClose, onCreatePeak, onRemovePeak, onAccept, onAcceptSuggestion, onDismissSuggestion, busy }) {
  const { t } = useTranslation("planner");
  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-4 relative">
      <button className="absolute top-3 right-3 text-cz-2 hover:text-cz-1" aria-label={t("drawer.close")} onClick={onClose}>
        <i className="ti ti-x text-[18px]" aria-hidden="true" />
      </button>
      {mode === "race" && race && <RaceDrawer race={race} riders={riders} maxPerRider={maxPerRider} onCreatePeak={onCreatePeak} busy={busy} />}
      {mode === "rider" && rider && (
        <RiderDrawer
          rider={rider} races={races} maxPerRider={maxPerRider} months={months} today={today}
          onCreatePeak={onCreatePeak} onRemovePeak={onRemovePeak} onAccept={onAccept}
          onAcceptSuggestion={onAcceptSuggestion} onDismissSuggestion={onDismissSuggestion}
          busy={busy}
        />
      )}
    </div>
  );
}
