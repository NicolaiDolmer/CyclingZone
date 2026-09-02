# Oplæg til den store natbølge (ny session 2/9 sent eller 3/9)

**Formål:** ejeren vil have en natbølge der kører HELE natten og tager rigtigt mange opgaver, ikke tre spor ad gangen. Dette er handoff'et fra pengeplan-sessionen 2/9 (Fable), så den nye session starter med hele billedet. Regler og rækkefølge er ejer-besluttede; genåbn dem ikke.

## 1. Hvad der allerede er sket i aften (2/9, kl. 17-23)

- Pengeplan låst: `docs/superpowers/specs/2026-09-02-30-dages-pengeplan.md` (§0 tal, §1 fem satsninger, §2 mål, §3 ejerens område-rækkefølge, §4 nattens spor).
- Merget: #4652 win-back-audit, #4653 crons (#4644 done), #4655 Pro backend (#4648 webhook-fix, #2816 dobbeltkøb-guard done; #4646, #4555, #4645 delvist).
- Drafts der venter på ejerens visuelle go: #4654 mail v2, #4657 design-kit (Dashboard + Indbakke), #4656 årsmøde backend (migration = ejer-GO), plus dem chunk 2-3 leverer (Pro-fordele #4649, årsmøde-frontend, Tilmeld-knap #4592, SEO #4067). Se `docs/NOW.md` for den endelige liste.
- #4608 EUR-checkout: rebaset, MERGEABLE, holdes til nøgleblokken (#4616) er gjort, ellers kan engelsksprogede ikke købe.
- Nye tal: 5 abonnementer, MRR 188,40 kr ekskl. moms (to nye Founders 2/9 aften).

## 2. Ejerens rækkefølge (områder, 2/9 kl. 19:55)

1 design-kit/anti-slop · 2 drift/tempo · 3 rytterudvikling/træning · 4 løbsmotor v4/taktik · 5 dashboard/indbakke/dag 1 · 6 planlægning/sæsonoverblik · 7 kalender/løbsstruktur · 8 trupper/ungdom · 9 økonomi/balance · 10 fair play/roller · 11 vision/benchmark. Issues pr. område: pengeplan §3. Bagkataloget med alle 102 punkter i klart sprog: `docs/audits/backlog-plain-language-2026-09-02.md` (kolonner: værdi nu, størrelse, klar i nat, afhænger af) + artefaktet `claude.ai/code/artifact/bab9127f-bd3c-4744-b6f5-eb3673e4c06f`.

Ejerens ord: "Du er slet slet ikke ambitiøs nok med hvad vi kan nå" og "planlæg i rækkefølger, ikke datoer". Claude foreslår ikke længere selv udskydelser.

## 3. Hårde afhængigheder den nye session skal kende

- **Sæson 4 findes ikke i `seasons`.** Årsmødet (`proposeNextMandate`) springer alle hold over indtil S4 er materialiseret. S4-kalenderen (#4176/#4270, område 7) er derfor IKKE valgfri før 27/9.
- **13 hold mangler bestyrelsesmedlemmer** (tørkørsel 2/9): mål uden ejer. Repareres før flip af årsmødet.
- **Nøgleblokken #4616** er ejer-only: Alunta EUR-planer i checkout + Stripe som udbyder, Railway `ALUNTA_CZ_PRO_PLAN_ID_MONTHLY_EUR`/`_SEMIANNUAL_EUR`, Resend-nøgle + `EMAIL_UNSUB_SECRET`, Aluntas betalingsnotifikationer (alle slået fra i dag), besked til Alunta om engelsk checkout.
- **Faktura #2 (61,25 kr) står stadig ubetalt hos Alunta** (billing-watch alarmerer ved hvert boot). Ejer-handling i Alunta.
- **Design-kittets primitiver logger `console.error` i dev** ved gamle kald (104 EmptyState-kald i 65 filer, AcademyPage-knapper). Migrationen af dem er område 1-arbejde, oplagt til bølgen.
- Branch-reglerne kræver review; workers kan ikke godkende egne PR'er. Orkestratoren merger grønne PR'er med `gh pr merge --squash --admin` EFTER at alle checks er grønne, aldrig før.

## 4. Sådan skalerer bølgen (læring fra 2/9)

- Worktrees oprettes sekventielt med `scripts/new-worktree.ps1 -Branch <type>/<N>-<slug>` (ca. 30 s hver). Preflight: `pwsh -File scripts/preflight-night-wave.ps1 -Fix` (GO 2/9), `scripts/keep-awake.ps1` som baggrundsproces.
- Workflow-tool i chunks på 5-8 sonnet-workers (`model: 'sonnet'` EKSPLICIT), én `parallel()` pr. chunk, nyt Workflow-kald pr. chunk; scripts i sessionens `workflows/scripts/` kan genbruges som skabelon (night-wave-chunk1..3 fra 2/9: COMMON-preamble + TRACKS-liste + StructuredOutput-schema).
- Workers i workflows kan IKKE modtage beskeder; læg alt i prompten: worktree-sti, `git -C`, ingen `cd`, ingen heredoc, commit pr. delfix, push hvert 30. min, TARGETED vs BACKEND verify, draft for al UI, screenshots via preview-mock (`VITE_PREVIEW_MOCK=1`, mock-login via /login), ingen e2e, ingen secrets, `Refs #N`.
- Tunge spor 2/9 tog 60-100 min; lette 15-25 min. Med 12-16 samtidige workers er 30-40 issues på en nat realistisk, hvis de er "klar i nat" (Bagkatalogets kolonne).
- Merge-runde om morgenen: backend-PR'er med grøn CI merges af orkestratoren; UI-drafts venter på ejerens visuelle go; migrationer applies af Claude EFTER merge med ejer-GO (#2642); done-flip pr. merged issue med det samme.

## 5. Forslag til bølgens indhold (ejeren vælger, rækkefølge = områderne)

Område 1 design-kit: migrér EmptyState/FilterBar/Tabs/DataTable ind på Ryttere, Auktioner, Transfers, Mit hold, /teams/:id, løbssiden (#4628 #4613 #4109-delen), #4626 CI-vagter, #4177 tekstrettelse, #4297.
Område 2 drift: #4647 Playwright shard (egen worker, tung), #4496, #4267, #4010-rest, #4016, #4292, #4493, #3486, #691, #4327/#4328/#4333, #4123/#4215, #4595, #4658.
Område 3 træning: #4128 + #4098 (rettelser først, ejer-svar i #4634 ligger), #4631, #4629 (wireframe ligger), #4633, #3966.
Område 4 løbsmotor: #4201 (klar i nat), #4246, #2405, #1884, #2810, #4615-forberedelse (harness).
Område 5-7: #2223 indbakke, #1146 sæsonoverblik (preview findes), #4535, #4259, #4288, #4278, #4105, S4-kalender #4176/#4270 (SKAL).
Filler: DA-udgaver af mailene (#2853 opfølger), win-back som mailtype (#2760, efter dry_run), #4651 probe-script.

## 6. Prompt-skelet til den nye session

"Du er Fable, arkitekt. Læs docs/NOW.md, docs/drafts/natboelge-oplaeg-2026-09-03.md og pengeplan §3-§4. Design en natbølge i chunks af 6-8 sonnet-workers, der tager område 1 til 7 i ejerens rækkefølge, med de hårde afhængigheder i §3 løst først (S4-kalender, bestyrelsesmedlemmer). Vis mig bølgeplanen som tabel (spor, issues, worktree, tyngde, verify, merge-politik), få mit GO, og launch i samme tur. Om morgenen: merge-runde, done-flips, screenshots til mit visuelle go, close-out."
