# Samlet session: trin 7-udrulning + bitype-restarbejde

Erstatter `2026-08-15-handoff-bitype-og-prs.md` (som kun dækkede bitype-sporet). Kopiér blokken nederst.

## To kollisioner mellem sporene, fundet 15/8

**1. Patch note-nummeret i PR #3798 fejler ved merge.** `scripts/check-patch-notes-version.js:143` kræver strengt faldende versioner i `PATCHES`-arrayet. #3798 bærer **7.132**, men main har nu **7.133** (bitype-fixet) og PR #3802 har **7.134**. Merges #3798 som den er, står 7.132 øverst over to højere numre, og gaten fejler. Nummeret skal hæves til næste ledige (7.135) FØR merge. Det er en to-minutters rettelse, men den er blokerende, og den er ikke nævnt i #3803.

**2. To spillerbeskeder rammer samme dag.** Bitype-rettelsen har et Discord-udkast (`docs/discord/2026-08-15-andentype-rettelse.md`) der siger "din rytter er præcis lige så god i dag som i går". Trin 7's backfill hæver samtidig **alle 8.717 rytteres lofter** (median +28). Lander de sammen, læser spilleren begge som én hændelse, og bitype-beskedens formulering bliver misvisende. Beslut om de skal slås sammen til én besked eller sekventeres, før nogen af dem postes.

---

## Prompt

```
Kør udrulningen af trin 7, og luk restarbejdet fra bitype-sessionen 15/8.
Anbefalet: Opus, høj indsats. Designet er låst; det her er præcisionsudførelse.

START MED at læse docs/NOW.md, issue #3803 og
docs/sessions/2026-08-16-samlet-udrulning-trin7-og-bitype.md.
Kontekst: PR #3798 er komplet og grøn; alle beslutninger står på #3746
(kommentar 16/8). Worktree: C:\Dev\CyclingZone-worktrees\3746-trin7.

═══ SPOR A — TRIN 7-UDRULNING (hovedsporet, #3803's 6 punkter i rækkefølge) ═══

A0. FØRSTE SKRIDT er mit visuelle go. Vis mig de 5 screenshots fra
    pr-screens/3746-*.png igen, og spørg mig om:
      (a) go til merge
      (b) om "Potentiale pr. ryttertype"-overskriften + "Potentiale"-
          hjørnelabelen også skal omdøbes til prognose-sprog
          (2-min i18n-rettelse en+da i så fald, FØR merge)
    Gå ikke videre før jeg har svaret på begge.

A1. BLOKERENDE FØR MERGE, ikke nævnt i #3803: PR #3798's patch note er
    7.132, men main har 7.133 og PR #3802 har 7.134.
    check-patch-notes-version.js:143 kræver strengt faldende versioner, så
    #3798 fejler gaten som den er. Hæv den til næste ledige nummer (tjek
    origin/main OG åbne PR'er lige før), og kør scripts/check-patch-notes-
    version.js før push.

A2. Merge PR #3798. Verificér med `gh pr view 3798 --json mergedAt` OG læs
    indholdet på main bagefter. Merge-status alene er ikke bevis.

A3. Backfill: node backend/scripts/dev/lofterApply3746.mjs
    Først dry-run mod prod. VIS MIG TALLENE og vent på mit go før
    --apply --jeg-har-set-dry-runnet. Verificér at backup-tabellen er fyldt
    FØR skrivning. Rollback ligger i
    database/2026-08-16-3746-recompute-ability-caps.sql.
    Brug det ærlige tal i kommunikationen: 4.247 pladser hos 2.134 ryttere
    har evne over skrevet loft, ikke designmålingens 894/553.

A4. Voksen-baseline-refit: node backend/scripts/fitRiderTypesBaseline.js --caps
    mod de NYE prod-caps, commit riderTypesBaseline.json.
    NB: det er ryttertype-baselinen. Den må ikke forveksles med balance-
    baselinen i #3799, som er en anden fil og et andet problem.

A5. Luk issues: #3746 #3794 #3788 #3787 #3651 #3679 #3714 #3785.
    Flip claude:todo → claude:done.

A6. Efterfølgende måling (ikke-blokerende): spillervendteGates3709.mjs mod et
    FRISKT prod-snapshot, ikke mod det snapshot backfillen brugte.

═══ SPOR B — SPILLERKOMMUNIKATION (beslutning, før noget postes) ═══

Der ligger to udkast der rammer samme dag:
  docs/discord/2026-08-16-trin7-potentiale-fart.md   (alle 8.717 lofter flytter sig)
  docs/discord/2026-08-15-andentype-rettelse.md      (60 ryttere skifter andentype)

Bitype-beskeden siger "din rytter er præcis lige så god i dag som i går".
Det er sandt om DEN ændring, men misvisende hvis trin 7's loft-løft lander
samme dag. Giv mig din anbefaling: slå dem sammen til én besked, eller
sekventér dem. Jeg poster selv; send ALDRIG noget.

═══ SPOR C — LUK BITYPE-PR'ERNE (hurtigt, ingen ny kode) ═══

C1. PR #3802 (backfill af de 72 uden anlægs-sekundær; ALLEREDE kørt mod prod
    og verificeret, CI grøn, MERGEABLE). Læs patch note 7.134 igennem med mig
    FØR merge. Den lover at nuværende evner og værdi er urørte, men at
    udviklingsloftet flytter sig. Verificér den påstand i koden
    (buildCapsForRider returnerer max(tapered, current)) før du siger den er
    rigtig. Merge når jeg har sagt god for teksten.

C2. PR #3801 (cutover-drejebog #3645, docs). Fire spørgsmål i bodyen, vigtigst:
    skal 23/8 reduceres til race-day-flippet alene, når kun 1 af 4 komponenter
    er klar? Præsentér dem ÉN ad gangen med din anbefaling, ikke som en liste.

C3. Ryd worktrees fix-3634-backfill-72 og docs-3645-cutover-drejebog efter merge.

═══ SPOR D — ÉN BESLUTNING (ca. 15 min) ═══

PR #3512 er draft siden 14/8, fejler G1-G4 på fictional/starter/ai, og rører de
samme to filer som det merged #3800. Læs min kommentar på den fra 15/8, mål om
dens præmis stadig holder, og giv mig en anbefaling: luk eller rebase.

═══ BINDENDE FOR HELE SESSIONEN ═══

  - Rækkefølge: A0 → A1 → A2 → A3 → A4 → A5, derefter B, C, D.
    A6 kan vente dage. C og D må gerne køre mens A3 dry-runner.
  - Egen worktree pr. spor via scripts/new-worktree.ps1. Trin 7 kører i den
    eksisterende 3746-trin7; den BEHOLDES til #3798 er merget.
  - Kør npm run race:gate, ikke kun node --test, ved ENHVER ændring der rører
    generatoren eller race-motoren. Den er et separat CI-trin og var grøn
    lokalt mens gaten var rød 15/8. Se .claude/learnings/2026-08-15-
    scorecardet-maalte-generatorens-egne-gates-men-ikke-motorens.md.
  - Ingen prod-mutation uden at spørge mig. Dry-run + tal først, ALTID.
    Det gælder også A3, selvom #3803 beskriver den som planlagt.
  - Verifikationsdisciplin: merge-status er ikke bevis, læs indholdet på main.
    Efter enhver mutation: uafhængig efterkontrol, ikke kun scriptets egen.
  - Send ALDRIG en spillerbesked. Skriv udkast, jeg poster selv.
  - Saml det jeg skal tage stilling til, men stil det ÉN ting ad gangen i
    klart sprog med din anbefaling.

═══ IKKE I DENNE SESSION ═══

  #3804 (bi-typen skal også forme rytterens krop) hører efter 23/8-cutoveren.
  Den kræver at race:gate's kalibrerings-bånd rekalibreres først.
  #3799 (balance-baselinen 131 afvigelser skæv) er heller ikke denne session.
```
