# Startprompt: pc1 lang session 17-18/10 (ejeren er primært væk)

Kopiér alt under linjen ind i en ny Claude Code-session på pc1 (mappe `C:\dev\CyclingZone`). Sessionen må køre over 20 timer og lave langt over 50 opgaver.

---

Ny lang session på pc1, lørdag 17/10. Kør `git pull --ff-only` og `npm run sync-deps`, og læs `docs/NOW.md` og denne fil helt. **Svar på dansk i ALLE beskeder, også korte.** Jeg giver eksplicit opt-in til multi-agent-orkestrering via wave.js. Du er den eneste aktive session og ejer merge-køen.

## Mission

Løft CyclingZone markant på de svageste områder:
1. Sæsonskiftet 25/10 skal være fejlfrit.
2. Motoren skal være realistisk.
3. Spillerne skal klikke og scrolle mindre; det mest brugte skal være lettest at finde.
4. Platformen skal holde til 10x managere.
5. Backloggen skal langt ned.

Udfordr status quo: spørg hele tiden "hvad ville et spil i verdensklasse gøre her?" og vælg den langsigtede, professionelle løsning frem for den hurtige. Vælg helst ting, der allerede er designet og godkendt, så du kan arbejde selvstændigt.

**Succes ved sessionens slut**
- Alle merge-klare PR'er er merget eller har en dokumenteret grund til at vente.
- `s5_profiles_v2` er klar med tænd-kort.
- Sæsonskiftets generalprøve og lasttesten er kørt med rapport.
- Mindst 30 lukkede eller done-flippede backlog-issues.
- Et UX-kort med faner/klik-forbedringer til mig.
- Idébanken har sine top 5.

## Rammer (ejer-godkendt 17/10)

- **Kapacitet:** fuld bølge (`wave.js`, pc1-loftet 6 laner, semafor 2). opus på motor, DB, penge og sikkerhed; sonnet på UI og ops; Haiku kun skema og efterkontrol. `model` står eksplicit på hver agent. Mange tokens er OK; meld anomalier proaktivt.
- **Merge-mandat, regel 35:**
  - Tekniske PR'er og motor bag en slået-fra revision merges ved grøn CI + review-gate.
  - UI og spillertekst venter på mit visuelle go: ét annoteret før/efter-PNG pr. PR, samlet i kort.
  - Flag-flip, tænding og prod-dataændringer kræver ALTID mit ordrette "tænd"/"kør" pr. skridt, efter jeg har set tallene.
- **Kontakt:** kun ved beslutninger.
  - Saml dem op og send dem som kort med PNG (SendUserFile) og én anbefaling, gerne flere beslutninger i ét kort, så jeg kan svare hurtigt fra telefonen.
  - Ellers en kort status hver 4. time (PushNotification).
  - Jeg svarer sjældent; arbejd videre på alt andet, mens du venter.
- **Nye idéer:** byg kun det, der står her eller allerede er designet og godkendt. Alt andet går i idébanken (afsnit 9).

## Før HVER opgave: tjek om den allerede er lavet (obligatorisk)

1. Læs issuets seneste kommentarer.
2. Søg i merged PR'er (`gh pr list --state merged --search "<nr> in:title"` og `in:body`) og i `git log origin/main --grep`.
3. Grep koden for løsningen.
4. Tjek NOW.md og andre sessioners noter fra samme døgn.

Er den lavet → luk eller done-flip med evidens. Delvist lavet → byg kun resten. Tidligere fund: falske done→todo-flips, dobbeltarbejde mellem sessioner, issues der var løst i en PR med nummeret i titlen.

## Faldgruber fra tidligere store sessioner (læs `.claude/learnings/` ved tvivl)

- **Venteløkker:** test matchet mod det faktiske output i forgrunden, før løkken startes, og tjek den selv efter 5 min. 17/10 ventede en løkke 50 min på en tekst, den aldrig kunne se.
- **Én merge-kø-proces ad gangen**, aldrig kædede ventere. MERGED ≠ køen færdig ≠ live (vent på deploy-verify). Læs aldrig "STOP" som færdig.
- **Merge ikke backend midt i en etapeafslutning:** tjek `race_stage_schedule` og merg uden for ±15 min om etape-ticks (2026-09-04).
- **Workers:**
  - Preflight og tests i FORGRUNDEN.
  - Push hvert 15. min. 45 min tavshed → status, +15 → stop og recovery i samme worktree.
  - Timeout er ikke frys (læs branch-aktivitet).
  - Læs workerens review FØR merge.
- **Worktrees:**
  - Aldrig `npm ci` i en worktree; brug `scripts/setup-worktree.ps1 -Rebuild`.
  - Hovedmappen skifter aldrig branch.
  - Commit kun bag guarden og aldrig `--no-verify`.
- **To writers aldrig på samme filer.** Semantiske konflikter mellem parallelle PR'er (2026-09-25). Nye CI-gates rammer parallelle PR'er (2026-09-23).
- **Registry:** flytter du en post til live, så fjern den fra `scripts/feature-registry-flag-expiry-baseline.json` i samme commit.
- **Codex-stopregel:** efter 2. runde → opfølgnings-issue, og merge ved grøn CI.
- **Driftsrisici:**
  - API-udfald dræner køen; kør i små bidder med retry.
  - GitHub-runnere kan sulte; prioritér PR'erne.
  - Hold pc1 vågen (`request_keep_awake`); Windows-opdatering dræbte en natbølge.
- **Kontekst:** al state bor i sessionens samle-issue og NOW.md, ikke i chatten, så komprimering ikke taber noget. Opdatér samle-issuet efter hver milepæl.
- **Hard rule 17 i briefs:** balance-tal kun i `balance-internals/`.
- **Patch notes:** bølge-PR'er har ingen patch note; den samles ved close-out.

## 0. Start og verifikation (første time)

1. **S5 er tændt (#6699, merget 17/10 08:48).** Fra 13:00 dansk tid skal nye løb binde til `s5_profiles_v1` (`races.engine_rules_revision`) uden Sentry-fejl. Søndag kl. 11:00 skal Vuelta Ibérica (4963a82d) binde til S5. Afvigelse → STOP og meld.
2. Sentry 24 t + Supabase advisors (udokumenteret WARN > 7 dage er forbudt). Kendt: #6504.
3. Opret sessionens samle-issue med alle spor herunder som tjekliste.
4. `request_keep_awake`.

## 1. Merge det, der allerede ligger som PR'er

Gennemgå alle åbne PR'er (`gh pr list --state open`). For hver: tjek mod main, CI, review-gate og hvad der mangler. Merg straks det, der må efter regel 35. Kendt status 17/10:
- **#6703/#6704** (træning; draft): mål effekten i prod read-only før/efter (brand-regel a). Merg ved grøn CI, eller skriv hvad der mangler.
- **#6680** (kalender-kort, bag `race_library_v2` slået fra): nye billeder (det gamle viser den afviste strimmel) → kort til mig. Teknisk kan den merges bag flaget efter regel 35 (b/c), når billedet er godkendt.
- **#6636/#6634:** lukkes, når tabelvisningen er genbrugt (Monday-planen). Byg det, hvis det er designet.
- **Venter på mig:** #6665 forside, #6643 løbshistorie-beta, #6248 træningsregel. Rør dem ikke, men bring dem ajour med main, så de er klar.

## 2. Sæsonskifte 25/10 uden fejl + klar til 10x managere

1. **Fuld generalprøve af sæsonskiftet** som tørkørsel mod en kopi af prod-data:
   - aldring/pension (#5833, plan `docs/superpowers/specs/2026-10-16-5833-foedselsdage-aldring-pension-plan.md`)
   - oprykning/graduering
   - kontraktudløb
   - bestyrelse (#6130 nye hold uden mandat, #6122, #5849)
   - akademi
   - præmier og økonomi
   - S5-kalenderen 28/10

   Ingen prod-skrivning; brug eksisterende staging og ingen nye løbende udgifter. Rapport med fejl → rettelser.
2. **Lasttest 10x dagens peak** på staging (#6275, #5904-gaten). Mål aftenspidsen (#6490) og API-svartider om etape-tick (#6273).
3. **Byg det målingerne kræver og der er designet:**
   - job-kø og backpressure (#6491, #6134)
   - connection pooling i transaktionstilstand + cache af fælles data som ranglister og kalender (#6274)
   - PostgREST-timeouts (#6184)
   - ekstern DB-alarm (#6272)
   - træningslukning der retter sig selv ved Supabase-blink (#6596, #6061)
4. Øvrige sæsonskifte-issues fra MASTERPLAN 🟠 3 (#5864).

## 3. Motor og realisme (ny revision `s5_profiles_v2`, SLÅET FRA)

S5 er live, så al ny motoradfærd skal i `s5_profiles_v2`; `s5_profiles_v1` forbliver byte-identisk.
1. **Motor-testport (byg først, ren tooling, merges efter regel 35):**
   - Én kommando kører alle kommende løb (`tourDryRun` pr. løb, 8 seeds, aktuel mod ny revision, 4+ spor) + `s5MotorBench --scope=all`.
   - Den laver ét samlet kort med scorecard-mål, hårde gates, udbrud pr. terræn, favorit-udbrudssejre, GC-vinder fra udbrud og tidlige indhentninger.
   - Skabelon: `balance-internals/6367/s4-full-2026-10-17/` + samle-scriptet.
2. **Udbrud på kuperede etaper og mure** (#6748 punkt 3; S4 17/10: S5 6 %, v5 12 %, virkelighed ca. 30-40 %): design + baseline → byg.
3. **Formtoppe virker igen fra nu af** (#6156, ejer 17/10): toppens effekt i motoren i v2. Tændes på mit "tænd", ikke først ved S5.
4. **Formtoppe gives tilbage + ingen straf** (#6158, ejer 17/10):
   - Toppe brugt uden virkning gives tilbage.
   - Nedgangen efter en top uden bonus fjernes (rytterne fik -14 form for intet).
   - Tørkørsel med tal → kort → prod-skrivning kun på "kør", med backup og post-verify.
   - Forklar formdykket i help.json (#5076).
5. **S5-kanttilfælde** #6748 punkt 1, 2, 4, 5, 6.
6. Testport på v2 + uafhængig dommer (Fable, read-only) → tænd-kort med billede og patch note (EN+DA).
7. **Kun design + baseline med A/B til mig:**
   - Dagsform og dominans (#6649).
   - 'Work'-ordren pr. rolle (#6746).
   - AI-holdene er systematisk svagere (motor-gennemgangen 15/10, punkt 11).

## 4. Spilleroplevelse: færre klik, mindre scroll, det vigtigste øverst

**Princip (ejer):** spillerne skal scrolle og klikke mindre. Det, de bruger mest, skal være lettest at finde, og intet vigtigt må gemme sig langt nede på en lang side. Overblik først, faner ud, aldrig mere på en scroll-side.

1. **Mål først:**
   - Brug Microsoft Clarity (MCP) for de seneste 14 dage: døde klik, rage-klik, scroll-dybde og de mest brugte sider.
   - Kortlæg klikstien for spillernes 10 hyppigste opgaver: udtage hold til dagens løb, sætte taktik, se dagens etape, træne, byde, finde en rytter, forlænge kontrakt, se økonomi, se stilling og læse beskeder.
   - Rapport: antal klik og scroll pr. opgave i dag.
2. **Planlægning** (Holdudtagelse / Formplan / Strategi / Kalender): jeg føler, der skal klikkes alt for meget.
   - Lav 2-3 mockup-forslag: "I dag"-genvej øverst, dagens løb forvalgt, ét-klik "samme hold som sidst", færre niveauer.
   - Kalenderen med 32 løb på én dag (#5834).
   - U23/junior-løb synlige (#5843).

   Kort med PNG til mig før byg.
3. **Faner i stedet for lange sider:** lav forslag med mockups for de længste sider (BoardPage 3.166 linjer, TrainingPage 2.619 (design #5485 findes), RaceDetail, Auctions (#5293), RiderStats, Dashboard, Transfers, Team, Finance, SeasonEnd). Først det, der allerede er designet. Ét kort med de 3 vigtigste, så byg på mit go. Følg #6495 (opdeling efter T1-T3 + ratchet på sidestørrelse).
4. **Fejl og hastighed:** Firefox-crash (#6698), dashboard 1-2,6 s (#6569), ranglistens linse der hænger (#6322).
5. **Dark mode:** jeg har set dagsbåndet i Holdudtagelse → Dag (næsten usynligt) og "Kun beta"-kontakten i Patch notes (usynlig når slukket). Skærmbilleder af alle sider (1440 + 375), WCAG AA (tekst 4,5:1, kontakter/kanter/bånd 3:1), ret via tokens i ét spor.
6. **Allerede godkendt:** løbsfilm for endagsløb (#6512), vis regelversion (#6351), ét terræn-ikon pr. etapetype (#6683, også kalenderen #4875), etapesiden 2.0 (#6570), filmens tidspunkter (#6350).
7. **Små QoL og døde klik** (tjek først om de er lavet):
   - #6525 holdnavn + forrige/næste rytter
   - #6524 døde klik i træning
   - #6523 træning for flere ryttere på én gang (209 klik)
   - #4813 transferhistorik-links
   - #6176 sortér daily training
   - #6177 + #5637 taktik-scrollbar/slider
   - #5622 "Flere filtre" samme sted
   - #6514 + #5941 søgning
   - #6178 byttehandel-dato
   - #6127 "Popularity"-label
   - #6138 scoutmail 5 mod 4
   - #4941 autobud-sortering
   - #5255 byttehandels-notifikation
   - #5095 rå kodetekst
   - #6515 gule prikker pr. bruger
   - #6203 søg i roadmap
   - #6324 roadmap-stemmer
   - #5948 træningspåmindelse
   - #5850 "Stretch"
   - #6321 taktik uden kaptajn

Følg `PAGE_TEMPLATES.md` + `TASTE.md`; nye filer `.ts/.tsx`; EN+DA med `TONE_OF_VOICE.md`.

## 5. Teknisk fundament: udnyt stakken (React 19, React Router 8, Tailwind 4, Express 5, Zod 4, Vite 8)

Byg i små, målte bidder med ratchets, så det aldrig bliver en stor omskrivning:
1. **Ét data-lag med TanStack Query** (#6494): ingen direkte DB-kald fra UI.
   - Start med de mest brugte sider (dashboard, holdudtagelse, rytterprofil).
   - Cache og stale-while-revalidate giver ingen skelet-blink.
   - Prefetch ved hover/fokus på links.
   - Delt cache på tværs af sider; invalidering efter mutationer.
   - Ratchet: antal sider med `useEffect`-fetch må kun falde (i dag 65).
2. **Zod ved API-grænsen:** validering af body/query/params på alle skrivende endpoints først (i dag bruger én fil Zod). Ensartede fejlkoder (errors.json EN+DA). Ratchet på uvaliderede ruter.
3. **`backend/routes/api.js` (19.109 linjer)** deles i domæne-routere (Express 5 async-fejl, ingen try/catch-støj) én ad gangen bag eksisterende tests. Ratchet på filstørrelse.
4. **React 19:**
   - `useOptimistic`/`useTransition`, så bud, ordrer, udtagelse og træning føles øjeblikkelige med rollback ved fejl.
   - Suspense-grænser pr. sektion i stedet for helsides-loading.
   - Route-niveau code splitting + prefetch af næste sandsynlige side; hold `bundle-budget.json` nede.
5. **Tailwind 4 design-tokens** som eneste farvekilde (dark/light), med lint-regel mod rå farver. Det løser dark mode-fejlene ved roden.
6. **Backend-ydelse:** HTTP-cacheheaders/ETag for offentlige og fælles data, struktureret logning (#6495), målte svartider pr. endpoint.

Hver bid: målt før/efter (svartid, antal kald, bundle-størrelse), tests, merges efter regel 35 når der ikke er synlig UI-ændring.

## 6. Ned i backloggen (793 åbne)

1. **Done-sweep efter `github-housekeeping`** (billig ugentlig variant). Luk alt, der er leveret; done→todo hvor ny evidens findes.
2. **Kategori K (glemt-done):** titel-match mod merged PR'er.
3. **Hurtig GitHub-gennemgang:**
   - `priority:high` + `claude:todo`, `priority:next`, `type:bug` med spillerkilde, `cat:user-feature` med Clarity-evidens.
   - Tag de små, designede og verificerbare ting i bølger, 5-10 pr. bølge.
   - Spørg mig ikke om ting, hvor løsningen er oplagt; spørg om alt, der ændrer spillervendte tal eller design.
4. **Dubletter og forældede issues:** luk med kilde-tjek (spillerønsker og ejer-løfter lukkes aldrig uden mig).

## 7. Vækst og kommunikation (kun udkast, jeg sender selv)

1. S5-lanceringsopslag pr. målgruppe til torsdag 22/10 (GDD D-005), engelsk, rå kodeblok, med billeder.
2. S5-mail til sovende spillere med samtykke (#6554): udkast + PNG.
3. Discord-svar: Friis (dansk: rytterne er frigivet, skade efter udtagelsen koster ikke længere starten) og knud (engelsk: badget på Daily Training er rettet).
4. Ugentlig "Status på jeres rapporter" + Known issues ajour.

## 8. Søndag 18/10 (mind mig, gør det kun på mit ord)

- Ny tørkørsel → flip `promotion_pending_enabled` på mit ordrette "tænd", help.json samme dag, post-verify.
- Discord-webhook i Infisical: jeg kører kommandoen.
- Roadbook + Discord 7.361-7.367 (jeg poster). Go på #6680. Jeg lukker #6740.

**Venter på mig (spørg ikke):** #6739 (små hold mister etapeløb): "spørg mig senere".

## 9. Idébank: udfordr status quo

Tænk stort om de svageste områder: motorens forudsigelighed, nye spilleres første uge, tilgang, træning, transfermarkedet og ensomme hold i små divisioner. Kilder:
- motor-gennemgangen (`docs/audits/2026-10-15-motor-gennemgang.md`, "Verdensklasse-retning")
- Clarity
- Discord
- GitHub

Hvert forslag: problem, løsning, værdi for spillerne/mig/driften ved 10x, omkostning, anbefalet dag. Send de 5 bedste som ét kort med billeder.

## Close-out (før du stopper, også ved >20 timer)

- Samle-issuet opdateres med leveret, merget, venter og næste skridt.
- NOW.md: Next action + Working agent nulstillet. MASTERPLAN ved ændret kø. FEATURE_REGISTRY + `generate-feature-status.mjs`.
- Samlet patch note for alt spillervendt der er merget (EN+DA), som udkast til mig, hvis jeg ikke har godkendt teksten.
- `check-agent-token-hygiene.ps1`, `close-out-cleanup.ps1 -Execute` ved fund, `generate-status-board.mjs`, læring i `.claude/learnings/` ved fejl.
- Startprompt til næste session.
