# Session-prompt: Trin 7-finale + merge-tog (20/8 aften)

> Skrevet 20/8 i design-sessionen (ejer-bestilt). Formaal: AFSLUTTE det igangsatte.
> Design-tung OG eksekverings-tung: design sammen med ejeren hvor der er valg,
> men alt skal lande i merges/deploys, ikke i opgavelister. **Workflow-værktøjet
> er ejer-godkendt til brede fan-outs i denne session** ("brug gerne workflow-
> funktionerne, mange opgaver effektivt"). Hard rules 24-28 gælder.

Læs docs/NOW.md, markér dig som aktiv session. OBS: en anden session kan holde
hoved-checkoutet på en fremmed branch - commit docs/main-ting via midlertidigt
worktree (mønstret fra 20/8), aldrig blindt i det delte checkout.

## Arv fra design-sessionen 20/8 (status ved start)

- **Trin 7-previewet** skulle have #3924-kvitteringen bygget ind (worker sat på
  feat/3746-trin7-potentiale-som-fart 20/8 efterm.) - verificér den landede og
  at testbuildet viser den. Ejeren vil se ALT i preview og gå live I AFTEN.
- **#4011 finance A+C** (S2/S3-opgørelse + sæsonskifte-afregning): worker-PR
  undervejs. SKAL merges før søndag ved ejer-visuelt go.
- **#3997 spejder-mekanik**: worker bygger modning ~24t/missionsdag efter
  afsendelse + timesweep (ejer-ord: fix problemet, ikke copyen). Afløser PR
  #4008 (copy-only, ejer-afvist) - luk #4008 når mekanik-PR'en er klar.
- **PR #4012 (#3985 etapetype)**: ejer-afvist visuelt - miniature-silhuetten er
  for grim. Lav 2-3 varianter (fx ren tekst-pill, kalenderens polerede glyf,
  ikon+tekst), vis som billeder, ejer vælger, ret, merge.
- **PR #4007 (k=100)**: draft, roer ikke - flippes kun sammen med #3449-c ved
  cutover. **PR #4003 (harness)**: merge gerne som chore saa #4007-diffen
  bliver ren.
- Kulance #4004 udbetalt (134k, verificeret). Patch notes synkede t.o.m. 7.152.
  Fold-disciplin er ny bindende regel i PAGE_TEMPLATES.md.

## Blok 1 (hovedret): Trin 7 live i aften

1. Verificér preview: kvittering + Week plan-fane + Development synligt paa
   testbuildet. Fix selv smaating der blokerer (targeted verify).
2. Skriv tester-besked (EN, 3-4 linjer, "kig efter X") til ejeren - han poster.
3. **Ved ejer-go i aften**: koer merge-kaeden PRAECIS efter
   docs/sessions/2026-08-19-udrulning-stor-opdatering-session-prompt.md
   (merge -> migration -> backfill-dry-run m. EJER-STOP -> refit -> indbakke ->
   Discord-udkast). "Godt nok beskrevet" er ejerens gate: patch note + Discord-
   opslag skal vaere KORTE og laesbare (7.148-laeren), klar FOER go.
4. Lige efter merge: **W7 hjaelpetekster** (#3714 #3623 #3456 #3412 + traenings-
   svar 20/8 ind i help.json EN+DA) - god workflow-fan-out (en worker pr. issue,
   max 3 tunge; orkestrator ejer e2e-slottet).

## Blok 2: Merge-toget (uafhaengigt af trin 7-go)

Raekkefoelge: #4011 (ejer-screenshots -> go -> merge, patch note) -> #4012-
varianten (design-valg -> ret -> merge) -> #3997-mekanik (review -> ejer-go ->
merge; migration applies post-merge efter #2642-rammer) -> #4003 (chore-merge).
Efter hvert merge: patch note-version koordineres, `claude:done`-flip med det
samme, masterplan-linjen ajourfoeres.

## Blok 3: Pension-minimum foer soendag (#2748, ejer-valgt 20/8)

Design FOERST med ejeren (2 hurtige varianter af profil-notitsen, fold-
disciplin: notits paa eksisterende profilflade, IKKE nyt kort): rytteren melder
ved saesonstart at S3 er sidste saeson; synligt paa rytterprofilen + inbox-
besked. Byg minimum: (a) beregn S3-slut-pensioneringer ved S3-start, (b) notits
+ besked. Koordinér med cutover-drejebogen (beregningen skal koere ved/efter
soendagens flip). Kontrakt-forlaengelses-dialogen er S3+, IKKE nu.

## Blok 4: Fredag/loerdag-forberedelse (ved luft)

- **/pro**: naar ejeren melder moms-tjek + support-postkasse klar: #4005's tre
  fixes -> CHECKOUT_PAUSED-flip -> eet testkoeb -> genaabnings-patch-note.
- **#2853 e-mail-loop** testes fredag (kraever Resend-noegle + ejerens 3 tekster).
- Generalproeve loerdag: drejebogens trin 5a/5b er rettet 20/8 - bekraeft at
  backup-tabellen oprettes som foerste generalproeve-handling.

## Spoergsmaal sessionen skal stille ejeren (eet ad gangen, kontekst i kortet)

1. Trin 7-go: er tester-feedbacken god nok? (gaten for Blok 1.3)
2. #4012: hvilken etapetype-variant? (vis billeder foerst)
3. Pension-notits: variant + praecis copy (EN/DA) foer byg.
4. #4011: visuelt go paa finance-fladerne (screenshots foerst).

## Regler der bed 20/8

Fremmed branch i delt checkout (commit via worktree!) · ejer afviser plaster-
loesninger: fix mekanikken, ikke formidlingen · fold-disciplin er bindende ·
maalte tal, aldrig opfundne · een beslutning ad gangen, kontekst I kortet ·
UI-merge KUN med ejer-visuelt bevis · DA med aeoeaa i spillertekster, ingen
em-dash · patch note-version koordineres ved merge · close-out: patch notes-
sync + NOW/MASTERPLAN + token-hygiejne.
