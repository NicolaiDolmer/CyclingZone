# CI-konsolidering kan låse main permanent (#4330)

**Dato:** 2026-08-31 (natbølge 30/8)
**PR:** #4456

## Rod-årsag

`ci.yml` havde 21 jobs, 21 checkouts, 21 setup-node, kun 2 med npm-cache. Det
oplagte fix (saml de 18 statiske guards i én matrix) ville have været en
katastrofe: **ni af guard-jobbene står individuelt som required status check på
main**. En matrix omdøber checks til `<job> (<matrix-værdi>)`, og et slettet job
rapporterer slet ikke. Branch protection venter derefter i al evighed på ni
checks der aldrig kommer, og INTET kan merges.

Symptomet dukker ikke op i den PR der laver fejlen. Den PR bliver merget (dens
egen kørsel rapporterede stadig de gamle navne). Det er den NÆSTE PR der står
fast på "Expected - Waiting for status", og på det tidspunkt er årsagen allerede
på main.

Ingen test i repoet dækkede fejlklassen. Ejeren fangede den manuelt i
GitHub-auditten 30/8 ved at slå live branch protection op.

## Fix

To ting, i den rækkefølge:

1. **Konservativ konsolidering.** Kun de ni guards der IKKE er required blev
   flyttet ind i ét `static-guards`-job. De ni required guard-jobs står uændret
   med præcis deres gamle navne. 21 jobs → 13, 21 checkouts → 13, ingen
   ejer-handling i branch protection nødvendig.
2. **Forward-guard.** `scripts/check-required-ci-jobs.mjs` opløser hvert navn i
   `scripts/ci-required-checks.json` (spejl af main's required contexts) mod de
   jobs `.github/workflows/*.yml` faktisk producerer, og fejler på: slettet job,
   `name:`-override der ændrer check-navnet, `strategy`/matrix, og dynamiske
   `${{ }}`-navne. Statisk, ingen GitHub-API-kald i CI. Kører i
   `migration-idempotency` (se nedenfor hvorfor) og i `preflight-pr.ps1`.

## Anden runde: guarden var selv en attrap

Adversarisk review af PR #4456 fandt at forward-guarden lå i `static-guards` —
det job konsolideringen netop havde oprettet, og som **ikke** er et required
status check. `auto-merge.yml` venter på `gh pr checks --required` (plus
`frontend-smoke` og AI-review). Et rødt `static-guards` ville altså fælde CI
visuelt og merge alligevel. PR-bodyen påstod at fælden var lukket. Den var ikke.

Det er **tredje** gang samme fejlklasse rammer repoet:

- 2026-06-12 `tone-guard-advisory-green-merge-gap.md`
- 2026-07-31 `required-guard-not-in-branch-protection.md` (kommentaren sagde
  "REQUIRED", branch protection sagde intet)
- 2026-08-03 `red-ci-guard-merged-anyway.md` (rød `swallowed-catch-guard`,
  merget alligevel, main rød for alle PR'er bagefter)

Rettelsen flytter de to guard-steps ind i `migration-idempotency`, som ER
required, og låser placeringen med en test: `jobsRunningGuard()` finder de jobs
der faktisk kalder scriptet og kræver at hvert af dem står i kontrakt-filens
`contexts`. Flytter nogen guarden tilbage til et advisory job, fælder testen.

To yderligere huller lukket i samme runde:

- Guarden opløste et check-navn mod ethvert job i enhver workflow-fil uden at se
  på `on:`. Et required job flyttet til en push-/schedule-only workflow ville
  aldrig rapportere på en PR, men guarden var grøn. `parseTriggers()` læser nu
  triggeren, og mindst én producent skal køre på `pull_request`.
- Spejlet i `ci-required-checks.json` havde ingen drift-detektion: både den
  statiske guard og testen sammenlignede to lister der begge kom fra JSON-filen.
  Det er nu skrevet eksplicit i filen, i testen og i scriptets grønne output, og
  `--verify-against-github` diff'er manuelt mod live branch protection.

Bifangst fra den nye advisory: `gitleaks` (required) har ingen
`merge_group`-trigger i `secret-scan.yml`. Bruges GitHubs merge queue, timer den
ud på det check. Ikke rettet her — eget issue.

## Læring

- **Et job-navn i en workflow-fil er en offentlig kontrakt så snart det står i
  branch protection.** Refaktorér det som du ville refaktorere et API: enten
  behold navnet, eller opdatér begge sider i samme tidsrum.
- **Tallene i et issue er foraeldede fra dagen det blev skrevet.** Issuet sagde
  20 jobs, ejerens verifikation 30/8 sagde 19, det målte tal var 21. Mål selv.
- Repoets JSON-spejl-mønster (baseline-ratchets) virker også til
  kontrakt-spejling af noget der lever uden for repoet. Sandheden er stadig
  GitHub; filen findes for at gøre en drift synlig for CI.
- **En guard er først en gate når et rødt resultat kan blokere en merge.** Nyt
  guard-step? Svar på tre spørgsmål før du kalder fælden lukket: Hvilket job
  kører det? Står det jobs navn i `ci-required-checks.json`? Venter
  `auto-merge.yml` på det? Er ét af svarene nej, er guarden dokumentation.
- **Et spejl uden drift-detektion beviser kun at det er konsistent med sig
  selv.** Skriv det i filen, i testen og i det grønne output, så næste læser
  ikke forveksler "grøn" med "verificeret mod virkeligheden".

Refs #4330.
