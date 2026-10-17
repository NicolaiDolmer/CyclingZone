# Postmortem · 2026-10-17 · Fire fælder fra pc1-sessionen (worktrees, kædede commits, verify)

## Hvad skete der?
1. En read-only review-agent tømte `backend/node_modules` i hovedmappen. Den oprettede et worktree med en junction til hovedmappens `node_modules` og ryddede op med `git worktree remove --force`. Agenten genskabte mappen med `npm ci`.
2. Flere commits gik igennem med en fejlende test, fordi test og commit var kædet med `;` i stedet for `&&`. Rettelserne kom bagefter i nye commits.
3. `git pull --rebase` i en aktiv workers worktree (#6812) lagde workerens lokale rebase oven på den remote version. Workerens hovedcommit forsvandt fra branchen som duplikat. Indholdet mod main var intakt, men historikken fik dublerede main-commits.
4. Deploy verify blev rød to gange uden at noget var galt i prod (#6799):
   - en boot-kohorte fra et senere deploy i samme kø-række flyttede cron-fasen forbi deadline
   - én forbigående GET-fejl midt i pollingen gav `failed` for alle jobs med "unreadable".

## Root cause
1. `worktree remove --force` følger junctions på Windows og sletter målets indhold.
2. `;` fortsætter efter en fejl.
3. Rebase dropper commits, hvis patch-id'et allerede findes upstream. Workeren havde pushet før sin egen rebase.
4. `cron-deploy-verification.mjs`:
   - deadline regnes fra den første boundary, selvom et senere reboot er observeret
   - en læsefejl er en straks-dom i stedet for et nyt forsøg.

## Fix
1. Agent-prompts forbyder worktrees og junctions for read-only arbejde.
2. Kør altid test og commit som `test && guard && commit`.
3. I en workers worktree: `git fetch` og `git merge` (eller kun push af egen commit), aldrig `pull --rebase`.
4. #6799 er åben. Indtil den er rettet: tjek `cron_checkins` direkte i prod (`fresh` mod `total`), og genkør verify med `gh run rerun --failed`.

## Forhindret-fremover
- Hard rule-tekst findes allerede ("aldrig npm ci i en worktree"); tilføj "aldrig `worktree remove --force` på et worktree med junctions" i worktree-runbooken.
- Merge-køens STOP på rød verify er korrekt adfærd. Falske røde koster tid, ikke kvalitet. Rettelsen af #6799 skal gøre dem sjældne.

## Læring
En stopregel er kun så god som sandheden i det signal, den stopper på. Når en gate bliver rød, så mål prod direkte, før du konkluderer.
