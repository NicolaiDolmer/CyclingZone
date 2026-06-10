# Delt Playwright-port på tværs af worktrees gav false-green — nu strukturelt fixet

**Dato:** 2026-06-10
**Kontekst:** Multiagent-bølge med parallelle worktree-agenter under `.claude/worktrees/`

## Symptom

En agents `core-smoke`-suite passerede **18/18** — men mod en helt anden worktrees
dev-server. Agentens egne ændringer var reelt uverificerede. Opdaget først via et
screenshot der viste gammel UI, ikke via testresultatet.

## Rod-årsag (recidiv)

Samme mekanik som [2026-05-31-learningen](2026-05-31-stale-dev-server-shared-port-fakes-e2e-verify.md):
`frontend/playwright.config.js` havde hardcodet `PORT = 4173` og
`reuseExistingServer: !process.env.CI`. Lokalt genbruger Playwright **enhver**
server der lytter på porten — uden at tjekke hvilken worktree den serverer fra.
Med N parallelle agent-worktrees er kollisionen ikke længere en sjælden
stale-proces-fælde men en næsten garanteret race: den første agents server
"vinder" porten, og alle efterfølgende suiter validerer dens kodebase.

05-31-fixet var **disciplin** (tjekliste: verificér port-ejer manuelt før du
stoler på grøn). Discipliner skalerer ikke til 16 autonome agenter → bidt igen.

## Fix (strukturelt, 3 lag — `frontend/playwright.ports.js`)

1. **Deterministisk port pr. worktree:** main-checkout (`.git`-mappe) beholder
   4173 (CI/snapshots uændret); linked worktrees (`.git`-fil) hasher
   worktree-stien til en port i 4300-4999. Parallelle worktrees kolliderer ikke
   uden manuel handling. `PW_PORT` overrider eksplicit.
2. **`--strictPort`:** vite må aldrig hoppe til nabo-port mens baseURL peger på
   den gamle.
3. **Identity-guard:** vite-plugin eksponerer `/__worktree-id` (dev + preview);
   Playwrights `globalSetup` fetcher den og **fejler højlydt før suiten** hvis
   serveren på porten serverer en anden rod — eller slet ikke har endpointet
   (stale pre-fix-server). En false-green kan ikke længere opstå stille; selv
   en hash-kollision mellem to worktrees ender som hård fejl, ikke forkert grøn.

Verificeret: to samtidige worktrees kørte fuld `core-smoke.spec.js` (alle 3
projekter) med hver sin server (port 4777 / 4885, separate PIDs); guard-negativ-
test mod fremmed server fejlede højlydt som designet.

## Læring

- **Backwards-check + forward-guard:** når samme fælde bider 2. gang, er
  tjekliste-modforanstaltningen bevist utilstrækkelig — byg så guarden ind i
  værktøjet, så den forkerte vej fejler højlydt af sig selv.
- En verifikations-mekanisme der kan give "grøn" uden at røre din kode er værre
  end ingen verifikation — den producerer falsk tillid. Guard-design skal sikre
  at miljøfejl → **fejl**, aldrig → forkert succes.
