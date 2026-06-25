// Race Hub S3 — faste rolle-regler pr. rytter. Et valgfrit flag pr. rytter
// (ingen / altid kaptajn / altid sprint-kaptajn hvis udtaget). Sparse map: kun
// ryttere med en regel gemmes.
import { useTranslation } from "react-i18next";
import { Select } from "../../ui";

const RULES = ["always_captain", "always_sprint_captain_if_present"];

export default function RoleRulesEditor({ roster, value, onChange }) {
  const { t } = useTranslation("races");

  const setRule = (riderId, rule) => {
    const next = { ...value };
    if (rule) next[riderId] = rule;
    else delete next[riderId];
    onChange(next);
  };

  return (
    <section className="border border-cz-border rounded-cz bg-cz-card p-4 mb-4">
      <h2 className="text-sm font-semibold text-cz-1">{t("strategy.roleRules.title")}</h2>
      <p className="text-[11px] text-cz-3 mt-0.5 mb-3">{t("strategy.roleRules.help")}</p>
      <div className="space-y-1">
        {roster.map((r) => (
          <div key={r.id} className="flex items-center gap-2 px-2 py-1">
            <span className="text-xs text-cz-1 truncate flex-1">{r.name}</span>
            <Select size="sm" className="w-56" value={value[r.id] || ""}
              aria-label={`${r.name} — ${t("strategy.roleRules.title")}`}
              onChange={(e) => setRule(r.id, e.target.value)}>
              <option value="">{t("strategy.roleRules.none")}</option>
              {RULES.map((rule) => <option key={rule} value={rule}>{t(`strategy.roleRules.${rule}`)}</option>)}
            </Select>
          </div>
        ))}
      </div>
    </section>
  );
}
