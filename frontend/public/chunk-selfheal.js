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
 * Boot-scope (review 4/9): kun dokumentets EGNE boot-assets ("bootUrls")
 * accepteres som healbare targets. En modulepreload/stylesheet der indsaettes af
 * app-koden EFTER boot (fx en route-praefetch) skal IKKE kunne udloese
 * boot-vagten — den slags haandteres af `lazyWithRetry.js`. Samme liste bruges
 * naar vi renser cachen, saa vi aldrig querySelectorAll'er igen efter en fejl
 * (DOM'en kan se anderledes ud paa det tidspunkt). Vagten stopper ogsaa helt saa
 * snart appen har booted (`window.__czAppBooted`, sat af main.jsx) — en fejl der
 * opstaar efter et vellykket mount er ikke et boot-problem.
 *
 * HVOR LISTEN KOMMER FRA (#5161, audit-fund H2 11/9): den blev tidligere KUN
 * bygget med `querySelectorAll` ved install — men denne fil ligger i <head>, og
 * paa det tidspunkt har parseren hverken naaet entry-scriptet eller Vites
 * modulepreloads. Maalt i baade Chromium og WebKit: `count: 0,
 * readyState: "loading"` ved install, 28 tags efter boot. Listen blev aldrig
 * genopbygget, saa fejlhandleren afviste ENHVER fejlet ressource som "uden for
 * boot-scope": ved en entry-404 var resultatet en tom `#root` UDEN selvheling og
 * UDEN fallback. Derfor er den primaere kilde nu en build-genereret liste,
 * injiceret af `vite-plugins/boot-assets-manifest.js` som en JSON-datablok lige
 * FOER denne fil:
 *
 *   <script type="application/json" id="cz-boot-assets">["/assets/…"]</script>
 *   <script src="/chunk-selfheal.js"></script>
 *
 * DOM-snapshottet beholdes som supplement (det daekker `npm run dev`, hvor
 * listen kun rummer dev-entryen). Er begge tomme, er vagten reelt slukket — det
 * maa aldrig ske i et bygget dokument, saa det logges eksplicit og saettes som
 * `window.__czChunkSelfHealBootListEmpty` (se reportEmptyBootList).
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
  // Id'et paa JSON-datablokken vite-plugin'et cz-boot-assets-manifest skriver.
  // Skal matche BOOT_ASSETS_ELEMENT_ID i vite-plugins/boot-assets-manifest.js.
  var BOOT_ASSETS_ELEMENT_ID = "cz-boot-assets";

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

    // Build-listen staar som relative stier ("/assets/index-Xy42.js"), mens et
    // fejl-events target baerer den ABSOLUTTE URL (`element.src`/`.href`). Uden
    // denne normalisering ville intet nogensinde matche.
    function absolutize(url) {
      if (!url) return "";
      try {
        if (typeof win.URL === "function") {
          var base = (doc && doc.baseURI) || (win.location && win.location.href) || undefined;
          return new win.URL(url, base).href;
        }
      } catch {
        // Ubrugelig base eller ingen URL-konstruktor: behold raastringen. En
        // uoverensstemmelse koster et manglende match, ikke en fejl i booten.
      }
      return url;
    }

    // Primaer kilde: den build-genererede JSON-datablok (#5161). Den staar FOER
    // denne fil i index.html, saa den er parset naar vi laeser den — i modsaetning
    // til de modultags querySelectorAll leder efter.
    function manifestUrls() {
      var urls = [];
      if (!doc || typeof doc.getElementById !== "function") return urls;
      var node = doc.getElementById(BOOT_ASSETS_ELEMENT_ID);
      if (!node) return urls;
      var raw = node.textContent;
      if (!raw) return urls;
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        warn(
          "kunne ikke parse boot-listen i #" +
            BOOT_ASSETS_ELEMENT_ID +
            ": " +
            (err && err.message ? err.message : err),
        );
        return urls;
      }
      if (!parsed || typeof parsed.length !== "number") return urls;
      for (var i = 0; i < parsed.length; i += 1) {
        var url = absolutize(parsed[i]);
        if (url && urls.indexOf(url) === -1) urls.push(url);
      }
      return urls;
    }

    // Assertion/telemetri (#5161). I et BYGGET dokument er listen aldrig tom —
    // vite-pluginet afbryder selv buildet hvis den ville blive det. Ser vi den
    // alligevel tom her, er vagten reelt slukket: ingen URL kan matche
    // boot-scope, og en entry-404 ville give praecis den tomme `#root` uden
    // selvheling og uden fallback som audit-fund H2 beskriver. Flaget er
    // laesbart for app-koden (og dermed for Sentry, som ikke er loaded endnu paa
    // dette tidspunkt i booten).
    function reportEmptyBootList() {
      try {
        win.__czChunkSelfHealBootListEmpty = true;
      } catch {
        // Frosset/proxied window: flaget er en bonus, advarslen er det vigtige.
      }
      warn(
        "boot-listen er TOM ved install (readyState=" +
          ((doc && doc.readyState) || "ukendt") +
          ') — <script id="' +
          BOOT_ASSETS_ELEMENT_ID +
          '"> mangler. Vagten kan ikke genkende entry-404 i dette dokument.',
      );
    }

    // Boot-scope-testen. Normalt: stod URL'en paa boot-listen?
    //
    // Undtagelsen daekker det tilfaelde der aldrig maa opstaa: en TOM liste. Da
    // kan intet matche, og en entry-404 ville passere i stilhed (#5161). Et
    // `<script type="module">` i dokumentet ER pr. definition et boot-asset —
    // app-koden indsaetter aldrig den slags (lazy imports bruger
    // `<link rel="modulepreload">`), saa netop den tag-type er sikker at
    // acceptere uden liste. Preloads og stylesheets er det ikke.
    function inBootScope(tag, url) {
      if (url && bootUrls.indexOf(url) !== -1) return true;
      return bootUrls.length === 0 && tag === "script";
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

    // Fallback-UI (#5161, brand-styling 11/9): sidste udvej naar vi hverken kan
    // reloade sikkert eller stole paa at et tidligere forsoeg reparerede siden, og
    // #root staar tom. `innerHTML`, ikke React — den skal virke naar INTET af
    // app-grafen koerer, saa ALT staar inline:
    //  - Ét <style>-blok (mindre end style=""-attributter, og det eneste sted vi
    //    kan nulstille <body>'ens UA-margin: app.html linker ét hashed stylesheet
    //    under samme immutable-header som entryen, saa det kan vaere 404 sammen med
    //    den. Naar CSS'en ER der, holder samme regel fladen moerk ogsaa for en
    //    spiller i lyst tema. Begge tilfaelde er skudt i test-results/).
    //  - Spillets MOERKE tokens som raa vaerdier, da der ingen :root er at arve
    //    fra: bg-body #0e0f15 · text-1 #ededf2 · text-2 #9da0b3 · text-3 #888ba0 ·
    //    border #2a2d3a · accent #e8c547 · on-accent #1a1f38 · accent-t #ffd966 ·
    //    radius-sm 5px. Aendres de i src/index.css, skal de aendres her med.
    //  - Wordmarken inline: docs/brand/GUIDELINES.md §5 forbyder at saette navnet i
    //    en live font som erstatning for marken, og et <img src="/brand/..."> ville
    //    vaere et ekstra netvaerkskald netop hvor netvaerket svigtede. Samme
    //    geometri som public/brand/wordmark-ondark.svg, minificeret (C og N staar
    //    én gang i <defs>). Teksten er system-sans, ikke Bebas: @font-face'en ligger
    //    i den CSS der aldrig kom.
    //
    // Kontrast mod #0e0f15: text-1 16,25:1 · text-2 7,33:1 · text-3 5,65:1 ·
    // wordmark 11,30:1 · knaptekst #1a1f38 paa #e8c547 9,64:1. Alle over AA 4,5:1.
    var FALLBACK_WORDMARK =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 140" role="img" aria-label="Cycling Zone" class="czfb-m">' +
      "<defs>" +
      '<path id="czw0" d="M34 162V538Q34 620 75.5 665.0Q117 710 196 710Q275 710 316.5 665.0Q358 620 358 538V464H254V545Q254 610 199 610Q144 610 144 545V154Q144 90 199 90Q254 90 254 154V261H358V162Q358 80 316.5 35.0Q275 -10 196 -10Q117 -10 75.5 35.0Q34 80 34 162Z"/>' +
      '<path id="czw1" d="M142 298 9 700H126L201 443H203L278 700H385L252 298V0H142Z"/>' +
      '<path id="czw2" d="M41 700H151V100H332V0H41Z"/>' +
      '<path id="czw3" d="M41 700H151V0H41Z"/>' +
      '<path id="czw4" d="M41 700H179L286 281H288V700H386V0H273L141 511H139V0H41Z"/>' +
      '<path id="czw5" d="M33 166V534Q33 619 75.0 664.5Q117 710 197 710Q277 710 319.0 664.5Q361 619 361 534V474H257V541Q257 610 200 610Q143 610 143 541V158Q143 90 200 90Q257 90 257 158V295H202V395H361V166Q361 81 319.0 35.5Q277 -10 197 -10Q117 -10 75.0 35.5Q33 81 33 166Z"/>' +
      '<path id="czw6" d="M19 98 223 600H29V700H341V602L137 100H341V0H19Z"/>' +
      '<path id="czw7" d="M33 166V534Q33 618 76.0 664.0Q119 710 200 710Q281 710 324.0 664.0Q367 618 367 534V166Q367 82 324.0 36.0Q281 -10 200 -10Q119 -10 76.0 36.0Q33 82 33 166ZM257 159V541Q257 610 200 610Q143 610 143 541V159Q143 90 200 90Q257 90 257 159Z"/>' +
      '<path id="czw8" d="M41 700H341V600H151V415H302V315H151V100H341V0H41Z"/>' +
      "</defs>" +
      '<g fill="#e8c547" transform="translate(96.994 68)scale(.062 -.062)">' +
      '<use href="#czw0"/><use href="#czw1" x="415.3"/><use href="#czw0" x="841.5"/>' +
      '<use href="#czw2" x="1256.8"/><use href="#czw3" x="1633"/><use href="#czw4" x="1857.3"/>' +
      '<use href="#czw5" x="2316.5"/><use href="#czw6" x="2932.1"/><use href="#czw7" x="3326.3"/>' +
      '<use href="#czw4" x="3758.6"/><use href="#czw8" x="4217.8"/>' +
      "</g>" +
      '<line x1="60" y1="90" x2="420" y2="90" stroke="#ffd966" stroke-width="1.8"/>' +
      '<line x1="218" y1="104" x2="262" y2="104" stroke="#ffd966" stroke-width="2.8" stroke-linecap="round"/>' +
      "</svg>";

    var FALLBACK_STYLE =
      "<style>html,body{margin:0;background:#0e0f15}" +
      ".czfb{min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;" +
      "padding:32px 24px;background:#0e0f15;color:#ededf2;-webkit-font-smoothing:antialiased;" +
      'font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}' +
      ".czfb-i{width:100%;max-width:28rem;text-align:center}" +
      ".czfb-m{display:block;width:100%;max-width:232px;height:auto;margin:0 auto 32px}" +
      ".czfb-h{margin:0;font-size:20px;font-weight:700;line-height:1.3}" +
      ".czfb-s{margin:6px 0 0;font-size:15px;line-height:1.4;color:#9da0b3}" +
      ".czfb-r{width:232px;max-width:100%;margin:24px auto;border:0;border-top:1px solid #2a2d3a}" +
      ".czfb-p{margin:0;font-size:13px;line-height:1.6;color:#888ba0}" +
      ".czfb-p+.czfb-p{margin-top:2px}" +
      ".czfb-b{margin-top:24px;padding:10px 16px;font-family:inherit;font-size:14px;font-weight:600;" +
      "background:#e8c547;color:#1a1f38;border:1px solid transparent;border-radius:5px;cursor:pointer}" +
      ".czfb-b:hover{filter:brightness(1.05)}.czfb-b:active{transform:translateY(1px)}" +
      ".czfb-b:focus-visible{outline:2px solid #ffd966;outline-offset:1px}" +
      "@media(max-width:420px){.czfb{padding:24px 16px}" +
      ".czfb-m{max-width:190px;margin-bottom:28px}.czfb-r{width:190px}.czfb-h{font-size:18px}}</style>";

    function showFallbackUI() {
      if (!doc || typeof doc.getElementById !== "function") return;
      var root = doc.getElementById("root");
      if (!root || root.firstElementChild) return;

      root.innerHTML =
        FALLBACK_STYLE +
        '<div class="czfb"><div class="czfb-i">' +
        FALLBACK_WORDMARK +
        '<h1 class="czfb-h" lang="en">The game did not start</h1>' +
        '<p class="czfb-s" lang="da">Spillet startede ikke</p>' +
        '<hr class="czfb-r">' +
        "<p class=\"czfb-p\" lang=\"en\">The game's files did not load. Reload to try again.</p>" +
        '<p class="czfb-p" lang="da">Spillets filer blev ikke hentet. Genindl&aelig;s for at pr&oslash;ve igen.</p>' +
        '<button type="button" class="czfb-b">Reload</button>' +
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

          // Tom liste burde ikke kunne ske i et bygget dokument (se
          // reportEmptyBootList), men skulle den alligevel: rens i det mindste
          // den URL vi ved fejlede, saa den cachede 404 ikke overlever reload'et.
          var urls = bootUrls.length ? bootUrls : confirmUrl ? [confirmUrl] : [];
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
        // Boot-scope: kun dokumentets egne boot-assets.
        if (!inBootScope("script", src)) return;
        heal("entry-modulet kunne ikke hentes (" + (src || "ukendt URL") + ")", src);
        return;
      }
      if (tag === "link" && attr("rel") === "modulepreload") {
        var href = target.href;
        if (!inBootScope("link", href)) return;
        heal("modulepreload fejlede (" + (href || "ukendt URL") + ")", href);
        return;
      }
      if (tag === "link" && attr("rel") === "stylesheet") {
        var cssHref = target.href;
        if (!inBootScope("link", cssHref)) return;
        heal("stylesheet fejlede (" + (cssHref || "ukendt URL") + ")", cssHref);
      }
    }

    function install() {
      if (!win || typeof win.addEventListener !== "function") return function () {};

      // Boot-listen FOER vi lytter efter noget — se boot-scope-noten oeverst i
      // filen. Build-manifestet er den autoritative kilde; DOM-snapshottet
      // supplerer det (dev-serveren har intet manifest-indhold ud over
      // dev-entryen, og en fremtidig tag-variant vi ikke kender fanges stadig).
      bootUrls = manifestUrls();
      var domUrls = moduleUrls();
      for (var u = 0; u < domUrls.length; u += 1) {
        if (bootUrls.indexOf(domUrls[u]) === -1) bootUrls.push(domUrls[u]);
      }
      if (bootUrls.length === 0) reportEmptyBootList();

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
