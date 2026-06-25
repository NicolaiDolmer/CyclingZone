// Race Hub S3 — kaptajn 1/2/3 pr. terræn-bucket. Rangordnet liste (op til 3) pr.
// bucket med ÆGTE egnethedsdata (delt FitBar mod bucket-suitability) + auto-foreslå.
import { useTranslation } from "react-i18next";
import { Select } from "../../ui";
import FitBar from "../FitBar.jsx";
import { TERRAIN_BUCKETS, moveInList, toggleInList, autoSuggestCaptains } from "../../../lib/strategyLogic.js";

const MAX_CAPTAINS = 3;

export default function CaptainBoard({ roster, value, onChange }) {
  const { t } = useTranslation("races");
  const byId = new Map(roster.map((r) => [r.id, r]));

  const setBucket = (bucket, list) => onChange({ ...value, [bucket]: list });

  return (
    <section className="border border-cz-border rounded-cz bg-cz-card p-4 mb-4">
      <h2 className="text-sm font-semibold text-cz-1">{t("strategy.captains.title")}</h2>
      <p className="text-[11px] text-cz-3 mt-0.5 mb-3">{t("strategy.captains.help")}</p>

      <div className="grid sm:grid-cols-2 gap-3">
        {TERRAIN_BUCKETS.map((bucket) => {
          const list = value[bucket] || [];
          const available = roster.filter((r) => !list.includes(r.id));
          return (
            <div key={bucket} className="border border-cz-border rounded-cz p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-cz-2">{t(`strategy.buckets.${bucket}`)}</span>
                <button type="button" onClick={() => setBucket(bucket, autoSuggestCaptains(roster, bucket))}
                  className="text-[11px] text-cz-accent-t hover:underline">{t("strategy.captains.suggest")}</button>
              </div>

              {list.length === 0 ? (
                <p className="text-[11px] text-cz-3 italic mb-2">{t("strategy.captains.empty")}</p>
              ) : (
                <ol className="space-y-1 mb-2">
                  {list.map((id, i) => {
                    const r = byId.get(id);
                    if (!r) return null;
                    return (
                      <li key={id} className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-cz-3 w-4">{t("strategy.captains.rank", { n: i + 1 })}</span>
                        <span className="text-xs text-cz-1 truncate flex-1">{r.name}</span>
                        <FitBar score={r.suitabilities?.[bucket]} />
                        <span className="flex items-center gap-0.5">
                          <button type="button" aria-label={t("strategy.aChain.up")} disabled={i === 0}
                            onClick={() => setBucket(bucket, moveInList(list, i, -1))}
                            className="text-cz-3 hover:text-cz-1 disabled:opacity-30 px-0.5 leading-none">↑</button>
                          <button type="button" aria-label={t("strategy.aChain.down")} disabled={i === list.length - 1}
                            onClick={() => setBucket(bucket, moveInList(list, i, 1))}
                            className="text-cz-3 hover:text-cz-1 disabled:opacity-30 px-0.5 leading-none">↓</button>
                          <button type="button" aria-label={t("strategy.aChain.remove")}
                            onClick={() => setBucket(bucket, toggleInList(list, id))}
                            className="text-cz-3 hover:text-cz-danger px-0.5 text-base leading-none">×</button>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}

              {list.length < MAX_CAPTAINS && available.length > 0 && (
                <Select size="sm" value="" aria-label={`${t(`strategy.buckets.${bucket}`)} — ${t("strategy.captains.suggest")}`}
                  onChange={(e) => { if (e.target.value) setBucket(bucket, toggleInList(list, e.target.value)); }}>
                  <option value="">{t("strategy.aChain.add")}…</option>
                  {available.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
