// #3624: styrer om loebs-afslutningen AFLEVERER den eksterne resultat-notifikation
// til race_notify_outbox (og lader et selvstaendigt tick sende den) i stedet for at
// sende den synkront midt i den blokerende afviklingssti. Bor i app_config (samme
// moenster som raceFinalizeResumableFlag.js/autoPrizeFlag.js) → flippes runtime uden
// re-deploy, og kan slaas fra igen i samme sekund hvis en besked udebliver.
//
// Fail-safe: fejl/fravaer → false. Med flaget OFF skrives der INTET til koen og
// afsender-tikket finder aldrig noget at sende — adfaerden er bit-identisk med foer
// #3624 (notifyDiscord kalder sendWebhook i serie, praecis som i dag).
//
// "beta" laeses som off for dette flag. Der findes ingen viewer at gate paa: koen
// er en ren leverings-mekanik i cron-laget, og halvvejs-tilstanden "nogle loeb i
// koen, andre synkront" ville goere maalingen efter flippet ulaeselig. Samme valg
// som race_finalize_resumable_enabled (#4147).
//
// Default OFF ved merge. Flippet er EJER-ONLY (#3624-kommentaren 18/9) og maales
// bagefter paa en stor klynge kl. 12 eller 18.
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const RACE_NOTIFY_OUTBOX_FLAG_KEY = "race_notify_outbox_enabled";

export async function isRaceNotifyOutboxEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, RACE_NOTIFY_OUTBOX_FLAG_KEY), opts);
}
