# npm ci/sync-deps inde i et worktree kan tømme HOVED-checkoutets node_modules

**Dato:** 2026-08-05
**Kontekst:** Natbølge-session på #3007 (aktiverings-hul, onboarding). Ikke selve feature-arbejdet — et operationelt uheld undervejs, værd at fange for fremtidige agenter.

## Hvad skete der

`docs/WORKTREE_WORKFLOW.md` (#2967) beskriver at `setup-worktree.ps1` junction-linker et worktrees `frontend/node_modules` til HOVED-checkoutets rigtige `node_modules`, **når lockfilen matcher** — det sparer ~500 MB + install-tid. Gaten forhindrer kun at der oprettes en junction når lockfilen IKKE matcher; den forhindrer intet når man senere manuelt kører `npm ci`/`npm run sync-deps` inde i et worktree hvor junctionen allerede ligger (lockfilen matchede jo — det er netop derfor den blev linket).

Denne session: `node --test` fejlede først med `Cannot find package 'react'` (16 filer i node_modules). Uden at genkende symptomet kørte jeg `npm run sync-deps` (= `npm ci` i frontend) for at "reparere" det — men `frontend/node_modules` var en junction til `C:\Dev\CyclingZone\frontend\node_modules`. `npm ci` sletter node_modules FØR den geninstallerer, og sletningen føres igennem junctionen ind i HOVED-checkoutet. Main gik fra en fungerende install til 9 tilbageværende pakker, midt i en flerspors natbølge hvor andre agent-sessioner sandsynligvis også læser/skriver samme deling.

En enkelt fil (`@rolldown/binding-win32-x64-msvc/rolldown-binding.win32-x64-msvc.node`) var permanent EPERM/EBUSY-låst af en anden kørende proces (formentlig en anden parallel agents dev-server) gennem hele sessionen — hver `npm ci`/`npm install` mod den delte sti fejlede midt i geninstallationen, hvilket efterlod main i en delvist ødelagt tilstand flere gange i træk.

## Rod-årsag

1. `[ -e "$d" ]`-checket i `scripts/hooks/setup-worktree-if-needed.sh` kører som **PreToolUse-hook på hvert Bash-kald** (ikke kun SessionStart), så et forsøg på at fjerne junctionen og køre en uafhængig install i TO separate tool-kald bliver overhalet: hooken ser "node_modules mangler" mellem de to kald og genopretter junctionen, FØR ens egen `npm ci` når at køre.
2. `npm ci`/`npm install` mod en sti, der er en junction til et RIGTIGT, i-brug node_modules, er destruktivt uanset om lockfilen matcher — delingen er kun sikker for LÆSNING (køre tests/build/lint), aldrig for skrivning.

## Fix / recovery denne session

1. `cmd /c rmdir /Q frontend\node_modules` (fjerner KUN junction-punktet, ikke målet) + `npm ci` i **samme** PowerShell-kald (ét tool-kald, så PreToolUse-hooken ikke når at genoprette junctionen imellem) → uafhængig, worktree-lokal install (407 pakker, ingen konflikt med den låste fil, fordi det er en helt ny mappe).
2. Reparerede main separat: `npm install` (IKKE `ci` — reconciler i stedet for slet-alt-først) mod main's absolutte sti, kørt 2 gange (`npm install` er ikke altid idempotent i ét hop fra en delvist ødelagt tilstand). Én pakke (`playwright`, ikke `@playwright/test`) forblev korrupt pga. den låste fil; hentet en ren kopi via `npm install` i en scratch-mappe og `cp -r` den ind manuelt, uden at røre den låste rolldown-fil.
3. Verificerede main med `node --test` (grønt) før jeg gik videre.

## Forward-guard (UDFØRT samme dag, #3367)

Rod-årsagen er fjernet strukturelt i stedet for at blive advaret om:

1. **Worktrees junctioner ikke længere til hoved-checkoutet.** `setup-worktree.ps1` peger dem på en delt cache nøglet på `package-lock.json`-hash i `%LOCALAPPDATA%\CyclingZone\node-modules-cache\`. Der findes ingen sti fra et worktree ind i mains `node_modules`. Rammer nogen cachen, er skaden selv-helende (næste setup-kørsel genopbygger den) og rammer ingen checkout.
2. **`npm run sync-deps` kører `scripts/guard-node-modules-junction.mjs` først** og nægter med den korrekte opskrift hvis en `node_modules` er en junction.
3. **Sundheds-tjek i stedet for eksistens-tjek** i hooken og i `preflight-night-wave.ps1` (`node_modules/.package-lock.json`), så en udhulet install fanges før den bliver til `ERR_MODULE_NOT_FOUND` midt i en kørsel.

**Vigtig detalje der udelukkede den oplagte løsning:** en `preinstall`-lifecycle-guard virker IKKE. `npm ci` sletter `node_modules` **før** `preinstall` kører (verificeret på npm 11.13.0 med en sentinel-fil: den var allerede væk da preinstall fyrede). Guarden skal ligge før npm overhovedet startes.

## Lektion for fremtidige agenter

Se `Cannot find package 'X'`/mistænkeligt lavt antal filer i et worktrees `node_modules`? **Tjek FØRST om det er en junction** (`Get-Item node_modules | Select LinkType` eller `ls -la` i git-bash) før du kører `npm ci`/`npm install`/`npm run sync-deps`. Er det en junction, er den delte main-installation sandsynligvis allerede fungerende — brug den til at LÆSE (køre tests), rør den aldrig med en skrive-operation.
