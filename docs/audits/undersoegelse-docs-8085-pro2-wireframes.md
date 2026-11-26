# Undersøgelse #8085: Pro 2.0, tre pakker (komfort, udseende, indsigt)

Undersøgelsesspor (kind: investigate, #5220), 26/11. Ingen kode ændret. Intet om pris eller betaling.

Låst af ejeren 26/11: tre pakker (komfort, udseende, indsigt), aldrig styrke for penge, pris uændret.

**Wireframe (én selvstændig HTML-fil, 1440 og 390, privat artefakt):** https://claude.ai/artifact/6JR78oeL5eSvhG1SvqJtQP
Kilden ligger i bølgens scratch-mappe som `pro2-wireframes.html`. Den er ikke committet, fordi sporet kun ejer denne rapport.

## Hvad jeg læste

- #8085 (krop + churn-kommentar 25/11) og #4514 (betalingsvagt og ejerens beslutning 4/10 om automatisk træk). #4514 handler om betaling og påvirker ikke pakkernes indhold. Én ting tæller dog: `isPro` styrer i dag kun frontend-flader, ingen backend-rute, bortset fra sæsonhistorikkens eget endpoint.
- Koden: `frontend/src/lib/pro/proAccess.ts`, `pages/ProUpgradePage.jsx`, `components/pro/ProBenefitsSection.tsx`, `components/pro/ProUpsell.tsx`, `components/Layout.jsx`, `pages/ProfilePage.jsx`, `public/locales/da/pro.json`, `lib/savedRiderFilters.js`, `backend/lib/proRiderHistory.js` (via kommentar i proAccess).
- `docs/GAME_DESIGN_DOCUMENT.md` (§3-4: fairness som bedømmelseskriterie), `docs/BUSINESS_STRATEGY.md` §3 (listen over hvad der må og ikke må sælges), `docs/design/PAGE_TEMPLATES.md`, `docs/design/TASTE.md`, `docs/MASTERPLAN.md` (Pro 2.0 er et udgivelseskrav for januar 2027), `database/schema-snapshot.json` (`teams`, `subscriptions`).

## Hvad Pro giver i dag (målt i koden)

| Fordel | Hvor | Regel |
|---|---|---|
| Sæsonhistorik pr. evne | Rytterprofil, Udvikling-fanen | Kræver aktiv Pro, også i backend |
| Gemte filtre (op til 10) | Rytterdatabasen, kun i browserens lager | Kræver aktiv Pro |
| Pro-mærke | Menuen under logoet | Aktiv Pro |
| Founder-mærke | Menuen, permanent | Founder, også efter opsigelse |
| Abonnementskort | Indstillinger | Aktiv Pro |

`PRO_BENEFITS = ["history", "filters"]`. /pro viser de to fordele i faner, derefter planvalg og Founder-pladser. Spillet åbner /pro fra præcis to steder (`ProUpsell` på Udvikling-fanen og i bjælken med gemte filtre) plus menupunktet. `teams` har ingen kolonne til holdfarver eller logo, så alt under Udseende er nyt ud over de to mærker.

Gratis i dag, og det skal blive ved med at være gratis: sammenligning af ryttere, ønskeliste, assistentens udtagelse, påmindelse om holdudtagelse, lys og mørk visning.

## Bekræftet

Det problem, issuet beskriver, findes. Pro består i dag af to funktioner og to mærker i faner. Der findes intet pakkedesign, og intet er startet. Teksten på /pro lover allerede "dybde, komfort og kosmetik" (`fairnessNote`), men kun dybde og komfort er dækket, med én funktion hver. Udseende har kun mærket.

## Forslag (i wireframen)

**Komfort**: færre klik, ingen ekstra muligheder.
- Findes: gemte filtre (browser).
- Nyt: gemte filtre følger kontoen, gemte visninger i trup og transfers (kolonner og sortering), private noter på ryttere og løbskalenderen som abonnement i egen kalender.
- Gratis for alle: frister, påmindelser, assistenten og alle varsler om markedet.

**Udseende**: synligt for andre, uden betydning i løb.
- Findes: Pro-mærke og Founder-mærke.
- Nyt: holdfarver ved holdnavnet i resultater og stilling, en forside på profilen med din bedste sejr (etapeprofilen som billede, TASTE P2) og en trofævæg i din egen rækkefølge.

**Indsigt**: dybde om eget hold og om offentlige data, aldrig skjulte tal.
- Findes: sæsonhistorik pr. evne.
- Nyt: markedsværdi over tid, point pr. løbsdag i stillingen, sæsonrapport efter sæsonskiftet og eksport af egne data.

**/pro-siden**: T1, 896 px. Pakkerne står side om side i ét kort på desktop. På mobil vælges pakken med faner (44 px), og opsalg fra spillet åbner den pakke, spilleren kom fra. Under pakkerne står et kort "Fair for alle" (hvad Pro giver, og hvad Pro aldrig giver). Planvalg, betaling og Founder står som i dag. Wireframen har ingen guldknap og ingen små versaler.

**Hvor Pro vises**: fire steder findes i dag (menuen, Udvikling-fanen, rytterdatabasen og Indstillinger). Fem steder er nye: resultater og stilling, managerprofilen, rytterprofilens Marked-fane, sæsonafslutningen og gem visning i trup og transfers. Reglen er højst ét stille opsalg pr. side og aldrig midt i en holdudtagelse, et bud eller et løb.

## Spørgsmål til ejeren (ét ad gangen, med anbefaling)

1. **Er Pro ét abonnement med alle tre pakker, eller kan de vælges hver for sig?** Anbefaling: ét Pro med alle tre. Det passer med "pris uændret" og holder /pro enkel.
2. **Må andre spillere se Udseende, altså holdfarver i resultatlister og stillingen?** Anbefaling: ja, ved holdnavnet og på managerprofilen. Farver der ligner guld eller førertrøjen er spærret, og hold uden farver får ingen tom plads.
3. **Varsler om markedet (fx at en rytter fra ønskelisten sættes til salg): Pro eller gratis?** Anbefaling: gratis for alle eller slet ikke. Det er en fordel at få besked først på markedet, og det bryder "aldrig styrke".
4. **Skal gemte filtre flyttes fra browseren til kontoen, så de følger med på alle enheder?** Anbefaling: ja. Det følger PAGE_TEMPLATES-reglen om at valg huskes på kontoen, og det er den mindste nye komfort med størst værdi.
5. **Sæsonrapporten: kun Pro, eller kort version til alle og den fulde til Pro?** Anbefaling: alle får placering og største sejr, Pro får hele rapporten. Sæsonskiftet er et øjeblik, alle skal have.
6. **Hvilken pakke står først på /pro og er valgt på mobil, når man ikke kommer fra et opsalg?** Anbefaling: Indsigt. Den har den eneste funktion, der allerede bruges mest, og den passer til spillets data-DNA. Ejerens rækkefølge (komfort, udseende, indsigt) beholdes som alternativ.
7. **Mobil: faner med én pakke ad gangen, eller alle tre kort stablet?** Anbefaling: faner, så første skærm viser funktioner og ikke kun tre overskrifter.
8. **Får Founders noget nyt i Udseende?** Anbefaling: nej, kun det mærke, de har i dag. Et nyt løfte til en lukket gruppe er svært at holde, og vilkårene lover kun mærket.

## Plan, når retningen er valgt

1. Ejeren svarer på spørgsmål 1-8 og godkender wireframen (eller en ny version) på billeder.
2. Der oprettes ét issue pr. ny funktion, mærket med pakken. De største først: gemte filtre på kontoen (ny tabel og RLS, flyt fra `savedRiderFilters.js`), holdfarver (kolonner på `teams` og visning i resultater og stilling), markedsværdi over tid (kræver en historik, der først skal måles; P2 siger, at data findes), sæsonrapport.
3. `PRO_BENEFITS` og `proAccess.ts` udvides til pakker. `ProBenefitsSection` erstattes af de tre kolonner. `parseProBenefit` får `pakke=` med fallback fra de gamle `benefit=`-links.
4. Ny tekst i `pro.json` (EN først, DA under), `help.json` og en patch note pr. funktion. Spillerteksten vises ejeren før merge.
5. Risiko: lav for /pro-siden. Mellem for holdfarver, fordi de rører resultater og stilling, der vises overalt. Fairness-gennemgang (GDD §4.7) pr. funktion, før den bygges. Ingen ny løbende udgift.

bekraeftet + fix-plan
