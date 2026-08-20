// Binding af den session-gatede realtime-helper til app'ens Supabase-klient
// (#4010). Al logik ligger i realtimeChannelCore.js, som er unit-testbar fordi
// den ikke importerer lib/supabase (og dermed ikke import.meta.env).

import { supabase } from "./supabase";
import { subscribeAuthedChannelWith, currentRealtimeToken as tokenFor } from "./realtimeChannelCore";

export const currentRealtimeToken = () => tokenFor(supabase);

/**
 * @param {string} channelName               Unikt kanalnavn.
 * @param {(channel: any) => any} configure  Påfør `.on()`-handlers, returnér kanalen.
 * @returns {() => void}                     Cleanup — kald fra useEffect.
 */
export function subscribeAuthedChannel(channelName, configure) {
  return subscribeAuthedChannelWith(supabase, channelName, configure);
}
