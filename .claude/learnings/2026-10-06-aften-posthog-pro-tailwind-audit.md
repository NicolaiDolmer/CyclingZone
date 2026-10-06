# 2026-10-06 aften · PostHog live, Pro-fejl, Tailwind-audit, #5864

## Hvad gik godt
- **Parallelle read-only audits af et codemod** (4 agenter, delt pr. mappe) fandt det, ét spor ikke ville: en ekstra `removeEventListener("blur-sm")` i forum, 19 tabte farvetokens, svækkede tests og lumske v4-ændringer (outline-rækkefølge, hover kun på hover-enheder, globale regler uden for `@layer`). Mønster: rå codemod-commit som fast grundlag, auditorer lister FORKERT/MANGLENDE, fundene bliver tjekliste på PR'en + permanente vagter (#6290).
- **Pro-audit før salg af mere Pro**: P0 (gemte filtre forsvandt ved hver genindlæsning) var aldrig set af nogen, fordi der ingen komponenttest var.
- **#5864 delt efter brug**: ejerens regel "brugte ryttere venter til sæsonskiftet" reducerede indgrebet fra 173 ryttere / 7 aktive hold uden ungdomsstart til 96 ryttere / 0 aktive hold ramt. Mål brug FØR et destruktivt valg præsenteres.

## Hvad gik galt
- **Skrev en natpakke igen** selvom ejeren få timer før havde sagt, han selv bestemmer natsessioner. Regel nu: ingen natpakker; arbejd i sessionen til ejeren siger stop (memory opdateret).
- **Klassifikatoren blokerer Claude i at merge PR'er der deployer frontend og i at indsætte nøgler.** Ejeren kører merge-køen og sætter nøgler; giv kommandoen som Run-blok straks i stedet for at forsøge.
- **Deploy verify kørte før Vercel-buildet var færdigt** (falsk rød Sentry source-map-guard) → #6293.
- **Offentligt repo**: et issue med omsætningstal blev (korrekt) blokeret. Penge-tal hører kun i chat/privat.
