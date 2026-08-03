/**
 * Auto-afkobling af døde Discord-koblinger (#3130).
 * =================================================
 * En spiller der forlader vores Discord-server kan ikke længere DM'es: Discord
 * svarer 403 med kode 50278 ("no mutual guilds"). attemptDmDelivery klassificerer
 * det korrekt som `{ kind: "permanent", reason: "recipient-blocked" }`, og den
 * enkelte besked droppes uden retry-storm og uden Sentry-error (#2189 — bevidst).
 *
 * Men indtil #3130 blev discord_id stående. Tilstanden var derfor permanent og
 * selv-vedligeholdende: spilleren så "Discord tilsluttet" i indstillingerne og
 * fik aldrig en DM igen, mens hver fremtidig notifikation lavede et nyt spildt
 * 403-kald. Ejeren valgte vej A 3/8: afkobl automatisk efter N fejl i træk og
 * fortæl spilleren det, så tavsheden bliver til en handlingsanvisning.
 *
 * Modulet er pure (supabase injiceres) så node --test kan dække tælleren uden DB.
 *
 * Bevidst IKKE atomisk (læs → skriv i stedet for en RPC): kun permanente
 * recipient-blocked-fejl rører tælleren, og de forekommer i størrelsesordenen
 * én gang i døgnet. To samtidige fejl på SAMME bruger kan i værste fald tabe ét
 * increment, hvilket kun udskyder afkoblingen én besked. Det er ikke værd at
 * betale en RPC + migration for.
 */

/** Antal permanente fejl I TRÆK før koblingen betragtes som død. */
export const DEAD_CONNECTION_THRESHOLD = 3;

/**
 * Registrér en permanent 'recipient-blocked'-fejl for et discord_id.
 *
 * Tæller op, og når tærsklen nås: nulstil discord_id (= afkobl), nulstil
 * tælleren og stempl discord_disconnected_at, så indstillingerne kan vise
 * genforbind-beskeden.
 *
 * Kaster aldrig — DM-levering er fire-and-forget, og en fejl her må ikke vælte
 * call-site'et. Fejl rapporteres via returværdien (`error`) og captureExceptionFn.
 *
 * @param {object}   args
 * @param {object}   args.supabase          — service-role client
 * @param {string}   args.discordId         — modtagerens discord_id
 * @param {number}   [args.threshold]       — override til test
 * @param {Date}     [args.now]
 * @param {Function} [args.captureExceptionFn]
 * @returns {Promise<{count: number, disconnected: boolean, userId: string|null, error?: string}>}
 */
export async function recordPermanentDmFailure({
  supabase,
  discordId,
  threshold = DEAD_CONNECTION_THRESHOLD,
  now = new Date(),
  captureExceptionFn = null,
}) {
  const idle = { count: 0, disconnected: false, userId: null };
  if (!supabase || !discordId) return idle;

  const { data: user, error: readErr } = await supabase
    .from("users")
    .select("id, discord_dm_failure_count")
    .eq("discord_id", discordId)
    .maybeSingle();

  if (readErr) {
    captureExceptionFn?.(new Error(`discord dead-connection opslag fejlede: ${readErr.message}`), {
      tags: { component: "discord-dm" },
    });
    return { ...idle, error: readErr.message };
  }
  // Ingen bruger med det id: DM'en kom fra outbox'en efter at brugeren allerede
  // er afkoblet (eller har skiftet id). Intet at tælle på — og ikke en fejl.
  if (!user) return idle;

  const count = (user.discord_dm_failure_count ?? 0) + 1;
  const disconnected = count >= threshold;

  const patch = disconnected
    ? { discord_id: null, discord_dm_failure_count: 0, discord_disconnected_at: now.toISOString() }
    : { discord_dm_failure_count: count };

  const { error: writeErr } = await supabase.from("users").update(patch).eq("id", user.id);
  if (writeErr) {
    captureExceptionFn?.(new Error(`discord dead-connection skrivning fejlede: ${writeErr.message}`), {
      tags: { component: "discord-dm" },
    });
    return { count, disconnected: false, userId: user.id, error: writeErr.message };
  }

  return { count, disconnected, userId: user.id };
}

/**
 * Nulstil fejltælleren efter en LEVERET DM — det er dét der gør tærsklen
 * "på hinanden følgende" i stedet for "akkumuleret over al tid".
 *
 * Ét statement uden forudgående læsning: filteret gør det til et no-op
 * server-side for de ~alle brugere der hverken har fejlet eller været afkoblet,
 * så den normale leverings-sti ikke betaler for en ekstra rundtur med et resultat.
 *
 * Rydder samtidig discord_disconnected_at: en leveret DM BEVISER at koblingen
 * virker igen. Uden det ville en spiller der genforbandt og senere selv fjernede
 * sit id få genforbind-banneret igen — en besked om noget vi ikke har gjort.
 * Det skal ske server-side; frontendens kolonne-grant på `users` dækker kun
 * discord_id, ikke tidsstemplet.
 *
 * @returns {Promise<{reset: boolean, error?: string}>} reset=true hvis en række blev rørt.
 */
export async function clearDmFailureCount({ supabase, discordId }) {
  if (!supabase || !discordId) return { reset: false };

  const { data, error } = await supabase
    .from("users")
    .update({ discord_dm_failure_count: 0, discord_disconnected_at: null })
    .eq("discord_id", discordId)
    .or("discord_dm_failure_count.gt.0,discord_disconnected_at.not.is.null")
    .select("id");

  if (error) return { reset: false, error: error.message };
  return { reset: Boolean(data?.length) };
}
