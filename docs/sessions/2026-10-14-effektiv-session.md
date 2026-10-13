# Session 14/10: effektiv eksekvering (S5 + backlog + vækst)

Planlagt 13/10 aften med ejeren. Mål: mange færdige leverancer med høj kvalitet og lavt tokenforbrug. Alle beslutninger nedenfor er truffet; genåbn ingen af dem.

## Startprompt (kopiér ind)

```
Ny session efter docs/sessions/2026-10-14-effektiv-session.md. Læs KUN den fil + docs/NOW.md (ikke MASTERPLAN, GDD eller specs medmindre et spor kræver det). Kør "Første 15 minutter", start derefter bølgen med args fra filen. Ejeren er med. Spørg mig ét kort ad gangen. Svar på dansk.
```

## Regler for tokens og tempo

1. **Læs smalt:** `gh ... --json <felter> --jq`, `grep -n`, `sed -n a,bp`. Aldrig hele store filer, aldrig fulde CI-logs (kun fejlende job, `tail -40`).
2. **Én bølge ad gangen, fyldt fra start** (4 laner). Ingen håndskrevne agenter, undtagen `READ-ONLY:` med en klar returform.
3. **Workers rapporterer kort:** PR-link, hvad der er grønt, hvad der ikke er dækket. Orkestratoren læser ikke deres transcripts.
4. **Merge** via `scripts/merge-queue.ps1` med ABSOLUT sti (cwd skifter), i baggrunden, én kø ad gangen. Stående merge-regel (rule 35) gælder; migrationer og spillervendte PR'er kræver ejer-go/preview-go.
5. **Ejer-kort:** ét ad gangen, nøgletal i selve spørgsmålet, billede i samme tur. Saml op, forstyr ikke undervejs.
6. **Ingen nye løbende udgifter** (ejer 13/10). Ingen motor-tænding uden ejer-go.

## Første 15 minutter (orkestrator, uden ejeren)

1. "Hvad brænder" (#6549): kom den selv kl. 08? (GitHub-cron kørte ikke 13/10.) Hvis nej: undersøg cron-registreringen, ret i samme session.
2. Merge-status: #6565 #6567 #6568 (S5 generator/gate/motor) merget? Post-verify: `node --test` på main grøn. #6535 (lockfiler): CodeRabbit ren? → merge-kø, derefter `npm run sync-deps`.
3. Databasevagten (#5878) grøn de seneste kørsler?

## Bølge (start straks efter de 15 minutter)

`Workflow({ name: "wave", args: <nedenfor> })` fra repo-root. Spor:

| Spor | Issue | Model | Værdi |
|---|---|---|---|
| A | #6569 Dashboard: "Dagens etaper" henter samtidig med siden + intet skelet-blink (punkt 1+2) | sonnet | 1-2,6 s hurtigere for alle spillere hver dag |
| B | #6557 SEO: `noindex` i app-skallen, `robots.txt` for app-ruter, rigtig 404 | sonnet | Retter 5 af 7 Bing-fund |
| C | #6574 Road book-billede (OG, 0 kr.) til S5-lanceringen | sonnet | Delbart billede + link-preview; ejer-go på preview |
| D | #6551 Scout-mission: betalt uden rapport (investigate, read-only) | opus | Rod-årsag + refusions-kort til ejeren (spillerrapport, 24 t-reglen) |

Når en lane bliver fri: #6558 IndexNow (sonnet) · #6570 etapeside 2.0 frontend-skelet (sonnet, kun efter ejer-go på retningen, som er givet 13/10: 6A+6C+P3/P4).

```json
{"rollingIntake": true, "tracks": [
 {"issue":6569,"branch":"perf/6569-dagens-etaper","title":"[perf] Dashboard: Dagens etaper henter samtidig + intet skelet-blink","scopeText":"Kun punkt 1+2 i issuet: kald useTodayStages på topniveau i DashboardPage så hentningen starter sammen med loadAll (isolation efter DASHBOARD_RULES §3 bevares), og sæt kun loading:true når der ingen kort er (stale-while-revalidate). Ingen visuel ændring ud over at kortet kommer hurtigere. Test + lint + build i FORGRUNDEN.","model":"sonnet","noVisibleChange":true,"noVisibleReason":"Samme UI, kun hurtigere indlæsning","tier":"TARGETED","ownership":["frontend/src/hooks/useTodayStages.js","frontend/src/components/TodayStagesStrip.jsx"],"touches":["frontend/src/pages/DashboardPage.jsx"],"verifyCommands":["npm run lint --prefix frontend","npm test --prefix frontend","npm run build --prefix frontend"]},
 {"issue":6557,"branch":"fix/6557-app-shell-noindex","title":"[SEO] App-skallen: noindex, robots, rigtig 404","scopeText":"Se issuet. noindex i frontend/index.html (prerenderede sitemap-sider må IKKE få noindex - verificér alle 16), Disallow for app-ruter i robots.txt, 404-status for ukendte stier. Kør scripts/check-cdn-cache-headers.mjs. Curl-bevis i PR-body.","model":"sonnet","noVisibleChange":true,"noVisibleReason":"Kun meta/robots/HTTP-status, ingen synlig UI","tier":"TARGETED","ownership":["frontend/index.html","frontend/public/robots.txt"],"touches":["frontend/vercel.json"],"verifyCommands":["npm run build --prefix frontend","pwsh -File scripts/preflight-pr.ps1"]},
 {"issue":6574,"branch":"feat/6574-roadbook-og","title":"[growth] Road book OG-billede pr. etape","scopeText":"Se issuet. P2-stil fra designlærredet. Vercel OG, 1200x630, cache, 0 kr. Egne løbsnavne. Lever ét før/efter-billede; merge kræver ejer-go på preview.","model":"sonnet","designGo":"13/10 #6574 (P2 i designlærredet, ejer: ja)","tier":"TARGETED","ownership":["frontend/api/og/"],"verifyCommands":["npm run build --prefix frontend","pwsh -File scripts/preflight-pr.ps1"]},
 {"issue":6551,"branch":"investigate/6551-scout-mission","title":"[bug] Scout-mission betalt uden rapport","scopeText":"READ-ONLY undersøgelse: find rod-årsagen (kode + SELECT mod prod, schema-snapshot først), hvor mange spillere er ramt, og foreslå rettelse + refusion som kort til ejeren. Ingen kode, ingen DB-skrivning.","model":"opus","kind":"investigate","tier":"TARGETED","ownership":[],"verifyCommands":[]}
]}
```

## Ejerens dag (i rækkefølge, ét kort ad gangen)

1. **Morgen:** fund fra "Hvad brænder" + merge-status (kort).
2. **#6551 scout-kort:** rod-årsag + refusion (efter spor D).
3. **Bogføring:** bankafstemning + kvitteringer i Dinero (ejer); Claude tjekker posteringerne. Liste over faste abonnementer → forslag til opsigelse.
4. **Revisor-spørgsmål #4511** (moms EU-privat): Claude skriver det klar, ejeren sender.
5. **Preview-go:** road book-billedet (#6574).
6. **Kl. 20:** pause-afstemningerne lukker (forum-poster 8a504dc4 + b76339e3) → læs resultatet → S5-startdato til generatoren → kommentér #5833.
7. **Aften:** #6490 anden observationsaften → DROP INDEX-kort.

## Torsdag 15/10 (forretningsdag) og frem

- Torsdag: tørkørsel af hele S5 gennem gaten (#6367) med startdatoen · G4-tjek før annoncetest 22/10 · Codex' udkast (S5-opslag, annoncetest, marts-plan).
- Fredag 16/10: før/efter-billede af S5-kalenderen → ejer-go. Lørdag 18/10: live.
- 19-25/10: Pro-sporet #2806 (inkl. Founder-adgang), dashboard punkt 3+4 (#6569), S5-mail tørkørsel (#6554), etapeside 2.0 (#6570).

## Status ved overdragelse (13/10 aften)

- **Merget 13/10:** #6555 (S5 Fase 0, migration post-verificeret) · #6556 (S5-mail som kampagne) · #6561 (GitHub Actions) · masterplan-omlægning.
- **I merge-kø:** #6565 generator · #6567 benchmark-gate · #6568 motor (bag slukket `s5_profiles_v1`).
- **Venter:** #6535 lockfiler (CodeRabbit) · #6566 etapekort merges IKKE (afløst af #6570).
- **Beslutninger 13/10:** masterplan = Brand / Nu (≤5) / Forretning · mål 31/12: 2.000 kr. MRR + 200 aktive/7d · Founder-funktioner kræver aktiv Pro · aldring 0,7 · annoncetest 500 kr. · S5-mail til alle med samtykke (send kun på ejer-go) · etapeside 6A+6C+P3/P4 · ingen udviklingstal på løbssiden · route fit kun på egne ryttere · ingen nye løbende udgifter før indtægt stiger · offentligt navn "Dolmer".
