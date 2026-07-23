# 2026-07-20 — Tre Alunta-kontrakt-bugs + rå ICU-pladsholdere på /pro

## Hvad skete
Growth-sprint 20/7 tændte CZ Pro-betalingssporet. Ejerens testkøb ramte TRE bugs i træk,
alle i kode der var merged 2/7 men aldrig kørt mod den ægte provider:

1. **Webhook-auth var forkert:** interim `X-Alunta-Secret`-header; Alunta sender i
   virkeligheden `Signature` = HMAC-SHA256 over rå body. Alle ægte webhooks ville få 401
   og abonnementer aldrig aktiveres. (PR #2729)
2. **`ensureCustomer` var ikke idempotent:** 2. checkout-forsøg 422'ede på "customer
   already exists" → "Kunne ikke starte betaling". (PR #2740)
3. **Svar-envelope:** Alunta wrapper 201 i `{data:{checkout_url}}`; koden læste
   `session.checkout_url` → `undefined` → frontend navigerede til `/undefined` →
   SPA-redirect til dashboard, som lignede "der sker ingenting". (PR #2750)

Samme dag: Founder-seat-counteren viste rå `{{taken}}`-pladsholdere — projektet kører
i18next-**icu**, hvor interpolation er `{taken}` (enkelt-tuborg). (PR #2737)

## Rod-årsager
- Billing-koden blev bygget mod en ANTAGET kontrakt ("bekræftes i test_mode" stod som
  TODO i spec §9) — men gaten blev aldrig håndhævet, og koden lå "færdig" i 18 dage.
- Subagent-prompten til /pro-UI'et nævnte ikke ICU-konventionen; agenten brugte
  i18next-default. Unit-tests og core-smoke rammer ikke /pro, så det nåede prod.

## Læredomme / guards
- **En udokumenteret provider-kontrakt er ikke "done" før første ægte rundtur.**
  Hent providerens OpenAPI-spec FØR ship (10 min — afslørede alle tre bugs på én
  gennemlæsning 20/7) og behandl "verificér i test_mode"-TODO'er som blockers, ikke noter.
- **ensure-operationer skal behandle "findes allerede" som succes.**
- **Navigér aldrig til en URL fra et API-svar uden https-guard** (undefined → relativ
  SPA-route → stille fejl).
- **i18n-agent-prompts skal nævne ICU-syntaksen.** Forward-guard: `ProUpgradePage.i18n.test.js`
  forbyder `{{var}}` i pro.json; overvej samme mønster ved nye namespaces.
- Fejl-koder fra checkout SKAL kunne ses (captureException flow:billing var allerede på
  plads fra #2389 — det var den der gjorde 20/7-fejlfindingen hurtig).
