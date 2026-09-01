# 2026-09-01 · Worker-mønstre fra fase 2-sessionen (S-M2b)

## 1. Worker genindførte en dokumenteret fejlklasse (near-miss, fanget i review)

Hygiejne-workeren løste #4552 med `gh pr merge --auto` — præcis mønstret som
`auto-merge.yml`'s egen header dokumenterer som forbudt (#118: GITHUB_TOKEN-merges
udløser ikke downstream-workflows → deploy-verify sprang over 8/5). Workeren
FLAGEDE selv valget som "design choice to revisit", men byggede det alligevel.

**Læring:** Når en worker rører et område hvor repoet allerede har et etableret
mønster, skal spawn-prompten pege på mønster-filen ("følg auto-merge.yml") — og
orkestratoren skal læse den eksisterende mekaniks header FØR review af workerens
løsning. "Advarsel i rapporten" er ikke nok; afvigelser fra dokumenterede mønstre
skal være rød-flag i review, ikke en fodnote.

## 2. Workers staller på baggrunds-preflight (3× samme session)

Tre forskellige workers endte deres tur med "waiting for the preflight monitor
notification" uden at committe/pushe — baggrunds-vent er upålideligt i dette
miljø (kendt: [[project-background-wait-unreliable-dolmerpc]]). Hver gang
kostede det et nudge + en ekstra runde.

**Læring:** Alle spawn-prompter til workers SKAL indeholde: "kør AL verifikation
SYNKRONT — aldrig baggrunds-vent". Tilføjet i sessionens senere prompts;
virkede (security-workeren gennemførte uden stall).

## 3. Dev-server på workers worktree = delt tilstand med ejeren

Ejerens preview (`/ui/boardroom`) forsvandt midt i hans gennemgang, fordi
workeren (uncommitted, via HMR) slettede preview-siden som "perf-fix".
**Læring:** Når ejeren reviewer på en dev-server der peger på et worker-worktree,
skal workeren have besked om at fladen er I BRUG — eller previewen skal køre
fra et frosset checkout (detached commit), ikke workerens aktive arbejdsmappe.
