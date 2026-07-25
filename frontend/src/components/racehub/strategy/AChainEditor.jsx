// Race Hub S3 — A-kæde-editor: rangordnet pecking-order. Tilføj fra trup, flyt op/ned,
// fjern. Rang = array-index (fodrer generatorens determinisme). Editorial, ingen AI-slop.
import { useTranslation } from "react-i18next";
import { Select, Section, SectionHeader } from "../../ui";
import { ArrowUpIcon, ArrowDownIcon, XIcon } from "../../ui/icons/index.jsx";
import { moveInList, toggleInList } from "../../../lib/strategyLogic.js";

export default function AChainEditor({ roster, value, onChange }) {
  const { t } = useTranslation("races");
  const byId = new Map(roster.map((r) => [r.id, r]));
  const available = roster.filter((r) => !value.includes(r.id));

  return (
    <Section>
      <SectionHeader title={t("strategy.aChain.title")} className="mb-1" />
      <p className="text-2xs text-cz-3 mb-3">{t("strategy.aChain.help")}</p>

      {value.length === 0 ? (
        <p className="text-xs text-cz-3 italic mb-3">{t("strategy.aChain.empty")}</p>
      ) : (
        <ol className="space-y-1 mb-3">
          {value.map((id, i) => {
            const r = byId.get(id);
            if (!r) return null;
            return (
              <li key={id} className="flex items-center gap-2 px-2 py-1.5 rounded-cz bg-cz-subtle">
                <span className="font-mono text-2xs text-cz-3 w-5 text-right tabular-nums">{i + 1}</span>
                <span className="text-xs text-cz-1 truncate flex-1">{r.name}</span>
                {Number.isFinite(r.overall) && <span className="font-mono text-2xs text-cz-2 tabular-nums">{r.overall}</span>}
                <span className="flex items-center gap-0.5">
                  <button type="button" aria-label={t("strategy.aChain.up")} disabled={i === 0}
                    onClick={() => onChange(moveInList(value, i, -1))}
                    className="text-cz-3 hover:text-cz-1 disabled:opacity-30 px-1 leading-none">
                    <ArrowUpIcon size={13} aria-hidden="true" /></button>
                  <button type="button" aria-label={t("strategy.aChain.down")} disabled={i === value.length - 1}
                    onClick={() => onChange(moveInList(value, i, 1))}
                    className="text-cz-3 hover:text-cz-1 disabled:opacity-30 px-1 leading-none">
                    <ArrowDownIcon size={13} aria-hidden="true" /></button>
                  <button type="button" aria-label={t("strategy.aChain.remove")}
                    onClick={() => onChange(toggleInList(value, id))}
                    className="text-cz-3 hover:text-cz-danger px-1 leading-none">
                    <XIcon size={13} aria-hidden="true" /></button>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {available.length > 0 && (
        <Select size="sm" value="" aria-label={t("strategy.aChain.add")}
          onChange={(e) => { if (e.target.value) onChange(toggleInList(value, e.target.value)); }}>
          <option value="">{t("strategy.aChain.add")}…</option>
          {available.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
      )}
    </Section>
  );
}
