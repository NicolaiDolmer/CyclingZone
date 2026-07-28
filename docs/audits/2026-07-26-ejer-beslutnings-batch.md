# Ejer-beslutnings-batch — 26/7 2026

> 49 issues fra `ejer_beslutning`-bucket'en i [backlog-prioriteringen 26/7](backlog-priorities-2026-07-26.md), destilleret til A/B-valg med anbefaling. Genereret 26/7 af 10 read-only analyse-agenter + orkestrator-review. **Svar i én omgang:** kopiér svar-arket nedenfor, skriv dit valg pr. linje (eller bare "følg anbefalingerne, undtagen …").

## TL;DR

- **11 af 49 kræver INGEN beslutning:** 5 er allerede leveret/afgjort og lukkes (#401, #1614, #2588, #2678, #1899 — lukket af denne session med evidens), #2910 lukkes efter cutover, #17+#976 er bevidst parkeret af dig, og #230+#1595+#1914 er besluttet men mangler ren udførelse (ingen ny stillingtagen).
- **6 haster** (påvirker S2-start eller koster penge/spillere nu): #819, #2262, #2856, #2884, #2622 (kun timing-valget), #2759.
- **Resten (32) er reelle A/B-valg uden hast** — svar når det passer; anbefaling står ved hver.

## Svar-ark (hurtigst: "følg anbefalingerne" + evt. undtagelser)

| # | Anbefaling | Dit svar |
|---|---|---|
| [#819](https://github.com/NicolaiDolmer/CyclingZone/issues/819) | A — luk reward-symmetri + genforhandlings-cap nu | |
| [#2262](https://github.com/NicolaiDolmer/CyclingZone/issues/2262) | A — byg afstand-til-loft-modellen (m. sim-gate) | |
| [#2856](https://github.com/NicolaiDolmer/CyclingZone/issues/2856) | B — fuld historik-reparation efter dry-run-fremvisning | |
| [#2884](https://github.com/NicolaiDolmer/CyclingZone/issues/2884) | A — auktionsvarighed 1→8 timer (admin-indstilling, reversibel) | |
| [#2622](https://github.com/NicolaiDolmer/CyclingZone/issues/2622) | C — udskyd poll til S2 er stabil | |
| [#2759](https://github.com/NicolaiDolmer/CyclingZone/issues/2759) | A — kør Facebook+TikTok som skrevet (tekst/budget godkendes særskilt) | |
| [#103](https://github.com/NicolaiDolmer/CyclingZone/issues/103) | A — behold nuværende adfærd | |
| [#1276](https://github.com/NicolaiDolmer/CyclingZone/issues/1276) | B — historik-purge planlægges i rolig uge efter cutover | |
| [#1441](https://github.com/NicolaiDolmer/CyclingZone/issues/1441) | A — luk/nedprioritér epicen (kernen er leveret) | |
| [#450](https://github.com/NicolaiDolmer/CyclingZone/issues/450) | A — synlig floor, taber til aktiv auktion | |
| [#1235](https://github.com/NicolaiDolmer/CyclingZone/issues/1235) | B — behold i backlog | |
| [#1237](https://github.com/NicolaiDolmer/CyclingZone/issues/1237) | A — vent til efter S2-start (bundtet m. #1235) | |
| [#1875](https://github.com/NicolaiDolmer/CyclingZone/issues/1875) | A — sæt 2 Vercel-env-vars (2 min, dit klik) | |
| [#1996](https://github.com/NicolaiDolmer/CyclingZone/issues/1996) | B — drop beta-board-reset (bekræft at ingen bruger den) | |
| [#2152](https://github.com/NicolaiDolmer/CyclingZone/issues/2152) | A — fjern død Deadline Day-kode | |
| [#2170](https://github.com/NicolaiDolmer/CyclingZone/issues/2170) | B — Monuments skal binde som alle andre løb | |
| [#2223](https://github.com/NicolaiDolmer/CyclingZone/issues/2223) | B — vent til efterår (som planlagt) | |
| [#2443](https://github.com/NicolaiDolmer/CyclingZone/issues/2443) | A — lav inventar+forslag nu (ren analyse) | |
| [#2445](https://github.com/NicolaiDolmer/CyclingZone/issues/2445) | B — vent på PAGE_TEMPLATES bølge-0 | |
| [#2452](https://github.com/NicolaiDolmer/CyclingZone/issues/2452) | B — backlog til efter cutover | |
| [#2454](https://github.com/NicolaiDolmer/CyclingZone/issues/2454) | A — godkend estimat-logikken, byg | |
| [#2678](https://github.com/NicolaiDolmer/CyclingZone/issues/2678) | (lukket — din egen 23/7-beslutning eksekveret) | ✔ |
| [#2680](https://github.com/NicolaiDolmer/CyclingZone/issues/2680) | A — sluk 4 connectors i dev-kanalen (dit klik) | |
| [#2752](https://github.com/NicolaiDolmer/CyclingZone/issues/2752) | B — byg recap tidligt i S2, klar til S2-slut | |
| [#2757](https://github.com/NicolaiDolmer/CyclingZone/issues/2757) | A — fiks fallback-stien m. samme skala | |
| [#2798](https://github.com/NicolaiDolmer/CyclingZone/issues/2798) | A — fog værdien for u-scoutede unge | |
| [#2799](https://github.com/NicolaiDolmer/CyclingZone/issues/2799) | A — acceptér + tilføj p90/p99-gates | |
| [#2813](https://github.com/NicolaiDolmer/CyclingZone/issues/2813) | A — byg vilkår+opsigelse før betaling åbnes | |
| [#2815](https://github.com/NicolaiDolmer/CyclingZone/issues/2815) | A — UI-friktion nu, gate senere hvis nødvendigt | |
| [#2760](https://github.com/NicolaiDolmer/CyclingZone/issues/2760) | A — kun eksplicit samtykke; tæl segmentet først | |
| [#2840](https://github.com/NicolaiDolmer/CyclingZone/issues/2840) | B — vent til første payroll er observeret | |
| [#2853](https://github.com/NicolaiDolmer/CyclingZone/issues/2853) | A — godkend tekster+keys nu; flip efter cutover | |
| [#2885](https://github.com/NicolaiDolmer/CyclingZone/issues/2885) | A — byg AI-opkøb efter sim (mellem-sæson først) | |
| [#2944](https://github.com/NicolaiDolmer/CyclingZone/issues/2944) | B — første balance-slice i S2, ikke nu | |
| [#3020](https://github.com/NicolaiDolmer/CyclingZone/issues/3020) | A — ren UI-fix af divisionsvælgeren | |
| [#1283](https://github.com/NicolaiDolmer/CyclingZone/issues/1283) | B — skriv founder-eksempler ved næste ægte announcement | |
| [#2688](https://github.com/NicolaiDolmer/CyclingZone/issues/2688) | Kun effort-routing (håndtag 3) | |
| [#2887](https://github.com/NicolaiDolmer/CyclingZone/issues/2887) | A — forklar designet + udvid kandidat-pulje | |
| [#2946](https://github.com/NicolaiDolmer/CyclingZone/issues/2946) | A — behold promover-først-reglen, forklar i UI | |

**Udførelses-kø uden beslutning** (besluttet tidligere, mangler kun at blive lavet): #230 (auto-annullér proxy-bud, 11/6-valg) · #1595 (slet PCM-import, 23/7-valg) · #1914 (2 help-tekst-rettelser, 23/7-valg — laves i dag hvis tid).

---

# Fulde briefs (grupperet som svar-arket)

### #401 — Migration-drift mellem schema.sql og migrationer
**STATUS: allerede afgjort OG leveret.** Ejer valgte Option B (CI-linter) 23/7. Verificeret: commit `9b7079b8` ("chore(db): migration-drift idempotency guard — CI-linter for non-idempotent DDL (#401)"), CI-job `migration-idempotency` i `.github/workflows/ci.yml`, linter `scripts/lint-migration-idempotency.mjs` findes, `docs/MIGRATIONS.md` dokumenterer reglen. → KAN LUKKES.

### #230 — Auto-annullér eget proxy-bud når det bliver overbudt over dit max
**STATUS: beslutning taget (Option A, ejer 11/6), IKKE leveret.** Verificeret i `backend/lib/proxyBidding.js`: auto-annullering findes ikke, kun "udmattet"-status. Ingen ny beslutning — kun implementering mangler.
**Indsats:** lille (1-3t). **Haster:** nej (UX-irritation, ikke penge-tab).

### #450 — Minimumspris på egne ryttere (passiv floor mod spam-bud)
**Hvad det handler om:** Spiller vil kunne sætte minimumspris på egne ryttere uden aktiv transferlistning; bud under floor afvises automatisk. Ejer har bekræftet featuren SKAL bygges (Discord 4/7, kædet med #2176). Mangler 2 design-svar: (1) synlig eller skjult floor? (2) floor vs. allerede aktiv auktion — hvad vinder?
**A:** Floor synlig + taber altid til aktiv auktion — enklest, mindst "gotcha".
**B:** Floor skjult + blokerer bud selv under aktiv auktion (Vman-model) — usynligt loft, support-henvendelser.
**Anbefaling:** A. Skjulte afvisningsregler skaber support-belastning ved 161 brugere; synlig floor er selvforklarende.
**Indsats:** mellem (dag). **Haster:** nej — kobles med #2176.

### #819 — Bestyrelsesforhandling: nedjustering af mål har ingen reel konsekvens
**Hvad det handler om:** Forhandler du et mål ned, halveres straffen men belønningen er uændret — ren fordel, ingen ulempe. Ejer har selv bekræftet det er forkert. Bonus-fund 30/6: spiller kunne genforhandle flere gange i samme periode (mod tilsigtet 1x).
**A:** Fix reward-nedjustering + lås genforhandlings-antal NU (lille, isoleret ændring i boardGoals/boardRequests) — kendt udnyttelig adfærd bør ikke stå åben ind i S2.
**B:** Vent til #955-fane-reworket — undgår dobbeltarbejde, men lader hullet stå hele S2.
**Anbefaling:** A for de to mekaniske huller (reward-symmetri + cap); UX-delen (vis tradeoffs) hører til #955.
**Indsats:** lille (1-3t) for hullerne. **Haster:** ja — aktivt opdaget spilleradfærd, S2 starter i morgen.

### #1235 — Board: forhandle mål OP (high risk, high reward)
**Hvad det handler om:** I dag kan mål kun forhandles ned. Ejer vil have op-forhandling mod højere belønning. Findes slet ikke i kode. Blev nedgraderet 13/6 ("post-20/6, ingen launch-skade").
**A:** Byg nu, bundtet med #819 + #1187-B som "board-forhandling 2.0"-pakke.
**B:** Behold i backlog — ren feature-udvidelse uden bekræftet skade; risikerer at forsinke #819-fixet.
**Anbefaling:** B. Byg som selvstændig session når #1187-B-designet tages op.
**Indsats:** mellem (dag). **Haster:** nej.


### #1996 — Ryd op i efterladt transfervindue-kode (del 2)
**Hvad det handler om:** Transfermarkedet er for længst gjort altid-åbent (del 1 shippet og merged). Der er stadig gammel kode tilbage, der indsætter og læser "vindue"-rækker i databasen, selvom de reelt aldrig bruges mere — det er bare forvirrende, ikke farligt. To småting hænger fast i den gamle kode: en nulstilling af beta-testerens bestyrelsesprofil ved sæsonskifte, og en anden automatisk sæsonskifte-cron der måske slet ikke virker længere.
**Beslutningen:** Skal du bruge 15-20 min sammen med Claude til at afklare to småting, så del 2 kan færdiggøres i én PR?
**A:** Beta-bestyrelses-nulstillingen (#805) bruges stadig → flyt den til en ny separat indstilling i samme omgang (bevarer funktionen, lidt mere kode at rydde).
**B:** Beta-bestyrelses-nulstillingen er forældet og kan droppes helt sammen med resten af oprydningen (renest, men kræver at du bekræfter at ingen bruger den funktion længere).
**Anbefaling:** B, hvis du kan bekræfte at ingen aktive beta-testere stadig er i "board-test-mode". Simplest og fjerner mest død kode på én gang. Er du usikker, vælg A — det er billigt at bevare.
**Indsats hvis besluttet:** lille (1-3t). Beslutnings-samtalen er triviel (15-20 min).
**Haster:** nej — markedet er allerede altid-åbent i praksis.

### #2152 — Skal "Deadline Day" (transfer-frist-tælleren) fjernes eller genopfindes?
**Hvad det handler om:** "Deadline Day" var en optælling til transfervinduets lukning, med drama og en badge i spillet. Nu markedet er permanent åbent, kan vinduet aldrig lukke, så tælleren kan aldrig starte — funktionen er død kode, ligger stadig i UI'et flere steder (holdside, rytterstatistik-side, admin-panel, header-badge).
**Beslutningen:** Skal den døde Deadline Day-funktion fjernes helt, eller bygges om til noget nyt der giver mening i et altid-åbent marked?
**A:** Fjern helt — endpoint, admin-UI og spillervisning ryddes ud. Renest.
**B:** Byg om til en ny deadline-mekanik (fx knyttet til sæsonafslutning) hvis "deadline-drama" stadig ønskes som fastholdelses-krog.
**Anbefaling:** A. Ingen aktiv spilleroplevelse at bevare (tælleren vises aldrig); en genopfindelse er et nyt feature-projekt, ikke en oprydning.
**Indsats hvis besluttet:** lille (1-3t).
**Haster:** nej.

### #2170 — Skal Monuments (de 5 prestigeløb) kunne kollidere med Grand Tour-etaper?
**Hvad det handler om:** De 5 "Monument"-løb er bevidst sat op til aldrig at binde en rytter til noget andet løb — en rytter kan altså "deltage" i et Monument samme dag som en Grand Tour-etape, hvilket ikke kan lade sig gøre i virkeligheden. En spiller (thelamba) har allerede rapporteret et konkret eksempel på Discord.
**Beslutningen:** Skal Monuments fortsat være undtaget fra kollisions-tjek, eller bindes ind i den normale kalender?
**A:** Behold binding-fri — status quo, ingen kodeændring.
**B:** Giv Monuments rigtige kalenderdage, så de binder som alle andre løb.
**Anbefaling:** B. Princippet "én rytter = ét løb pr. løbsdag" er ejer-låst på #2256 (10/7) — Monuments' binding-frihed er en undtagelse fra din egen regel, og en spiller har fanget konsekvensen. Bonusfund: kalenderens overlaps-tjek ser generelt kun på samme dag, ikke hele etapeløbs-intervallet — bør rettes i samme ombæring.
**Indsats hvis besluttet:** mellem (dag), mere hvis stage-race-overlap-bugget tages med.
**Haster:** delvist — jo før S2-Monuments låses, jo billigere (ellers datamigrering bagefter).

### #2223 — Rework af indbakke-UI (handling vs. information)
**Hvad det handler om:** Indbakken (beskeder om bud, transfers, bestyrelse, løb) er rodet — svært at se hvad der kræver handling vs. ren information. Ejer-ønsket omstrukturering, ligger i efterårs-planerne.
**Beslutningen:** Starte design-arbejdet nu eller vente?
**A:** Start design-session nu.
**B:** Vent til efterår som planlagt i MASTERPLAN.
**Anbefaling:** B. S2 starter i morgen; ikke tidspunktet at åbne et større UX-redesign der kræver designsamtale + godkendt mockup først.
**Indsats hvis besluttet:** stor (flere dage).
**Haster:** nej.

### #2262 — Træningshastighed for unge talenter (19-20-årige føles "dødfødte")
**Hvad det handler om:** Efter en balance-rettelse klager spillere over at 19-20-årige talenter med højt potentiale næsten ikke udvikler sig (~7-8 stigninger/sæson). Der ligger en færdig design-løsning: træningshastighed skal afhænge mere af afstand-til-loft, mindre af ren alder.
**Beslutningen:** Godkende den udarbejdede afstand-til-loft-model til implementering nu?
**A:** Godkend og byg nu — med simulering + scorecard før merge (fast proces for balance-ændringer). Problemet dobbelt-bekræftet på Discord (3/7 + 16/7).
**B:** Udskyd til efter S2 er stabiliseret.
**Anbefaling:** A. Diagnose + løsning ligger klar (spec 11/7), mærket "Fase 1 — brænder" i egen prioritering, og nye akademi-talenter rammes fra S2 dag ét.
**Indsats hvis besluttet:** stor (flere dage) — sim mod ægte population + scorecard-gate.
**Haster:** ja.


### #2760 — Reaktiverings-mails til inaktive brugere (GDPR-samtykke først)
**Hvad det handler om:** "Kom tilbage"-mails til de ~100+ dormante brugere. Første skridt: må vi overhovedet maile dem markedsføring?
**A:** Send KUN til brugere med eksplicit markedsførings-ja (email_marketing=true) — juridisk sikkert; segmentet kan være meget lille.
**B:** Send til alle dormante som "service-opdatering om din klub" (legitim interesse) — når flere, juridisk gråzone.
**Anbefaling:** A. Ved 161 brugere er GDPR-risiko ikke gevinsten værd; kør samtykke-optælling først så segmentstørrelsen kendes.
**Indsats:** mellem (dag) — infra findes; tælle-query + mailudkast til godkendelse. **Haster:** nej.

### #2840 — Løn pr. dag i stedet for engangstræk ved sæsonstart
**Hvad det handler om:** Hele sæsonlønnen trækkes i ét hug ved sæsonstart, kun for ryttere ejet i øjeblikket — sen handel belønnes forkert.
**A:** Byg dagsløn nu, før cutover — umuligt at isolere fejl når første payroll-kørsel nogensinde kører samtidig.
**B:** Vent; se hvad første rigtige lønkørsel (27/7) gør, design på reelle tal.
**Anbefaling:** B (også ejerens egen konklusion i issuet).
**Indsats:** stor (flere dage, design + sim). **Haster:** nej.

### #2853 — Sæt e-mail-loopet (welcome/day1/race-digest) i drift
**Hvad det handler om:** Automatisk e-mail-system til nye brugere er bygget og klar, men slukket. Mangler 3 ting fra dig: godkendelse af 3 mailtekster + RESEND_API_KEY + EMAIL_UNSUB_SECRET i Infisical/Railway.
**A:** Frigiv tekster + keys nu — dry-run i dag, live kort efter (Claude timer selve on-flippet til et par dage efter cutover).
**B:** Vent til efter cutover har sat sig.
**Anbefaling:** A for godkendelsen (5 minutter); flippet times efter cutover.
**Indsats:** triviel for Claude; arbejdet ligger hos dig. **Haster:** nej, men billig gevinst.

### #2856 — Historiske holdklassementer: uretmæssige vindere står stadig
**Hvad det handler om:** Hold kunne vinde holdklassementet med <3 ryttere i mål. Forward-fix er live (PR #2714, 19/7), men historikken står forkert (mindst Tour de la Loire / "Wander Riders"), inkl. point og evt. præmiepenge.
**A:** Ret kun visningen fremadrettet; lad udbetalte penge stå — mindre indgribende, uretfærdigt for de reelle vindere.
**B:** Fuld genberegning (standings + point + prize_money omfordelt) — destruktiv prod-mutation; kræver at du ser dry-run-listen (løb, hold, før/efter) og godkender.
**Anbefaling:** B efter dry-run-fremvisning. Omfanget er sandsynligvis lille (ét bekræftet eksempel).
**Indsats:** lille-mellem (dag). **Haster:** delvist — S1-historikken fryses som "endelig" ved cutover i aften; helst afklaring i dag.

### #2884 — Auktioner: længere varighed (anti-snipe findes allerede)
**Hvad det handler om:** Auktioner har reelt 1 aktiv time i prod — for kort til at spillere når at byde (ryttere relistet 6-8 gange uden bud). Verificeret i kode+DB: anti-snipe-forlængelse (bud i sidste 10 min forlænger) KØRER allerede live. Varigheden er admin-konfigurerbar i adminpanelet (System-fanen) — ingen kodeændring nødvendig.
**A:** Sæt varigheden til 8 aktive timer nu; følg andel auktioner med ≥1 bud et par dage.
**B:** Direkte til 24 aktive timer.
**Anbefaling:** A — gratis at prøve, øjeblikkeligt reversibelt.
**Indsats:** triviel (admin-panel-indstilling). **Haster:** ja — koster reelt salg lige nu.


### #2678 — Ranglister/standings åbne for alle via API
**STATUS: allerede afgjort — ejeren skrev beslutning 23/7 direkte i issuet:** "A — acceptér at de fire materialized views er offentlige, og luk." Kolonne-gennemgang viste ingen persondata; ranglister ER tiltænkt offentlige. Eneste rest-punkt (at `is_ai`-feltet afslører AI-styrede hold) er allerede routet videre til #1775. Dette issue kan lukkes — mangler kun selve lukningen (labels/close), intet teknisk arbejde.

### #2680 — Sluk unødvendige connectors i Cowork dev-kanal
**Hvad det handler om:** Dev-sessioner i Cowork/desktop loader en bunke marketing- og produktivitets-connectors (Ahrefs, Microsoft Clarity, Google Calendar, Google Drive + ~25 uautentificerede) som aldrig bruges i kode-arbejde, men stadig fylder ~4.000 tokens ved hver session-start. Kan kun slås fra i Cowork/claude.ai's connector-UI — ikke fra repoet.
**Beslutningen:** Skal ejeren bruge 5 minutter på at slå disse fra i dev-kanalens indstillinger nu?
**A:** Slå Ahrefs/Clarity/Calendar/Drive fra i dev-kanalen (behold i separat marketing-kanal) — sparer token pr. session fremover, ren opsætnings-opgave, ingen risiko.
**B:** Lad stå — koster ~4.000 tokens ekstra pr. session-start på ubestemt tid, ingen anden ulempe.
**Anbefaling:** A. Ren gevinst, ingen ulempe, tager få minutter — det eneste der holder det åbent er at det kræver et UI-klik uden for Claude Code.
**Indsats hvis besluttet:** trivial (<1t) — men kun ejeren kan udføre det (UI-klik).
**Haster:** nej, men billig sejr — kan gøres når som helst.

### #2752 — Sæson-afslutning føles usynlig (ingen recap/"årbog")
**Hvad det handler om:** Når en sæson slutter, "falder" spilleren bare ind i næste sæson uden nogen fejring — ingen opsummering af hvor man endte, op/nedrykning eller højdepunkter. Data findes allerede (`SeasonEndPage`), men der er ingen aktiv flade der viser det, og `/seasons` viser en tom side lige efter sæsonskifte i stedet for at vise den netop afsluttede sæson.
**Beslutningen:** Skal denne feature bygges nu (kræver UI-mockup til godkendelse først, jf. hard rule), eller vente?
**A:** Byg nu — kræver mockup-runde + implementering (flere dage), men rammer præcis det tidspunkt hvor sæson 1 lige er afsluttet og sæson 2 starter i morgen, så "øjeblikket" er relevant lige nu.
**B:** Udskyd til efter sæson 2's opstart er landet roligt — spillerne mister ikke noget kritisk, kun en følelsesmæssig finpudsning; kan bygges før sæson 2 SLUTTER i stedet.
**Anbefaling:** B. Sæson 2 starter i morgen — der er ikke tid til en mockup-godkendelses-runde + build før den deadline, og featuren er "nice, ikke kritisk". Book den tidligt i sæson 2-perioden i stedet, så den er klar når sæson 2 afsluttes.
**Indsats hvis besluttet:** mellem (dag) — mockup + implementering.
**Haster:** nej — ingen spiller mister funktionalitet ved at vente; det er en oplevelsesforbedring.

### #2757 — Pointtrøjen: bakke-/bjergetaper vægter for højt på sprintpoint
**Hvad det handler om:** Klager fra en spiller (Discord, zootne) om at man kan vinde 2 flade etaper og alligevel tabe pointtrøjen til en klatrer. Ejeren undersøgte selv 23/7: for løb MED rutedata (sæson 2 fremadrettet) er det allerede fikset og shippet (#2770/PR #2777, verificeret med dry-run). Problemet består kun for løb UDEN rutedata (endagsløb + al sæson 1-historik) — dér falder koden tilbage til én flad pointtabel uanset etapetype, hvilket er præcis symptomet.
**Beslutningen:** Skal fallback-stien (`raceRunner.js:402`) også skaleres efter etapetype, eller er det acceptabelt at kun rutedata-løse etaper (arv + endagsløb) beholder den gamle flade model?
**A:** Fiks fallback-stien til at genbruge samme `GREEN_FINISH_SCALES` som rutedata-løsningen — konsistent regel overalt, lille kode-ændring (genbrug af eksisterende tabel).
**B:** Lad fallback stå som den er og dokumentér eksplicit at kun rutedata-løse etaper er undtaget — mindre arbejde, men inkonsistent regel som kan give ny spiller-forvirring på endagsløb.
**Anbefaling:** A. Sæson 2-løb får rutedata og er allerede løst, så dette rammer kun endagsløb/arv — men det er samme kode-genbrug, ingen ny logik, lav risiko og lukker hullet helt i stedet for at efterlade en undtagelse man skal huske at forklare.
**Indsats hvis besluttet:** lille (1-3t) — genbrug eksisterende skala-tabel + dry-run-verifikation mod S1-data (allerede delvist krævet i acceptkriterierne).
**Haster:** nej for sæson 2's etapeløb (allerede dækket), men bør afklares før mange endagsløb/legacy-scenarier rammer samme klage igen.

### #2759 — Facebook-annoncer + organisk TikTok-markedsføring
**Hvad det handler om:** Ejer-direktiv om at starte betalt Facebook-annoncering og organisk TikTok-indhold for at tiltrække spillere. Kræver konkret arbejde: annonce-udkast, målgruppe, budget-anbefaling til Facebook; content-format + 2-ugers kalender til TikTok. En tidligere dublet (#1114) tilføjede at betalt annoncering muligvis er bredere end kun Facebook (Google/Reddit/YouTube) og bør koordineres med den eksisterende TdF-launch-plan — det er endnu ikke overført til dette issue.
**Beslutningen:** Skal arbejdet startes nu, og skal scope udvides til flere kanaler end Facebook, eller holdes snævert?
**A:** Kør #2759 som skrevet (kun Facebook + TikTok) og opret evt. separat issue for Google/Reddit/YouTube senere — hurtigere at komme i gang, mindre risiko for scope-kryb lige før sæson 2.
**B:** Udvid #2759 nu til at inkludere "kanaler + budget TBD" og Discord/waitlist-koordinering før arbejdet startes — mere sammenhængende growth-plan, men udskyder start.
**Anbefaling:** A — men husk at lægge den påkrævede overgangskommentar på #2759 (nævnt i issuets egen kommentar) før #1114 lukkes, så den bredere kanal-tanke ikke går tabt. Snævert scope nu, bredere plan som opfølgning, undgår at annoncestart bliver gidsel af en stor markedsførings-strategi-diskussion.
**Indsats hvis besluttet:** mellem (dag) — udkast til annoncetekster/målgruppe + content-kalender er tekstarbejde, ikke kode, men kræver flere runder ejer-godkendelse før noget går live.
**Haster:** ja — direkte ejer-direktiv (20/7); spillet har kun 161 brugere. Selve annoncerne går ikke live uden ejerens eksplicitte godkendelse af tekst og budget.


### #103 — Bestyrelses-flerårsmål: tidlig opfyldelse
**Hvad det handler om:** Boardet kan sætte flerårige mål (fx "15 etapesejre over 3 sæsoner"). Opfylder du HELE målet efter sæson 1 af 3, sker der ingenting — ingen bonus, ingen genforhandling. Spilleren cybersimon rejste det i maj og lovede et forslag der aldrig kom.
**A:** Behold nuværende adfærd — nul arbejde; tidlige opfyldere får ingen anerkendelse i 1-2 sæsoner.
**B:** Lille bonus ved tidlig 100 %-opfyldelse (engangs-CZ$ eller satisfaction-boost) — et par timers arbejde.
**Anbefaling:** A for nu. Flerårsmål aktiveres først for alvor i S2; ingen spiller rammer scenariet endnu. Genoptag ved konkrete klager.
**Indsats:** lille (1-3t) hvis B senere. **Haster:** nej.

### #1276 — Ægte rytternavne (PCM-dump) stadig i git-historikken
**Hvad det handler om:** PCM-fil med 8.699 rigtige rytternavne blev committet til det offentligt læsbare repo. Filen er fjernet fra nutiden (PR #1986, 29/6) men kan STADIG hentes intakt fra gamle commits (verificeret i dag). Fuld historik-purge (git filter-repo) er aldrig kørt.
**A:** Kør fuld historik-purge + force-push-koordinering — lukker hullet helt; invasiv, kræver at ingen anden session/klon arbejder samtidig.
**B:** Lad stå — synligheden er væk fra HEAD; restrisiko kræver aktiv graven i historik.
**Anbefaling:** B for nu, med forbehold: planlæg purgen i en rolig uge EFTER cutover (force-push midt i cutover-ugen er højrisiko-timing). Luk ikke issuet — omdater det til den planlagte purge.
**Indsats:** stor (dedikeret session) for A · trivial for B. **Haster:** nej.

### #1441 — Epic: langsigtet økonomi-redesign
**Hvad det handler om:** Paraply for sund langsigts-økonomi. Kernen er ALLEREDE leveret: Fase 1 anti-inflation merged 17/6, Fase 3 A1+A2 (faciliteter+staff) merged 5/7, Klub-UI 10/7. Eneste udestående af oprindeligt scope: Fase 2 "rigtige, forhandlbare sponsorkontrakter" — ikke påbegyndt.
**A:** Luk/nedprioritér epicen; behold delspor som selvstændige issues; drop "rigtige sponsorer" som eget scope indtil videre.
**B:** Fortsæt til Fase 2 — kræver ny design-session + implementering.
**Anbefaling:** A. Kerneproblemet (inflation) er løst og verificeret med scorecards.
**Indsats:** trivial for A · stor for B. **Haster:** nej.

### #1614 — STATUS: allerede leveret → CLOSE (se verify-listen).
### #2588 — STATUS: allerede leveret → CLOSE (se verify-listen).


### #2798 — Markedsværdien afslører rytternes skjulte talent
**Hvad det handler om:** Efter v4-værdimodellen (live 18/7) kan enhver se en ung rytters skjulte potentiale via markedsværdien — værdien er en matematisk funktion af potentialet. To spillere har selv opdaget det på Discord: scouting er blevet et opslag. Underminerer scouting-søjlen (#1138).
**A:** Fog/tilslør værdien for u-scoutede unge ryttere (interval der indsnævres med scouting) — bevarer motoren og scouting-følelsen; kræver dækning af ALLE værdi-flader.
**B:** Offentlig "synlig værdi" uden potentiale + intern fuld værdi til AI-bud/løn — renere skel, to parallelle værdibegreber at vedligeholde.
**C:** Acceptér lækagen, læg scouting-mekanikken død — billigst, men smider en bevidst søjle væk.
**Anbefaling:** A. Bevarer den byggede spilfølelse; det er et dæknings-, ikke arkitekturproblem.
**Indsats:** stor (flere dage) — fuld backwards-check + inverterbarheds-test. **Haster:** nej.

### #2799 — Markedsværdier eksploderede i toppen efter v4
**Hvad det handler om:** v4-checket kiggede kun på medianen (+0,4 % = fint), men enkeltryttere steg 50-60x (350k → 22M). Nye hold (500k startkapital) vs. etablerede trupper (20M+) — community kalder afstanden uindhentelig.
**A:** Acceptér spredningen som konsekvens af "elite skal være ukøbelig i flere sæsoner" (din egen 14/7-beslutning) — tilføj p90/p99-haledrifts-gates så det ikke sker overrasket igen; løs nye holds ulempe via #1981.
**B:** Re-kalibrér skalaen (dæmp toppen) — kræver sim + ejer-godkendelse før endnu en global omregning.
**Anbefaling:** A nu, B senere hvis data viser skade. Gaten er den billige, forebyggende del.
**Indsats:** lille (1-3t) for gates; stor for re-kalibrering. **Haster:** gate snarest; re-kalibrering nej.

### #2813 — CZ Pro mangler handelsbetingelser + opsigelsesknap
**Hvad det handler om:** Abonnement sælges uden handelsbetingelser, fortrydelsesret-oplysning eller selvbetjent opsigelse (Forbrugeraftaleloven kræver oplysning FØR aftalen). 0 aktive abonnementer pt., men fladen er live.
**A:** Byg nu, før betaling reelt åbnes — du skriver/får skrevet vilkårs-tekst; Claude bygger side + accept-checkbox + opsigelsesknap parallelt.
**B:** Udskyd til lige før #1903 (Alunta) er klar — risiko for at det glemmes og blokerer betalings-launch.
**Anbefaling:** A — kun tekst-delen kræver din tid; teknikken kan ligge klar.
**Indsats:** mellem (dag) for teknik + din jura-tekst. **Haster:** før #1903 går live.

### #2815 — Nye hold kan låne sig til dobbelt startkapital på minutter
**Hvad det handler om:** "Brug maks"-knappen lader et splinternyt hold optage fuldt gældsloft i minut ét (888k-1.082k vs. 500k start). To prod-hold gjorde det (7 og 10 min efter oprettelse) og sidder nu tømte med maks-gæld.
**A:** UI-friktion nu (bekræftelsesdialog m. afdrag pr. sæson, fjern evt. "brug maks") — lav risiko, ingen balance-ændring.
**B:** Rigtig gate (tidsspærre/aktivitetskrav/gradvist loft) — løser det for alvor, balance-følsomt, kræver sim.
**Anbefaling:** A nu, B som opfølgning hvis A ikke rækker. Retention-problem for nye spilleres første indtryk.
**Indsats:** triviel-lille for A; mellem-stor for B. **Haster:** højt snart (ikke i aften).

### #2910 — Trætheds-nulstilling ved sæsonskifte
**STATUS: allerede afgjort/leveret.** Ejer valgte 26/7 kl. 06:55 fuld nulstilling; PR #2985 merged, flag on (mode full), idempotens-tests. Lukkes efter cutover når AVG(fatigue)=0 er verificeret (står allerede i NOW.md post-cutover-listen).


### #1237 — Bestyrelsen dømmer gæld forkert (tæller kun antal lån)
**Hvad det handler om:** Board-økonomivurderingen straffer for antal lån uanset likviditet (boardUtils.js:72-75, verificeret). Spiller med grønt regnskab oplever bestyrelsen som urimelig. Discord-klage findes.
**A:** Vent til efter S2-start — balance-følsomt, kræver dry-run-sim; ingen sidste-øjebliks-risiko.
**B:** Hurtig konservativ patch nu (loan-straf halveres hvis saldo ≥ restgæld) — mod simulér-før-ship-reglen.
**Anbefaling:** A. Var allerede bundtet med #1235 i én simuleret pakke (11/6) og af-blockeret 13/6. Første post-launch-opgave.
**Indsats:** mellem (dag). **Haster:** nej.

### #1595 — Fjern gammel PCM-resultat-import-kode
**STATUS: afgjort 23/7 (Option B: slet import-pipeline, behold stat-kolonner) — IKKE leveret.** pcmResultsImport.js m.fl. + /admin/import-results-pcm står urørt. Ren udførelsesopgave (lille-mellem PR); issuet anbefaler selv at vente med endpoint-fjernelse til WS1 stage-automatisering er bevist på beta.

### #1875 — Gør PR-previews klikbare uden login (2 min i Vercel-dashboard)
**Hvad det handler om:** Preview-URL'er virker halvt (ingen login/data). Mock-flaget findes i koden; mangler kun 2 env-vars i Vercel (Preview-scope). Har allerede kostet en konkret verifikations-omvej 23/7. CORS-delen er fixet (#2427).
**A:** Sæt VITE_PREVIEW_MOCK=1 + sentinel-URL nu — alle fremtidige PR-previews bliver klikbare demoer; gør previews sikrere (kan ikke ramme prod-DB).
**B:** Fortsæt uden — screenshots/lokal test pr. UI-PR.
**Anbefaling:** A. <2 min engangs-handling, ingen kode-risiko, har allerede bidt én gang.
**Indsats:** triviel (kun dig, Vercel-dashboard). **Haster:** nej, men billig.

### #1899 — Løbsdage-tal (60 vs 140)
**STATUS: reelt løst/irrelevant.** 140-generatoren blev aldrig merged; S2 har via #2449 præcis 28 løbsdage i alle 4 tiers (målt 23/7). Ingen fejlkalibrering. Valgfri rest: fjern død DEFAULT_RACE_DAYS_TARGET=60-konstant i seasonRaceSelection.js. → tæt på CLOSE-kandidat (evt. luk m. oprydnings-note eller lav triviel oprydning først).

### #1914 — To help-tekst-fejl (afgjort 23/7 — IKKE leveret)
**STATUS: afgjort — ren udførelse.** (1) "3 fokus-slots"-tekst skal væk (træning er unlimited): help.json EN linje 884 står stadig. (2) Divisions-tabel skal vise alle 4 divisioner: linje 456-464 viser stadig kun 1-3. Opdatér EN+DA. → KAN UDFØRES NU (triviel PR).


### #2443 — Menu-rework: menuen matcher ikke sidernes fane-struktur
**Hvad det handler om:** Menuen er vokset organisk (dublet "Løb"/"Holdudtagelse", manglende Holdstrategi-link). Ejer bad 13/7 om side-inventar + kategoriseringsforslag til godkendelse FØR byg. Orkestrator-note 23/7: selve ombygningen skal bruge PAGE_TEMPLATES bølge-0-primitiver.
**A:** Lav inventar+forslag nu — ren analyse, kan ligge klar mens bølge-0 bygges parallelt.
**B:** Vent til bølge-0 er færdig — hele projektet i bero.
**Anbefaling:** A. Research koster intet at have klar; afkobler ejer-godkendelsen fra skabelon-arbejdet.
**Indsats:** lille (1-3t for forslag; implementering separat, større). **Haster:** nej.

### #2445 — Responsivt layout: sider spilder plads på store skærme
**Hvad det handler om:** Sæsonplanlægger, økonomi, bestyrelse, dashboard udnytter ikke skærmen (audit 15/7 målte det konkret — dashboard = 7 skærmfulde på mobil pga. lg:-breakpoint). Intet redesign-forslag lavet endnu.
**A:** Byg forslag nu ift. nuværende komponenter — hurtigere, men risiko for omarbejde når skabelonerne lander.
**B:** Vent på PAGE_TEMPLATES bølge-0 (T1/T2) — designet bliver rigtigt første gang.
**Anbefaling:** B. Præcis den type sider skabelon-systemet (#2849, bindende) er bygget til.
**Indsats:** mellem-stor (dage). **Haster:** nej.

### #2452 — Auktions-gebyr: gratis under 50 % af værdi, gebyr over
**Hvad det handler om:** Gratis at udbyde en rytter op til 50 % af værdien, gebyr derover — mod fantasipris-spam på markedet. Intet design lavet; issuet kræver research (FM, Hattrick) + gebyr-forslag + balance-sim før ship.
**A:** Start designarbejdet nu.
**B:** Backlog — markedsstøj er irriterende, ikke akut skadelig.
**Anbefaling:** B indtil efter S2-cutover; balance-følsomt, kræver research+sim.
**Indsats:** mellem-stor. **Haster:** nej.

### #2454 — Potentiale-skala: fra 1-6 stjerner til 1-99
**Hvad det handler om:** Potentiale skal på samme 1-99-skala som resten af spillet. Hovedbeslutning ER truffet (ejer 15/7): DB får eksakt 1-99-tal; spilleren ser KUN spejderens estimat som et upræcist/forskudt interval. Ikke implementeret. Tre finjusterings-parametre afventer ejer-nik: hvor forskudt må estimatet være, hvad styrer intervalbredden, og er estimatet stabilt pr. observation (ingen reroll-til-facit).
**A:** Godkend forslaget som det står — byg nu.
**B:** Bed om justering før byg.
**Anbefaling:** A. Forslaget matcher ejerens krav; bias-fordelingens form er en konstant der kan skrues på senere, ikke arkitektur.
**Indsats:** mellem (migration + estimat-generator + backwards-check på 5 flader + patch note/help). **Haster:** nej, men låser #1138 som kernemekanik.

### #2622 — Auto-udtagelse fylder hele sæsonen automatisk (8.841 entries)
**Hvad det handler om:** Auto-fill udtager trupper for ALLE sæsonens løb hver time. Spillerklager ("hvorfor er min trup udtaget for hele sæsonen?"). Claude-analyse 18/7 + løsningsforslag (menneske-hold kun 2 løbsdage frem, AI uændret). Ejer besluttede at spørge spillerne via Discord-poll først — pollen er ALDRIG postet (udkast ligger i issuet, EN+DA).
**A:** Post pollen nu og beslut efter kort frist — risikerer få svar i cutover-støjen.
**B:** Spring pollen over, implementér anbefalingen direkte — tilsidesætter din egen "spørg spillerne først"-beslutning.
**C:** Udskyd helt — behold bred auto-fill gennem cutover, post pollen når S2 er stabil.
**Anbefaling:** C. Ikke S2-blokerende; en poll dagen før sæsonstart drukner og giver dårligt datagrundlag.
**Indsats (efter poll):** mellem (horisont-parameter + dry-run-scorecard). **Haster:** kun timing-valget.


### #2885 — Salg af uønskede ryttere til AI'en efter mislykkede auktioner
**Hvad det handler om:** Med 41 aktive managere ender ryttere i auktion 6-8 gange uden ét bud — spilleren sidder fast med rytteren og lønnen løber. Forslag (spiller, Discord): AI køber rytteren for en brøkdel af værdien efter N reelt mislykkede auktioner.
**A:** Byg den — reel udvej, sunde trupper; risiko: for høj AI-pris undergraver markedsværdi-systemet → kræver økonomi-sim før ship.
**B:** Vent — løs markedsproblemet via mere attraktive auktioner i stedet; risiko: spillere sidder fast imens.
**Anbefaling:** A, men kun efter sim mod ægte population. Pris som brøkdel af `current_production_value` (ikke market_value), begrænset til mellem-sæson først.
**Indsats:** stor (flere dage). **Haster:** nej.

### #2944 — Styrt føles for hårde og for hyppige
**Hvad det handler om:** Styrt = intet resultat overhovedet (binært), selvom virkelighedens ryttere ofte kører videre med tidstab. Klager: en hel sæsons GC-kamp kan afgøres af ét styrt.
**A:** Byg graduerede styrt-udfald (tidstab/skade/DNF) + juster frekvens — rører løbsmotorens kerne, kræver sim.
**B:** Vent til efter S2-start — undgå kernemotor-ændring lige før sæsonstart.
**Anbefaling:** B for nu; planlæg som første balance-slice i S2 (simulér-før-ship-reglen gælder).
**Indsats:** stor (flere dage). **Haster:** nej nu, men tidligt i S2.

### #3020 — Divisionsvælgeren i sponsor-tilbud viser det forkerte tal
**Hvad det handler om:** Divisionsvælgeren i sponsor-tilbud ændrer kun rate-pr-etape, ikke den reelle indtjening (divisions-loftet 600k D1 vs 315k D4 vises slet ikke). Spilleren tror han sammenligner divisioner, men ser det ene tal der IKKE varierer.
**A:** Ren UI-fix (omdøb vælgeren til "se rate ved X etaper" + fjern den for andre divisioner) — billigt, ingen balance-risiko.
**B:** Lad divisionen reelt prissætte tilbuddet — svarer på spillernes egentlige spørgsmål, men er en økonomi-ændring m. sim-krav.
**Anbefaling:** A.
**Indsats:** lille (1-3t) i SponsorOfferModal. **Haster:** nej.

### #17 — Lån: renter og gebyr-design
**STATUS: allerede afgjort — bevidst udskudt.** Ejer 11/6: gæld/økonomi gennemgås samlet med #97-enforcement når relaunch-økonomien har data. Parkeret, ikke glemt. Ingen handling.

### #976 — Slå "Min Aktivitet" sammen med Indbakke + Transfers
**STATUS: retning allerede låst (ejer 8/6+11/6), afventer eksekvering.** Post-launch-polish-milestone. Kun timing udestår, ikke om.


### #1283 — Founder-stemme: du skal skrive kalibrerings-eksempler
**Hvad det handler om:** Claude-skrevet founder-tekst rammer ikke din tone. TONE_OF_VOICE.md har allerede founder-skabelonen ([FOUNDER-PROSA]-markering, 21/6). Mangler kun: 2-3 eksempeltekster skrevet af DIG som AI kan kalibrere imod.
**A:** Book en isoleret skrive-session nu — låser tonen tidligt.
**B:** Skriv eksemplerne "in the moment" ved næste rigtige announcement — mere autentiske end øvelsestekster.
**Anbefaling:** B. Ingen presserende afsendelse; øvelsestekster rammer typisk dårligere.
**Indsats:** triviel (din skrivetid). **Haster:** nej.

### #2688 — AI-arbejdsgang: opgradere Fable-brugen (4 håndtag)?
**Hvad det handler om:** Fra AI-audit 19/7: (1) strengere kryds-tjek af fund, (2) judge-paneler ved svære balance-valg, (3) effort-routing (mindre AI-kraft på simple opgaver), (4) ultra-review af store PR'er. Intet er sat i gang.
**A:** Start med effort-routing (gratis) + ét judge-panel-pilot på en konkret balance-sag (#2645B).
**B:** Skip helt for nu.
**Anbefaling:** Kun effort-routing — gratis, ingen ny infrastruktur. Resten når et konkret behov opstår.
**Indsats:** lille (1-3t). **Haster:** nej.

### #2887 — Sportsdirektørens "senior-træning"-stat gør intet for ryttere forbi peak
**Hvad det handler om:** Verificeret i koden (riderProgression.js:204+244): træning påvirker KUN vækstfasen (alder ≤ peak 28); fald kører altid uændret. Senior-træning virker altså kun for 26-27-årige i vækst — bevidst designvalg (eksplicit kommenteret), men ukommunikeret. Sideklage: for få sportsdirektør-kandidater.
**A:** Behold motoren; ret kommunikationen i UI/hjælp + udvid kandidat-puljen.
**B:** Giv senior-træning reel effekt på decline-kurven — kræver ny balance-sim, bred holdstyrke-påvirkning.
**Anbefaling:** A. Koden viser bevidst design; det mangler bare forklaring. Kandidat-udvidelse uanset (ren friktion uden downside).
**Indsats:** lille (1-3t) for A; stor for B. **Haster:** nej.

### #2946 — Skal akademi-ryttere kunne sælges direkte?
**Hvad det handler om:** I dag skal akademi-ryttere promoveres til seniortruppen før salg. Gatet er bevidst bygget (dedikeret academyTransfer/academyGraduation-logik). Direkte salg ville interagere med to kendte huller: #2699 (overprisede overflow-talenter) og #2881 (kontrakt-nulstilling ved promovering).
**A:** Behold reglen som bevidst friktion — forklar i UI/hjælp.
**B:** Tillad direkte salg — kræver #2699+#2881 løst samtidig.
**Anbefaling:** A nu; genovervej B når #2699/#2881 er lukket.
**Indsats:** triviel for A; stor for B. **Haster:** nej.

