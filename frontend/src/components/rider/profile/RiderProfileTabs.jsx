// RiderProfileTabs — T3 hero-bånd tab-bar for rytterprofilen (#2000, migreret
// #2849 bølge 5).
//
// 9 tabs, aktiv = guld-understregning. Horisontal scroll på mobil (tab-baren
// klipper aldrig). Prop-drevet: parent ejer activeTab-state. Token-only.
// Sidder på hero-båndets bundkant — `-mb-px` fusionerer tab-rulen med båndets
// egen `border-b` (PAGE_TEMPLATES.md T3: "tabs sit on the band's bottom edge").

export default function RiderProfileTabs({ tabs, activeTab, onSelect }) {
  return (
    <div
      role="tablist"
      className="-mx-4 md:mx-0 px-4 md:px-0 mt-5 flex gap-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const active = tab.key === activeTab;
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(tab.key)}
            className={`min-h-[44px] px-3.5 py-2.5 text-sm font-medium whitespace-nowrap flex-shrink-0 border-b-2 -mb-px transition-colors
              ${active
                ? "text-cz-1 border-cz-accent"
                : "text-cz-2 border-transparent hover:text-cz-1"}`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
