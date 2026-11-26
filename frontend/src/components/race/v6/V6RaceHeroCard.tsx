// #7778 udgave E (valg 20-22, ejer 15/11): løbshovedet som ÉT kort.
//
// T3-heroens anatomi (PAGE_TEMPLATES T3): --bg-card, 1 px kant, 5 px radius,
// 2 px guld-streg øverst. Række 1: løbets navn (display-skrift) med mærkerne og
// "N etaper · sæson N" på samme linje. Hairline. Række 2: talrækken (HeroStats)
// med fristen og sidens ENE guld-knap til højre. Hairline. Række 3: etapestriben
// som kortets bund (`strip`). Ingen statuschip og ingen sætning øverst (valg 22).
//
// Eget modul (ikke i RacePageV6's chunk), så RaceDetailPage kan tegne kortet,
// mens v6-rammen hentes, uden at hovedet hopper.
import type { ReactNode } from "react";
import { Button, HeroStats, type HeroStatItem } from "./v6Ui.ts";

/** Løbshovedets indhold. Siden (RaceDetailPage) ejer tallene og teksterne. */
export interface RacePageV6Hero {
  name: string;
  /** Løbsklasse og løbstype som CategoryTag. */
  tags: ReactNode;
  /** "N stages · Season N". */
  meta: string;
  /** Talrækken (HeroStats): Etape, Terræn, Udtaget, Samlet. */
  stats: HeroStatItem[];
  /** Fristen og sidens ene guld-knap; null = ingen åben taktik. */
  action: { lock: string; label: string; onClick: () => void } | null;
}

/** Stribens højde, mens v6-rammen hentes (samme højde som cellerne, så intet hopper). */
export const V6_STRIP_RESERVED_CLASS = "h-[81px] border-t border-cz-border";

/**
 * #7859: `aside` = spoiler-kontakten til højre i række 1; `note` = linjen under navnet, når etapen er skjult.
 * #8298: `actionNote` = taktikkens linje efter fristen ("7 riders ride the assistant's plan").
 * #5841: `editions` = udgave-skiftet (Pool/Season), til højre i række 1 foran spoiler-kontakten (skitse A).
 */
export default function V6RaceHeroCard({ hero, strip, aside = null, note = null, editions = null, actionNote = null }: { hero: RacePageV6Hero; strip: ReactNode; aside?: ReactNode; note?: ReactNode; editions?: ReactNode; actionNote?: string | null }) {
  return (
    <section data-race-hero="e" aria-label={hero.name} className="overflow-hidden rounded-cz border border-cz-border border-t-2 border-t-cz-accent bg-cz-card">
      <div className="grid items-center gap-2 px-4 pt-3.5 pb-3 md:px-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="m-0 min-w-0 font-display text-[40px] leading-[.92] uppercase text-cz-1 wrap-break-word">{hero.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {hero.tags}
            {/* #7566: et endagsløb gentager ikke typen fra mærket ved siden af (siden bygger linjen). */}
            {hero.meta && <span className="font-data text-2xs uppercase tracking-[.08em] tabular-nums text-cz-3">{hero.meta}</span>}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2 empty:hidden sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
          {editions}
          {aside && <div className="min-h-11">{aside}</div>}
        </div>
        {note && <div className="min-h-4 xl:col-span-2">{note}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-cz-border px-4 py-2.5 md:px-5">
        <HeroStats flush items={hero.stats} className="min-w-0 max-sm:w-full" />
        {hero.action && (
          // Fristen står over knappen (højrestillet fra sm), så tal og handling holder
          // én række også ved 1280 px uden at hovedet bliver højere.
          <div data-race-hero-action className="flex w-full flex-col items-stretch gap-1.5 sm:ms-auto sm:w-auto sm:items-end">
            <p className="m-0 font-data text-xs tabular-nums text-cz-2">{hero.action.lock}{actionNote ? ` · ${actionNote}` : ""}</p>
            <Button variant="primary" size="md" fullWidth className="sm:w-auto" onClick={hero.action.onClick}>{hero.action.label}</Button>
          </div>
        )}
      </div>
      {strip}
    </section>
  );
}
