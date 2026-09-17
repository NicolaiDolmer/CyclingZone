// LanguageSwitcherFlag — Refs #5177.
//
// Sprogvælgeren viste sit lille flag via `fi fi-gb` / `fi fi-dk` fra
// flag-icons' sprite-CSS. Den CSS-fil er 421 KB rå / 84,7 KB gzippet, fordi den
// indeholder BAGGRUNDSBILLEDER FOR ~260 LANDE som data-URI'er — og fordi
// LanguageSwitcher hænger i sidehovedet (Layout.jsx, ikke lazy), landede hele
// spritet i ENTRY-chunkens CSS-graf og blev hentet på HVER side, også dem uden
// et eneste flag (`/`, `/login`, `/roadmap`). Målt i #5217: 85 KB af 610 KB på
// /roadmap, render-blokerende, for to flag på 20x15 px.
//
// De to flag bor derfor her som inline SVG i stedet. Rytter-flagene (Flag.jsx)
// bruger stadig sprite-CSS'en — de kan ikke inlines, for de dækker alle
// nationaliteter i rytterkataloget — men Flag.jsx' forbrugere ligger alle bag
// lazy ruter, så CSS'en følger nu den rute-chunk der faktisk viser flag.
//
// Geometrien er flag-icons' egen (viewBox 0 0 640 480, 4:3), og målene er sat i
// em så flaget skalerer med knappens tekst nøjagtigt som `.fi` gjorde
// (`.fi` = width 1.3333em, line-height 1em).

const VIEWBOX = "0 0 640 480";

// Union Jack. Samme konstruktion som flag-icons' gb.svg.
function UnionJack() {
  return (
    <>
      <path fill="#012169" d="M0 0h640v480H0z" />
      <path
        fill="#fff"
        d="m75 0 244 181L562 0h78v62L400 241l240 178v61h-80L320 301 81 480H0v-60l239-178L0 64V0h75z"
      />
      <path
        fill="#c8102e"
        d="m424 281 216 159v40L369 281h55zm-184 20 6 35L54 480H0l240-179zM640 0v3L391 191l2-44L590 0h50zM0 0l239 176h-60L0 42V0z"
      />
      <path fill="#fff" d="M241 0v480h160V0H241zM0 160v160h640V160H0z" />
      <path fill="#c8102e" d="M0 193v96h640v-96H0zM273 0v480h96V0h-96z" />
    </>
  );
}

// Dannebrog.
function Dannebrog() {
  return (
    <>
      <path fill="#c8102e" d="M0 0h640v480H0z" />
      <path fill="#fff" d="M205.7 0h68.6v480h-68.6z" />
      <path fill="#fff" d="M0 205.7h640v68.6H0z" />
    </>
  );
}

const FLAGS = { gb: UnionJack, dk: Dannebrog };

/**
 * Lille firkantet flag til sprogvælgeren.
 *
 * Ydre <span> er en NØJAGTIG klon af flag-icons' egen `.fi`-boks:
 *
 *   .fi        { position:relative; display:inline-block; width:1.333333em; line-height:1em }
 *   .fi:before { content:" " }
 *   .fi        { background-size:contain; background-position:50% }
 *
 * Det er ikke kosmetik. Første forsøg var en bar <svg> med `height:1em` og en
 * lille `vertical-align`-justering, og det flyttede linjeboksen i den mobile
 * topbar 1 px — nok til at `calendar-page.png`-snapshottet fejlede i alle tre
 * Playwright-projekter (`main` blev 1095 px i stedet for 1094). En tom
 * inline-block's baseline er dens UNDERKANT, mens `.fi` har et mellemrum fra
 * sin `:before` og derfor en rigtig tekst-baseline. Derfor beholdes
 * `:before`-tegnet her som et rigtigt tegn, og SVG'en ligger absolut oven i
 * boksen — samme rolle som background-image havde. Ændrer du boksen, så kør
 * `calendar.spec.js`-snapshottet igen.
 *
 * @param {{ code: string, className?: string }} props
 *   `code` er flag-koden fra i18n/languages.js (`gb` / `dk`), ikke locale-koden.
 */
export default function LanguageSwitcherFlag({ code, className = "" }) {
  const Shape = FLAGS[code];
  // Ukendt kode: intet flag frem for en tom kasse. Et nyt sprog i LANGUAGES uden
  // en shape her giver dermed et tekst-only valg, ikke et layout-hul.
  if (!Shape) return null;
  return (
    <span
      role="img"
      aria-hidden="true"
      className={`relative inline-block ${className}`.trim()}
      style={{ width: "1.333333em", lineHeight: "1em" }}
    >
      {" "}
      <svg
        viewBox={VIEWBOX}
        focusable="false"
        aria-hidden="true"
        className="absolute inset-0 block h-full w-full"
      >
        <Shape />
      </svg>
    </span>
  );
}
