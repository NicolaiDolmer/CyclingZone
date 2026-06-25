// Race Hub S3 — live preview-diff: "Sådan ændrer din strategi udtagelserne".
// Viser pr. kommende løb hvilke ryttere der kommer ind/ud + kaptajn-skift. Skriver intet.
import { useTranslation } from "react-i18next";
import { summarizeDiff } from "../../../lib/strategyLogic.js";

export default function PreviewDiff({ diff, roster, raceNames = {} }) {
  const { t } = useTranslation("races");
  const nameById = new Map(roster.map((r) => [r.id, r.name]));
  const nm = (id) => nameById.get(id) || id;
  const summary = summarizeDiff(diff);
  const changed = Object.entries(diff).filter(([, d]) => d.added.length || d.removed.length || d.captainChange);

  return (
    <section className="border border-cz-border rounded-cz bg-cz-card p-4 mt-4">
      <h2 className="text-sm font-semibold text-cz-1">{t("strategy.preview.title")}</h2>
      {changed.length === 0 ? (
        <p className="text-xs text-cz-3 italic mt-2">{t("strategy.preview.none")}</p>
      ) : (
        <>
          <p className="text-[11px] text-cz-2 mt-1 mb-3">{t("strategy.preview.summary", summary)}</p>
          <ul className="space-y-2">
            {changed.map(([raceId, d]) => (
              <li key={raceId} className="text-xs border-l-2 border-cz-border pl-2">
                <p className="text-cz-1 font-medium truncate">{raceNames[raceId] || raceId}</p>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                  {d.added.map((id) => (
                    <span key={`a${id}`} className="text-cz-success">+ {t("strategy.preview.in")} {nm(id)}</span>
                  ))}
                  {d.removed.map((id) => (
                    <span key={`r${id}`} className="text-cz-danger">− {t("strategy.preview.out")} {nm(id)}</span>
                  ))}
                  {d.captainChange && (
                    <span className="text-cz-accent-t">{t("strategy.preview.captain", { name: nm(d.captainChange.to) })}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
