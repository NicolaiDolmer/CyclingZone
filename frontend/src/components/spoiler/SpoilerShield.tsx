// #7859 · Spoiler-skjoldets flader på løbssiden (wireframe v6c, skitse-PR #8292).
//
//   billede 1: kontakten "Spoiler shield" i løbets hoved (fra = som i dag)
//   billede 2: Story: "The finale is ahead · keep watching" og "Your day and the
//              result are in Results · Show results" i stedet for "Din dag"
//   billede 3: Resultater bag "Show results"
//   billede 4: ét tryk eller filmen i mål åbner etapen (useSpoilerShield)
//
// Teksterne ligger i namespacet "spoiler", som først hentes, når kontakten er tændt
// for spilleren (I18nReadyGate); første indlæsning vejer ikke mere (bundle-loftet).
// TASTE: hairlines, 5 px radius, ingen piller; knapperne er sekundære, så hovedets
// guld-knap forbliver sidens ene guld.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import I18nReadyGate from "../I18nReadyGate.jsx";
import { Button, Toggle } from "../ui";

function Gate({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return <I18nReadyGate ns="spoiler" fallback={fallback}>{children}</I18nReadyGate>;
}

/** Billede 1: kontakten i løbets hoved. */
export function SpoilerHeroSwitch({ id, on, onChange }: { id: string; on: boolean; onChange: (on: boolean) => void }) {
  return <Gate><HeroSwitch id={id} on={on} onChange={onChange} /></Gate>;
}

function HeroSwitch({ id, on, onChange }: { id: string; on: boolean; onChange: (on: boolean) => void }) {
  const { t } = useTranslation("spoiler");
  return (
    <span data-spoiler-switch={on ? "on" : "off"} className="inline-flex min-h-11 items-center rounded-cz border border-cz-border px-2.5 text-xs">
      <Toggle id={id} label={t("switch")} checked={on} onChange={(e: { target: { checked: boolean } }) => onChange(e.target.checked)} />
    </span>
  );
}

/** Billede 2-3: hovedets linje, når den valgte etape er skjult. */
export function SpoilerHeroNote() {
  return <Gate><HeroNote /></Gate>;
}

function HeroNote() {
  const { t } = useTranslation("spoiler");
  return <p data-spoiler-note className="m-0 basis-full text-xs text-cz-2">{t("hero.hidden")}</p>;
}

function DashedRow({ children, section }: { children: ReactNode; section: string }) {
  return (
    <div data-spoiler-section={section} className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-cz border border-dashed border-cz-border bg-cz-subtle px-4 py-3 text-center text-sm text-cz-2">
      {children}
    </div>
  );
}

/** Billede 3: Resultater bag "Show results". */
export function SpoilerResultsHidden({ onShow }: { onShow: () => void }) {
  return <Gate fallback={<ResultsPending />}><ResultsHidden onShow={onShow} /></Gate>;
}

function ResultsHidden({ onShow }: { onShow: () => void }) {
  const { t } = useTranslation("spoiler");
  return (
    <DashedRow section="results-hidden">
      <span>{t("results.hidden")}</span>
      <Button variant="secondary" size="sm" onClick={onShow}>{t("results.show")}</Button>
    </DashedRow>
  );
}

/** Mens skjoldets svar hentes (spilleren havde skjoldet tændt sidst): intet resultat. */
export function SpoilerResultsPending() {
  return <ResultsPending />;
}

function ResultsPending() {
  return <div data-spoiler-section="pending" aria-busy="true" className="h-[52px] rounded-cz border border-dashed border-cz-border bg-cz-subtle" />;
}

/** Billede 2: under filmen i stedet for "Din dag". */
export function SpoilerStoryResultsNote({ onShow }: { onShow: () => void }) {
  return <Gate fallback={<ResultsPending />}><StoryResultsNote onShow={onShow} /></Gate>;
}

function StoryResultsNote({ onShow }: { onShow: () => void }) {
  const { t } = useTranslation("spoiler");
  return (
    <DashedRow section="story-results">
      <span>{t("story.inResults")}</span>
      <Button variant="secondary" size="sm" onClick={onShow}>{t("results.show")}</Button>
    </DashedRow>
  );
}

/** Billede 2: referatet stopper ved filmen; finalen venter. */
export function SpoilerFinaleAhead() {
  return <Gate><FinaleAhead /></Gate>;
}

function FinaleAhead() {
  const { t } = useTranslation("spoiler");
  return (
    <p data-spoiler-section="finale-ahead" className="m-0 mt-2 rounded-cz border border-dashed border-cz-border px-3 py-2.5 text-center text-sm text-cz-2">
      {t("story.finaleAhead")}
    </p>
  );
}
