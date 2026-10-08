# Handoff: GitHub-audit 5/10 (til planlægning)

Kilde: `.claude/audits/audit-2026-10-05.md` + ledger #627. Alt nedenfor er set i issues/kode/prod 5/10; "antagelse" er markeret. Intet her er besluttet; det er input til planlægningen.

## 1. Træning: ét beslutningspunkt låser 13 issues
- 12 dev-færdige issues står som `claude:done` og lukkes først når træningen flippes fra beta til alle: programmer (#4629), Train now (#4847, #6006, #6027), 35 felter (#5932), trætheds-prognose (#5933), udviklingshistorik (#5947), auto-hvile (#5620), dagvalg på mobil (#5685), træningsgrupper (#6000), mobil træningsside (#3643). Dertil mobil sæsonmatrix (#5124).
- Ejer 1/10: `training_train_now` flippes først "når den er set virke". Det bør være et dateret mål i planen, ikke noget der driver.
- Åben feedback der bør med i samme pakke (#6053/#6035 er den åbne PR): sletning/nulstilling af individuel plan (#6123), kopiér dag (#6060), Train now-lås og bonus (#6139), sortering + hover (#6176), tabt synlighed på mobil (#6111), lavere udvikling efter trætheds-rettelsen (#5965, undersøgelse), "knæk" ved sæsonskiftet (#6059, undersøgelse). #4854 er flippet tilbage til todo pga. ny feedback (undtagelses-ryttere vælges fra trupsiden).

## 2. Ejer-go der blokerer andre issues
- #6129 (anvend historisk træningskompensation): blokerer lukning af #6061 og at Sentry CYCLINGZONE-7X bliver stille.
- #6132 (bulk-regenerate overser brugte løbsdage, blokeret) + datareparation efter #5860 kræver ejer-go.
- #6134 (schedulerbudget, rest fra #5900) er `needs-decision`; load-test-gaten #5904 er i gang (bølge, staging-prep).
- #6164 (oprydning bagud: hængende tilbud) og #6115 (bekræft på første rigtige holdskifte).
- #6095: fixet er live og prod-verificeret; svar til spilleren kan sendes nu (ejeren sender selv). Rolle-valg i beta afventer "kør".

## 3. Sikkerhed og privacy (bør have fast plads)
- #6121 (høj): Sentry v11 må ikke opgraderes uden eksplicit `dataCollection`; Dependabot-PR'erne for frontend og backend ligger klar og må ikke merges blindt (uden indstilling samler v11 IP, cookies og bodies).
- #6104: forum-images-bucketen kan listes offentligt (security-advisor).
- #6174: to skrivende roadmap-funktioner bag backend (ejer: uge 41).
- #6047: Malwarebytes blokerer cyclingzone.org; kræver ejerens indberetning.

## 4. Roadmap-hub (leveret 4/10, rester)
- Rester: #6171 (`training_daily_receipt` mangler i stadie-kataloget), #6174 (ovenfor).
- `roadmap-flip` fandt 24 lovede issues uden roadmap-punkt (forventet, indhold ikke lagt ind). Skal indhold lægges ind, og hvem gør det?
- #5845 (roadmappen opdateres torsdag 1/10): ejeren skal se, om deadlinen er opfyldt.
- #5388 (gennemgang af /admin/growth: hvad bruges ikke, hvad mangler) er tilbage i todo; kun roadmap-fanen blev bygget. Beslægtede oprydningsissues #5337/#5031 er dubletter af hinanden (fra issuets egen tekst, ikke selv tjekket).

## 5. Løbsmotor (søjle med højeste vægt)
- Uplanlagte design-/undersøgelsesissues: #5978 (GC-trussel og gentagne favorit-udbrud i Soleil), #5981 (beskyttet løjtnant), #5982 (hjælperarbejde pr. fase), #6137 (løbsfilm samler gentagne hændelser).
- #6124: assistenten overskriver muligvis selvvalgt U23-udtagelse ved løbsstart (mulig regression, read-only tjek først).

## 6. Spillerfund uden plads i planen (alle triageret, ingen prioritet ændret)
- Bugs: #5979 (slettet påmindelse kommer tilbage), #5980 (switch usynlig i dark mode), #6138 (scout lover 5, viser 4), #6178 (transferhistorik-dato), #6062 (abonnementsperiode uden faktura; billing, bør ses hurtigt), #6125 (samlefund).
- Ejer-design: #6126 (lavere aldersgrænser, hænger sammen med S5-ungdomsløftet), #6113 (præmiesum i junior/U23), #6024 (byttehandel med flere ryttere), #6122 (bestyrelsesbeskeder + 3-års plan), #5966 (spørgsmål: 14 vs 13 løbsdage; kan besvares som docs).

## 7. Proces og værktøj (forslag, ikke besluttet)
- **Done-sweep-kadence:** done-puklen var 29 efter ca. 2 dage med bølger. Billig sweep bør køre oftere end ugentligt, og `claude:done` bør flippes samtidig med merge (allerede regel i bølge-runbooken).
- **Auto-mode blokerer sweep-udførelse:** klassifikatoren afviste både `gh issue close` og `git worktree remove` første gang, selv efter samlet ejer-ok i chatten; det gik igennem da ejeren gentog godkendelsen. Hvis sweeps skal kunne køre uden afbrydelse, skal der tilføjes Bash-tilladelser for `gh issue close/edit/comment` (kun ejeren kan gøre det).
- **Session-start-hooken** kalder alle slettede-på-origin-branches "merged". Det er forkert (feat/3353 havde en lukket PR og 13 commits). Lille rettelse.
- **Anonymisering ved kilden:** 13 af 33 triage-issues havde Discord-handles i titel/body. Sweep→issue-pipelinen bør anonymisere ved oprettelse; repoets redigeringshistorik gør efterrettelse ufuldstændig.
- **Oprydning der venter på ejeren:** 17 worktrees med unikt arbejde uden PR/remote, 16 review-branches med 1-4 unikke commits, 2 branches slettet på origin uden merge (`feat/3353-v4-refit-new-types`, `codex/5913-youth-eligibility`). Arkiv af ikke-sporede filer: `C:\Dev\CyclingZone-worktrees\_arkiv`.
- **Åbne tråde fra auditten:** Sentry CYCLINGZONE-8V er ikke tjekket stille efter lukning af #6168; #6184 fik `needs-ai-triage` fjernet af scriptet uden at være gennemgået.
