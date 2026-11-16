// #8081 / #6944: aldersvalget i akademiets profil (skitse B fra PR #8185, ét
// fokus-valg). Kun et designudkast: valget gemmes ikke og ændrer intet optag.
import { Segmented } from "../ui/Segmented.jsx";
import { AGE_FOCUS_OPTIONS, ageFocusDistribution } from "./designModel.ts";
import { useDesignCopy } from "./copy.ts";

export default function AgeFocusField8081({ value, onChange, compact = false }: { value: string; onChange: (v: string) => void; compact?: boolean }) {
  const c = useDesignCopy();
  const options = AGE_FOCUS_OPTIONS.map((v) => ({ value: v, label: v === "mixed" ? c("age.mixed") : v }));
  const dist = ageFocusDistribution(value);
  return (
    <div className="flex flex-col gap-2" data-testid="design8081-age-focus">
      <span className="text-xs font-medium text-cz-2">{c("age.label")}</span>
      {!compact && <p className="text-xs text-cz-3">{c("age.intro")}</p>}
      <Segmented label={c("age.label")} value={value} onChange={onChange} options={options} className="self-start" />
      <ul className="flex flex-wrap gap-x-4 gap-y-1 font-data text-2xs tabular-nums text-cz-2">
        {dist.map((d) => (
          <li key={d.age} className={d.share === "many" ? "text-cz-1" : undefined}>
            {c("age.row", { age: d.age, share: c(`age.share.${d.share}`) })}
            <span className="text-cz-3"> · {c(`squad.${d.squad}`)}</span>
          </li>
        ))}
      </ul>
      <p className="text-3xs text-cz-3">{c("age.toU23")} {c("previewNote")}</p>
    </div>
  );
}
