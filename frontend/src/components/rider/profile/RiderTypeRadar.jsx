// RiderTypeRadar — Overblik-fanens ryttertype-spider (#2000 stykke 2).
//
// 8-akse radar: for hver ryttertype plottes hvor højt rytteren ville rates SOM den
// type — riderTypeRating(abilities, typeKey) fra rating-SSOT'en (lib/riderRating.js,
// SAMME model som overall-ratingen og Udvikling-fanens type-linjer). "Nu"-polygonen
// (solid guld) er dermed bygget på ægte evne-data, ikke opfundne tal.
//
// LOFT-polygon (dashed "scoutet loft") er BEVIDST UDELADT: et per-type loft kræver
// per-type potentiale-data, og den findes ikke i klienten (scouting-estimatet er ét
// OVERALL potentiale, ikke pr. type — useScouting/ScoutablePotentiale). At skalere et
// per-type loft ud fra overall-potentialet ville opfinde en form uden datagrundlag.
// Loft-laget hører til talentspejder-/Scouting-arbejdet (per-type potentiale) og
// tilføjes når den data findes. Indtil da viser radaren ærligt kun "Nu".
//
// Token-only: SVG-farver via app'ens CSS-vars (--accent/--accent-t/--border/--text-3,
// identiske med design-tokens). Dark mode flipper automatisk.

import { useTranslation } from "react-i18next";
import { riderTypeRating } from "../../../lib/riderRating.js";

// Spektrum-orden (flade spurtere → klatrere) så beslægtede typer ligger ved siden af
// hinanden og polygonen får en aflæselig form. Nøgler = RIDER_TYPE_KEYS (SSOT).
const RADAR_ORDER = [
  "sprinter", "puncheur", "brostensrytter", "baroudeur",
  "rouleur", "tt", "gc", "climber",
];

const CX = 140;
const CY = 112;
const R = 82;
const angleAt = (i, n) => -Math.PI / 2 + (i * 2 * Math.PI) / n;

// #3666: akse-domænet er 0-40, ikke 0-99.
//
// Den gamle model normaliserede mod populations-ankre og fyldte hele 1-99. Den
// nye er absolut, og målt read-only mod prod 13/8 (n=8.747) er p90 for en
// rolle-rating 29 — kun 10 ryttere i hele spillet ligger over 40 i deres bedste
// rolle. Med et 0-99-domæne ville polygonen kollapse til under en tredjedel af
// radius for stort set alle, og de to yderste ringe ville aldrig blive nået af
// nogen. Domænet er FAST og ikke per-rytter, så to ryttere fortsat kan holdes
// op mod hinanden: en større polygon betyder faktisk en bedre rytter.
const AXIS_DOMAIN = 40;
// Ringene ligger på evne-ankrene fra statColor, så afstanden mellem to ringe
// betyder det samme som farveskiftet gør i evne-badgene. Ejer-beslutning 14/8.
const RING_VALUES = [12, 21, 32];
const radiusFor = (v) => (R * Math.max(0, Math.min(AXIS_DOMAIN, Number(v) || 0))) / AXIS_DOMAIN;

export default function RiderTypeRadar({ rider, onGoScouting }) {
  const { t } = useTranslation("rider");
  const { t: tTypes } = useTranslation("riderTypes");

  const abilities = rider?.abilities;
  if (!abilities) return null;

  const n = RADAR_ORDER.length;
  const ratings = RADAR_ORDER.map((key) => riderTypeRating(abilities, key));

  const nowPoly = RADAR_ORDER.map((_, i) => {
    const r = radiusFor(ratings[i]);
    return `${(CX + Math.cos(angleAt(i, n)) * r).toFixed(1)},${(CY + Math.sin(angleAt(i, n)) * r).toFixed(1)}`;
  }).join(" ");

  const axes = RADAR_ORDER.map((_, i) => ({
    x: (CX + Math.cos(angleAt(i, n)) * R).toFixed(1),
    y: (CY + Math.sin(angleAt(i, n)) * R).toFixed(1),
  }));
  const rings = RING_VALUES.map((v) => radiusFor(v).toFixed(1));

  // #3666: guld-aksen markerer rytterens EGEN rolle, ikke den højest ratede.
  //
  // Radaren udnævnte før den højeste akse til "bedste type". Siden #3570 er
  // typen en FAST identitet fra archetype_draw — en rytter kan ikke konverteres
  // — så en flade der peger på en anden rolle inviterer til noget spillet ikke
  // understøtter. Det er samme princip ejeren låste for Scouting-kortet 13/8.
  //
  // Målt eksempel fra prod: Samuel H. Bizimana er bjergrytter, men læser 18 som
  // sprinter og 8 som bjergrytter — fordi opskrifterne består af evner der
  // ligger på forskellige niveauer (spec §1.7, udskudt til #3668). Den gamle
  // argmax ville have kaldt ham sprinter.
  const ownKey = RADAR_ORDER.includes(rider?.primary_type) ? rider.primary_type : null;

  // Hvad han rent faktisk læser højest på lige nu. Vises som OBSERVATION, aldrig
  // som anbefaling, og kun når den afviger fra hans rolle — ellers er der intet
  // at fortælle.
  const rated = ratings
    .map((v, i) => ({ key: RADAR_ORDER[i], v }))
    .filter((x) => Number.isFinite(x.v));
  const highestKey = rated.length
    ? rated.reduce((best, x) => (x.v > best.v ? x : best)).key
    : null;
  const goldKey = ownKey ?? highestKey;
  const showHighest = ownKey && highestKey && highestKey !== ownKey;

  const labels = RADAR_ORDER.map((key, i) => {
    const a = angleAt(i, n);
    const lx = CX + Math.cos(a) * (R + 13);
    const ly = CY + Math.sin(a) * (R + 13) + 3;
    const anchor = Math.cos(a) > 0.3 ? "start" : Math.cos(a) < -0.3 ? "end" : "middle";
    return { key, x: lx.toFixed(1), y: ly.toFixed(1), anchor, isBest: key === goldKey };
  });

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
      <div className="flex items-baseline justify-between gap-2 mb-0.5">
        <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0">
          {t("profile.overview.radar.title")}
        </h3>
        <span className="text-3xs text-cz-3">{t("profile.overview.radar.subtitle")}</span>
      </div>

      <svg viewBox="0 0 280 230" className="block w-full max-w-[430px] h-auto mx-auto mt-0.5" aria-hidden="true">
        {rings.map((r, i) => (
          <circle key={`ring-${i}`} cx={CX} cy={CY} r={r} fill="none" stroke="var(--border)" strokeWidth="1" />
        ))}
        {axes.map((ax, i) => (
          <line key={`axis-${i}`} x1={CX} y1={CY} x2={ax.x} y2={ax.y} stroke="var(--border)" strokeWidth="1" opacity="0.55" />
        ))}
        <polygon
          points={nowPoly}
          fill="rgb(var(--accent) / 0.2)"
          stroke="rgb(var(--accent-t))"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {labels.map((l) => (
          <text
            key={`label-${l.key}`}
            x={l.x}
            y={l.y}
            fontSize="8.5"
            fontWeight="700"
            letterSpacing="0.3"
            fill={l.isBest ? "rgb(var(--accent-t))" : "var(--text-3)"}
            fontFamily='"Inter Tight", "Inter Tight Fallback", system-ui, sans-serif'
            textAnchor={l.anchor}
          >
            {tTypes(`short.${l.key}`)}
          </text>
        ))}
      </svg>

      <div className="flex gap-3.5 flex-wrap justify-center mt-1">
        <span className="inline-flex items-center gap-1.5 text-2xs text-cz-2">
          <span className="w-3 h-[3px] rounded-sm bg-cz-accent-t" aria-hidden="true" />
          {t("profile.overview.radar.legendNow")}
        </span>
      </div>

      {/* Per-type potentiale-stjerner UDELADT her (samme grund som loft-polygonen:
          per-type potentiale findes ikke i klienten — kun ét overall-estimat). At vise
          overall-potentialet her ville implicere et per-type loft vi ikke har.
          Overall-potentialet står i hero'en. */}
      <div className="mt-3 pt-3 border-t border-cz-border flex items-center gap-2.5 flex-wrap">
        <span className="font-mono text-3xs font-bold uppercase tracking-[0.1em] text-cz-3">
          {t("profile.overview.radar.role")}
        </span>
        <span className="font-bold text-[13.5px] text-cz-1">{tTypes(`types.${goldKey}`)}</span>
        {/* Linket skjules mens Scouting-fanen er udskudt (egen slice) — en knap
            til en fane der ikke findes ville lande på tomt indhold. */}
        {onGoScouting && (
          <button
            type="button"
            onClick={onGoScouting}
            className="ms-auto py-1 -my-1 text-2xs text-cz-accent-t hover:underline"
          >
            {t("profile.overview.radar.allTypes")}
          </button>
        )}
      </div>

      {/* #3666: hvad han læser højest på lige nu — OBSERVATION, ikke dom.
          Ordet "bedst" bruges ikke: rollerne består af forskellige evner, som
          ligger på forskellige niveauer (spec §1.7, rod-fixet er #3668), så et
          højere tal i en anden rolle betyder ikke at han burde være den rolle.
          Linjen skjules når de to er den samme — så er der intet at fortælle. */}
      {showHighest && (
        <div className="mt-2 flex items-baseline gap-2 flex-wrap">
          <span className="text-2xs text-cz-3">{t("profile.overview.radar.readsHighest")}</span>
          <span className="text-2xs font-bold text-cz-2">{tTypes(`types.${highestKey}`)}</span>
          <span className="text-3xs text-cz-3 basis-full">
            {t("profile.overview.radar.notARanking")}
          </span>
        </div>
      )}
    </div>
  );
}
