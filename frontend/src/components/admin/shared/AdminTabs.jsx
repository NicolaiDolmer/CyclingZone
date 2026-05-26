import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";

// labelKey-pattern (i stedet for label-string) så module-level TABS-array kan
// referere i18n-keys uden at kalde useTranslation udenfor component-scope.
// Samme pattern som MobileQuickNav.jsx (Refs #689 nav-strings guard).
// "Økonomi" → nav.item.finance ("Finance"/"Økonomi"). Øvrige labels er
// admin-interne og ikke yet i en namespace; lavet labelKey-friendly så
// fremtidig oversættelse kun kræver key + JSON-entry.
const TABS = [
  { to: "/admin/season",  label: "Sæson & Løb",         icon: "🏁" },
  { to: "/admin/economy", labelKey: "nav.item.finance", icon: "💰" },
  { to: "/admin/users",   label: "Brugere",             icon: "👥" },
  { to: "/admin/data",    label: "Data/Import",         icon: "📥" },
  { to: "/admin/system",  label: "System",              icon: "⚙️" },
];

export default function AdminTabs() {
  const { t } = useTranslation("common");
  return (
    <nav className="flex gap-1 border-b border-cz-border mb-6 overflow-x-auto">
      {TABS.map(tab => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) =>
            `px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              isActive
                ? "border-cz-accent text-cz-1"
                : "border-transparent text-cz-3 hover:text-cz-2"
            }`}
        >
          <span className="me-1.5">{tab.icon}</span>{tab.labelKey ? t(tab.labelKey) : tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
