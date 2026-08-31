# Betalings-stakken — SSOT

> Kilde til sandhed for hvordan Alunta, Stripe og Dinero hænger sammen, og hvordan Cycling Zone bruger dem.
> Oprettet 2026-08-31 (#4510). **Læs denne FØR du rører noget der har med betaling at gøre.**
>
> Verifikationsniveau er markeret pr. påstand: ✅ målt mod live-system · 📄 fra kode/dokumentation · ❓ uverificeret.

## 1. Rollefordeling

| System | Rolle | Ejer sandheden om |
|---|---|---|
| **Alunta** | Abonnements-motor | Abonnementer, planer, fakturaer, betalingsstatus, fakturanumre |
| **Stripe** | Betalings-gateway | Kortdata, selve trækket |
| **Dinero** | Bogføring | Regnskabet. Modtager fakturaer + betalinger fra Alunta |
| **Supabase** | Vores app | `subscriptions`-tabellen = afledt cache af Aluntas sandhed |

**Merchant of record er Dolmer Digital, ikke Alunta** 📄 (`docs/legal/TERMS_DRAFT_2026-07-30.md`). Alunta fakturerer på vores vegne via vores egne betalingsudbydere.

Dataflow ved et køb:

```
Spiller → /pro → POST /api/billing/checkout → Alunta /checkout-sessions
       → Aluntas hostede betalingsside → Stripe trækker kort
       → Alunta opretter faktura → Dinero bogfører
       → webhook + daglig reconcile → Supabase subscriptions → isPro i appen
```

## 2. Alunta

### Planer (tilstand 2026-08-31) ✅

| Plan | UUID | Gemt (øre, ekskl. moms) | Kunden betaler | I checkout |
|---|---|---|---|---|
| CZ Pro 1 month | `0cd45c7f-…5989a8` | 3920 | **49,00 kr.** | ja |
| CZ Pro 6 Months | `298f32cf-…69111` | 23600 | **295,00 kr.** | nej |

Alle planer: `auto_renewal: true`, `charge_vat: true`, låst til Stripe (`payment_provider_restricted`).

Begge rammer ejer-beslutningen 31/8 (#4005: 49 kr. **inkl.** moms). Halvåret giver ~17% rabat mod 6 × 49.

Den gamle `CZ Pro Monthly` (4900 øre = 61,25 inkl.) er arkiveret 31/8. Den eneste abonnent havde et **planskift planlagt til 1/9** over på `CZ Pro 1 month` — se afsnittet om planskift nedenfor for hvorfor det ikke kan aflæses i MCP-fladen.

Drift mod denne tabel fanges af `backend/scripts/alunta-setup-plans.js` (§9a).

### Priser er ekskl. moms ✅

Alunta gemmer beløb i **øre ekskl. moms** og lægger moms oveni når `charge_vat: true`.

```
4900 øre gemt  →  49,00 ekskl.  →  61,25 inkl. moms
3920 øre gemt  →  39,20 ekskl.  →  49,00 inkl. moms
```

Bekræftet mod prod-faktura: total 49,00 + moms 12,25 = 61,25. **Vil du ramme 49 kr. inkl., skal du taste 3920.** Denne fælde kostede en fejlpris på den eneste betalende kunde.

### Priser kan kun redigeres uden aktive abonnenter ❓

Halvårsplanen kunne reprises (26500 → 23600); månedsplanen kunne ikke. Forskellen ser ud til at være at månedsplanen har en aktiv abonnent. **Ikke bekræftet af Alunta-dokumentation** — behandl som arbejdshypotese.

Konsekvens: skal en plan med abonnenter reprises, er vejen **ny plan → opdatér Railway-env → flyt abonnenter via "skift abonnementstype" → arkivér den gamle**.

### Hvornår et kort trækkes 📄

- Alunta forsøger træk **3 gange i døgnet: kl. 00, 08 og 16** dansk tid
- En periode bliver trækbar på sin første dag
- **Trækket sker FØR fakturaen oprettes** — fakturaen bærer betalingen

Det giver en meget nyttig diagnostik:

> **En udstedt, ubetalt faktura beviser at der ikke kørte et automatisk korttræk.**
> Var trækket lykkedes, var fakturaen oprettet som betalt. Var det fejlet, var fakturaen ikke oprettet.

**Automatisk korttræk er en teamindstilling.** Er den slået fra, trækkes kortabonnementer ikke i baggrunden — de havner i en manuel fakturaprompt. Indstillingens tilstand kan ikke aflæses via MCP'en; se om der findes en "afventer fakturering"-kø i UI'et.

To tilfælde trækkes aldrig på eget kort: abonnementer dækket af en betaler (forhandler-modulet), og perioder som en rabat bringer til nul.

### API-svarformer — MCP og REST er ikke ens ✅

Samme data, forskellige feltnavne. Læses den ene form af på den anden, får man `null` og en falsk konklusion (skete under opbygningen af drift-tjekket 31/8).

| Data | MCP (`get_plan_catalog`) | REST (`GET /plans`) |
|---|---|---|
| Pris-array | `prices[]` | `renewal_intervals[]` |
| Interval | `interval_months` | `interval` |
| Beløb | `amount_minor` | `price` |

Envelope-formen er heller ikke ensartet i REST-API'et:

| Endpoint | Form |
|---|---|
| `GET /me` | **Fladt** — `{team_uuid, team_name, scopes, base_currency, timezone}` |
| `GET /plans` | `{data: [...]}` |
| `POST /checkout-sessions` | `{data: {id, checkout_url}}` |
| `POST /portal-link/{uuid}` | `{data: {url}}` |

Den udokumenterede envelope på checkout-sessions bed ved første testkøb: `undefined checkout_url` sendte frontend til `/undefined`. `alunta.js` læser derfor defensivt (`session?.data?.checkout_url ?? session?.checkout_url`).

**Regel: mål svaret før du læser felter af det.** Begge postmortems handler om præcis denne fejl.

### Planskift sker ved næste fornyelse — og ses kun via REST ✅

Et skift af abonnementstype træder i kraft **ved næste fornyelse**, ikke med det samme. Indtil da kører abonnementet videre på den gamle plan og den gamle pris.

> ⚠️ **MCP-fladen viser IKKE planlagte planskift.** Hverken `get_customer_financial_summary`, `get_customer_subscription_overview` eller `list_subscription_customers` har feltet. MRR viser den *nuværende* pris, og `pending_mrr` dækker kun fremtidig start, prøveperiode og pause — ikke et planskift.

Et planlagt skift kan derfor kun bekræftes via REST:

```
GET /subscriptions  →  data[].scheduled_plan_change
```

```json
"scheduled_plan_change": {
  "effective_date": "2026-09-01",
  "source_plan": { "name": "CZ Pro Monthly" },
  "target_plan": { "name": "CZ Pro 1 month" },
  "standard_price": 3920,
  "status": "scheduled",
  "failure_code": null
}
```

**Konklusionen "abonnementet er ikke flyttet" må aldrig drages af MCP-data alene** — fraværet af bevis er her ikke bevis for fravær. Denne fejl blev begået 31/8: uændret MRR blev læst som en mislykket flytning, mens skiftet lå korrekt planlagt. Tjek `scheduled_plan_change` før du konkluderer.

Beslægtet: `scheduled_price_changes[]` findes på samme objekt og er ligeledes usynlig i MCP'en.

### Kundeportalen 📄

`POST /portal-link/{uuid}` giver et signeret auto-login-link. Kunden kan skifte kort og opsige. **Udløber efter 15 min og behandles som en credential** — logges aldrig, gemmes aldrig. Uden gyldigt UUID returneres portalens login-side (magic link på e-mail) — den vej virker for kunder uden `alunta_customer_id` hos os.

Implementering: `backend/lib/billingPortal.js`.

### Aktive apps på teamet ✅

| Kategori | Aktiv | Inaktiv |
|---|---|---|
| Betaling | **Stripe** | OnPay, QuickPay, PensoPay, Leverandørservice |
| Bogføring | **Dinero** | e-conomic, Billy |
| Øvrigt | Self-service, API+webhooks, AI-adgang, GrowPanel | EAN, ratebetaling, forhandler, m.fl. |

**Hvorfor Stripe:** internationale kort og valutaer, hvilket passer til at spillet bygges til international vækst. **Leverandørservice** (direkte debitering) er værd at genoverveje når der er nok danske abonnenter — Aluntas egen beskrivelse fremhæver "færre fejlede betalinger end kort", og et mandat udløber ikke som et kort gør.

## 3. Stripe

Forbundet som gateway. Kunderne gemmer kort dér; Alunta trækker via Stripe. Vi rører aldrig kortdata.

Alunta kan importere eksisterende Stripe-kunder (Indstillinger → Integrationer → Stripe) — relevant hvis der nogensinde opstår abonnementer uden om Alunta.

## 4. Dinero

### Konti ✅

| Konto | Bruges til |
|---|---|
| 1000 — Salg af varer/ydelser m/moms | Standard omsætningskonto, alle fakturalinjer med moms |
| 1050 — Salg af varer/ydelser u/moms | Momsfrie linjer, uden for EU (rubrik C). **Bruges også til EU-linjer** medmindre en separat EU-konto vælges |

⚠️ **Åbent problem (#4511):** 1050-opsætningen behandler EU-salg som momsfrit. Korrekt for EU-virksomheder med momsnummer (omvendt betalingspligt), men **forkert for EU-privatpersoner** under 10.000 EUR-tærsklen, hvor der skal opkræves 25% dansk moms på konto 1000. Skal afklares med revisor før salget åbnes.

### Momsregler for et digitalt abonnement solgt fra Danmark 📄

| Kunde | Moms |
|---|---|
| Danmark | 25% dansk |
| EU privat, under 10.000 EUR/år samlet grænseoverskridende B2C | 25% dansk |
| EU privat, over tærsklen | Kundens lands sats via OSS-registrering |
| EU virksomhed m. gyldigt momsnr. | Omvendt betalingspligt |
| Uden for EU | Ingen dansk moms |

Ikke en teknisk vurdering — skal bekræftes af revisor.

### Fakturanumre ejes af Alunta ✅

Dette har kostet en fejldiagnose, så det står eksplicit:

> `document_number.status: "provisional"` og `driver: null` på en Alunta-faktura betyder **IKKE** at fakturaen mangler i Dinero.

Kilden er `alunta`, altså Alunta tildeler nummeret selv. Verificeret 31/8: begge fakturaer lå korrekt i Dinero med matchende numre og status, mens Alunta viste `provisional`/`driver: null`. Tjek altid Dinero direkte før du konkluderer at bogføringen mangler.

Der findes en indstilling under bogføringsintegrationen der lader regnskabssystemets nummer være det primære. Den er ikke i brug.

### Opsætningssiden

Ligger under **Apps & integrationer → Dinero**, ikke under "Indstillinger → Regnskab" (den sti i ældre changelogs er forældet). Felter der betyder noget:

- **Standard omsætningskonto** — påkrævet. Er den tom, springes synkronisering over med besked i Integrationsfejl
- **Standard indbetalingskonto** — afgør hvor Stripe-betalinger bogføres
- **Synk betalinger** — slået fra betyder at fornyelsesbetalinger ikke registreres i Dinero, og fakturaer står som ubetalte selvom pengene er trukket

Rettes en fejlkonfiguration, **gensynkroniseres berørte fakturaer ikke automatisk** — det skal gøres manuelt fra integrationsoversigten.

## 5. Vores kobling

### `subscriptions`-tabellen

| Felt | Skrives af | Bemærkning |
|---|---|---|
| `alunta_customer_id`, `alunta_subscription_id` | Webhook + reconcile | Kan mangle på gamle rækker |
| `status`, `current_period_end`, `plan_interval` | Reconcile (dagligt) | Sandheden ligger i Alunta |
| `is_founder` | Webhook | Permanent, jf. handelsbetingelserne |
| `terms_version`, `terms_accepted_at` | Checkout, før købet | Null på kunder fra før accept-flowet |
| `last_event_id` | Webhook | Fallback-format `<event>:<timestamp>` betyder at `data.uuid` manglede i payloaden |

### `computeIsPro()` 📄

`frontend/src/lib/proEntitlement.js`, holdt i sync med `backend/lib/entitlement.js`:

```js
status ∈ {active, cancelled, past_due}  OG  current_period_end > nu
```

`cancelled` tæller stadig som Pro indtil periodens udløb — betalt tid æres.

**Fælde:** `current_period_end` er et hårdt udløb. Fornyes abonnementet ikke, falder kunden ud af Pro uden varsling. Se #4512.

`isPro` gater i dag kun UI: `Layout.jsx:326` (`isPro || isFounder`), `ProfilePage.jsx:541`, `ProUpgradePage.jsx:151`. Ingen spilfunktion er hårdt gatet — se #2806.

### Webhook-events 📄

> ⚠️ **`invoice.paid` findes IKKE i Aluntas event-katalog.** Koden lyttede oprindeligt efter det. Postmortem: `.claude/learnings/2026-08-03-alunta-invoice-paid-missing-current-period-end.md`.

Faktiske events: `invoice.created`, `subscription.created/started/cancelled/resumed/ended/payment_failed/tier_changed`, `checkout.completed`, `customer.*`.

`checkout.completed` bærer **ikke** nødvendigvis fulde billing-felter. Derfor findes reconcilen.

Signaturverifikation er obligatorisk (`ALUNTA_WEBHOOK_SECRET`).

### Reconcile-cron 📄

`backend/lib/aluntaSubscriptionReconcile.js`. Henter Aluntas fulde `GET /subscriptions` og synker status, `current_period_end`, `plan_interval` og id'er ind. **Matcher på `external_customer_id === team_id`** — bevidst, fordi en lokal række kan mangle begge Alunta-id'er.

Flag: `app_config.alunta_reconcile_enabled` (true siden 2026-08-03).

**Kører dagligt.** Betaler en kunde nu, følger entitlementet først med ved næste kørsel. Se #4512.

## 6. Kode og konfiguration

| Fil | Ansvar |
|---|---|
| `backend/lib/alunta.js` | API-klient. Base `https://app.alunta.com/api/v1`, Bearer-auth |
| `backend/lib/billingCheckout.js` | Checkout-endpoint, terms-validering, pause-flag |
| `backend/lib/billingPortal.js` | Portal-link |
| `backend/lib/aluntaWebhook.js` | Webhook-modtager + signaturverifikation |
| `backend/lib/aluntaSubscriptionReconcile.js` | Daglig afstemning |
| `backend/lib/founderSeats.js` | Founder-pladser (50 stk.) |
| `backend/scripts/alunta-setup-plans.js` | Engangs-opsætning af planer via API |
| `frontend/src/pages/ProUpgradePage.jsx` | /pro-siden |
| `frontend/src/lib/useSubscription.js` | Læser egen subscription (RLS select-own) |

### Miljøvariabler

| Nøgle | Hvor | Betydning |
|---|---|---|
| `ALUNTA_API_TOKEN` | Infisical | Skriveadgang til Alunta-API'et |
| `ALUNTA_WEBHOOK_SECRET` | Infisical | Signaturverifikation |
| `ALUNTA_CZ_PRO_PLAN_ID_MONTHLY` | Railway | **Skal opdateres ved plan-skift** |
| `ALUNTA_CZ_PRO_PLAN_ID_SEMIANNUAL` | Railway | Samme |
| `ALUNTA_BASE` | valgfri | Default er prod |

> ⚠️ Skiftes en plan i Alunta uden at env-nøglen følger med, sælger appen fortsat den gamle plan. Let at overse, dyrt at opdage.

### To flag der skal holdes i sync 📄

`CHECKOUT_PAUSED` findes **to steder** og skal ændres begge:

- `frontend/src/pages/ProUpgradePage.jsx:32` — styrer kun visningen
- `backend/lib/billingCheckout.js:16` — afviser reelt med `503 checkout_paused`

Samme mønster for `TERMS_VERSION` (`frontend/src/lib/termsVersion.js`) og `CURRENT_TERMS_VERSION` (`billingCheckout.js`). Mismatch afvises med 400, så en klient med forældet vilkårstekst tvinges til reload.

## 7. AI-adgang

**Alunta-MCP'en er skrivebeskyttet.** Det er et designvalg i Aluntas "AI-adgang"-app, ikke en indstilling. Claude kan læse alt og ændre intet.

Skrivning til Alunta kan kun ske via REST-API'et med `ALUNTA_API_TOKEN` — altså gennem backend-kode eller et script, aldrig gennem MCP'en.

**Dinero-MCP'en kan derimod skrive** (`dineropublicapi:read + write + offline_access`). Skrivende værktøjer — `create_invoice`, `book_invoice`, `send_trade_offer`, `delete_*` — bruges ikke uden ejerens go på den konkrete handling.

Begge MCP-forbindelser er `local scope`: kun denne bruger, kun dette projekt, intet i repoet.

## 8. Åbne punkter pr. 2026-08-31

| # | Sag | Blokerer |
|---|---|---|
| [#2813](https://github.com/NicolaiDolmer/CyclingZone/issues/2813) | Handelsbetingelser, fortrydelsesret, accept | **Go-live** |
| [#4005](https://github.com/NicolaiDolmer/CyclingZone/issues/4005) | Pris låst til 49 inkl. — planer skal følge med | Go-live |
| [#4511](https://github.com/NicolaiDolmer/CyclingZone/issues/4511) | Moms på EU-privatkunder | Bør før go-live |
| [#4512](https://github.com/NicolaiDolmer/CyclingZone/issues/4512) | Udløb uden fornyelsessti | Bør før go-live |
| [#4074](https://github.com/NicolaiDolmer/CyclingZone/issues/4074) | Valuta-mismatch EUR/DKK | Bør før go-live |
| [#2816](https://github.com/NicolaiDolmer/CyclingZone/issues/2816) | Dobbeltkøb overskriver abonnement | Bør før go-live |
| [#2806](https://github.com/NicolaiDolmer/CyclingZone/issues/2806) | /pro ikke linket, isPro gater intet | Efter |

### Ryddet 31/8

1. ~~Månedsplanen er 61,25 inkl.~~ — `CZ Pro 1 month` (3920 øre) oprettet, Railway-env opdateret, planskift til 1/9 lagt ind, gammel plan arkiveret.
2. ~~`alunta-setup-plans.js` er forældet~~ — rapporterer nu drift i stedet for at springe over (PR #4513).
3. ~~Ingen vagt på ubetalte fakturaer~~ — `aluntaOverdueWatch.js` kører dagligt (PR #4516).

### Stadig åbent

1. **Kortet trækkes aldrig.** Kunden har `has_valid_payment_card: true`, faktureringsmetoden står på Automatisk, planen er kort-only — og der findes præcis **én** betaling i kontoens historik (checkout-betalingen 25/7). Automatisk korttræk har aldrig kørt. Indstillingen der blokerer det findes hverken i MCP-fladen eller i REST-API'et (hele OpenAPI-specen gennemgået 31/8). Se #4514.
2. **Én kunde uden accept-log** — `terms_version` og `terms_accepted_at` er null på den eneste abonnent (købte 25/7, før flowet fandtes). Se #2813.
3. **`invoice_due_days: 0`** — fakturaer forfalder på selve fakturadatoen. Nul betalingsvindue, så enhver faktura er teknisk forfalden i samme sekund den dannes.

## 9. Faldgruber — kort liste

1. **Priser er ekskl. moms.** 49 tastet = 61,25 betalt.
2. **`provisional` betyder ikke ubogført.** Tjek Dinero før du konkluderer.
3. **`invoice.paid` findes ikke.** Byg aldrig på en antaget event-kontrakt — verificér mod det faktiske payload.
4. **En webhook der virker ved aktivering virker ikke nødvendigvis ved fornyelse.** Test hele livscyklussen.
5. **"Betalingen gik igennem" ≠ "entitlement er korrekt."** Læs rækken.
6. **Plan-UUID bor i Railway.** Skift plan uden env-opdatering = gammel pris sælges videre.
7. **`CHECKOUT_PAUSED` findes to steder.**
8. **Reconcile er daglig, ikke øjeblikkelig.**
9. **Et 2xx fra en gateway er ikke bevis for at der er flyttet penge.**
10. **MCP og REST bruger forskellige feltnavne for samme data.** `prices[]/amount_minor` mod `renewal_intervals[]/price`. Mål svaret før du læser felter af det.
11. **MCP'en viser ikke alt.** Planlagte planskift og prisændringer findes kun i REST'ens `scheduled_plan_change` / `scheduled_price_changes`. Konkludér aldrig "det skete ikke" fordi MCP'en ikke viser det — vælg en kilde der *kan* vise fænomenet, før du læser noget ud af dens tavshed.

## 9a. Drift-tjek af planer

```bash
infisical run --env=dev -- node scripts/alunta-setup-plans.js
```

Køres fra `backend/`. Sammenligner Aluntas faktiske planer mod den forventede opsætning, rapporterer afvigelser og udfasede planer der stadig er aktive, og exit'er 1 ved drift. **Retter aldrig en pris** — en plan med aktive abonnenter kan alligevel ikke reprises. `--create-missing` opretter manglende planer.

Erstatter den tidligere adfærd, hvor scriptet stiltiende sprang eksisterende planer over på navn og dermed lod en forkert pris overleve enhver gen-kørsel.

## 10. Relateret

- `docs/legal/TERMS_DRAFT_2026-07-30.md` — handelsbetingelser + åbne verifikationer før go-live
- `.claude/learnings/2026-07-20-alunta-contract-assumptions-and-icu-syntax.md`
- `.claude/learnings/2026-08-03-alunta-invoice-paid-missing-current-period-end.md`
