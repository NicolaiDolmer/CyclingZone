import type { Metadata } from "next";

// Canonical sættes ALTID per page, aldrig i root layout — én delt canonical
// der pegede alle ruter på roden var præcis SPA-buggen (#4067-evidens).
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <main>
      <h1>Cycling Zone</h1>
      <p>
        Free online cycling manager game. Fair, browser-based, no pay-to-win —
        build your team, race the world.
      </p>
      <p>
        <a href="https://cyclingzone.org/login">Play now</a>
      </p>
    </main>
  );
}
