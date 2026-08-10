# 2026-08-10 — Preflight spejlede kun halvdelen af et CI-job

**Issue:** #3545 (PR #3599) · **Fil:** `scripts/preflight-pr.ps1`
**Klasse:** vagt-drift — den lokale spejling faldt bagud for CI uden at nogen opdagede det

## Symptom

PR #3599 blev pushet med `pwsh -File scripts/preflight-pr.ps1` grøn. I CI fejlede jobbet
`dropped-supabase-error-guard` med tre fund i `backend/lib/discordWebhookOutbox.js`
(`:173 .delete()`, `:183 .update()`, `:195 .update()`).

Den forvirrende del: guarden **med det navn** kørte lokalt og bestod. Det ledte først til en
forkert hypotese om at CI og lokal kørte på forskellig kode.

## Rod-årsag

CI-jobbet hedder `dropped-supabase-error-guard`, men det kører **to** scripts efter hinanden:

```yaml
- name: Run dropped-supabase-error guard
  run: node scripts/lint-dropped-supabase-error.mjs
# #2974: søsterguard mod fire-and-forget mutationer ...
- name: Run unchecked-supabase-mutation guard
  run: node scripts/lint-unchecked-supabase-mutation.mjs
```

`preflight-pr.ps1` kørte kun det første. Det andet (#2974) er netop det der rammer det bare
`await supabase.from(...).delete()` uden `data`-binding — som den første guard er **blind for
per design**, fordi den kræver en binding at kigge på.

Så preflight kunne melde GRØN på præcis det jobnavn der fejlede i CI. Der er ingen fejl i
nogen af de to guards; hullet er at jobnavnet dækker to scripts, mens preflight antog ét.

## Rettelse

`scripts/preflight-pr.ps1` kører nu begge, med samme fejl-etiket-mønster som resten af filen.

## Negativ-test (begge ben — det var kravet, og det afslørede min egen fejl)

| Kode | Resultat |
|---|---|
| pre-fix `260ce369` | **exit 1** — `NET-NYE ... discordWebhookOutbox.js: 3 (baseline 0)`, præcis `:173`/`:183`/`:195` |
| post-fix `219b2338` | **exit 0** — `ingen net-nye` (baseline-total 107) |

**Fælden jeg gik i først:** guarden scanner kun **git-sporede** filer. Min første negativ-test
kopierede den defekte fil ind i arbejdstræet uden `git add` og fik exit 0 — en falsk grøn der
lignede "guarden virker ikke". Anden fejl i samme runde: jeg hentede "pre-fix"-filen med
`git show origin/<branch>:...` **efter** at en anden agent havde pushet rettelsen til samme
branch, så jeg testede den fiksede kode og troede stadig det var den defekte.

Begge fejl har samme form: **jeg antog at det jeg målte på, var det jeg troede jeg målte på.**
Verificér inputtet til en negativ-test lige så hårdt som outputtet — `grep` efter den defekte
linje i den fil du faktisk gav guarden, før du tolker exit-koden.

## Forward-guard

Selve rettelsen ER forward-guarden for #2974-klassen. Det bredere hul — at `preflight-pr.ps1`
og `ci.yml` kan drifte fra hinanden uden at nogen opdager det — er ikke lukket. En vagt der
diff'er de scripts `ci.yml` kalder mod dem `preflight-pr.ps1` kalder ville fange næste
forekomst; den findes ikke i dag.

## Backwards-check

`grep` efter andre CI-jobs med flere `run:`-trin hvor preflight kun spejler ét: ikke udført
udtømmende i denne session. Værd at gøre næste gang nogen rører preflight.

Refs #2974 #3545 #3599
