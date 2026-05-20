import { NavLink } from "react-router-dom";

const TABS = [
  { to: "/admin/season",  label: "Sæson & Løb", icon: "🏁" },
  { to: "/admin/economy", label: "Økonomi",     icon: "💰" },
  { to: "/admin/users",   label: "Brugere",     icon: "👥" },
  { to: "/admin/data",    label: "Data/Import", icon: "📥" },
  { to: "/admin/system",  label: "System",      icon: "⚙️" },
];

export default function AdminTabs() {
  return (
    <nav className="flex gap-1 border-b border-cz-border mb-6 overflow-x-auto">
      {TABS.map(t => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) =>
            `px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              isActive
                ? "border-cz-accent text-cz-1"
                : "border-transparent text-cz-3 hover:text-cz-2"
            }`}
        >
          <span className="mr-1.5">{t.icon}</span>{t.label}
        </NavLink>
      ))}
    </nav>
  );
}
