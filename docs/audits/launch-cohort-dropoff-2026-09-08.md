# Audit — launch-kohortens frafald dag for dag (#4964)

Read-only fra prod 8/9 (Supabase MCP, kun SELECT). Dagsgrænser Europe/Copenhagen. Univers: `role <> 'admin'`, ingen AI-/test-/bank-hold. Ingen kodeændringer.

## 0. To fejlkilder i #4960's tal

**(a) `player_events` er consent-gated** (`logEvent.js` kræver
`localStorage.cz_consent_v1.analytics === true`). Målt: 4 af launch-kohortens 20 har **nul**
`player_events` men 16-32 auktionsbud og op til 30 manuelle holdudtagelser i DB — de så
frafaldne ud og spillede reelt. Alt nedenfor bruger derfor et **consent-uafhængigt**
aktivitetsmål: `player_events` ∪ `auction_bids` ∪ manuelle `race_entries` ∪ `xp_log` ∪ forum
(+ `users.last_seen` som bagkant).

**(b) 86,8 % vs 28,6 % sammenligner ikke det samme.** Uge 1 var en kalenderuge, så kohorte A's
"aktive uge 1" er de 52 der stadig spillede efter måneder — en overlevende kerne — mens
launch-kohortens er alle 18 nyankomne. Alders-justeret (hver kohortes egen dag 0-6 → 7-13):

| Kohorte | n | Aktive egen uge 1 | Igen egen uge 2 | Retention |
|---|---:|---:|---:|---:|
| maj-juni | 63 | 55 | 25 | 45,5 % |
| juli | 98 | 80 | 31 | 38,8 % |
| 1-23/8 | 51 | 40 | 17 | 42,5 % |
| **24-30/8 (launch)** | **20** | **18** | **6** | **33,3 %** |

Consent-uafhængigt bliver #4960's kalender-tal 92,3 % / 73,7 % / **38,9 %** — samme retning,
mindre dramatik. **Konklusionen ændrer sig:** launch-ugen er ikke syg. Nye spillere har holdt
33-46 % fra uge 1 til uge 2 siden maj; to ud af tre er væk efter to uger, og det har de altid
været. Launch-ugen gjorde det synligt, fordi 20 kom ind på én uge.

## 1. Hvor de falder fra: den første time

Timer fra tilmelding til **sidste** aktivitet overhovedet:

| Kohorte | m. aktivitet | Væk < 1 time | Væk < 24 timer |
|---|---:|---:|---:|
| maj-juni | 57 | 12 (21 %) | 19 (33 %) |
| juli | 80 | 17 (21 %) | 37 (46 %) |
| 1-23/8 | 41 | 10 (24 %) | 16 (39 %) |
| **24-30/8** | **18** | **7 (39 %)** | **10 (56 %)** |
| 31/8-7/9 | 6 | 2 (33 %) | 5 (83 %) |

Launch-kohortens 18 er skarpt bimodale: 7 stopper inden for 36 minutter, 2 mere samme dag,
1 efter et døgn, 2 efter to døgn — og 6 er stadig med efter 8-14 dage. Ingen glidende decay.
**Enten binder første session, eller også er det slut.** Andel med sidste aktivitet ≥ dag N:

| Kohorte | dag 1 | dag 2 | dag 3 | dag 7 | dag 14 |
|---|---:|---:|---:|---:|---:|
| juli | 54 % | 42 % | 42 % | 34 % | 30 % |
| 1-23/8 | 59 % | 45 % | 43 % | 37 % | 24 % |
| 24-30/8 | 45 % | 40 % | 30 % | 30 % | 25 %¹ |

¹ kun 4 af de 20 har et fuldt 14-dages vindue pr. 7/9 — tallet bærer ikke.

## 2. Hvad de sidst rørte

Sidste hændelse for dem der var væk inden for 24 timer (tilmeldt 1/7-7/9, n≈72): bud i
auktion 11 · `auction_view` 11 · manuel holdudtagelse 11 · `race_viewed` 9 ·
`onboarding_first_bid_recommendation_shown` (vist, ikke klikket) 6 · `team_drafted` 6 ·
`feature_finance_forecast_card_viewed` 6. Auktionen er sidste flade for ~28 af 72. For
launch-kohorten var `onboarding_first_bid_recommendation_shown` sidste hændelse for 3 af 20:
anbefalingen om at byde blev vist, de bød ikke, de kom aldrig igen.

## 3. Onboarding-trinnene, målt direkte i DB

De 4 trin i `GET /api/me/onboarding-progress` er alle DB-målbare. Andel af kohorten:

| Trin | maj-juni | juli | 1-23/8 | 24-30/8 |
|---|---:|---:|---:|---:|
| 1 bud i auktion | 62 % | 56 % | 63 % | **55 %** |
| 2 træning kørt af manageren selv | 52 % | 53 % | 47 % | **35 %** |
| 3 manuel holdudtagelse | 52 % | 50 % | 43 % | **35 %** |
| 4 bestyrelsesplan "completed" | 97 % | 93 % | 84 % | 90 % |

**Trin 4 måler ingenting:** 91 af 98 juli-brugere står færdige, mens kun 55 har budt —
`board_profiles.negotiation_status` flipper til `completed` uden spillerhandling. Samme
fejlklasse som #3007 rettede for træningstrinnet; kortet giver 1/4 grønt gratis. *(Antagelse:
`boardAutoAccept.js` er kilden.)* Launch-kohorten byder normalt — de falder på **trin 2 og 3**.

## 4. Hvilken handling hænger sammen med at blive (tilmeldt 15/5-30/8, n=193)

Uge-1 → uge-2-retention, betinget af handling inden for 48 timer:

| Handling < 48 t | n | Retention med | Retention uden |
|---|---:|---:|---:|
| Bud i auktion | 126 | 52,4 % | 19,4 % |
| Rørte træning | 85 | 55,3 % | 29,6 % |
| Satte holdudtagelse selv | 82 | 54,9 % | 30,6 % |
| Onboarding 4/4 | 66 | 60,6 % | 30,7 % |

Delt på hvordan **første løb** blev fyldt: auto-udfyldt → 35 af 117 tilbage i uge 2
(**29,9 %**); sat af manageren selv → 44 af 76 (**57,9 %**). Launch-kohorten: **12 af 20 fik
kun auto-udfyldte opstillinger**, og kun 3 af 20 satte selv en opstilling inden for 48 timer
(mod 30-42 % tidligere). *(Korrelation, ikke årsag: den der selv sætter opstilling er også den der i forvejen er engageret.)*
**Forklarer intet:** division (alle 20 i div. 4), sprog (17 en / 3 da, som juli;
`browser_language` tom, #4811), auktionsudbud (30-114 auktioner oprettet dagligt 24-30/8),
tid til første løb (median 2 dage mod 1 — for lille til at bære faldet).

## 5. Det strukturelle hul: der findes ingen vej tilbage

`email_log` er **tom** — nul rækker, nogensinde. Samtidig er hele retention-loopet merged og
dormant: `emailWelcomeSweep.js` (D0), `emailDay1Sweep.js` (hold oprettet for 20-30 t siden),
`emailRaceDigestSweep.js`, `emailRetrySweep.js`, unsub-signering, dedupe-nøgler, DA/EN-copy.
Alle tre `app_config`-flag (`email_loop_welcome`, `email_loop_day1`, `email_loop_race_digest`)
står `"off"`, sat 7/9, aldrig løftet. Tjekliste: `docs/EMAIL_LOOP_GO_LIVE_RUNBOOK.md`.
Discord: 2 af 20 er koblet. In-app-notifikationer får de rigeligt af (8,8 i snit de første 3
dage), men de virker kun på en spiller der allerede er kommet tilbage. **En spiller der lukker
fanen efter 36 minutter kan i dag ikke nås af noget.** Day-1-sweepets målvindue (20-30 t)
rammer nøjagtigt hullet hvor 39-56 % af launch-kohorten forsvandt.

## 6. Signups pr. uge (renset univers)

29/6: 68 · 6/7: 20 · 13/7: 5 · 20/7: 32 · 27/7: 19 · 3/8: 18 · 10/8: 17 · 17/8: 12 · 24/8: 20 · 31/8: **6**. Bekræfter #4964's 20 → 6.

## 7. Forbehold

- Launch-kohorten er 20 brugere, 18 med aktivitet — alle procenter er retningsgivende, og
  14-dages-tallet hviler på 4 brugere med fuldt vindue.
- Afsnit 4 er korrelationer; ingen af dem er testet som indgreb. Trin 4-diagnosen (afsnit 3)
  er udledt af tallene, ikke af en gennemlæsning af auto-accept-stien.
- `users.last_seen` er en 60 s-heartbeat fra `Layout` — sidste tidspunkt, ikke en kurve.
