import { useTranslation } from "react-i18next";

const TABS = ["overview", "effect", "history"];

// #2849 bølge 5c (T3-revision, ejer 24/7): heroet er et kort, så tab-baren
// står UNDER kortet på sidens baggrund og bærer sin egen hairline-bundrule;
// den aktive fanes guld-underline overlapper rulen via `-mb-px`. Spejler
// RiderProfileTabs 1:1 (bruges KUN af StaffProfilePage).
export default function StaffProfileTabs({ active, onChange }) {
  const { t } = useTranslation("staff");
  return (
    <div
      role="tablist"
      className="-mx-4 md:mx-0 px-4 md:px-0 mt-5 flex gap-1 overflow-x-auto border-b border-cz-border [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map((tab) => {
        const isActive = active === tab;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab)}
            className={`min-h-[44px] px-3.5 py-2.5 text-sm font-medium whitespace-nowrap flex-shrink-0 border-b-2 -mb-px transition-colors
              ${isActive
                ? "text-cz-1 border-cz-accent"
                : "text-cz-2 border-transparent hover:text-cz-1"}`}
          >
            {t(`tabs.${tab}`)}
          </button>
        );
      })}
    </div>
  );
}
