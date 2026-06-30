// RiderPhysiologyTab — Fysiologi-fanen (#2000 stykke 3).
//
// Det fysiologiske lag: 4 headline-kort (FTP/VO₂max/Pmax/Zone 2) m. benchmark vs
// divisions-snit, watt-kurve (log-skala, rytter + division, W↔W/kg-toggle, "hans
// zone"), watt-profil-barer, Critical Power-model og Coggan-effekt-zoner.
//
// Egne tal er ÆGTE (rider.physiology); divisions-snittet kommer fra
// GET /api/physiology/division-benchmark (backend-aggregat). CP/W′, 10/20min-
// kurvepunkter og zoner afledes i lib/physiologyModel.js (SAMME model på rytter og
// division, så de er sammenlignelige). Mangler benchmark (fri agent/ingen division)
// → fanen viser egne tal uden sammenligning (graceful).
//
// Token-only; SVG bruger app'ens CSS-vars + literal Inter Tight-stack (der findes
// ingen --font-data CSS-var i appen). Dark mode via tokens.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { criticalPower, powerDurationCurve, cogganZones, WATT_PROFILE_KEYS } from "../../../lib/physiologyModel.js";

const DATA_FONT = '"Inter Tight", "Inter Tight Fallback", system-ui, sans-serif';

const DURATION_LABELS = { "5s": "5s", "15s": "15s", "1m": "1 min", "5m": "5 min", "10m": "10 min", "20m": "20 min", ftp: "FTP" };
const PROFILE_NOTE_KEYS = { "5s": "sprint", "1m": "anaerobic", "5m": "vo2", "10m": "thresholdPlus", "20m": "threshold", ftp: "hour" };

const fmtW = (watts, lang) => Math.round(Number(watts)).toLocaleString(lang);
const fmtWkg = (wkg) => Number(wkg).toFixed(1);
const valOf = (point, unit) => (unit === "wkg" ? point.wkg : point.watts);
const fmtVal = (point, unit, lang) => (unit === "wkg" ? fmtWkg(point.wkg) : fmtW(point.watts, lang));

// Delta vs snit som fortegns-procent. null hvis intet snit.
function deltaPct(value, mean) {
  if (mean == null || !Number.isFinite(mean) || mean === 0) return null;
  return Math.round(((value - mean) / mean) * 100);
}

function DeltaTag({ pct }) {
  const { t } = useTranslation("rider");
  if (pct == null) return null;
  const over = pct >= 0;
  return (
    <span className={`font-mono text-[10.5px] font-semibold ${over ? "text-cz-success" : "text-cz-danger"}`}>
      {over ? "▴" : "▾"} {Math.abs(pct)}% {over ? t("profile.physio.over") : t("profile.physio.under")}
    </span>
  );
}

// Magnitude-bjælke vs divisions-snit: fyld = værdi, navy-tick = snittet. Skala-loft
// = snit×1.6 (snit lander på 62,5%). Uden snit: ingen bjælke (intet at sammenligne).
// To magnitude-bjælke-varianter holdt visuelt adskilt (design): "headline" = tynd
// (6px, skala ×1.6); "profile" = bevidst kraftigere (9px, højere tick, skala ×1.65)
// så watt-profilens magnitude-barer skiller sig fra headline-kortene.
function BenchmarkBar({ value, mean, variant = "headline" }) {
  if (mean == null || !Number.isFinite(mean) || mean <= 0) return null;
  const cfg = variant === "profile"
    ? { scale: 1.65, track: "h-[9px]", tick: "h-[15px]", mt: "mt-2" }
    : { scale: 1.6, track: "h-1.5", tick: "h-[12px]", mt: "mt-[9px]" };
  const scaleMax = mean * cfg.scale;
  const fillPct = Math.max(0, Math.min(100, (value / scaleMax) * 100));
  const tickPct = Math.max(0, Math.min(100, (mean / scaleMax) * 100));
  return (
    <div className={`relative ${cfg.track} bg-cz-subtle rounded-full ${cfg.mt}`} aria-hidden="true">
      <div className="absolute left-0 top-0 h-full rounded-full bg-cz-accent/80" style={{ width: `${fillPct}%` }} />
      <div className={`absolute -top-[3px] w-0.5 ${cfg.tick} bg-cz-1`} style={{ left: `${tickPct}%` }} />
    </div>
  );
}

function HeadlineCard({ label, big, unit, sub, riderVal, meanVal, divLabel }) {
  const { t } = useTranslation("rider");
  return (
    <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-cz-3">{label}</span>
        <DeltaTag pct={deltaPct(riderVal, meanVal)} />
      </div>
      <div className="flex items-baseline gap-1.5 mt-[7px] mb-[3px]">
        <span className="font-mono tabular-nums text-2xl font-bold text-cz-1">{big}</span>
        <span className="text-[11px] text-cz-3">{unit}</span>
      </div>
      <span className="text-[10.5px] text-cz-2">{sub}</span>
      <BenchmarkBar value={riderVal} mean={meanVal} />
      {divLabel != null && (
        <div className="text-[9.5px] text-cz-3 mt-[5px]">{t("profile.physio.divMean", { value: divLabel })}</div>
      )}
    </div>
  );
}

// ── Watt-profil ───────────────────────────────────────────────────────────────
function WattProfile({ riderCurve, divCurve, unit, lang, division, t }) {
  const divByKey = divCurve ? Object.fromEntries(divCurve.map((p) => [p.key, p])) : {};
  const rows = riderCurve.filter((p) => WATT_PROFILE_KEYS.includes(p.key));
  return (
    <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
      <div className="flex items-baseline justify-between gap-2 mb-0.5">
        <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0">{t("profile.physio.profile.title")}</h3>
        {divCurve && (
          <span className="text-[10.5px] text-cz-3 inline-flex items-center gap-1.5">
            {t("profile.physio.divMeanShort", { division })}
            <span className="inline-block w-2 h-2 border-l-2 border-cz-1" aria-hidden="true" title="" />
          </span>
        )}
      </div>
      {rows.map((p) => {
        const v = valOf(p, unit);
        const m = divByKey[p.key] ? valOf(divByKey[p.key], unit) : null;
        return (
          <div key={p.key} className="py-2 border-t border-cz-border">
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="font-bold text-[12.5px] text-cz-1 min-w-[42px]">{DURATION_LABELS[p.key]}</span>
                <span className="text-[10.5px] text-cz-3">{t(`profile.physio.profile.note.${PROFILE_NOTE_KEYS[p.key]}`)}</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-mono tabular-nums font-bold text-[13px] text-cz-1">{fmtVal(p, unit, lang)}</span>
                <DeltaTag pct={deltaPct(v, m)} />
              </div>
            </div>
            <BenchmarkBar value={v} mean={m} variant="profile" />
          </div>
        );
      })}
    </div>
  );
}

function CriticalPowerCard({ cp, lang, t }) {
  if (!cp) return null;
  return (
    <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
      <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mb-2.5">{t("profile.physio.cp.title")}</h3>
      <div className="flex gap-[18px] flex-wrap">
        <div>
          <div className="font-mono tabular-nums text-xl font-bold text-cz-1">{fmtW(cp.cpWatts, lang)} <span className="text-[11px] font-normal text-cz-3">W</span></div>
          <div className="text-[10px] text-cz-3 uppercase tracking-[0.05em]">{t("profile.physio.cp.cp")}</div>
        </div>
        <div>
          <div className="font-mono tabular-nums text-xl font-bold text-cz-1">{fmtWkg(cp.wPrimeKj)} <span className="text-[11px] font-normal text-cz-3">kJ</span></div>
          <div className="text-[10px] text-cz-3 uppercase tracking-[0.05em]">{t("profile.physio.cp.wprime")}</div>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-cz-2 leading-snug">{t("profile.physio.cp.read")}</p>
    </div>
  );
}

const ZONE_COLORS = {
  Z1: "rgb(var(--text-3) / 0.35)", Z2: "rgb(var(--cz-chart-1) / 0.55)", Z3: "rgb(var(--success) / 0.6)",
  Z4: "rgb(var(--accent) / 0.85)", Z5: "rgb(var(--accent-t) / 0.9)", Z6: "rgb(var(--warning) / 0.85)", Z7: "rgb(var(--danger) / 0.8)",
};

function ZonesCard({ zones, ftpWatts, lang, t }) {
  if (!zones.length) return null;
  const total = zones.reduce((s, z) => s + (z.hiFrac - z.loFrac), 0);
  const rangeLabel = (z) => {
    if (z.z === "Z1") return `<${fmtW(z.hiWatts, lang)} W`;
    if (z.z === "Z7") return `>${fmtW(zones.find((x) => x.z === "Z6").hiWatts, lang)} W`;
    return `${fmtW(z.loWatts, lang)}–${fmtW(z.hiWatts, lang)} W`;
  };
  return (
    <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
      <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mb-2.5">{t("profile.physio.zones.title")}</h3>
      <div className="flex h-[13px] rounded-[4px] overflow-hidden border border-cz-border" aria-hidden="true">
        {zones.map((z) => (
          <div key={z.z} style={{ flex: (z.hiFrac - z.loFrac) / total, background: ZONE_COLORS[z.z], borderRight: "1px solid var(--bg-card)" }} />
        ))}
      </div>
      <div className="flex flex-col gap-[3px] mt-2.5">
        {zones.map((z) => (
          <div key={z.z} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-[2px] flex-none" style={{ background: ZONE_COLORS[z.z] }} aria-hidden="true" />
            <span className="font-mono text-[10px] font-bold text-cz-2 flex-none w-[22px]">{z.z}</span>
            <span className="text-[11px] text-cz-1 flex-1">{t(`profile.physio.zones.name.${z.z}`)}</span>
            <span className="font-mono text-[10.5px] text-cz-3">{rangeLabel(z)}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[9.5px] text-cz-3">{t("profile.physio.zones.derived", { ftp: fmtW(ftpWatts, lang) })}</p>
    </div>
  );
}

export default function RiderPhysiologyTab({ physiology, benchmark }) {
  const { t, i18n } = useTranslation("rider");
  const [unit, setUnit] = useState("wkg");
  const lang = i18n.language;

  if (!physiology) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-5">
        <p className="text-cz-3 text-sm text-center py-8">{t("profile.physio.pending")}</p>
      </div>
    );
  }

  const mean = benchmark?.mean ?? null;
  const division = benchmark?.division ?? null;
  const riderCurve = powerDurationCurve(physiology);
  const divCurve = mean ? powerDurationCurve(mean) : null;
  const cp = criticalPower(physiology);
  const zones = cogganZones(physiology.ftp_watts);

  const headlines = [
    { key: "ftp", label: t("profile.physio.head.ftp"), big: fmtW(physiology.ftp_watts, lang), unit: "W",
      sub: t("profile.physio.head.ftpSub", { wkg: fmtWkg(physiology.ftp_wkg) }),
      riderVal: physiology.ftp_watts, meanVal: mean?.ftp_watts, divLabel: mean ? `${fmtW(mean.ftp_watts, lang)} W` : null },
    { key: "vo2", label: t("profile.physio.head.vo2"), big: fmtWkg(physiology.vo2max_power_wkg), unit: "W/kg",
      sub: t("profile.physio.head.vo2Sub"),
      riderVal: physiology.vo2max_power_wkg, meanVal: mean?.vo2max_power_wkg, divLabel: mean ? `${fmtWkg(mean.vo2max_power_wkg)} W/kg` : null },
    { key: "pmax", label: t("profile.physio.head.pmax"), big: fmtW(physiology.pmax_watts, lang), unit: "W",
      sub: t("profile.physio.head.pmaxSub"),
      riderVal: physiology.pmax_watts, meanVal: mean?.pmax_watts, divLabel: mean ? `${fmtW(mean.pmax_watts, lang)} W` : null },
    { key: "zone2", label: t("profile.physio.head.zone2"), big: fmtWkg(physiology.zone2_power_wkg), unit: "W/kg",
      sub: t("profile.physio.head.zone2Sub"),
      riderVal: physiology.zone2_power_wkg, meanVal: mean?.zone2_power_wkg, divLabel: mean ? `${fmtWkg(mean.zone2_power_wkg)} W/kg` : null },
  ];

  return (
    <div className="flex flex-col gap-[13px]">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-[11px] items-start">
        {headlines.map((h) => <HeadlineCard key={h.key} {...h} />)}
      </div>

      {riderCurve && (
        <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
          <div className="flex items-center justify-between gap-2.5 flex-wrap mb-1.5">
            <div>
              <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0">{t("profile.physio.curve.title")}</h3>
              <span className="text-[10.5px] text-cz-3">{t("profile.physio.curve.subtitle")}</span>
            </div>
            <div className="inline-flex bg-cz-subtle rounded-cz p-0.5">
              {["wkg", "w"].map((u) => (
                <button key={u} type="button" onClick={() => setUnit(u)} aria-pressed={unit === u}
                  className={`min-h-[44px] px-4 rounded-[4px] text-[11.5px] font-semibold transition-colors ${unit === u ? "bg-cz-card text-cz-1 shadow-sm" : "text-cz-3 hover:text-cz-2"}`}>
                  {u === "wkg" ? "W/kg" : "W"}
                </button>
              ))}
            </div>
          </div>
          <CurveSvg riderCurve={riderCurve} divCurve={divCurve} unit={unit} lang={lang} division={division} t={t} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[13px] items-start">
        {riderCurve && <WattProfile riderCurve={riderCurve} divCurve={divCurve} unit={unit} lang={lang} division={division} t={t} />}
        <div className="flex flex-col gap-[13px] min-w-0">
          <CriticalPowerCard cp={cp} lang={lang} t={t} />
          <ZonesCard zones={zones} ftpWatts={physiology.ftp_watts} lang={lang} t={t} />
        </div>
      </div>
    </div>
  );
}

// Selve kurve-SVG'en (uden toggle-knappen, der bor i tab-headeren ovenfor).
function CurveSvg({ riderCurve, divCurve, unit, lang, division, t }) {
  const X0 = 46, X1 = 320, Y0 = 20, Y1 = 150, NP = riderCurve.length;
  const xAt = (i) => X0 + (i * (X1 - X0)) / (NP - 1);
  const all = [...riderCurve, ...(divCurve || [])].map((p) => valOf(p, unit)).filter((v) => v > 0);
  const loV = Math.min(...all), hiV = Math.max(...all);
  const llo = Math.log(loV * 0.82), lhi = Math.log(hiV * 1.08);
  const yAt = (v) => Y1 - ((Math.log(v) - llo) / (lhi - llo)) * (Y1 - Y0);
  const ptsOf = (arr) => arr.map((p, i) => `${xAt(i).toFixed(1)},${yAt(valOf(p, unit)).toFixed(1)}`).join(" ");
  const gridVals = (unit === "wkg" ? [4, 8, 16] : [300, 600, 1200]).filter((g) => g >= loV * 0.82 && g <= hiV * 1.08);

  let zone = null;
  if (divCurve) {
    const beats = riderCurve.map((p, i) => valOf(p, unit) > valOf(divCurve[i], unit));
    const first = beats.indexOf(true), last = beats.lastIndexOf(true);
    if (first !== -1) zone = { x: xAt(first), w: xAt(last) - xAt(first) };
  }

  return (
    <>
      <svg viewBox="0 0 340 196" className="block w-full h-auto" aria-hidden="true">
        {gridVals.map((g) => (
          <g key={`g-${g}`}>
            <line x1="46" y1={yAt(g).toFixed(1)} x2="320" y2={yAt(g).toFixed(1)} stroke="var(--border)" strokeWidth="1" strokeDasharray="2 3" opacity="0.7" />
            <text x="42" y={(yAt(g) + 3).toFixed(1)} fontSize="8.5" fill="var(--text-3)" fontFamily={DATA_FONT} textAnchor="end">{unit === "wkg" ? g : g.toLocaleString(lang)}</text>
          </g>
        ))}
        {zone && (
          <>
            <rect x={zone.x.toFixed(1)} y="20" width={zone.w.toFixed(1)} height="130" fill="rgb(var(--accent) / 0.07)" />
            <text x={(zone.x + zone.w / 2).toFixed(1)} y="31" fontSize="8" fill="rgb(var(--accent-t))" fontFamily={DATA_FONT} textAnchor="middle">{t("profile.physio.curve.hisZone")}</text>
          </>
        )}
        {divCurve && <polyline points={ptsOf(divCurve)} fill="none" stroke="var(--text-3)" strokeWidth="1.6" strokeDasharray="4 3" opacity="0.85" />}
        <polyline points={ptsOf(riderCurve)} fill="none" stroke="rgb(var(--accent-t))" strokeWidth="2.4" />
        {riderCurve.map((p, i) => (
          <g key={`d-${p.key}`}>
            <circle cx={xAt(i).toFixed(1)} cy={yAt(valOf(p, unit)).toFixed(1)} r="2.4" fill="rgb(var(--accent-t))" />
            <text x={xAt(i).toFixed(1)} y={(yAt(valOf(p, unit)) - 7).toFixed(1)} fontSize="8" fontWeight="700" fill="var(--text-1)" fontFamily={DATA_FONT} textAnchor="middle">{fmtVal(p, unit, lang)}</text>
          </g>
        ))}
        {riderCurve.map((p, i) => (
          <text key={`x-${p.key}`} x={xAt(i).toFixed(1)} y="190" fontSize="8.5" fill="var(--text-2)" fontFamily={DATA_FONT} textAnchor="middle">{DURATION_LABELS[p.key]}</text>
        ))}
      </svg>
      <div className="flex gap-4 flex-wrap mt-1.5">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-cz-2">
          <span className="w-3.5 h-[3px] rounded-sm bg-cz-accent-t" aria-hidden="true" />{t("profile.physio.curve.rider")}
        </span>
        {divCurve && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-cz-2">
            <span className="w-3.5 h-0 border-t-2 border-dashed border-cz-3" aria-hidden="true" />{t("profile.physio.divMeanShort", { division })}
          </span>
        )}
      </div>
    </>
  );
}
