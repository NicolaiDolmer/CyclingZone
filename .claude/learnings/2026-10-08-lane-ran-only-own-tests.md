# 2026-10-08: bølge-lane meldte klar efter kun egne tests (#6348)

**Hvad skete:** PR #6348 (presence i skjulte faner) blev meldt klar og fik opus-review uden blokerende fund. Efter opdatering mod main var CI rød: to eksisterende kildekontrakt-tests (#4350) ledte efter den gamle kodestruktur, railway-log-watch' forward-guard manglede en tærskel for det nye log-tag `online-count`, og catch-vagten talte en ny svaltet catch. Lanen havde kun kørt sine egne nye tests; revieweren fangede det heller ikke.

**Rod:** Briefen krævede "verify-affected + lint + frontend node --test", men ikke eksplicit hele pakkens suite eller de statiske CI-vagter for backend-ændringer.

**Rettet:** #6357 — briefen kræver nu hele pakkens test + lint + typiske CI-vagter (catch-vagt og log-vagt under backend) og en ny kørsel efter merge af origin/main, før `gh pr ready`. Test låser kravet og placeringen.

**Sidefund samme dag:** merge-køens nye batching ville have givet flere Railway-deploys i træk, fordi "rører ikke backend/" ≠ "deployer ikke Railway" (watchPatterns). Fanget af opus-review før merge; rettet med deploy-verify efter rækken og loft 3. Deploy-verify selv har samme uoverensstemmelse (#6358).
