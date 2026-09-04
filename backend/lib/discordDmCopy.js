// Discord-DM-copy paa modtagerens sprog — Refs #4734.
//
// En Discord-DM forlader appen som FAERDIG tekst: der er ingen frontend til at
// rendre #666-kontraktens {code, params} for modtageren. Foer #4734 var teksten
// derfor hardcodet EN for alle, ogsaa managers med users.language = "da".
//
// Dette modul er den rene render-del (ingen Supabase, ingen env, ingen fetch),
// saa den kan unit-testes direkte — discordNotifier.js opretter en Supabase-
// klient ved import og kan ikke testes uden env.
//
// Kontrakt: et DM-kaldsted leverer en KODE (+ params) og maa gerne levere en
// literal `text` som sikkerhedsnet. Koden vinder altid naar den kan slaas op;
// literalen bruges kun hvis noeglen mangler i baade modtagerens sprog og EN.

import { DEFAULT_LANGUAGE, translate } from "./i18nServer.js";

// Emojiet bliver i KODEN, ikke i locale-filerne: det er et ikon for
// notifikationstypen (samme rolle som COLORS), ikke tekst der skal oversaettes,
// og locale-filerne holdes fri for pictogrammer der ikke kan reviewes som sprog.
export const DM_TYPE_EMOJI = {
  auction_new: "🔨",
  auction_outbid: "⚠️",
  auction_won: "🏆",
  transfer_offer: "↔️",
  transfer_accepted: "✅",
  transfer_rejected: "❌",
  transfer_completed: "✅",
  swap_completed: "🔄",
  season_started: "🚀",
  season_ended: "🏁",
  watchlist_rider_auction: "👀",
  board_update: "📋",
  board_critical: "⚠️",
  race_result_digest: "🚴",
};

/**
 * Embed-titlens type-praefiks, fx "🏆 Auction won" / "🏆 Auktion vundet".
 * Ukendt type falder tilbage til selve type-strengen (som foer #4734).
 */
export function renderTypeLabel(type, language = DEFAULT_LANGUAGE) {
  if (!type) return "";
  const label = translate(`discord.typeLabel.${type}`, {}, { language, fallback: type });
  const emoji = DM_TYPE_EMOJI[type];
  return emoji ? `${emoji} ${label}` : label;
}

/**
 * Render et tekstfelt der enten baerer en kode eller en faerdig literal.
 * @param {{ code?: string, params?: object, text?: string }} spec
 */
export function renderDmText(spec, language = DEFAULT_LANGUAGE) {
  if (spec == null) return "";
  if (typeof spec === "string") return spec;
  const { code, params = {}, text = "" } = spec;
  if (!code) return text;
  return translate(code, params, { language, fallback: text || code });
}

/**
 * Embed-felter: `name` kan vaere en literal eller en `nameCode`. Vaerdien er
 * altid data (beloeb, navne, tidspunkter) og oversaettes ikke.
 */
export function renderDmFields(fields = [], language = DEFAULT_LANGUAGE) {
  return (fields || []).map((f) => ({
    name: f.nameCode
      ? translate(f.nameCode, f.nameParams || {}, { language, fallback: f.name || f.nameCode })
      : (f.name ?? ""),
    value: f.value,
    inline: f.inline,
  }));
}
