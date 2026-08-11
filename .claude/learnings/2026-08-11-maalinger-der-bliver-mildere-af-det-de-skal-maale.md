# 2026-08-11 · To målinger der blev mildere af præcis den ændring de skulle fange

**Issues:** [#3632](https://github.com/NicolaiDolmer/CyclingZone/issues/3632) (PR #3635) · [#3601](https://github.com/NicolaiDolmer/CyclingZone/issues/3601) (PR #3636)

Samme dag, to uafhængige steder, samme familie som [guard-forfaldet tidligere på dagen](2026-08-11-guard-premise-decay-archetype-draw.md) — men to nye varianter der er værd at kunne genkende hver for sig.

## Variant 1: metrikken bliver triviel af den ændring den skal måle (#3632)

G1-gaten spurgte: "genfinder klassifikatoren det trukne anlæg?" Implementeringen var:

```js
const hit = isHybrid ? (finalPrimary === primary || finalPrimary === secondary) : finalPrimary === primary;
```

Fornuftig så længe 15 % var hybrider: en rytter med to anlæg må gerne matche begge. Men #3632's hele indhold var at gøre **alle** til hybrider. I samme sekund fik hver eneste rytter to chancer i stedet for én, og gaten ville have rapporteret en FORBEDRING (79,2 % → 90,7 %) af en ændring der i virkeligheden gjorde kroppen mindre spids. Målt striks gik den den anden vej: 67,3 % → 61,7 %.

Det er ikke en vagt der forfalder fordi verden udenom ændrer sig (det var morgenens postmortem). Det er en vagt hvis **egen målestok er defineret ud fra den variabel PR'en ændrer**. Den er farligere, fordi den ikke bliver tavs — den bliver *positiv*. Havde jeg kun set tallet stige, havde jeg haft "bevis" for at ændringen var god.

Spørgsmålet der afslører den: **hvis min ændring lykkes fuldstændigt, kan denne måling så stadig fejle?** Kan den ikke, måler den ikke ændringen — den måler at ændringen fandt sted.

## Variant 2: filteret fandtes, bare ikke alle steder (#3601)

`frontend-smoke` (required check) havde været rød en hel dag på tre urelaterede branches, altid samme spec, altid `mobile-webkit`. Issuet stod som en gåde: "2 tests fejler, aldrig de samme 2, alle består isoleret". Hypotesen var en `console.error` der lækkede mellem tests.

Rettelsen var et grep. Beskeden i fejlen —

```
pageerror: /127.0.0.1:4173/dashboard due to access control checks.
```

— stod ordret i `core-smoke.spec.js` og `board-interactive.spec.js` som kendt, dokumenteret webkit-dev-støj, filtreret fra begge steder. `sponsor-ui.spec.js` havde bare aldrig fået filteret. "Består isoleret, fejler i fuld suite" var ikke et mysterium: uden belastning bliver route-chunks ikke afbrudt, så støjen opstår ikke.

Læringen er ikke "husk filteret". Den er at **et kendetegn der findes i to kopier allerede er en fejl** — den tredje forekomst er ikke et spørgsmål om hvis, men om hvornår. Da jeg samlede dem i `fixtures.js`, tog det fem minutter; havde nogen gjort det da kopi nummer to blev skrevet, havde denne dag ikke kostet en blokeret merge-kø.

Og: **led efter fejlbeskeden i repoet før du teoretiserer om den.** Hypotesen i issuet var plausibel, velskrevet og forkert. Et `grep "access control"` over `frontend/` afgjorde sagen på ét kald.

## Forward-guard

Når en PR ændrer den variabel en gate måler på:

1. Skriv den nye målte værdi ind i gaten som kommentar, med n og seed — ikke bare det nye gulv.
2. Tjek eksplicit at gaten stadig **fejler på kendt defekt kode**. #3570's negativ-tests reddede mig her: de afslørede at gulvet 52 skulle ligge over fase-1-kædens 50,0 %, ellers ville den kendte defekt kunne snige sig under.
3. Beholder du den gamle, mildere måling (jeg beholdt den løse G1 som oplysende test), så skriv i koden at den IKKE er gate og hvorfor.

Og når du finder en konstant/regex/tærskel kopieret i to filer: saml den i samme commit som du rører den. Ikke i "en oprydnings-PR senere".

---

## Tilføjelse samme aften: samlingen var ikke nok — akserne var to (#3601, PR #3637)

Sidste linje ovenfor siger "saml den i samme commit". Det gjorde #3636: webkit-støjfilteret lå i to kopier, og de blev samlet i `fixtures.js`. Dagen efter gik `sponsor-ui.spec.js` rød igen — på præcis den spec fixet dækkede.

Fejlen var at "alle kopier" blev talt op langs **én** akse. Der var to:

| Akse | Hvad #3636 gjorde | Hvad der manglede |
|---|---|---|
| **Specs** | Alle tre kopier samlet ét sted ✅ | — |
| **Kanaler** | Kun `page.on("pageerror")` | `console.error` var uafdækket i helperen |
| **Beskedvarianter** | 2 af mindst 3 mønstre | `ChunkLoadError ... chunk reload needed` |

Man kan tælle sine kopier korrekt og stadig have et hul, hvis man kun spørger "hvor mange steder står den?" og ikke "hvad er alle måder fænomenet kan komme ind på?".

**Regel jeg tager med:** når du samler et kendetegn ét sted, så skriv de akser ned det varierer langs — kilde, kanal, formulering, tidspunkt — og tjek hver af dem, ikke bare antallet af filer. Og byg en guard der fejler på **kilden** frem for symptomet: `guards.test.js` fejler nu hvis en spec overhovedet hænger direkte på en fejlkanal, uanset hvilken. Det er den eneste form der også dækker den fjerde akse jeg ikke har tænkt på endnu.

Samme aften, samme klasse: #3554. Fem specs skrev bevis-screenshots til committede stier, og ingen gate fangede det — fordi resultatet er et beskidt arbejdstræ, ikke en rød test. En fejl der ikke producerer et rødt signal, findes ikke for CI. Derfor to guards: en statisk der læser specs, og et `git diff --exit-code` efter suiten.
