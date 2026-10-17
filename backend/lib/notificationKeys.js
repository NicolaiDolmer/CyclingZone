// #6801: noegle + parametre til en notifikation, uden tunge afhaengigheder
// (ingen Sentry, Supabase eller pagination), saa rene moduler og frontendens
// drift-tests (fx rulesNumbers.test.js -> squadEnforcement.js) kan importere den.
import { DEFAULT_LANGUAGE, translate as translateServer } from "./i18nServer.js";

/**
 * #4734 · Byg en notifikations-payload UD FRA noeglerne.
 *
 * Kontrakten (#666) er at frontend rendrer `metadata.titleCode/messageCode` i
 * modtagerens `users.language`, og at `title`/`message` kun er en fallback for
 * gamle klienter, e-mail-digestet og dedup-noeglen. Foer denne helper skrev hvert
 * kaldsted BEGGE dele i haanden — og i praksis drev de fra hinanden: 20
 * auktions-notifikationer i auctionFinalization.js sendte hardcodet DANSK
 * fallback-tekst til alle managers, ogsaa dem med users.language = 'en'.
 *
 * Her udledes fallbacken fra EN-locale-filen via samme noegle som frontend
 * bruger, saa de to ikke KAN sige noget forskelligt.
 *
 * @param {{ titleCode: string, titleParams?: object, messageCode: string,
 *           messageParams?: object, metadata?: object }} args
 * @returns {{ title: string, message: string, metadata: object }}
 */
export function buildKeyedNotification({
  titleCode,
  titleParams = {},
  messageCode,
  messageParams = {},
  metadata = {},
}) {
  return {
    title: translateServer(titleCode, titleParams, { language: DEFAULT_LANGUAGE }),
    message: translateServer(messageCode, messageParams, { language: DEFAULT_LANGUAGE }),
    metadata: { ...metadata, titleCode, titleParams, messageCode, messageParams },
  };
}
