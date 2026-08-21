import type { Metadata } from "next";

// Canonical + hreflang sættes ALTID per page, aldrig i root layout (SPA-buggen).
export const metadata: Metadata = {
  alternates: {
    canonical: "/",
    languages: { en: "/", da: "/da", "x-default": "/" },
  },
};

// Skelet-copy (#4067 S1) — to-lags-positionering: H1 bærer kategorien,
// underlinjen bærer fairness. Endelig copy låses i tone-sessionen (S2).
export default function HomePage() {
  return (
    <main>
      <h1>The free online cycling manager</h1>
      <p>
        No pay-to-win, ever. Build your team, race the world — straight in your
        browser.
      </p>
      <p>
        <a href="https://cyclingzone.org/login">Play free</a>
      </p>
    </main>
  );
}
