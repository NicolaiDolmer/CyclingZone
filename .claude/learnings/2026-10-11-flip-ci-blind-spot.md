# 2026-10-11: Flip-PR og motor-PR var hver især grønne, men ikke sammen

## Hvad skete der
Natten 11/10 var både motor-PR'en (#6448, forslag A) og flip-PR'en (#6453, `CURRENT_RACE_RULES_REVISION` -> `official_times_v3`) grønne i CI. Først da hele merge-sættet blev kørt samlet lokalt (main + #6443 + #6448 + #6455 + flip), fejlede `inputMatters6285.test.ts` (#6285-B).

## Hvorfor
De spillervendte regressionstests kører under den LIVE revision. #6448's CI kørte dem under v2 (main er live på v2), og flip-PR'ens CI kørte dem under v3 uden #6448. Ingen CI-kørsel så v3 + A sammen, som det ville være i prod efter "tænd".

## Regel
Før en revision tændes: kør hele `npm --prefix backend test` og gaten på en LOKAL kombination af hele merge-sættet inkl. flip-PR'en (aldrig pushet), ikke kun hver PR for sig. Det fangede fejlen 4 timer før Touren.

## Også lært
- Gate-målinger kan måle noget andet end spillet: proxy-GT'en fik intet klassement, og tidsgab blev målt på seeds hvor udbruddet vandt. Ret målingen kun mod en skrevet regel, og lad en uafhængig dommer se den (#6443, #6455, #6458).
- Et parret "mindre end"-tjek med n=1 mod n=7 sammenligner forskellige løb; årsagen (#6285-B) var en finale-solo, der blev talt som udbrudsforspring.
