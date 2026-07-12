// RiderProfileTabs — sticky tab-bar for den redesignede rytterprofil (#2000).
//
// 9 tabs, aktiv = guld-understregning. Horisontal scroll på mobil (tab-baren
// klipper aldrig). Prop-drevet: parent ejer activeTab-state. Token-only.
// Sidder under switcher-baren i scroll-stакken (lavere top end den).

export default function RiderProfileTabs({ tabs, activeTab, onSelect }) {
  return (
    <div
      role="tablist"
      className="sticky top-[52px] z-[1090] -mx-4 sm:mx-0 px-4 sm:px-0 bg-cz-body border-b border-cz-border mb-4 flex gap-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const active = tab.key === activeTab;
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(tab.key)}
            className={`min-h-[44px] px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap flex-shrink-0 border-b-2 -mb-px transition-colors
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
