/**
 * Klip Discord-embeds til Discords egne grænser (#3483, review-fund).
 * =================================================================
 * Discord afviser en for lang embed med 400 + kode 50035 "Invalid Form Body".
 * Det var en åben fejlklasse i DM-stien: buildEmbed i discordNotifier.js
 * interpolerede rytter- og holdnavne direkte ind i title og description uden
 * loft, mens felt-værdier kom fra kaldere der ikke kender grænsen.
 *
 * Kombineret med den oprindelige #3483-klassifikation (400 = "bad-request" =
 * død modtager) var konsekvensen ikke bare en tabt besked: tre for lange
 * notifikationer ville have nulstillet discord_id for HVER tilknyttet spiller,
 * fordi fejlen rammer alle modtagere samtidig. Klassifikationen er nu
 * trin-bevidst (postDm-400 → 'payload-rejected', tæller ikke), og dette modul
 * lukker fejlklassen ved kilden i stedet for kun at overleve den.
 *
 * Pure modul uden effekter, så node --test kan dække grænserne uden netværk.
 * Grænser: Discord REST → Embed Limits.
 */

export const DISCORD_EMBED_LIMITS = Object.freeze({
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  footerText: 2048,
  authorName: 256,
  fields: 25,
});

/**
 * Klip en værdi til `max` tegn. Klippede strenge ender på ellipsis, og
 * resultatet er ALDRIG længere end `max` (ellipsis medregnet).
 */
export function clampText(value, max) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * Klip ét embed-objekt til Discords grænser. Felter der ikke er sat, forbliver
 * usatte (vi tilføjer aldrig en tom title/description — Discord afviser `""`
 * i nogle felter). Overskydende fields droppes efter de første 25.
 */
export function clampEmbed(embed) {
  if (!embed || typeof embed !== "object") return embed;
  const out = { ...embed };

  if (out.title != null) out.title = clampText(out.title, DISCORD_EMBED_LIMITS.title);
  if (out.description != null) {
    out.description = clampText(out.description, DISCORD_EMBED_LIMITS.description);
  }
  if (out.footer?.text != null) {
    out.footer = { ...out.footer, text: clampText(out.footer.text, DISCORD_EMBED_LIMITS.footerText) };
  }
  if (out.author?.name != null) {
    out.author = { ...out.author, name: clampText(out.author.name, DISCORD_EMBED_LIMITS.authorName) };
  }
  if (Array.isArray(out.fields)) {
    out.fields = out.fields.slice(0, DISCORD_EMBED_LIMITS.fields).map((f) => ({
      ...f,
      name: clampText(f?.name, DISCORD_EMBED_LIMITS.fieldName),
      value: clampText(f?.value, DISCORD_EMBED_LIMITS.fieldValue),
    }));
  }
  return out;
}

/** Klip alle embeds i en Discord-payload. Payloads uden embeds passerer urørt. */
export function clampEmbedPayload(payload) {
  if (!payload || !Array.isArray(payload.embeds)) return payload;
  return { ...payload, embeds: payload.embeds.map(clampEmbed) };
}
