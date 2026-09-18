# CRLF gav falsk alarm i security-rls-policy-fn-grants.test.mjs

**Symptom:** `node --test scripts/security-rls-policy-fn-grants.test.mjs` fejlede 3 af 5 tests på
ethvert Windows-checkout med "whitelist-CTE'en skal være afsluttet". CI (`ubuntu-latest`) var grøn.
Opdaget 18/9 under #2671-lanearbejde, reproduceret identisk på uændret main.

**Rod-årsag:** `whitelistRows` fandt CTE'ens slutning med `rest.indexOf("\n)\n")`.
`core.autocrlf=true` giver `.sql`-filen CRLF i arbejdskopien, så den literale LF-streng matcher aldrig.

**Konsekvens:** Ingen i prod eller CI. Fælden er lokal: en Windows-agent der kører testen tror
den selv har ødelagt noget og bruger tid på at jagte en fejl der ikke findes.

**Fix:** Testen læser nu begge filer gennem `readLf` (`.replace(/\r\n/g, "\n")`).

**Backwards-check (18/9):** Alle 71 testfiler i `scripts/` kørt på CRLF-checkout: dette var den
eneste CRLF-fejl. Backend (10.004 tests) og frontend (3.524 tests) på samme checkout: 0 fejl. Statisk scan af `scripts/`, `backend/` og `frontend/` efter tests der læser
filer og matcher literale `"...\n..."`-strenge uden CR-håndtering: 0 øvrige fund.
Sidefund (ikke CRLF): `check-event-catalog.mjs` fejler på ægte drift og er ikke wiret ind i CI.

**Forward-guard:** En test der parser en committet fil tekstuelt skal normalisere linjeslutninger
ved indlæsning, ikke stole på at checkout'et er LF. `.gitattributes eol=lf` er andet lag, ikke første.
