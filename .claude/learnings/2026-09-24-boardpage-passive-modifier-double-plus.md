# Postmortem · 2026-09-24 · Sponsoreffekt-linjen viste "++10%" (gammelt bestyrelsesrum)

## Hvad skete der?
`PassiveModifierLine` i `frontend/src/pages/BoardPage.jsx` viste "sponsorindtægt ++10%" ved positiv sponsoreffekt. Negative effekter ("-10%") var korrekte. PR #5679 rettede samme bug i det nye Boardroom (`boardroom/MandateCard.jsx`) og noterede eksplicit at det gamle rum havde den samme, men lod den stå som out of scope.

## Root cause
Fortegnet blev sat to steder: JS beregnede `const sign = info.pct > 0 ? "+" : ""` og interpolerede `${sign}${info.pct}`, mens locale-strengene `transparency.passiveModifier.{boost,strong_boost}` allerede bar et bogstaveligt "+" før `{pct}` (begge sprog). penalty/strong_penalty har intet fortegn i strengen, og pct er allerede negativt, så de var korrekte af samme grund som boost var forkert.

## Fix
`BoardPage.jsx` sender nu `{ pct: info.pct }` råt (PR #5680, Refs #5632). Locale-filerne er uændrede.

## Forhindret-fremover
`frontend/src/pages/BoardPage.passiveModifierSign.test.js` låser (a) kildemønstret (ingen `const sign`, rå `pct`) og (b) præmissen i begge locale-filer (boost har "+{pct}%", penalty har intet fortegn før {pct}). Bryder nogen præmissen ved at flytte fortegnet tilbage i JS eller ud af strengen, fejler testen med en besked der siger hvorfor.

## Læring
Fortegn på et tal hører hjemme ÉT sted, og det sted er locale-strengen når den alligevel formulerer sætningen omkring tallet. Når to overflader deler i18n-nøgler (her gammelt og nyt bestyrelsesrum), skal et fund i den ene rettes i begge i samme runde; "out of scope, samme bug" i en PR-kommentar er et issue-værdigt spor, ikke et afsluttet punkt.
