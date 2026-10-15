# Startprompt 16/10: samlet session (pc1 + DOLMERPC-rester)

Ny session på pc1. Kør `git pull --ff-only`, læs `docs/NOW.md` og denne fil. Den afløser `2026-10-16-pc1-fortsaettelse.md`, som stadig gælder for detaljer. Du er den eneste aktive session og driver selv merge-køen (`pwsh -File scripts/merge-queue.ps1 -Pr "a,b"`, én kø-proces ad gangen). Svar på dansk i ALLE beskeder. Stil spørgsmål ét ad gangen med en anbefaling, og send et PNG-billede (SendUserFile) før hvert UI-spørgsmål. Byggearbejde køres via `.claude/workflows/wave.js` med `name: "wave"` fra repo-roden (ejer-opt-in står i CLAUDE.md).

## Status fra DOLMERPC 15/10

- **Merget:** #6664 (dansk JSON-LD), #6682 (læsbar lysegrå tekst i lyst tema, #6681), #6688 (ét hjørnemål 8 → 5 px + lint-regel, #6686), #6676 (belastningstest før sæsonskiftet, #5904), #6678 (ungdom: advarsel under 6 ryttere + aldersgrænse, #5907/#5920), #6685 (løbets stillinger på telefon uden vandret scroll, #6684), #6675 ("managere"), #6663 (ubrugt GIN-indeks droppet, #6490; post-verificeret af pc1).
- **#6677 databaseporten for trup-skift (#6489):** grøn og Codex-reviewet. Ejer 15/10: merges i morgen formiddag efter CodeRabbit-review og uden for 19:30-21:00. Migrationen appliceres af auto-migrate; post-verificér straks.
- **Svarlisten** (https://claude.ai/artifact/2xfBUeM4dJgfktCimNdoBr) har 4 nye svar øverst ("Nye 15/10 eftermiddag"). Ejeren poster selv. Status står på #6319.
- **Forsiden #6665:** ejeren læser den i ro og mag og deler den med andre. Spørg ikke til den, før ejeren selv tager den op. Tekstgennemsyn: https://claude.ai/artifact/V8EPkRboQjV2jP9Qq6ZQoS. Når #6665 er merget: giv `marketing/app/globals.css` samme text-2/text-3-værdier som #6682.
- **Designoprydning (ejer: ét spørgsmål ad gangen med visuelle eksempler):** valg 1 stillinger (merget) og valg 2 hjørner (merget) er klaret. Valg 3 mangler: tekstpile (→ ✓ ▲) i stedet for stroke-ikoner. Mål først, hvor mange der er UI-chrome og ikke copy (agentens tal 391 var et loft), og vis ét før/efter-billede.

## Spørg ejeren først (ét ad gangen, med anbefaling)

1. **Løbshistoriens animationsretning (#6643).** Prototype: https://claude.ai/artifact/CA4LsBcohcSusZXr9gTRWG. Anbefaling: A i "Whole stage" + B's gab-kurve som strimmel + C's vej i "Final 5 km" med fotofinish-liste. Ingen beta-merge før animationerne er af meget høj standard.
2. **Review-gaten (#6657) og CodeRabbit-loftet (1 review/time).** Anbefaling: løsn reglen til Codex-review + grøn CI for UI/tests med ejer-go; CodeRabbit kun på backend/DB/motor.
3. **Designvalg 3: tekstpile → ikoner** (se ovenfor).

## Prioriteret arbejde

1. **Akademi pull-optag før søndag 18/10 kl. 00** (#6155): afklar PR #6662 (hent-knap) og #6673 (optag 2.0, draft, røde checks). Flag-tænding kun på ejerens ordrette go.
2. **#6677 merge i formiddag** (se ovenfor).
3. **#6490: mål aftenens træningsafregning 15/10 og 16/10** mod baseline efter indeks-droppet (spec `docs/superpowers/specs/2026-10-15-training-10x-jobqueue-direct-pg-design.md`). Valget postgres.js er truffet (#6492); concurrency-knappen måles før worker-placering (#6491).
4. **S5-start 28/10:** U23/junior-kalender dry-run (`buildSeasonCalendar.js ... --dump-plan`) til ejeren før noget skrives.
5. **#6680 kalender-kort → #6683 ikoner + Kalender | Tabel** (review-fund og røde checks står på #6680).
6. **Motor-drafts inden for bånd:** #6658 (udbrudsstørrelse), #6671 (AI-ungdom).
7. **#6186 tekst-PR** til help.json (EN+DA) + RACE_ENGINE_RULES.md, kun kvalitativt (hard rule 17).
8. **Patch note 7.361 (#6661):** DOLMERPC har tilføjet sine 4 merged ændringer (stillinger på telefon, ungdomsadvarsel, læsbar grå tekst, ét hjørnemål). Få ejerens go på hele noten via kommunikations-sessionen, og merge.

## Oprydning

- `pwsh -File scripts/close-out-cleanup.ps1` (dry-run, derefter `-Execute`). Advarsel #6687: tjek bagefter hovedcheckoutens `node_modules`; kør `npm run sync-deps`, hvis de er tomme.
- Fjern worktrees, hvis branch er merget: `feat-6570-race-story` (kun når #6643 er merget), `fix-6684-standings-mobile`, `fix-6674-da-managere`, `chore-6490-drop-gin`, `test-5904-raceday-loadtest`, `feat-5907-5920-youth-floor-age-label`, `docs-brand-stability-15-10`, `fix-1369-da-jsonld`.
- `MEMORY.md` og `AGENTS.md` er over token-budget (`scripts/check-agent-token-hygiene.ps1`).
