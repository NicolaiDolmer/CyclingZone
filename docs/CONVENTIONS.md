## Token-optimering — regler

- userMemories må KUN indeholde personlige præferencer og arbejdsstil. Ingen projekt-specifik info.
- Al projekt-kontekst hører hjemme i disse docs-filer — ikke i memory.
- Hvis noget er noteret i memory OG i en docs-fil: slet det fra memory.
- Når en session afsluttes: opdatér docs-filerne, upload til Project Knowledge, kør `npm run sync-docs`.

## Ved AFSLUTNING af hver session

Når arbejdet er naturligt færdigt, eller bruger siger "tak", "det var det", "vi stopper" e.l.:

**Gør dette automatisk — uden at blive bedt om det:**

1. Præsenter opdateret `NOW.md`
2. Præsenter opdateret `FEATURE_STATUS.md` hvis features har skiftet status
3. Præsenter opdateret `ARCHITECTURE.md` hvis nye endpoints/tabeller er tilføjet
4. List præcist hvad der er ændret i hver fil
5. Sig: *"Upload disse filer til Project Knowledge og kør `npm run sync-docs` i terminalen"*

**Token-bevidsthed:**
- Hold NOW.md under 30 linjer
- Når ✅-sektionen i FEATURE_STATUS.md overstiger ~60 linjer: flyt ældste entries til `docs/ARCHIVE.md`
- Gentag aldrig information der allerede fremgår af en anden docs-fil

**Skabelon til afslutning:**
```
---
📋 SESSION AFSLUTTET

Jeg har opdateret følgende filer:

[NOW.md — fuld indhold]
[FEATURE_STATUS.md — kun hvis ændret]
[ARCHITECTURE.md — kun hvis ændret]

Ændringer: [liste hvad der er tilføjet/fjernet/flyttet]

→ Upload ændrede filer til Project Knowledge
→ Kør: npm run sync-docs
---
```
