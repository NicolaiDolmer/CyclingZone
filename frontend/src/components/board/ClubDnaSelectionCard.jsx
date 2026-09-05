import { useState } from "react";
import { useTranslation } from "react-i18next";
import Section from "../ui/Section.jsx";
import { EditIcon } from "../ui/icons/index.jsx";
import { getDnaCopy, getDnaRationale, getDnaSlotLabel } from "./dnaCopy.js";

// ── S-02f · Klub-DNA-komponenter ───────────────────────────────────────────────
//
// #4557 · Flyttet UÆNDRET ud af BoardPage.jsx (bortset fra `showEmoji`, se
// nedenfor) så den gamle bestyrelsesside og Boardroom deler én komponent i
// stedet for to kopier. BoardPage importerer herfra og er visuelt uændret.
//
// Vises før første plan-card når manageren er i sæson 2+ (identity_basis findes,
// is_baseline_phase=false), men endnu ikke har valgt DNA. 3 forslag-kort + Vælg-knap.
// #878 første-valg + #2022 re-valg i sæson 1. currentKey markerer det aktuelt
// valgte DNA (re-valg-flowet) med accent-ramme + "Current"-label i stedet for en
// vælg-knap. *Key-props lader re-valg-panelet vise sin egen copy uden at duplikere
// markup.
export function ClubDnaSelectionCard({
  suggestions = [], onChoose, busy = false, error = "", currentKey = null,
  sectionLabelKey = "dna.sectionLabel", headingKey = "dna.selectHeading",
  introKey = "dna.selectIntro", chooseLabelKey = "dna.choose",
}) {
  const { t } = useTranslation("board");
  if (!suggestions.length) return null;
  return (
    <Section className="mt-4">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">{t(sectionLabelKey)}</p>
          <h2 className="text-cz-1 font-semibold text-base">{t(headingKey)}</h2>
          <p className="text-cz-2 text-sm mt-1">{t(introKey)}</p>
        </div>
      </div>
      {error && (
        <div className="mb-3 p-3 rounded-cz border border-cz-danger/30 bg-cz-danger-bg text-cz-danger text-sm">
          {error}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {suggestions.map((suggestion) => {
          const isCurrent = currentKey != null && suggestion.key === currentKey;
          return (
            <div key={suggestion.key}
              className={`bg-cz-subtle border rounded-cz p-4 flex flex-col gap-3 ${isCurrent ? "border-cz-accent/60" : "border-cz-border"}`}>
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-full bg-cz-card border border-cz-border
                  flex items-center justify-center text-2xl flex-shrink-0">
                  <span aria-hidden>{suggestion.emoji}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-cz-3 text-3xs uppercase tracking-wider">
                    {getDnaSlotLabel(t, suggestion)}
                  </p>
                  <p className="text-cz-1 font-semibold text-sm leading-tight">{getDnaCopy(t, suggestion, "label")}</p>
                </div>
              </div>
              <p className="text-cz-2 text-xs leading-relaxed">{getDnaCopy(t, suggestion, "shortDescription")}</p>
              {getDnaCopy(t, suggestion, "longDescription") && (
                <p className="text-cz-3 text-2xs italic leading-relaxed line-clamp-3">
                  {getDnaCopy(t, suggestion, "longDescription")}
                </p>
              )}
              {getDnaRationale(t, suggestion) && (
                <p className="text-cz-accent-t text-2xs">{getDnaRationale(t, suggestion)}</p>
              )}
              {isCurrent ? (
                <span className="mt-auto py-2 text-center text-cz-accent-t text-sm font-semibold
                  bg-cz-accent/10 rounded-cz border border-cz-accent/30">
                  {t("dna.current")}
                </span>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onChoose(suggestion.key)}
                  className="mt-auto py-2 bg-cz-accent text-cz-on-accent text-sm font-semibold rounded-cz
                    hover:brightness-110 disabled:opacity-50 transition-all"
                >
                  {busy ? t("dna.saving") : t(chooseLabelKey)}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// #2022 fase 2 · Re-valg-affordance: så længe holdet er i sin første sæson kan
// manageren folde forslagene ud og skifte DNA. Det valgte DNA vises stadig som
// badge ovenfor; dette panel ligger under og er kollapset by default for at holde
// fladen ren.
export function ClubDnaRechoosePanel({ suggestions = [], currentKey = null, onChoose, busy = false, error = "" }) {
  const { t } = useTranslation("board");
  const [open, setOpen] = useState(false);
  if (!suggestions.length) return null;
  return (
    <div className="mt-3">
      <div className="flex items-start gap-2 mb-2 px-1 text-cz-3 text-xs leading-relaxed">
        <span>{t("dna.rechoose.hint")}</span>
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-center gap-2 py-2 border border-cz-border rounded-cz
          text-cz-2 text-sm font-semibold hover:border-cz-accent/40 hover:bg-cz-subtle/40 transition-colors"
      >
        <EditIcon size={14} aria-hidden="true" /> {t("dna.rechoose.toggle")}
      </button>
      {open && (
        <ClubDnaSelectionCard
          suggestions={suggestions}
          currentKey={currentKey}
          onChoose={onChoose}
          busy={busy}
          error={error}
          sectionLabelKey="dna.rechoose.sectionLabel"
          headingKey="dna.rechoose.heading"
          introKey="dna.rechoose.intro"
          chooseLabelKey="dna.switch"
        />
      )}
    </div>
  );
}

export default ClubDnaSelectionCard;
