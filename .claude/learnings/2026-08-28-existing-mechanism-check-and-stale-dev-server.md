# #4350: den halve mekanik der allerede fandtes, og serveren der kørte den forkerte kode

**Dato:** 2026-08-28 · **Issue:** [#4350](https://github.com/NicolaiDolmer/CyclingZone/issues/4350) · **Klasse:** proces (3 fejl, alle fanget inden push)

## Hvad der skete

To ting gik galt i samme session. Ingen af dem nåede produktionen, men begge kostede tid, og begge er gentagelige.

### 1. Jeg begyndte at bygge noget der allerede var bygget

Issuet stillede et A/B-valg op - "send spilleren til `/login`" vs. "vis en besked først" - som om ingen af delene fandtes. Jeg tog anbefalingen (B) for pålydende og gik i gang.

Ejeren spurgte midt i arbejdet: *"Har du tjekket om denne opgave allerede var løst i forvejen?"* Det havde jeg ikke, ikke ordentligt. Da jeg gjorde, viste det sig at **A var bygget, og byggeklodserne til B var bygget**:

| Byggeklods | Hvor |
|---|---|
| Session-state ryddes ved `SIGNED_OUT` | `App.jsx:198` |
| Redirect til `/login?next=<deep-link>` | `App.jsx:131` (`ProtectedRoute`) |
| Flash-banner-mønster på login | `LoginPage.jsx:465` (`authLinkError`) |
| Teksten "Din session er udløbet" (en+da) | `errors:supabase.sessionMissing` |

`getAuthedUser.js:9` udpegede oven i købet eksplicit "edge-casen hvor `SIGNED_OUT` ikke fyrer" som stedet adfærden skulle udvikles.

Det der faktisk manglede, var **detektionen** - ikke reaktionen. Pakken gik fra "ny UI + ny redirect" til et lille modul plus tre kaldsteder, og introducerede **nul ny spiller-tekst**.

**Rod-årsag:** et issue skrevet af en AI-triage er en *hypotese om koden*, ikke en måling af den. Jeg behandlede dets A/B-valg som et åbent valg, fordi det var formuleret som et.

### 2. Jeg diagnosticerede en bug i kode der ikke blev serveret

Banneret dukkede ikke op i browseren. Jeg fandt `React.StrictMode` i `main.jsx:97`, konkluderede at min urene `useState`-initializer blev spist af det dobbelte kald, og byggede om.

Den forklaring var plausibel - og ikke årsagen. Da jeg endelig **målte** i stedet for at ræsonnere:

```js
await fetch('/src/pages/LoginPage.jsx').then(r => r.text())
// → includes('peekSessionExpiredFlash') === false
```

Dev-serveren kørte `C:\Dev\CyclingZone` (hoved-checkoutet), ikke worktree'et. `preview_start` læser `.claude/launch.json` fra den **primære** arbejdsmappe, og konfigurationen `frontend` peger på en relativ sti - så den startede main's frontend, uanset hvilket worktree sessionen arbejdede i.

**Rod-årsag:** jeg gik fra symptom direkte til en mekanisme jeg kendte, uden først at bekræfte at koden under test overhovedet var min.

## Hvad der blev gjort

- Afgrænsningen skrevet om på issuet før implementering.
- Fixet blev det lille: `lib/sessionExpiry.js` (ren logik, ingen imports) + detektor på hjerteslaget + genbrug af den eksisterende udlognings-kæde.
- Værn mod fornyelses-race: en 401 vejes mod sessionens **nuværende** token. Uden den gren havde vi byttet "bliver ikke logget ud" ud med det værre "bliver logget ud uden grund".
- StrictMode-opdelingen (læs i initializer, ryd i `useEffect`) blev **beholdt** - den er korrekt uanset, og matcher `authLinkError` - men den blev ikke krediteret som årsagen til symptomet.
- Forward-guard `sessionRejection.4350.test.js` pinner både detektionen og fornyelses-race-grenen.

### 3. Ejerens spoergsmaal afdaekkede en fejl i det jeg havde bygget

Ejeren spurgte: *"Vi skal da ikke logge nogen ud?"* Svaret var i princippet nej - spilleren er allerede logget ud set fra serveren, og appen rydder bare en doed session. Men da jeg gik tilbage i backend-koden for at svare praecist, fandt jeg at `requireAuth` svarer 401 BAADE paa et aegte afvist token og paa "kunne ikke naa Supabase til at tjekke det" (`if (error || !user)`).

Min kode ville derfor logge **raske spillere** ud under et kortvarigt Supabase-udfald. Praecis det ejeren var bekymret for, og jeg havde bygget det uden at se det.

Rettet ved at kraeve to uafhaengige kilder: backendens 401 OG et direkte `getAuthedUser()`-opslag mod Supabase. Enhver usikkerhed - Supabase svarer stadig, eller vi kan slet ikke naa den - peger samme vej: goer ingenting. Rod-aarsagen (serverens sammenblanding af to tilstande) er skilt ud som [#4369](https://github.com/NicolaiDolmer/CyclingZone/issues/4369).

**Rod-aarsag:** jeg tog vores egen backends 401 som et entydigt signal uden at laese hvad der faktisk kunne udloese den. Naar man begynder at HANDLE paa et signal, skal man laese afsenderens kode - ikke kun statuskoden.

## Regler at tage med

1. **Et issues løsningsforslag er en hypotese, ikke en måling.** Før du bygger det: find de mekanismer der allerede findes for samme tilstand. Grep efter reaktionen (`SIGNED_OUT`, redirect, eksisterende i18n-nøgle) før du bygger en ny.
2. **Bekræft at koden under test er din, før du forklarer dens opførsel.** Ét kald - hent modulet fra dev-serveren og se efter dit eget symbol - koster sekunder og udelukker en hel klasse af falske diagnoser.
3. **`preview_start` er forankret i den primære arbejdsmappe, ikke i worktree'et.** Arbejder du i et worktree, skal `launch.json`-konfigurationen have en **absolut** prefix-sti til worktree'ets `frontend` (som `matrix-1146-mock` allerede gør). Ellers får du main's kode med worktree'ets forventninger.
4. **Unit-tests kan være grønne mens fladen er tom.** Begge fejl ovenfor overlevede en grøn `node --test`. Et visuelt tjek på den rigtige server er ikke pynt - det er verifikationen.

## Relateret

- [#4347](https://github.com/NicolaiDolmer/CyclingZone/issues/4347) / [#4348](https://github.com/NicolaiDolmer/CyclingZone/issues/4348) - den anden halvdel af samme auth-klynge (manglende token vs. afvist token)
- [#4352](https://github.com/NicolaiDolmer/CyclingZone/issues/4352) - hvorfor fejlklassen kunne leve uopdaget: 242 rå fetch-kald, ét 401-tjek
- `.claude/learnings/2026-08-06-shared-checkout-cross-session-commit.md` - samme familie: delt checkout, forkert antagelse om hvor man står
