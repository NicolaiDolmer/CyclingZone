# Mental model drift: "9 hold får emergency-lån" — regnefejl pga. manglende sponsor-først-rækkefølge

**Dato:** 2026-05-21
**Session:** Sæson 1 launch-forberedelse + docs-audit
**Commit:** [3b4523e](https://github.com/NicolaiDolmer/CyclingZone/commit/3b4523e) (v3.82)
**Issues:** [#535](https://github.com/NicolaiDolmer/CyclingZone/issues/535) (langtidsløsning)

## Hvad skete der

Jeg (Claude) regnede emergency-lån-behov forkert ved at trække `balance - total_salary` per hold UDEN at tage højde for at sponsor 240K krediteres FØR salary trækkes. Min SQL og mit svar til brugeren konkluderede "11 hold får emergency-lån" — det korrekte tal er **0** fordi sponsor altid kommer først.

Brugeren fangede fejlen øjeblikkeligt med ét spørgsmål: *"hvis man først modtager de 240.000 i sponsor indtægter og betaler løn bagefter, så kan man jo betale løn med de penge?"*

## Rod-årsag

To samtidige fejl:

1. **Stolet på stale docs i stedet for at verificere kode-flow:** `docs/NOW.md` og `docs/economy-flow-audit-2026-05-21.md` sagde "9 hold får emergency-lån". Audit-rapporten var teknisk korrekt — den analyserede det FORKERTE manuelle `⏹+▶`-flow hvor `processSeasonEnd` kører FØR `processSeasonStart`. Men jeg accepterede tallet ukritisk og kopierede det til min analyse uden at læse `processSeasonStart` i `economyEngine.js:158-305` først.

2. **SQL-fejl: glemte sponsor i shortfall-beregning:** Min query brugte `GREATEST(0, total_salary - balance)` uden at lægge `+ 240000 sponsor_payout` til. Bash-tools tør verificere mod prod-DB, men hvis SQL'en spørger forkert er svaret garbage.

## Korrigeret mental model (v3.78, 2026-05-21)

`processSeasonStart` har TO passes:

**Pass A** (loop over alle hold): Sponsor + krediteres til hver hold + loan_agreement_fees + ensure board-profiles.

**Pass B** (`runSeasonPayroll`, SEPARAT loop EFTER pass A): Per hold trækker (1) loan_interest, (2) salary, (3) emergency_loan kun hvis shortfall, (4) negative_balance_interest kun hvis stadig negativ.

**Invariant:** Sponsor for ALLE hold er udbetalt FØR payroll-loopet starter. Det betyder `freshTeam.balance` i payroll-trin allerede inkluderer sponsor — emergency-lån udløses kun hvis `sponsor + start_balance < salary + loan_interest`.

## Forebyggelse

1. **Test låser invarianten:** Tilføjet i `economyInvariants.test.js` — "processSeasonStart krediterer sponsor til ALLE hold før runSeasonPayroll kører (v3.78 invariant)". Test fejler hvis nogen flytter `runSeasonPayroll` ind i sponsor-loopet.

2. **JSDoc-invariant i koden:** `economyEngine.js:151-176` har nu eksplicit kontrakt-blok der beskriver pass A/pass B + WHY (undgår utilsigtede emergency-lån ved sæson-start).

3. **Docs aligned:** 15-fils sweep ([3b4523e](https://github.com/NicolaiDolmer/CyclingZone/commit/3b4523e)) opdaterer NOW.md, FEATURE_STATUS, EVENT_SEQUENCE, DOMAIN_REFERENCE, slice-07-MASTER, help.json (da+en), FinanceFirstVisitHint, FinancePage tour, AdminSeasonTab confirm, EconomyAdminSection labels, PatchNotes. Audit-rapporten har advarsel-header om at den dækker FORKERT manuelt flow.

4. **Langtidsløsning:** [#535](https://github.com/NicolaiDolmer/CyclingZone/issues/535) — engine returnerer payroll-summary så manuel SQL ikke længere er nødvendig pr. sæsonskift. Eliminerer fejlkilden permanent.

## Læring til fremtidige AI-sessioner

- **Verificér kode-flow før du citerer docs-tal.** Stale docs er den hyppigste kilde til drift. Hvis et tal lyder kontraintuitivt, åbn kilde-koden FØR du gentager tallet.
- **SQL-pre-flight: aflæg invariant i query.** Hvis du beregner "shortfall efter renter+løn" og glemmer at lægge sponsor til, vil du systematisk over-estimere emergency-lån. Skriv hele cashflow-kæden ud før query.
- **Hør på brugerens "men giver det jo ikke mening?"** — brugeren har domain-kontekst der ofte fanger AI's regnefejl før AI selv gør det. Tag den slags spørgsmål som signal-til-genberegning, ikke som forsvar af tidligere svar.
