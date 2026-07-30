# UDKAST — Handelsbetingelser for CZ Pro (v0.1, 2026-07-30)

> **Status: UDKAST til ejer-godkendelse (#2813). IKKE live.** Når teksten er godkendt,
> flyttes den til `/handelsbetingelser` (DA) + `/terms` (EN) som sider i frontend, linkes
> fra footer/login/checkout, og accept-flowet bygges (checkbox + version + tidspunkt gemt
> på `subscriptions`-rækken). Åbne huller er markeret **[EJER]**.

---

## Dansk version (primær juridisk tekst — dansk forbrugerret)

### Handelsbetingelser — CZ Pro

**Senest opdateret:** [dato ved go-live] · **Version:** 1.0

**1. Hvem sælger**
Cycling Zone drives af Nicolai Dolmer Mikkelsen, [adresse — **EJER**: vil du oplyse
privatadresse, eller har du/ønsker du et CVR-nummer? E-handelsloven kræver navn, adresse
og e-mail; CVR hvis momsregistreret virksomhed], e-mail: [kontakt-e-mail — **EJER**:
hvilken adresse skal være den officielle support-/juridiske indgang?].

**2. Hvad du køber**
CZ Pro er et frivilligt støtte-abonnement til browserspillet Cycling Zone. Pro giver
adgang til ekstra dybde, komfort og kosmetiske funktioner — aldrig en konkurrencefordel.
Gratis-spillet er og bliver fuldt spilbart og konkurrencedygtigt uden Pro.

**3. Pris og betaling**
- Månedligt abonnement: 49 kr. pr. måned.
- 6-måneders abonnement: 265 kr. pr. 6 måneder.
- Alle priser er i danske kroner og inkl. moms. [**EJER/verifikation**: afventer bekræftelse
  af momsansvar/merchant of record hos Alunta — se afsnittet "Åbne verifikationer" nederst.]
- Betaling sker via vores betalingsudbyder Alunta. Vi opbevarer aldrig dine kortoplysninger.

**4. Automatisk fornyelse**
Abonnementet fornyes automatisk ved udløbet af hver periode (måned hhv. 6 måneder) til den
til enhver tid gældende pris, indtil du opsiger. Du får en kvittering pr. e-mail ved hver
betaling. Prisændringer varsles mindst 30 dage før de træder i kraft; en prisændring giver
dig altid ret til at opsige inden den nye pris gælder.

**5. Opsigelse**
Du kan opsige når som helst med virkning fra udløbet af den igangværende betalte periode —
der er ingen binding ud over perioden. Opsigelse sker [via "Opsig abonnement" i dine
kontoindstillinger / Alunta-portalen — bygges i #2813; indtil da: skriv til kontakt-e-mailen,
så opsiger vi manuelt samme dag]. Allerede betalte perioder refunderes ikke ved opsigelse,
men Pro-funktionerne virker perioden ud.

**6. Fortrydelsesret**
Du har som forbruger 14 dages fortrydelsesret ved køb på nettet. **Bemærk:** CZ Pro er
digitalt indhold/en digital tjeneste der leveres straks. Ved købet samtykker du udtrykkeligt
til, at leveringen påbegyndes med det samme, og du anerkender, at fortrydelsesretten dermed
bortfalder for den påbegyndte periode. [**EJER — valg A/B:**
**A (anbefalet, enklest):** fuld waiver som ovenfor — standard for digitale tjenester med
øjeblikkelig levering.
**B (kulant):** behold 14 dages fuld fortrydelsesret med tilbagebetaling — venligere, men
kræver en manuel refusionsproces hos Alunta som vi så skal dokumentere.]

**7. Founder-status**
De første 50 betalende abonnenter får permanent Founder-status (badge). Founder-badget
bevares permanent, også hvis abonnementet senere ophører. Founder-status er kosmetisk.

**8. Beta-forbehold**
Cycling Zone er i åben beta. Funktioner — også Pro-funktioner — kan ændres, ombalanceres
eller fjernes som led i spillets udvikling. Væsentlige forringelser af Pro's indhold giver
dig ret til at opsige, jf. pkt. 5. Vi kan lukke spillet med mindst 30 dages varsel; forudbetalte
perioder ud over lukkedatoen refunderes forholdsmæssigt.

**9. Reklamation og tvister**
Køb er omfattet af købelovens/forbrugerreglernes almindelige mangelsbeføjelser. Klager
rettes først til kontakt-e-mailen. Du kan desuden klage til Nævnenes Hus /
Center for Klageløsning, og EU-Kommissionens onlinetvistplatform (ODR) kan benyttes.

**10. Persondata**
Behandling af persondata er beskrevet i [privatlivspolitikken](/privatlivspolitik).

---

## English version (secondary, mirrors the Danish text)

### Terms of Sale — CZ Pro

**Last updated:** [go-live date] · **Version:** 1.0

1. **Seller:** Cycling Zone is operated by Nicolai Dolmer Mikkelsen, [address], e-mail: [contact].
2. **What you buy:** CZ Pro is a voluntary supporter subscription for the browser game
   Cycling Zone. Pro adds depth, comfort and cosmetic features — never a competitive
   advantage. The free game remains fully playable and competitive.
3. **Price and payment:** DKK 49/month or DKK 265/6 months, incl. Danish VAT. Payment is
   handled by our payment provider Alunta; we never store your card details.
4. **Automatic renewal:** The subscription renews automatically each period until you
   cancel. You receive a receipt by e-mail for every charge. Price changes are announced
   at least 30 days in advance and always give you the right to cancel first.
5. **Cancellation:** Cancel anytime, effective at the end of the current paid period. No
   lock-in beyond the period. Paid periods are not refunded, but Pro features remain active
   until the period ends.
6. **Right of withdrawal:** EU consumers have a 14-day right of withdrawal. CZ Pro is
   digital content delivered immediately; by purchasing you expressly consent to immediate
   delivery and acknowledge that the right of withdrawal lapses for the started period.
7. **Founder status:** The first 50 paying subscribers receive a permanent Founder badge,
   kept even if the subscription later lapses. Founder status is cosmetic.
8. **Beta notice:** Cycling Zone is in open beta. Features, including Pro features, may
   change. Material degradation of Pro entitles you to cancel per §5. If the game shuts
   down we give at least 30 days' notice and refund prepaid time beyond the shutdown date
   pro rata.
9. **Complaints:** Contact us first at the contact e-mail. Danish/EU consumer complaint
   bodies and the EU ODR platform are available.
10. **Privacy:** See the [privacy policy](/privacy-policy).

---

## Åbne verifikationer (før go-live, del af #2813)

1. **Moms/merchant of record:** Spec-antagelsen "Alunta håndterer moms/kvitteringer
   automatisk" (monetization-spec linje 114) er IKKE verificeret. Skal bekræftes mod
   Aluntas dokumentation: hvem er merchant of record, er 49 kr. inkl. moms, udstedes
   kvittering automatisk. Resultatet skrives ind i specen og i pkt. 3 ovenfor.
2. **Opsigelsessti:** Alunta Portal-session-endpoint (spec linje 126/141) skal bekræftes i
   test_mode og bygges, ELLER pkt. 5's manuelle proces gøres permanent + dokumenteres.
3. **Accept-log:** checkbox-accept ved checkout skal gemme tidspunkt + vilkårs-version på
   `subscriptions`-rækken.
