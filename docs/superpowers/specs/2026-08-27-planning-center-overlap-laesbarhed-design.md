# Overlap-laesbarhed i Planning Center (design)

**Dato:** 2026-08-27 · **Issues:** [#4296](https://github.com/NicolaiDolmer/CyclingZone/issues/4296) · [#4259](https://github.com/NicolaiDolmer/CyclingZone/issues/4259) · [#4295](https://github.com/NicolaiDolmer/CyclingZone/issues/4295)
**SSOT:** [`docs/PLANNING_CENTER_RULES.md`](../../PLANNING_CENTER_RULES.md) (hard rule 30) · skabeloner: [`docs/design/PAGE_TEMPLATES.md`](../../design/PAGE_TEMPLATES.md)
**Metode:** designpanel 27/8. Tre uafhaengige forslag pr. flade (linser: mindste tilfoejelse · mest laesbar ved 30 ryttere · mobil foerst), derefter et dommerpanel der scorede mod PAGE_TEMPLATES og anti-slop OG verificerede hvert forslags tokens, klasser og ikonnavne mod koden.

## Det ene princip

> **Vis konflikten FOER klikket, ikke efter.**

Graat og uklikbart med navngiven aarsag slaar klikbart plus advarsel bagefter. Fravaer af signal er det roligste signal: der tegnes intet for "alt er fint".

## Ejer-beslutninger 27/8

| # | Spoergsmaal | Beslutning |
|---|---|---|
| 1 | Foraeldreloese peak-vinduer efter kalender-regenerering | Slet alle 812 med backup. Udfoert, post-verify ren |
| 2 | Loebsdage 0- eller 1-baserede i UI | **1-baseret.** `RACE_DAY_DISPLAY_OFFSET` i `raceHubLogic.js`. Prisen er accepteret: UI siger N+1, databasen siger N |

## Hvad dommerpanelet fandt paa vejen

Fund der gaelder ud over de tre flader:

- `scripts/tone-check-em-dash.mjs` scanner KUN locales, prosa-sider, `index.html` og `patchNotes.js` (scriptets linje 15-33). To em-dashes staar derfor live i player-facing UI i `ContextBand.jsx:63` og `:78`, hvor CI ikke kan se dem.
- `.cz-pulse-flash` (`index.css:308`) er en GULD-puls og mangler den `prefers-reduced-motion`-guard som alle oevrige animationer i filen har som hard krav.
- `raceBindingWindow` (`raceBinding.js:75-87`) falder tilbage til CET-ordinaler (~20.000) naar bare een schedule-raekke mangler `game_day`. **Invariant der skal skrives ind i koden:** DISPLAY-tal kommer KUN fra `game_day`/`game_day_end`; `bindingWindow` bruges KUN til den booleske overlap-test, aldrig til et tal.
- `groupColumnsByGameDay` (`raceHubLogic.js:180-183`) beregner allerede `gameDayEnd`, men `RaceHubBoard.jsx:549` sender kun `g.gameDay`. Det er derfor "Race day 0" staar over Giro della Penisola.
- `AvailableRidersPool.jsx:93-96` navngiver ALLEREDE det bindende loeb inline. Puljen mangler loebsdags-TALLET, ikke navnet.

---

# RaceDaySpan

## Vinder
FORSLAG 3: RaceDaySpan: spaendet paa kortet, modparten navngivet

## Begrundelse
Forslag 3 vinder paa det ene der betyder noget: det er det eneste af de tre der skelner mellem OVERLAP og KONFLIKT. To loeb der deler loebsdage er lovligt og normalt. Det bliver foerst en konflikt naar en rytter staar i begge. Forslag 1 farver den lovlige tilstand roed (text-cz-danger + hover:bg-cz-danger-bg paa en helt normal kendsgerning), og paa et travlt braet ville halvdelen af kortene baere en permanent roed linje. Det er raab-ulv, altsaa det modsatte af "fravaer af signal er det roligste signal". Forslag 3 holder overlappet neutralt (text-cz-2, intet ikon, ingen flade) og eskalerer foerst til bg-cz-danger-bg + AlertTriangleIcon naar findSelectionOverlaps rent faktisk har en rytter i begge loeb. Forslag 3 fravaelger ogsaa LockIcon eksplicit med en begrundelse ("her ville den betyde noget andet") og tegner intet i den rolige tilstand. Det er den skarpeste signal-disciplin af de tre.

Verificeret mod koden, og det aendrede rangeringen tre steder:

1. tone-check-em-dash.mjs' scope (linje 15-33 i scriptet) er KUN locales + prosa-sider + index.html + patchNotes.js. ContextBand.jsx:63 og :78 baerer derfor to LIVE em-dashes i player-facing UI som CI ikke kan se. Kun forslag 1 fandt dem. Bekraeftet.

2. timeline.days[].dateText er `pool_race.date_text` (api.js:4620), altsaa loebets IMPORTEREDE dato-tekst, typisk et interval som "8/5 - 31/5" (se grandTourRestDays.test.js:11), sat med last-write-wins pr. loeb paa dagen. Det er IKKE en dato for den enkelte kalenderdag. Forslag 3 vil bruge den som ContextBands venstre side. Det er forkert, og forslag 1 advarede praecist mod det. Grafted vaek.

3. .cz-pulse-flash (index.css:308) som forslag 2 vil bruge til hoppet er en GULD-puls (rgb(var(--accent) / 0.45)) OG den mangler den prefers-reduced-motion-guard som alle de andre animationer i filen har (linje 342/365/381/395/402, "hard krav"). Konflikt er ikke guld. Afvist paa verifikation.

Forslag 2 taber trods den bedste 30-rytter-linse, fordi dens dyreste halvdel er delvist overfloedig: AvailableRidersPool.jsx:93-96 navngiver ALLEREDE det bindende loeb inline ("Optaget i {race}" via racehub.boundNamed + LockIcon). Puljen mangler kun loebsdags-tallet, ikke navnet. At betale ~690px og en fuld ombygning af den mest brugte blok for et tal er forkert vaegtning. Dertil: "RD" er en opfundet, ikke-lokaliseret forkortelse der kraever en legende paa fladen. Praecedensen loadShort ("{days}d") holder ikke, fordi "d" virker paa begge sprog og "RD" goer ikke.

Forslag 1 taber trods den bedste skabelontro og de skarpeste fund, fordi den roede tone er en semantisk fejl, og fordi den lader puljen og de andre flader staa helt uroert.

## Graft fra taberne
FRA FORSLAG 1 (grafted, alt verificeret):
1. Nul-backend-vejen. game_day + game_day_end ligger allerede paa wiren (api.js:4392-4393). Forslag 3's fire backend-touches (rest_game_days, restGameDaysBetween-udtraek, #2861-reversering, RaceDetailPage-select) skydes til fase 2. Fase 1 er frontend-only.
2. Spaendet i den EKSISTERENDE meta-linje, ikke som en ny linje. RaceColumn.jsx:114-119 er allerede en <p className="text-2xs text-cz-3 mt-0.5">. Et ekstra segment koster 0px; forslag 3's separate linje koster 13px pr. kort. Fold-disciplinens prioritet 1 slaar prioritet 1b.
3. Klasse-segmentet foldes med `hidden sm:inline`, saa meta-linjen bliver ved med at vaere EEN linje ved 375px.
4. g.gameDayEnd i dags-overskriften. groupColumnsByGameDay (raceHubLogic.js:180-183) BEREGNER allerede gameDayEnd, og ingen har laest det siden det blev skrevet. RaceHubBoard.jsx:549 sender kun g.gameDay. Det er derfor "Race day 0" staar over Giro della Penisola.
5. De to LIVE em-dashes i ContextBand.jsx:63 og :78. Verificeret uden for tone-check-em-dash.mjs' scope (scriptets linje 15-33: kun locales, prosa-sider, index.html, patchNotes.js).
6. AddRiderPopover.jsx:46-48 sender compat.gameDay raat ind i compatibleHint. Skal igennem samme display-transform.
7. DA racehub.raceDays er i dag "Løbsdag {start}-{end}", ental om et spaend. Rettes til flertal.
8. Fallback til den EKSISTERENDE noegle racehub.popover.blockedReason ("Overlaps {race}" / "Overlapper {race}") naar dagnumrene mangler. Navngiven modpart uden tal slaar et opdigtet tal.
9. Genbrug racehub.raceDay + racehub.raceDays i stedet for forslag 3's nye racehub.daySpan.one/range. To noegler der allerede findes, og racehub.raceDays har vaeret ubrugt siden #4187.

FRA FORSLAG 2 (grafted):
10. EEN vej til et loebsdags-tal i hele frontenden, saa en fjerde flade ikke kan drive. toDisplayRaceDay er det eneste sted offset findes.
11. Forward-guarden som node --test: for ethvert par hvor BEGGE har endeligt game_day-spaend gaelder at raceDayOverlaps returnerer en post praecis naar windowsOverlap(a.bindingWindow, b.bindingWindow) er sand. Det er vagten mod at de to akser driver fra hinanden igen, altsaa mod #4193-klassen.
12. Den haarde invariant skrevet ind i koden: DISPLAY-tal kommer KUN fra game_day/game_day_end. bindingWindow bruges KUN til den booleske overlap-test, aldrig til et tal. Det lukker forslag 3's doedelige indvending.
13. Kalender-fanen tier bevidst og det staar i issuet som den resterende afvigelse fra PLANNING_CENTER_RULES §3, i stedet for at blive skjult.
14. Resume-linjens disciplin: naar der er flere modparter, siger den EENE linje konklusionen uden fold-ud, og folden er detaljen.

AFVIST FRA FORSLAG 2:
- Ombygningen af AvailableRidersPool til raekker. Puljen navngiver allerede modparten (linje 93-96). Prisen er ~690px for et tal.
- "RD"-praefikset. Ikke-lokaliseret, kraever legende paa fladen.
- .cz-pulse-flash til hoppet. Guld-puls uden reduced-motion-guard.

AFVIST FRA FORSLAG 1:
- Danger-tone paa lovligt overlap.
- Den opfundne ring-1 ring-cz-danger-flash. Kortets rod-div har allerede en betinget border-farve (RaceColumn.jsx:91), saa flash-tilstanden bliver en tredje gren dér, uden ny utility og uden bevaegelse.

## ENDELIG SPEC
RaceDaySpan, fase 1. Frontend-only. Nul backend, nul migration, nul nye endpoints. Alt ligger paa wiren i dag.

=====================================================================
0. DET ENE PRINCIP, OVERSAT TIL DENNE FLADE
=====================================================================
Tre tilstande, tre forskellige maengder blaek:

  INGEN OVERLAP  -> der tegnes INTET. Ingen linje, ingen streg, intet ikon.
  OVERLAP        -> neutral raekke, text-cz-2, navngiver modparten og de delte
                    loebsdage, kan tappes. To loeb der deler loebsdage er LOVLIGT.
                    Det er en kendsgerning manageren skal kende, ikke en fejl.
  CLASH          -> samme raekke i bg-cz-danger-bg + text-cz-danger + AlertTriangleIcon,
                    navngiver RYTTEREN. Det er foerst her noget er galt: en rytter
                    staar i begge loeb i kladden, og Gem vil afvise det.

Konflikt er ikke guld. Overlap er ikke roedt. Alt-er-fint har intet ikon.

=====================================================================
1. HAARD INVARIANT (skrives ind i koden, laases af en test)
=====================================================================
DISPLAY-tal kommer KUN fra column.game_day / column.game_day_end.
column.bindingWindow bruges KUN til den booleske overlap-test, ALDRIG til et tal.

Grunden, verificeret: raceBindingWindow (backend/lib/raceBinding.js:75-87) falder
tilbage til CET-dag-ordinaler (~20.000) naar bare een schedule-raekke mangler
game_day. raceGameDaySpan (samme fil, linje 99-104) returnerer i stedet null i
praecis den situation, saa UI'et kan skjule maerket frem for at vise skrald.
Blander man de to noeglerum, skriver fladen "Deler dagene 20123-20124". Det er
den samme klasse loegn som #4193.

Siden #4217 er bindingWindow.days HELE det sammenhaengende spaend start..end
(raceBinding.js:84-85), og game_day/game_day_end er min/max af de samme raekker.
Derfor ER "Race days 11-29" nu praecis de dage loebet binder. Det er hele grunden
til at maerkatet #4193 med rette fjernede er sandt igen.

=====================================================================
2. RENE FUNKTIONER
Fil: frontend/src/lib/raceHubLogic.js, tilfoejes EFTER raceDateRangeLabel (linje 285)
Test: frontend/src/lib/raceHubLogic.test.js (node --test, obligatorisk foer push)
=====================================================================

  export const RACE_DAY_DISPLAY_OFFSET = 1;

  // Det ENESTE sted i frontenden hvor en 0-baseret game_day bliver et vist tal.
  // Ingen anden fil maa skrive "+ 1" paa en loebsdag.
  export function toDisplayRaceDay(gameDay) {
    return Number.isFinite(gameDay) ? gameDay + RACE_DAY_DISPLAY_OFFSET : null;
  }

  // "Race day 6" | "Race days 6-7" | null. null naar spaendet mangler -> kalderen
  // tegner intet (samme null-defensiv som raceGameDaySpan).
  export function raceGameDayLabel({ start, end, t }) {
    const s = toDisplayRaceDay(start);
    if (s == null) return null;
    const e = toDisplayRaceDay(end) ?? s;
    return e > s
      ? t("racehub.raceDays", { start: s, end: e })
      : t("racehub.raceDay", { day: s });
  }

  // Hvilke ANDRE kolonner paa braettet deler loebsdage med denne?
  // Praedikatet er windowsOverlap paa bindingWindow (raceHubLogic.js:25, spejler
  // backend). TALLENE kommer fra game_day/game_day_end. Aldrig omvendt.
  export function raceDayOverlaps({ columns = [], columnId }) {
    const self = columns.find((c) => c?.id === columnId);
    if (!self || self.withdrawn) return [];
    const out = [];
    for (const o of columns) {
      if (!o || o.id === columnId || o.withdrawn) continue;
      if (!windowsOverlap(self.bindingWindow, o.bindingWindow)) continue;
      const aS = self.game_day, aE = self.game_day_end ?? self.game_day;
      const bS = o.game_day,    bE = o.game_day_end ?? o.game_day;
      const known = [aS, aE, bS, bE].every(Number.isFinite);
      const s = known ? Math.max(aS, bS) : null;
      const e = known ? Math.min(aE, bE) : null;
      out.push({
        id: o.id,
        name: o.name ?? null,
        sharedStart: known && e >= s ? s : null,
        sharedEnd:   known && e >= s ? e : null,
      });
    }
    return out.sort((a, b) =>
      (a.sharedStart ?? Infinity) - (b.sharedStart ?? Infinity) ||
      String(a.name ?? "").localeCompare(String(b.name ?? "")));
  }

  // Aegte clash: en rytter staar i BEGGE loeb i kladden. Bygger paa den
  // eksisterende findSelectionOverlaps (raceHubLogic.js:83), som allerede driver
  // den navngivne gem-fejl. Ingen ny overlap-logik.
  export function raceDayClashes({ columns = [], columnId }) {
    return findSelectionOverlaps({ columns })
      .filter((o) => o.raceIds.includes(columnId))
      .map((o) => {
        const otherIdx = o.raceIds[0] === columnId ? 1 : 0;
        return { riderId: o.riderId, otherId: o.raceIds[otherIdx], otherName: o.raceNames[otherIdx] };
      });
  }

TESTS (frontend/src/lib/raceHubLogic.test.js):
  T1 raceGameDayLabel(0,0)   -> "Race day 1"
  T2 raceGameDayLabel(0,19)  -> "Race days 1-20"
  T3 raceGameDayLabel(null,5)-> null
  T4 FORWARD-GUARD: for ethvert par hvor begge har endelige game_day-spaend
     gaelder raceDayOverlaps(...).some(x => x.id === b.id)
     === windowsOverlap(a.bindingWindow, b.bindingWindow).
     Det er vagten mod at de to akser driver fra hinanden igen.
  T5 begge kolonner uden game_day, men med CET-ordinal-bindingWindow der
     overlapper -> posten findes, men sharedStart og sharedEnd er null.
     Der maa ALDRIG komme et femcifret dagtal ud.
  T6 withdrawn kolonne -> tom liste baade som SELV og som modpart.

=====================================================================
3. NY KOMPONENT
Fil: frontend/src/components/racehub/RaceDayOverlapRow.jsx (ny, eneste nye fil)
=====================================================================
Eet default export. Returnerer null naar der intet er at sige.

  EEN modpart, intet clash:
  <button type="button" onClick={() => onFocusRace(o.id)}
    className="w-full min-h-[32px] flex items-center justify-between gap-2
               px-3 py-2 border-b border-cz-border text-start
               text-2xs text-cz-2 tabular-nums hover:bg-cz-subtle">
    <span className="min-w-0 truncate">{label}</span>
    <ChevronRightIcon size={13} aria-hidden="true" className="text-cz-3 shrink-0" />
  </button>

  TO ELLER FLERE modparter, intet clash:
  <details className="group border-b border-cz-border">
    <summary className="min-h-[32px] flex items-center justify-between gap-2
                        px-3 py-2 cursor-pointer list-none
                        text-2xs text-cz-2 tabular-nums hover:bg-cz-subtle">
      <span className="min-w-0 truncate">{summaryLabel}</span>
      <ChevronDownIcon size={13} aria-hidden="true"
        className="text-cz-3 shrink-0 transition-transform group-open:rotate-180" />
    </summary>
    <ul>
      {overlaps.map(o => (
        <li key={o.id}>
          <button type="button" onClick={() => onFocusRace(o.id)}
            className="w-full min-h-[32px] flex items-center justify-between gap-2
                       px-3 py-1.5 text-start text-2xs text-cz-2 tabular-nums
                       hover:bg-cz-subtle">
            <span className="min-w-0 truncate">{itemLabel(o)}</span>
            <ChevronRightIcon size={13} aria-hidden="true" className="text-cz-3 shrink-0" />
          </button>
        </li>
      ))}
    </ul>
  </details>

  CLASH (mindst een rytter i begge): SAMME boks, kun tone og indhold skifter.
    Tilfoej paa <button> / <summary>: "bg-cz-danger-bg text-cz-danger"
    Fjern: "text-cz-2 hover:bg-cz-subtle"
    Foran teksten: <AlertTriangleIcon size={12} aria-hidden="true" className="shrink-0 mt-px" />
    Teksten navngiver RYTTEREN, ikke loebet.

Ikoner, alle verificeret i saettet paa 62 (frontend/src/components/ui/icons/index.jsx):
  ChevronRightIcon, ChevronDownIcon, AlertTriangleIcon.
INTET ikon paa den neutrale overlap-raekke. INTET ikon naar der ikke er overlap.
LockIcon er bevidst fravalgt: i puljen betyder den "denne rytter er laast", her
ville den betyde "disse loeb overlapper", og det er ikke samme udsagn.

list-none paa <summary> er noedvendig for at fjerne browserens default-trekant,
som ellers er en fremmed glyf i et hjemmelavet stroke-saet.

=====================================================================
4. RaceColumn.jsx
Fil: frontend/src/components/racehub/RaceColumn.jsx
=====================================================================

EDIT A, linje 73-77. raceDayLabel beholdes uaendret (raceDateRangeLabel). Tilfoej:
  const gameDayLabel = raceGameDayLabel({
    start: column.game_day, end: column.game_day_end, t,
  });

EDIT B, linje 114-119. Meta-linjen. Samme <p>, samme text-2xs, samme mt-0.5,
0px ekstra hoejde. Guldet ryger: en dato er ikke en foerer-markoer.

  FOER:  <p className="text-2xs text-cz-3 mt-0.5">
           {raceDayLabel && (
             <span className="inline-block me-1.5 text-cz-accent-t font-medium">{raceDayLabel}</span>
           )}
           {typeLabel} · {classLabel}
         </p>

  EFTER: <p className="text-2xs text-cz-3 mt-0.5">
           {gameDayLabel && (
             <span className="text-cz-2 font-medium tabular-nums">{gameDayLabel}</span>
           )}
           {gameDayLabel && raceDayLabel && " · "}
           {raceDayLabel}
           {" · "}
           {column.race_type === "stage_race"
             ? t("raceType.stages", { count: column.stages })
             : t("raceType.oneDay")}
           <span className="hidden sm:inline"> · {t(`classOption.${column.race_class}`)}</span>
         </p>

  Raekkefoelgen er PLANNING_CENTER_RULES §3: loebsdags-striben som SANDHED foerst,
  dato-kalenderen som RAMME bagefter. Klassen er det eneste segment der foldes
  under sm, saa linjen bliver ved med at vaere EEN linje ved 375px.

EDIT C, rod-div'en, linje 89-95. Tre attributter paa det element der allerede staar
der, plus en tredje gren i den className-template der allerede har to:

  <div
    id={`race-col-${column.id}`}
    tabIndex={-1}
    data-tour={dataTour}
    className={`border rounded-cz bg-cz-card flex flex-col transition-colors ${
      dragOver && acceptsDrop ? "border-cz-accent" : flash ? "border-cz-2" : "border-cz-border"
    }`}
    ... uaendret ...
  >

  Flash-tilstanden er en BORDER-farve, ikke en ring og ikke en animation. Kortet
  har allerede transition-colors, saa skiftet er en 150ms farveovergang, ikke
  bevaegelse. Ingen prefers-reduced-motion-problem, ingen guld.
  (.cz-pulse-flash blev fravalgt: den er en guld-puls, index.css:281-286, og den
  mangler den reduced-motion-guard som resten af filen har som hard krav.)

EDIT D, EFTER </RaceLink> paa linje 140, FOER `{locked ? (` paa linje 142:

  <RaceDayOverlapRow
    overlaps={overlaps}
    clashes={clashes}
    ridersById={ridersById}
    onFocusRace={onFocusRace}
  />

  Den maa IKKE ligge inde i RaceLink. #3187 gjorde hele headeren til eet <a>, og
  en <button> eller <a> inde i et <a> er ugyldig markup der draeber
  tastaturnavigationen. Det er den fejl en bygger ellers laver her.

EDIT E, nye props i signaturen: overlaps = [], clashes = [], onFocusRace, flash = false.
Rolle-hintet paa linje 171 er UROERT. Overlap-raekken ligger over kroppen, ikke i
note-slottet, saa den fortraenger ingenting.

=====================================================================
5. RaceHubBoard.jsx
Fil: frontend/src/components/racehub/RaceHubBoard.jsx
=====================================================================

EDIT F, efter dayGroups paa linje 445:

  const overlapsByColumn = useMemo(() => {
    const m = new Map();
    for (const c of effectiveColumns) {
      m.set(c.id, {
        overlaps: raceDayOverlaps({ columns: effectiveColumns, columnId: c.id }),
        clashes:  raceDayClashes({ columns: effectiveColumns, columnId: c.id }),
      });
    }
    return m;
  }, [effectiveColumns]);

  O(n^2) paa hoejst en haandfuld kolonner. Udledes af effectiveColumns i samme
  render som dayGroups, saa kladde-aendringer slaar igennem oejeblikkeligt.

EDIT G, hoppet:

  const [flashRaceId, setFlashRaceId] = useState(null);
  const focusRace = (id) => {
    const el = document.getElementById(`race-col-${id}`);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    el?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    el?.focus({ preventScroll: true });
    setFlashRaceId(id);
    setTimeout(() => setFlashRaceId((v) => (v === id ? null : v)), 1200);
  };

EDIT H, dags-overskriften, linje 542-571. multiDay-ternaeren fjernes; dayGroups
mappes ALTID. Med een gruppe rendrer det identisk, plus en overskrift. Det sletter
samtidig den duplikerede RaceColumn-blok paa linje 563-570.

  {dayGroups.map((g, gi) => (
    <div key={g.gameDay ?? "no-day"} className="mb-4">
      {g.gameDay != null && (
        <p className="mb-2 text-xs font-semibold text-cz-2 tabular-nums">
          {raceGameDayLabel({ start: g.gameDay, end: g.gameDayEnd, t })}
        </p>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        {g.columns.map((c, ci) => (
          <RaceColumn key={c.id} column={c}
            overlaps={overlapsByColumn.get(c.id)?.overlaps ?? []}
            clashes={overlapsByColumn.get(c.id)?.clashes ?? []}
            onFocusRace={focusRace}
            flash={flashRaceId === c.id}
            ... alle eksisterende props uaendret ...
          />
        ))}
      </div>
    </div>
  ))}

  To ting sker paa een gang. Overskriften bruger nu g.gameDayEnd, som
  groupColumnsByGameDay ALLEREDE beregner (raceHubLogic.js:180-183) og som INGEN
  har laest siden det blev skrevet. En gruppe der rummer Giro della Penisola siger
  derfor "Race days 1-20" i stedet for "Race day 0". Og overskriften rendres nu
  paa alle 465 (pulje x kalenderdato)-par, ikke kun de 333 der har mere end een
  loebsdags-gruppe.
  Guldet fjernes (text-cz-accent-t -> text-cz-2). Braettets ene guld-primaer
  forbliver Gem-knappen paa linje 516.
  multiDay-flaget beholdes som gate paa racehub.sameDayNote (linje 525). Uaendret.
  Bemaerk: hvis braettet har praecis een aegte loebsdag PLUS kolonner uden game_day,
  havner de sidstnaevnte nu i en null-gruppe sidst i stedet for i original
  raekkefoelge. Det er mere korrekt, ikke mindre, men det skal staa i PR-bodyen.

EDIT I, dagens dato til ContextBand:

  const focusDateLabel = raceDateRangeLabel({
    startMs: effectiveColumns[0]?.window?.start, locale: i18n.language,
  });

  Sendes som prop dateLabel. Kilden er kolonnens EGET display-vindue, som pr.
  definition ligger paa den fokuserede kalenderdato.
  timeline.days[].dateText bruges IKKE og maa ikke bruges: den er
  pool_race.date_text (api.js:4620), altsaa loebets importerede dato-TEKST,
  typisk et interval som "8/5 - 31/5", sat last-write-wins pr. loeb paa dagen.
  Det er ikke en dato for kalenderdagen.

  const boardRaceDayLabel = raceGameDayLabel({
    start: Math.min(...dayGroups.filter(g => g.gameDay != null).map(g => g.gameDay)),
    end:   Math.max(...dayGroups.filter(g => g.gameDay != null).map(g => g.gameDayEnd ?? g.gameDay)),
    t,
  });
  Vaerdien er null naar ingen gruppe har en loebsdag. Sendes som prop raceDayLabel.

=====================================================================
6. ContextBand.jsx (de to akser moedes eet sted)
Fil: frontend/src/components/racehub/ContextBand.jsx
=====================================================================
NAVNGIVNINGS-INVARIANT: loebsdags-aksen siger ALTID "Race day"/"Løbsdag" limet
til sit tal. Kalender-aksen siger ALTID en rigtig dato foerst og har ALTID
"of {total}"/"af {total}" efter sig. De to kan ikke forveksles, fordi de har
forskellig form, ikke bare forskellige tal.

EDIT J, linje 75-80. Samme element, nu to-akset, guldet ud, em-dashen ud:

  <div className="flex items-baseline justify-between gap-2 mt-1.5">
    <span className="text-2xs text-cz-3 tabular-nums">{raceDayLabel}</span>
    <span className="text-xs text-cz-2 font-medium tabular-nums">
      {dateLabel && <span className="text-cz-1">{dateLabel} · </span>}
      {t("racehub.timeline.dayOf", { day, total })}
      {day === currentDay ? ` · ${t("racehub.timeline.youAreHere")}` : ""}
    </span>
  </div>

  Venstre side udelades helt (intet element) naar raceDayLabel er null.
  Det er den ENESTE linje i appen hvor begge akser staar samtidig. Det er
  PLANNING_CENTER_RULES §3 opfyldt paa een linje.

EDIT K, linje 63. Em-dash ud af title-attributten:
  FOER:  `${t("racehub.timeline.dayOf", ...)}${isToday ? ` — ${t("racehub.timeline.youAreHere")}` : ""}`
  EFTER: `${t("racehub.timeline.dayOf", ...)}${isToday ? ` · ${t("racehub.timeline.youAreHere")}` : ""}`

  Begge em-dashes (linje 63 og 78) er LIVE i player-facing UI og fanges IKKE af
  scripts/tone-check-em-dash.mjs, hvis scope (scriptets linje 15-33) kun er
  locale-JSON, fire prosa-sider, index.html og patchNotes.js. Verificeret.

=====================================================================
7. AddRiderPopover.jsx
Fil: frontend/src/components/racehub/AddRiderPopover.jsx, linje 46-48
=====================================================================
  FOER:  t("racehub.popover.compatibleHint", { race: compat.name, day: compat.gameDay })
  EFTER: t("racehub.popover.compatibleHint", { race: compat.name, day: toDisplayRaceDay(compat.gameDay) })

Sidste sted i frontenden der viser et raat loebsdags-tal. Efter denne edit findes
der praecis EEN vej til et loebsdags-tal, og ingen kan omgaa den uden at skrive
"+ 1" i haanden.

=====================================================================
8. ALLE TILSTANDE, OGSAA DEM DER TEGNER INTET
=====================================================================
 1. Intet overlap (langt den hyppigste): overlap-raekken rendres IKKE. Kortet er
    praecis lige saa hoejt som i dag. Fravaer af signal er det roligste signal.
 2. Intet loebsdags-spaend (game_day eller game_day_end er null, delvist backfillet
    loeb): meta-linjens loebsdags-segment UDELADES HELT. Ingen "ukendt", ingen
    tom plads, ingen streg. Kun dato, type og klasse, altsaa praecis som i dag.
 3. Spaend, intet overlap: "Race days 1-20 · 30 Aug – 17 Sep · 20 stages · WorldTour A".
    Een linje, 0px ekstra.
 4. EEN modpart, dagnumre kendte: neutral raekke, "Shares race days 6-7 with
    Le Mur de Huy", chevron-right, tap hopper.
 5. EEN modpart, dagnumre UKENDTE (mindst een side mangler game_day):
    fallback til den eksisterende noegle racehub.popover.blockedReason,
    "Overlaps Le Mur de Huy". Navngiven modpart uden tal slaar et opdigtet tal.
    Der maa ALDRIG komme et femcifret CET-ordinal-tal paa skaermen.
 6. TO ELLER FLERE modparter: <details>, resumelinjen siger konklusionen
    ("Shares race days with 3 races"), folden er detaljen. Sorteret paa foerste
    delte loebsdag, dernaest navn, saa raekkefoelgen er deterministisk.
 7. CLASH, een rytter: bg-cz-danger-bg + text-cz-danger + AlertTriangleIcon,
    "Rossi rides both on race day 6". Tap hopper til modparten.
 8. CLASH, flere ryttere: "2 riders ride both races". Tap hopper til den foerste.
 9. column.withdrawn: spaendet staar stadig i meta-linjen (det er en kendsgerning
    om loebet), men overlap-raekken rendres ALDRIG. Et afmeldt loeb binder
    ingenting (Rod A, #1823; withdrawnIds er med i buildBindingMap, api.js:4412).
    raceDayOverlaps returnerer tom baade naar SELV er afmeldt og springer
    afmeldte modparter over. Bemaerk at kortets krop i forvejen rendrer null
    (RaceColumn.jsx:220), saa raekken ville ellers staa alene over ingenting.
10. column.lineup_locked (frosset loeb, #1825): spaend OG overlap-raekke rendres
    normalt. Loebet binder stadig alt. Den laaste gren (linje 142-168) er uroert.
11. bindingWindow er null (tom eller ugyldig schedule): windowsOverlap returnerer
    false paa null. Ingen overlap beregnes, intet tegnes.
12. Braet uden kolonner: EmptyState som i dag. ContextBands venstre side (loebsdage)
    udelades, hoejre side viser dato-aksen uden dato. Intet gaettes.
13. Flash-maalet: kortets border skifter til border-cz-2 i 1200ms via den
    eksisterende transition-colors, derefter tilbage. Ingen animation, ingen guld,
    ingen bevaegelse. scrollIntoView bruger behavior "auto" under
    prefers-reduced-motion.
14. Dags-overskrift for en gruppe uden game_day: overskriften udelades (g.gameDay
    er null). Uaendret adfaerd.

=====================================================================
9. COPY. EN foerst, DA under. Ingen em-dash nogen steder.
Filer: frontend/public/locales/en/races.json + frontend/public/locales/da/races.json
=====================================================================

GENBRUGT, ingen ny noegle:
  racehub.raceDay             EN "Race day {day}"          DA "Løbsdag {day}"
  racehub.popover.blockedReason EN "Overlaps {race}"       DA "Overlapper {race}"

RETTELSE i eksisterende noegle (DA stod i ental om et spaend):
  racehub.raceDays  EN "Race days {start}-{end}"  (uaendret, allerede korrekt)
                    DA "Løbsdag {start}-{end}"  ->  "Løbsdage {start}-{end}"

NYE NOEGLER, syv stk, alle under racehub.column:

  sharesDay
    EN  "Shares race day {day} with {race}"
    DA  "Deler løbsdag {day} med {race}"

  sharesDays
    EN  "Shares race days {start}-{end} with {race}"
    DA  "Deler løbsdagene {start}-{end} med {race}"

  sharesMany
    EN  "Shares race days with {count, plural, one {# other race} other {# other races}}"
    DA  "Deler løbsdage med {count, plural, one {# andet løb} other {# andre løb}}"

  sharesItem
    EN  "Race day {day} · {race}"
    DA  "Løbsdag {day} · {race}"

  sharesItemDays
    EN  "Race days {start}-{end} · {race}"
    DA  "Løbsdagene {start}-{end} · {race}"

  clash
    EN  "{rider} rides both on race day {day}"
    DA  "{rider} kører begge på løbsdag {day}"

  clashMany
    EN  "{count, plural, one {# rider rides} other {# riders ride}} both races"
    DA  "{count, plural, one {# rytter kører} other {# ryttere kører}} begge løb"

SAADAN LAESER FLADEN (rigtige strenge, ikke pladsholdere):

  Meta-linje, etapeloeb, desktop
  EN  Race days 1-20 · 30 Aug – 17 Sep · 20 stages · WorldTour A
  DA  Løbsdage 1-20 · 30. aug – 17. sep · 20 etaper · WorldTour A

  Meta-linje, endagsloeb, 375px (klassen foldet vaek)
  EN  Race day 6 · 4 Sep · One-day race
  DA  Løbsdag 6 · 4. sep · Enkeltdagsløb

  Overlap, een delt dag
  EN  Shares race day 6 with Le Mur de Huy
  DA  Deler løbsdag 6 med Le Mur de Huy

  Overlap, spaend
  EN  Shares race days 6-7 with Le Mur de Huy
  DA  Deler løbsdagene 6-7 med Le Mur de Huy

  Overlap, flere modparter (resumelinje)
  EN  Shares race days with 3 other races
  DA  Deler løbsdage med 3 andre løb

  Overlap, foldet ud
  EN  Race days 6-7 · Le Mur de Huy
  DA  Løbsdagene 6-7 · Le Mur de Huy

  Overlap, dagnumre ukendte
  EN  Overlaps Le Mur de Huy
  DA  Overlapper Le Mur de Huy

  Clash
  EN  Rossi rides both on race day 6
  DA  Rossi kører begge på løbsdag 6

  Clash, flere
  EN  2 riders ride both races
  DA  2 ryttere kører begge løb

  Braettets dags-overskrift
  EN  Race days 1-20    /    Race day 6
  DA  Løbsdage 1-20     /    Løbsdag 6

  ContextBand, venstre (loebsdags-aksen) og hoejre (kalender-aksen)
  EN  Race days 6-7                     30 Aug · Day 12 of 31 · you are here
  DA  Løbsdagene 6-7                    30. aug · Dag 12 af 31 · du er her

Bindestregen i datospaendet ("30 Aug – 17 Sep") er en EN-dash fra den eksisterende
raceDateRangeLabel (raceHubLogic.js:284). Den er tilladt. Der er ingen em-dash i
noget af ovenstaaende, og §6 fjerner to der staar i koden i dag.
Alle DA-strenge skrives med aeoeaa, ikke ae/oe/aa.

HJAELP (help.json en+da, per #1171, "kort paa fladen, manualer i Hjaelp"):
  EN spoergsmaal: "Why is my rider locked out during a stage race?"
  EN svar: "A stage race holds a rider for its whole race-day span. If it runs
  race days 11 to 30, he cannot start anything else in that window, not even on
  the days the race is not riding."
  DA spoergsmaal: "Hvorfor er min rytter låst under et etapeløb?"
  DA svar: "Et etapeløb binder rytteren i hele sit løbsdags-spænd. Kører det
  løbsdag 11 til 30, kan han ikke starte i noget andet i det vindue, heller ikke
  på de dage løbet holder pause."

PATCH NOTES (frontend/src/data/patchNotes.js): obligatorisk. Tallet spilleren
planlaegger efter aendrer betydning, hvis 1-baseret vaelges.

=====================================================================
10. MOBIL VED 375px
=====================================================================
Braettets grid er "grid sm:grid-cols-2", saa under 640px er kortet fuld bredde,
ca. 343px, ca. 319px indhold efter p-3.

Meta-linjen: klasse-segmentet er hidden sm:inline, saa vaerste realistiske
tilfaelde er "Løbsdage 10-28 · 30. aug – 17. sep · 7 etaper", ca. 44 tegn i
text-2xs (11px, Inter Tight) = ca. 238px mod 319px. EEN linje, ingen wrap,
0px ekstra hoejde. Uden folden ville "· WorldTour A" have skubbet den over og
kostet 15px paa hvert etapeloebs-kort. Klassen er det segment der mister mindst:
hele kort-headeren er allerede eet aegte link (RaceLink, #3187), saa klassen er
eet tap vaek paa loebssiden.

Overlap-raekken: min-h-[32px] med px-3 py-2 og 11px tekst. 32px er komfortabelt
over 24px-kravet, og HELE raekken er hit-target, ikke kun navnet. Bredde ca. 319px.
"Deler løbsdagene 6-7 med Le Mur de Huy" er ca. 38 tegn = ca. 187px plus chevron
13px plus 24px padding. Passer. Loebsnavnet har truncate paa venstre span, mens
chevronen er shrink-0: naar pladsen slipper op, ofres navnets hale, ALDRIG tallene.
Tallet er det man scanner efter.

Foldet ud ved flere modparter: <li>-knapperne har ogsaa min-h-[32px].

INGEN hover baerer information. Hver eneste kendsgerning staar i DOM-teksten.
Det er hele grunden til at overlappet er en RAEKKE og ikke en tooltip: moenstret
i frontend/src/components/planner/MobileLanes.jsx er at signalet ER raekken.
Ingen drag noedvendig; hoppet er et tap.

Hoppet paa mobil: scrollIntoView({ block: "center" }) er vigtigere her end paa
desktop, fordi modparten i een kolonne kan ligge langt nede. focus({ preventScroll:
true }) paa rod-div'ens tabIndex={-1} giver samtidig skaermlaeseren et anker, og
border-skiftet erstatter det hover-signal mobilen ikke har.

ContextBand: de to akser staar i en flex justify-between. Ved 375px er venstre
"Løbsdagene 6-7" ca. 88px og hoejre "30. aug · Dag 12 af 31 · du er her" ca. 197px
i text-xs, samlet ca. 285px mod ca. 311px tilraadighed (375 minus sidens px-4
minus baandets px-4). EEN linje. Ved et laengere datoformat wrapper flex-raekken
til to, hvilket er acceptabelt.

Hoejde-omkostning paa mobil: 0px i den rolige tilstand, +33px pr. kort der faktisk
har et overlap. Paa desktop typisk 0px, fordi grid sm:grid-cols-2 staar paa default
align-items stretch og kortets flex-1-krop allerede absorberer slack fra raekkens
hoejeste soester, saa raekken lander i whitespace der allerede fandtes.

FLAGGET, IKKE RETTET, egen sag: ContextBands dag-strip (linje 48-71, flex gap-px
flex-1 med h-4-knapper) giver ca. 9px brede tap-maal ved 31 dage paa 375px. Det
bryder 24px-reglen i dag, det bliver ikke vaerre af disse edits, og det boer have
sit eget issue.

=====================================================================
11. FILER OG PLACERING, SAMLET
=====================================================================
Fold-disciplinen i PAGE_TEMPLATES giver fire prioriteter. Alt her ligger i
prioritet 1 og 2. Intet nyt stablet kort, ingen ny fane, ingen ny container-bredde,
intet nyt sidehoved, ingen ny radius, ingen ny farve.

PRIORITET 1, inde i eksisterende elementer:
  frontend/src/components/racehub/RaceColumn.jsx:73-77    gameDayLabel-udregning
  frontend/src/components/racehub/RaceColumn.jsx:114-119  meta-<p>, flere segmenter, guld ud
  frontend/src/components/racehub/RaceColumn.jsx:89-95    id, tabIndex, tredje border-gren
  frontend/src/components/racehub/RaceHubBoard.jsx:542-571 dayGroups altid, gameDayEnd ind, guld ud
  frontend/src/components/racehub/ContextBand.jsx:75-80   begge akser i den eksisterende readout
  frontend/src/components/racehub/ContextBand.jsx:63      em-dash ud af title
  frontend/src/components/racehub/AddRiderPopover.jsx:46-48 1-baseret transform

PRIORITET 1 til 2, ny raekke inde i et eksisterende kort:
  frontend/src/components/racehub/RaceColumn.jsx, efter </RaceLink> paa linje 140

PRIORITET 2, bag en fold:
  <details> i RaceDayOverlapRow ved to eller flere modparter

NY FIL, eneste:
  frontend/src/components/racehub/RaceDayOverlapRow.jsx

DELTE RENE FUNKTIONER:
  frontend/src/lib/raceHubLogic.js, efter linje 285
  frontend/src/lib/raceHubLogic.test.js, seks nye tests

COPY:
  frontend/public/locales/en/races.json + da/races.json
  frontend/public/locales/{en,da}/help.json
  frontend/src/data/patchNotes.js

=====================================================================
12. UDEN FOR SCOPE, MED GRUND (skal staa i issuet, ikke skjules)
=====================================================================
  GET /api/races/calendar baerer INGEN loebsdage pr. loeb. gameDayStart og
  gameDayEnd trimmes bevidst vaek i toCalendarWireEntry (backend/lib/raceCalendar.js:277,
  #2861, 67-73 kB pr. load). Kalender-fanen og Z1 SeasonView kan derfor ikke baere
  maerkatet, og de viser fortsat kun datoer. Det er den resterende afvigelse fra
  PLANNING_CENTER_RULES §3 og det er ejer-spoergsmaal 2. Naar felterne kommer
  tilbage, SKAL de rendre gennem raceGameDayLabel, saa de to flader ikke kan drive.

  GET /api/races/distribution/browse foder StartListColumn.jsx (scope division og
  others). Den kolonne viser i dag intet loebsdags-tal overhovedet
  (StartListColumn.jsx:29 og :56 er "{type} · {klasse}"). Samme wire-mangel,
  samme fase 2.

  GET /races/:raceId/selection har hverken window eller game_day, kun bound_riders
  [{rider_id, bound_race_id, bound_race_name}]. Loebssiden kan navngive modparten
  men ikke spaendet. Roeres ikke.

  Modparter paa ANDRE kalenderdatoer kan ikke navngives, fordi braettet kun holder
  den valgte kalenderdatos kolonner. I praksis er hullet smalt (et etapeloebs
  bindingsvindue er sammenhaengende siden #4217, saa loebet optraeder som kolonne
  paa sine kalenderdage), men det er reelt paa fx en Grand Tour-hviledag. Det er
  Z1's opgave, og det skal staa i klar tekst i issuet frem for at blive solgt som
  en komplet loesning.

  AvailableRidersPool roeres IKKE. Den navngiver allerede det bindende loeb inline
  (linje 93-96, racehub.boundNamed + LockIcon). Skal puljen ogsaa baere spaendet,
  er den mindste aendring at tilfoeje raceGameDayLabel til den linje der allerede
  staar der. Det er ikke en ombygning til raekker vaerd.

=====================================================================
13. VERIFIKATION FOER PUSH
=====================================================================
  node --test i frontend/            OBLIGATORISK. Vite tilgiver extensionless
                                     imports, Node's ESM-loader i CI goer ikke (#803).
  npm run lint                       CI's frontend-build koerer eslint; verify-local goer ikke.
  node scripts/verify-affected.mjs   TIER lagdelt: frontend-only, otte filer, ingen
                                     delte hooks, ingen i18n-struktur-aendring ud over
                                     syv noegler. CI baerer fuld suite.
  Alle 3 playwright-projekter        Visuel aendring paa braettet, ogsaa mobil (#536).
  scripts/tone-check-em-dash.mjs     Skal koere GROENT, og de to ContextBand-em-dashes
                                     er vaek selvom scriptet aldrig kunne se dem.

  EEN EKSISTERENDE E2E-FORVENTNING skal efterses:
  frontend/tests/e2e/racehub-deadclick.spec.js:92 asserter
  `await board.getByText("2. sep.").click()`. Meta-<p>'et faar flere segmenter, saa
  substring-matchet rammer stadig, men strict mode kan brokke sig hvis mere end eet
  element matcher. Dead-click-garantien selv er uroert: hele headeren er stadig eet
  RaceLink, og overlap-raekken ligger UDEN FOR det anchor.

  UI-PR: merges IKKE uden ejerens visuelle go. Vedhaeft screenshots af alle fire
  tilstande (intet overlap, een modpart, flere modparter foldet ud, clash) i baade
  lyst og moerkt tema, ved 375px og desktop.

## Ejer-spoergsmaal
- Løbsdage vises i dag 0-baserede (game_day er 0..85 i prod, derfor "Race day 0" over Giro della Penisola). Skal visningen skifte til 1-baseret, så "Race day 1" er sæsonens første? Fordelen er at alt andet spillervendt tæller fra 1 (etapenumre, kalenderdag 1 af 31), og at "dag 0" læses som en bug. Prisen er permanent: databasen, SQL-opslag, admin-værktøjer og supportsvar siger fortsat N, mens UI siger N+1, og en spiller der har noteret "løbsdag 14" i Discord kommer tilbage til 15. Det er samtidig tredje ændring af det samme tal på fire uger (#4193 fjernede det, dette bringer det tilbage). Min anbefaling: ja, skift nu og i én PR, fordi S3 starter i morgen og vinduet lukker. Hele skiftet er én konstant i én fil (RACE_DAY_DISPLAY_OFFSET i frontend/src/lib/raceHubLogic.js), så et nej koster ét tegn.
- Fase 2 kræver at gameDayStart og gameDayEnd kommer TILBAGE på GET /api/races/calendar. De blev bevidst trimmet væk i #2861, som skar 67 kB (S1) / 73 kB (S2) rå JSON pr. kalender-load. Uden dem KAN kalender-fanen og Z1 ikke vise løbsdags-aksen, og PLANNING_CENTER_RULES §3 ("uanset udfald vises begge akser") forbliver brudt netop dér hvor bugrapporten kom fra. Prisen er to heltal pr. entry, altså langt under det #2861 skar. Må #2861-trimningen genåbnes for de to felter? Fase 1 kører uændret uanset svaret.


---

# RiderDayStatus

## Vinder
Dagsrenden (Forslag 2)

## Begrundelse
Dagsrenden vinder fordi den er det eneste forslag der finder og lukker et VERIFICERET hul i "konflikt foer klik", ikke bare tegner en pænere version af det eksisterende signal.

Verificeret 27/8 mod koden: `canAddRiderToColumn` (frontend/src/lib/raceHubLogic.js:47-51) tjekker afmeldt, laast, allerede-udtaget og binding, men IKKE skade. `AddRiderPopover.jsx:14` filtrerer maal-listen med praecis den funktion. `backend/lib/raceSelection.js:31` afviser saa med `selection_rider_injured` ved Gem. Og `buildRiderRows` (backend/lib/raceSelection.js:150) sender `injured` med paa hver rytter, som puljen aldrig laeser. Altsaa: en skadet rytter tegnes i dag som en helt almindelig ledig chip, du klikker, popoveren tilbyder loeb, du tilfoejer, og foerst Gem siger fra. Det er en toast der fortaeller hvad der lige gik galt. F1 og F3 lader det staa aabent i puljen. F2 er den eneste der tegner det foer klikket.

Dertil: F2 er det eneste forslag der angriber den ANDEN halvdel af knuds klage direkte paa selve fladen. Efternavn-foerst med fornavn i `text-cz-3` og `truncate` der skaerer fornavnet bagfra giver navne-kolonnen sin egen faste venstrekant. Renden goer raekkerne scanbare; efternavn-foerst goer NAVNENE scanbare. "so many of the names are the same" bliver kun loest af det andet.

Verifikation af de tekniske paastande: `riderColumnState` findes med praecis de fire ord (raceHubLogic.js:72-78) og har nul produktionskaldere. `text-cz-danger` findes (tailwind.config.js:75 → `rgb(var(--danger) / <alpha-value>)`), og der findes hverken `--danger-t` eller `--success-t`, praecis som F2 og F3 skriver. `CheckIcon`, `LockIcon`, `AlertTriangleIcon`, `JerseyIcon` findes alle i det hjemmelavede saet paa 62 ikoner (talt: 62 `export function *Icon` i frontend/src/components/ui/icons/index.jsx). `font-data`, `text-2xs`, `text-3xs`, `rounded-cz`, `rounded-cz-pill` findes alle. Ingen af de tre opfinder et token.

F3 taber knebent og er den staerkeste taber. Den er mobil-arbejdet der faktisk er lavet: bredde-regnskabet paa 375px er regnet igennem (116px krom, 259px navn), tap-maalet er 32px, og den fanger korrekt at `RaceSelectionPanel.jsx:517` er `hidden sm:block overflow-x-auto` saa `<Tooltip>` (ren CSS-soeskende-span, verificeret) ville blive klippet. Men den tegner ingen skade-tilstand i puljen, og dens `title`-paastand er forkert: IconBase saetter `role="img"` + `aria-label` naar man giver den `title`, men rendrer INTET `<title>`-element, saa den native hover den kalder "redundant ekstra" fyrer aldrig.

F1 taber klart. Den er den mindste diff, men den betaler for det to gange: den lader skade-fælden staa, og den indroemmer selv at `sm:grid` er slukket under 640px saa den lodrette skinne slet ikke findes paa mobil. Designets ene loefte er dermed void paa den flade klagen sandsynligvis kom fra. Dertil er dens praecedens-citat forkert: `MobileLanes.jsx:99-107` er `w-2.5 h-2.5` med `rgb(var(--accent))`-fyld, og `PlannerSquad.jsx:173` er `w-2 h-2 rounded-full border border-dashed border-cz-3`. Ingen af dem er den 6px `bg-cz-1`-prik F1 kalder "praecis samme primitiv". Primitivet findes ganske vist ni andre steder (`w-1.5 h-1.5 rounded-full`), saa det er ikke et skabelon-brud, men det er sjusk i et forslag hvis eneste salgsargument er at det ikke opfinder noget.

## Graft fra taberne
FRA FORSLAG 3 (mobil-foerst-arbejdet, som er reelt bedre end vinderens):

1. RENDEN BLIVER 16px (w-4), IKKE 13px. F3's argument er svagt formuleret, men den rigtige begrundelse er staerkere end nogen af dem skrev: PlannerSquad.jsx:168 har ALLEREDE praecis dette element som sin ledende plads, `<span className="shrink-0 w-4 flex justify-center">` med Star / Flag / stiplet prik. At bruge samme bredde goer de to planlaegnings-flader til eet system i stedet for to naesten-ens. Verificeret ved laesning af filen.

2. BREDDE-REGNSKABET VED 375px overtages ordret som accept-kriterie: 24px sidepadding + 16px rende + 8px gap + 24px form + 8px gap + 28px load + 8px gap = 116px krom, 259px til navnet. F2 opgav aldrig et tal for mobil-navnet, kun for 220px-cellen. F3's tal er regnet og skal staa i PR'en.

3. TAP-MAAL 32px (min-h-[32px]), ikke F2's 28. Brief'ens gulv er 24px, men F3 har ret i at en fuld-bredde raekke der er hele traefomraadet skal ligge komfortabelt over, ikke lige paa.

4. "-mt-px" PAA GITTER-CONTAINEREN saa foerste raekkes border-t lander oven i headerens border-b og der kun ses EEN hairline. Ren detalje, F2 havde den ikke, og uden den faar puljen en dobbeltstreg lige under headeren.

5. RENDEN FOER NAVNET SOM UDTALT MEKANIK. F3 er den eneste der siger hvorfor det virker: i dag ligger baade puljens LockIcon (AvailableRidersPool.jsx:84) og RaceSelectionPanels piller (:457 og :583) EFTER navnet, saa hvert signal starter ved en ny x-position pr. raekke. Det er selve diagnosen og skal staa i spec'en, ikke bare loesningen.

6. OVERLAP OG LOCKED SLAAS SAMMEN TIL EEN TEGNET TILSTAND. F3 har ret: to naesten-ens laase er vaerre end een laas plus en navngiven aarsagslinje, og den fjerde tilstand (alle dagens loeb startet) er saa sjaelden at et eget ikon aldrig ville blive laert. F2 tegnede dem allerede ens; F3 leverer argumentet.

7. INGEN HOVER BAERER NOGET ALENE, og aldrig <Tooltip>-komponenten. Begge fandt at RaceSelectionPanel.jsx:517 er `hidden sm:block overflow-x-auto` og at Tooltip er en ren CSS-soeskende-span (verificeret i frontend/src/components/ui/Tooltip.jsx) der ville blive klippet. Native title= som redundans, aldrig som baerer.

8. RACESELECTIONPANEL ER OMPLACERING, IKKE NY GRAFIK, OG KRAEVER NUL NYE NOEGLER. F3 verificerede at selection.injured, selection.boundIn og selection.boundConflict allerede findes. Bekraeftet: EN "Injured" / "Riding {race}" / "Overlaps {race}", DA "Skadet" / "Kører {race}" / "Overlapper {race}". F1's afvisning ("ville kraeve et NYT serverfelt") er forkert; bound_riders + rider.injured daekker de tre tilstande panelet skal tegne.

FRA FORSLAG 1:

9. RIDING FAAR ALDRIG EN AARSAGSLINJE. F1 og F2 naaede uafhaengigt frem til det, og F1's regnestykke er det klareste: paa et eendags-braet med seks udtagne rendrer isLocked i dag sandt for alle seks, saa der staar seks laase OG seks begrundelses-linjer. Fjernes linjen for den hyppigste tilstand, er hoejde-regnskabet naesten neutralt i stedet for at vokse.

10. LEGENDEN BLIVER I DEN SAMME ENE <p> MED · SOM SKILLETEGN, det skille der allerede bruges i pool-headeren (AvailableRidersPool.jsx:40) og i racehub.boundNamed. F2 ville droppe legenden til fordel for en taelle-linje. Der skal vaere begge: taellen svarer paa spoergsmaalet, legenden forklarer maerkerne.

11. TAEL MULTI-TOKEN-FORNAVNE FOER NAVNE-FIXET SHIPPES. F1's forbehold er det eneste sted nogen af de tre stiller et falsificerbart krav til sit eget forslag: hvis de fleste ryttere har mere end eet token i firstname, laenges navnet for alle i en trunkerende celle, og gevinsten er mindre end prisen. Det skal maales i database/schema-snapshot.json + en taelling foer PR'en, ikke antages.

12. CHIPPENS FULDE NAVN I title=. Naar efternavn-foerst-navnet trunkeres, skal det fulde "Fornavn Efternavn" ligge i title paa navne-spanet.

HVAD DER AKTIVT AFVISES FRA TABERNE:
F1's forslag om at beholde chip-skyen paa mobil (den goer designets loefte void praecis der hvor det taeller). F3's md:grid-cols-2 (to baner til 30 ryttere er for faa; auto-fill giver 4-5). F2's tre-trins ink-stige (utestet i dark mode, skaeret til to trin). F2's paastand om em-dash-gaeld i JSX (guarden scanner ikke JSX og tillader den enkeltstaaende glyf).

## ENDELIG SPEC
RIDERDAYSTATUS — DAGSRENDEN. Byggeklar spec, verificeret mod koden 27/8 2026. Refs #4259.

═══════════════════════════════════════════════
0. PRINCIPPET OG DIAGNOSEN
═══════════════════════════════════════════════

Diagnosen (F3's, og den er rigtig): i dag ligger hvert tilgaengeligheds-signal EFTER navnet. AvailableRidersPool.jsx:84 rendrer `{locked && <LockIcon size={11} />}` inde i chippen, og RaceSelectionPanel.jsx:457 / :583 rendrer injured- og bound-pillerne i en `flex ... flex-wrap` efter navnet. Derfor starter hvert maerke ved en ny x-position pr. raekke, og oejet skal laese vandret for at finde det.

Fixet: en rende med FAST bredde HELT forrest i raekken, foer navnet, som altid er til stede og som tegner INTET naar rytteren er fri. Renden kan ikke flytte sig vandret, uanset navnelaengde, fordi den ligger foer den elastiske del af raekken.

Fravaer af signal er det roligste signal. "free" tegner intet. Der tegnes aldrig et ikon for at alt er fint.

═══════════════════════════════════════════════
1. DEN DELTE FUNKTION
═══════════════════════════════════════════════

FIL: C:\Dev\CyclingZone\frontend\src\lib\raceHubLogic.js
PLACERING: ny eksport indsat direkte EFTER `riderColumnState`, som slutter paa linje 78, og FOER `findSelectionOverlaps` paa linje 83.

```js
// #4259: rulller riderColumnState op over ALLE dagens kolonner til én dags-tilstand pr.
// rytter. Ingen femte vokabular: 'riding' og 'available' er riderColumnState's egne ord;
// 'overlap' og 'locked' slaas sammen til 'blocked' fordi to næsten-ens låse er værre end
// én lås plus en navngiven årsag; 'out' er rider.injured, som allerede ligger på wiren
// (raceSelection.buildRiderRows) og som puljen aldrig har læst.
// Præcedens: out > riding > free > blocked.
export function riderDayState({ rider, columns = [], bindingMap }) {
  if (rider?.injured) return "out";
  if (!columns.length) return "free";
  const s = columns.map((c) => riderColumnState({ column: c, bindingMap, riderId: rider.id }));
  if (s.includes("riding")) return "riding";
  if (s.includes("available")) return "free";
  return "blocked";
}
```

HVORFOR 'out' VINDER OVER 'riding': en skadet rytter der stadig sidder i en gemt trup er den mest konsekvensfulde raekke paa skaermen, og handlingen er tilgaengelig. Verificeret: RaceColumn.jsx tillader fjernelse ogsaa i den laaste gren (kommentaren ved linje ~155 siger det eksplicit, backend accepterer ren fjernelse selv naar stages_completed>0).

HVORFOR 'out' OVERHOVEDET FINDES: `canAddRiderToColumn` (raceHubLogic.js:47-51) tjekker afmeldt, laast, allerede-udtaget og binding, men IKKE skade. `AddRiderPopover.jsx:14` filtrerer maal-listen med praecis den funktion. `backend/lib/raceSelection.js:31` afviser foerst ved Gem med `selection_rider_injured`. Uden 'out' er fladen en toast-efter-klik.

HVORFOR `!columns.length` GIVER 'free': paa en dag uden loeb rendrer braettet `racehub.empty` og puljen er ikke i spil. At returnere 'blocked' der ville vaere at tegne en laas paa 30 raekker uden grund.

TESTS: C:\Dev\CyclingZone\frontend\src\lib\raceHubLogic.test.js. Genbrug fixture-saettet fra det eksisterende `riderColumnState`-case (omkring linje 197) plus den eksterne-binding-case (omkring linje 245). Fem nye assertions: out slaar riding, riding slaar free, free naar mindst een kolonne er available, blocked naar ingen er, free ved tom columns.

═══════════════════════════════════════════════
2. RENDEN — DEN ENE ANATOMI
═══════════════════════════════════════════════

Identisk markup paa alle flader der faar den. 16px bred, aldrig skaleret, aldrig conditional paa bredden.

```jsx
<span className="w-4 shrink-0 flex items-center justify-center pt-px" aria-hidden="true">
  {state === "out"     && <AlertTriangleIcon size={11} className="text-cz-danger" />}
  {state === "riding"  && <CheckIcon         size={11} className="text-cz-2" />}
  {state === "blocked" && <LockIcon          size={11} className="text-cz-3" />}
</span>
```

16px (`w-4`) fordi PlannerSquad.jsx:168 ALLEREDE har praecis dette element som sin ledende plads: `<span className="shrink-0 w-4 flex justify-center" aria-hidden="true">` med Star / Flag / stiplet prik. Samme bredde goer de to planlaegnings-flader til eet system.

11px ikon-stoerrelse fordi det er den stoerrelse `LockIcon` allerede bruger i chippen i dag (AvailableRidersPool.jsx:84).

`aria-hidden` paa renden. Tilstanden gaar i raekkens `aria-label`, saa en skaermlaeser aldrig afhaenger af `title=`.

VERIFICEREDE IKONER, alle fra det hjemmelavede saet i C:\Dev\CyclingZone\frontend\src\components\ui\icons\index.jsx (62 ikoner talt 27/8, viewBox 24, strokeWidth 2, IconBase):
- `AlertTriangleIcon` — tilstand out
- `CheckIcon` — tilstand riding. Betyder "udtaget", ikke "godkendt", derfor `text-cz-2`, ikke `text-cz-success`
- `LockIcon` (index.jsx:217) — tilstand blocked. Nul nyt vokabular: LockIcon betyder allerede praecis dette i AvailableRidersPool.jsx:84, AddRiderPopover.jsx og RaceColumn.jsx
Alle tre eksporteres fra `../ui`. Intet nyt ikon tegnes, saettet forbliver 62.

VERIFICEREDE TOKENS:
- `text-cz-danger` findes, tailwind.config.js:75 → `rgb(var(--danger) / <alpha-value>)`. Der findes hverken `--danger-t` eller `--success-t`; kun `--accent-t` har en t-variant, og den bruges ikke her.
- `text-cz-1` / `text-cz-2` / `text-cz-3` findes, tailwind.config.js:59-61 → `var(--text-1|2|3)`.
- `font-data`, `text-2xs` (11px), `text-3xs` (10px), `rounded-cz` (5px) findes alle.

INTET GULD I NOGEN TILSTAND. Konflikt er ikke guld, og "koerer i dag" er ikke en primaerhandling. Guld-budgettet paa /races er uroert.

═══════════════════════════════════════════════
3. TILSTANDENE
═══════════════════════════════════════════════

INK-STIGEN ER BINAER, IKKE TRE-TRINS. Dette er rettelsen af vinderens egen doedelige indvending: cz-1 → cz-2 → cz-3 er utestet i dark mode og maa ikke baere det binaere spoergsmaal.
- free og riding: navn i `text-cz-1`
- blocked og out: navn i `text-cz-3`
To trin, garanteret adskillelige i begge temaer, og de mapper praecis paa "kan jeg bruge ham". Glyffens TILSTEDEVAERELSE skiller riding fra free; glyffens FORM skiller lock fra triangle.

`opacity-60` fra dagens laaste chip (AvailableRidersPool.jsx:80) UDGAAR. Den er dobbelt-daempning oven paa et allerede daempet token og goer navnet naesten ulaeseligt.

**free — TEGNER INTET.**
Rytteren kan tilfoejes mindst eet af dagens loeb. Renden staar tom, men de 16px staar der, saa navnene flugter. Navn `text-cz-1`. Ingen aarsagslinje, intet `title`, ingen tilstand i `aria-label` (kun navnet). Klikbar, traekbar, uaendret adfaerd. En soejle af blanke render er praecis det oejet skal finde.

**riding — CheckIcon 11px, `text-cz-2`.**
Mindst een af dagens kolonner har ham i `selection.rider_ids`. Navn `text-cz-1`, IKKE daempet: han kan stadig saettes i loeb B paa en anden in-game-dag, og det er hele #4259's kerne. INGEN aarsagslinje (flertals-tilstanden; en linje pr. koerende rytter ville fordoble bladets blaek). Loebsnavnet ligger i `title` og i `aria-label`. Klikbar OG traekbar. Popoveren grupperer allerede "ledig til" vs "optaget i overlappende loeb" via `sameDayCompatibilityHint`, saa detaljen er eet klik vaek.

**blocked — LockIcon 11px, `text-cz-3`.**
Ingen af dagens kolonner tager imod ham: alle er enten afmeldte/laaste eller game-dags-overlappende. Navn `text-cz-3`. Den navngivne grund staar INLINE som `text-3xs`-underlinje, ikke kun paa hover. Det er bevidst uaendret fra #1984, som eksplicit besluttede at laase-grunden skal vaere synlig med det samme. Ikke traekbar. Stadig klikbar, men klikket kan aldrig FEJLE, det aabner kun forklaringen.

**out — AlertTriangleIcon 11px, `text-cz-danger`.**
`rider.injured === true`. Vinder over alt andet. Navn `text-cz-3`, underlinje "Injured" i `text-cz-danger`. Ikke traekbar. Chippen skal ogsaa vaere `disabled` for tilfoejelse: sæt `draggable={false}` og lad `AddRiderPopover` aabne med en tom maal-liste plus grunden. DETTE LUKKER DET VERIFICEREDE HUL.

═══════════════════════════════════════════════
4. AARSAGS-OPSLAGET
═══════════════════════════════════════════════

Rækkefølge, alt sammen allerede i komponenten eller i raceHubLogic:
- out → `t("racehub.day.injured")`
- riding → `raceByRider.get(r.id)` (bygges allerede, AvailableRidersPool.jsx:24-28) → `t("racehub.day.racingIn", { race })`. Kun til `title` + `aria-label`.
- blocked → `overlapConflictColumn({ column, columns, bindingMap, riderId })?.name` (raceHubLogic.js:56, haandterer allerede #2256-loeb uden for braettet) ELLER `bindingMap[r.id]?.find((e) => e.name)?.name`:
  · navn fundet → `t("racehub.day.busyIn", { race })`
  · intet navn, men mindst een kolonne er `withdrawn` eller `lineup_locked` → `t("racehub.day.dayClosed")`
  · ellers → `t("racehub.day.busyUnknown")`

═══════════════════════════════════════════════
5. PULJEN — AvailableRidersPool.jsx
═══════════════════════════════════════════════

FIL: C:\Dev\CyclingZone\frontend\src\components\racehub\AvailableRidersPool.jsx
Rendres uaendret fra RaceHubBoard.jsx:572, SIDST paa braettet efter alle kolonner. Prop-signaturen roeres ikke.

5a) IMPORTS, linje 12-14:
```js
import { LockIcon, CheckIcon, AlertTriangleIcon } from "../ui";
import { canAddRiderToColumn, overlapConflictColumn, riderDayState } from "../../lib/raceHubLogic.js";
```

5b) LINJE 29 — `isLocked` udgaar helt, erstattes af:
```js
const stateOf = (rider) => riderDayState({ rider, columns, bindingMap });
```

5c) HEADEREN, linje 33-35. Taelle-linjen indsaettes i det EKSISTERENDE `<span>`, `racehub.pool.title` beholdes. Header-raekken (linje 33) faar `flex-wrap` tilfoejet saa den brydes rent under 400px:
```jsx
<div className="px-3 py-2 border-b border-cz-border flex flex-wrap items-center justify-between gap-2">
  <span className="min-w-0 text-2xs uppercase tracking-wide text-cz-2">
    {t("racehub.pool.title", { count: roster.length })}
    {tally && <span className="font-data tabular-nums text-cz-3"> · {tally}</span>}
  </span>
```
`tally` = `[free && t("racehub.pool.tallyFree",{count:free}), racing && t("racehub.pool.tallyRacing",{count:racing}), out && t("racehub.pool.tallyOut",{count:out})].filter(Boolean).join(" · ")`. Nul-segmenter droppes. `blocked` taelles IKKE separat, den lægges i tallyOut sammen med out (begge betyder "kan ikke bruges i dag"). "free" TAELLES med selvom den ikke TEGNES: knud spurgte ordret hvem der ikke har et loeb, og en taelling er editorial data, ikke et beroligende ikon.
En ren dag laeser: `Available riders · 30-squad · 30 no race`.

5d) BEHOLDEREN, linje 52-57. `flex flex-wrap items-start gap-2 p-3` erstattes. Drop-zone-handlerne og dragOver-tinten flytter uaendret med:
```jsx
<div
  className={`grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))] sm:gap-x-4 -mt-px transition-colors ${dragOver ? "bg-cz-accent/10" : ""}`}
  onDragOver={...} onDragLeave={...} onDrop={...}
>
```
Ombrud er aarsagen til at maerket hopper: en chip starter der hvor den forrige sluttede. Et gitter med lige kolonner giver 4-5 faste x-positioner ved typisk braet-bredde, altsaa 4-5 lodrette baner hele vejen ned. `-mt-px` lader foerste raekkes `border-t` lande praecis paa headerens `border-b`, saa der kun ses EEN hairline.

5e) RAEKKEN, linje 69-102. Chip-`<button>` bliver til liste-raekke. Samme `<button>`, samme `draggable`, samme `onClick` → AddRiderPopover, samme `relative`-wrapper som popover-anker:
```jsx
<div key={r.id} className="relative">
  <button
    type="button"
    disabled={busy}
    draggable={(state === "free" || state === "riding") && !busy}
    onDragStart={(e) => e.dataTransfer.setData("text/plain", encodeDrag({ riderId: r.id, fromRaceId: null }))}
    onClick={() => setOpenRiderId(openRiderId === r.id ? null : r.id)}
    title={reason ?? undefined}
    aria-label={state === "free" ? r.name : t("racehub.day.riderAria", { name: r.name, state: reason })}
    className="w-full flex items-start gap-2 px-3 py-1.5 min-h-[32px] text-left border-t border-cz-border hover:bg-cz-subtle disabled:opacity-50"
  >
    {/* RENDEN — se §2 */}
    <span className="min-w-0 flex-1">
      <span className={`block text-[13px] leading-[18px] truncate ${state === "blocked" || state === "out" ? "text-cz-3" : "text-cz-1"}`}
            title={r.name}>
        <span className="font-medium">{r.lastname}</span>{" "}
        <span className="text-cz-3">{r.firstname}</span>
      </span>
      {reason && state !== "riding" && (
        <span className={`block font-data text-3xs uppercase tracking-[.05em] truncate ${state === "out" ? "text-cz-danger" : "text-cz-3"}`}>{reason}</span>
      )}
    </span>
    <span className="w-6 shrink-0 pt-px text-end font-data text-2xs tabular-nums text-cz-2">{r.form ?? ""}</span>
    <span className="w-7 shrink-0 pt-0.5 text-end font-data text-3xs tabular-nums text-cz-3"
          title={load?.raceDays > 0 ? t("racehub.pool.loadTitle", { races: load.races, days: load.raceDays }) : undefined}>
      {load?.raceDays > 0 ? t("racehub.pool.loadShort", { days: load.raceDays }) : ""}
    </span>
  </button>
  {openRiderId === r.id && (
    <AddRiderPopover rider={r} columns={columns} bindingMap={bindingMap}
      onPick={(raceId) => onAddRiderToRace(raceId, r.id)} onClose={() => setOpenRiderId(null)} />
  )}
</div>
```

NAVNET ER EFTERNAVN-FOERST i halv-fed, fornavn i `text-cz-3`. `truncate` skaerer bagfra, saa FORNAVNET klippes og efternavnet altid overlever. Det giver navne-kolonnen sin egen faste venstrekant, saa navnene selv bliver lodret scanbare. Fuldt navn i `title` paa navne-spanet. Dette er den anden halvdel af #4259: renden loeser "hvem har loeb", efternavn-foerst loeser "navnene ligner hinanden".

`text-[13px] leading-[18px]` er ikke et brud paa PAGE_TEMPLATES: forbuddet mod arbitrary `text-[Npx]` gaelder KUN under 12px. 13px er allerede i brug i MobileLanes.jsx:87, den §6-beskyttede mobil-raekke som brief'en udpeger som moensteret.

Alle tre hoejre-slots har fast bredde (`w-4` / `w-6` / `w-7`), saa baade venstre-renden og talkolonnerne staar lodret. Navnet er det eneste elastiske felt.

`{r.form ?? "—"}` bliver til `{r.form ?? ""}` med bredden bevaret af `w-6`. Dette er IKKE en em-dash-fix (scripts/tone-check-em-dash.mjs scanner locale-JSON, patchNotes.js, index.html og privacy, ikke JSX, og tillader eksplicit en enkeltstaaende `—` som tom-vaerdi-glyf). Det er "fri tegner intet" anvendt paa tal-kolonnen, saa den lodrette linje af tal ikke brydes af pladsholdere.

5f) LEGENDEN, linje 106-108. Samme ene `<p>`, samme placering, `·` som skille (samme skille som headeren paa linje 40):
```jsx
<p className="px-3 pt-1.5 pb-2 text-3xs text-cz-3 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
  <CheckIcon size={10} aria-hidden="true" /> {t("racehub.day.legendRacing")}
  <span className="text-cz-border" aria-hidden="true">·</span>
  <LockIcon size={10} aria-hidden="true" /> {t("racehub.day.legendBlocked")}
  <span className="text-cz-border" aria-hidden="true">·</span>
  <AlertTriangleIcon size={10} className="text-cz-danger" aria-hidden="true" /> {t("racehub.day.injured")}
</p>
```
Den tomme rende staar bevidst IKKE i legenden. Der er intet at forklare ved en raekke du bare kan klikke paa.

═══════════════════════════════════════════════
6. DE SEKS KOMPONENTER — HVEM FAAR DEN
═══════════════════════════════════════════════

1. **AvailableRidersPool.jsx — JA, fuld behandling.** Fire tilstande, gitter, taelle-linje, legende. Her bor klagen.

2. **RaceColumn.jsx — JA, men KUN 'out'.** FIL: C:\Dev\CyclingZone\frontend\src\components\racehub\RaceColumn.jsx. Samme 16px rende som FOERSTE barn i begge rytter-raekker: den laaste gren (`<div className="w-full flex items-center justify-between gap-2 px-3 py-1.5">`, omkring linje 149) og den redigerbare gren (samme div med `hover:bg-cz-subtle`, omkring linje 180 — renden ind FOER `▾`-chevron-knappen, saa den er raekkens foerste x). `r.injured` ligger allerede paa `column.riders`.
   Hvorfor kun 'out': hver raekke i en kolonne ER riding pr. definition. Seks flueben paa seks raekker er at tegne "alt er fint" seks gange. Det eneste indeslutning IKKE kan sige, er at en gemt trup indeholder en skadet rytter. Fjernelse er tilladt ogsaa i den laaste gren, saa handlingen findes.

3. **RaceSelectionPanel.jsx — JA, men som OMPLACERING, nul ny grafik, nul nye noegler.** FIL: C:\Dev\CyclingZone\frontend\src\components\race\RaceSelectionPanel.jsx. Renden skydes ind mellem checkbox-`<label>` og navne-blokken i BEGGE traeer: mobil-`<li>` (omkring linje 440, i den eksisterende `flex items-start gap-3`) og desktop-`<td>` (omkring linje 570, `flex items-center gap-2` aendres til `items-start`). De eksisterende piller paa linje 457-467 og 583-592 FLYTTER fra den inline `flex-wrap` til en `text-3xs`-underlinje under navnet, fordi det er dem der hopper med navnelaengden. `freeRole`-pillen og `RiderTypeBadge` BLIVER inline: de er rolle og klassifikation, ikke forhindringer.
   Kortere tilstands-tabel her, fordi checkboxen allerede siger "udtaget":
   · `bound && checked` → AlertTriangleIcon `text-cz-danger` + `selection.boundConflict` (aegte fejltilstand: to overlappende loeb)
   · `rider.injured` → AlertTriangleIcon `text-cz-danger` + `selection.injured`
   · `bound && !checked` → LockIcon `text-cz-3` + `selection.boundIn`
   · ellers → intet
   Praecedens: bound+checked > injured > bound > intet.
   Verificeret: `selection.injured` = EN "Injured" / DA "Skadet"; `selection.boundIn` = EN "Riding {race}" / DA "Kører {race}"; `selection.boundConflict` = EN "Overlaps {race}" / DA "Overlapper {race}". Alle findes allerede i begge locale-filer. `bound_riders` er server-beregnet overlap og laeses allerede paa linje 177. Akademiryttere naevnes ikke: `applyRiderEligibilityFilter` fjerner dem helt fra svaret, og der er intet at tegne for en raekke der ikke findes.
   KUN native `title=` her, ALDRIG `<Tooltip>`: linje 517 er `hidden sm:block overflow-x-auto`, og Tooltip.jsx er en ren CSS-soeskende-`<span>` der ville blive klippet.

4. **PlannerSquad.jsx — NEJ til dags-glyffen.** Andet zoom-niveau (Z1 saeson-peaks, ikke Z2 loebsdag). Fladen HAR allerede praecis dette moenster paa linje 168-174: `<span className="shrink-0 w-4 flex justify-center">` med StarIcon = forslag, FlagIcon = sat peak, `w-2 h-2 rounded-full border border-dashed border-cz-3` = tom. Det er den rende jeg kopierer bredden fra, ikke omvendt. En dagsstatus dertil ville kollidere med FlagIcon.

5. **MobileLanes.jsx — NEJ.** Forkert zoom-niveau, og §6 i PLANNING_CENTER_RULES beskytter den eksplicit ("Mobilt stakket lane-mønster, tap-mål ≥24px" — byg aldrig om). Raekken baerer allerede navn, RiderTypeBadge, to peak-prikker (`w-2.5 h-2.5`, linje ~99-107) og en status-glyf. Et sjette signal ville vaere det der braekker den. Puljens nye raekke LAANER dens tap-maal og ink-disciplin; modsat vej sker der intet.

6. **MasterCanvas.jsx — NEJ.** SVG-saeson-skinne med tids-proportional akse og formkurver over hele saesonen. Der findes intet per-dag-anker at haenge et maerke i, og en glyf i `<text>`/`<rect>` ville blive et andet ikonsprog i et andet medie.

Tre af seks. De tre fravalg er en graense, ikke en udeladelse: renden hoerer til hvor spoergsmaalet er "hvem koerer i DAG", ikke hvor det er "hvornaar topper han".

═══════════════════════════════════════════════
7. COPY — EN FOERST, DA UNDER
═══════════════════════════════════════════════

FILER: C:\Dev\CyclingZone\frontend\public\locales\en\races.json og C:\Dev\CyclingZone\frontend\public\locales\da\races.json

NY GRUPPE `racehub.day`:

racehub.day.racingIn
EN: Racing {race}
DA: Kører {race}

racehub.day.busyIn
EN: Busy in {race}
DA: Optaget i {race}

racehub.day.busyUnknown
EN: Busy in another race
DA: Optaget i et andet løb

racehub.day.dayClosed
EN: No race is open today
DA: Intet løb er åbent i dag

racehub.day.injured
EN: Injured
DA: Skadet

racehub.day.legendRacing
EN: Racing today
DA: Kører i dag

racehub.day.legendBlocked
EN: Cannot be added
DA: Kan ikke tilføjes

racehub.day.riderAria
EN: {name}. {state}
DA: {name}. {state}

NYE NOEGLER UNDER `racehub.pool`:

racehub.pool.tallyFree
EN: {count} no race
DA: {count} uden løb

racehub.pool.tallyRacing
EN: {count} racing
DA: {count} kører

racehub.pool.tallyOut
EN: {count} unavailable
DA: {count} utilgængelige

UDGAAR:
racehub.pool.bound (EN "Already racing in an overlapping race" / DA "Kører allerede et overlappende løb"). Den forklarede EET maerke; legenden forklarer nu tre.

BEHOLDES UAENDRET:
racehub.pool.title, racehub.pool.autofill, racehub.pool.clearDay, racehub.pool.clearAllSeason, racehub.pool.loadShort, racehub.pool.loadTitle, racehub.pool.clearDayTooltip, racehub.boundNamed (EN "Locked · racing in {race}" / DA "Låst · kører {race}" — bruges ikke laengere i puljen, men lever videre i popoveren), alle racehub.popover.*, alle selection.*.

RENDRET VED 30 RYTTERE:
EN: Available riders · 30-squad · 18 no race · 9 racing · 3 unavailable
DA: Ledige ryttere · 30-trup · 18 uden løb · 9 kører · 3 utilgængelige

LEGENDEN:
EN: [check] Racing today · [lock] Cannot be added · [triangle] Injured
DA: [check] Kører i dag · [lock] Kan ikke tilføjes · [triangle] Skadet

INGEN EM-DASH nogen steder. Skilletegnet er midterprik `·`, som allerede bruges i racehub.pool.title og i pool-headeren. Alle danske strenge har æøå. Intet opfundet indhold: hvert loebsnavn kommer fra `raceByRider`, `overlapConflictColumn` eller `bound_riders`, aldrig fra en formulering.

═══════════════════════════════════════════════
8. MOBIL VED 375px
═══════════════════════════════════════════════

`grid-cols-1` giver een fuld-bredde kolonne. Raekken ER hele knappen.

BREDDE-REGNSKAB: 24px sidepadding (`px-3` x 2) + 16px rende + 8px gap + 24px form (`w-6`) + 8px gap + 28px load (`w-7`) + 8px gap = 116px krom. 259px til navnet. "Bonifazio Alessandro" ved 13px Inter Tight er ca. 130px, saa efternavn plus fornavn staar uden trunkering for naesten alle navne, og et langt hollandsk efternavn truncater i fornavnet i stedet for at wrappe. Raekkehoejden er dermed deterministisk, hvilket er forudsaetningen for at scanne.

TAP-MAAL: `min-h-[32px]` (py-1.5 = 12px + 18px linje = 30px, klampet til 32). Over brief'ens gulv paa 24px, og markant stoerre end dagens chip. Raekker med aarsagslinje er ca. 46px. Hele raekken aabner AddRiderPopover, ikke kun navnet, saa der er ingen lille traefflade nogen steder.

RENDEN SKALERES ALDRIG. 16px er minimum; skrumper den, braekker den lodrette linje.

INGEN HOVER BAERER NOGET ALENE. Alle tre glyffer har enten en synlig aarsagslinje (blocked, out) eller en tilstand der ikke er handlings-kritisk (riding). `title=` er redundans, aldrig baerer. `<Tooltip>`-komponenten bruges IKKE: den er CSS-only og klippes af `overflow-x-auto`.

HOEJDE: 30 raekker a 33px (32 + 1px regel) = ca. 990px, ca. to en halv skaerm. Det ACCEPTERES bevidst, af to grunde:
 (a) Puljen rendres SIDST paa braettet (RaceHubBoard.jsx:572, efter kolonne-gitteret), saa hoejden skubber intet ned. Den koster scrolldybde i bunden, ikke foldeposition.
 (b) `max-h` + `overflow-y-auto` er AFVIST: `AddRiderPopover` er `absolute` positioneret inde i raekken, saa et scroll-loft ville klippe selve forklaringen. Forklaringen er hele pointen.
Taelle-linjen i headeren er svaret uden at scrolle.

DESKTOP ARVER SAMME DOM. Eneste forskel er `sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))]`, som giver 4-5 baner. Een IA paa alle bredder: ingen komponent findes kun paa den ene bredde, ingen tilstand tegnes kun paa den ene bredde.

HOEJDE DESKTOP: 30 / 5 = 6 raekker a 33px = 198px + header 36px + legende 24px = ca. 258px. I dag ca. 170px + p-3 + header + fodnote, plus uforudsigelig ekstra hoejde for hver laast chips underlinje. Netto ca. +50px for 4-5 faste scan-baner i stedet for et rager-ombrud.

═══════════════════════════════════════════════
9. FOLD-DISCIPLIN OG HVOR DET BOR
═══════════════════════════════════════════════

PAGE_TEMPLATES §Fold-disciplin kraever at ethvert design-go siger hvor nyt indhold bor, i prioriteret raekkefoelge. Dette ligger paa PRIORITET 1, "inde i et eksisterende element", hele vejen. NUL nye kort, NUL nye folder, NUL nye faner. Over-folden-budgettet paa braettet er uroert. Der kraeves derfor intet ejer-ord for et nyt stablet kort.

FILER OG PLACERING (absolutte stier):
- C:\Dev\CyclingZone\frontend\src\lib\raceHubLogic.js — ny `riderDayState` efter linje 78
- C:\Dev\CyclingZone\frontend\src\lib\raceHubLogic.test.js — nye cases ved det eksisterende riderColumnState-fixture (~linje 197 + ~245)
- C:\Dev\CyclingZone\frontend\src\components\racehub\AvailableRidersPool.jsx — linje 12-14 imports, 29 stateOf, 33-35 header + tally, 52-57 gitter, 69-102 raekken, 106-108 legende
- C:\Dev\CyclingZone\frontend\src\components\racehub\RaceColumn.jsx — rende som foerste barn i begge rytter-raekker (~149 laast, ~180 redigerbar), kun 'out'
- C:\Dev\CyclingZone\frontend\src\components\race\RaceSelectionPanel.jsx — rende mellem checkbox og navn i `<li>` (~440) og `<td>` (~570); piller flyttes fra ~457-467 og ~583-592 til subline; imports udvides med LockIcon + AlertTriangleIcon
- C:\Dev\CyclingZone\frontend\public\locales\en\races.json og \da\races.json
- C:\Dev\CyclingZone\frontend\src\data\patchNotes.js — brugerrettet aendring, kraever en linje
- C:\Dev\CyclingZone\frontend\public\locales\{en,da}\help.json — de tre maerker forklares, da de nu er en del af udtagelses-sproget

IKKE ROERT: PlannerSquad.jsx, MobileLanes.jsx, MasterCanvas.jsx, FitBar.jsx, AddRiderPopover.jsx, plannerShared.js (undtagen navne-fixet i §10).

═══════════════════════════════════════════════
10. NAVNE-HALVDELEN AF #4259 (obligatorisk foelgesvend)
═══════════════════════════════════════════════

Puljen loeser den selv via efternavn-foerst, MEN kraever eet additivt backend-felt. Verificeret: `backend/lib/raceSelection.js:130` joiner `[r.firstname, r.lastname]` til eet `name`-felt, mens BEGGE kolonner allerede er selected paa linje 171. Rettelsen er additiv, to ord, ingen migration, intet ekstra DB-kald, ingen kontrakt-brud:
```js
name: [r.firstname, r.lastname].filter(Boolean).join(" "),
firstname: r.firstname ?? null,
lastname: r.lastname ?? null,
```
Uden det felt falder puljen tilbage til `{r.name}` med `truncate`, som skaerer EFTERNAVNET vaek. Renden virker fuldt ud, men navne-halvdelen af klagen bliver ikke loest.

Planner-fladerne har et SEPARAT navne-problem: `plannerShared.js` `riderShortName` bygger `"L. Vermeulen"` af `firstname.slice(0,1) + lastname` og kollapser dermed praecis de mellem-initialer der er det eneste der skiller navnene ad. Rettelse paa stedet, een initial pr. fornavns-token:
```js
const fn = String(rider?.firstname ?? "").trim().split(/\s+/).filter(Boolean)
  .map((w) => `${w.slice(0, 1)}.`).join(" ");
```
→ `"L. J. Vermeulen"`. Kaldere: PlannerSquad.jsx (~182 og ~259), MobileLanes.jsx:87, MasterCanvas' venstre skinne. Alle har allerede `truncate`, saa intet reflow.

FOER SHIP: tael hvor mange ryttere der faktisk har mere end eet token i `firstname` (`database/schema-snapshot.json` → `relations.riders.columns`, kolonnerne hedder `firstname`/`lastname`/`birthdate`). Har de fleste det, laenges navnet 3 tegn i en trunkerende celle for ALLE, og gevinsten er mindre end prisen. Det skal maales, ikke antages.

═══════════════════════════════════════════════
11. VERIFIKATION FOER PUSH
═══════════════════════════════════════════════

Roerer frontend, i18n, tre komponenter og et delt lib. Det er TIER FULL efter #3556: `pwsh -File scripts/preflight-pr.ps1`, `npm run lint` i frontend (verify-local koerer IKKE eslint), fuld `node --test` i frontend, i18n-key-tjek, og ALLE tre Playwright-projekter (puljens layout skifter helt, saa mobile-snapshots skal med, ellers fejler CI paa mobile som i #536).

Ekstra tjek der ikke er dækket af CI:
- Rendér puljen med 30 ryttere i BEGGE temaer. Bekraeft at `text-cz-1` og `text-cz-3` er tydeligt adskilte i dark mode. Ink-stigen er skaaret til to trin netop for at fjerne den risiko, men den skal ses.
- Se CheckIcon, LockIcon og AlertTriangleIcon ved 11px paa /ui (KitchenSinkPage) foer commit. 11px er den stoerrelse LockIcon allerede bruger i chippen, saa den er kendt god; de to andre er ikke set paa den stoerrelse i denne kontekst.
- `node scripts/lint-ui-slop.mjs` — ingen raa hex, ingen rounded-xl/2xl, ingen glow-shadow, ingen palette-utility, ingen pictographic i JSX eller locale-vaerdier. Intet i denne spec rammer nogen af de fire kategorier.
- UI-diff: merge ALDRIG uden ejer-visuelt go. Puljens layout skifter fra chip-sky til liste, og RaceSelectionPanel er en live udtagelses-flade.

## Ejer-spoergsmaal
- Puljen gaar fra chip-sky til liste. Paa 375px betyder det ca. 990px hoejde mod ca. 500px i dag, altsaa naesten dobbelt. Puljen rendres sidst paa braettet, saa ingen loebskolonne skubbes ned, og et scroll-loft er afvist fordi det ville klippe AddRiderPopover. Er 'scan een kolonne' det vaerd, eller vaegter du 'hele truppen synlig paa een gang' hoejere? Hvis det sidste, falder hele designet, for en glyf i en wrap-sky giver ingen lodret bane.
- Renden er 16px og er ALTID til stede, ogsaa i RaceColumn hvor den kun tegner ved skade. Det koster hver kolonne-raekke 16px venstre-inset for et signal der maaske fyrer een gang pr. saeson. Alternativet er at droppe renden fra RaceColumn helt, men saa er en skadet rytter i en gemt trup fortsat usynlig indtil Gem fejler. Fast rende i kolonnerne, eller kun i puljen og udtagelses-panelet?
- Skal jeg tilfoeje firstname og lastname ved siden af det joinede name i buildRiderRows (backend/lib/raceSelection.js:130)? Begge kolonner er allerede selected paa linje 171, saa det er to ord, ingen migration, intet ekstra DB-kald og ingen kontrakt-brud. Uden det kan puljen ikke rendre efternavn-foerst, og saa loeser vi 'hvem har loeb' men ikke 'so many of the names are the same', som er den anden halvdel af knuds klage.


---

# SelectionCountBar

## Vinder
FORSLAG 2: Kapacitetsbaren og konfliktlisten

## Begrundelse
Verifikation foerst. Ingen af de tre opfinder et token: text-cz-danger, bg-cz-1/2/3, bg-cz-subtle, border-cz-border, text-cz-accent-t, rounded-cz, rounded-cz-pill, text-2xs, text-3xs og font-data findes alle i frontend/tailwind.config.js. Alle fem ikonnavne der bruges (AlertTriangleIcon, ChevronDownIcon, ChevronRightIcon, LockIcon, UndoIcon) findes i frontend/src/components/ui/icons/index.jsx. Ogsaa bg-cz-border/60 er lovligt her, fordi FitBar.jsx:26 og TerrainDNABar.jsx:16 allerede sender det i produktion. Derfor rammer ingen 4-loftet paa skabelontro.

Forslag 2 vinder paa de to akser der afgoer fladen. (1) Konflikt foer klik: det er det ENESTE forslag der loeser det paa raekke-niveau i stedet for kun paa panel-niveau. Naar det blokerende loeb selv er startet, tegner det INGEN knap, men LockIcon plus "Lineup locked". De to andre tilbyder en knap der foerst fejler efter klikket, altsaa praecis det moenster briefet forbyder. Dertil: fejl skrives i raekken, aldrig som toast, og Undo staar inline. (2) Laesbarhed ved 30 ryttere: det er det eneste forslag med FASTE kolonnebredder (112px zone A, 61px zone B, 168/flex/104/224 i raekkerne), saa otte loeb under hinanden staar i lodret linje. Det er det rigtige svar paa skalerings-aksen og ingen andre gjorde det.

Forslag 2 fandt ogsaa en divergens de to andre missede, og jeg har verificeret den: backend/lib/raceSelection.js:34-40 kraever kun kaptajn naar riderIds.length > 0, mens klientens validateSelectionClient kraever kaptajn ubetinget. Klienten blokerer altsaa i dag et gem af en TOM trup, hvilket er praecis "ryd min trup og gem"-flowet fra #4200.

Forslag 1 er taettest paa skabelonen (raekke-anatomien er ordret T1's "13.5px/500 title + data-font uppercase meta line, 1px --border top rules, 13px vertikal padding", som jeg bekraeftede i PAGE_TEMPLATES.md:40) og har den bedste resume-linje og den bedste data-vagt. Men den haandruller sekundaer-knappen i stedet for at importere Button, hvilket er i modstrid med "Genbrug, byg ikke om", og den laegger en lodret scroll-container inde i en fold paa mobil.

Forslag 3 taber paa en doedelig indvending. Den beholder requireFull i kaldet til validateSelectionClient og tilfoejer oven i koebet en NY blokerende fejlkode selection_below_size. Briefet siger ordret at Gem ALDRIG maa vaere disabled paa grund af antal. Forslag 3 leverer altsaa ikke fladens hovedkrav. Dertil gaar meter-fyldet guld ved fuldt hold i et view der allerede har den guldfarvede Gem-knap, hvilket rammer "no second gold button per view" i Hard don'ts.

## Graft fra taberne
FRA FORSLAG 1, seks ting, alle verificeret mod koden:

1. LEDGER-LINJEN erstatter forslag 2's to prosa-saetninger. "4 free · 23 in other races · 2 injured" med invarianten free + clashing + injured === riders.length og reglen om at en skadet OG bunden rytter kun taelles som skadet. Det er det eneste af de tre der garanterer at tre tal gaar op mod en trup paa 29, og midtpunkt-separatoren er ordret formatet i fold-disciplinens eget referenceeksempel ("4 trained · 1 rested · 1 point landed", PAGE_TEMPLATES.md:90). Forslag 2's saetninger er laengere og forsoner sig ikke.

2. VAGTEN MOD FEMCIFREDE LOEBSDAGE. Jeg har verificeret den: backend/lib/raceBinding.js falder tilbage til cetDayOrdinal (~20.000) naar bare én schedule-raekke mangler game_day. Forslag 1 er det eneste der fanger det og siger: send da ikke feltet, og tegn ikke dag-linjen. Fravaer af signal frem for "Race day 20693". Det gaar ind som hard krav.

3. DEN RIGTIGE BACKEND-VEJ TIL DAGE. Forslag 2 og 3 lover "2 til 3 linjer inde i den eksisterende .map()". Det er forkert. mapRiderBindingDetails (raceBinding.js:183-194) returnerer en Map<riderId, raceId> uden dage, og dens vaerdi laeses af baade classifyBindingConflicts og resolveBindingConflictDetails. Aendrer man Map-formen, rammer det tre kaldesteder plus tests. Forslag 1's vej er den eneste korrekte: byg daysByRace lokalt i handleren fra binding.otherRaces[].window.days og skaer mod binding.thisWindow.days, uden at roere den delte rene funktion.

4. GENBRUG AF EKSISTERENDE i18n. selection.boundIn ("Riding {race}"), racehub.raceDay ("Race day {day}") og racehub.raceDays ("Race days {start}-{end}") findes alle. Forslag 2's clashes.dayOne/dayRange/dayList droppes.

5. sm:items-center → sm:items-start paa RaceSelectionPanel.jsx:337. Verificeret: raekken er i dag "flex flex-col sm:flex-row sm:items-center justify-between gap-1", og en 2-linjes bar ville flyde midt imod en 2-linjes titelblok.

6. rounded-lg → rounded-cz paa Gem- og Auto-udfyld-knapperne, plus preview-seed. Uden bound_riders i seedData ser ejeren kun den rolige tilstand paa preview og aldrig den tilstand hele arbejdet handler om.

FRA FORSLAG 3, tre ting:

7. kind: "releasable". Er bindingen en auto-udfyldt entry i et loeb der ikke er startet, frigiver PUT den selv (#2637). Saa tilbydes INGEN knap, kun én linje der siger at gem her frigiver ham. Det er konflikt-foer-klik i sin reneste form, og hverken forslag 1 eller 2 har den.

8. INGEN HOVER NOGEN STEDER, og den verificerede fejl bag reglen: AvailableRidersPool.jsx:76 baerer title={t("racehub.boundNamed", { race })}, altsaa "Locked · racing in {race}", som er usynlig paa en telefon. En mobil-manager ser i dag kun et haengelaas uden loebsnavn. Fikses i samme PR.

9. INGEN INDRE SCROLL-CONTAINER. Forslag 1's max-h-[240px] overflow-y-auto droppes til fordel for forslag 3's cap paa fem raekker plus "Show all {n}".

DROPPET FRA VINDEREN: tick-hoejden gaar fra h-3 (12px) til h-2.5 (10px), saa meteret laeses som hairline og ikke som et soejlediagram, og forslag 2's egen indvending om et tredje meter-sprog bliver mindre. Den bevidste afvigelse: ticks beholder skarpe kanter og diskrete slots, fordi "uopnaaelig plads" er en tredje tilstand pr. plads som hverken ProgressMeter eller FitBar kan baere, og det ER designets pointe.

## ENDELIG SPEC
SELECTIONCOUNTBAR + CONFLICTPANEL, SAMLET BYGGEKLAR SPEC

Alle klasser, tokens, ikonnavne og linjenumre nedenfor er verificeret mod koden 27/8.

=====================================================================
A. FILER OG PLACERING
=====================================================================

NY 1: frontend/src/lib/selectionCapacity.js (ren, node --test)
NY 2: frontend/src/components/racehub/SelectionCountBar.jsx
NY 3: frontend/src/components/racehub/ConflictPanel.jsx
(racehub/ fordi PLANNING_CENTER_RULES §6 allerede har FitBar.jsx dér som den delte komponent tre flader forbruger. ConflictPanel OVERTAGER slottet som Z1-spec'ens §7 kalder CellLockPanel.jsx. Byg den ikke to gange, stryg raekken i spec-tabellen og peg paa denne fil.)

PLACERING 1, prioritet 1 (inde i et element der allerede findes):
frontend/src/components/race/RaceSelectionPanel.jsx:341-344.
  <span className="text-xs font-mono text-cz-2 whitespace-nowrap">{t("selection.count", ...)}</span>
erstattes af <SelectionCountBar ... /> i den SAMME header-flexraekke paa linje 337.
Samtidig aendres linje 337 fra sm:items-center til sm:items-start.
Ny linje 337: className="px-4 py-3 border-b border-cz-border flex flex-col sm:flex-row sm:items-start justify-between gap-1"
Desktop-hoejde: 0px ekstra.

PLACERING 2, prioritet 2 (bag en fold, renderer null i normaltilfaeldet):
RaceSelectionPanel.jsx, umiddelbart EFTER header-diven og FOER #3809-mode-toggle-baandet paa linje ~350:
  <ConflictPanel variant="band" rows={conflictRows} onResolve={...} id="selection-clashes" />
Sektionen er allerede en stak hairline-adskilte baand (mode-toggle, suitabilityHelp, autoPicked, raceLiveNote). Konfliktlisten bliver ÉT baand mere i den stak. Ikke et nyt kort. Ingen ny container-bredde, ingen ny card-padding.

PLACERING 3:
frontend/src/components/racehub/RaceColumn.jsx. Status-pillen paa linje ~120 slettes sammen med hele STATUS_CLASS-mappet (linje 16-22).
  Slettet markup: <span className={`inline-block mt-2 text-3xs uppercase tracking-wide px-2 py-0.5 rounded-full border ${STATUS_CLASS[status.kind]}`}>
SelectionCountBar placeres UNDER <RaceLink>, som foerste kropsraekke:
  <div className="px-3 py-2 border-b border-cz-border"><SelectionCountBar ... /></div>
Den skal UD af RaceLink. Hoppe-linket er interaktivt, og et interaktivt element inde i et <a> er en aegte a11y-fejl. Headeren blev bevidst gjort til ÉT hit-target i #3187 og forbliver det.

PLACERING 4:
frontend/src/components/racehub/RaceHubBoard.jsx, i det slot der allerede baerer reuseAcrossDays-noten (verificeret linje 531), mellem noten og kolonne-gridet (linje 552/563):
  <ConflictPanel variant="card" rows={...} onResolve={...} />
Boardets ENE guld-primaer er allerede Gem paa linje 516, saa panelet bruger border-cz-border bg-cz-card. Ikke de eksisterende noters border-cz-accent/30 bg-cz-accent/10. Konflikt er ikke guld.

Z1-matrixen monterer den SAMME <ConflictPanel variant="card" /> under gitteret. Det er hele pointen med den delte kontrakt.

=====================================================================
B. selectionCapacity.js
=====================================================================

export function selectionCapacity({ size, riders = [], boundRiderIds, picked = 0 }) {
  const max = size?.max;
  if (!Number.isFinite(max)) return null;
  const bound = boundRiderIds instanceof Set ? boundRiderIds : new Set(boundRiderIds || []);
  let free = 0, clashing = 0, injured = 0;
  for (const r of riders) {
    if (r.injured) injured++;              // skadet vinder, saa ingen dobbelttaelling
    else if (bound.has(r.id)) clashing++;
    else free++;
  }
  const reachable  = Math.min(max, Math.max(free, picked));
  const open       = Math.max(0, reachable - picked);
  const unreachable= Math.max(0, max - reachable);
  const overfull   = Math.max(0, picked - max);
  return { max, free, clashing, injured, reachable, open, unreachable, overfull, capped: reachable < max };
}

Invariant der skal have sin egen test: free + clashing + injured === riders.length.
Math.max(free, picked) er vagten mod at meteret tegner faerre naaelige pladser end der faktisk er fyldt (en bunden rytter der allerede er afkrydset her efter en reschedule).

bound_riders udelukker korrekt DETTE loeb (loadTeamBindingContext bruger .neq("race_id", race.id)), saa en rytter valgt her taeller som free. Verificeret.

=====================================================================
C. SELECTIONCOUNTBAR, ANATOMI
=====================================================================

Én vandret raekke, tre zoner, faste bredder i zone A og B saa otte raekker under hinanden aldrig hopper vandret.

<div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="selection-count-bar">

  ZONE A, 112px fast (ellers flytter det oversatte ord meteret):
  <span className="w-[112px] shrink-0 flex items-baseline gap-1.5">
    <span className={`font-data text-[15px] font-[650] leading-none tabular-nums ${overfull ? "text-cz-danger" : "text-cz-1"}`}>
      {picked}<span className="text-cz-3"> / {max}</span>
    </span>
    <span className="font-data text-2xs uppercase tracking-[.08em] text-cz-3">{t("selection.countBar.label")}</span>
  </span>

  ZONE B, hairline-meter. Bredden ALTID reserveret til 8 slots (8*5 + 7*3 = 61px), ogsaa i et 6-pladsers loeb, saa zone C starter paa samme x i hver raekke:
  <span role="img" aria-label={t("selection.countBar.aria", { picked, max, unreachable })}
        className="flex w-[61px] shrink-0 items-end gap-[3px]">
    fyldt          <i className="h-2.5 w-[5px] shrink-0 bg-cz-1" />
    ledig          <i className="h-2.5 w-[5px] shrink-0 border border-cz-border" />
    uopnaaelig     <i className="h-2.5 w-[5px] shrink-0 border-b border-cz-border" />   (kun gulv, ingen vaegge)
    for mange      <i className="h-2.5 w-[5px] shrink-0 bg-cz-danger" />
    laast          <i className="h-2.5 w-[5px] shrink-0 bg-cz-3" />
  </span>

  ZONE C, grunden. Wrapper til egen linje under 640px:
  <span className="min-w-0 basis-full sm:basis-auto sm:flex-1 text-2xs text-cz-3 sm:truncate">
    {indhold pr. tilstand}
    {clashing > 0 && (
      <button type="button" onClick={onShowClashes}
        className="ms-1.5 inline-flex items-center gap-1 min-h-[24px] py-1 text-xs font-medium text-cz-accent-t hover:underline">
        {t("selection.countBar.showClashes")}<ChevronRightIcon size={12} aria-hidden="true" />
      </button>
    )}
  </span>
</div>

Ticks er 5x10px firkanter UDEN radius. Radius-reglen i PAGE_TEMPLATES gaelder flader (5px rounded-cz, pills rounded-cz-pill). En tick er en streg, ikke en flade. Fyldt slot er BLAEK (bg-cz-1), aldrig guld. Guld er rationeret til den ene primaere knap plus foerer-markoerer, og "du fyldte truppen" er ingen af delene.
h-2.5 og ikke h-3: meteret skal laese som hairline paa linje med FitBar's h-1, ikke som et soejlediagram.

bg-cz-1 som fyld har praecedens: DevelopmentGlyph.jsx:53 og RiderPhysiologyTab.jsx:63. bg-cz-3 har praecedens i FitBar.jsx:10. Verificeret.

onShowClashes scroller ConflictPanel ind i view og saetter fokus paa dens foerste raekke.

=====================================================================
D. SELECTIONCOUNTBAR, ALLE TILSTANDE
=====================================================================

1. FULD (picked === max === reachable). 8 fyldte ticks, "8 / 8 PLACES". ZONE C ER TOM.
   DETTE ER TILSTANDEN HVOR DER IKKE TEGNES NOGET. Intet flueben, ingen groen badge, intet ord "Ready", intet ikon. Ved otte loeb paa skaermen betyder det at oejet kun stopper ved de loeb der har noget at sige. Fravaer af signal er det roligste signal.

2. LEDIG (picked < reachable === max). Fyldte plus outline-ticks. Zone C: "2 places open" i text-cz-3. Neutral. Ikke roed, ikke gul, ikke en fejl. Det er et VALG.

3. LOFT, ikke fyldt (reachable < max, picked < reachable). Fyldte plus outline plus gulv-only-ticks. Zone C: ledger-linjen "4 free · 23 in other races · 2 injured" plus "Show clashes >".

4. LOFT, fyldt til loftet (picked === reachable < max). Alle naaelige ticks fyldte, gulv-only-ticks tilbage. Zone C: samme ledger plus "Show clashes >". Dette er praecis den tilstand de fire andre flader i dag kalder "mangler". Her er den FAERDIG, og baren siger det ved at holde op med at bede om noget.

5. LOFT af skader alene (clashing === 0). Ledger uden clashing-segment, og INTET hoppe-link. Et link der peger paa en tom liste er stoej. Beviset staar allerede i rytterlisten som Injured-badges plus hideInjured-toggle.

6. FOR MANGE (picked > max). De overskydende ticks bg-cz-danger, tallet text-cz-danger, zone C i text-cz-danger: "1 too many. Remove a rider before you save."
   DEN ENESTE ROEDE TILSTAND, og den er aerlig: serveren afviser den (backend/lib/raceSelection.js:25).

7. AFMELDT. Ingen ticks, zone A tom med bredden reserveret, zone C: "Withdrawn" i text-cz-3.

8. LAAST (lineup_locked eller stages_completed > 0). Ticks bg-cz-3, zone C: LockIcon size 12 text-cz-3 plus "Lineup locked". Graat og uklikbart med navngiven grund.

9. TOM TRUP (picked === 0). Ingen saerbehandling. Reglerne 2 til 5 gaelder. Ingen EmptyState.

10. eligible === false eller data === null: panelet returnerer tidligt som i dag, baren monteres aldrig.

LOADING: kortets krom bliver staaende, kun kroppen skifter. <Skeleton /> 10px hoej i meterets 61px bredde. Aldrig en spinner inde i et kort (PAGE_TEMPLATES, Canonical states).

=====================================================================
E. CONFLICTPANEL, ANATOMI
=====================================================================

Props, én flad raekke-kontrakt som alle tre kaldere normaliserer ind i:
  rows: [{ riderId, riderName, blockingRaceId, blockingRaceName, sharedDays: number[]|null, kind: "blocking"|"releasable", blockingLocked: bool }]
  variant: "band" | "card"
  onResolve(row) -> Promise
  id

Wrapper:
  variant "card" => <section className="mb-3 rounded-cz border border-cz-border bg-cz-card">
  variant "band" => <section className="border-b border-cz-border bg-cz-card">

HOVED:
<div className="flex items-baseline gap-2 px-3 py-2 border-b border-cz-border">
  <AlertTriangleIcon size={13} aria-hidden="true" className="translate-y-0.5 text-cz-danger" />
  <span className="font-data text-2xs uppercase tracking-[.08em] text-cz-3">{t("clashes.title")}</span>
  <span className="font-data text-2xs tabular-nums text-cz-1">{rows.length}</span>
  <span className="ms-2 text-[13px] text-cz-2">{t("clashes.rule")}</span>
</div>
Det roede alert-triangle er panelets ENESTE danger-farve. Ingen roed flade, ingen roed raekke. PAGE_TEMPLATES:73 ordret: "alert-triangle icon in danger (no red fills/panels)". Foregrunds-token er text-cz-danger (index.css --danger, tailwind.config.js cz-danger). Der findes intet --danger-t.

RAEKKE, md og op, faste kolonner:
<li className="hidden md:flex items-center gap-3 px-3 py-2 border-t border-cz-border first:border-t-0">
  <span className="w-[168px] shrink-0 truncate text-[13.5px] font-medium text-cz-1">{riderName}</span>
  <RaceLink id={blockingRaceId} className="min-w-0 flex-1 truncate text-[13px] text-cz-2 hover:text-cz-accent-t hover:underline">{blockingRaceName}</RaceLink>
  <span className="w-[104px] shrink-0 font-data text-2xs uppercase tracking-[.06em] tabular-nums text-cz-3">{dayLabel}</span>
  <span className="w-[224px] shrink-0 flex justify-end">{action}</span>
</li>

action, tre former:
  kind "blocking" og !blockingLocked:
    <Button variant="secondary" size="sm" className="max-w-[220px] truncate" title={fuldLabel}>{t("clashes.remove", { race })}</Button>
    IMPORTÉR Button fra ui/. Haandrul ALDRIG klasserne. PAGE_TEMPLATES:47: "row action buttons are secondary sm (never gold in rows)".
  kind "releasable":
    <span className="text-3xs text-cz-3">{t("clashes.releasable")}</span>   ingen knap
  blockingLocked:
    <span className="flex items-center gap-1 text-2xs text-cz-3"><LockIcon size={12} aria-hidden="true" />{t("clashes.lockedRace")}</span>

dayLabel:
  sharedDays.length === 1 -> t("racehub.raceDay", { day })
  sharedDays.length > 1   -> t("racehub.raceDays", { start: first, end: last })
  sharedDays == null      -> linjen tegnes IKKE. Fravaer af signal frem for et femcifret loebsdagsnummer.
Begge noegler findes allerede i races.json. Verificeret.

CAP: max 5 raekker synlige, derefter
  <button className="min-h-[24px] w-full px-3 py-2 border-t border-cz-border text-2xs font-medium text-cz-accent-t">{t("clashes.showAll", { count })}</button>
INGEN indre scroll-container. En lodret scroller inde i en fold paa telefon er en kendt faelde.

RAEKKEFOELGE: blocking foerst, saa releasable, hver gruppe sorteret paa blockingRaceName. Deterministisk.

=====================================================================
F. CONFLICTPANEL, ALLE TILSTANDE
=====================================================================

1. rows.length === 0 -> komponenten returnerer null.
   INGEN EmptyState, ingen "No clashes", intet groent, ingen fold der kan aabnes tom.
   DETTE ER DEN VIGTIGSTE TILSTAND OG DEN TEGNER INGENTING.
   Z1-matrixens fodnote-taeller ("No problems" i groent, ejer-godkendt i Z1-spec §10) er MATRIXENS egen fodnote, ikke denne komponent. To flader maa ikke begge tegne det.

2. rows >= 1: hoved plus raekker.

3. Raekke i gang: <Button loading> (Button.jsx har allerede loading og saetter aria-busy), raekken opacity-60.

4. Raekke loest: raekken bliver staaende i text-cz-3, action-cellen bliver en tekstknap "Removed. Undo" med UndoIcon size 12. Raekken forsvinder foerst ved naeste data-refresh. INGEN TOAST.

5. Raekke fejlet: knappen kommer tilbage, og ÉN linje under navnecellen i text-cz-danger text-2xs: "Could not remove. Try again." Inde i raekken. Aldrig en toast der fortaeller hvad der lige gik galt.

6. blockingLocked: ingen knap, LockIcon plus "Lineup locked". Graat og uklikbart med navngiven grund, i stedet for en knap der fejler EFTER klikket. Dette er fladens kerneprincip i sin reneste form.

7. kind "releasable": ingen knap, én linje der siger at et gem her frigiver ham. Intet at goere, saa intet tilbydes.

=====================================================================
G. GEM-VALIDERINGEN
=====================================================================

frontend/src/lib/raceSelectionLogic.js reduceres til noejagtigt serverens regel:

export function validateSelectionClient({ riderIds, captainId, sprintCaptainId, hunterId, size }) {
  const errors = [];
  if (riderIds.length > size.max) errors.push("selection_wrong_size");
  if (riderIds.length > 0 && !captainId) errors.push("selection_captain_required");
  const roles = [captainId, sprintCaptainId, hunterId].filter(Boolean);
  if (new Set(roles).size !== roles.length) errors.push("selection_role_overlap");
  return errors;
}

Fjernet: requireFull-grenen, availableCount-parameteren og hele kanFyldeTruppen-ventilen. Ventilen er doed kode. availableCount er "hele den raske trup" (raceSelection.js:223) og traekker aldrig bundne ryttere fra, saa den udloeser aldrig for et hold paa 29.
Kaldestederne RaceSelectionPanel.jsx:101 og :185 taber to argumenter.
backend/routes/api.js:4699 holder op med at sende availableCount til validateSelection, som ikke destrukturerer det.

Kaptajn-graenen: verificeret at backend/lib/raceSelection.js:34-40 kun kraever kaptajn naar riderIds.length > 0. Klienten kraevede den ubetinget og blokerede altsaa et gem af en TOM trup, praecis "ryd min trup og gem"-flowet fra #4200.

GEM ER HEREFTER ALDRIG DISABLED PAA GRUND AF ANTAL. selection_wrong_size betyder kun over max, og teksten "You can pick at most {max} riders" bliver endelig sand uden at blive skrevet om.

=====================================================================
H. DATA
=====================================================================

LIGGER ALLEREDE PAA WIREN, verificeret:
- data.size {min,max} via selectionSizeForRace. Graenser i backend/lib/raceAutopick.js:15-26: default {6,8} · Class1/Class2/ProSeries {6,6} · WorldTour A/B/C og Monumenter {7,7} · Giro/Vuelta {8,8}.
- data.riders[].injured (raceSelection.js:150).
- data.bound_riders[] = {rider_id, bound_race_id, bound_race_name} (api.js:4004-4006).
- boundByRider-Map'et bygges allerede i RaceSelectionPanel.jsx:177.
- injuredCount findes allerede paa linje 209.
- racehub.raceDay og racehub.raceDays som i18n-noegler.
- Boardet: raceHubLogic.findSelectionOverlaps plus windowsOverlap, som allerede skaerer dag-maengder siden #4173.
reachable kraever INTET nyt felt.

MANGLER, to additive felter paa bound_riders, ingen migration, ingen ny query:

1. shared_days: number[]
   Beregnes i backend/routes/api.js omkring linje 3999-4006 af data der ALLEREDE er hentet i samme handler:
     const thisDays  = new Set(binding.thisWindow?.days ?? []);
     const daysByRace = new Map(binding.otherRaces.map((o) => [o.raceId, o.window?.days ?? []]));
     ... shared_days: (daysByRace.get(raceId) || []).filter((d) => thisDays.has(d))
   ROER IKKE mapRiderBindingDetails (raceBinding.js:183-194). Den returnerer Map<riderId, raceId>, og dens vaerdi laeses af baade classifyBindingConflicts og resolveBindingConflictDetails. Aendrer man Map-formen, rammer det tre kaldesteder plus tests.

   HARD VAGT: raceBindingWindow falder tilbage til cetDayOrdinal (~20.000) hvis bare én schedule-raekke mangler game_day. Er en vaerdi i thisWindow.days uden for et fornuftigt loebsdags-interval, SENDES feltet ikke (undefined), og ConflictPanel tegner ikke dag-linjen. Aldrig "Race day 20693".

2. kind: "blocking" | "releasable"
   Reglen findes allerede som ren funktion i #2637-vejen (auto-udfyldt entry i et loeb der ikke er startet = frigives af PUT selv). Entries er allerede hentet i loadTeamBindingContext.
   Mangler kind: behandl som "blocking" og vis knappen. En unoedvendig Remove er harmloes, fordi PUT ville have frigivet ham alligevel.

DE FIRE ANDRE FLADER:
LOESES af ÉN aendring, fordi begge kaldere sender samme fulde GET-body:
- frontend/src/lib/raceSquadSelectionStatus.js:21 gaar fra "selected < target" til "selected < reachable" via selectionCapacity(). Verificeret at funktionen tager PRAECIS samme payload som panelet, saa riders og bound_riders er der allerede. Ingen ny netvaerkstrafik.
  Det retter BEGGE kaldere: dashboard-nudgen og RaceCentrePage's complete-flag som RaceCentreCard.jsx:146-150 tegner.
  RaceCentreCard faar en tredje copy-gren ved siden af lineupReady/lineupIncomplete: capped-tilfaeldet.
- frontend/src/lib/raceHubLogic.js:13 computeColumnStatus naar "full" ved selected >= reachable, ikke kun ved target. Kolonnens pille forsvinder alligevel til fordel for baren.
LOESES IKKE, og det skal ikke lade som om:
- backend/lib/selectionWarningSweep.js:101 er serverside og kender kun entryCountByTeam og targetSize. reachable kraever pr. hold og pr. loeb at traekke bundne ryttere fra, altsaa en ny binding-opslagsvej i sweepet. Det er en backend-slice. Indtil den ligger, sender notifikations-sweepet stadig "trup mangler" til hold der ikke KAN fylde. Navngivet foelge-issue i samme PR-tekst, ikke en fodnote.

PREVIEW: frontend/src/preview/seedData.js SEED_SELECTION har hverken bound_riders eller et hold der ikke kan fylde. Tilfoej fem bound_riders med shared_days og kind, ellers kan ejeren kun se den rolige tilstand paa preview og aldrig den tilstand hele arbejdet handler om.

=====================================================================
I. COPY. EN foerst, DA under. Ingen em-dash nogen steder.
=====================================================================

frontend/public/locales/{en,da}/races.json

selection.countBar.label
  EN: Places
  DA: Pladser

selection.countBar.open
  EN: {count, plural, one {1 place open} other {# places open}}
  DA: {count, plural, one {1 plads ledig} other {# pladser ledige}}

selection.countBar.free
  EN: {count} free
  DA: {count} frie

selection.countBar.clashing
  EN: {count} in other races
  DA: {count} i andre løb

selection.countBar.injured
  EN: {count} injured
  DA: {count} skadede

Sammensat ledger-linje, spillerens eget tilfaelde, separator er midtpunkt:
  EN: 4 free · 23 in other races · 2 injured
  DA: 4 frie · 23 i andre løb · 2 skadede

selection.countBar.showClashes
  EN: Show clashes
  DA: Vis konflikter

selection.countBar.overfull
  EN: {count, plural, one {1 too many. Remove a rider before you save.} other {# too many. Remove riders before you save.}}
  DA: {count, plural, one {1 for mange. Fjern en rytter før du gemmer.} other {# for mange. Fjern ryttere før du gemmer.}}

selection.countBar.withdrawn
  EN: Withdrawn
  DA: Afmeldt

selection.countBar.locked
  EN: Lineup locked
  DA: Opstilling låst

selection.countBar.aria
  EN: {picked} of {max} places filled, {unreachable} unavailable
  DA: {picked} af {max} pladser fyldt, {unreachable} utilgængelige

clashes.title
  EN: Riders not free for this race
  DA: Ryttere der ikke er frie til dette løb

clashes.rule
  EN: A rider can ride only one race per race day.
  DA: En rytter kan kun køre ét løb pr. løbsdag.

clashes.remove
  EN: Remove from {race}
  DA: Fjern fra {race}

clashes.open
  EN: Open {race}
  DA: Åbn {race}

clashes.releasable
  EN: Assistant's pick. Saving here frees him.
  DA: Assistentens valg. Gemmer du her, frigives han.

clashes.lockedRace
  EN: Lineup locked
  DA: Opstilling låst

clashes.removed
  EN: Removed
  DA: Fjernet

clashes.undo
  EN: Undo
  DA: Fortryd

clashes.failed
  EN: Could not remove. Try again.
  DA: Kunne ikke fjerne. Prøv igen.

clashes.showAll
  EN: Show all {count}
  DA: Vis alle {count}

GENBRUGES UAENDRET, verificeret at de findes:
  selection.boundIn = "Riding {race}"
  racehub.raceDay   = "Race day {day}"
  racehub.raceDays  = "Race days {start}-{end}"

Det ejer-godkendte moenster fra Z1-spec §10 staar ordret i raekken:
  "Lozano, M." | "Tour des Émirats" | "RACE DAYS 11-12" | [Remove from Tour des Émirats]
Aldrig "This rider is not available". Altid HVEM, HVILKET LOEB, HVILKE DAGE, HVAD DU KAN GOERE.

SLETTES:
- selection.errors.selection_insufficient_riders i begge sprog. Efter fixet emitteres koden hverken af klient eller server. Teksten "Withdraw from this race or sign free agents" er desuden forkert raad naar aarsagen er et loebsdags-sammenstoed.
- racehub.status.full / understaffed / overfull / withdrawn / locked, alle fem i begge sprog, sammen med STATUS_CLASS. "understaffed" i bg-cz-warning-bg forsvinder helt. En trup der ikke KAN fyldes har aldrig vaeret en advarsel.

ROERES IKKE:
- selection.errors.selection_wrong_size ("You can pick at most {max} riders."). Den bliver foerst SAND naar den kun vises for "for mange", og det er praecis hvad fixet goer.
- selection.subtitle (races.json). Den siger allerede "You can save a partial team, and your assistant fields the rest when the race runs. No penalty." Den var den eneste streng der fortalte sandheden. Nu holder resten af fladen op med at modsige den.

RETTES, help.json, sti raceSelection.what.text, linje 1155 i begge sprog:
  Staar i dag, EN: "Every race needs a complete lineup ... You can't save a partial squad."
  Staar i dag, DA: "Hvert løb kræver en komplet opstilling ... Du kan ikke gemme en delvis trup."
  NY EN: "Most races have 6 places, the bigger World Tour races and Monuments 7, Grand Tours 8. Open the race page and use the Team selection panel. You can save a partial team: the places you leave open are filled from your free riders when the race runs, and there is no penalty. A rider can ride only one race per race day, so a rider already committed to an overlapping race is not free for this one. To sit a race out, withdraw from it."
  NY DA: "De fleste løb har 6 pladser, de større World Tour-løb og Monumenter 7, Grand Tours 8. Gå til løbssiden og brug panelet Holdudtagelse. Du kan gemme en delvis trup: de pladser du lader stå åbne, fyldes fra dine ledige ryttere når løbet køres, og der er ingen straf. En rytter kan kun køre ét løb pr. løbsdag, så en rytter der allerede er bundet i et overlappende løb, er ikke fri til dette. Vil du stå over et løb, så afmeld dig det."

FUND UNDERVEJS, som skal med i samme PR: help.json modsiger SIG SELV i samme fil. Linje 1155 siger "Du kan ikke gemme en delvis trup", mens linje 1214 i samme fil allerede siger "Du kan også gemme en delvis trup: de pladser du lader stå åbne, fyldes automatisk fra dine ledige ryttere når løbet køres". Linje 1214 er sand og bliver staaende. Linje 1155 var den forkerte.

RETTES OGSAA, mobil-hullet: frontend/src/components/racehub/AvailableRidersPool.jsx:76 baerer i dag title={t("racehub.boundNamed", { race })}, altsaa "Locked · racing in {race}", som er usynlig paa en telefon. Loebsnavnet skal ud af title-attributtet og ind i synlig tekst. Ingen information i hover nogen steder.

PatchNotesPage.jsx, obligatorisk ved brugerrettet aendring:
  EN: Team selection now shows how many riders are actually free for a race, names the races holding the rest, and lets you save a partial team.
  DA: Holdudtagelse viser nu hvor mange ryttere der reelt er frie til et løb, navngiver de løb der holder resten, og lader dig gemme en delvis trup.

=====================================================================
J. MOBIL VED 375px
=====================================================================

375px er indregnet foerst, ikke bagefter. Samme komponent, samme markup, samme datavej paa alle bredder. Forskellen er udelukkende flex-col mod sm:flex-row og w-full mod sm:w-auto. Ingen mobil-only komponent, intet desktop-only signal.

SELECTIONCOUNTBAR:
Panelets header er allerede flex flex-col sm:flex-row (linje 337), saa baren falder ned under titelblokken, venstrestillet, og med sm:items-start topper den mod titlen i stedet for at flyde midt i.
Beholderen har px-4, altsaa 343px indhold (i RaceColumn px-3, altsaa 319px). Zone A 112px plus gap 12px plus zone B 61px = 185px, saa tal, ord og meter bliver PAA foerste linje i begge tilfaelde.
Zone C har basis-full sm:basis-auto og falder ned paa linje to i fuld bredde UDEN truncate (sm:truncate foerst fra 640px), saa grunden kan bryde over to linjer i stedet for at blive klippet. Det er den ene ting der skal vaere fuldt laesbar paa telefonen.
"Show clashes" er inline-flex min-h-[24px] py-1 med ChevronRightIcon size 12, altsaa tap-maal >= 24px, selvom teksten er 12px.
Barens ekstra hoejde paa mobil: 18px naar zone C er i brug, 0px i tilstand 1.

CONFLICTPANEL, under md. Sekundaere tekstkolonner folder ind i navnecellens subline, ordret T2's mobil-regel:
<li className="md:hidden px-3 py-3 border-t border-cz-border first:border-t-0">
  <p className="truncate text-[13.5px] font-medium text-cz-1">{riderName}</p>
  <p className="mt-0.5 truncate font-data text-3xs uppercase tracking-[.06em] tabular-nums text-cz-3">
    {blockingRaceName} · {dayLabel}
  </p>
  <div className="mt-2">
    <Button variant="secondary" size="sm" fullWidth className="min-h-[32px]">{t("clashes.remove", { race })}</Button>
  </div>
</li>
Knappen er fuld bredde og min-h-[32px], klart over 24px. Loebsnavnet er IKKE et link paa mobil. Det ville vaere et 11px tap-maal inde i en linje. Loebet aabnes via knappen eller via boardets egen kolonne.
Loebsnavnet faar truncate i en min-w-0-boks, saa det forkortes FOER dagene gaar tabt. Dagene er det uerstattelige.
Raekkehoejde ca. 84px. Tre konflikter = 252px plus 34px hoved. Cap'en paa fem raekker plus "Show all {n}" holder vaerste tilfaelde paa ca. 454px, og der er ingen indre scroll-container og intet vandret scroll noget sted.
Moensterreferencen er frontend/src/components/planner/MobileLanes.jsx: stakket, hver raekke er ét maal, intet vandret scroll, ingen drag, alt tap-maal >= 24px.

=====================================================================
K. HVAD DET KOSTER
=====================================================================

HOEJDE. RaceSelectionPanels header: 0px paa desktop, baren erstatter et span i samme raekke. Plus 18px paa mobil naar zone C er i brug. ConflictPanel som baand: 0px i normaltilfaeldet (den renderer null). Naar den fyrer: 34px hoved plus 36px pr. raekke, ca. 142px ved tre konflikter, over folden praecis naar den har noget at sige. RaceColumn: status-pillen (18px plus mt-2 = 26px) slettes, bar-raekken laegger ca. 30px. Netto ca. plus 4px pr. kolonne.

KOMPLEKSITET IND: 2 komponenter, 1 ren lib-fil, 1 testfil, ca. 19 i18n-noegler i to sprog, to felter i en eksisterende backend-handler.
KOMPLEKSITET UD i samme PR: STATUS_CLASS-mappet plus fem i18n-noegler i to sprog, selection.count-spannet, requireFull plus availableCount plus hele kanFyldeTruppen-ventilen i raceSelectionLogic.js og de to argumenter paa hvert af de to kaldesteder, det doede availableCount-argument i backendens PUT-handler, selection_insufficient_riders i to sprog, og to rounded-lg der bliver rounded-cz (5px er den eneste flade-radius i systemet). Nettet i linjer er taet paa nul.

VERIFIKATION: TIER FULL. Delt lib (selectionCapacity, raceSelectionLogic, raceSquadSelectionStatus, raceHubLogic), i18n i to sprog og delte komponenter paa tre flader. Fuld lokal suite plus npm run lint plus node --test i frontend/.

## Ejer-spoergsmaal
- 1. Skal knappen i ConflictPanel skrive eller hoppe, naar den staar i ENKELT-loebs-panelet? 'Remove from Tour des Émirats' aendrer et ANDET loebs trup fra en side der ikke er det loeb. Paa dagsboardet og i Z1 er begge loeb paa skaermen, og knappen er en ren kladde-operation. I panelet er den en mutation paa afstand. A: knappen skriver (et-kliks-fix, inline Undo i raekken, aldrig en toast). B: knappen bliver 'Open Tour des Émirats', altsaa et hop. Anbefaling: A, fordi konflikten er vist FOER klikket og Undo staar i raekken, men det er dit kald og ikke mit.
- 2. Boardets status-pille forsvinder. RaceColumn.jsx mister STATUS_CLASS og de fem racehub.status-noegler, herunder den rav-farvede 'understaffed' som i dag staar permanent paa 44 af 46 hold i D4. Baren erstatter den. Det er en synlig aendring paa en flade du har godkendt, og UI-PR'er merges ikke uden dit visuelle go. Vil du se den paa preview foer merge?
- 3. ConflictPanel monteres ogsaa i Z1, og PLANNING_CENTER_RULES §3 siger at en flade der kun viser den ene akse lyver om den anden. Raekkens dag-celle viser i dag kun loebsdagen (sandheden). Skal den ogsaa baere kalenderdatoen (rammen) naar den staar i Z1, eller er loebsdagen alene nok i en konflikt-raekke hvor loebsnavnet linker videre til datoen?


---
