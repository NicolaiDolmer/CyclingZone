# Natbølge 2026-11-15 (nat til 16/11 kl. 9)

Ejer-go 15/11 aften, tavle #7911. Dolmer PC, 4 baner. Fable planlagde og dømte, Opus byggede, Sonnet tog tekst, små rettelser og skitser. Intet merget, intet tændt, ingen prod-skrivning.

## Forløb

- Bølge 1: 12 spor. 7 bygget. Stoppede på frys i #8153 (branch-stall efter 141 min; arbejdet gemt og pushet). 4 spor nåede aldrig en bane.
- Bølge 2: 8 spor (#8153 genoptaget i samme worktree, de 4 ustartede, 3 ekstra skitser). Alle 8 bygget, ingen frys.
- Opfølgninger uden for bølgerne: Codex-fund rettet på #8172, #8173, #8174, #8175, #8176, #8178; dommerfund rettet på #8174 og #8175.

## Resultat

| PR | Issue | Hvad | Dom / review | Står |
|---|---|---|---|---|
| #8172 | #8153 | Frigivelse venter til etapeløbets slut, serverdel | Fable: kan merges med forbehold | Klar til ejerens kort. To fund før tænding |
| #8173 | #7865 | Løbssiden v6: plan mod det der skete | Opus-gentjek: bemærkninger | Klar til kort. Merges før #8176 |
| #8174 | #6490 | Ny læsevej for træningshistorik, to kontakter | Fable-gentjek: kan merges slukket | Klar til kort. Svartid blokerer tænding |
| #8175 | #6110 | XP: prisbund, aldersforløb, prøvekørsel | Fable: forbehold; fund rettet; Opus-gentjek | Klar til kort. Ejervalg om bundens grænse |
| #8176 | #7860 | Resultater: søgning og Mit hold | Opus-gentjek: bemærkninger | Klar til kort. Konflikt i RACE_ENGINE_RULES.md med #8173 |
| #8177 | #7801 | Prognosens opslag samtidig | Fable: kan merges med forbehold | Klar til kort. Tid ikke målt |
| #8178 | #6181 | Kontakten er binær overalt, adfærdsprøve | Opus-gentjek: bemærkninger | Klar til kort |
| #8181 | #6365 | Etapeprofilen følger TASTE | Opus-gentjek: bemærkninger | Klar til kort med billeder |
| #8183 | #7868 | Samlet indbakke-link åbner seneste etape | Codex uden fund, bølge-review | Klar til kort |
| #8179 | #2176 | Beta-sætningen ud af Hjælp | bølge-review | Kladde til tændingsdagen |
| #8182, #8184, #8185, #8186, #8187 | #8016, #7947, #6944, #7627, #8013 | Skitser | | Kladder til ejerens valg |

## Issues til claude:done

Ingen: intet er merget.

## Nye issues

- #8180: peak-signalet afkortes i store felter (eksisterende fejl på main, fundet af dommeren over #8174).

## Afvigelser/læringer

- Bølgen tager højst 12 spor pr. kald; planen var 16.
- Skitse-spor markerede deres PR'er klar trods "draft, ingen merge" i scope; sat tilbage til kladde af orkestratoren. Tre skitser omgik Tailwind-vagten (#5449) ved at skrive `class =`; rettes rent.
- Dommerens egen R16-prøve regnede uden sessionsvægt; en dommerprøve skal regne gennem motoren, ikke en kopi af formlen.
- "Markér klar" annullerer den kørende CI; røde `backend-tests` og `frontend-smoke` lige efter var afbrudte kørsler, ikke fejl.
- Playwrights headless-browser mangler på Dolmer PC; billeder blev taget med en allerede installeret Chromium.
- Ikke nået: #8153 frontend, løbssidens trin 2b/2c, startliste, #7535 planlægningssiden.
