import { useTranslation } from "react-i18next";
import { Section, SectionHeader, Button } from "../../components/ui";
import { getDnaCopy, getDnaRationale, getDnaSlotLabel } from "../../components/board/dnaCopy.js";

// #4557 (overblik + faner) · "Choose your club identity" paa Boardroom-
// overblikket for de hold der endnu ikke har et klub-DNA. Kortet tager
// overblikkets ØVERSTE plads (i stedet for tillidskortet), fordi intet andet
// paa siden giver mening foer identiteten er valgt: DNA'et afgoer hvem der
// sidder i bestyrelsen og hvordan maalene vaegtes (BOARD_RULES §8).
//
// Copy og data er de EKSISTERENDE (`dna.*` i board.json, forslagene fra
// GET /board/dna-suggestions) — ingen ny tekst, ingen ny rute. To bevidste
// forskelle fra den gamle ClubDnaSelectionCard:
//  · ingen emoji-cirkel (TASTE §3-forbud, PAGE_TEMPLATES "no emoji"),
//  · knappen er SECONDARY, fordi sidens ene guld er "Enter annual meeting".
export default function DnaChoiceCard({
  suggestions = [], busy = false, error = "", onChoose, currentKey = null,
  headingKey = "dna.selectHeading", introKey = "dna.selectIntro", chooseLabelKey = "dna.choose",
}) {
  const { t } = useTranslation("board");
  if (!suggestions.length) return null;

  return (
    <Section>
      <SectionHeader title={t(headingKey)} meta={t("dna.sectionLabel")} />
      <p className="mb-4 text-[13px] leading-relaxed text-cz-2">{t(introKey)}</p>
      {error && (
        <p className="mb-3 rounded-cz border border-cz-danger/30 bg-cz-danger-bg px-3 py-2 text-[13px] text-cz-danger">
          {error}
        </p>
      )}
      <div className="grid gap-3.5 sm:grid-cols-3">
        {suggestions.map((suggestion) => (
          <div
            key={suggestion.key}
            className="flex flex-col gap-1.5 rounded-cz border border-cz-border bg-cz-subtle p-3.5"
          >
            <p className="font-data text-3xs uppercase tracking-[.1em] text-cz-3">
              {getDnaSlotLabel(t, suggestion)}
            </p>
            <p className="text-[13.5px] font-semibold leading-snug text-cz-1">
              {getDnaCopy(t, suggestion, "label")}
            </p>
            <p className="text-xs leading-relaxed text-cz-2">
              {getDnaCopy(t, suggestion, "shortDescription")}
            </p>
            {getDnaRationale(t, suggestion) && (
              <p className="font-data text-2xs text-cz-accent-t">{getDnaRationale(t, suggestion)}</p>
            )}
            {suggestion.key === currentKey ? (
              <span className="mt-auto rounded-cz border border-cz-border py-2 text-center text-xs font-medium text-cz-accent-t">
                {t("dna.current")}
              </span>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                fullWidth
                className="mt-auto"
                loading={busy}
                onClick={() => onChoose?.(suggestion.key)}
              >
                {t(chooseLabelKey)}
              </Button>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}
