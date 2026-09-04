/* Boot-vagt mod cachede 404-chunks (#4595). Classic script — IKKE et modul.
 *
 * MAALT 4/9 i en spillers browser: `frontend/vercel.json` saetter
 * `Cache-Control: public, max-age=31536000, immutable` paa `/assets/(.*)` for
 * ALLE svar — ogsaa 404. Vercels header-regler matcher paa sti, ikke paa status,
 * og der findes ingen dokumenteret maade at betinge dem paa statuskode. Under et
 * deploy svarer edgen kortvarigt 404 paa et nyt chunk (fx `react-dom-<hash>.js`),
 * og browseren gemmer den 404 immutable i et aar:
 *
 *   performance.getEntriesByType('resource')
 *   -> { responseStatus: 404, deliveryType: "cache", transferSize: 0 }
 *
 * Entry-modulet fejler saa STILLE ved hver eneste navigation — ingen
 * console-fejl, tom `#root`, sort side — indtil brugeren haard-genindlaeser.
 * `location.reload()` alene hjaelper ikke: en immutable-cachet respons
 * revalideres ikke. Kun `fetch(url, { cache: 'reload' })` tvinger et rigtigt
 * netvaerkskald og overskriver cache-posten. Bekraeftet manuelt: refetch af de
 * to filer + navigation gav straks en rendret side.
 *
 * Hvorfor en classic script og ikke app-kode: naar entry-modulet fejler, koerer
 * INTET af app-grafen — heller ikke `installChunkReloadHandlers` i main.jsx.
 * Denne fil er det eneste lag der stadig eksisterer i det scenarie.
 *
 * Loop-sikkerhed: MAKS ét reload pr. 60 s, gemt i sessionStorage under
 * `cz_chunk_selfheal_at`, plus et per-load-flag. Kan sessionStorage ikke laeses
 * eller skrives, reloader vi IKKE (fail-closed) — et uendeligt reload-loop er
 * vaerre end en sort side med en manuel genindlaesning.
 *
 * Refs #4595 #2423 #4545 #906
 */
(function (global) {
  "use strict";

  var GUARD_KEY = "cz_chunk_selfheal_at";
  var MIN_RELOAD_INTERVAL_MS = 60000;
  var REFETCH_TIMEOUT_MS = 4000;

  function createChunkSelfHeal(win) {
    var doc = win && win.document;
    // Per-load-flag: to fejlede ressourcer i samme load maa give ét forsoeg, ikke to.
    var attempted = false;
    var unloading = false;

    function warn(message) {
      if (win.console && typeof win.console.warn === "function") {
        win.console.warn("[chunk-selfheal] " + message);
      }
    }

    // Alle URL'er browseren kan have en cachet 404 paa: entry-bundlen plus hver
    // modulepreload Vite injicerer. Vi kender ikke nødvendigvis hvilken der
    // fejlede (link-fejl baerer href, men en fejl i modul-grafen peger paa
    // entryen), saa vi renser dem alle. De er faa og smaa.
    function moduleUrls() {
      var urls = [];
      if (!doc || typeof doc.querySelectorAll !== "function") return urls;
      var nodes = doc.querySelectorAll(
        'link[rel="modulepreload"][href], script[type="module"][src]',
      );
      for (var i = 0; i < nodes.length; i += 1) {
        var url = nodes[i].href || nodes[i].src;
        if (url && urls.indexOf(url) === -1) urls.push(url);
      }
      return urls;
    }

    // Fail-closed: uden laesbar sessionStorage kan vi ikke bevise at vi ikke
    // allerede har reloadet, og saa reloader vi ikke.
    function claimReloadSlot(now) {
      var storage;
      try {
        storage = win.sessionStorage;
        if (!storage) return false;
        var last = Number(storage.getItem(GUARD_KEY)) || 0;
        if (last && now - last < MIN_RELOAD_INTERVAL_MS) return false;
        storage.setItem(GUARD_KEY, String(now));
        return true;
      } catch {
        return false;
      }
    }

    function refetchAll(urls) {
      var fetchFn = win.fetch;
      var PromiseImpl = win.Promise;
      if (typeof fetchFn !== "function" || typeof PromiseImpl !== "function") {
        return null;
      }
      var settled = [];
      for (var i = 0; i < urls.length; i += 1) {
        settled.push(
          PromiseImpl.resolve()
            .then(
              (function (url) {
                return function () {
                  // cache: "reload" = spring browser-cachen over paa vejen UD og
                  // overskriv posten med svaret. Det er hele fixet.
                  return fetchFn.call(win, url, { cache: "reload", credentials: "same-origin" });
                };
              })(urls[i]),
            )
            .then(noop, noop),
        );
      }
      // Et haengende netvaerk maa ikke udskyde reloaden i det uendelige.
      var handle;
      var timeout = new PromiseImpl(function (resolve) {
        if (typeof win.setTimeout === "function") {
          handle = win.setTimeout(resolve, REFETCH_TIMEOUT_MS);
        }
      });
      return PromiseImpl.race([PromiseImpl.all(settled), timeout]).then(function (value) {
        // Ryd timeren naar racet er afgjort — ellers holder den event-loopet i live.
        if (handle !== undefined && typeof win.clearTimeout === "function") {
          win.clearTimeout(handle);
        }
        return value;
      });
    }

    function noop() {}

    function heal(reason) {
      if (attempted || unloading) return false;
      attempted = true;

      if (!claimReloadSlot(Date.now())) {
        warn(reason + " — reload sprunget over (allerede forsoegt, eller sessionStorage utilgaengelig)");
        return false;
      }

      var urls = moduleUrls();
      warn(reason + " — renser " + urls.length + " modul-URL'er med cache:'reload' og genindlaeser én gang");

      var reload = function () {
        if (unloading) return;
        try {
          win.location.reload();
        } catch (err) {
          warn("location.reload() fejlede: " + (err && err.message ? err.message : err));
        }
      };

      var pending = urls.length ? refetchAll(urls) : null;
      if (pending && typeof pending.then === "function") {
        pending.then(reload, reload);
      } else {
        // Ingen fetch/Promise (meget gammel browser): reload alene er bedre end intet.
        reload();
      }
      return true;
    }

    // Ressource-fejl (script/link) bobler ikke, men de KAN fanges i capture-fasen
    // paa window. Runtime-fejl kommer samme vej, saa vi skelner paa target.
    function onWindowError(event) {
      var target = event && event.target;
      if (!target || target === win || typeof target.tagName !== "string") return;
      var tag = target.tagName.toLowerCase();
      var attr = typeof target.getAttribute === "function" ? target.getAttribute.bind(target) : null;
      if (tag === "script" && attr && attr("type") === "module") {
        heal("entry-modulet kunne ikke hentes (" + (target.src || "ukendt URL") + ")");
        return;
      }
      if (tag === "link" && attr && attr("rel") === "modulepreload") {
        heal("modulepreload fejlede (" + (target.href || "ukendt URL") + ")");
      }
    }

    function install() {
      if (!win || typeof win.addEventListener !== "function") return function () {};
      win.addEventListener("error", onWindowError, true);
      win.addEventListener("pagehide", function () {
        unloading = true;
      });
      win.addEventListener("pageshow", function () {
        unloading = false;
      });

      // Belt-and-braces: direkte listener paa entry-scriptet. Window-capture
      // daekker det allerede, men et direkte target-kald er billigt og goer
      // vagten uafhaengig af capture-fasens rækkevidde i eksotiske engines.
      var attachDirect = function () {
        if (!doc || typeof doc.querySelectorAll !== "function") return;
        var scripts = doc.querySelectorAll('script[type="module"][src]');
        for (var i = 0; i < scripts.length; i += 1) {
          scripts[i].addEventListener("error", onWindowError);
        }
      };
      if (doc && doc.readyState !== "loading") {
        attachDirect();
      } else if (doc && typeof doc.addEventListener === "function") {
        doc.addEventListener("DOMContentLoaded", attachDirect);
      }

      return function uninstall() {
        win.removeEventListener("error", onWindowError, true);
      };
    }

    return { install: install, heal: heal, moduleUrls: moduleUrls };
  }

  global.__czChunkSelfHeal = { create: createChunkSelfHeal };

  if (global && global.document) {
    try {
      createChunkSelfHeal(global).install();
    } catch (err) {
      // Vagten maa aldrig selv vaelte booten. best-effort.
      if (global.console && global.console.warn) {
        global.console.warn("[chunk-selfheal] kunne ikke installeres:", err);
      }
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
