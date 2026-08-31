# 30/8: en omdøbning udløste 164 CodeQL-alarmer (#4446/#4451)

## Symptom

164 nye `js/missing-rate-limiting`-alarmer på code-scanning, alle i `backend/routes/api.js`, alle på ordet `requireAuth`, alle oprettet i **samme sekund**. Ingen kode-ændring i nærheden af de 164 ruter.

## Rod-årsag

PR #4392 flyttede `supabase.auth.getUser(token)` ud af `requireAuth` og ind i en ny hjælper: `verifyBearerToken()`.

CodeQL afgør om noget "udfører autorisation" med et rent **navne-regex** (`javascript/ql/lib/semmle/javascript/security/SensitiveActions.qll`):

```ql
s.regexpMatch("(?i).*(login(?!fo)|(?<!un)auth(?!or\b)|verify)(?!err).*") and
not s.regexpMatch("(?i)(get|set).*")
```

`getUser` starter med `get` → eksplicit undtaget. `verifyBearerToken` indeholder `verify` → rammer. `requireAuth` blev derfor fra det ene run til det andet klassificeret som en dyr autorisation, og hvert eneste sted den mountes fik en alarm.

Analyse-tallene isolerer det til én commit:

```
16:13:37  javascript  results=6    (05c8ccda2)
16:50:50  javascript  results=170  (2765ce516)   <- +164
```

## Hvad der IKKE var årsagen

Ingen sikkerhedsegenskab ændrede sig i #4392. Ingen ny sårbarhed. Ingen ruter mistede beskyttelse. Alarm-eksplosionen var udelukkende et artefakt af et funktionsnavn.

## Men alarmerne pegede på et ægte hul

76 af de 164 lå på ruter der allerede HAR en limiter — ægte false positives (CodeQL kræver at limiteren *guarder* ruten, og repoet mounter dem bevidst efter `requireAuth` for at få `req.user.id`). De øvrige 88 lå på ruter uden nogen dækning, og der var **ingen global limiter** på `/api`. `requireAuth` laver et Supabase-netværkskald pr. request, så enhver uden gyldigt token kunne tvinge ét auth-kald pr. request i det uendelige.

## Fix (PR #4451)

`router.use(apiBaselineLimiter)` mountet før enhver rute (600/min pr. IP, direkte `rateLimit()`-kald så CodeQL kan spore det), plus limiter på de 12 ubeskyttede skrive-ruter. Efter merge: 170 → 5 resultater, **0 åbne alarmer**.

## Målinger der afløste gætværk

Første udkast af PR-body påstod "en aktiv spiller topper langt under 200/min" uden belæg. Målt bagefter:

- `traffic_events`, 14 dage, bots ekskl.: peak **30** sidevisninger/min for HELE spillet, p99 = 8, gennemsnit 1,9, peak **7** samtidige besøg.
- `identity_events`, 30 dage: **40 distinkte offentlige IPv4**, nul private-range → `trust proxy = 1` resolver rigtigt.
- Live efter deploy: `ratelimit: limit=600, remaining=...` falder præcis 1 pr. kald → bucket'en er pr. IP, ikke delt.

To andre påstande i samme PR-body holdt heller ikke: en advarsel om "delt bucket" (limiterne nøgler på bruger-id, ikke IP — `requireAuth` sætter `req.user` før dem) og en "fejl" om at Alunta-webhooken lå bag limiteren (`subscriptions` = 1 række; volumen er nul).

## Læring

1. **En scanner-alarm der eksploderer i ét sekund uden en tilsvarende kode-ændring er næsten altid en heuristik der har skiftet mening — ikke en ny sårbarhed.** Find den commit analysen skiftede på (`code-scanning/analyses` viser `results_count` pr. run) før du læser alarmerne som fund.
2. **Slå heuristikken op i stedet for at gætte på den.** Query-kilden ligger i `github/codeql` og kan hentes med `gh api repos/github/codeql/contents/<sti>`. Regex'et gav svaret på fem minutter; teoretisering ville have givet en plausibel og forkert forklaring.
3. **En falsk alarm kan stadig pege på et ægte hul.** Alarmerne var støj, men de 88 udækkede ruter og den manglende globale limiter var reelle. Afvis ikke hele bundtet fordi udløseren var et artefakt.
4. **Tal i en PR-body skal være målt, ikke skønnet.** Tre påstande i første udkast var gæt. De holdt tilfældigvis, men margenen var ukendt indtil den blev målt.
5. **En grænse uden logning er usynlig.** Ingen limiter loggede noget før denne PR; ramte en bremse en rigtig spiller, ville det først dukke op som en klage.

## Rest

- In-memory-store, én instans: skalerer Railway horisontalt, får hver instans sin egen tæller. Hører sammen med [#2095](https://github.com/NicolaiDolmer/CyclingZone/issues/2095).
- Rate limiting er ikke DDoS-værn — IP-rotation kommer udenom. Det niveau kræver en proxy foran Railway.
- Grænsen har 4-20x margin ved nuværende spillerbase. Ved kraftig vækst (mobil-CGNAT deler allerede op til 31 brugere pr. IP) skal tallet revurderes; `[rate-limit] 429 api-baseline`-linjer i Railway-loggen er signalet.
