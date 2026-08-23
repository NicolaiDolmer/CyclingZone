# Session-prompt 24/8: minus-hold + financial fairplay + kalender-feedback

Du er arkitekt for mandag-sessionen efter S2→S3-cutoveren (gennemført 23/8 aften, se `docs/NOW.md` + `.claude/learnings/2026-08-23-cutover-statement-timeout-og-saeson-anker.md`). Tre spor, i denne rækkefølge. ÉN regel består fra i går: **ingen prod-mutation uden ejerens "GO" på netop det skridt, efter at have set de konkrete tal.** Read-only måling kræver ikke GO.

## Spor 1: Hvorfor står 3 managers i minus?

Målt 23/8 ~22:45 (efter bonus-reparationen, alle D1):

| Hold | Kasse | Nattens store poster |
|---|---|---|
| 24/7 Aspire-Light Velo Team | −195.880 | sponsor upfront kun 195.500 (lav guaranteed_fraction) · upkeep −220.000 · løn −152.283 · lånafdrag −61.000 · akademi −40.000 |
| LEGO-Vestas Cycling Team | −78.271 | **lånafdrag −253.120** · løn −394.070 · upkeep −220.000 · sponsor 470.400 · bonus +150.000 |
| Chuchiet | −1.358 | upkeep −220.000 · løn −169.428 · sponsor 441.600 (næsten i nul) |

Opgaver:
1. Afgør pr. hold om minusset er **by design** (up-front-model: hele sæsonens løn/upkeep/drift betales ved skiftet, sponsor betaler kun garantien up-front, præmier ~22k/dag drypper fra tirsdag) eller om noget er forkert. Særligt: verificér lånafdragene (LEGO −253.120, 24/7 −61.000) — er forfald-ved-sæsonskifte korrekt ift. lånevilkårene, og VIDSTE spillerne det (forecast #3986-dobbelttællingen skjulte udgiftssiden)?
2. Mål gælds-mekanikkens faktiske konsekvenser for de tre (negative_balance_interest ved sæson-slut, emergency_loan-tærskler, transfer_frozen/debt_breach_streak) og beregn hvornår præmie-indtægten bringer dem i plus. thelamba har direkte spurgt "hvor længe kan jeg være i minus?" — svaret skal være målt, ikke gættet.
3. Udkast (EN+DA) til kort forklaring ejeren kan poste; kort på fladen, tal i stedet for beroligelse. Ejeren poster selv.
4. Strukturelt: #4153 (payroll trækker løn for ryttere der pensioneres i samme transition) og #3720-kalibreringen (upkeep/præmier, S4) ligger samme dag — koordinér, dublér ikke.

## Spor 2: Financial fairplay

1. **#4154 (nyt, uverificeret):** thelamba rapporterede ~19 interne handler / ~1,2M netto til Team Fakta (#transfer-history-link i #dansk-snak 23/8 ~21:54). Verificér med tal FØR nogen konklusion: handlerne, parterne, priserne mod værdimodellen (#3951-metoden: overpris-faktor pr. handel), timing ift. komprimeringen (Team Fakta rykkede D4→D2 som rank 37). Ingen anklager i noget spiller-vendt output.
2. Kør fairplay-værktøjerne der findes: `fairplay_flags`/#3138-scoringen + #3552-mønsteret (6 ensrettede overførsler + swap). Tjek om 23/8-handlerne har udløst flags, og om detektorerne overhovedet dækker "mange små interne handler"-mønsteret.
3. Slutprodukt: dossier med målt evidens + A/B-anbefaling til ejeren (fx: ingen handling / advarsel / tilbagerulning + regel). **Sanktioner er 100 % ejer-beslutning** — og husk doktrinen: styrke straffes aldrig, kun ægte omgåelse.
4. Åbne relaterede: #3951 (2,9x-parret, egen session lovet), #3552.

## Spor 3: Nyeste feedback på løbskalenderen

1. Sweep Discord for kalender-reaktioner siden 23/8 morgen: #the-roadbook, #dansk-snak, #dansk-strategi, #questions-and-answers, #general, #feedback-and-ideas (forum). S3-programmet blev synligt 23/8 (#4134) og S3 startede i nat — reaktionerne er ferske. Kendt fra i går: jeppek observerede at et endagsløb var "koblet til" løbsdagen FØR et etapeløb starter (han trak selve overlaps-påstanden tilbage, men kobling/visning bør verificeres mod `races.game_day_start`).
2. Verificér det spillerne påpeger mod DB (kalenderen ER regenereret og ejer-godkendt — #4131/#4103/#3371 er lukkede; nye fund skal være NYE, tjek issue-dubletter før oprettelse).
3. Kendte åbne kalender-punkter (koordinér, dublér ikke): #4143 (kalender-glyffer), #4103-4 (præmiebudget pr. division — hører sammen med #3719-kalibreringen i dag), #4105 (Toscana→S4), #4125 (upkeep-satser synlige pr. division).
4. Slutprodukt: prioriteret liste (max 5) med anbefaling: fix nu / S3-undervejs / S4.

## Praktisk (arv fra i går)

- Prod = `ghwvkxzhsbbltzfnuhhz` (Supabase MCP til read-only SQL). S2-id `...0002`, S3-id `...0003`.
- Prod-scripts: PowerShell-tool med `infisical run --env=prod --silent -- node ...` fra `backend/`; lange kørsler som detached `Start-Process` med log-fil (classifieren blokerer af og til — detached virkede hele natten). Monitor/baggrunds-vent er upålidelig på denne maskine.
- Kodeændringer: branch + PR (worktrees under `C:\Dev\CyclingZone-worktrees`); docs må committes direkte på main.
- Statement-timeout er 8s gennem supabase-js (authenticator-rollen) — chunk masse-skrivninger, jf. postmortem.
- Dagens ØVRIGE plan står i NOW.md (v4-afvigelser, #3512, #3121-matview, MAN-ugenote #428, staging-sletning #3839) — denne session ejer KUN de tre spor ovenfor; flag kollisioner i stedet for at overtage.

## Close-out

NOW.md (Next action + Working agent) · issue-kommentarer/labels pr. spor (#4154, #4153-koordinering, evt. nye kalender-issues) · patch note KUN hvis noget spiller-vendt ændres · `pwsh -File scripts/check-agent-token-hygiene.ps1` · postmortem ved bugfix.
