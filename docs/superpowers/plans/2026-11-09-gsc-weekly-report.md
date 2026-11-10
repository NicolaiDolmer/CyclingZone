# Ugentlig privat SEO-rapport

Mandat: ejeren 9/11, #7911 og #3797. Usynligt scriptarbejde; PC1 ejer merge. SSOT: ANALYTICS_STACK §1/7 og GROWTH_STACK §9. Genbrug Node-scriptet; ingen dependencies, DB eller UI.

Design: `--weekly` er rullende 7 dage med 3 dages forsinkelse mod de foregående 7. GSC-datoer følger America/Los_Angeles. Ejendomstotaler hentes uden query-dimension. Toplister er udsnit; tomt svar betyder manglende data. `--out` skriver privat Markdown/JSON, afviser Git-mapper og overskriver aldrig filer. Uret injiceres i testbare funktioner.

Alternativer: dashboard/DB udskydes efter retningen på #3797. Offentlig rapport strider mod ejerens privatlivsmandat. Ugentlig app-automation genbruger scriptet efter merge; ingen ny scheduler.

- [x] Node-tests: Pacific-midnat/DST, argumenter, totaler mod query-udsnit, tomme svar, credential-/netværksfejl og privat output. Observer fejl før kode.
- [x] Implementér parseOptions, collectReport, renderReport og writeReport i scripts/gsc-report.mjs.
- [x] Afstem runbook og ANALYTICS_STACK; postmortem om målefejlen uden private tal.
- [x] 9/9 målrettede tests + grøn preflight bag verify-lock; reviewer før guard-commit og auto-push. Én PR, ingen merge.
- [x] Live read-only efter Infisical-nøgle: ugerapport og 28-dages baseline hentet privat; dev/prod-injection verificeret. Status/SHA på #7911 ved PR. NOW/MASTERPLAN ejes af PC1.

Reviewfokus: ukendte argumenter, token-endpoint fra credentialfil, hemmeligheder i API-fejl, nul mod ukendt og links til Git-mapper.

Review: uafhængigt reviewer-spor fandt ét P2 om historisk --now i JWT. Reproduceret rød test; authNow injiceres nu særskilt og læses fra CLI-grænsen. Historiske perioder ændrer ikke login-tidspunktet. Ingen øvrige fund; ingen UI-release eller merge udført.
