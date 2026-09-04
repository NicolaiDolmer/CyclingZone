# 4/9 — "Reelt fastlåst"-alarmen larmede 288x i døgnet om en tilstand ingen kunne løfte

**Symptom:** CYCLINGZONE-58 eskalerende, 378 events på 32 timer. ~95 % af alle
error-linjer i Railway-deploy-loggen var den samme linje, hvert 5. minut, om ÉT hold.

## Hvad der faktisk var galt (to lag)

**Lag 1 — alarmen:** `runAiTeamTrimHealSweepCron` kalder `sentryCapture` ubetinget
hver gang `result.stale` er ikke-tom. Sweep'en kører på 5-min-kadence. Så længe
betingelsen står, er det 288 events i døgnet.

**Lag 2 — tilstanden:** holdet var reelt fastlåst, men af noget **ingen alarm kunne
gøre noget ved**: to `transfer_offers`-rækker fra 30/6 og 1/7 med status `withdrawn`
og `accepted` holder en NO ACTION-FK. FK-semantikken blev eksplicit udskudt til
ejeren i #4233 — og #4233 blev derefter lukket i en audit med beslutningen stadig
åben. Målt 4/9: 13 AI-hold permanent utrimbare, og **4 puljer står på 25 hold i
stedet for 24** (invarianten fra #2377). #4233's close-note sagde "D4-A retter sig
selv til 24 ved næste reconcile" — det gik fra 1 pulje til 4.

## Lektien

**En alarm om en betingelse, som kun ejeren kan løfte, skal fyre én gang — ikke pr.
tick.** Vi havde lært halvdelen: CYCLINGZONE-31/#2434 gav alarmen et fast fingerprint,
så den blev til ét Sentry-*issue* i stedet for 200. Men den stoppede aldrig
*event*-strømmen. Fingerprint løser gruppering, ikke kadence.

Og: alarm-kadence skal måles mod **hvor hurtigt betingelsen realistisk kan forsvinde**.
Er svaret "når ejeren træffer et valg", så er 5 minutter forkert med tre størrelsesordener.

## To fælder i selve fixet

1. **Signaturen må ikke indeholde alder.** Første udkast ville have brugt hele
   stale-objektet; `ageHours` ticker hvert 5. minut og ville få hvert tick til at
   ligne ny information. Signatur = hold + årsag.
2. **Dedupen skal også køre når sættet er TOMT.** Ellers efterlader en tilstand der
   kom sig sin gamle signatur i `ops_alert_state`, og næste ægte brud ser "uændret"
   ud og tier. Det ville have vekslet spam til tavshed — værre end udgangspunktet.

## Procesnote: audit-lukning må ikke sluge en åben beslutning

#4233 blev lukket som `claude:done` fordi *koden* var merge-verificeret. Men issuet
bar også en `needs-decision`-del (FK A/B/C) som aldrig blev truffet. Den forsvandt ud
af backloggen i 8 dage, mens invarianten brød i 3 puljer mere. **Har et issue både en
shipped fix og en åben ejer-beslutning, skal beslutningen have sit eget issue FØR
lukning.** Nyt issue: #4753.

## Verificér-før-claim virkede

Jeg var ved at kalde det en falsk positiv i backstop-logikken (marker-alder vs.
blokerings-alder). Kode-kommentaren i `aiTeamGenerator.js` sagde ligeud at
adfærden var tilsigtet og afventede ejeren. Havde jeg "rettet" den, havde jeg
skjult et ægte invariant-brud i stedet for at rapportere det.

Refs: #4752 (fix, PR #4754), #4753 (beslutning), #2738 (generisk dedupe), CYCLINGZONE-58
