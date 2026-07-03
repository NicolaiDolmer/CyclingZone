# Attribution død i 17 dage: instrumentér ALLE stier til samme outcome, ikke kun den "primære"

**Issue/PR:** #2079 / PR #2069 + #2144

## Symptom
`signup_attribution` var 100% tom 15/6-2/7 trods 65 menneske-signups og en "verificeret" feature (#1408).

## Rod-årsag
Team-create (= signup-outcome) kunne nås ad tre stier: LoginPage-bootstrap (confirm-off),
Layout-bootstrap (confirm-on, kom først med #2068) og SetupWizardModal (fallback). Kun den
FØRSTE sendte attribution-payloaden. Email-confirm var slået til i hele perioden, så den
instrumenterede sti kørte bogstaveligt aldrig — og fejlen var tavs by design
(`buildAttributionRow(userId, undefined)` → null → ingen row, ingen fejl).

## Læring
1. **Instrumentér outcomet, ikke indgangen.** Når flere UI-stier fører til samme
   backend-outcome (her: første team-create), skal metadata/telemetri sendes fra ALLE
   stier — eller endnu bedre samles ét sted tættest på outcomet. Grep efter alle kald
   til endpointet (`PUT /teams/my`) i stedet for at stole på "hovedflowet".
2. **Best-effort/fire-and-forget features skal have en liveness-alarm.** Tavs null-degradering
   betød at 0 rækker først blev opdaget ved manuel audit 17 dage senere. `audit-feature-liveness.js`
   fandtes, men whitelisten forklarede tomheden væk med en forældet begrundelse ("lige shippet").
   Whitelist-entries skal have TODO-dato + ejer, og datoen skal håndhæves.
3. **Config-tilstand (email-confirm on/off) ændrer hvilken kodesti der er "hovedstien".**
   Verifikation af en feature skal ske under den config prod faktisk kører med.

## Forward-guard
- Alle tre team-create-stier sender nu attribution med user_metadata som cross-device-fallback (#2144).
- Whitelist-entry har ny TODO-dato (10/7) og fjernes når kampagne-rækker bekræfter flowet.
