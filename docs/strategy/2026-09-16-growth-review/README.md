# Vækst og indtjening: beslutningspakke til 17/9

Status: backlog-capture godkendt af ejeren 16/9. **Dette er et forslag til prioritering, ikke MASTERPLAN eller build-go.** Ingen ændring af den vedtagne rækkefølge, ingen kode/deploy, annoncekøb eller spillerudsendelse i denne session.

## Start her, Claude Code

1. Læs denne plan, [dækningsregisteret](coverage-and-evidence.md) og [onboarding-designet](onboarding-design.md).
2. Læs aktuelle `docs/NOW.md` og de relevante issues' seneste kommentarer. Issue #4964 er indgangen til denne pakke; #5310 er det nye konkret dokumenterede hul.
3. Gennemgå forslaget med ejeren 17/9. Beslut hvad der skal ind i MASTERPLAN, placeringen, kapaciteten og hvad der udgår. Ændr ikke rækkefølgen på baggrund af forslag alene.
4. Hvis MASTERPLAN ændres: opdatér dens eksisterende artifact på samme URL, jf. AGENTS §34. Denne session ændrer hverken MASTERPLAN eller artifact.

Pakken er gemt på `codex/growth-plan-2026-09-16`. Der er ikke oprettet eller merget en PR. Lokalt: `.claude/worktrees/codex-growth-plan-2026-09-16/`. Hoved-checkoutets eksisterende ændringer er ikke rørt. Læs direkte i worktreen eller via GitHub-linket på #4964; skift ikke hoved-checkoutets branch med fremmed arbejde i træet.

## Formålet

Flere **aktive managers** og flere **fornyende betalere**, uden pay-to-win. En gentagelig vej fra relevant besøgende til egen spilhandling, tilbagevenden og frivilligt køb. Frameworks og antal analytics-værktøjer er ikke mål.

SSOT'er: [GROWTH_STACK](../../GROWTH_STACK.md), [ANALYTICS_STACK](../../ANALYTICS_STACK.md), [BILLING_STACK](../../BILLING_STACK.md), [EMAIL_STACK](../../EMAIL_STACK.md), [COMMS_PLAYBOOK](../../COMMS_PLAYBOOK.md). De ejer kontrakterne; denne mappe ejer alene review-materialet. Forældede statusrækker må ikke overtrumfe kode og nyere issue-evidens.

## Beslutninger fra denne session

**Valgt af ejeren:** virkeligt kommende løb, ruten først; egen udtagelse med hjælp ved behov. Første ruteskitse fik "Det ser fint ud". Fortsættelsen med udtagelse/roller/kvittering er vist, men mangler samlet endelig designgodkendelse og build-go.

**Afvist af ejeren:** ekstra introduktionsløb mod computerhold som onboarding. Begrundelse: forvirrende, urealistisk og for fiktivt. Ingen genåbning af det forslag. En særskilt spilbar demo før signup blev ikke valgt og er ikke en leverance i pakken.

**Godkendt nu:** bevar værdifulde forslag i GitHub, undgå dubletter, gem plan til Claude-review. **Ikke godkendt:** nye mål som kvalitetsgates, ændret pris-default, vendor-udfasning, ændret referral-rækkefølge, spend, udsendelse eller masterplanplacering.

## Anbefalet pakke og rækkefølge

Budgetter, effekter og stopgrænser i tabellen er **planlægningsantagelser/forslag**, ikke prognoser eller vedtagne mål. Indsatser overlapper; gevinster må ikke summeres.

| Rang | Leverance | Issue-ejer | Indsats / kontanter (antagelse) | Måling og stop |
|---|---|---|---|---|
| 0 | Afstem aktive-tal/kohorter, og reparér marketing→signup-attribution. Bevar oprindelig kilde gennem sprog/navigation/confirmation. | #4964 #5310 #3796 #3797 | 4-6 arbejdstimer; 0 kr. ekstra værktøjer | Reproducerbar kanalrapport og verificeret endelig test-attribution inden paid. Stop ved brugbar eksport, byg ikke ny dashboardfane. |
| 1 | Gennemfør allerede bygget win-back. Én mail om S4 og direkte vej til reel klubstatus/næste handling. | #2760 #4592 | 2-3 ejertimer; eksisterende mailbudget | Forslag: 8 med manuel handling og endnu et besøg inden 14 dage. Behold login/7d som sekundært mål. Ingen gentagelse af samme udsendelse ved svag effekt. |
| 2 | Sælg eksisterende Pro-værdi konkret. Verificér historik/gemte filtre, vis rigtige screenshots. Forslag: månedsplan forvalgt, halvår stadig tydeligt. | #2806 #4646 #4005 | 4-8 arbejdstimer; 0 kr. ekstra | Eksponering→checkout→betalt→fornyelse, plan/valuta, netto-MRR. Forslag +5 aktive abonnementer netto. Ved eksponering uden checkout: undersøg værdi/budskab før flere perks. |
| 3 | Første officielle løbsforberedelse: rute, kaptajn, egen trup/roller, gennemgang, gemmekvittering, faktisk starttid og eksisterende eget resultat. | #1140 #1569 #5104 #4964 | 12-24 arbejdstimer inkl. målrettet verifikation; testpersoner evt. 0-500 kr. | Fem nye testpersoner, foreslået 4/5 kan gennemføre/forklare næste skridt uden hjælp. Følg første handling og A14. Udvid ikke tutorialen uden observeret barriere. |
| 4 | Kritisk mobilopgave færdig fra start til gemning; koordinér eksisterende trænings- og tabelspor. | #1602 #5131 #4952 | 6-12 timer, overlapper onboarding; 0 kr. ekstra | Samme opgaver/enheder før/efter; ingen blockers; field/lab med n. Stop generel komponentomsætning uden fund. |
| 5 | S4-kampagne med faktiske skærmbilleder og kort optagelse. Maks to communities ad gangen. | #2236 #2759 | 4-6 ejertimer/uge til distribution; højst 500 kr. første paid-test | Fælles organisk+paid forslag: 30 signups/12 A14. Paid: <5 A14 ved 500 kr. giver >100 kr./A14, stop varianten. Dette er læringsloft, ikke rentabel CAC. |
| 6 | Færdiggør crawlbare indgange og interne links. Brug den eksisterende PCM-side; næste emne er browser/Mac/mobil/ingen download. | #4067 #3797 #1407 #4322 | 5-8 timer; 0 kr. ekstra | GSC efter 4 uger, kanal→A14 efter 8. Ingen flere sider ved nul relevant efterspørgsel trods indeksering. |
| 7 | Pilot: del faktisk etaperesultat med eget hold fremhævet, public-safe modtagerside og signup. Genbrug PNG/moment-fundament. | #1299 #2824 #1173 | 8-16 timer, separat fra første pakke; 0 kr. ny SaaS | 10 frivillige managers; forslag 3 nye A14/4 uger. Mål faktiske delinger. Stop udvidelsen hvis deling ikke bruges. |

**Samlet teknisk kerne-estimat:** cirka 25-45 timer for attribution, Pro-præsentation og afgrænset onboarding inkl. verifikation, med overlap i tabellen. Ikke inklusive alle mobilrestpunkter, SEO, offentlig resultatdeling eller driftens låste S4-arbejde. Kapacitet skal vælges eksplicit 17/9; lov ikke alt før cutover.

## Kampagnen: Din klub til sæson 4

- S4 starter **28/9**, S3 slutter 27/9 (NOW/GROWTH). Ingen falsk fresh-start-påstand om lige hold eller reset af økonomi.
- Win-back foreslås 21.-24/9 efter frisk liste, ejertekst, dry-run og separat send-go. Den tidligere måling 92 er ikke et aktuelt modtagertal. Samtykke/afmelding/bounce gælder, og parkering/tilmelding skal vises ærligt.
- Creative: reel rute+holdudtagelse, kort optagelse af kaptajn/gemning og faktisk resultat. Ingen stockfotos, falske sejre eller ikke-live features. EN først, DA derefter.
- Positionering: gratis browser-cykelmanager, egen klub, fælles sæson og konkurrence med andre managers. Spillet indeholder også AI-hold; lov ikke kun menneskelige modstandere.
- Start med eksisterende PCM-omtale/PCM.daily og Hattrick/FMFreaks. Tjek allerede postede tråde og aktuelle community-regler. Ejeren poster og svarer; AI forbereder fakta/materiale. Egen Discord hjælper genaktivering og deling.
- OnlineSportManagers: kontrollér eksisterende listing. Creator-pilot: tre relevante mindre PCM-career/tutorial-skabere på YouTube/Twitch, ikke dyrt stort cykelpublikum. FR via Le Gruppetto som lille test; ingen fuld FR/DE/NL-lokalisering forud.
- Betalt: én Facebook-test, ét budskab, én målgruppe, hårdt 500 kr.-loft. UTM verificeres hele vejen før start. Ingen budgetspredning eller automatisk opskalering.
- Ingen fast TikTok-maskine anbefales i første pakke. Det er en foreslået ændring af tidligere ønske, ikke en allerede truffet ejerbeslutning.
- 48 timer måler indgange; fulde 14 dage måler A14. Signup 28/9 er først fuldt observeret omkring 12/10; løbende kampagne kan kræve aflæsning til 19/10. Ingen succeserklæring før modenhed.

## Målekontrakt og pengene

**A14 (forslag, særskilt fra eksisterende D7):** unik menneskelig manager med mindst én manuel kernehandling både dag 0-6 og dag 7-13 efter signup. Fuldt 14-dagesvindue; ekskludér AI/test/bank/admin og deduplikér managers med flere hold. Lås præcise eventkilder/tidsgrænser og dokumentér historisk coverage før brug. Automatisk deltagelse og én login tæller ikke alene.

Kanonisk D7 i ANALYTICS_STACK er rolling kohorte-return, ikke præcis-dag-7 eller A14. Behold det eksisterende mål med sit navn. `last_seen` kan ikke genskabe en fuld historisk tidsserie af passive besøg.

- Kontantpris pr. ny aktiv = kampagneudgift / nye A14.
- Inklusive ejertid = (kontanter + timer × ejerens valgte timeværdi) / nye A14.
- Genaktiverede rapporteres separat. Lille tilfældig holdout ved win-back kan give en indikation af mer-effekt, men kræver aftale og har lav styrke.
- Pakke-arbejdsmål: 12 nye aktive, 8 genaktiverede, 5 ekstra aktive abonnementer netto. Ikke prognose; eksisterende spillerchurn kan samtidig sænke den samlede base.
- Fem ekstra fulde DKK-månedsplaner à 49 kr. inkl. moms svarer til 196 kr. normaliseret MRR ekskl. moms før gebyrer. Halvårs-cash er ikke seksdobbelte MRR. Currency, proration og opsigelser skal med i faktisk opgørelse.
- Seneste dokumenterede penge-baseline i GROWTH-loggen: 14/9, 659,33 kr. MRR ekskl. moms / 18 Alunta-abonnementer; ikke genmålt her. Brug frisk Alunta før kampagnestart. SQL-cache og Alunta skal afstemmes.

**Langsigtet levebrød (#1369):** følsomhedsmodel, ikke forecast. Antag 30.000 kr./md. til ejer+faste omkostninger og 30 kr. bidrag/betaler efter variable omkostninger: 1.000 betalere kræves; ved 5/10/15 % betalerandel af aktive svarer det til 20.000/10.000/ca. 6.700 aktive. Egne fornyelser/churn skal erstatte antagelserne. Founder-kohorten er ikke repræsentativ.

Eksempel: 10 % × 30 kr. × 12 betalte måneder = 36 kr. forventet bidrag pr. aktiv manager før faste omkostninger. En test til 100 kr./A14 kan købe læring, men er ikke skalerbar under de antagelser. Ingen prisnedsættelse, pay-to-win eller lås på nødvendige resultatforklaringer anbefales.

## Langsigtede muligheder og fravalg til review

| Emne | Anbefaling | Hvor bevares det |
|---|---|---|
| Resultatdrevet tilbagevenden | Behold D-038, afklar hændelse/fallback/samtykke/frekvens. Genbrug eksisterende mail og resultatdata. | #2853 #1140 |
| Forståelige løb og klubhistorie | Faktiske beslutninger/resultater forklares uden opfundet kausalitet; videre arbejde koordineres med D-036 og eksisterende motor/historikspor. | #1140 #2853 #3855 #1997 #1148 |
| Offentlige profiler/resultater | Delingspilot før bred publicering; fiktive navne er ikke dokumenteret søgeefterspørgsel. | #1299 #2824 #5307 |
| Referral-belønning | Ejerens Pro-tidsmodel fra 23/7 bevares. Forslaget er en simplere delingspilot først; rækkefølgen skal vælges, ikke omskrives tavst. | #1173 |
| Arkitektur | Behold Next-marketing + Vite-spil. Ingen obligatorisk Next-slutmigration. Fælles tokens/kontrakter og målte seams ved faktisk behov. Eksisterende #5249/#5250 beslutninger består. | #5307 |
| Astro | Relevant greenfield-indholdsværktøj; ingen migration af fungerende site nu. | #5307 |
| PWA/push | Bevar betinget mulighed: dokumentér behov/glemte deadlines, faktisk kanalefterspørgsel og mer-retention. Ikke afledt af mobilandel alene. | #5307; #937 forbliver lukket indtil konkret behov |
| Analytics-stack | Forslag: Postgres+GSC, GA4+Clarity, Sentry til fejl. Udfas Vercel WA og undlad mere PostHog indtil konkret beslutningsbehov. Strider mod tidligere vendorvalg og kræver derfor nyt ejer-ja. | #5305 #4321 #5055 |
| Click-ids | Bevar som senere attribution-emne; ikke blocker for korrekt UTM-test. Afklar samtykke/identifikatorer og organic-vs-paid. | #5304 |
| NPS | Ret faktisk synligheds/cooldown-fejl; ingen frekvensudvidelse uden konkret formål. Observer nye/frafaldne frem for at antage etableredes survey forklarer churn. | #5306 #1569 |
| Paid perks | Sælg eksisterende værdi først. Identitet, historik og komfort efter faktisk brug og fornyelser; aldrig konkurrencefordel. | #2806 #1369 |

## Morgendagens beslutninger (samlet, ikke flere små UI-kort)

1. Vælg den afgrænsede pakke og kapaciteten ved siden af de allerede låste S4-leverancer.
2. Beslut placeringen af eksisterende issues og #5310 i MASTERPLAN. Mål/stopgrænser i denne plan skal accepteres eller ændres.
3. Giv samlet design-go eller konkret ændringsliste til onboarding, samt test-tier og preview-accept. Ruteskitsens ja er ikke prod-release-go.
4. Beslut Pro-default, vendorforenkling og referral-rækkefølge særskilt fra allerede låste regler. Ingen ad spend eller udsendelse via blanket-go.
5. Fordel næste konkrete handlinger. Bevar én måledefinition og én issue-ejer pr. emne. Code/preview/PR hører til næste session.

## Verifikation og close-out for denne dokumentationssession

Kun docs/plan og GitHub-backlog. Patch notes, help og FEATURE_REGISTRY ændres ikke: ingen spilleradfærd, flag, feature-status eller release ændres. Ingen postmortem for en rettet bug, fordi #5310 kun er registreret. Doc-drift og de nødvendige SSOT-opdateringer er eksplicitte acceptkrav i de fremtidige issues. MASTERPLAN og artifact er urørt.
