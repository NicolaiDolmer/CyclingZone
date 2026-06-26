import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

function pathMatches(pathname, to) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

const TABS = [
  {
    to: "/dashboard",
    labelKey: "nav.item.dashboard",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
        <path d="M9 22V12h6v10"/>
      </svg>
    ),
  },
  {
    to: "/notifications",
    labelKey: "nav.item.notifications",
    badge: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M22 12h-6l-2 3H10l-2-3H2"/>
        <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>
      </svg>
    ),
  },
  {
    to: "/auctions",
    // Mobile tab er gateway til hele "Market"-sektionen (auctions/transfers/riders/...),
    // ikke kun auctions-listen — derfor gruppe-label, ikke item-label.
    labelKey: "nav.group.marked",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
        <line x1="3" y1="6" x2="21" y2="6"/>
        <path d="M16 10a4 4 0 01-8 0"/>
      </svg>
    ),
  },
  {
    to: "/riders",
    labelKey: "nav.item.riders",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/>
        <path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
    ),
  },
  {
    to: "/team",
    labelKey: "nav.item.team",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>
    ),
  },
];

export default function MobileQuickNav({ unread }) {
  const location = useLocation();
  const { t } = useTranslation("common");

  return (
    <nav
      className="fixed left-0 right-0 bottom-0 z-30 md:hidden bg-cz-sidebar border-t border-cz-sidebar-border transition-all duration-200"
      style={{ height: "56px" }}
    >
      <div className="flex h-full">
        {TABS.map(({ to, labelKey, icon, badge }) => {
          const isActive = pathMatches(location.pathname, to);
          const showBadge = badge && unread > 0;
          return (
            <NavLink
              key={to}
              to={to}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors
                ${isActive ? "text-cz-accent" : "text-cz-sidebar-2 hover:text-cz-sidebar-1"}`}
            >
              <div className="relative">
                {icon}
                {showBadge && (
                  <span className="absolute -top-1 -right-1 bg-cz-accent text-cz-on-accent text-[8px] font-black w-3.5 h-3.5 rounded-full flex items-center justify-center leading-none">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </div>
              <span>{t(labelKey)}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
