# Pro-checkout åbnes (2/9): ejer-tjekliste + kundebesked + ugenote-linje

**Status: AFVENTER EJER.** Kode-flippet (`CHECKOUT_PAUSED = false` begge steder) er i PR'en for #2813/#2806/#4074. De tre stykker herunder er ejerens egne handlinger, ikke noget Claude kan udføre.

## 1. Tjekliste FØR merge

- [ ] **Bekræft plan-ID i Infisical/Railway:** `ALUNTA_CZ_PRO_PLAN_ID_MONTHLY` skal have værdien `0cd45c7f-6214-46aa-94a5-9b6e0e5989a8` (kun navn på nøglen + forventet værdi her, Claude har ikke selv læst den).
- [ ] **Tænd Aluntas betalingsnotifikationer** i Alunta-dashboardet, så et gennemført/fejlet træk giver besked med det samme (ikke først ved næste daglige reconcile).
- [ ] **Lav ét testkøb** efter deploy: gennemfør et rigtigt køb af "Pro" (månedsplanen), verificér accept-log på `subscriptions`-rækken, kvittering i Dinero, og at `/pro` viser korrekt status bagefter.

### Kendte risici fundet under research (ikke rettet, kun flagget)

- **`CZ Pro 6 Months` er `available_in_checkout=false`** i Alunta (BILLING_STACK.md §2), men er default-valgt interval på `/pro` (`ProUpgradePage.jsx` linje ~48, `useState("semiannual")`). Et klik på "Videre til betaling" på den plan kan fejle hos Alunta. Ikke rettet her, jf. opgavens "ret intet andet i flowet".
- **`semiannualPrice` i `pro.json` viser 265 kr** (en+da), men Alunta-planen blev repriset til 23600 øre ekskl. moms = 295 kr inkl. (jf. issue #2813-kommentar 31/8). Prisen der vises stemmer ikke længere med det Alunta opkræver.
- **#4074 (EUR/DKK) er beskrevet som blokerende for flippet** i eget issue, men opgaven her er ejer-beslutningen "åbn nu, ret bagefter": noteret, ikke løst.
- **Kortet er aldrig trukket automatisk** for den eksisterende abonnent (#4514, stadig åbent), samme mekanisme kan ramme nye kunder efter fornyelse.

## 2. Kundebesked til den eksisterende abonnent (faktura #2, 61,25 kr, forfaldt 8/8, 25 dage over; Pro-mærket faldt i nat)

Udkast til ejeren selv at sende (Discord/mail). Ingen navn skrevet ind her, jf. repoets offentlige synlighed.

**EN:**

```
Hi,

I want to give you an honest heads-up. Invoice #2 for your CZ Pro subscription
(61.25 kr) has been open since 8 August, and the automatic card charge that
should have covered it never went through. That is on my side, not something
you did wrong, and I am looking into why.

One visible effect: your Pro badge dropped when the subscription period ended,
since it never renewed. Your Founder status is untouched, it is permanent from
your place among the first 50, regardless of what happens with the subscription.

I will follow up directly on how we sort out the invoice. If you would rather
handle it yourself in the meantime, "Manage subscription" in your account
settings opens the payment portal. Thank you for being one of the first to back
Cycling Zone.

Nicolai, Cycling Zone
```

**DA:**

```
Hej,

Jeg vil give dig en ærlig status. Faktura #2 til dit CZ Pro-abonnement (61,25 kr)
har stået åben siden 8. august, og det automatiske korttræk der skulle have
dækket den, er aldrig gået igennem. Det er en fejl på min side, ikke noget du
har gjort forkert, og jeg undersøger hvorfor.

Én synlig konsekvens: dit Pro-mærke faldt væk da abonnementsperioden udløb,
fordi den ikke blev fornyet. Din Founder-status er upåvirket, den er permanent
fra din plads blandt de første 50, uanset hvad der sker med abonnementet.

Jeg følger selv op på hvordan vi lander fakturaen. Vil du hellere ordne det
selv i mellemtiden, finder du "Administrér abonnement" i dine kontoindstillinger,
som åbner betalingsportalen. Tak fordi du var en af de første til at bakke
Cycling Zone op.

Nicolai, Cycling Zone
```

## 3. Linje til søndagens ugenote

**EN:** CZ Pro checkout is open again, mainly a way to back what I'm building here, never a gameplay edge.

**DA:** CZ Pro-checkout er åben igen, primært en måde at bakke det jeg bygger her op på, aldrig en fordel i spillet.
