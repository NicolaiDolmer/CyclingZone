import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatWorktreeId, WORKTREE_ID_PATH } from "./playwright.ports.js";
import { patchNotesJsonPlugin } from "./vite-plugins/patch-notes-json.js";
import { bootAssetsManifestPlugin } from "./vite-plugins/boot-assets-manifest.js";
// #5177: modulepreload-hint for det ikke-engelske sprogs lazy message-chunk.
import { i18nLangPreloadPlugin } from "./vite-plugins/i18n-lang-preload.js";
// #5159 (audit-fund H4): frontendens indholds-id + dist/version.json. Se
// vite-plugins/frontend-content-id.js for hvorfor sha'en ikke må være det der
// afgør om en åben fane genindlæser.
import { frontendContentIdPlugin } from "./vite-plugins/frontend-content-id.js";
import { computeSkewDefines } from "./vite-plugins/skew-defines.js";
// SSOT for om Skew Protection reelt er tændt i koden. Modulet har ingen
// side-effects ved import (kun const- og funktions-eksporter), så det kan læses
// direkte her i stedet for at duplikere flaget som en streng-parser.
import { SKEW_PROTECTION_ENABLED } from "./src/lib/skewProtection.js";

// #5160 (audit 11/9, fund H1): source-map-UPLOAD og selve Sentry-TRANSFORMATIONEN
// er to forskellige ting, og kun den ene kræver et token.
//
//   UPLOAD        — sender source maps + release til Sentry. Kræver rigtigt token.
//   TRANSFORMATION— pluginets `renderChunk` skriver et debug-id-snippet ind i HVER
//                   JS-chunk (`_sentryDebugIds[...]="<uuid>"`). Den ændrer altså
//                   de hashede assets og kræver INTET token.
//
// Fordi gaten hidtil kun kunne bygge uden token, målte den et build UDEN den
// transformation prod kører med — og kunne derfor ikke bevise stabile asset-navne
// (auditten målte 76 af 195 chunk-referencer udskiftet mellem to prod-deploys
// uden frontend-diff). `CZ_SENTRY_TRANSFORM=1` slår transformationen til ALENE,
// via pluginets egen dokumenterede `sourcemaps.disable: "disable-upload"`:
// debug-id'er injiceres, intet sendes til Sentry. Prod-adfærd er uændret — med
// token er `enableSentryUpload` true og alt kører som før.
const enableSentryUpload = Boolean(
  process.env.SENTRY_AUTH_TOKEN &&
  process.env.SENTRY_ORG &&
  process.env.SENTRY_PROJECT
);
const forceSentryTransform = process.env.CZ_SENTRY_TRANSFORM === "1";
const enableSentryPlugin = enableSentryUpload || forceSentryTransform;

// Dev/preview-only endpoint der identificerer hvilken worktree serveren kører
// fra, så Playwrights globalSetup kan afvise en fremmed worktrees server på
// porten (false-green-guard, se playwright.ports.js). Rører ikke prod-builds.
const FRONTEND_ROOT = path.dirname(fileURLToPath(import.meta.url));
const worktreeIdPlugin = () => {
  const handler = (req, res) => {
    res.setHeader("Content-Type", "text/plain");
    res.end(formatWorktreeId(FRONTEND_ROOT));
  };
  let isSsrBuild = false;
  return {
    name: "cz-worktree-id",
    configResolved(config) {
      isSsrBuild = Boolean(config.build?.ssr);
    },
    configureServer(server) {
      server.middlewares.use(WORKTREE_ID_PATH, handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(WORKTREE_ID_PATH, handler);
    },
    // #2960: e2e-serveren er en ren statisk server (scripts/e2e-static-server.mjs)
    // uden middleware-hook, saa id'et emittes ogsaa som statisk fil i dist/ ved
    // build — samme ejerfil som dev/preview-middleware'en, én mekanisme.
    generateBundle() {
      if (isSsrBuild) return;
      this.emitFile({
        type: "asset",
        fileName: WORKTREE_ID_PATH.replace(/^\//, ""),
        source: formatWorktreeId(FRONTEND_ROOT),
      });
    },
  };
};

// #4595: release-sha'en må IKKE ende i en hashet asset. Den injiceres i stedet som
// <meta name="cz-release"> i index.html (og dermed også i den kopierede app.html,
// se scripts/prerender.mjs) og læses runtime af src/lib/release.js.
//
// Baggrund: Vercel auto-eksponerer `VITE_VERCEL_GIT_COMMIT_SHA` til Vite-builds.
// Da main.jsx og lib/sentry.jsx læste den, ændrede entry-chunkens indhold sig på
// HVERT deploy — også et docs-only commit — så dens Rollup-hash roterede, og med
// den hele grafen af route-chunks der importerer entry'en. Resultatet var at hver
// åben fane pegede på asset-filer der ikke længere fandtes (CYCLINGZONE-56).
// HTML'en er kort-cachet og følger deployet; assets er `immutable` og skal derfor
// være byte-identiske når koden er uændret.
//
// Bevidst UDEN `VITE_`-prefix: variablen læses her i build-processen (Node), ikke
// i klient-koden, netop for at Vite ikke kan inline den i en asset.
const releaseSha = process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || "";
const releaseMetaPlugin = () => ({
  name: "cz-release-meta",
  // Kun HTML — rører ikke en eneste hashet asset.
  transformIndexHtml() {
    return [
      {
        tag: "meta",
        attrs: { name: "cz-release", content: releaseSha },
        injectTo: "head",
      },
    ];
  },
});

// #2668: preview-værktøjets "autoPort" (.claude/launch.json) tildeler en fri port
// pr. session via PORT-env i stedet for et hardcodet --port-flag, så parallelle
// worktree-sessioner ikke kolliderer på samme dev-server-port. Vite læser ikke
// PORT automatisk — kun eksplicit her. strictPort kun når PORT er sat eksplicit
// (autoPort har allerede verificeret porten er fri); ellers uændret Vite-default
// (auto-increment ved konflikt) for almindelig manuel `npm run dev`.
const explicitPort = process.env.PORT ? Number(process.env.PORT) : undefined;

// #2423: Vercel Skew Protection. Vi bager KUN to konstanter ind — deployment-id
// og build-tidspunkt — som `src/lib/skewProtection.js` bruger til at sætte
// Vercels `__vdpl`-cookie ved boot. Asset-URL'erne røres IKKE (se #4745-
// postmortem: `experimental.renderBuiltUrl` med `?dpl=` gav dobbelt-loadede
// moduler og knækkede hele appen). Er Skew Protection slået fra — i koden ELLER
// i env'en — er buildet bit-for-bit uændret: id = "" og build-tid = 0 ⇒
// cookie-koden er en no-op.
//
// #5170: gaten ligger i `vite-plugins/skew-defines.js` og kræver BÅDE kode-
// flaget `SKEW_PROTECTION_ENABLED` og Vercels env (toggle + production). Det er
// ikke kosmetik: Vercels dashboard-toggle står stadig TIL, så env'en er sat på
// hvert production-build, mens kode-flaget har været `false` siden hotfixet 4/9.
// Før dette fix bagte `Date.now()` derfor en deploy-unik byte ind i modul-
// indholdet FØR dead-code-elimineringen, og 77 af 200 JS-chunks skiftede
// filnavn pr. deploy uden en eneste linje frontend-diff (CYCLINGZONE-56).
// Beregningen er ren og unit-testet i `vite-plugins/skew-defines.test.js`.
const { deploymentId: skewDeploymentId, buildTime: skewBuildTime } = computeSkewDefines({
  env: process.env,
  codeFlag: SKEW_PROTECTION_ENABLED,
});

export default defineConfig({
  define: {
    __CZ_SKEW_DEPLOYMENT_ID__: JSON.stringify(skewDeploymentId),
    __CZ_SKEW_BUILD_TIME__: JSON.stringify(skewBuildTime),
  },
  plugins: [
    react(),
    worktreeIdPlugin(),
    releaseMetaPlugin(),
    patchNotesJsonPlugin(),
    // #5161: skriver boot-assets (entry + modulepreloads + asset-stylesheets) som
    // JSON-datablok lige FOER /chunk-selfheal.js, saa boot-vagten har en komplet
    // liste allerede mens parseren er midt i <head>.
    bootAssetsManifestPlugin(),
    // #5177: skriver { da: "/assets/i18n-messages-da-<hash>.js" } + et lille
    // inline-script der kun preloader chunken naar sproget FAKTISK er dansk.
    i18nLangPreloadPlugin(),
    // #5159: indholds-id'et hasher bundle-navnene og public/, og kører derfor
    // med enforce:"post" — rækkefølgen her er kun for læsbarhed.
    frontendContentIdPlugin({ releaseSha }),
    enableSentryPlugin
      ? sentryVitePlugin({
          authToken: process.env.SENTRY_AUTH_TOKEN,
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          // #5160: transform-only-buildet skal være OFFLINE. Pluginets
          // telemetri-signal sendes ellers til sentry.io alene fordi
          // default-url'en er SaaS (allowedToSendTelemetry returnerer true uden
          // token), og et netværkskald i en determinisme-gate er både spild og
          // en kilde til flaky CI.
          telemetry: enableSentryUpload,
          release: {
            name: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA,
            // Uden token findes der ingen release at oprette eller afslutte.
            // Pluginet ville blot logge en advarsel, men vi slår kaldene
            // eksplicit fra, så transform-only-buildet ikke rører nettet.
            create: enableSentryUpload,
            finalize: enableSentryUpload,
            // #4595 rod-årsag 2: pluginets default (`inject: true`) skriver
            // `window.SENTRY_RELEASE={id:"<sha>"}` ind i ENTRY-chunken selv —
            // en deploy-unik streng i en hashet asset, præcis den klasse resten
            // af denne fil eksisterer for at undgå. Fordi hver route-chunk
            // importerer entry'en, roterede HELE asset-træet på hvert deploy,
            // også docs-/backend-only commits uden en eneste frontend-ændring
            // (målt: 268 af 387 commits siden 1/9). #4970 lukkede kun
            // `import.meta.env`-vejen; denne injektion sker i pluginet selv og
            // er derfor usynlig for den vagt. Releasen er stadig korrekt sat på
            // Sentry-events (source maps matcher) via `Sentry.init({ release })`
            // i src/lib/sentry.jsx, som læser `<meta name="cz-release">` — en
            // kilde der IKKE ligger i en hashet chunk.
            inject: false,
          },
          sourcemaps: {
            assets: "./dist/**",
            // #5160: `"disable-upload"` er pluginets egen indstilling for
            // "injicér debug-id'er, men upload ingenting". `true` ville slå
            // HELE source-map-funktionaliteten fra — inklusive debug-id-
            // injektionen — og så ville determinisme-gaten igen måle et build
            // der ikke ligner prod.
            ...(enableSentryUpload ? {} : { disable: "disable-upload" }),
          },
        })
      : null,
  ].filter(Boolean),
  server: {
    port: explicitPort,
    strictPort: Boolean(explicitPort),
  },
  build: {
    // #5160: source maps følger PLUGINET, ikke uploadet. De ændrer de hashede
    // assets (hver chunk får en `//# sourceMappingURL=`-linje), så et build der
    // skal bevise noget om prod's asset-navne skal have dem slået til på samme
    // måde som prod. Prod har token ⇒ uændret true; almindelige lokale builds
    // har hverken token eller CZ_SENTRY_TRANSFORM ⇒ uændret false.
    sourcemap: enableSentryPlugin,
    // #5177: flag-icons' SVG'er må ALDRIG inlines som data-URI'er.
    //
    // `flag-icons/css/flag-icons.min.css` er kun 28 KB råt og peger på 542
    // separate filer (271 nationaliteter × 4x3 + 1x1) med
    // `url(../flags/4x3/xx.svg)`. Hver SVG er ~760 bytes, altså under Vites
    // default-grænse på 4096, så byggeriet inlinede dem alle sammen og gjorde
    // stylesheetet til 411,2 KB råt / 81,5 KB gzip — det næststørste aktiv i
    // hele buildet, hvoraf en spiller typisk bruger under ti flag.
    //
    // Som separate filer henter browseren KUN de nationaliteter der faktisk
    // står på siden, hver med hashet filnavn og dermed immutable caching
    // (scripts/check-cdn-cache-headers.mjs). Stylesheetet selv falder til et
    // par KB. Ingen visuel forskel: samme SVG'er, samme `.fi`-geometri.
    //
    // Returnér `undefined` for alt andet, så resten af repoet beholder Vites
    // default-opførsel uændret.
    assetsInlineLimit: (filePath) =>
      /[\\/]flag-icons[\\/]flags[\\/]/.test(filePath) ? false : undefined,
    rolldownOptions: {
      output: {
        // #5177 spor 3 — entry-chunken skæres op i deploy-STABILE grupper.
        //
        // Målt før (13/9, `npm run build`): `index` var 236,3 KB gzip, og en
        // source-map-attribution af netop den chunk viste at intet af vægten var
        // route-kode eller charts (recharts/CategoricalChart er allerede sin egen
        // chunk og hentes kun af FinancePage/AdminGrowth — entry'en indeholder
        // kun chunk-NAVNET i Vites preload-manifest, ikke koden). De fem største
        // bidrag var udelukkende bibliotek + i18n-tekst:
        //
        //   1. react-dom (react-dom-client.production.js)  171,2 KB raw
        //   2. de INLINEDE locale-JSON (public/locales/**)  143,5 KB raw
        //   3. @formatjs/icu-messageformat-parser            19,2 KB raw
        //   4. src/App.jsx (rute-tabellen selv)              18,1 KB raw
        //   5. @sentry/browser                               16,6 KB raw
        //
        // Alle fem er nødvendige på first paint, så de to grupper herunder
        // flytter IKKE bytes væk fra det første besøg — de flytter dem ud af den
        // chunk der får ny hash ved hver eneste app-ændring. react-dom ændrer
        // sig kun ved et dependency-bump, og locale-JSON kun når teksten
        // ændrer sig; som selvstændige chunks overlever de et deploy i
        // browser-cachen i stedet for at blive hentet igen sammen med entry'en.
        // Samme problemklasse som #4595/CYCLINGZONE-56 (roterende asset-hashes),
        // bare fra den anden ende: 185 KB gzip er nu deploy-stabilt.
        //
        // Målt efter (samme build-kommando):
        //   index 236,3 -> 54,9 KB gzip · first paint (entry + modulepreloads)
        //   338,8 -> 338,7 KB · total gzippet JS 1148,0 -> 1148,8 KB (202 chunks).
        //
        // BEVIDST kun to grupper. En variant med fire (også `sentry-vendor` og
        // `i18n-vendor`) blev målt og forkastet: gzip-ordbogen er pr. fil, så de
        // to ekstra små chunks kostede +23,3 KB på first paint (338,8 -> 362,1)
        // og +24,2 KB på totalen. Entry'en blev kun 22 KB mindre af det — en
        // dårlig byttehandel når LCP er det spor faktisk handler om.
        //
        // Den eneste tilbageværende ÆGTE reduktion af first paint er at tage de
        // ~20 login-only namespaces ud af `resources` i src/i18n/index.js. Det
        // er bevidst IKKE gjort her: hvert flyttet namespace kræver en
        // ready-gate på forbrugerfladen (#3697), og bundle-budget.json's note
        // kalder det eksplicit en ejer-beslutning, ikke en ren gevinst.
        codeSplitting: {
          groups: [
            {
              name: "react-vendor",
              test: /node_modules[\\/](react|react-dom|scheduler|react-is)[\\/]/,
              priority: 30,
            },
            {
              // #5177: ÉN gruppe pr. sprog i stedet for én fælles.
              //
              // Før: begge sprog (24 namespaces × en+da = 426 KB raw / 131 KB
              // gzip) lå i samme chunk, statisk importeret af entry'en og
              // modulepreloadet i <head>. Hver besøgende hentede altså også det
              // sprog de aldrig ser.
              //
              // Nu: engelsk er stadig en statisk import (default + fallbackLng,
              // se src/i18n/index.js), dansk importeres kun dynamisk fra
              // src/i18n/messages.da.js. Wrapper-modulet matches med i gruppen,
              // så den danske bundle bliver ÉN chunk og ikke to requests.
              name: "i18n-messages-en",
              test: /public[\\/]locales[\\/]en[\\/]/,
              priority: 30,
            },
            {
              name: "i18n-messages-da",
              test: /(public[\\/]locales[\\/]da[\\/]|src[\\/]i18n[\\/]messages\.da\.js)/,
              priority: 30,
            },
          ],
        },
      },
    },
  },
});
