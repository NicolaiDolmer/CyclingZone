// #2849 bølge 0 — cz-table-recipen (T2 wide data, docs/design/PAGE_TEMPLATES.md).
// Sticky første kolonne = opak cellebaggrund + 1px højre-rule; erstatter den rå
// `shadow-[10px_0_16px_-16px_…]`-skygge der var copy-pastet i 8+ filer.

export const WRAP = "overflow-hidden rounded-cz border border-cz-border bg-cz-card";
export const SCROLLER = "overflow-x-auto";
export const TABLE = "w-full border-collapse";
// Count-linjen under tabellen ("Showing 8 of 412 riders").
export const COUNT = "mt-2 font-data text-xs text-cz-3";

// Mobil-pin: navnekolonnen holder ~148px mens numerik scroller under den.
const STICKY = "sticky left-0 z-sticky min-w-[148px] border-r border-cz-border";

// Sticky-celler SKAL være opake (kolonner scroller ind under dem). I dark theme
// er --success-bg/--danger-bg translucente, så tinten lægges som gradient oven
// på en opak --bg-card-bund i sticky-celler.
const ZONES = {
  success: {
    cell: "bg-cz-success-bg",
    stickyCell:
      "bg-cz-card [background-image:linear-gradient(var(--success-bg),var(--success-bg))]",
    edgeTop: "border-t-2 border-t-cz-success/40",
    edgeBottom: "border-b-2 border-b-cz-success/40",
    pill: "bg-cz-success-bg text-cz-success",
  },
  danger: {
    cell: "bg-cz-danger-bg",
    stickyCell:
      "bg-cz-card [background-image:linear-gradient(var(--danger-bg),var(--danger-bg))]",
    edgeTop: "border-t-2 border-t-cz-danger/40",
    edgeBottom: "border-b-2 border-b-cz-danger/40",
    pill: "bg-cz-danger-bg text-cz-danger",
  },
};

// #2849 bølge 6 (ejer-feedback 25/7): `compact` halverer den vandrette gutter
// (px-4 -> px-2) for kolonner der kun bærer ét kort tal. De 15 evne-kolonner er
// 28px brede med 32px luft imellem sig, hvilket spreder rytterdatabasen og
// truppen ud og gør dem svære at skanne på tværs. Navn/hold/status-kolonner
// beholder px-4 — dér ER luften det der adskiller læsbar tekst.
// #2906 (ejer-feedback 25/7): `dense` halverer den LODRETTE cellepolstring
// (py-[13px] -> py-[7px], header py-3 -> py-2) for tabeller hvor rækketallet er
// det der tæller — truppen viser 30 ryttere, og ~48px rækker gav ~1450px side.
// Opt-in pr. tabel, så T2's default-rytme (13px) er uændret alle andre steder.

// Vandret gutter i tre trin (bredest → smallest):
//   default  px-4 — tekstkolonner; luften ER det der adskiller ordene
//   compact  px-2 — kolonner der bærer ét kort tal/element (#2849 bølge 6)
//   tight    px-1 — en MATRIX af tal-celler, hvor nabo-cellerne skal læses
//                   som én blok (de 15 evner). Ejer-feedback 25/7 på #2888/#2906:
//                   px-2 stod stadig "for langt fra hinanden". Selve tal-badgen
//                   har sin egen baggrund, så adskillelsen kommer fra farven,
//                   ikke fra luften. `tight` vinder over `compact`.
function gutter(compact, tight) {
  if (tight) return "px-1";
  return compact ? "px-2" : "px-4";
}

export function thClass({ numeric = false, sticky = false, compact = false, tight = false, dense = false } = {}) {
  const base =
    `whitespace-nowrap bg-cz-card ${gutter(compact, tight)} ${dense ? "py-2" : "py-3"} font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3`;
  return [base, numeric ? "text-right" : "text-left", sticky ? STICKY : ""]
    .filter(Boolean)
    .join(" ");
}

// Zone-kanter (2px semi-opaque separator) ERSTATTER den ordinære 1px toplinje
// på boundary-rækken — to border-top-utilities på samme celle er udefineret.
export function tdClass({ numeric = false, sticky = false, zone = null, edgeTop = false, edgeBottom = false, compact = false, tight = false, dense = false } = {}) {
  const z = ZONES[zone];
  const rules = [
    z && edgeTop ? z.edgeTop : "border-t border-cz-border",
    z && edgeBottom ? z.edgeBottom : "",
  ];
  const bg = z ? (sticky ? z.stickyCell : z.cell) : sticky ? "bg-cz-card group-hover:bg-cz-subtle" : "";
  return [
    `${gutter(compact, tight)} ${dense ? "py-[7px]" : "py-[13px]"} text-sm text-cz-1`,
    numeric ? "text-right font-data tabular-nums" : "text-left",
    sticky ? STICKY : "",
    bg,
    ...rules,
  ]
    .filter(Boolean)
    .join(" ");
}

// Zone-tintede rækker har ingen hover-highlight (spec: no hover on tinted rows).
export function trClass(zone = null) {
  return zone ? "" : "group transition-colors duration-150 hover:bg-cz-subtle";
}

// #2849 bølge 1 — rowProps-hook (DataTable): merger caller-leverede <tr>-props
// (ref/onClick/className/…) OVEN PÅ den zone-afledte trClass(zone). className
// KONKATENERES EFTER trClass(zone), så en caller-klasse (fx en selektions-ring)
// kan style oven på zone-tint/hover uden selv at kende zone-klassen. Øvrige
// props (onClick, ref, style, data-*, …) spredes uændret.
export function mergeRowProps(zone, rowProps) {
  const base = trClass(zone);
  if (!rowProps) return { className: base };
  const { className: extra, ...rest } = rowProps;
  return { ...rest, className: [base, extra].filter(Boolean).join(" ") };
}

// text-3xs uppercase zone-/status-pill (radius 4px, tone-bg + tone-tekst).
export function zonePillClass(tone = "neutral") {
  const toneCls = ZONES[tone]?.pill ?? "bg-cz-subtle text-cz-2";
  return `inline-block whitespace-nowrap rounded px-1.5 py-0.5 font-data text-3xs font-bold uppercase tracking-[.06em] ${toneCls}`;
}
