import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import {
  FlagIcon, CoinIcon, TeamIcon, UploadIcon, SettingsIcon, InboxIcon,
} from "../../ui/icons/index.jsx";

// labelKey-pattern (i stedet for label-string) så module-level TABS-array kan
// referere i18n-keys uden at kalde useTranslation udenfor component-scope.
// Samme pattern som MobileQuickNav.jsx (Refs #689 nav-strings guard).
// "Økonomi" → nav.item.finance ("Finance"/"Økonomi"). Øvrige labels er
// admin-interne og ikke yet i en namespace; lavet labelKey-friendly så
// fremtidig oversættelse kun kræver key + JSON-entry.
//
// #2842: emoji-glyfferne er skiftet til stroke-ikoner fra design-systemet.
// PAGE_TEMPLATES.md's hard don'ts siger "no emoji (stroke icon set only)", og
// da feedback-fanen skulle tilføjes ville en enkelt stroke-ikon-fane ved siden
// af fem emoji have set ud som en fejl. Ikonerne bærer aria-hidden — labelen er
// den tilgængelige tekst.
const TABS = [
  { to: "/admin/season",   label: "Sæson & Løb",         Icon: FlagIcon },
  { to: "/admin/economy",  labelKey: "nav.item.finance", Icon: CoinIcon },
  { to: "/admin/users",    label: "Brugere",             Icon: TeamIcon },
  { to: "/admin/feedback", label: "Feedback",            Icon: InboxIcon },
  { to: "/admin/data",     label: "Data/Import",         Icon: UploadIcon },
  { to: "/admin/system",   label: "System",              Icon: SettingsIcon },
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
            `px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors inline-flex items-center gap-1.5 ${
              isActive
                ? "border-cz-accent text-cz-1"
                : "border-transparent text-cz-3 hover:text-cz-2"
            }`}
        >
          <tab.Icon size={15} aria-hidden="true" />
          {tab.labelKey ? t(tab.labelKey) : tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
