// #8149 trin 1 · Hovedafbryder for bottens PRIVATE Discord-beskeder til spillere.
//
// Ejeren 13/11: spillerne flyttes fra Discord-beskeder til browser-notifikationer,
// i rækkefølgen "Flyt spillerne først, stop så". Denne kontakt er stop-knappen.
// Den står på `on` (præcis som før) og slukkes først på ejerens kør, når
// erstatningerne i spillet er ude og set virke.
//
// Kontakten rører KUN private beskeder fra botten (sendDM, udbakkens
// gentagelser, testknappen og løbsresuméet kl. 20). Kanal-opslag via webhooks,
// ejerens interne alarmer, bottens læsning og divisionsrollerne er uden for den
// (ejer 13/11: "Alarmer bliver, botten må kun læse"). discordPlayerDmCallSites.test.js
// vogter, at ingen ny kode sender en privat besked uden om de fire steder.
//
// ── Værdier ─────────────────────────────────────────────────────────────────
// app_config.discord_player_dm, læst med readFlagStage og evalueret som en
// motor-skrivning (ingen viewer): `on` og `beta` sender, `off` sender intet.
// readFlagStage husker et vellykket opslag i FLAG_CACHE_TTL_MS, så en slukning
// virker inden for cirka et minut uden et ekstra databasekald pr. besked.
//
// ── Når kontakten ikke kan læses ────────────────────────────────────────────
// readFlagStage giver null ved en databasefejl (og ved en manglende række).
// Så bruges den sidst kendte værdi; ved opstart uden en kendt værdi gælder `on`.
// Begrundelse: en læsefejl må hverken tænde en slukket kontakt (den sidst kendte
// `off` holder) eller tavst stoppe beskeder, som spillerne får i dag. Det
// tilbageværende hul (genstart under en databasefejl efter slukning) står i
// planen for #8149 under "Uefterprøvet".

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const DISCORD_PLAYER_DM_KEY = "discord_player_dm";

/** Sidst kendte værdi pr. klient (WeakMap, så tests med egne fakes ikke deler). */
let lastKnownByClient = new WeakMap();

/**
 * Må botten sende private beskeder til spillere lige nu?
 *
 * @param {any} client  supabase-klient (eller fake med `.from`)
 * @param {{ read?: typeof readFlagStage }} [opts]  `read` kun til tests
 * @returns {Promise<boolean>}
 */
export async function isDiscordPlayerDmEnabled(client, { read = readFlagStage } = {}) {
  const value = await read(client, DISCORD_PLAYER_DM_KEY);
  const canRemember = client !== null && typeof client === "object";
  if (value === null || value === undefined) {
    if (canRemember && lastKnownByClient.has(client)) return lastKnownByClient.get(client);
    return true;
  }
  const enabled = evaluateFlagStage(value, { engineWrite: true });
  if (canRemember) lastKnownByClient.set(client, enabled);
  return enabled;
}

/** Kun til tests: glem alle sidst kendte værdier. */
export function __resetDiscordPlayerDmSwitchForTests() {
  lastKnownByClient = new WeakMap();
}
