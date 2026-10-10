Ny session 11/10. Læs FØRST `docs/NOW.md` og `docs/sessions/2026-10-11-session-design.md`. Designet er ejer-godkendt 10/10 aften; genåbn ingen beslutninger i det.

Mål, i prioriteret rækkefølge: den rene løbsmotor-revision (`official_times_v3`) skal være færdig, bevist og tændt så hurtigt som muligt. Spec: `docs/superpowers/specs/2026-10-10-ren-motor-revision-design.md`. Plan: `docs/superpowers/plans/2026-10-10-ren-motor-revision.md`. Ingen tidsskøn; meld checkpoints.

Første skridt:
1. Status: `gh pr list --state open`, CI på #6431 og #6436, at Touren 11/10 kører på `official_times_v2`, og Sentry 24 t (`infisical run --env=dev --silent -- node scripts/sentry-issues.mjs --period=24h`).
2. Merge #6436 (patch 7.353, ejer-OK) via `scripts/merge-queue.ps1`, hvis den ikke er merget.
3. Ret #6431: `breakawaySize6201.test.ts:305` fejler efter form (#6430). Flad median 2,5 på Giro-feltet mod ejerens mål 3-6. Merge som slukket revision. Luk #6397 bagefter (indeholdt).
4. #6434: forbind `sprintTrainLeadoutOrder` i `aiTactics.ts` under v3.
5. Byg **Motor-testbænken** (ejer-valg): en privat Artifact, delbar med staff, aldrig spillervendt. Hundredvis af skyggeløb fra rigtige prod-etaper (sidste dage + Touren) under v2 og v3, med rigtige felter og ordrer, flere seeds, kun læsning. Claudes dom øverst, side om side pr. etape med ejerens låste mål, filtre, kommentarer og anonymisering. Load artifact-design og artifact-capabilities før byg.
6. Gaten (`backend/scripts/dev/cleanRevisionGate.mjs`) skal være grøn, med dagens prod-fund som målepunkter (#6428, bjerg for spredt, fixture for samlet). Så Fable-dom, så testbænken til ejeren. **Intet tændes automatisk: ejeren skal have set testbænken og sagt "tænd".**

Ved siden af: én bølge (`wave.js`) med sidespor i rækkefølgen fra designet:
- træningsklager (alle 4 områder)
- CodeQL (3 fund)
- 10 spillersvar i ejerens stemme; han poster selv
- S5-kalender + profiler (18/10)
- sæsonskifte-plan (25/10)
- løfter #3984/#4714 (én beslutning hver)
- chunk/registry/DB-vagt

Kombinationsreglen: motoren har førsteret, og Udvikling 2.0 starter først, når motoren er live.

Faste regler: UI-PR kun "klar" med rigtigt skærmbillede + grønne e2e. Én merge-kø, ingen automatiske kæder. Ingen `npm ci` i et worktree med junction-node_modules. Ét spørgsmål ad gangen med billede som fil. Svar på dansk. Close-out som i CLAUDE.md.
