# GitHub-oprydning: kandidatliste (#4267)

> **READ-ONLY.** Denne rapport lukker/ændrer intet. Ejeren og orkestratoren afgør handling; Claude har ikke lukket, mærket eller kommenteret på nogen af de nævnte issues under denne audit.

**Dato:** 2026-09-03. **Kilde-data:** `gh issue list --state open` (628 åbne issues) + `gh pr list --state merged` (2.056 merged PR'er, uafgrænset i tid). Evidens for "løst" = eksplicit `Refs #N` / `Closes #N` / `Fixes #N` i en merged PR's titel eller body (repoets egen konvention, jf. [`docs/GITHUB_WORKFLOW.md`](../GITHUB_WORKFLOW.md#commitpr-konvention)) — ikke blot en tilfældig `#N`-forekomst (den slags gav ca. 3x flere falske positiver, bl.a. Dependabot-changelog-links og React/WebKit-fejlkoder der ligner issue-numre).

## Opsummering

| Kategori | Antal |
|---|---|
| 1. Åbne issues med `claude:done` | 35 (34 med merged PR-evidens, 1 leveret direkte af ejeren) |
| 2. Åbne `claude:todo` med merged PR-reference sidste 30 dage | 108 (98 ikke-epic, 10 epics — se advarsel) |
| 3. Issues uden `priority:`- og/eller `type:`-label | 3 |
| 4. `priority:low` uden aktivitet i 60+ dage | 21 |
| 5. Sandsynlige dubletpar (titel-lighed) | 1 sikker, 2 beslægtede (ikke rene dubletter) |
| **Masterplan-drift** | 5 punkter refererer lukkede issues som var de aktive |

---

## Top-10 "luk først"

De 10 `claude:done`-issues der har ligget længst siden deres PR blev merged, vægtet mod `priority:high`. Alle har eksplicit `Refs #N` i en merged PR.

| # | Titel | Merged PR | Prioritet | Hvorfor top-10 |
|---|---|---|---|---|
| #2813 | [monetization] CZ Pro kan købes uden handelsbetingelser, opsigelsessti eller oplyst fortrydelsesret | PR#3155 (2026-07-30) | priority:high | Ligget som `claude:done` uden lukning siden PR merge 2026-07-30 |
| #3514 | [Epic] Bestyrelses-rework 'Mandatet' — én tillid, ét årsmøde, vision som tidslinje (spec godkendt 7/8) | PR#3801 (2026-08-17) | priority:high | Ligget som `claude:done` uden lukning siden PR merge 2026-08-17 |
| #3550 | [balance] Akademi-intake ubetaleligt: signing fee på 760k-1M for 2-stjernede emner — to rapporter samme uge | PR#3972 (2026-08-19) | priority:med | Ligget som `claude:done` uden lukning siden PR merge 2026-08-19 |
| #4103 | Ejer-direktiv 21/8: kalender-audit S3 - typefordeling, brosten, enkeltstarter, point vs. praemiepenge pr. division | PR#4121 (2026-08-22) | priority:high | Ligget som `claude:done` uden lukning siden PR merge 2026-08-22 |
| #3818 | [fair-play] Ugescan 17/8: 3 ensrettede handler mellem samme to hold, incl. 71x overbetaling - detektoren gav nul flag | PR#4168 (2026-08-24) | priority:high | Ligget som `claude:done` uden lukning siden PR merge 2026-08-24 |
| #4453 | [ops] Backendens Railway-logstrøm har ingen vagt — 25 strukturerede signaler går uset (sidestykke til #4014) | PR#4469 (2026-08-31) | priority:med | Ligget som `claude:done` uden lukning siden PR merge 2026-08-31 |
| #4448 | [refactor] Konvertér de 7 parameter-drevne exhaustive-deps-disables til useCallback | PR#4450 (2026-08-31) | priority:low | Ligget som `claude:done` uden lukning siden PR merge 2026-08-31 |
| #4150 | [infra] Watch paths + nedlukningsvindue: docs-commits redeployer backenden midt i loeb | PR#4457 (2026-08-31) | priority:med | Ligget som `claude:done` uden lukning siden PR merge 2026-08-31 |
| #4418 | [bug/HOEJ] 5 ryttere forsvundet ud af 3 igangvaerende etapeloeb - skade og akademikontrakt midt i loeb bryder det frosne startfelt | PR#4422 (2026-08-31) | priority:high | Ligget som `claude:done` uden lukning siden PR merge 2026-08-31 |
| #4507 | [guard/HOEJ] verify_race_result_duplicates timer ud mod prod og faelder hele kalender-auditten | PR#4525 (2026-08-31) | priority:high | Ligget som `claude:done` uden lukning siden PR merge 2026-08-31 |

---

## 1. Åbne issues med `claude:done` (bør lukkes)

Alle 35 er allerede mærket `claude:done` — dvs. en tidligere session vurderede dem færdige, men ingen har lukket dem siden (jf. #4267's observation: "issues merges uden at `claude:todo` flippes til `claude:done`" — her er problemet det næste skridt, `claude:done` → lukket, der mangler). 34 af 35 har en merged PR med eksplicit `Refs #N`/`Closes #N`. Den sidste (#4617) blev leveret direkte af ejeren i Claude Design (kommentar 2/9, commit `ceaaf66f6`), ikke via en tracked PR.

**Anbefalet handling for alle 35:** `gh issue close N --reason completed` efter et hurtigt blik på PR'en.

| # | Titel | Merged PR (dato) | Anbefaling |
|---|---|---|---|
| #452 | [feature] Tilmeld-knap til kommende sæson når manager ikke kan stille hold (sub-issue til #239) | #4601 (2026-09-02) | Luk som completed |
| #2813 | [monetization] CZ Pro kan købes uden handelsbetingelser, opsigelsessti eller oplyst fortrydelsesret | #3155 (2026-07-30) | Luk som completed |
| #2816 | [monetization] Checkout spærrer ikke for at købe CZ Pro to gange — abonnement nr. 2 overskriver nr. 1 i vores DB | #4655 (2026-09-02) | Luk som completed |
| #3494 | [bug] Bestyrelsens 5-års-plan: sponsor-vækstmålet viser 0/8 — hverken nævner eller tæller er forståelig | #4550 (2026-09-02) | Luk som completed |
| #3514 | [Epic] Bestyrelses-rework 'Mandatet' — én tillid, ét årsmøde, vision som tidslinje (spec godkendt 7/8) | #3801 (2026-08-17) | Luk som completed |
| #3550 | [balance] Akademi-intake ubetaleligt: signing fee på 760k-1M for 2-stjernede emner — to rapporter samme uge | #3972 (2026-08-19) | Luk som completed |
| #3575 | [ux] Genforhandling af bestyrelsesplan: teksten lover en "reset", men board-requests forbliver låst — informationen kommer for sent | #4553 (2026-09-02) | Luk som completed |
| #3818 | [fair-play] Ugescan 17/8: 3 ensrettede handler mellem samme to hold, incl. 71x overbetaling - detektoren gav nul flag | #4168 (2026-08-24) | Luk som completed |
| #4103 | Ejer-direktiv 21/8: kalender-audit S3 - typefordeling, brosten, enkeltstarter, point vs. praemiepenge pr. division | #4121 (2026-08-22) | Luk som completed |
| #4150 | [infra] Watch paths + nedlukningsvindue: docs-commits redeployer backenden midt i loeb | #4457 (2026-08-31) | Luk som completed |
| #4357 | [bug] loadEntrantsForRace har ingen ORDER BY - buildTeamContext's sidste-vinder goer re-simulering raekkefoelge-afhaengig | #4529 (2026-08-31) | Luk som completed |
| #4377 | [bug] Bestyrelsesmaal-taellere ignorerer historik: troejer staar 0/2 og sponsor-indkomst-maalet gik 0/8 -> 0/12 | #4549 (2026-09-01) | Luk som completed |
| #4418 | [bug/HOEJ] 5 ryttere forsvundet ud af 3 igangvaerende etapeloeb - skade og akademikontrakt midt i loeb bryder det frosne startfelt | #4422 (2026-08-31) | Luk som completed |
| #4423 | [bug] Akademikontrakt skrevet midt i et igangvaerende etapeloeb fjerner rytteren fra loebet uden varsel | #4532 (2026-08-31) | Luk som completed |
| #4448 | [refactor] Konvertér de 7 parameter-drevne exhaustive-deps-disables til useCallback | #4450 (2026-08-31) | Luk som completed |
| #4453 | [ops] Backendens Railway-logstrøm har ingen vagt — 25 strukturerede signaler går uset (sidestykke til #4014) | #4469 (2026-08-31) | Luk som completed |
| #4507 | [guard/HOEJ] verify_race_result_duplicates timer ud mod prod og faelder hele kalender-auditten | #4525 (2026-08-31) | Luk som completed |
| #4534 | [bug/KRITISK] Saesonmatrixen tillader at FJERNE ryttere fra startede loeb - kaptajn forsvandt fra igangvaerende Giro | #4536 (2026-08-31) | Luk som completed |
| #4541 | [billing/HOEJ] Aluntas GET /subscriptions-kontrakt er aldrig verificeret - vi kan ikke afgoere om et abonnement er fornyet | #4637 (2026-09-02) | Luk som completed |
| #4542 | [billing/db] subscriptions.updated_at stemples aldrig - entitlement-cachens friskhed kan ikke aflaeses | #4640 (2026-09-02) | Luk som completed |
| #4545 | [bug] Manglende chunk svarer 200+HTML cachet immutable, og chunk-fejl er usynlige i Sentry | #4546 (2026-09-01) | Luk som completed |
| #4556 | [board] S-M2a-rest: stemme-indhold for 7 arketyper + atomisk laesesteds-rewiring (efter tone-go) | #4585 (2026-09-02) | Luk som completed |
| #4566 | [bug] Loebssidens story-tags forsvinder over 1000 momenter - PostgREST-cap uden range | #4568 (2026-09-02) | Luk som completed |
| #4578 | [board] Kvitterings-events mangler maal-kobling: Last movement, medlems-stemning og ejer-stemme i referatet er begraensede | #4642 (2026-09-02) | Luk som completed |
| #4579 | [board] Boardroom-maal uden let evaluerings-kontekst viser 'on track' i stedet for reel status (awaiting_data) | #4639 (2026-09-02) | Luk som completed |
| #4581 | [perf/HOEJ] Loebssiden henter alle klassementer for alle etaper (11.947 raekker, 2,4 MB for Giro'en, 12 sekventielle round-trips) - 4 sek. load der vokser pr. etape | #4584 (2026-09-02) | Luk som completed |
| #4586 | [board] boardVoice navngiver eet medlem ad gangen - kollisions-salt matcher ikke Boardroom-sidens samlede navngivning (samme person, to navne) | #4638 (2026-09-02) | Luk som completed |
| #4587 | [rules] U25 foelger UCI-reglen: 25 aar og yngre (ejer-beslutning 2/9), een faelles regel i stedet for 5 kopier af '< 25' | #4593 (2026-09-02) | Luk som completed |
| #4598 | [races] Dagsform som 11 trin i rytterens stemme, kun eget hold (ejer-design 2/9) | #4603 (2026-09-02) | Luk som completed |
| #4617 | [design] Wireframes i Claude Design: Academy, Youth races, Graduation Day, Rider journey (ejer-opgave, #2492) | Ingen PR – leveret direkte af ejeren (kommentar 2/9, commit ceaaf66f6) | Luk som completed |
| #4624 | Design-kvalitetsaudit af alle 63 sider, lys/moerk/mobil, mod skabeloner og taste-doc (slice 2 af #4622) | #4641 (2026-09-02) | Luk som completed |
| #4625 | Haev UI-kittet een gang: primitiver der ikke kan bruges forkert, ikon-sweep, domaene-primitiver (slice 3 af #4622) | #4641 (2026-09-02) | Luk som completed |
| #4644 | [ops/HOEJ] 15 af 17 daglige crons er setInterval uden boot-run: koerer aldrig paa dage med deploys | #4653 (2026-09-02) | Luk som completed |
| #4648 | [billing] Webhook smider subscription.created/started vaek: external_customer_id ligger under customer, ikke paa topniveau (Pro landede foerst efter 55 min) | #4655 (2026-09-02) | Luk som completed |
| #4650 | [email] Digest bliver en tilbagekomst-mail: kun fravaer 3+ dage, 1 pr. uge, 2 pr. fravaer (ejer 2/9: ingen spam) | #4654 (2026-09-02) | Luk som completed |

---

## 2. Åbne `claude:todo` hvor en merged PR (seneste 30 dage) refererer issuet — "sandsynligvis løst"

Dette er en **forfilter**, ikke en luk-liste: en merged PR der skriver `Refs #N` betyder issuet blev *arbejdet på* i den PR, ikke nødvendigvis at hele issuets scope blev dækket. 98 er almindelige issues (høj tillid til at de reelt er løst — samme mønster som kategori 1, blot uden `claude:done`-flippet). De resterende 10 er **epics/paraply-issues** hvor en merged PR typisk kun dækker én slice — de bør **ikke** lukkes uden at tjekke om alle underspor er landet.

**Anbefalet handling (ikke-epics):** verificér kort mod PR'en, sæt `claude:done` eller luk direkte.
**Anbefalet handling (epics):** behold åbne, men brug som tjekliste for hvilke slices der mangler.

### 2a. Ikke-epics (98)

<details>
<summary>Vis alle 98 rækker</summary>

| # | Titel | Merged PR (dato) |
|---|---|---|
| #2887 | [feature/balance] Sportsdirektør: gør senior-træningsstatten meningsfuld (påvirker den decline?) + for lille udvalg at vælge fra | #3294 (2026-08-04) |
| #2822 | [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil | #3294 (2026-08-04) |
| #1569 | Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan | #3252 (2026-08-04) |
| #3328 | [balance] Løbsklasse og etapeantal er afkoblet: 32 af 36 D2-etapeløb er ProSeries med op til 8 etaper — længste løb, laveste afkast | #3344 (2026-08-05) |
| #2840 | Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte ryttere gratis | #3356 (2026-08-05) |
| #2645 | [bug/balance] Peak/loft-beskeder inkonsistente: 'approaching ceiling' ved 29/90+ — Del B peak-alderskurve = ejer-beslutning | #3378 (2026-08-05) |
| #2557 | [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-win-rate 51% og stigende | #3275 (2026-08-05) |
| #2022 | [bug] Nyt holds bestyrelse dannes ufuldstændigt: ukalibrerede mål + ingen DNA-valg (basis sættes kun ved sæson-slut) | #3376 (2026-08-05) |
| #3458 | [design] Ryttertype-fundamentet v2: arketype-generation + skala-aerlighed, ingen tredje rystelse (spec til ejer-godkendelse) | #3500 (2026-08-07) |
| #2650 | [balance/HØJ] Fatigue-mætning i hele populationen: AI-median 100, human-median 90 — recovery kan ikke følge løbskalenderen | #3477 (2026-08-07) |
| #3556 | [ci/quality] Merge queue paa main + flake-karantaene som data (verdensklasse-verifikation, ejer-godkendt 8/8) | #3557 (2026-08-09) |
| #3372 | [bug] Ungdoms-scoutrapport faldt drastisk, og TT står fast på 90% trods anbefalet træning | #3588 (2026-08-09) |
| #3577 | [investigation] #3561-efterspil: spillere tog lån og solgte ryttere for at byde på de defekte akademi-ryttere — følgeomkostninger ikke dækket + 12 timers tavshed | #3604 (2026-08-10) |
| #3450 | [investigation/balance] Potentialer rykkede sig bredere end tilsigtet efter ryttertype-opdateringen 5/8 — 4 spillerrapporter samme dag | #3609 (2026-08-10) |
| #3667 | [docs] Hjælp/FAQ + patch notes efter rating-omlægningen (Fase 3) | #3683 (2026-08-13) |
| #3664 | [design] Rating-fundamentet v3: én skala, vægtet snit af rollens evner, evne-registrering (ejer-designet 13/8) | #3672 (2026-08-13) |
| #3553 | [ops] "Add to CyclingZone Roadmap"-action fejler på ALT: Bad credentials (udløbet PAT) — intet lander på roadmap-boardet | #3641 (2026-08-13) |
| #3777 | [proposals-drift] Forslag er anvendt i prod uden at være forfremmet | #3780 (2026-08-14) |
| #3767 | [observability] Sentry er tavs: eneste alarmregel rammer kun high-priority (sidst 10/8) — og 51 spiller-afvisninger ligger arkiveret | #3774 (2026-08-14) |
| #3592 | [balance] Fire typepar er matematisk uadskillelige — positive vaegte er delmaengder af hinanden | #3739 (2026-08-14) |
| #3360 | [balance/HØJ] Pengemængden firdobles over 5 sæsoner (4,24x mod mål 1,3x) — gaten skjulte det gennem hele beta-perioden | #3728 (2026-08-14) |
| #2511 | [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet + i18n-namespace-split | #3689 (2026-08-14) |
| #2884 | [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vinduet gør ryttere usælgelige) | #3793 (2026-08-15) |
| #3631 | [balance] Sekundaer ryttertype er skaev — sprinter 33,7 % i bestanden, tt 32,9 % hos nye ryttere | #3802 (2026-08-17) |
| #3487 | [infra/SEO] Bot-flade: mål AI-crawler-andel (ai_bots log-mode) + luk soft-404-hullet, beslut robots.txt på data | #3829 (2026-08-17) |
| #2041 | investigation(analytics): Returning users stadig ~0 efter #1797 identify()-fix — verificér i prod | #3829 (2026-08-17) |
| #3961 | [incident] Staging-backend mod branch-klon postede 60 re-simulerede resultater til prod-Discord (18/8) — live-guard + oprydning | #3962 (2026-08-18) |
| #3733 | [ux] Soendags-kvittering paa vaerdien: spilleren skal kunne se HVORFOR hans rytter flyttede sig | #3449 (2026-08-19) |
| #3732 | [balance/HOEJ] Vaerdimodellen er pengepolitik, ikke en prisseddel - 53,3 % af alle pengedraen | #4003 (2026-08-20) |
| #3709 | [design] Rytterudvikling og traening: taget og raten skilles ad — 13 ejer-beslutninger + scorecard (14/8) | #3798 (2026-08-20) |
| #3353 | Re-fit riderValuationModelV4 mod den nye (caps-baserede) ryttertype-klassifikation - fjern #3345's frysning | #4007 (2026-08-20) |
| #3104 | [Menu-audit] Rækkefølge efter faktisk brug + to ruter uden indgang — ejer-godkendt, 4 etaper | #3998 (2026-08-20) |
| #2748 | Pensionering: forvarsel + squad-minimum-check ved masse-retirement | #4021 (2026-08-20) |
| #4039 | [ux] Trin 7 fast-follow: daempet loft-visning forbi peak + scout-verdikt paa skrift + tester-verifikationer (ejer-beslutninger 20/8) | #4053 (2026-08-21) |
| #3966 | [investigation] Traeningsudbyttet opleves markant langsommere + brosten maaske laast til let belastning (to rapporter 19/8) | #4063 (2026-08-21) |
| #3547 | [balance] S3-kalender: samlet spillerfeedback ud over GT'erne — brosten, enkeltstarter, løbslængder og løbs-identitet (megathread 8/8) | #4080 (2026-08-21) |
| #3463 | [feature] Race-motoren kan ikke simulere holdtidskørsel (TTT) — ni ryttere får hver deres tid | #4086 (2026-08-21) |
| #3329 | [bug] Division 1 har 6 løbsdage helt uden overlap — den eneste pulje i spillet med enkelt-løbs-dage | #4077 (2026-08-21) |
| #2416 | Udbrud v2: jagt-interesse-model — udbruddets skæbne afgøres af feltets motivation, ikke en terning | #4085 (2026-08-21) |
| #3614 | [balance] 142 frie ungdomsryttere fra gamle akademi-kuld er over ungdomsbåndet — værste er 19 år med evne 54 og 2,1 mio. i værdi | #4114 (2026-08-22) |
| #4129 | Sæsonskifte-guarden kører på et gæt: season_transition_planned_at bliver aldrig sat | #4136 (2026-08-23) |
| #4000 | [balance] Typen skal fylde mindre i vaerdiformlen: regularisér offset-tabellen + alpha (maaling foerst, flip sammen med niveaukorrektionen) | #4151 (2026-08-23) |
| #3720 | [balance/HØJ] #1441 A6-kalibreringen antog en præmie der er 3,7-6,6x for lav — upkeep-kurven er bygget på et forkert tal | #4151 (2026-08-23) |
| #3719 | [balance] Kalenderen har intet præmiepulje-budget pr. division — variations-beslutninger flytter millioner utilsigtet | #4138 (2026-08-23) |
| #4203 | Ejer-direktiv 24/8: Monumenterne skal ud af GT-vinduerne - 4 af 5 ligger inde i en GT, og GT'erne fylder 70% af D1-sæsonen | #4208 (2026-08-24) |
| #4197 | [guard] race:gate:routes er permanent roed - longDayEnduranceLift-baandet staar paa middelvaerdien (GC-orakel-delen er loest i #4210) | #4210 (2026-08-24) |
| #4192 | [design] Traening: single source of truth - saml alt, stil spoergsmaalstegn ved alt, laeg en langsigtet plan (ejer-direktiv 24/8) | #4207 (2026-08-24) |
| #4164 | [docs] Ubesvaret mekanik-spoergsmaal: giver 6 etaper paa én dag mere traening end 1 etape? (egomadsen 24/8) | #4186 (2026-08-24) |
| #3659 | Ejer-direktiv 13/8: goer udvikling, traening og lofter forstaaeligt i UI — forslag foerst | #4207 (2026-08-24) |
| #4218 | [calendar] S3 udskudt til fredag 28/8 - slut soendag 27/9, loeb hver dag, 31 loebsdage | #4222 (2026-08-25) |
| #4216 | [ops] Saesonskifte som EET gated flow i stedet for seks loese scripts | #4222 (2026-08-25) |
| #4016 | [ops] Maskinlæsbart session-claim + worktree-tvang for agenter | #4253 (2026-08-25) |
| #4010 | Supabase-hærdning: realtime-MalformedJWT, sponsor-sweep, offset-paginering og getUser() pr. request | #4247 (2026-08-25) |
| #3517 | [feature] Forum v1.1: ejer-direktiver 6-7/8 — citér-svar m. notifikation, emoji+links, dansk/engelsk-split, auto-signatur | #4250 (2026-08-25) |
| #3451 | [feature] Ejer-direktiv 6/8: forum-søgning + markering af ulæste indlæg i tråde | #4238 (2026-08-25) |
| #4220 | [calendar/realisme] Enkeltstarter skal ligne virkelighedens cykelsport - research foerst, saa regler i SSOT | #4276 (2026-08-26) |
| #3459 | [design] Loebsdags-modellen: loebet ER dagens arbejde - fatigue+traening+udvikling forbundet (spec til ejer-godkendelse) | #4279 (2026-08-26) |
| #3426 | [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjergetaper der slutter nedad | #4276 (2026-08-26) |
| #4282 | [guard] debt_within_ceiling: 2 hold over gældsloft - reelt brud eller forældet loft? | #4291 (2026-08-27) |
| #4201 | [design] Assistenten boer vaere opt-in eller sen-udfyldning i stedet for proaktiv auto-udtagelse (5 spillere 24/8) | #4285 (2026-08-27) |
| #4174 | [balance/HOEJ] Kalenderen kraever op til 29 ryttere - kun 21 % af holdene kan stille fuldt hold, vaerst i D4 (2 af 46) | #4285 (2026-08-27) |
| #4146 | [balance] Trup-loftet er 30 for alle divisioner mens et loeb udtager 6-8 — DIVISION_SQUAD_LIMITS er ikke et loft | #4291 (2026-08-27) |
| #4271 | Ejer-direktiv 25/8: formpeaks skal vaere mere forstaaelige | #4359 (2026-08-28) |
| #4213 | [bug/HOEJ] 461 akademi-/ungdomstilbud peger paa ryttere der allerede er ejet af AI-hold - og RPC-guarden lader spilleren tage dem | #4384 (2026-08-29) |
| #2259 | [chore] Supabase DB-hygiejne: ryd ~20 backup_*-tabeller + covering-index på unindexed foreign keys | #4438 (2026-08-30) |
| #4522 | Ejer-direktiv 31/8: 'Modtag forslag fra assistenten'-knap paa traeningssiden - og start/styr-knapper overalt hvor assistenten kan handle | #4526 (2026-08-31) |
| #4333 | [db] 59 backup_-tabeller i public-skemaet forurener genererede typer | #4478 (2026-08-31) |
| #4176 | Ejer-direktiv 24/8: samle ALLE kalender-regler i én SSOT + gate dem, saa de ikke skal laeres forfra ved hver ny kalender | #4477 (2026-08-31) |
| #4159 | [guard] game_day-aksen maa aldrig kunne skrives skaevt igen: DB-trigger + lane-packer-fix + transition-gate (ejer-krav 24/8) | #4525 (2026-08-31) |
| #4005 | [billing] /pro foer aabning: 49 kr inkl. moms eksplicit + pro-rata-forklaring ved foerste traek + copy-fejl (laering fra foerste testkoeb 25/7) | #4513 (2026-08-31) |
| #3448 | [economy] Markedsdrevne værdier: 50/50-blend søndag 9/8, ugentlig kadence, 100 % ved sæsonskiftet (ejer-beslutning 6/8) | #4421 (2026-08-31) |
| #3410 | [bug] Rytter fremstod låst i holdudtagelsen uden kendt overlap-årsag (thelamba 5/8) — genkomst af #3041? | #4504 (2026-08-31) |
| #3024 | [security/docs] Vite-dev-serveren serverer import.meta.env i hvert modul — ny secret-leak-vektor | #4481 (2026-08-31) |
| #2997 | Spis de 170 droppede Supabase-errors ned (baseline fra #2897-guarden) | #4471 (2026-08-31) |
| #2682 | AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL | #4461 (2026-08-31) |
| #2671 | [security] Forward-guard: RLS-policy-kaldte funktioner skal have EXECUTE for alle roller der rammer tabellen (2x-bidt klasse) | #4464 (2026-08-31) |
| #1819 | Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup | #4475 (2026-08-31) |
| #1146 | [Design] Shared race calendar — selection, overlap, fatigue, qualification, and assistant planning | #4323 (2026-08-31) |
| #4485 | [bug] Ungdomsklassementet inkluderer 26-aarige - raceRunner bruger wall-clock-aar fra seasons.start_date i stedet for saeson-referenceaaret | #4533 (2026-09-01) |
| #2423 | [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed Insights, cache + preview-beskyttelse | #4546 (2026-09-01) |
| #4646 | [billing/funnel] 3 af 4 startede Pro-koeb 2/9 gennemfoerte ikke: maal frafaldet og find aarsagen | #4655 (2026-09-02) |
| #4645 | [billing] Forward-guard: prisen paa /pro og prisen i Alunta skal tjekkes mod hinanden (265 vs 295 bed 2/9) | #4655 (2026-09-02) |
| #4557 | [board] Mandatet fase 2-UI: Boardroom + aarsmoede + mobil (S-M2b/c/d) | #4661 (2026-09-02) |
| #4555 | [billing] Periode-rul-vagt: ingen periode ruller uden faktura+traek uden at alarmen gaar | #4655 (2026-09-02) |
| #4521 | Ejer-direktiv 31/8: SSOT for patch notes (site + Discord) + efterkontrol siden 28/8 - foerst naar PR-backloggen er live | #4605 (2026-09-02) |
| #4514 | [billing/HOEJ] Kunde havde ubetalt faktura i 23 dage med fuld Pro-adgang - ingen alarm nogen steder | #4640 (2026-09-02) |
| #4512 | [billing] Abonnement udloeber uden fornyelsessti - current_period_end passerer mens CHECKOUT_PAUSED blokerer fornyelse | #4640 (2026-09-02) |
| #4246 | [design] Rolle og ordre siger det samme: hunter vs try_break skal afgoeres FOER TeamOrder fryses i v4 | #4606 (2026-09-02) |
| #4215 | [guard] Kalender-scorecardet skal koere automatisk i CI + saesonskifte-preflight | #4572 (2026-09-02) |
| #4123 | [infra] Kalender-invarianter som CI-gate + gylden kalender-diff (forudsaetningen kom med #4121) | #4571 (2026-09-02) |
| #4074 | [billing] EN /pro viser kroner, men Alunta opkraever DKK for alle - euro-regel + valuta-mismatch foer checkout-flip | #4597 (2026-09-02) |
| #4067 | [SEO] Offentligt Next.js-site (hybrid-split): marketing-lag, EN+/da/, keyword-titles — fase 1 af #1301/#2824 | #4659 (2026-09-02) |
| #3855 | [design] Race engine v4: intra-etape-motoren — etapen beregnes undervejs (ejer-retning 17/8) | #4610 (2026-09-02) |
| #2853 | Flip e-mail-retention-loopet live (tekst-godkendelse + 2 Railway-keys + off->dry_run->on) | #4654 (2026-09-02) |
| #2824 | [fable] Synlighed udefra: login-vaeg, sprogstier og SEO er ét problem (efter 27/7) | #4659 (2026-09-02) |
| #2806 | [monetization] /pro er ikke linket fra appen, og isPro() gater ingen funktionalitet | #4597 (2026-09-02) |
| #2760 | [growth] Reaktiverings-e-mails (win-back) til dormante brugere + GDPR-consent-audit FØRST (ejer 20/7) | #4663 (2026-09-02) |
| #1301 | SEO-fundament: cyclingzone.org skal kunne findes og rangere (epic) | #4659 (2026-09-02) |

</details>

### 2b. Epics/paraply-issues (10) — luk IKKE uden slice-tjek

| # | Titel | Merged PR (dato) |
|---|---|---|
| #3395 | [Epic] Verdensklasse-planen 2026-08: løbsdagen som teater + levende presse + levering | #3404 (2026-08-06) |
| #3564 | [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore, udviklingshastighed og logaritmisk kurve | #4207 (2026-08-24) |
| #3131 | [Epic] Financial Fair Play & Anti-Cheat — bevis, forebyggelse, detektion, håndtering | #4171 (2026-08-24) |
| #3112 | [ops] Parallel session slettede ucommitteret arbejde i delt checkout — NOW.md-claim viste falsk 'Ingen aktiv session' | #4253 (2026-08-25) |
| #621 | [ops] Sentry hardening backlog — efter #348 baseline | #4363 (2026-08-28) |
| #1464 | Forward-guard: test der fanger nye finance/enum-typer uden constraint-migration | #4458 (2026-08-31) |
| #4626 | CI-vagter mod slop: unicode-pile, text-[Npx], skygger, rounded-2xl, emoji, raa hex (slice 4 af #4622) | #4641 (2026-09-02) |
| #4622 | [epic] Designsystem til naeste niveau: taste-doc, audit af 63 sider, kit, CI-vagter, Claude Design-spejl, anti-slop (ejer 2/9) | #4657 (2026-09-02) |
| #4592 | [epic] Inaktiv manager: 30 dages login-graense, parkering ved saesonskifte, tilmeld-knap og win-back (ejer-design 2/9) | #4663 (2026-09-02) |
| #2492 | [epic] Tre-tier klubstruktur: Senior/U23/Junior med egne kalendere (addendum Fase 4-6) | #4635 (2026-09-02) |

---

## 3. Issues uden `priority:`- eller `type:`-label

Kun 3 huller i et 628-issue-korpus — label-disciplinen holder generelt. #3777 optræder også i kategori 2 (sandsynligvis løst af PR #3780).

| # | Titel | Mangler | Nuværende labels |
|---|---|---|---|
| #3777 | [proposals-drift] Forslag er anvendt i prod uden at være forfremmet | `priority:*` og `type:*` | `claude:todo` |
| #3596 | [db-health] Disk-IO/performance tærskel-brud | `priority:*` og `type:*` | `claude:todo` |
| #3204 | [bot] Perf & SEO inbox (rå) | `type:*` | `claude:todo`, `priority:med`, `perf-seo-inbox` |

**Anbefalet handling:** sæt manglende labels (formentlig `type:bug`/`type:investigation` + en prioritet) — ingen af de tre kræver research for at klassificere ud fra titlen alene.

---

## 4. `priority:low` uden aktivitet i 60+ dage (kandidater til "parkeret")

Cutoff: sidst opdateret før 2026-07-05. Alle 21 er reelt allerede *de facto* parkeret (18 af 21 bærer også `post-launch` eller er `[Epic]`-mærkede fremtidsfeatures) — listen bekræfter snarere end ændrer noget, men gør det eksplicit at de ikke er glemt aktive opgaver.

| # | Titel | Sidst aktiv | Andre labels |
|---|---|---|---|
| #94 | [Feature] Manager cross-season statistik | 2026-05-15 | type:feature,cat:user-feature |
| #78 | [Automation] Scheduled memory-konsolidering (ugentlig) | 2026-05-15 | type:feature,epic:ai-workflow,cat:ai-ops |
| #26 | [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) | 2026-05-15 | type:feature,cat:user-feature |
| #431 | Discord: Planlæg første AMA (community Q&A) | 2026-05-15 | type:feature,post-launch,needs-user-action,epic:discord-community |
| #934 | [Epic] Landshold & internationale mesterskaber (VM, EM, U23-VM, junior-VM, nationale mesterskaber) | 2026-06-04 | type:feature,post-launch,cat:user-feature |
| #904 | [chore] Migrér preview/dev til Supabase publishable key (luk legacy band-aid, follow-up #767) | 2026-06-04 | type:investigation |
| #1033 | UI/UX-beslutning: skal world/auktion/standings-headers sortere eller afklikkes? (#864) | 2026-06-05 | type:investigation,cat:user-feature |
| #1113 | Fans som spil-mekanik (popularity → effekt på økonomi/moral) | 2026-06-06 | type:feature,cat:user-feature |
| #1099 | [Epic] Omdømme/Renown-system — optjent popularity (resultater, sejre, ranglister, nationsmester, landshold) | 2026-06-06 | type:feature,post-launch |
| #1112 | Manager-omdømme (del af renown-motor) | 2026-06-08 | type:feature,cat:user-feature |
| #1109 | Manager-evner (FM-stil): forhandling, scouting, økonomi m.m. | 2026-06-08 | type:feature,cat:user-feature |
| #930 | [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeuter, kokke) | 2026-06-08 | type:feature,post-launch,cat:user-feature |
| #1177 | Holddynamik-dybde: vejkaptajner + mentor + erfaring | 2026-06-09 | type:feature,post-launch,cat:user-feature |
| #17 | [design] Lån — skal renter starte med det samme + skal gebyr betales kontant? | 2026-06-11 | type:feature,cat:user-feature |
| #306 | [obs] Instrumenter resterende ~10 events fra #137 scope | 2026-06-21 | type:feature,epic:quality-hardening,cat:user-feature |
| #1837 | [feature] Autobud/proxy-bud fra rytterprofil når man starter en auktion | 2026-06-25 | cat:user-feature,type:task |
| #1712 | Fuld 140-etaper/5-per-dag sæson-rekalibrering (post-launch) | 2026-06-26 | type:feature,shared-refactor,post-launch,cat:infra,slice:season-1 |
| #1979 | [ux] Omdøb/fjern forvirrende 'udbrud' (breakaway) etapeprofil-navn | 2026-06-29 | enhancement,type:feature |
| #2030 | [feature/ux] Race-kalender (trup-planlægning): auto-skift til næste racedag når dagens løb er kørt | 2026-06-30 | cat:user-feature,type:task |
| #1888 | [feature] Auto-push patch notes til Discord når patch notes opdateres in-game | 2026-07-04 | cat:user-feature,type:task |
| #935 | [Epic] Sociale features (venne-/follow-funktion + billeder på rytterne) | 2026-07-04 | type:feature,post-launch,cat:user-feature |

**Anbefalet handling:** ingen automatisk lukning (ingen af dem er "løst", de er "ikke nu") — men de er gode kandidater til et `parked`/`icebox`-label hvis ejeren vil separere dem visuelt fra den aktive `claude:todo`-kø, eller til den kommende sæsonskifte-oprydning nævnt i `MASTERPLAN.md` §G4.

---

## 5. Sandsynlige dubletter

Automatisk scan (token-Jaccard på normaliserede titler, tærskel 0,28-0,50) over alle 628×627/2 issue-par fandt **ingen** par over 0,50 og kun 7 over 0,28 — langt de fleste var falske positiver fra delte boilerplate-fraser ("Ejer-direktiv DD/M", `[epic]`) eller legitime epic/slice-hierarkier (fx #4620/#4621/#2492, som er tre forskellige slices af samme tre-tier-epic, ikke dubletter). Manuel gennemgang af de 7 gav:

| # A | # B | Vurdering | Evidens |
|---|---|---|---|
| #3984 | #4071 | **Reel dublet** | Begge citerer samme Discord-feedback ("19/8 kl. 11:50"): samlet manager-indstillingsområde (generelt vs. hold) + landevalg koblet til bestyrelsen. #3984 oprettet 19/8 14:04, #4071 oprettet 21/8 09:23 — 2 dage senere, samme punkt genindtastet. |
| #1147 | #1148 | Ikke en dublet | Søskende under samme parent #1145 — #1147 er det *levende feed*, #1148 er det *permanente arkiv/museum*. Bevidst adskilte features. |
| #415 | #430 | Ikke en dublet | #415 er et epic/tracker for Discord-community-opsætning, #430 er én konkret delopgave (rekruttér 2 moderatorer) under det spor. |

**Anbefalet handling:** luk #4071 som dublet af #3984 (eller omvendt — #3984 er ældst og har den mere komplette ejer-transskription i body).

---

## Masterplan-drift

`docs/MASTERPLAN.md` nævner 105 issue/PR-numre. 13 af dem er ikke længere åbne issues — men 8 af de 13 er enten (a) faktisk PR-numre citeret korrekt som PR'er (#3512, #3584, #4608, #4083 — alle "feat(...)"-titler, ingen fejl), (b) issue-numre der optræder i en anden betydning end GitHub-reference (#421 i "WebKit-#421" er en React-fejlkode i teksten om issue #4370, ikke et selvstændigt issue-link), eller (c) korrekt beskrevet som allerede afsluttet/frosset (#3138 "ENESTE værn" = eksisterende shippet guard, #3662 = historisk citat af godkendelsesissuet, #1941 = eksplicit under "FROSSET"). De resterende **5 er reel drift** — MASTERPLAN.md beskriver dem som aktive/ventende, men de er lukket:

| # | MASTERPLAN-linje beskriver det som | Faktisk status |
|---|---|---|
| #4370 | Aktivt kø-punkt 1 i S3-vinduet ("WebKit-#421 (blokerer smoke)") | Lukket (completed) 2026-09-01 |
| #3944 | "Rest" i Backlog-bølger (#3154) — endnu ikke lukket | Lukket (completed) 2026-08-29 |
| #3945 | "Rest" i Backlog-bølger (#3154) — endnu ikke lukket | Lukket (completed) 2026-08-29 |
| #4618 | "slice 0 i byg" — under opbygning | Lukket (completed) 2026-09-02 |
| #4623 | "godkendes (ejer, 15 min)" — venter på ejer-godkendelse | Lukket (completed) 2026-09-02 |

**Ingen ændringer lavet i MASTERPLAN.md** (ejer-godkendt rækkefølge, §CLAUDE.md — kun ejeren omprioriterer). Dette afsnit er alene til at gøre næste MASTERPLAN-opdatering hurtigere.

---

## Metode og forbehold

- **Fuld korpus:** alle 628 åbne issues og alle 2.056 merged PR'er (`--limit 1000`/`2100`, verificeret mod uafgrænset count).
- **Reference-parsing:** kun `Refs #N` / `Ref #N` / `Closes #N` / `Close #N` / `Fixes #N` / `Fix #N` i PR-titel eller på en linje der starter med dette nøgleord i PR-body (repo-konventionen fra `GITHUB_WORKFLOW.md`) — samt eksplicit `#N` i PR-titlen. Løs "indeholder `#N` et sted i teksten" blev forkastet efter at have givet 186 falske kandidater i kategori 2 (mod 108 med den strikse parser), primært fra Dependabot-changelog-links og versionsnumre.
- **Ikke gjort:** issue-*bodies*/kommentarer er ikke fuldtekst-gennemsøgt for dublet-lighed — kun titler (Jaccard på normaliserede token-sæt). En dybere dublet-audit ville kræve embedding-baseret lighed på body-tekst, som er ude af scope for denne READ-ONLY-kandidatliste.
- **Ingen issues lukket, mærket eller kommenteret** under denne audit.
