# Docstringen løj om hvilket lag den ryddede — og var ved at annullere en straf

**Dato:** 31/8 2026 · **Issue:** #4482 (PR #4508) · **Klasse:** nær-miss, ikke en hændelse

## Hvad der var ved at ske

`expireSeasonScopedConsequences` i `boardConsequences.js` havde denne docstring:

> Lag 5 cleanup ved sæson-start. Pullout varer ÉN sæson — den row der havde
> `expires_at_season_id` = forrige sæson markeres 'expired'.

Opgaven var at wire funktionen ind i sæsonskiftet, så lag 6-bonustilbud udløber.
Havde jeg stolet på docstringen og kaldt funktionen som den stod, ville hooken også
have udløbet **lag 5, sponsor-exit** — og det ville have annulleret en straf i stilhed.

## Hvorfor det ville have været forkert

Lag 5 har allerede sin egen udløbs-sti, i `economyEngine.js`:

```js
// S-02e · Expire alle aktive lag 5 efter sponsor-payment. Pullout har nu
// ramt sin ene sæsons sponsor-income og frigøres til næste sæson-end.
```

Rækkefølgen er hele pointen: en sponsor-exit skal **ramme** sin ene sæsons
sponsorindtægt og derefter frigives. Sæsonstart-hooks kører **før** season-payroll.
En hook der udløber lag 5 dér, ville fjerne straffen inden udbetalingen den skulle
gøre ondt på.

Ingen test ville have fanget det. Der findes ingen test der siger "en pullout skal
overleve sæsonstart-hookene og først dø efter payroll", fordi ingen havde brug for
den før nu.

## Hvad der afgjorde det

Ikke ræsonnement — **data**. Ét read-only opslag mod prod:

| Lag | Aktive | `expires_at_season_id` |
|---|---|---|
| 2, 3, 4 | 50 | `NULL` — rammes ikke af WHERE-klausulen uanset |
| 5 | **0** | alle 8 står `expired` via economyEngines sti |
| 6 | **36** | sæson 1 (11) + sæson 2 (25), begge `completed` |

Nul aktive lag 5 var beviset for at en anden sti allerede ejer dem. Havde jeg kun
læst koden, kunne jeg have argumenteret mig til begge konklusioner.

Bemærk også: issuet skrev **37**, målingen gav **36**. Ét tilbud var afgjort i
mellemtiden. Et tal i et issue er et øjebliksbillede, ikke en tilstand.

## Reglen

**En docstring der beskriver hvad en funktion gør ved SYSTEMET er en påstand, ikke
en specifikation.** Den beskriver ofte hvad funktionen var tænkt som, ikke hvad
resten af koden er blevet til omkring den.

Før du wirer en hidtil ukaldt funktion ind:

1. **Find de andre stier der rører de samme rækker.** `grep` på tabelnavnet og på
   `status: "expired"` — ikke kun på funktionsnavnet.
2. **Mål tilstanden i prod.** Nul aktive rækker i en kategori er stærk evidens for at
   noget andet allerede rydder op.
3. **Spørg hvornår i kæden den kører.** "Før eller efter payroll" var forskellen på
   en rettelse og en annulleret straf.
4. **Skriv rækkefølgen ned som en test**, ikke som en kommentar. PR #4508 har nu en
   test der fælder hvis nogen tager lag 5 med igen.

## Beslægtet

- #4482 (mekanik skrevet, testet, aldrig kaldt) · #4479 (vagt lovet i prosa)
- `feedback_runtime_verify_first` — verificér mod runtime før du kalder noget sandt
