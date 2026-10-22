# Fredag 23/10: backend-deploy i to trin (ejer klikker)

Ejer-beslutning 22/10: trin 1 = Railway skifter til image af main (uden motor v2) og verificeres; trin 2 = #6820 + #7021 merges, nyt image, verificér. Fuld baggrund: [`RAILWAY_IMAGE_DEPLOY.md`](RAILWAY_IMAGE_DEPLOY.md). Skrevet af natsessionen 23/10; SHA'er udfyldes fra GHCR-listen på dagen.

## Før trin 1 (Claude, 5 min)

1. `gh run list --workflow backend-image.yml --branch main --limit 3` → nyeste grønne `<sha1>`. Kun commits med `backend/`-ændringer får et image.
2. Notér hvad Railway kører nu (fallback): Sentry `release` på node-events (drejebog §2a, metode 1). Sidst målt `28149fcc1` (20/10).
3. `/health` = 200 og ingen etape-tick i gang (undgå HH:57-HH:03).

## Trin 1: main uden v2 (ejer)

1. GitHub → Packages → `cyclingzone-backend` → Public (engangsskridt, runbook skridt 1).
2. Railway → service CyclingZone → Settings → Source → Docker Image: `ghcr.io/nicolaidolmer/cyclingzone-backend:<sha1>`.
3. Deploy-indstillinger (læses ikke fra `railway.json` ved image): healthcheck `/health` 60 s · draining 150 s · start command tom · sæt IKKE `SENTRY_RELEASE`.
4. Deploy.

**Verificér (Claude):** `/health` 200 · Sentry node-`release` = `<sha1>` · ingen nye Sentry-fejl i 15 min · næste etape-tick afvikles (`race_stage_schedule` for dagens etaper bliver `completed`). Det her ruller også de backend-rettelser ud, der er merget siden 20/10 (bl.a. skadebeskeden #7043, og #6988/#7011 hvis toget er nået dertil; `condition_model_v2` forbliver slukket).

**Rollback:** Source tilbage til GitHub-repo, root `/backend`.

## Trin 2: motor v2 (kun efter grønt trin 1 og ordret "tænd")

1. Claude: `pwsh -File scripts/merge-queue.ps1 -Pr "6820,7021"`. Migrationen for `s5_profiles_v2` er allerede applied i prod (CHECK-constrainten læst 23/10).
2. Vent på nyt image for merge-SHA'en `<sha2>` (backend-image.yml).
3. Ejer: Railway Source → `:<sha2>` → Deploy.

**Verificér (Claude):** `/health` 200 · Sentry `release` = `<sha2>` · onsdag 28/10 kl. 11:05: `select engine_rules_revision, count(*) from races where season_id='00000000-0000-0000-0000-000000000005' and stages_completed>0 group by 1;` = `s5_profiles_v2`.

**Frist:** før første S5-etape 28/10 kl. 11:00. Et løb binder revisionen ved første etape-claim; deploy efter det giver v1 for hele det løb.

**Rollback:** Source tilbage til `:<sha1>`. Løb der allerede er bundet til v2, forbliver v2.

## Bemærk

- `race_form_peaks` tændes ved skiftet (drejebog §1), ikke ved deployet.
- Rotér ingen nøgle, som Railway bruger, før trin 1 er verificeret (drejebog H18).
- Merge-køens deploy-verify matcher Railways deployment mod commit-SHA; tjek ved første merge efter skiftet, at den kan se image-deployet.
