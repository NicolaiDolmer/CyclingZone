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
 * Boot-scope (review 4/9): kun URL'er der stod i dokumentets <head> VED INSTALL
 * ("bootUrls") accepteres som healbare targets. En modulepreload/stylesheet der
 * indsaettes af app-koden EFTER boot (fx en route-praefetch) skal IKKE kunne
 * udloese boot-vagten — den slags haandteres af `lazyWithRetry.js`. Samme snapshot
 * bruges naar vi renser cachen, saa vi aldrig querySelectorAll'er igen efter en
 * fejl (DOM'en kan se anderledes ud paa det tidspunkt). Vagten stopper ogsaa helt
 * saa snart appen har booted (`window.__czAppBooted`, sat af main.jsx) — en fejl
 * der opstaar efter et vellykket mount er ikke et boot-problem.
 *
 * Falsk-alarm-guard (CI-evidens 4/9, mobile-webkit #4760): en igangvaerende
 * SPA-navigation kan afbryde en modulepreload-hentning i WebKit og udloese et
 * `error`-event paa en ressource der faktisk er fin. Foer vi healer, bekraefter
 * vi derfor den KONKRETE fejlede URL med en almindelig (ikke cache:'reload')
 * fetch: svarer den 200, er fejlen falsk, og vi rører intet. Svarer den >=400
 * eller kaster fetch'en, er det en aegte cachet-404-fejl, og vi fortsaetter.
 * Umiddelbart foer selve reload'et koerer vi ogsaa en lille "kan dokumentet
 * stadig hente noget"-canary (samme lag som `chunkErrors.js`s
 * `documentIsStillLoadable()` — kan ikke importeres her, da dette er et classic
 * script, saa probén er kopieret) paa `location.href` med `cache:'no-store'`:
 * resolver den slet ikke, er vi midt i en navigation vaek fra siden, og vi
 * reloader ikke oven i den.
 *
 * Loop-sikkerhed: MAKS ét heal-forsoeg (og dermed hoejst ét reload) pr.
 * sideindlaesning, gemt i sessionStorage under `cz_chunk_selfheal_at` (plus et
 * per-load-flag der blokerer et andet forsoeg mens det foerste stadig afventer
 * sin bekraeftelses-fetch). Kan sessionStorage ikke laeses eller skrives,
 * reloader vi IKKE (fail-closed) — et uendeligt reload-loop er vaerre end en
 * sort side med en manuel genindlaesning. Er reload-slottet brugt (eller
 * sessionStorage utilgaengelig) OG `#root` staar tom, viser vi i stedet en
 * minimal fallback-UI med en manuel reload-knap, saa spilleren ikke bare ser en
 * sort side uden nogen udvej.
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
    // Snapshottet ved install() — se boot-scope-noten oeverst i filen.
    var bootUrls = [];

    function warn(message) {
      if (win.console && typeof win.console.warn === "function") {
        win.console.warn("[chunk-selfheal] " + message);
      }
    }

    // Alle URL'er browseren kan have en cachet 404 paa: entry-bundlen, hver
    // modulepreload Vite injicerer, og de hashede stylesheets (de deler samme
    // /assets/(.*)-immutable-header og samme fejlklasse). Vi kender ikke
    // nødvendigvis hvilken der fejlede (link-fejl baerer href, men en fejl i
        // modul-grafen peger paa entryen), saa vi renser dem alle. De er faa og smaa.
    function moduleUrls() {
      var urls = [];
      if (!doc || typeof doc.querySelectorAll !== "function") return urls;
      var nodes = doc.querySelectorAll(
        'link[rel="modulepreload"][href], script[type="module"][src], link[rel="stylesheet"][href^="/assets/"]',
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

    // Kopi af `chunkErrors.js`s `documentIsStillLoadable()`-princip: kan ikke
    // importeres i et classic script. Enhver resolved response (ogsaa 404/502)
    // taeller — spoergsmaalet er "kan dokumentet stadig hente noget", ikke "er
    // svaret sundt". Ingen `location.href` eller intet fetch/Promise til
    // raadighed => fail-open (antag stadig paa siden), for ikke selv at blive
    // en ny maade at aldrig reparere paa.
    function documentStillLoadable() {
      var fetchFn = win.fetch;
      var PromiseImpl = win.Promise;
      var loc = win.location;
      if (typeof fetchFn !== "function" || typeof PromiseImpl !== "function" || !loc || !loc.href) {
        return PromiseImpl ? PromiseImpl.resolve(true) : { then: function (onOk) { onOk(true); } };
      }
      var handle;
      var timeout = new PromiseImpl(function (resolve) {
        if (typeof win.setTimeout === "function") {
          handle = win.setTimeout(function () {
            resolve(false);
          }, REFETCH_TIMEOUT_MS);
        } else {
          resolve(false);
        }
      });
      var probe = PromiseImpl.resolve()
        .then(function () {
          return fetchFn.call(win, loc.href, { cache: "no-store" });
        })
        .then(
          function () {
            return true;
          },
          function () {
            return false;
          },
        );
      return PromiseImpl.race([probe, timeout]).then(function (stillLoadable) {
        if (handle !== undefined && typeof win.clearTimeout === "function") {
          win.clearTimeout(handle);
        }
        return stillLoadable;
      });
    }

    // Minimal fallback-UI: sidste udvej naar vi hverken kan bevise et sikkert
    // reload ELLER stole på at et tidligere forsoeg reparerede siden, og #root
    // staar tom (ellers rører vi ikke en side der allerede viser noget).
    // Bygget af almindelige elementer via `innerHTML`, ikke via React — hele
    // pointen er at den virker naar INTET af app-grafen koerer.
    function showFallbackUI() {
      if (!doc || typeof doc.getElementById !== "function") return;
      var root = doc.getElementById("root");
      if (!root || root.firstElementChild) return;

      root.innerHTML =
        '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;' +
        'background:#0b0b0c;color:#f5f5f5;font-family:system-ui,-apple-system,sans-serif;' +
        'text-align:center;padding:24px;">' +
        "<div>" +
        '<p style="margin:0 0 8px;font-size:16px;">The page could not load. Reload to try again.</p>' +
        '<p style="margin:0 0 16px;font-size:16px;">Siden kunne ikke indl&aelig;ses. Genindl&aelig;s for at pr&oslash;ve igen.</p>' +
        '<button type="button" style="padding:10px 20px;font-size:14px;background:#f5f5f5;' +
        'color:#0b0b0c;border:none;border-radius:4px;cursor:pointer;">Reload</button>' +
        "</div></div>";

      var button = typeof root.querySelector === "function" ? root.querySelector("button") : null;
      if (button && typeof button.addEventListener === "function") {
        button.addEventListener("click", function () {
          try {
            win.location.reload();
          } catch (err) {
            warn("location.reload() fra fallback-UI fejlede: " + (err && err.message ? err.message : err));
          }
        });
      }
    }

    function heal(reason, confirmUrl) {
      if (attempted || unloading || win.__czAppBooted) return false;
      attempted = true;

      function proceed() {
        if (unloading) {
          warn(reason + " — reload sprunget over (dokumentet forlades)");
          return;
        }
        documentStillLoadable().then(function (stillLoadable) {
          if (unloading) {
            warn(reason + " — reload sprunget over (dokumentet forlades)");
            return;
          }
          if (!stillLoadable) {
            warn(reason + " — reload sprunget over (dokumentet ser ud til at navigere vaek)");
            return;
          }
          if (!claimReloadSlot(Date.now())) {
            warn(reason + " — reload sprunget over (allerede forsoegt, eller sessionStorage utilgaengelig)");
            showFallbackUI();
            return;
          }

          var urls = bootUrls;
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
        });
      }

      var fetchFn = win.fetch;
      var PromiseImpl = win.Promise;
      if (!confirmUrl || typeof fetchFn !== "function" || typeof PromiseImpl !== "function") {
        // Ingen URL at bekraefte imod, eller intet fetch/Promise til raadighed:
        // kan ikke skelne en aegte 404 fra en falsk alarm, saa vi antager
        // fejlen er aegte (samme adfaerd som foer denne bekraeftelse fandtes).
        proceed();
        return true;
      }

      PromiseImpl.resolve()
        .then(function () {
          // Normal cache-tilstand (IKKE cache:'reload'): en stadig-cachet
          // immutable 404 svarer 404 her, uden at overskrive noget. En falsk
          // alarm (ressourcen er faktisk fin, fx afbrudt af en navigation i
          // WebKit) svarer 200.
          return fetchFn.call(win, confirmUrl, { credentials: "same-origin" });
        })
        .then(
          function (res) {
            if (res && res.ok) {
              warn(reason + " — falsk alarm (bekraeftelses-fetch svarede 200), ingen reload");
              return;
            }
            proceed();
          },
          function () {
            // Fetch'en kastede (netvaerksfejl e.l.) — kan ikke bevise en falsk
            // alarm, saa vi behandler det som en bekraeftet fejl.
            proceed();
          },
        );

      return true;
    }

    // Ressource-fejl (script/link) bobler ikke, men de KAN fanges i capture-fasen
    // paa window. Runtime-fejl kommer samme vej, saa vi skelner paa target.
    function onWindowError(event) {
      // Appen har booted — dette er ikke laengere et boot-problem (main.jsx
      // saetter flaget lige efter mount).
      if (win.__czAppBooted) return;
      if (unloading) return;

      var target = event && event.target;
      if (!target || target === win || typeof target.tagName !== "string") return;
      var tag = target.tagName.toLowerCase();
      var attr = typeof target.getAttribute === "function" ? target.getAttribute.bind(target) : null;
      if (!attr) return;

      if (tag === "script" && attr("type") === "module") {
        var src = target.src;
        // Boot-scope: kun targets der stod i dokumentet ved install().
        if (bootUrls.indexOf(src) === -1) return;
        heal("entry-modulet kunne ikke hentes (" + (src || "ukendt URL") + ")", src);
        return;
      }
      if (tag === "link" && attr("rel") === "modulepreload") {
        var href = target.href;
        if (bootUrls.indexOf(href) === -1) return;
        heal("modulepreload fejlede (" + (href || "ukendt URL") + ")", href);
        return;
      }
      if (tag === "link" && attr("rel") === "stylesheet") {
        var cssHref = target.href;
        if (bootUrls.indexOf(cssHref) === -1) return;
        heal("stylesheet fejlede (" + (cssHref || "ukendt URL") + ")", cssHref);
      }
    }

    function install() {
      if (!win || typeof win.addEventListener !== "function") return function () {};

      // Snapshot FOER vi lytter efter noget — se boot-scope-noten oeverst i filen.
      bootUrls = moduleUrls();

      win.addEventListener("error", onWindowError, true);
      win.addEventListener("pagehide", function () {
        unloading = true;
      });
      // Belt-and-braces ud over pagehide: dokumenteret i #3602/#4760-CI-evidensen
      // at en navigation kan starte laenge foer pagehide fyrer.
      win.addEventListener("beforeunload", function () {
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
