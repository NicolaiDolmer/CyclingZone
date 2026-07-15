# UI/UX-audit 15/7 — plan + issue-kobling til MASTERPLAN

> **Status:** research færdig, ejer-gate passeret (audit + plan, stop før kode). Ingen kode ændret.
> **Kilder:** [audit](../../audits/2026-07-15-ui-ux-audit.md) (rangering, 5 greb, benchmark) · board-arkæologi 15/7 (denne fil, §4).
> **Kobling:** dette er input til [#2468](https://github.com/NicolaiDolmer/CyclingZone/issues/2468) (masterplan-konsolidering). Rækkefølgen nedenfor er et **forslag** — MASTERPLAN er rækkefølge-SSOT og ejer-godkendt, så omprioritering kræver ejer-go.

## 1 · Hvad auditten fandt

Design-systemet er ikke problemet: **egenart 4/5 på alle otte flade-klynger**. [20/6-auditten](../../audits/2026-06-20-design-quality-audit.md) holder, token-drift er stort set lukket.

Problemet er tre kontrakter som koden **selv definerer korrekt**, men som UI-laget springer over:

| Kontrakt | Defineret i | Brudt |
|---|---|---|
| Tabeller scroller | `ui/Table.jsx:4-12` (altid `overflow-x-auto`) | 27 player-facing filer bruger rå `<table>` |
| Handlinger rapporterer fejl | 6 hooks returnerer `{ok, error}` | Flere kaldesteder ignorerer returværdien |
| Design-tokens | `cz-*` + CI-gate `lint-ui-slop.mjs` | Holder |

Samme diagnose som 20/6 stillede om design-tokens, nu på mobil og fejlhåndtering. **Kuren er den samme: håndhæv kontrakten i CI.**

### Nøgletal (prod, 15/7)
- DAU 34 / WAU 43 / MAU 82 (88 all-time). **DAU/MAU = 41% — stærkt. Pas på det.**
- **Mobil = 54,9% af app-besøg** (693 mod 570), ikke kun landing.
- Tragt: 78 draftede hold → 56 satte træning → 42 bød → **22 så et løbsresultat**.
- Auktion: 803 visninger / 28 brugere → **16 bud / 10 brugere**.

## 2 · Issues oprettet 15/7

| Issue | Greb | Prio | Omfang |
|---|---|---|---|
| [#2463](https://github.com/NicolaiDolmer/CyclingZone/issues/2463) | Board-generalprøve før sæsonskiftet | high | S |
| [#2464](https://github.com/NicolaiDolmer/CyclingZone/issues/2464) | Auktion: gør købet vurderbart | high | S-M |
| [#2465](https://github.com/NicolaiDolmer/CyclingZone/issues/2465) | Feedback-kontrakten (tavse fejl + rolle-forklaring) | med | M |
| [#2466](https://github.com/NicolaiDolmer/CyclingZone/issues/2466) | Resultat-push ("Sådan gik det for dit hold") | high | M |
| [#2467](https://github.com/NicolaiDolmer/CyclingZone/issues/2467) | Småfund (typo, founder-CTA, deep-links, alert(), survey-støj) | low | S |
| [#2468](https://github.com/NicolaiDolmer/CyclingZone/issues/2468) | **Masterplan-konsolidering** (ejer-bestilt) | high | M |
| [#2469](https://github.com/NicolaiDolmer/CyclingZone/issues/2469) | Board context-drift (4. sti + auto-accept tradeoff) | high | M |

**Eksisterende issues beriget med audit-evidens** (ikke duplikeret): [#1602](https://github.com/NicolaiDolmer/CyclingZone/issues/1602) (mobil-epic — fik de 2 P0'er + 54,9%-tallet) · [#2445](https://github.com/NicolaiDolmer/CyclingZone/issues/2445) · [#2446](https://github.com/NicolaiDolmer/CyclingZone/issues/2446) · [#2355](https://github.com/NicolaiDolmer/CyclingZone/issues/2355) (S6 why) · [#955](https://github.com/NicolaiDolmer/CyclingZone/issues/955) (board UI-rework — bør vente).

> **Disciplin-note:** auditten genopdagede ting der allerede stod skrevet. #1602 skrev *"duplikeret i 27 filer"* allerede 20/6 — samme tal. Det er selve begrundelsen for #2468.

## 3 · De to P0'er (hører under #1602)

- **StageStripe klipper Grand Tours.** `components/race/StageStripe.jsx:20` — `flex gap-1.5` uden `overflow-x-auto`, knapper `flex-1 min-w-0`. 21 etaper på 375px = ~15px/knap, hvoraf 12px er padding. Prod: 3 løb har 21 etaper (Tour, Giro, Vuelta). Race er den mest brugte flade.
- **Race Hub-brættets tap-mål.** `components/racehub/RaceColumn.jsx:143-145` — fjern-knap ~16-20×24px. Hver holdudtagelse.

## 4 · Board-arkæologien (ejer-hypotese 15/7)

**Hypotesen: rigtig fornemmelse, forkert mekanisme.** Alle syv mistænkte dublet-par afkræftet. Én tilfredsheds-formel (`boardEvaluation.js:116`), én wizard, én mål-taksonomi. `boardEngine.js` = 115 linjer ren facade, 0 logik. Import-grafen acyklisk. Backend splittet 25/4 (`1a7b8808`), disciplinen holdt i 109 commits.

**Den ægte drift er fan-in:** flere kaldesteder håndbygger hver sit `context` til samme motor. Allerede bidt i prod (#2308 `0baaca82`: *"ens beregnings-kontekst i status/weekend/season-end"*, 4 bugs). **#2308 rettede tre stier. Der er fire** — `/board/request` (`api.js:10418-10447`) mangler `isFinalSeason` + `divisionManagerCount`. Detaljer + to bugs: #2469.

**Hvorfor det føles rodet:** backend blev splittet, `BoardPage.jsx` blev aldrig — den er vokset til 3.061 LOC med 40+ `useState`. Det er den fil ejeren ser. **Slå ikke "dubletterne" sammen** — det ville ødelægge sund arkitektur.

## 5 · Foreslået rækkefølge (skal valideres i #2468)

1. **#2463** board-generalprøve — eneste deadline vi ikke styrer (sæson 1 på **løbsdag 16/27**; 43 spillere rammer kæden samtidigt ved sæsonskifte). Gates sammen med [#2361](https://github.com/NicolaiDolmer/CyclingZone/issues/2361).
2. **#2469** board context-drift — live korrekthedsfejl, samme klasse som verificeret prod-afvigelse.
3. **#2466** resultat-push — største hul i tragten (22/88), `buildRaceRecap()` findes allerede.
4. **#2464** auktion — billigst, målbar effekt (`market_value` hentes allerede på `AuctionsPage.jsx:783`, vises aldrig).
5. **#2465** feedback-kontrakten.
6. **#1602** mobil-kontrakten — størst, skæres i slices; P0'erne først.

Efter sæsonskiftet: #955 (board UI-rework) + BoardPage-split.

## 6 · Hvad auditten ikke kunne afgøre

- **Er træning elsket eller friktion?** `training_focus_set` fyrer kun ved success (`useTraining.js:79`) og tæller klik, ikke beslutninger. Tavse fejl er usynlige i data. **Ikke bevist.** Split eventet først (del af #2465).
- **Bouncer mobil pga. UX eller intent?** Vi ser frafaldet, ikke årsagen.
- **Mock vs. prod:** screenshots er taget mod `VITE_PREVIEW_MOCK` og viser gated tilstande der ikke matcher prod. Layout-fund holder; data-fund er verificeret separat mod prod.
- `seasons.race_days_total`=60 vs. faktisk 28 game-days; `race_days_completed`=456. Ser stale ud (#2467).
