# Trænings-polish: anticipation → payoff i det daglige loop — design (#1305 / #1136)

> **Status: DESIGN — ejer-godkendte forks 2026-06-18 (AskUserQuestion + mockup-session).** Klar til writing-plans → implementering.
> Polerer det eksisterende, kode-færdige daglige trænings-loop (#1305) så fremskridt bliver *synligt* og gennembrud bliver et *moment*. Ingen ny motor — kun feedback-laget. Primært frontend.
> Parent: #1136 (progression). Berørt flade: `frontend/src/pages/TrainingPage.jsx`.

## 1. Problem & kontekst (verificeret i kode 2026-06-18)

Det daglige trænings-loop er fuldt bygget: programmer (fokus + intensitet), ét-kliks "Train today (+25% boost)", form/træthed-bars, og en rapport efter kørsel ([TrainingPage.jsx](../../../frontend/src/pages/TrainingPage.jsx)). Men feedback-laget er svagt på tre konkrete punkter:

1. **Ingen anticipation.** `useTraining` henter `ability_progress` (hvor tæt hver evne er på næste +1) som `progress`, men **det vises ingen steder i UI'et.** Spilleren kan ikke se en rytter nærme sig et gennembrud — kun gevinster der allerede er sket.
2. **Intet payoff-moment.** Et +1-gennembrud vises som flad tekst "+1 climbing" i en tabel-celle ([:316](../../../frontend/src/pages/TrainingPage.jsx#L316)) — visuelt identisk med en linje uden gevinst. Det største øjeblik i progressionen er usynligt.
3. **Kontekstløst rå-tal.** Rapporten viser en rå `score` ([:314](../../../frontend/src/pages/TrainingPage.jsx#L314)) uden skala — spilleren ved ikke hvad der er godt.

(Bemærk: "over/under dagsform" findes allerede som ▲/▼ i rapporten — det er *ikke* et hul, og bevares.)

## 2. Ejer-godkendte beslutninger (2026-06-18)

1. **Kerne-følelse = begge koblet** — anticipation (progress mod næste +1) → payoff (markant beat når en bar fyldes). Den fulde retention-løkke, ikke kun den ene halvdel.
2. **Progress-baren lever i både roster + rapport** — altid synlig i roster-bordet (så man kan planlægge fokus mod en rytter tæt på gennembrud) og opdateret i rapporten. Data findes begge steder.
3. **Rå score fjernes** fra rapporten — erstattes af meningsfulde resultater (progress + dagsform + gevinst).

## 3. Design (de fem elementer)

### 3.1 Dags-opsummering (payoff, holdniveau)
En stribe på tre tal øverst i rapporten: **Riders trained** (x / total), **Breakthroughs** (antal +1 i dag), **In peak form**. Det giver dagens kørsel et "her er hvad der skete"-overblik før detaljerne.

### 3.2 Progress-kolonne i roster (anticipation)
Ny kolonne i roster-bordet: fokus-evnens vej mod næste +1, som en bar + evne-navn (+ % ved hover/kompakt). Baren skifter til success-farve ved ~90%+ ("tæt på gennembrud" → "1% to go"). Kobler valget (fokus) direkte til feedbacken. Når rytteren intet fokus har sat, vises en neutral tom-tilstand.

### 3.3 Progress i rapporten (anticipation efter kørsel)
Samme bar i rapport-rækken, så man efter dagens klik ser hvor tæt hver rytter nu er — og hvem der lige ramte 100%.

### 3.4 Gennembrud fremhævet (payoff, rytterniveau)
Rækker hvor en evne ramte +1: subtil success-tint + venstre-accent (border-radius 0 på single-side-accent) + gevinsten vist som det **faktiske tal-spring** `71 → 72` i stedet for "+1 climbing". Det gør gennembruddet til et synligt øjeblik uden slop.

### 3.5 Resultat-kolonne (erstatter rå score)
Dagsform (▲ Sharp / ▼ Flat day) + relevante delta'er (recovery: "−9 fatigue"; skade-badge). Editorial, ikke et nøgent tal.

## 4. Datakilder (hvad findes vs. ny berigelse)

- **Roster-progress:** `progress[riderId]?.[focusAbility]` fra `useTraining` — findes. Beregnes frontend-side fra plan-fokus + progress.
- **Rapport-progress + dags-opsummering:** `todayRun.report.riders[].gains` + condition findes. Breakthroughs = antal rækker med gains. Peak form = afledes af form-tærskel.
- **Tal-spring `71 → 72`:** rapporten har i dag kun `gains` (ability → n), ikke efter-værdien. **Lille backend-berigelse:** rapport-rækken skal inkludere den resulterende evne-værdi pr. gevinst (engine'en kender den allerede), så UI'et kan vise det faktiske spring frem for "+1". Ellers fallback til "+1 climbing".
- **Roster abilities:** roster loader i dag kun `id, firstname, lastname`. Progress kommer fra `useTraining`-condition/progress, ikke fra riders-tabellen — så ingen ekstra rider-query nødvendig.

## 5. Seams i eksisterende kode

- `frontend/src/pages/TrainingPage.jsx` — roster-tabel (ny progress-kolonne), rapport-tabel (progress + breakthrough-styling + opsummerings-stribe, fjern score-kolonne), `MiniBar`-komponenten kan genbruges/udvides til progress.
- `frontend/src/lib/useTraining.js` — `progress` eksponeres allerede; bekræft formen (`{[riderId]: {[ability]: 0..1}}`).
- `frontend/public/locales/{en,da}/training.json` — nye keys (summary-labels, "X to go", breakthrough, fjern/omdøb score). EN-først/DA, ingen em-dash.
- **Backend (lille):** dagligt trænings-rapport-output (`dailyTrainingEngine.js` / report-builder) — tilføj resulterende evne-værdi pr. gevinst i report-rækken.
- `frontend/src/pages/RiderStatsPage.jsx` — *out of scope her* (ejer valgte roster + rapport; profil-konsistens er en mulig fast-follow).

## 6. Design-noter (anti-AI-slop)

Følg det etablerede sprog: fladt, editorial, høj detalje, ægte cykel-data. **Ingen** konfetti/glow/emoji/gradient på gennembrud — payoff'et er en rolig success-tint + det ærlige tal-spring, ikke en animation-fest. Tabler-outline-ikoner eller de eksisterende ▲/▼. Sentence case. Matcher mockup'et fra 18/6-sessionen.

## 7. Test-strategi

- **Frontend (`node --test` i `frontend/`):** progress-beregning fra fokus + progress-map; breakthrough-detektion (gain > 0); dags-opsummerings-tal; tom-tilstand uden fokus; score-kolonne fjernet (regression).
- **Playwright:** rapport renderer med progress-barer + fremhævet gennembrud; roster viser progress-kolonne. **Refresh core-smoke snapshots (alle 3 projekter, win32)** — dette er en visuel ændring af træningssiden.
- **Backend (`node --test`):** rapport-rækken inkluderer resulterende evne-værdi pr. gevinst (hvis berigelsen laves).
- **CI-gate-sæt** (verify-local + eslint + i18n-leak + tone-em-dash + warning-budget) før PR. Patch notes + help.json (en+da) opdateres (brugerrettet ændring).

## 8. Out of scope (senere)

- Fuld progress-på-alle-evner på RiderStatsPage (mulig fast-follow — ejer valgte roster + rapport).
- Animationer / fejrings-effekter (bevidst fravalgt — anti-slop).
- Ændringer i selve trænings-matematikken (kun feedback-laget røres).

## 9. Implementerings-rækkefølge (til writing-plans)

1. (Hvis valgt) Backend: berig rapport-række med resulterende evne-værdi pr. gevinst (+ test).
2. Frontend-helper: udregn fokus-evne-progress + breakthrough-flag + dags-opsummering (+ unit-tests).
3. Roster-tabel: progress-kolonne (+ tom-tilstand, ~90%-farveskift).
4. Rapport: opsummerings-stribe + progress + breakthrough-styling + fjern score.
5. i18n (en+da) + help.json + patch notes.
6. Playwright + snapshot-refresh (alle 3 projekter) + fuld CI-gate.

## 10. Åbne punkter

- **Tal-spring vs. "+1":** kræver den lille backend-berigelse (§4). Bekræft at det er værd at røre backend, ellers ship med "+1 climbing" stylet som breakthrough.
- **"Peak form"-tærskel** i dags-opsummeringen: hvilken form-værdi tæller som peak? (Lille konstant — sæt ved implementering, evt. genbrug eksisterende form-tærskel.)
