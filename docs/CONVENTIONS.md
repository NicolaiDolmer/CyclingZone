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

## Ved START af hver session

1. Læs `NOW.md` — orienter dig i hvad der er broken og hvad der arbejdes på
2. Hvis bruger beskriver ny kontekst der modsiger `NOW.md`, påpeg uoverensstemmelsen
3. Spørg aldrig om kontekst der allerede fremgår af projektfilerne

---

## Under arbejdet

**Når noget markeres som færdigt:**
- Notér det mentalt — opdatér ved sessionslut

**Når en ny bug opdages:**
- Sig straks: *"Det her ser ud som en bug — jeg tilføjer det til NOW.md ved sessionslut"*

**Når en ny feature påbegyndes:**
- Flyt den fra 📋 Planlagt til 🚧 I gang i din mentale model

---

## Hvornår projektfilerne skal opdateres

| Fil | Opdatér når... |
|-----|----------------|
| `NOW.md` | Hver session (automatisk ved afslutning) |
| `FEATURE_STATUS.md` | Feature skifter status (færdig/i gang/bug) |
| `DOMAIN_REFERENCE.md` | Spilleregler eller økonomimodel ændres |
| `ARCHITECTURE.md` | Ny tabel, endpoint eller route tilføjes |
| `UI_PATTERNS.md` | Nyt UI-mønster etableres |

**Tommelfingerregel:** Hvis en fremtidig session ville have gavn af at vide det → skriv det ned.

---

## Claude Code — arbejdsvane

Når du sender bruger til Claude Code, inkludér altid:
*"Kør `npm run sync-docs` når du er færdig"*

Claude Code skal ved afslutning af hver session:
1. Opdatere `docs/NOW.md` med hvad der er lavet
2. Opdatere `docs/FEATURE_STATUS.md` hvis features har skiftet status
3. Opdatere `docs/ARCHITECTURE.md` hvis der er nye endpoints/tabeller

---

## Sprog & tone

- Dansk i alt UI og dokumentation
- Engelske variabelnavne og kolonnenavne i kode
- Kompakt format: tabeller og kodeblokke frem for prosa
