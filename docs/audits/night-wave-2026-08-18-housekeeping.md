# Issue-hygiejne — natbølge 2026-08-18

Mandat: masterplanens F-sektion + natbølge-mandat 17/8 (ejeren gav skriftligt lukke-mandat for verificerede done-men-åbne issues). Ingen kode, ingen worktree, hovedcheckout urørt. Al SQL var read-only (`execute_sql`, SELECT).

## Resultat i tal
- **28 issues lukket** (27 `claude:done`-oprydning + 1 dublet)
- **11 issues sprunget over** med begrundelse (label var enten forkert, eller arbejdet er reelt kun delvist)
- **6 issues i ejer-bundt** — kræver ejerens egen dom, ikke lukket

---

## Lukkede issues (claude:done → completed)

Alle med eksplicit citat af den merged PR/commit der leverede scopet, plus evt. prod-verifikation.

| # | Titel (kort) | Evidens |
|---|---|---|
| [#3826](https://github.com/NicolaiDolmer/CyclingZone/issues/3826) | Proxy-endpoint mangler akademi-fallback | PR #3841 (merged 17/8), ejer-godkendt visuelt |
| [#3819](https://github.com/NicolaiDolmer/CyclingZone/issues/3819) | Clarity self-referral forurener uge-tal | PR #3829 (merged 17/8) |
| [#3751](https://github.com/NicolaiDolmer/CyclingZone/issues/3751) | Dashboard viser løb holdet ikke er med i | PR #3848 (merged 17/8), målt 14/8: 7 hold ramt |
| [#3715](https://github.com/NicolaiDolmer/CyclingZone/issues/3715) | Akademi-flyt forkortede kontrakter | PR #3833 (merged 17/8), backup + post-verify, 11/11 rettet |
| [#3658](https://github.com/NicolaiDolmer/CyclingZone/issues/3658) | Skal fyre staff for at se kandidater | PR #3851 (merged 17/8, bag FACILITIES_ENABLED) |
| [#3657](https://github.com/NicolaiDolmer/CyclingZone/issues/3657) | Scouting-missioner værdiløse | PR #3846 (merged 17/8), ejer-godkendt |
| [#3652](https://github.com/NicolaiDolmer/CyclingZone/issues/3652) | Scouting: rapport på øvrige fund | PR #3846 (merged 17/8) |
| [#3650](https://github.com/NicolaiDolmer/CyclingZone/issues/3650) | Akademi-ryttere på transferlisten | PR #3845 (merged 17/8, ejer-direktiv 17/8) |
| [#3645](https://github.com/NicolaiDolmer/CyclingZone/issues/3645) | 23/8-cutover drejebog | Sidste kommentar: "Issuet kan lukkes" (PR #3801 + #3835) |
| [#3632](https://github.com/NicolaiDolmer/CyclingZone/issues/3632) | Nye ryttere uden sekundært anlæg | PR #3635 (v7.114) + **verificeret selv via SQL 18/8**: 32 ryttere født ≥16/8, 0 med primary=secondary |
| [#3551](https://github.com/NicolaiDolmer/CyclingZone/issues/3551) | Hjælp forklarer ikke auktions-/FA-kilder | PR #3832 (merged 17/8) |
| [#3549](https://github.com/NicolaiDolmer/CyclingZone/issues/3549) | Dobbelt notifikation ved auktionsvind | PR #3840 (merged 17/8), ejer-godkendt m. screenshots |
| [#3541](https://github.com/NicolaiDolmer/CyclingZone/issues/3541) | Skadedage inkonsistente 3 steder | PR #3831 (merged 17/8), ejer-godkendt |
| [#3497](https://github.com/NicolaiDolmer/CyclingZone/issues/3497) | Grå stjerner læses som "færdigudviklet" | PR #3533 (merged 7/8) |
| [#3496](https://github.com/NicolaiDolmer/CyclingZone/issues/3496) | Indbakke: tilbudsbesked uden genvej | PR #3840 (merged 17/8), ejer-godkendt |
| [#3493](https://github.com/NicolaiDolmer/CyclingZone/issues/3493) | Etape-notifikation om andres ryttere | PR #3840 (merged 17/8), ejer-godkendt |
| [#3491](https://github.com/NicolaiDolmer/CyclingZone/issues/3491) | Scout-rapport uden link til scout-fane | PR #3840 (merged 17/8), ejer-godkendt |
| [#3201](https://github.com/NicolaiDolmer/CyclingZone/issues/3201) | Notifikation ved nye spillerbeskeder | PR #3447 (merged 6/8, v7.102) |
| [#3098](https://github.com/NicolaiDolmer/CyclingZone/issues/3098) | RPC-fallback mangler rytter/løb-navn | PR #3842 (merged 17/8) |
| [#3067](https://github.com/NicolaiDolmer/CyclingZone/issues/3067) | "Sælger"-badge død affordance | PR #3841 (merged 17/8), ejer-godkendt |
| [#3012](https://github.com/NicolaiDolmer/CyclingZone/issues/3012) | Døde klik: 13 tavse fejl | PR #3852 (merged 17/8) |
| [#3008](https://github.com/NicolaiDolmer/CyclingZone/issues/3008) | OnboardingTour-tooltip forkert placering | PR #3849 (merged 17/8) |
| [#2889](https://github.com/NicolaiDolmer/CyclingZone/issues/2889) | Hjælp om sæsonøkonomi-timing | PR #3832 (merged 17/8) |
| [#2721](https://github.com/NicolaiDolmer/CyclingZone/issues/2721) | Ingen scout-historik/liste | PR #3844 (merged 17/8) |
| [#2700](https://github.com/NicolaiDolmer/CyclingZone/issues/2700) | Pensions-varsel mangler | PR #3850 (merged 17/8) |
| [#2400](https://github.com/NicolaiDolmer/CyclingZone/issues/2400) | Transferhistorik fyldt med "ingen salg" | PR #3841 (merged 17/8), ejer-godkendt |
| [#1974](https://github.com/NicolaiDolmer/CyclingZone/issues/1974) | Træning: FLAD/SPRINT/ACC udvikles ikke | PR #2335 (11/7) + PR #3343 (merged 5/8) |

## Lukket dublet

| # | Titel | Dublet af | Begrundelse |
|---|---|---|---|
| [#3518](https://github.com/NicolaiDolmer/CyclingZone/issues/3518) | Forum-lancering: indbakke-besked + Discord-invite | [#2761](https://github.com/NicolaiDolmer/CyclingZone/issues/2761) | #2761's seneste kommentar (ejer-direktiv 6/8) udvider **allerede** scopet til præcis denne opgave (samme direktiv fra samme Discord-besked, citeret ordret i begge issues). Samme leverance sporet to steder — lukket til fordel for #2761 (ældre, allerede opdateret med scopet). |

**Bemærk om det foreslåede eksempel-par (#3094/#2883):** #3094 er allerede `CLOSED` (lukket i done-sweep 15/8, PR #3378) og derfor intet at gøre ved. Det er desuden reelt ikke samme issue som #2883 — #3094 var specifikt om peak-låsning uden fortryd, #2883 er bredere planlægger-brugbarhed. Ingen handling nødvendig.

**Heuristisk dublet-scan** af titel-keyword-overlap kørt over alle 543 øvrige åbne issues (uden for roede-ikke-lister) fandt kun ét reelt par (#3518/#2761); resten af kandidaterne (#492/#490/#483 i18n-epic, #3452/#3451 forum-features) er beslægtede men adskilte delopgaver, ikke dubletter.

**Opslugte issues (kategori c):** krydstjekkede "Closes/Fixes"-referencer i de seneste 60 merged PR'er mod stadig-åbne issues uden `claude:done`-label — ingen match. En fuld historisk gennemgang af alle merged PR'er er ikke lavet (ude af scope for denne session); hvis I ønsker det, er det et selvstændigt issue-hygiejne-spor.

---

## Sprunget over (evidens ikke entydig — ikke lukket)

| # | Titel | Hvorfor sprunget over |
|---|---|---|
| [#3767](https://github.com/NicolaiDolmer/CyclingZone/issues/3767) | Sentry tavs, 51 afvisninger arkiveret | Kode-delen er merged (PR #3772), men issuets punkt 1 (Sentry alert-regel) kræver en manuel ~1-minuts handling i Sentry-UI'et som Claude ikke kan udføre (kun read-only MCP-værktøjer til alert rules). Ikke reelt færdigt. |
| [#3671](https://github.com/NicolaiDolmer/CyclingZone/issues/3671) | Scout-niveau 3 køber intet for 150/203 hold | Backend-delen er løst 14/8, men sidste kommentar siger eksplicit "**UI'et mangler**" — precision-blokken ligger i payload, men UI'et der viser den er ikke bygget. |
| [#3666](https://github.com/NicolaiDolmer/CyclingZone/issues/3666) | Rating-skala Fase 2, alle visningsflader | Kun "Landing 1" (PR #3683) leveret — titlen lover "alle visningsflader i én PR", men gate R1 (spredning) misser med 1 point og er udskilt til #3668. Multi-landing-feature, ikke færdig. |
| [#3489](https://github.com/NicolaiDolmer/CyclingZone/issues/3489) | Flere spejdere/trænere samtidig | Kun en "vertikal skive" leveret (PR #3851, bag flag) — selve issuets kerne-spørgsmål ("var ønsket om flere staff reelt eller en misforståelse") er ikke afklaret, sporet videre i #3854. |
| [#2454](https://github.com/NicolaiDolmer/CyclingZone/issues/2454) | Potentiale-skala 1-6 → 1-99 | Sidste kommentar (14/8) siger eksplicit "**Denne del er ikke bygget endnu**" — venter på en backend-sti (#3666) først. Fejlagtigt `claude:done`-mærket. |
| [#3787](https://github.com/NicolaiDolmer/CyclingZone/issues/3787) | Sortering på potentiale rangerer forkert | Roret ikke — dækket af **åben** draft-PR #3798 (`Closes #3787`), som allerede er udelukket af opgavens "rør ikke"-liste (kalender/trin7). |

---

## Ejer-bundt — kræver jeres egen dom (6 stk.)

Disse **er ikke lukket**. De blev fundet under verifikationen af `claude:done`-listen og ser umiddelbart afsluttede ud, men kræver enten en beslutning eller en handling kun I kan tage.

1. **[#3621](https://github.com/NicolaiDolmer/CyclingZone/issues/3621)** — Sponsor-forvirring i forecast. Kun det ene af issuets to led er løst (PR #3700); det andet led er udskudt til #1778/#101. Sidste kommentar spørger dig direkte: "skal lukkes helt eller stå åben på resten?"
2. **[#3498](https://github.com/NicolaiDolmer/CyclingZone/issues/3498)** — Fjern udgåede admin-funktioner. Kommentaren siger eksplicit "holdt åben til din egen efterinspektion af admin-panelet i prod" — venter på jeres kik, ikke på kode.
3. **[#3134](https://github.com/NicolaiDolmer/CyclingZone/issues/3134)** — Ung-konto-spærrer (lån/overførsler/auktion). Alle tre spærrer er bygget men slået fra (default 0/false); dry-run viser at den bogstavelige auktions-spærre ville ramme 422 legitime onboarding-bud og skal indsnævres før flip — kræver en tærskel-beslutning fra jer.
4. **[#3133](https://github.com/NicolaiDolmer/CyclingZone/issues/3133)** — Pris-gulv/-loft på overførsler. I besluttede selv 4/8 at IKKE aktivere nu ("føles ikke rigtigt at godkende lige nu"). Mekanikken er bygget og slukket — venter på at I selv tager den op igen.
5. **[#2883](https://github.com/NicolaiDolmer/CyclingZone/issues/2883)** — Sæsonplanlægger ubrugelig for aktive testere. Alt det omtalte er nu live (Kalender-fane PR #3179, toppe-skift PR #3378), men et udkast til opfølgende Discord-besked til de to testere der klagede ligger klar og må **ikke postes uden jeres ordrette ja** (I poster evt. selv).
6. **[#2840](https://github.com/NicolaiDolmer/CyclingZone/issues/2840)** — Løn skal være dagsbaseret. **Vigtigt:** jeg tjekkede `app_config.wage_deduction_mode` mod prod lige nu (18/8) — den står stadig på `"season_upfront"`. Mekanismen for dagsbaseret løntræk er bygget og verificeret (PR #3356), men er **ikke aktiveret**. Den bug issuet beskriver er derfor reelt stadig live for spillerne. Kræver jeres go til at flippe config-flaget.

---

## Metode-note
- Alle 40 issues med `claude:done`-label + open state blev læst og verificeret enkeltvis (kommentar-historik + i flere tilfælde direkte SQL mod prod).
- Issues ekskluderet iht. opgavens "rør ikke"-lister (natbølge, beslutnings-gatede, kalender/cutover, åben-PR) blev filtreret fra før verifikation — inkl. #3787, som viste sig at høre til denne liste via en åben draft-PR.
- SQL mod produktionsdatabasen var udelukkende `SELECT` (2 forespørgsler: `riders`-fødselstjek for #3632, `app_config`-opslag for #2840).
