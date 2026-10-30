# 2026-10-24 · Merge-dag: rød typecheck slap igennem, og køen læste deploy for tidligt

## Hvad skete
- `frontend-typecheck-baseline` var ikke et påkrævet check. Merge-køen merger på de påkrævede checks + review-gate, så #7123 blev merget med rød typecheck (`jerseyByTeam = useState(null)` + `Th` uden sort-props). Main blev rød for alle åbne PR'er; fix #7141.
- Tre andre PR'er (#7122, #7125, #7075) havde egne typefejl, som først blev synlige efter opdatering mod main.
- Køen stoppede to gange med "deploy-verifikation unknown", selvom deploy + smoke var grønne: den læste jobbets resultat få sekunder før GitHub havde skrevet det.
- Fem PR'er havde Codex-review på en ældre commit end HEAD; review-gaten kørte før Codex var færdig og blev ikke genkørt.
- En død Codex-bølge-markør (22/10) blokerede #7130 i timer.

## Rod-årsag
Gaten, der fanger fejlen, var ikke koblet til det, der beslutter merge (påkrævede checks). "Klar" betød ikke "klar på HEAD".

## Rettet
- #7149 + branch protection: typecheck kører altid og er påkrævet (#7148).
- Regel for PC1: KLAR = opdateret mod main, Codex på HEAD, typecheck grøn, markør ved højrisiko.
- Merge-dag-protokollen: tjek døde bølger før køen; ejer-markører i én samlet kommando.

## Mangler (issue)
Køens læsning af deploy-verify skal vente længere på job-data (retry/backoff), før den melder unknown (#7173). `gh workflow run review-gate.yml -f pr=N` genkører gaten, når Codex blev færdig efter gaten.
