import { useTranslation } from "react-i18next";
const TABS = ["overview", "effect", "history"];
export default function StaffProfileTabs({ active, onChange }) {
  const { t } = useTranslation("staff");
  return (
    <div className="sticky top-0 z-10 bg-cz-body flex gap-4 border-b border-cz-border mb-4">
      {TABS.map((tab) => (
        <button key={tab} type="button" onClick={() => onChange(tab)}
          className={`py-2 text-[13px] uppercase tracking-wide border-b-2 -mb-px ${
            active === tab ? "border-cz-accent text-cz-1" : "border-transparent text-cz-3"}`}>
          {t(`tabs.${tab}`)}
        </button>
      ))}
    </div>
  );
}
