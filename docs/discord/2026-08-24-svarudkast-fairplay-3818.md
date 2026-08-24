# Spillerbeskeder fair play #3818, 24/8 2026

## Status pr. 24/8 kl. 10:00 CPH

| Modtager | Kanal | Status |
|---|---|---|
| Nickstar Rockets | in-game `admin_notice` | **SENDT** 24/8 kl. 10:00, ejer-godkendt tekst |
| The Wheelbarrels | ingen | **IKKE sendt.** Se advarslen nedenfor |

Den afsendte tekst til Nickstar er ikke udkastet i afsnit 2 herunder, men den kortere
in-game-version i afsnit 3. Udkastene i afsnit 1 og 2 er bevaret som Discord-alternativer,
hvis sagen skal genbesøges.

> **⚠️ The Wheelbarrels kan ikke nås.** Kontoen er auth-banned
> (`banned_until = 2126-01-01`) og frosset. Den har `language = en` og **ingen Discord**,
> så in-game var eneste kanal, og ban'et lukkede den. Ejeren besluttede 24/8 ingen e-mail.
> Spilleren er dermed låst ude uden nogen forklaring. Udkast 1 nedenfor ligger klar,
> hvis han henvender sig, eller hvis beslutningen ændres.

Bemærk: der findes endnu ingen offentliggjort fair play-regel (#3139 er åben), så ingen af
udkastene henviser til en regel, spilleren kunne have læst. De beskriver hvad der er sket,
hvad der er gjort, og hvad der gælder fremover.

---

## 1. Til The Wheelbarrels (frosset, penge tilbageført)

### EN

Hi,

I have reversed a series of transfers between your team and Nickstar Rockets.

Between 10 and 24 August, your team paid 463,200 for riders with a combined market value
of 55,421. The money has been returned to your account in full, and you keep the riders.
Your balance is now 464,426.

Your team is temporarily frozen while I look at this. That means you cannot trade for now.
Racing and everything else is unaffected.

I am not assuming bad intent, and I would rather hear your side than guess at it. If there
is a reason for these transfers that I am not seeing, tell me and I will take it into
account. Either way I will unfreeze you once we have talked.

For context: Cycling Zone has no rule about transfer prices yet, and that is on me. The
fair play rules will be published so nobody has to guess where the line is.

### DA

Hej,

Jeg har rullet en række handler mellem dit hold og Nickstar Rockets tilbage.

Mellem 10. og 24. august betalte dit hold 463.200 for ryttere til en samlet markedsværdi
af 55.421. Pengene er ført tilbage til din konto i deres helhed, og du beholder rytterne.
Din saldo er nu 464.426.

Dit hold er midlertidigt frosset, mens jeg ser på det. Det betyder, at du ikke kan handle
lige nu. Løb og alt andet er upåvirket.

Jeg går ikke ud fra, at der ligger noget ondt bag, og jeg vil hellere høre din version end
gætte mig til den. Hvis der er en grund til handlerne, som jeg ikke kan se, så sig til, og
jeg tager den med. Uanset hvad låser jeg dig op igen, når vi har talt sammen.

Til baggrund: Cycling Zone har endnu ingen regel om handelspriser, og det er min brøler.
Fair play-reglerne bliver offentliggjort, så ingen skal gætte, hvor grænsen går.

---

## 2. Til Nickstar Rockets (clawback, ingen frysning)

### EN

Hi,

I have reversed a series of transfers between your team and The Wheelbarrels.

Between 10 and 24 August, The Wheelbarrels paid your team 463,200 for riders with a
combined market value of 55,421. That money has been returned to them. Your balance is
now 97,124. Your riders and your squad are untouched, and your team is not frozen.

I want to be straight with you: there is no published rule against overpaying today, so I
am not treating this as a rule you broke. But a one directional flow of that size gives a
Division 1 team a budget advantage that did not come from racing, and I cannot leave that
standing while other managers compete on their own results.

If I have misread the situation, tell me and I will listen.

The fair play rules will be published so the line is clear in advance rather than after
the fact.

### DA

Hej,

Jeg har rullet en række handler mellem dit hold og The Wheelbarrels tilbage.

Mellem 10. og 24. august betalte The Wheelbarrels 463.200 til dit hold for ryttere til en
samlet markedsværdi af 55.421. De penge er ført tilbage til dem. Din saldo er nu 97.124.
Dine ryttere og din trup er urørte, og dit hold er ikke frosset.

Jeg vil være ærlig: der findes ingen offentliggjort regel mod overpris i dag, så jeg
behandler det ikke som en regel, du har brudt. Men en ensrettet pengestrøm af den
størrelse giver et Division 1-hold en budgetfordel, der ikke kommer fra løb, og den kan
jeg ikke lade stå, mens andre managere konkurrerer på deres egne resultater.

Har jeg misforstået situationen, så sig til, og jeg lytter.

Fair play-reglerne bliver offentliggjort, så grænsen er klar på forhånd i stedet for
bagefter.

---

## 3. Afsendt in-game-besked til Nickstar Rockets (EN)

Sendt 24/8 kl. 10:00:58 CPH som `notifications.type = admin_notice`,
`metadata.source = ownerSession.fairplay3818.warning`. Rå tekst uden i18n-koder;
`NotificationsPage.jsx:188` falder tilbage til `title`/`message`.

Spilleren har `language = en`, så beskeden er kun sendt på engelsk.

**Titel:** Fair play: transfers with The Wheelbarrels reversed

Between 10 and 24 August, The Wheelbarrels paid your team 463,200 for riders with a
combined market value of 55,421. That money has been returned to them. Your balance is
now 97,124. Your riders and your squad are untouched, and your team is not frozen.

There is no published rule against overpaying yet, so I am not treating this as a rule you
broke. But a one directional flow of that size hands a Division 1 team a budget advantage
that did not come from racing, and I cannot let that stand while everyone else competes on
their results. Please treat this as a formal warning.

If you think I have misread this, get in touch and I will listen.

---

## Præcedens-note

Der fandtes ingen tidligere fair play-besked i spillet, da denne blev skrevet.
`admin_notice` var brugt fem gange, ingen af dem sanktionsrelateret, og der lå ingen
sanktions-udkast i `docs/discord/`. Denne besked er den første af sin slags og bør bruges
som skabelon næste gang, så tonen bliver konsistent.
