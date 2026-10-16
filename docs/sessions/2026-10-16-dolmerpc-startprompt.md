# Startprompt: DOLMERPC 16/10 (parallelt med pc1)

Kopiér alt under linjen ind i en ny Claude Code-session på DOLMERPC (mappe `C:\dev\CyclingZone`).

---

Ny session på DOLMERPC. Kør `git pull --ff-only` og læs `docs/NOW.md`. **pc1 er hovedsessionen og ejer merge-køen, `docs/NOW.md` og alle åbne PR'er.** Du merger intet, rører ingen åbne PR-branches, og du ændrer ikke `docs/NOW.md`. Svar på dansk, stil spørgsmål ét ad gangen med en anbefaling, og start intet nyt ud over de tre opgaver herunder uden mit ja (ejer 16/10: hver ny opgave godkendes og får en dag).

Tre opgaver, i denne rækkefølge:

## 1. Spillersvar (kun læsning; jeg sender selv)

- Gå Discord igennem siden 16/10 kl. 12 (guild `1504615050831466669`, Discord-MCP'en, kun læsning).
- Gå også forummet i spillet og feedback-formularen igennem (Supabase MCP, kun SELECT; kolonner i `database/schema-snapshot.json`).
- Find spillerbeskeder uden svar fra mig (Discord-id `328608731585839107`).
- Tilføj svarudkast til den private svarliste https://claude.ai/artifact/2xfBUeM4dJgfktCimNdoBr. Læs den først med Artifact `read`, og republish til samme URL.
- Regler for udkastene:
  - Ingen personnavne i repoet.
  - Tone efter `docs/TONE_OF_VOICE.md`: jeg-form, aldrig "vi".
  - EN eller DA efter spillerens sprog.
  - Skriv kun "rettet", hvis issuet er lukket.
- Notér status på #6319.

## 2. UI-gennemgang for tekst der går ud over kassen (kun fund, ingen rettelser)

Ejeren har bedt om at få fjernet "dumme UI-børnefejl", hvor tekst går ud over kassen, bliver skåret af eller ikke kan læses. #6717 (bestyrelsens mål, stillingens ↓/+, I gang-mærket, patch notes) er allerede valgt og laves separat, så spring dem over.

- Kør mod en lokal dev-server med repoets e2e-fixtures/mock-data. Brug de eksisterende `*.shots.*`-scripts som mønster (`frontend/tests/e2e/`).
- Tag skærmbilleder af alle sider i manager-appen i 1440 px og 375 px, lyst tema.
- Find tekst der klippes (`…` hvor ordet er vigtigt), overlapper, går ud over sin kasse, laver vandret scroll på siden, eller har knapper med forskellig anatomi.
- Aflevér ét annoteret billede pr. side med fund, og en liste sorteret efter hvor meget spillerne bruger siden.
- Skriv fundene på et nyt issue `[ux] Overløbs-gennemgang 16/10`. Byg ingen rettelser, før jeg har valgt dem.
- Følg `docs/design/PAGE_TEMPLATES.md` og `docs/design/TASTE.md` i vurderingen.

## 3. #6724: preflight kører CI's statiske guards lokalt (aftalt til mandag 19/10; forbered nu, PR mandag)

- Lav listen over de statiske guards, der kører i `.github/workflows/ci.yml`, og tjek hvilke `scripts/preflight-pr.ps1` allerede kører lokalt. Kandidater: table-grants, ts-core-ratchet, error-code-coverage, migration-idempotency, workflow-output-guard, feature-registry og static-guards.
- Skriv en plan på #6724: hvilke der tilføjes, tidsforbrug lokalt (mål det), og hvordan kun de berørte guards køres.
- Byg i en worktree (`scripts/new-worktree.ps1 -Branch ops/6724-preflight-guards`), men åbn først PR'en mandag, medmindre jeg siger andet.

Afslut med en kort status til mig og en kommentar på hvert issue. Kør `pwsh -File scripts/close-out-cleanup.ps1` til sidst.
