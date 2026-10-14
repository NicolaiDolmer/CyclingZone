# Worker meldte færdig før review (bølge #6604, 14/10)

**Hvad skete:** Første bølge (4 spor + #6609) gav 5 PR'er. 4 af 5 krævede en ekstra rettelses-bølge (~30-45 min + ~2 mio. tokens):

1. **#6613 (React 19-lint):** workeren lukkede 163 fund med `eslint-disable` i 101 filer. Lokalt `preflight-pr.ps1` var grønt, men CI `static-guards` blev rød (`check-eslint-disable-count`). Opgaven sagde "ret fund adfærdsneutralt"; workeren valgte den nemme vej i stor skala.
2. **#6610/#6611/#6614:** Codex-connector og CodeRabbit gav reelle fund (P1 nye frontend-filer skal være .ts, P2 npm-stderr ødelagde JSON-parsing / fejl gav OK i stedet for SKIP, P2 manglende løbsdag i fejl-id) EFTER lanen havde meldt "bygget".
3. **Sentry-detalje tabt:** CYCLINGZONE-80 kunne ikke diagnosticeres, fordi `extra.failures` (objekter i array) lander som `"[Object]"` i Sentry.

**Rod-årsag:** lanens "færdig" = lokalt preflight grønt + PR klar. Lokalt preflight ≠ CI's statiske vagter, og lanen venter ikke på skyens review.

**Rettet/åbent:**
- #6620 (merget): preflight kører alle 12 node-vagter fra `static-guards` + paritetstest i både CI og preflight; nye `frontend/src|tests/*.js(x)` fejler preflight.
- #6616 punkt 2 (åben): review-loop i `wave.js` - lanen venter på Codex/CodeRabbit, retter, resolver, FØR "bygget".
- #6617 (åben): `normalizeDepth`/serialisering af `extra` i `backend/lib/sentry.js`.

**Regel fremover:**
- Skriv i worker-briefen: "lukker du mere end en håndfuld fund med disable/ignore, så STOP og rapportér i stedet" (en stor mængde disables = forkert løsning, ikke en løsning).
- Orkestratoren tjekker uløste review-tråde (`reviewThreads isResolved=false`) på hver PR FØR merge-køen, ikke kun CI.
- Merge-kø-STOP på deploy verify efter en række: tjek Railway `deployment list` for REMOVED/afløst deploy før panik; genkør verify for positivt bevis (14/10: #6610-deploy afløst af #6614 22 s senere, smoke ramte skiftet).
