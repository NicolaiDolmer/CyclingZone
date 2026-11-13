// backend/lib/engine/v4/mechanics/jerseyHunt7855.ts
// #7855 (KUN s5_profiles_v3, slukket bag kontakten jersey_hunt_7855, ejer 7/11): troejejagten i
// etapeplanen. To opgaver: "Hent point i spurterne" (hunt_points) og "Hent bjergpoint" (hunt_kom).
// Designnote og maalt baseline: #7855 (tal privat i balance-internals/7855/).
// Ejerens tre valg 12/11 (docs/superpowers/specs/2026-11-12-7855-troejejagt-ejervalg.md):
//   A. Udbrud og jagt sammen: udbrudsleddet kan baere jagten (stagePlan.ts `hunt`). Han proever
//      udbruddet og koerer om pointene fra start, i udbruddet eller i den gruppe han ender i.
//   B. Evnen afgoer mod dem, der kaemper: jaegeren slaar kun ryttere, der ikke koerer med om
//      pointene. Mod andre kaempende i gruppen (andre jaegere, sprinterkaptajner, troejens foerer,
//      #6937-bjergjaegere, ogsaa AI-holdenes) afgoer evnen og passagens spredning, som mellem to
//      jaegere (bonusSeconds.computePassageOrder). Intet loft paa antal jaegere.
//   C. Hver spurt koster: hver passage opgaven fik ham til at koere med om, laegger et stykke
//      arbejde i front oveni etapens belastning (jerseyHuntFrontWork7855), uanset dagens oevrige led.
//
// HVAD OPGAVEN AENDRER (og intet andet):
//   1. Hvem kaemper om passagen. En rytter hvis aktuelle jagt (ctx.stagePlanHuntTasks7855) gaelder
//      netop denne art passage paa hans egen straekning, kaemper om den i den gruppe han sidder i,
//      ogsaa i feltet. Gruppen afgoer stadig foerst: et udbrud foran tager pointene foran ham.
//      Ingen ny terning.
//   2. Prisen: i loebet er det opgavens indsats (TASK_EFFORT). I traetheden bagefter taeller et
//      jagt-led med samme indsats (som tempo og foelg med), saa opgaven aldrig er en billigere vej
//      til samme loeb (dom 2, "frikortet"). Hver passage han koerte med om, fordi opgaven bad ham,
//      laegges oveni som arbejde i front (raceFatigue.stageWorkExposure). Passager han ville have
//      kaempet om alligevel (udbruddet, en lille gruppe, en rolle der kaemper) koster intet ekstra.
//   3. Filmen: passagen faar `hunters` (jaegerne der koerte om netop den), saa loebsfilmen og
//      etapeplanens opsummering kan sige det samme som motoren gjorde. `hunt_work_7855` er dem,
//      opgaven fik til at koere med (traethedens kilde).
//
// SLUKKET = bit-identisk: opgaverne findes kun paa en rute med `jersey_hunt_7855`
// (stagePlanEngine.createStagePlanRuntime), saa uden kontakten er der aldrig en jagt, og alt her
// returnerer tomt.
//
// REN: ingen IO, ingen rng, intet input muteres.

import type { StagePlanTask } from "../../../stagePlan.ts";

/** Opgaven der jager passagens art. */
export const JERSEY_HUNT_TASK_BY_KIND_7855: Readonly<Record<"sprint" | "kom", StagePlanTask>> = Object.freeze({
  sprint: "hunt_points",
  kom: "hunt_kom",
});

/**
 * #7855 valg C: arbejdet i front pr. passage opgaven fik rytteren til at koere med om (samme enhed
 * som traethedens andel i front, raceFatigue.stageWorkExposure). Spurt og bjergtop har hver sin
 * stoerrelse. Laegges oveni leddets egen indsats (stagePlanEngine.stagePlanLoadEfforts).
 * Kalibrering og maaling: balance-internals/7855/2026-11-12/.
 * Ejer 13/11 valg 2 ("Mindre pr. spurt"): stykket pr. spurt er sat ned, saa en hel dags jagt i
 * spurterne stadig ligger taet paa Haard (ejerens designtal; foer/efter ligger privat).
 * Bjergtoppens stykke er uaendret (dommerens S4 er et aabent ejer-valg).
 */
export const JERSEY_HUNT_WORK_7855: Readonly<Record<"sprint" | "kom", number>> = Object.freeze({
  sprint: 0.1,
  kom: 0.13,
});

/**
 * Rytterne der i dette segment jager passager af arten `kind`, i rider_id-orden. Kun ryttere der
 * stadig er i loebet (udgaaede er ikke paa vejen). Tom uden plan eller uden jagt.
 */
export function jerseyHuntersForPassage7855(
  huntTasks: Readonly<Record<string, StagePlanTask>> | null | undefined,
  kind: "sprint" | "kom",
  isRacing: (riderId: string) => boolean,
  /** Passagens km og hver jaegers straekning: et jagt-led kaemper kun om passager paa sin egen straekning. */
  passage?: { km: number; windows: Readonly<Record<string, { fromKm: number; toKm: number }>> | undefined },
): string[] {
  if (!huntTasks) return [];
  const task = JERSEY_HUNT_TASK_BY_KIND_7855[kind];
  const onStretch = (id: string) => {
    const window = passage?.windows?.[id];
    return !window || (passage!.km > window.fromKm && passage!.km <= window.toKm);
  };
  return Object.keys(huntTasks)
    .filter((id) => huntTasks[id] === task && isRacing(id) && onStretch(id))
    .sort();
}

/**
 * Passagens felter for jagten. `hunters`: jaegerne der koerte om passagen (filmen). `hunt_work_7855`:
 * dem af dem, opgaven fik til at koere med (de ville ellers ikke have kaempet om den i deres gruppe),
 * og som betaler arbejdet (valg C). Udeladt naar tomme: uden jaegere er passagen samme objekt-form.
 */
export function passageHuntersField7855(hunters: readonly string[], madeToContest: readonly string[] = []): { hunters?: string[]; hunt_work_7855?: string[] } {
  if (!hunters.length) return {};
  return { hunters: [...hunters], ...(madeToContest.length ? { hunt_work_7855: [...madeToContest].sort() } : {}) };
}

/**
 * #7855 valg C: arbejdet i front hver rytter fik af jagten paa etapen (sum over passagerne, hvor
 * han staar i `hunt_work_7855`). Tomt kort uden jagt, saa traetheden er uaendret.
 */
export function jerseyHuntFrontWork7855(passages: ReadonlyArray<{ kind?: string; hunt_work_7855?: readonly string[] }> | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of passages ?? []) {
    if (!p?.hunt_work_7855?.length) continue;
    const share = p.kind === "kom" ? JERSEY_HUNT_WORK_7855.kom : p.kind === "sprint" ? JERSEY_HUNT_WORK_7855.sprint : 0;
    if (!share) continue;
    for (const id of p.hunt_work_7855) out.set(String(id), (out.get(String(id)) ?? 0) + share);
  }
  return out;
}
