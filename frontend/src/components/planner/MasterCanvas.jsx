// Season Planner — master-canvas (desktop SVG kampagne-bræt, spec §3A / Direction E).
//
// Én lane pr. rytter: venstre skinne (nation, navn, OVR, type, akademi), midten =
// form-kurve over den tids-proportionale sæson-akse (potentiel top stiplet vs
// realiseret fyldt = koblingen synlig, spec §2), build/taper-skygge, payback-hul,
// NOW-markør; højre skinne = peak-tokens + trænings-status-chip. Løb-hoveder +
// rytter-navne er tastatur-fokuserbare (åbner skuffen); peak-brackets kan trækkes
// for at om-målrette (snap til nærmeste løb, respekterer lås) — al mutation er også
// tilgængelig via skuffens knapper (a11y: drag er en mus/touch-forbedring).
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { riderOverallRating } from "../../lib/riderRating";
import { sampleFormCurves } from "../../lib/plannerCurve";
import { statColor, statTextColor } from "../../lib/statColor";
import { RIDER_TYPE_KEYS } from "../../lib/riderTypeKeys";
import { Flag } from "../Flag";
import { CZ, dateToOrdinal, monthTicks, statusMeta, riderShortName } from "./plannerShared";

const VBW = 940, RAIL = 190, RRAIL = 132;
const CX = RAIL, CW = VBW - RAIL - RRAIL;
const AXIS = 36, LANE = 88, TOP_PAD = 14, BOT_PAD = 16;

function TerrainGlyph({ x, y, terrain }) {
  const c = CZ.ink;
  if (terrain === "mountain") return <path d={`M${x - 7} ${y + 4} L${x - 1} ${y - 6} L${x + 2} ${y - 1} L${x + 5} ${y - 7} L${x + 8} ${y + 4} Z`} fill={c} opacity="0.82" />;
  if (terrain === "hilly") return <path d={`M${x - 7} ${y + 4} Q${x - 2} ${y - 5} ${x + 1} ${y + 1} Q${x + 4} ${y - 4} ${x + 8} ${y + 4} Z`} fill={c} opacity="0.82" />;
  if (terrain === "itt" || terrain === "ttt") return <g><circle cx={x} cy={y - 0.5} r="4.5" fill="none" stroke={c} strokeWidth="1.6" /><line x1={x} y1={y - 0.5} x2={x + 3} y2={y - 3.5} stroke={c} strokeWidth="1.6" /></g>;
  if (terrain === "cobbles") return <g>{[0, 1, 2].map((i) => <rect key={i} x={x - 6 + i * 5} y={y - 1 + (i % 2) * 2} width="3.5" height="3.5" fill={c} opacity="0.8" />)}</g>;
  return <rect x={x - 7} y={y + 1} width="15" height="3" fill={c} opacity="0.8" />;
}

export default function MasterCanvas({ riders, races, today, leadupDays, filter, selectedRaceId, selectedRiderId, onSelectRace, onSelectRider, onRetarget, onCreatePeak }) {
  const { t } = useTranslation(["planner", "riderTypes"]);
  const svgRef = useRef(null);
  const [drag, setDrag] = useState(null); // { planId, riderId, previewOrd }
  const months = t("months", { returnObjects: true });

  const nowOrd = dateToOrdinal(today);

  // Synlige løb (filter mine/alle) + gyldig dato.
  const visRaces = useMemo(() => (races || [])
    .filter((r) => r.date && (filter === "all" || r.isMine))
    .map((r) => ({ ...r, ord: dateToOrdinal(r.date) }))
    .filter((r) => r.ord != null)
    .sort((a, b) => a.ord - b.ord), [races, filter]);

  // Ordinal-interval: alle synlige løb + peaks + i dag, polstret.
  const { startOrd, endOrd } = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    const bump = (o) => { if (o != null) { lo = Math.min(lo, o); hi = Math.max(hi, o); } };
    for (const r of visRaces) bump(r.ord);
    bump(nowOrd);
    for (const rd of riders || []) for (const p of rd.peaks || []) { bump(dateToOrdinal(p.windowStart)); bump(dateToOrdinal(p.windowEnd)); }
    if (!Number.isFinite(lo)) { lo = nowOrd ?? 0; hi = lo + 180; }
    const pad = Math.max(6, Math.round((hi - lo) * 0.04));
    return { startOrd: lo - pad, endOrd: hi + pad };
  }, [visRaces, riders, nowOrd]);

  const span = Math.max(1, endOrd - startOrd);
  const x = (ord) => CX + ((ord - startOrd) / span) * CW;
  const ordFromClientX = (clientX) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const vbX = ((clientX - rect.left) / rect.width) * VBW;
    return startOrd + ((vbX - CX) / CW) * span;
  };

  const ticks = monthTicks(startOrd, endOrd, months);
  const H = AXIS + (riders?.length || 0) * LANE + 8;

  // ── Drag-håndtering: om-målret et peak til nærmeste egnede løb ──────────────
  // #2455: et FORSLAG har ingen ægte rider_peak_plans-id — at trække det til et
  // andet løb kan derfor ikke PATCHe en eksisterende plan; det OPRETTER i stedet
  // en ægte plan mod løbet manageren droppede den på (= implicit "justér + accept").
  const dragEnd = () => {
    if (!drag) return;
    const rider = riders.find((r) => r.id === drag.riderId);
    const plan = rider?.peaks.find((p) => p.id === drag.planId);
    if (plan && !plan.locked) {
      // Egnede løb: samme filter-synlige løb, ikke rytterens nuværende mål, ikke et
      // løb rytteren allerede topper (duplikat afvises server-side alligevel).
      const taken = new Set(rider.peaks.map((p) => p.targetRaceId));
      const eligible = visRaces.filter((r) => r.id !== plan.targetRaceId && !taken.has(r.id));
      let best = null, bestD = Infinity;
      for (const r of eligible) { const d = Math.abs(r.ord - drag.previewOrd); if (d < bestD) { bestD = d; best = r; } }
      if (best && bestD <= span / 24) {
        if (plan.isSuggestion) onCreatePeak(rider.id, best.id);
        else onRetarget(plan.id, best.id);
      }
    }
    setDrag(null);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VBW} ${H}`}
      width="100%"
      role="img"
      aria-label={t("page.title")}
      style={{ display: "block", touchAction: drag ? "none" : "auto" }}
      onPointerMove={(e) => { if (drag) setDrag((d) => ({ ...d, previewOrd: ordFromClientX(e.clientX) ?? d.previewOrd })); }}
      onPointerUp={dragEnd}
      onPointerLeave={() => { if (drag) dragEnd(); }}
    >
      {/* Måneds-ticks (tids-proportional akse) */}
      {ticks.map((tk, i) => (
        <g key={`m${i}`}>
          <line x1={x(tk.ord)} y1={AXIS} x2={x(tk.ord)} y2={H} stroke={CZ.border} strokeWidth="1" />
          <text x={x(tk.ord) + 3} y={AXIS - 10} fontSize="10" fill={CZ.t3} style={{ fontFamily: "Inter Tight, monospace" }}>{tk.label}</text>
        </g>
      ))}

      {/* Løb-markører: klikbare + tastatur-fokuserbare hit-områder + terræn-glyf */}
      {visRaces.map((r, i) => {
        const rx = x(r.ord);
        const targeted = (riders || []).some((rd) => rd.peaks.some((p) => p.targetRaceId === r.id));
        const gap = i === 0 || rx - x(visRaces[i - 1].ord) > 34;
        const active = r.id === selectedRaceId;
        return (
          <g key={r.id}>
            <line x1={rx} y1={AXIS} x2={rx} y2={H} stroke={targeted ? CZ.goldDeep : CZ.border} strokeWidth={targeted ? 1.2 : 1} strokeDasharray="1 3" opacity={targeted ? 0.6 : 0.5} />
            {gap && <TerrainGlyph x={rx} y={AXIS - 18} terrain={r.terrain} />}
            <rect
              x={rx - 6} y={AXIS} width="12" height={H - AXIS}
              fill={active ? CZ.gold : "transparent"} opacity={active ? 0.12 : 1}
              tabIndex={0} role="button"
              aria-label={`${r.name} — ${t(`terrain.${r.terrain}`)}`}
              style={{ cursor: "pointer" }}
              onClick={() => onSelectRace(r.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectRace(r.id); } }}
            />
          </g>
        );
      })}

      {/* NOW-markør */}
      {nowOrd != null && (
        <g>
          <line x1={x(nowOrd)} y1={AXIS - 4} x2={x(nowOrd)} y2={H} stroke={CZ.goldDeep} strokeWidth="1.4" />
          <text x={x(nowOrd) + 3} y={AXIS - 22} fontSize="9" fill={CZ.goldDeep} style={{ fontFamily: "Inter Tight, monospace" }}>{t("today").toUpperCase()}</text>
          <circle cx={x(nowOrd)} cy={AXIS - 4} r="2.5" fill={CZ.goldDeep} />
        </g>
      )}

      {/* Rytter-lanes */}
      {(riders || []).map((rd, idx) => {
        const y0 = AXIS + idx * LANE, top = y0 + TOP_PAD, bot = y0 + LANE - BOT_PAD;
        const baseline = rd.form == null ? 50 : rd.form;
        const yFor = (v) => top + (1 - v / 100) * (bot - top);
        const peaks = (rd.peaks || []).map((p) => ({
          ...p,
          startO: dateToOrdinal(p.windowStart),
          endO: dateToOrdinal(p.windowEnd),
        })).filter((p) => p.startO != null && p.endO != null);
        const ovr = riderOverallRating({ ...rd.abilities, primary_type: rd.primaryType });
        // #2447: ryttertype-label kommer nu fra samme riderTypes-i18n-namespace som
        // RiderTypeBadge (kanonisk kilde) i stedet for plannerens egen (dengang
        // afvigende) type.*-tekster — se backwards-check i PR-beskrivelsen.
        const typeLabel = rd.primaryType && RIDER_TYPE_KEYS.includes(rd.primaryType)
          ? t(`types.${rd.primaryType}`, { ns: "riderTypes" })
          : (rd.primaryType || "");
        const laneSelected = rd.id === selectedRiderId;

        // Kurve-samples.
        const curve = peaks.length
          ? sampleFormCurves({ baseline, peaks: peaks.map((p) => ({ windowStartOrd: p.startO, windowEndOrd: p.endO, trainingQuality: p.trainingQuality })), startOrd, endOrd, samples: 90 })
          : null;
        const toPath = (arr) => curve.ordinals.map((o, i) => `${i ? "L" : "M"}${x(o).toFixed(1)} ${yFor(arr[i]).toFixed(1)}`).join(" ");
        const areaPath = curve ? `${toPath(curve.realized)} L${x(curve.ordinals[curve.ordinals.length - 1]).toFixed(1)} ${bot} L${x(curve.ordinals[0]).toFixed(1)} ${bot} Z` : "";

        const used = peaks.length;
        const risky = peaks.some((p) => p.status === "at_risk");
        const chip = statusMeta(risky ? "at_risk" : (peaks.some((p) => p.status === "on_track") ? "on_track" : "pending"));
        // #2455: mens der findes MINDST ét assistent-forslag i lanen, erstatter
        // forslags-badgen den normale status-chip — ellers opdager manageren
        // aldrig at noget her er et forslag, ikke hans eget valg (issue-krav 3).
        const hasSuggestion = peaks.some((p) => p.isSuggestion);
        const rx0 = VBW - RRAIL + 8;

        return (
          <g key={rd.id}>
            {idx > 0 && <line x1="0" y1={y0} x2={VBW} y2={y0} stroke={CZ.border} strokeWidth="1" />}
            {/* Venstre skinne */}
            <rect x="0" y={y0} width={RAIL} height={LANE} fill={laneSelected ? CZ.subtle : CZ.card} />
            {/* #2447: nationalitet som flag-ikon (Flag-komponenten, kanonisk overalt
                ellers i appen) i stedet for en rå landekode-boks — indlejret via
                foreignObject, da flag-icons-CSS'ens baggrundsbillede-tilgang ikke
                kan udtrykkes som ren SVG. */}
            {rd.nationality && (
              <foreignObject x="8" y={y0 + 14} width="26" height="18">
                <div xmlns="http://www.w3.org/1999/xhtml" style={{ display: "flex", alignItems: "center", height: "100%" }}>
                  <Flag code={rd.nationality} className="text-[15px]" />
                </div>
              </foreignObject>
            )}
            <text
              x="50" y={y0 + 24} fontSize="13.5" fill={CZ.ink} style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 500, cursor: "pointer" }}
              tabIndex={0} role="button" aria-label={riderShortName(rd)}
              onClick={() => onSelectRider(rd.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectRider(rd.id); } }}
            >{riderShortName(rd)}</text>
            <text x="50" y={y0 + 39} fontSize="10.5" fill={CZ.t2} style={{ fontFamily: "'DM Sans', sans-serif" }}>{typeLabel}</text>
            {rd.isAcademy && <text x="50" y={y0 + 52} fontSize="8.5" fill={CZ.goldDeep} style={{ fontFamily: "Inter Tight, monospace" }}>◆ {t("academy").toUpperCase()}</text>}
            {/* #2447: OVR-badge farvet efter samme evne-gradient (statColor/statTextColor,
                SSOT for ALLE rating-visninger) i stedet for en fast ink/gold-kombination
                der blev ulæselig i dark mode (--text-1 er næsten hvid der → gult tal på
                hvid bund). */}
            <rect x={RAIL - 44} y={y0 + 15} width="36" height="22" rx="2" fill={statColor(ovr)} />
            <text x={RAIL - 26} y={y0 + 30} textAnchor="middle" fontSize="14" fill={statTextColor(ovr)} style={{ fontFamily: "Inter Tight, monospace", fontWeight: 500 }}>{ovr}</text>
            <text x={RAIL - 26} y={y0 + 45} textAnchor="middle" fontSize="7.5" fill={CZ.t3} style={{ fontFamily: "Inter Tight, monospace" }}>{t("ovr.label")}</text>

            {/* Baseline */}
            <line x1={CX} y1={yFor(baseline)} x2={x(endOrd)} y2={yFor(baseline)} stroke={CZ.border} strokeWidth="1" strokeDasharray="2 3" />

            {peaks.length === 0 ? (
              <text x={x((startOrd + endOrd) / 2)} y={yFor(baseline) - 6} textAnchor="middle" fontSize="10.5" fill={CZ.t3} style={{ fontFamily: "'DM Sans', sans-serif" }}>{t("lane.noPeaks")}</text>
            ) : (
              <>
                {/* Build/taper-skygge (optakts-vinduet) */}
                {peaks.map((p) => (
                  <rect key={`b${p.id}`} x={x(p.startO - leadupDays)} y={top} width={Math.max(0, x(p.startO) - x(p.startO - leadupDays))} height={bot - top} fill={CZ.ink} opacity="0.08" />
                ))}
                {/* Realiseret areal + potentiel (stiplet) + realiseret (fyldt streg) */}
                <path d={areaPath} fill={CZ.ink} opacity="0.15" />
                <path d={toPath(curve.potential)} fill="none" stroke={CZ.goldDeep} strokeWidth="1.4" strokeDasharray="4 2.5" opacity="0.9" />
                <path d={toPath(curve.realized)} fill="none" stroke={CZ.ink} strokeWidth="2" />
                {/* Peak-brackets (trækbare hvis ulåst) — #2455: et forslag tegnes
                    stiplet + med hule (ufyldte) håndtag og et ✦-mærke, så det er
                    synligt forskelligt fra en peak manageren selv har sat, indtil
                    han accepterer/justerer den (issue-krav 3). Forslag er ALDRIG
                    låst (de er ikke bindende endnu). */}
                {peaks.map((p) => {
                  const isDragging = drag?.planId === p.id;
                  const shiftO = isDragging && drag.previewOrd != null ? drag.previewOrd - (p.startO + p.endO) / 2 : 0;
                  const bx = x(p.startO + shiftO), bw = Math.max(6, x(p.endO + shiftO) - x(p.startO + shiftO));
                  const midY = (top + bot) / 2;
                  return (
                    <g key={`k${p.id}`} opacity={isDragging ? 0.85 : (p.isSuggestion ? 0.8 : 1)}>
                      <rect x={bx} y={top - 3} width={bw} height={bot - top + 6} fill="none" stroke={CZ.goldDeep} strokeWidth="1.3" rx="2" strokeDasharray={p.isSuggestion ? "3 2" : undefined} />
                      {[bx, bx + bw].map((hx, hi) => (
                        <rect
                          key={hi} x={hx - 3} y={midY - 8} width="7" height="16" rx="1.5"
                          fill={p.locked ? CZ.t3 : (p.isSuggestion ? "none" : CZ.gold)} stroke={CZ.goldDeep} strokeWidth={p.isSuggestion ? "1.3" : "0.8"}
                          style={{ cursor: p.locked ? "not-allowed" : "grab", touchAction: "none" }}
                          onPointerDown={(e) => { if (!p.locked) { e.currentTarget.setPointerCapture?.(e.pointerId); setDrag({ planId: p.id, riderId: rd.id, previewOrd: (p.startO + p.endO) / 2 }); } }}
                        />
                      ))}
                      {p.locked && <text x={bx + bw / 2} y={top + 8} textAnchor="middle" fontSize="7.5" fill={CZ.t2} style={{ fontFamily: "Inter Tight, monospace" }}>{t("status.locked").toUpperCase()}</text>}
                      {p.isSuggestion && <text x={bx + bw / 2} y={top + 8} textAnchor="middle" fontSize="8" fill={CZ.goldDeep} style={{ fontFamily: "Inter Tight, monospace" }} aria-hidden="true">✦</text>}
                    </g>
                  );
                })}
              </>
            )}

            {/* Højre skinne: peak-tokens + status-chip (forslag: stiplet/hult token + assistent-badge, jf. issue-krav 3) */}
            {[0, 1].map((k) => {
              const tp = peaks[k];
              const filled = k < used;
              return (
                <circle
                  key={k} cx={rx0 + k * 15} cy={y0 + 22} r="5"
                  fill={filled && !tp?.isSuggestion ? CZ.gold : "none"}
                  stroke={filled ? CZ.goldDeep : CZ.t3} strokeWidth="1.4"
                  strokeDasharray={tp?.isSuggestion ? "1.5 1.2" : undefined}
                />
              );
            })}
            {peaks.length > 0 && (
              <g>
                <rect
                  x={rx0} y={y0 + 40} width="118" height="18" rx="9"
                  fill={hasSuggestion ? "none" : (chip.tone === "good" ? CZ.gold : "none")}
                  stroke={hasSuggestion ? CZ.goldDeep : (chip.tone === "good" ? "none" : CZ.goldDeep)}
                  strokeWidth="1" strokeDasharray={hasSuggestion ? "2 2" : undefined}
                  opacity={chip.tone === "good" && !hasSuggestion ? 0.92 : 1}
                />
                <text x={rx0 + 9} y={y0 + 52.5} fontSize="8.5" fill={hasSuggestion ? CZ.goldDeep : (chip.tone === "good" ? "var(--on-accent)" : CZ.goldDeep)} style={{ fontFamily: "'DM Sans', sans-serif" }}>
                  {hasSuggestion ? `✦ ${t("assistant.badge")}` : `${chip.glyph} ${t(`status.${chip.key}`)}`}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
