# Dashboardets regler — SSOT

> **Læs denne FØR du tilføjer, flytter eller ændrer bredden på noget som helst på `/dashboard`.**
>
> Anledningen: 25/8 blev et nyt kort lagt ind i den øvre fuldbredde-stak uden at tjekke, at der allerede fandtes et to-kolonne-grid, og uden at vide at halvdelen af rækkefølgen er afgjort i tidligere issues. Ejer-reaktion: *"Det er da en tudegrim rækkefølge"* og *"lad venligst være med at lave moduler til dashboardet, som kun går fra kant til kant."* Rækkefølgen var ikke dokumenteret noget sted — den lå spredt i kodekommentarer. Denne fil er kilden.

---

## 0. De to regler der oftest brydes

1. **Fuld bredde er undtagelsen, ikke standarden.** Dashboardet har et `grid lg:grid-cols-2 gap-[14px]`. Nye moduler hører som udgangspunkt derned i halv bredde. Fuld bredde kræver en grund, der kan skrives ned — en strip der spænder hele fladen, eller et modul hvis indhold ikke kan læses på halv bredde.
2. **Rækkefølgen i toppen er ejer-besluttet, ikke tilfældig.** Flere placeringer er afgjort i konkrete issues (§2). Flyt dem ikke uden at få et ja — og opdatér kodekommentaren, hvis en beslutning omgøres, så den ikke lyver bagefter.

---

## 1. Hvad tallene siger (Clarity, 19.-25. august 2026)

| Måling | Værdi | Konsekvens |
|---|---|---|
| Gennemsnitlig scroll-dybde | **94,65 %** | Intet gemmer sig nederst. Folk ser næsten hele siden, så rækkefølge handler om *hvor langt de skal scrolle*, ikke om hvad der bliver set |
| Mest klikkede fra dashboardet | Mit Hold 150 · Indbakke 131 · Planlægning 83 · Daglig træning 48 | Dashboardet er en **trampolin**, ikke en destination. De fire mest klikkede ting er links væk fra siden |
| Døde klik på holdnavnet | **470** mod 123 virksomme | Se [#4252](https://github.com/NicolaiDolmer/CyclingZone/issues/4252) |

**Den vigtigste konsekvens af de 94,65 %:** flere fuldbredde-moduler gør ikke noget mere synligt — det gør bare siden længere. Medicinen mod en rodet flade er parring i to kolonner, ikke omrokering.

---

## 2. Placeringer med ejer-historik — flyt aldrig uden nyt ja

| Modul | Regel | Kilde |
|---|---|---|
| Trup- og kontrakt-advarsler | **Allerøverst**, over dagens etaper | Ejer 25/8 — de eneste moduler der koster point hvis de overses |
| `TodayStagesStrip` | Øverst i indholdsflowet, kun advarsler må stå over | [#3915](https://github.com/NicolaiDolmer/CyclingZone/issues/3915), justeret af ejer 25/8 |
| `MyLatestResultCard` | Første-løbs-øjeblikket ejer toppen indtil resultatet er set | [#3310](https://github.com/NicolaiDolmer/CyclingZone/issues/3310) |
| `OnboardingProgressCard` | Over "Næste træk" | [#2288 B](https://github.com/NicolaiDolmer/CyclingZone/issues/2288) |
| `SeasonWrapNudgeCard` | Før "Næste træk" ved sæson-lukning | [#2752](https://github.com/NicolaiDolmer/CyclingZone/issues/2752) / [#2361](https://github.com/NicolaiDolmer/CyclingZone/issues/2361) |
| `SeasonStartGuideCard` | Over "Næste træk" ved sæsonstart | [#2925](https://github.com/NicolaiDolmer/CyclingZone/issues/2925) |

---

## 3. Layout-kontrakten

- **Én gold primary-knap pr. view**, styret af `computeDashboardGoldCta`. Et nyt modul må ikke tage den.
- **Maks én nudge-banner ad gangen.** Discord-nudgen er den ene i dag. Nye moduler bygges som `Card`, ikke som banner, så de ikke tælles med i den regel.
- **Betingede moduler må ikke efterlade tomme grid-celler.** Er et par sat op, og det ene modul er skjult, skal cellen kollapse.
- **Alt kan slås fra.** Nye moduler registreres i `DashboardCustomizeMenu` ([#1005](https://github.com/NicolaiDolmer/CyclingZone/issues/1005)) efter det eksisterende mønster.
- **Et modul må aldrig kunne vælte dashboardet.** Fejler dets datakald, forsvinder modulet stille — dashboardet viser ikke en fejltilstand på grund af et sekundært kort.
- Design i øvrigt: `docs/design/PAGE_TEMPLATES.md`. Hairline-borders, 5px radius, tabular figures, stroke-ikoner, ingen emoji, farver kun via cz-tokens.

---

## 4. Modulrækkefølgen (efter omlægningen 25/8, PR [#4249](https://github.com/NicolaiDolmer/CyclingZone/pull/4249))

**Øvre del.** Advarsler · Dagens etaper (fuld) · [Seneste resultat | Næste træk] · [Holdudtagelse | Sæsonstatus] · betingede engangskort (Udviklings-overgang, Onboarding-progress, Onboarding fuldført, Sæson slut, **Tilmeld næste sæson** (#4592/#452, mellem Sæson slut og Sæsonstart-guide — flag-gated, off som default, ingen dismiss med vilje jf. §5), Sæsonstart-guide, Første sejr, Discord-nudge).

**To-kolonne-gridet.** [Auktioner | Transfers] · [Løb | From the forum] · [Stilling/pulje | Økonomi-prognose] · [Seneste resultater | Rytter-rangliste] · [Bestyrelse | …].

Bestyrelsen mistede sin `lg:col-span-2` i omlægningen: /board har 959 sessions mod Mit Holds 5.955, så den fyldte mest og blev brugt mindst.

**23 moduler i alt. Ingen blev fjernet i omlægningen** — 9 flyttede plads, 6 gik fra fuld til halv bredde, og ét (forum-kortet) var nyt.

---

## 5. Tjekliste før du tilføjer et modul

1. Kan det være i halv bredde? Hvis ja, hører det i gridet. Hvis nej, skriv hvorfor i kodekommentaren.
2. Rører placeringen en af rækkerne i §2? Så skal ejeren spørges først.
3. Er det registreret i `DashboardCustomizeMenu`?
4. Forsvinder det stille, hvis dets datakald fejler?
5. Tager det viewets guld-knap eller nudge-slot? Det må det ikke.
6. Er dashboard-snapshottet opdateret i alle tre Playwright-projekter?
