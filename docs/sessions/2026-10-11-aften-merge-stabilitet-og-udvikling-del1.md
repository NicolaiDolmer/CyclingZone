# Næste session: merge-kø og stabilitet først, så Udvikling 2.0 del 1 (+ del 2 bag flag) og træningens rest

Planlagt 11/10 eftermiddag sammen med ejeren (11 svar, kl. ca. 16:45). Ejeren er med fra start. Alle beslutninger herunder er hans. Genåbn ingen af dem.

## Startprompt (kopiér ind i en ny Claude Code-session)

```
Ny session efter docs/sessions/2026-10-11-aften-merge-stabilitet-og-udvikling-del1.md. Læs FØRST den fil, derefter docs/NOW.md, docs/MASTERPLAN.md og issue #6110 inkl. alle kommentarer fra 11/10. Jeg er med fra start. Rækkefølge: (1) Tjek de første etaper på official_times_v4 (tændt 11/10 16:30) pr. division mod testbænken. (2) Merge-køen: vis mig ÉT kort pr. PR før merge (#6478 #6480 #6481 #6479 #6477, chunk sidst), og før/efter-billede til #6482 og #6483. (3) Stabilitet: rest af #6184 (spidsen under aftentræningens lukning), matview-stall CYCLINGZONE-2G (#5692), #6470. (4) Byggeplan + bølge for Udvikling 2.0 del 1 (D4 tilbagegang, D6 ingen udvikling uden for managerhold) til sæsonskiftet 25/10, og del 2 startet bag slukket flag med harness først. (5) Træningens rest: tjek FØRST hvad der allerede er lavet (ugeprogram 7x5, UX-ønsker, fejl, egne programmer/træthed, forklaring i UI), så plan. (6) Discord-opslag om Udvikling 2.0 som udkast (EN). Pengene tilbage (#6474) og spillersvar (#6476) er IKKE med (ejeren tager dem separat). Afbryd aldrig et igangværende spor uden at jeg beder om det. Svar på dansk.
```

## Ejerens svar 11/10 (design af sessionen)

| Spørgsmål | Svar |
|---|---|
| Primært fokus | **Merge-kø og stabilitet først** |
| Udvikling 2.0 del 1 (D4, D6; værdier #5842 er merget/i kø) | **Samme session, når køen er tom.** Plus de gemte træningsopgaver og spillernes spørgsmål/forslag om træning. Live og testet før 25/10 |
| Udvikling 2.0 del 2 | **Start nu bag slukket flag** (harness og simulering først, tændes samlet en søndag i S5 på ejerens go) |
| Tekniske PR'er | **Vis hver før merge** (ét kort pr. PR). Gælder over mandatet fra 8/10 for denne gruppe |
| Launch-ungdommen (ca. 690 over nyt loft) | **D5 er nok**, ingen ekstra rettelse |
| Melding til spillerne om Udvikling 2.0 | **Discord-opslag snart**: Claude skriver færdigt udkast (EN), ejeren poster |
| Ugeprogram 7×5 | **Tjek grundigt hvad der allerede er planlagt/bygget** før noget bygges (det var planlagt før sidste sæsonskifte flere gange) |
| Træningsopgaver | Alle fire grupper med (UX-ønsker, fejl, egne programmer/træthed, forklaring i UI). **Tjek først om noget allerede er lavet** |
| Pengene tilbage (1.092.657 CZ$ på 4 hold) | **Ikke næste session.** Ejeren tager det i aften eller i morgen |
| Spillersvar (#6476) | **Ikke næste session.** Ejeren tager det i aften eller i morgen |
| Start | Lige så snart denne session er lukket i god ro og orden |

## Udvikling 2.0: alle beslutninger 11/10 (detaljer på #6110, tal privat i balance-internals/2026-10-03-udvikling-2/README.md §5-8)

D1 = B (stejlere top, belastningsevne til 25) · D1b = B (potentialet sætter blødt loft) · D2 = B (løbsdag +30 % i etapens evner) · D3 = A (samme mængde, rollen styrer hvor) · D4 = B (top 27-28, plateau til 30, fald fra 31, kun fysiske evner, løb bremser jævnt, hårde træningsdage halvt) · D5 = glidende A (50 % → 25 % → ny model; besked til berørte managere) · D6 = ingen udvikling uden for managerhold, men fald med alderen · D7 = C (skiftets regler inden 25/10, resten samlet i S5) · potentiale = C, levende talent (1-99 + professionalisme; ændrer ejerens 13/8 og 16/8) · træningsscore = B (afstemt støj, prognose og salg efter 5 træninger) · #5842 = kl. 14.

**Del 1 (til 25/10):** D4-tilbagegang i sæsontrinnet, D6 (fjern sæsonhoppet for AI/frie, behold fald), #5842 (PR #6403). Lille og testbart; simuleres mod rigtige data før skiftet.
**Del 2 (S5, bag flag):** D1/D1b/D2/D3/D5, potentiale 1-99 (9/8-planens variant B-omregning, dry-run + ejer-go før apply), levende talent, træningsscore B, skjult potentiale ved søndagens hentning, salg efter 5 træninger, prognoser (#5764 #5683), #2798 (prisen må ikke afsløre potentialet) FØR omregningen. Harness først (spec §5 trin 1).

## Ugeprogram 7×5: hvad der er fundet 11/10 (verificér i næste session)

- Beslutning 8 i `docs/TRAINING_RULES.md` §13.3: program pr. løbsdag = 7 ugedage × 5 løbsdage = 35 felter. Regeltabellen (linje ca. 900) siger stadig "mangler" (`training_week_plans`).
- Men frontend har allerede ugeplan-kode (`training_week_plans`, `TrainingProgramAssign.tsx`, `useTrainingPrograms.ts`, `trainingPrograms.ts`), og spec `docs/superpowers/specs/2026-09-29-traen-nu-og-prognose-design.md` punkt 6 siger, at de 35 felter skal "åbnes for alle, ikke kun beta". Det tyder på, at griddet findes bag beta.
- Audits: `docs/audits/2026-09-19-saesonskifte-overblik.md` §5, `2026-09-19-loefter-til-spillerne-mod-status.md`. #5264 (B4) er merget; dens 7×5-grid blev parkeret 16/9.
- Første skridt: læs kode + flag/beta-gate + prod-tilstand, læg status frem for ejeren, opret ét samlet issue, design-kort før byg (skal passe med træningsscore B).

## Træningens gemte opgaver (tjek om noget allerede er lavet først)

UX: #6123 #6303 #6176 #6208 #5630 · Fejl: #6210 (PR #6248) #5886 #5949 #6470 #6238 · Egne programmer/træthed: #6188 #4854 #4852 #4853 · Forklaring: #3659 · Plus spillerforslag om træning (Discord/feedback).

## Overdraget fra sessionen 11/10 (status ved lukning)

1. **official_times_v4 TÆNDT 11/10 16:30** (ejerens "tænd"): #6465 + #6484 merget, migration applied og verificeret (constrainten kender v4). Kørende løb bliver på v2/v3 (Touren v3); 254 kommende løb binder til v4. Næste session: tjek første bjergetaper pr. division (12/10 fra kl. 12) mod `balance-internals/motor-bench/bench-main-live.json`. Accepter A-E står på PR #6484/tænd-kortet. Alle beslutningskort fra 11/10 (D1-D7, potentiale, træningsscore, tænd) ligger privat i `balance-internals/2026-10-03-udvikling-2/kort-11-10/` (hard rule 17). Opfølgning: nyt issue for D3's ene bjergrute uden topankomst (stadig over loftet).
2. **Patch note 7.356** (#6485) og **#6403** (værdier kl. 14): sat i merge-køen 11/10 ca. 16:40. Tjek at de er merget; Discord-tekst til 7.356 mangler (ejeren poster).
3. **Åbne PR'er fra bølgen** (alle reviewet, ét kort pr. PR før merge): #6478 aftentræning (knap default 1 = uændret; simulator-rettelse pushet), #6480 trup-skift (blokerende fund rettet), #6481 auktionsfejlen (3 ekstra huller lukket 11/10, 5 tests, modprøvet), #6479 timeouts (delvis; rodårsag ikke bevist), #6477 chunk (merges sidst; ejer-handling: GitHub-secret `POSTHOG_PERSONAL_API_KEY`). UI: #6482 notifikationer, #6483 U23-ikon + alder (før/efter-billeder mangler).
4. **#6475 "Long day"**: bekræftet (en 40 km enkeltstart får fejlagtigt mærket; endurance vejer lidt i v4-enkeltstarten). Dom og fix-plan i `docs/audits/2026-10-11-6475-long-day-tt.md` (tjek at filen er committet) og på issuet.
5. **Sentry 11/10 15:37**: CYCLINGZONE-56 chunk (4 spillere, auktionssiden; #6477), CYCLINGZONE-2G matview-stall (2/døgn, #5692), CYCLINGZONE-7X (én holddag 10/10 needs_reconciliation, #6470), CYCLINGZONE-62 billing (mandag).
6. **Ikke i næste session (ejeren separat):** pengene tilbage fra 4 hold (#6474, dry-run i worktreet `fix-6474-finance-history-sale/balance-internals/2026-10-11-6474-dry-run.md`; vis saldoerne live først), spillersvar #6476, known issue-tekst "Money from a sale can look like it came back" (prod-data, efter merge af #6481).
7. **Ejerens Claude Design-session** (wireframes til idéerne fra #staff-chat 11/10; prompt i `docs/drafts/claude-design-prompt-staff-chat-2026-10-11.md`): artifact "Cycling Zone · Feature wireframes" opdateret 11/10. Gennemgå med ejeren, når han vil.
8. **Mandag 12/10:** betaling #4511 #4514 #4512 + CYCLINGZONE-62.
9. **Lukket ned 11/10 ca. 17:20:** den lokale merge-kø for #6484 blev stoppet efter merge (ejer-go), fordi den hang på deploy-verifikationens cron-step (run 38147469574, grænse 100 min), selv om alle hurtige cron-jobs havde meldt sig. Tjek resultatet på #6484. Opfølgning (opgave-chip "Gør merge-køen fri straks efter merge"): køen skal frigives efter merge; død række `deadline-day` i `cron_checkins` (cron fjernet #6259) slettes kun med ejer-go.
10. **Oprydning:** merget worktrees `feat-6384-classification-time-gaps`, `feat-6464-flip-official-times-v4`, `docs-patch-note-7356` (de to sidste har junctions til delte `node_modules`: fjern junctions FØR worktree-sletning, ellers rammes de delte pakker). To gamle `tail -F`-processer fra natsessionen (`balance-internals/nat-11-10/merge-queue-taend.log`) kan stoppes.

## Faste regler

- Parallelbyg kun via `Workflow({ name: "wave" })` fra repo-root (IKKE scriptPath; hooken reserverer kun ved navn). Tjek ejerskab (ingen to spor ejer samme fil/mappe, ingen ownership mod andres touches) FØR start.
- Ingen prod-mutationer, migrationer eller tændinger uden ejerens ordrette go pr. skridt.
- Hver UI-ændring: ét annoteret før/efter-billede, sendt som fil, før merge-go. Hver teknisk PR fra 11/10: kort før merge (ejer 11/10).
- Nøgletal i selve spørgsmålet; ét kort ad gangen; billeder som fil (Remote Control/telefon).
- Close-out som i CLAUDE.md (NOW 🎯 + 🤖, token-hygiejne, status board, MASTERPLAN + artifact i sync).
