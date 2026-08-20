# Den nye API-nøgleformat slog Realtime ihjel uden at nogen opdagede det

**Dato:** 2026-08-20 · **Issue:** [#4010](https://github.com/NicolaiDolmer/CyclingZone/issues/4010)

## Symptom

7.727 `MalformedJWT: The token provided is not a valid JWT` i døgnet i
`realtime_logs` — 97 % af al realtime-log. Ingen HTTP-fejl (101 4xx/5xx ud af
1.311.290 requests), ingen Sentry-events, ingen spillerklager der pegede på
noget bestemt. Fejlen dukkede kun op fordi vi kiggede direkte i Supabase-loggen.

## Rod-årsag

Projektet er migreret til Supabases nye nøgleformat, så
`VITE_SUPABASE_ANON_KEY` er nu `sb_publishable_…` i stedet for den gamle
anon-nøgle.

Den gamle anon-nøgle **var en JWT**. Den nye er en opak streng.

supabase-js falder tilbage til api-nøglen når der ingen session er
(`@supabase/supabase-js@2.112.2`, `dist/index.mjs:794`):

```js
async _getAccessToken() {
  return (await this._getSessionToken()) ?? this.supabaseKey;
}
```

Med den gamle nøgle var det fallback harmløst — Realtime fik en gyldig (om end
anonym) JWT. Med den nye nøgle får Realtime noget der ikke kan parses som JWT og
afviser forbindelsen. Klienten reconnecter, får samme afvisning, i ring.

Tre kanaler abonnerede helt uden session-gate, heriblandt `useRealtimeRefetch`
som `useActionSummary` mounter fra `Layout` — altså på hver eneste side.

## Hvorfor det ikke blev fanget

1. **Ingen fejl nåede frontenden.** Et afvist WebSocket-connect gør ikke andet
   end at lade siden være stille. Den ser bare ud som om der ikke skete noget.
2. **Nøgleskiftet var en config-ændring, ikke en kodeændring.** Ingen diff at
   reviewe, ingen test der rørte ved den.
3. **Fallback'et er skjult i biblioteket.** Intet i vores kode nævner at
   api-nøglen kan ende som realtime-token.
4. **E2E-testene mocker.** De beviser rendering, ikke at en ægte WebSocket
   kommer op — samme blinde vinkel som
   `.claude/learnings`-mønstret "test ægte endpoint, ikke kun mocket".

## Fix

`lib/realtimeChannelCore.js` + `lib/realtimeChannel.js`: vent på en ægte JWT
(tre base64url-segmenter), kald `realtime.setAuth(token)` eksplicit, og abonnér
først derefter. Re-arm på `onAuthStateChange` når sessionen kommer senere, riv
kanalen ned ved `SIGNED_OUT`. Alle fem kaldsteder lagt om.

## Læring

**Når en credential skifter *format*, skal man lede efter de steder hvor den
gamle formats egenskaber blev udnyttet implicit.** Her var egenskaben "anon-key
er tilfældigvis også en gyldig JWT". Ingen havde skrevet den antagelse ned,
fordi ingen havde truffet den bevidst — den lå i et bibliotek.

**Forward-guard:** unit-testene i `realtimeChannelCore.test.js` holder fast i at
en `sb_publishable_…`-streng aldrig kan nå frem som `access_token`, og at der
ikke abonneres uden session.

**Bredere guard:** Supabase-logfladen (`realtime_logs`, `postgrest_logs`) er ikke
dækket af nogen alarm. En fejlklasse kan køre 7.727 gange i døgnet uden at nogen
ser den. Det bør have et fast tjek — se opfølgning på #4010.
