// #4628 (slice 3 af #4622) — T3-heroens stat-raekke (PAGE_TEMPLATES.md §T3:
// "Stat row: 1px top rule, pt-4; label text-3xs uppercase tracking .1em
// --text-3; value data font 20px/650 tabular").
//
// Opskriften var kopieret lokalt paa tre sider (manager-, hold- og loebssiden)
// som en ren `flex ... overflow-x-auto`. Den kopi klipper: audit 2026-09
// (raekke #37) fandt at /managers/:teamId's fjerde tal ("ACHIEVEMENTS") helt
// forsvandt paa 375px, hvor kun en tom skillelinje stod tilbage i kanten.
// Vandret scroll inde i et hero-kort er hverken synligt eller forventet, og
// TASTE P10 kraever at mobil viser de SAMME tal som desktop.
//
// Loesningen er geometri, ikke faerre tal: 2 kolonner paa mobil (grid), den
// uaendrede vandrette raekke fra sm og op. Tallene er tabulaere begge steder.
//
// Filen er .jsx og ikke .tsx (hard rule 31) af samme grund som Segmented.jsx:
// CI's `npm run typecheck` mangler @types/react. Se PR-beskrivelsen (#4628).
//
// props:
//   items — [{ label, value, sub? }]
export function HeroStats({ items, className = "" }) {
  return (
    <div
      className={`mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-cz-border pt-4 sm:flex sm:gap-0 sm:overflow-x-auto ${className}`.trim()}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="min-w-0 sm:me-6 sm:shrink-0 sm:border-e sm:border-cz-border sm:pe-6 sm:last:me-0 sm:last:border-e-0 sm:last:pe-0"
        >
          <div className="mb-1 font-data text-3xs font-semibold uppercase tracking-[.1em] text-cz-3">
            {item.label}
          </div>
          <div className="font-data text-[20px] font-[650] leading-tight tabular-nums text-cz-1 sm:whitespace-nowrap">
            {item.value}
          </div>
          {item.sub && (
            <div className="mt-0.5 font-data text-2xs text-cz-3 sm:whitespace-nowrap">{item.sub}</div>
          )}
        </div>
      ))}
    </div>
  );
}

export default HeroStats;
