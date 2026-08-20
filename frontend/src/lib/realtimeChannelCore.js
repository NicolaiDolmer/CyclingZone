// Ren kerne for session-gatet realtime-abonnement (#4010).
//
// Ingen import af lib/supabase her — klienten sendes ind. Det holder logikken
// unit-testbar under `node --test` (lib/supabase.ts læser import.meta.env og kan
// ikke loades uden Vite), samme opdeling som resten af repoet bruger mellem ren
// lib og I/O-wrapper. Bindingen til den ægte klient bor i realtimeChannel.js.
//
// Problemet der løses: Realtime accepterer KUN en JWT som `access_token`.
// supabase-js falder tilbage til projektets api-nøgle når der ingen session er
// (@supabase/supabase-js@2.112.2, dist/index.mjs:794):
//
//   async _getAccessToken() {
//     return (await this._getSessionToken()) ?? this.supabaseKey;
//   }
//
// Vores api-nøgle er den nye opake `sb_publishable_…`, som ikke er en JWT. Hvert
// connect uden session blev derfor afvist med `MalformedJWT` — 7.727 gange i
// døgnet, 97 % af al realtime-log, plus reconnect-storm.

// En JWT har præcis tre base64url-segmenter. `sb_publishable_…`/`sb_secret_…`
// har nul — så dette skelner nøgle fra token uden at dekode noget.
export function isJwt(token) {
  return typeof token === "string" && token.split(".").length === 3;
}

// Nuværende access token, eller null når der ingen (gyldig) session er.
// Bevidst `getSession()` og ikke `getUser()`: vi skal bruge selve token'et, og
// et netværkskald pr. abonnement ville genindføre præcis den omkostning #4010
// fjerner i backenden.
export async function currentRealtimeToken(client) {
  const { data } = await client.auth.getSession();
  const token = data?.session?.access_token;
  return isJwt(token) ? token : null;
}

/**
 * Abonnér på en realtime-kanal så snart der findes en session.
 *
 * `configure` får en frisk kanal og skal returnere den igen med sine `.on()`-
 * handlers påført. Den kaldes først når vi har et token, så kaldstedet aldrig
 * kan komme til at abonnere med api-nøglen.
 *
 * @param {any} client                       Supabase-klient.
 * @param {string} channelName               Unikt kanalnavn.
 * @param {(channel: any) => any} configure  Påfør `.on()`-handlers, returnér kanalen.
 * @returns {() => void}                     Cleanup — kald fra useEffect.
 */
export function subscribeAuthedChannelWith(client, channelName, configure) {
  let channel = null;
  let cancelled = false;

  async function arm() {
    if (cancelled || channel) return;
    const token = await currentRealtimeToken(client);
    // Race-guard: cancelled/channel kan have ændret sig mens vi await'ede, fx
    // hvis komponenten unmountede eller et auth-event armede parallelt.
    if (cancelled || channel || !token) return;
    // Eksplicit setAuth: uden den slår supabase-js selv token'et op, og det er
    // netop dét opslag der falder tilbage på api-nøglen.
    await client.realtime.setAuth(token);
    if (cancelled || channel) return;
    channel = configure(client.channel(channelName));
    channel.subscribe();
  }

  const armed = arm();

  // Mountes komponenten før sessionen er læst fra storage (INITIAL_SESSION er
  // asynkron), armer vi på auth-eventet i stedet. SIGNED_OUT river kanalen ned,
  // så vi ikke sidder tilbage med et abonnement på et token der er væk.
  const { data: sub } = client.auth.onAuthStateChange((event) => {
    if (cancelled) return;
    if (event === "SIGNED_OUT") {
      if (channel) {
        client.removeChannel(channel);
        channel = null;
      }
      return;
    }
    arm();
  });

  const teardown = () => {
    cancelled = true;
    sub?.subscription?.unsubscribe();
    if (channel) {
      client.removeChannel(channel);
      channel = null;
    }
  };

  // Til test: gør det muligt at afvente første arm-forsøg. React ser kun
  // cleanup-funktionen, så feltet er usynligt for kaldstederne.
  teardown.armed = armed;
  return teardown;
}
