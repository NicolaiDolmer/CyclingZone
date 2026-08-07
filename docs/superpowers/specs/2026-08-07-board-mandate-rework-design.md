# Bestyrelses-rework: "Mandatet" — design-spec

**Status:** Udkast til ejer-review (brainstorm-session 7/8-2026, ejer valgte Retning B + forhandlingsmodel "2+1").
**Supersederer:** Epic [#955](https://github.com/NicolaiDolmer/CyclingZone/issues/955) (UI-rework til faner) — fanerne udgår helt i denne model.
**Grundlag:** 7-spors audit 7/8 (frontend, backend, GitHub, Discord, docs, konkurrenter, prod-verifikation). Nøglefund refereret inline.

## 1. Problem (evidens-forankret)

- Mekanikken er genre-førende (juni-audit: spildesign 4/5), men overfladen begraver den: `/board` har appens højeste dead-click-tæthed (0,88/session vs. dashboard 0,085, #2227), og forhandlings-wizarden kan kræve 20+ klik ved multi-fornyelse uden exit.
- Spillerklagerne handler om læsbarhed, ikke dybde: "0/8?" (#3494), "dashboard 65 % vs. board 67 %" (#1830), "3×100 % = 56 %", skjult renown driver dårlige handler (#2723).
- Op til 3 parallelle planer med hver sit tilfredshedstal er rod-årsagen til en tilbagevendende fejlklasse (kontekst-drift/tæller-mismatch: #2469→#2592→#2596, #3095, #3141, #3144, #3494 — mindst 8 forekomster siden maj).
- Living World-doktrinen (ejer-godkendt, nyere end S-02) kræver: "én årlig strategisamtale, 1-2 sæson-events, færre samtidige mål".
- Konkurrenternes svaghed = vores mulighed: FM ("impossible to please the board") og PCM (uforklarede tillidsfald) fejler begge på gennemsigtighed. Verdens bedste bestyrelse er den, hvor **hver bevægelse har en kvittering**.

## 2. Designprincipper (bindende for alle slices)

1. **Én relation.** Ét tillidstal (0-100) pr. hold. Aldrig to tal for samme ting to steder.
2. **Kvittering for alt.** Hver tillidsbevægelse, hvert måls tæller: hvad tælles, hvornår sidst opdateret, hvem i bestyrelsen vægter det. Genbruger `board_satisfaction_events`.
3. **Personer i front.** 5 navngivne medlemmer (nordisk navnepulje); hvert mål ejes af et medlem; formanden taler; formandsskifte er et narrativt beat.
4. **≤2 klik.** Enhver handling på bestyrelsessiden: maks 2 klik. Årsmødets hurtigste vej ("acceptér alt + underskriv"): 2 klik.
5. **Uændrede grundregler:** aldrig fyring; blød kalibrering (ejer 7/7, #2237); styrke straffes aldrig; konsekvens-lagene består; manager-only.
6. **Design-system:** T1-skabelon, `rounded-cz`, stroke-ikoner (emoji-portrætter udgår), én gold-knap pr. view, tabular figures, EN først/DA under, ingen em-dash i player-copy.

## 3. Ny model

### 3.1 Datamodel (mål-tilstand)

- **Bestyrelsesrelation** (pr. hold, erstatter 3 × `board_profiles`-satisfaction): `confidence` 0-100 + 4 kategoriscorer (results/economy/identity/ranking — eksisterende vægte og evaluerings-motor genbruges).
- **Mandat** (1-årigt, 3-5 mål): genereres af eksisterende `generateBoardGoals` (fokus × DNA × dynamisk kalibrering). Forhandles på årsmødet.
- **Vision** (DNA-forankret, 5-årig arc): 3/5-års-målene bliver **milepæle** med mål-sæson (fx "S4: monument-podium"). Evalueres i deres mål-sæson; påvirker confidence dér — ikke løbende parallelle kontrakter.
- **Konsekvens-lag 1-6:** uændrede tærskler, nu mod det ENE confidence-tal.
- **Sponsor-vækstmål** re-pointes til ægte kontrakt-økonomi (`sponsor_contracts`-udbetalinger pr. sæson) — aldrig `teams.sponsor_income` (dødt felt, #3494).

### 3.2 Årsmødet (erstatter wizard + renew + sekventiel onboarding)

- Ét fuldskærms-møde pr. sæson: fokusvalg → foreslået mandat → **maks 2 mål justeres** (modtilbud: Easier / Keep / Stretch — stretch = større bonus OG større straf, #1235 foldet ind) → **1 anmodning** (de gamle request-typer) → underskriv.
- Medlemsreaktioner vises inline ved hvert modtilbud (personlighed i beslutningen).
- Afslag på anmodning kommer ALTID med et modtilbud (FM/OOTP-mønsteret) — aldrig et rent nej.
- Auto-accept-fallback efter 5 kalenderdage består (cron repareret via #3502; state aflæses fra pending-mandater, ikke window-feltet).
- Nye hold: samme årsmøde-flow ved dannelse (lukker #2022 "stykke B" — ingen sær-sti).
- Sæson 1 forbliver baseline-/observationsår (uændret regel): første årsmøde afholdes ved S1→S2, og bestyrelsen kommenterer i S1 kun via referatet.

### 3.3 Sæson-beat (doktrinens "1-2 seasonal events")

- **Mid-season check-in** (eksisterende `boardMidSeason`-mekanik, genoplivet via #3502): formanden gør status i referatet + "skal handles"-markering ved lav confidence.
- **Ekstraordinært møde** ved konsekvens-trigger (lag 3+): kort event med formandens begrundelse + hvad der låser op. Ingen ny mekanik — en overflade på eksisterende triggers.

### 3.4 Boardroom-siden (T1, erstatter hele BoardPage)

Ét skærmbillede, ingen faner, ingen "Vis detaljer", én disclosure-form (inline expand):
1. Header: titel + formand/DNA-subtitel; gold-knap KUN når årsmødet er klart.
2. Tillidskort: confidence + trend + 4 kategorimetre + konsekvens-status som forklaret linje ("Wage cap active — lifts above 40").
3. Mandatkort: 3-5 mål-rækker (label, "Achieved X / target Y" i naturlige enheder, statusbadge, ejer-avatar); expand = kvittering + "Discuss target".
4. Visionskort: tidslinje med milepæle og "you are here".
5. Bestyrelseskort: 5 navngivne medlemmer (initial-avatarer + stemnings-dot), formandscitat, referat-feed (seneste tillidsbevægelser med kvittering).
Mobil: samme kort stakket; boardroom-genvej fra dashboardets bestyrelseskort.

### 3.5 Migration (live spillere, S2 → S3-vinduet)

- 1-års-planens mål → sæsonens mandat (uændrede mål; ingen genforhandling påtvinges).
- 3/5-års-planernes mål → visions-milepæle med deres oprindelige slut-sæsoner (grandfathering-princippet fra #1234: ingen forringes retroaktivt).
- Confidence-startværdi = vægtet snit af de 3 satisfactions (forslag: 1yr 50 % / 3yr 30 % / 5yr 20 %) — snapshot + kvitterings-event ("Board model updated") + backup-tabel som ved #3095-reparationen.
- Timing: bedst sammen med S2→S3-cutover 23/8 (naturligt plan-udløbs-vindue).

### 3.6 Fjernes

Wizard (3 trin + kø), plan-faner, 3 separate tilfredshedstal, GoalMiniDialog-dobbeltdisclosure, emoji-portrætter/DNA-emoji/🔒-badge, `BoardPage.jsx` som 3.127-linjers monolit (splittes i moduler), `domestic_dominance`-skelet (afsluttes eller slettes), sekventiel 5→3→1-onboarding (erstattet af ét årsmøde).

## 4. Faseplan

- **Fase 0 — Korrekthed + arkæologi (kan starte nu, retnings-uafhængig):** #3494 (sponsor-mål), #3502 (cron-state), #2261 (high-profile-flag), #1237 (saldo vs. gæld), konsistent "Achieved/target"-visning, i18n-sweep, konsolidering af duplikat-moduler (boardTestMode/-Service, boardWeekendUpdate/-Finalization — ejer-krav 15/7 i #955, aldrig oprettet som issue).
- **Fase 1 — Mandat-modellen i backend** bag kill-switch: ny aggregering + migrations-script + **dry-run mod hele populationen** med scorecard (simulér-før-ship) + forward-guard-tests for sæsonskifte.
- **Fase 2 — Boardroom + årsmøde-UI**, flip for ALLE (kill-switch = rollback, ikke beta-gate), patch notes + help.json (en+da) + Discord-udkast til ejeren.
- Instrumentering (#1141) indbygget fra fase 2: mål på dead-clicks, mødegennemførelse, kvitterings-åbninger.

**Succeskriterier:** dead-click-tæthed /board < 0,2 (fra 0,88) · 0 nye "forstår ikke tallet"-tråde på Discord første måned · accept-alt-mandat på 2 klik · alle mål viser kvittering · confidence-forklaring identisk på dashboard og boardroom.

## 5. Issue-konsolidering ved godkendelse

Foldes ind/supersederes: #955, #1235, #1237, #1240, #1111, #101, #165 (AC3), #2723 (board-visningen; fuldt renown-system forbliver #1099), #3335, #2022 (stykke B), #3152 (adresseres af kvitteringer + mandat-modellen; bonus-koblingen genbesøges i fase 1-scorecardet). Fase 0-bugs kører som selvstændige issues før/parallelt.

## 6. Åbne punkter til ejer-review

1. Confidence-migrationens vægte (50/30/20) — ok, eller anden fordeling?
2. Navnepulje til medlemmer: nordisk/international mix eller ren dansk/nordisk?
3. Mobil-mockup ønskes som runde 3 før spec-godkendelse?
