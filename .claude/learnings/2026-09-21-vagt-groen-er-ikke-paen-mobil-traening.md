# 21/9 2026: en vagt-grøn rettelse er ikke en god rettelse (mobil-træning, #4851 + #3643)

## Hvad skete der

Den gamle mobil-træningsliste (live for alle uden beta) malede ryttertypen "SPRINTER/ROULEUR" 53-58 px ud over sin kolonne. Undtagelseslisten i tekst-vagten foreslog selv rettelsen: "én klasse (`break-words`)". Workeren lavede præcis det. Vagten blev grøn. Resultatet på skærmen var værre end før: "SPRINTE / R/ROULE / UR" og "TRÆTHE / D".

## Rod-årsag

1. **Noten i allowlisten beskrev et symptom, ikke en årsag.** Navnekolonnen har 41-46 px til indhold; intet ord i linjen kan stå der. `break-words` flytter fejlen fra "løber ud" til "brækker midt i ordet".
2. **Vagten måler geometri, ikke læsbarhed.** 0 px overløb er et gulv, aldrig en godkendelse.
3. **Tekst-vagten dækkede kun den gamle gren.** Standard-mocken satte ikke `mobileTable`, så den nye visning (bag flag) var uset af `5383`.

## Hvad vi gjorde

- #5457: `<wbr>` efter "/" (samme opskrift som DataTable), ingen brud midt i ord. 53 → 6 px (DA), 58 → 11 px (EN). Undtagelsen blev opdateret med de nye tal, IKKE fjernet; DataTables mindstebredde (148 px) gav 0 px men klippede tre andre kolonner.
- #5458: den rigtige kur er den nye visning. Beta-klagen (kortet 201 px under tabellen) løst: kortet folder ud under rækken. `5383` fik en side-post MED flaget tændt, som fejler højlydt hvis mocken holder op med at tænde grenen.

## Forward-guard

- **Orkestratoren ser billedet, før en UI-rettelse godkendes**, også når vagten er grøn. Det fangede `break-words` før commit.
- En allowlist-note der foreslår en rettelse er en hypotese. Workeren skal måle rod-årsagen (kolonnebredde mod længste ubrydelige stykke) før den vælger klasse.
- Ny flade bag flag → vagterne skal have en post MED flaget tændt i samme PR.

## Åbent

- Workeren kopierede `withBreakHints` ind i `TrainingPage.jsx` for at undgå TIER FULL. Accepteret fordi hele den gamle gren slettes når `training_mobile_table` går til `on` (#3643). Sker flippet ikke, skal kopien erstattes af en import.
- `--text-3` har for lav kontrast (2,4-2,8 mod 3) på 30+ elementer i den nye visning; kendt app-bred gæld, eget ejer-kort.

Refs #4851 #3643 #5383 · PR #5457 #5458
